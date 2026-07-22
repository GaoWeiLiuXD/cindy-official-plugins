import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

// 插件行为测试(2026-07-22 从主仓迁入本插件仓)。只测 cindy-mermaid 自己的
// 运行时行为,不依赖基座:manifest 合法性由 Cindy 装载/打包时校验;原主仓版
// 里「与 @lizi/maker-shared repairMermaidSource 对拍」一节因依赖基座包,迁移
// 时移除(修复逻辑同步靠人工核对,不在插件仓测)。
// ⚠️ 本插件仓当前无 runner:这些是存档测试,待接入 vitest/CI 后启用。

type HostMessageHandler = (message: Record<string, unknown>) => void | Promise<void>;

interface CindyMessage {
  type: string;
  callId?: string;
  ok?: boolean;
  result?: {
    markdown?: string;
    source?: string;
    changed?: boolean;
    validation?: string;
    note?: string;
  };
  message?: string;
}

const ghostRoot = new URL('../cindy-mermaid/', import.meta.url);
const mainSource = readFileSync(new URL('main.js', ghostRoot), 'utf8');

function createMermaidHarness() {
  let handler: HostMessageHandler | undefined;
  const messages: CindyMessage[] = [];
  const cindy = {
    onHostMessage: vi.fn((nextHandler: HostMessageHandler) => {
      handler = nextHandler;
    }),
    send: vi.fn((message: CindyMessage) => {
      messages.push(message);
    }),
  };

  new Script(mainSource, { filename: 'cindy-mermaid/main.js' }).runInContext(
    createContext({ cindy }),
  );
  if (!handler) throw new Error('Cindy Mermaid did not register its host-message handler');

  return {
    async submit(source: unknown, tool = 'prepare_mermaid'): Promise<CindyMessage> {
      messages.length = 0;
      await handler!({ type: 'tool-call', tool, callId: 'call-1', args: { source } });
      const result = messages.findLast((message) => message.type === 'tool-result');
      if (!result) throw new Error('Cindy Mermaid did not return a tool-result');
      return JSON.parse(JSON.stringify(result)) as CindyMessage;
    },
  };
}

describe('内置意识 Cindy Mermaid', () => {
  it('合法 flowchart 保持源码并返回可直接使用的 Mermaid Markdown', async () => {
    const source = 'flowchart TD\n  A[Start] --> B[End]';
    const result = await createMermaidHarness().submit(source);

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      source,
      markdown: `\`\`\`mermaid\n${source}\n\`\`\``,
      changed: false,
      validation: 'not-performed',
    });
    expect(result.result?.note).toContain('未调用 Mermaid 引擎');
  });

  it('一次修复常见 flowchart 机械语法问题', async () => {
    const source = [
      'flowchart TD',
      'subgraph Pub["发布侧"]',
      'CFG[仓内正本 config/client-endpoints.json] → OSS[OSS 桶]',
      'end',
      'OSS -->|CDN 公开读| CDN',
    ].join('\n');
    const expected = [
      'flowchart TD',
      'subgraph Pub ["发布侧"]',
      'CFG["仓内正本 config/client-endpoints.json"] --> OSS[OSS 桶]',
      'end',
      'OSS -->|"CDN 公开读"| CDN',
    ].join('\n');

    const result = await createMermaidHarness().submit(source);
    expect(result.ok).toBe(true);
    expect(result.result?.source).toBe(expected);
    expect(result.result?.changed).toBe(true);
  });

  it('只对非 flowchart 应用安全的通用注释修复', async () => {
    const source = 'erDiagram\n// relationship\nPERSON ||--o{ ORDER : places';
    const result = await createMermaidHarness().submit(source);

    expect(result.result?.source).toBe('erDiagram\n%% relationship\nPERSON ||--o{ ORDER : places');
  });

  it('规范化 BOM、CRLF、首尾空行并解包一层 Mermaid fence', async () => {
    const result = await createMermaidHarness().submit(
      '﻿  \r\n```mmd\r\n\r\nflowchart LR\r\nA → B\r\n\r\n```\r\n',
    );

    expect(result.ok).toBe(true);
    expect(result.result?.source).toBe('flowchart LR\nA --> B');
    expect(result.result?.markdown).toBe('```mermaid\nflowchart LR\nA --> B\n```');
  });

  it('源码含反引号时使用更长的安全 fence', async () => {
    const source = 'flowchart TD\nA["value ``` raw"] --> B';
    const result = await createMermaidHarness().submit(source);

    expect(result.result?.markdown).toBe(`\`\`\`\`mermaid\n${source}\n\`\`\`\``);
  });

  it.each([
    [undefined, 'INVALID_SOURCE'],
    [42, 'INVALID_SOURCE'],
    ['', 'INVALID_SOURCE'],
    ['flowchart TD\n' + 'x'.repeat(2001), 'LINE_TOO_LONG'],
    ['A\n'.repeat(50001), 'SOURCE_TOO_LARGE'],
  ])('拒绝非法或过大的 source %#', async (source, code) => {
    const result = await createMermaidHarness().submit(source);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(code);
  });

  it('未知工具返回稳定错误', async () => {
    const result = await createMermaidHarness().submit('flowchart TD\nA --> B', 'validate_mermaid');
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('UNKNOWN_TOOL');
  });
});
