import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type HostMessageHandler = (message: Record<string, unknown>) => Promise<void>;

interface CindyFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface CindyFetchResponse {
  ok: boolean;
  status: number;
  body?: string;
  message?: string;
  headers?: Record<string, string>;
}

interface CindyMessage {
  type: string;
  ok?: boolean;
  errorCode?: string;
  result?: Record<string, unknown>;
  message?: string;
}

const notionSource = readFileSync(
  new URL('../cindy-notion/main.js', import.meta.url),
  'utf8',
);

class FakeBroadcastChannel {
  onmessage?: (event: { data?: unknown }) => void;

  postMessage(): void {}
}

function jsonResponse(data: unknown, status = 200): CindyFetchResponse {
  return {
    ok: true,
    status,
    body: JSON.stringify(data),
    headers: {},
  };
}

function createNotionHarness(
  respond: (request: CindyFetchRequest) => CindyFetchResponse | Promise<CindyFetchResponse>,
) {
  let handler: HostMessageHandler | undefined;
  const requests: CindyFetchRequest[] = [];
  const messages: CindyMessage[] = [];
  const cindy = {
    onHostMessage: vi.fn((nextHandler: HostMessageHandler) => {
      handler = nextHandler;
    }),
    send: vi.fn((message: CindyMessage) => {
      messages.push(message);
      if (message.type === 'fs-request') {
        return Promise.resolve({ ok: false, message: 'test harness does not write files' });
      }
      return Promise.resolve({ ok: true });
    }),
    fetch: vi.fn(async (request: CindyFetchRequest) => {
      requests.push(request);
      return respond(request);
    }),
  };

  new Script(notionSource, {
    filename: 'builtin-ghosts/official/cindy-notion/main.js',
  }).runInContext(
    createContext({
      cindy,
      BroadcastChannel: FakeBroadcastChannel,
      fetch: vi.fn(),
      setTimeout,
      clearTimeout,
      Number,
      Object,
      Array,
      String,
      Boolean,
      JSON,
      Math,
      Date,
      RegExp,
      encodeURIComponent,
      decodeURIComponent,
    }),
  );

  if (!handler) throw new Error('Cindy Notion did not register its host-message handler');

  return {
    requests,
    async call(tool: string, args: Record<string, unknown> = {}): Promise<CindyMessage> {
      messages.length = 0;
      await handler!({
        type: 'tool-call',
        tool,
        callId: 'call-12345678',
        args,
      });
      const result = messages.findLast((message) => message.type === 'tool-result');
      if (!result) throw new Error(`Cindy Notion did not return a result for ${tool}`);
      return JSON.parse(JSON.stringify(result)) as CindyMessage;
    },
  };
}

describe('Cindy Notion', () => {
  it('验证连接时调用 /users/me 并使用 data source 版 API header', async () => {
    const harness = createNotionHarness((request) => {
      if (request.url === 'https://api.notion.com/v1/users/me') {
        return jsonResponse({
          id: 'bot-id',
          name: 'Cindy Bot',
          type: 'bot',
          bot: { workspace_name: 'Acme Workspace' },
        });
      }
      if (request.url === 'https://api.notion.com/v1/search') {
        return jsonResponse({
          results: [{
            object: 'page',
            id: 'page-id',
            properties: {
              title: {
                type: 'title',
                title: [{ plain_text: 'Roadmap' }],
              },
            },
          }],
          has_more: false,
        });
      }
      throw new Error(`unexpected request: ${request.url}`);
    });

    const result = await harness.call('notion_status');

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({
      connected: true,
      bot: {
        id: 'bot-id',
        name: 'Cindy Bot',
        type: 'bot',
        workspace_name: 'Acme Workspace',
      },
      visible_content: {
        check_ok: true,
        visible_count_in_first_page: 1,
        has_more: false,
        samples: [{
          id: 'page-id',
          object: 'page',
          title: 'Roadmap',
        }],
        authorization_required: false,
        guidance: 'Token 与页面授权均正常。',
      },
    });
    expect(harness.requests[0].headers).toMatchObject({
      Accept: 'application/json',
      'Notion-Version': '2025-09-03',
    });
    expect(harness.requests).toHaveLength(2);
  });

  it('搜索请求正确构造 filter、sort 和 cursor', async () => {
    const harness = createNotionHarness(() =>
      jsonResponse({ results: [], has_more: false, next_cursor: null }),
    );

    const result = await harness.call('notion_search', {
      query: 'Roadmap',
      object_type: 'page',
      sort_direction: 'ascending',
      page_size: 25,
      cursor: 'next-page',
    });

    expect(result.ok).toBe(true);
    expect(harness.requests).toHaveLength(1);
    expect(JSON.parse(harness.requests[0].body ?? '{}')).toEqual({
      page_size: 25,
      sort: {
        direction: 'ascending',
        timestamp: 'last_edited_time',
      },
      query: 'Roadmap',
      filter: {
        property: 'object',
        value: 'page',
      },
      start_cursor: 'next-page',
    });
  });

  it('无关键词搜索为空时返回明确的页面授权诊断', async () => {
    const harness = createNotionHarness(() =>
      jsonResponse({ results: [], has_more: false, next_cursor: null }),
    );

    const result = await harness.call('notion_search');

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      authorization_diagnostic: {
        request_authenticated: true,
        message: expect.stringContaining('Content access'),
      },
    });
  });

  it('读取 page 时同时取元数据和 2026-03-11 Markdown', async () => {
    const id = '12345678-1234-1234-1234-1234567890ab';
    const harness = createNotionHarness((request) => {
      if (request.url.endsWith(`/pages/${id}`)) {
        return jsonResponse({ object: 'page', id, properties: {} });
      }
      if (request.url.endsWith(`/pages/${id}/markdown?include_transcript=true`)) {
        return jsonResponse({ object: 'page_markdown', id, markdown: '# Hello' });
      }
      throw new Error(`unexpected request: ${request.url}`);
    });

    const result = await harness.call('notion_fetch', {
      id: `https://www.notion.so/Hello-${id.replaceAll('-', '')}`,
      object_type: 'page',
      include_transcript: true,
    });

    expect(result.ok).toBe(true);
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[0].headers?.['Notion-Version']).toBe('2025-09-03');
    expect(harness.requests[1].headers?.['Notion-Version']).toBe('2026-03-11');
    expect(result.result).toMatchObject({
      content_format: 'markdown',
      content: { markdown: '# Hello' },
    });
  });

  it('在 data source 建页前先读 schema，并自动填写 title 与 Markdown blocks', async () => {
    const dataSourceId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const harness = createNotionHarness((request) => {
      if (request.url.endsWith(`/data_sources/${dataSourceId}`)) {
        return jsonResponse({
          id: dataSourceId,
          properties: {
            Name: { id: 'title', type: 'title' },
            Status: { id: 'status', type: 'status' },
          },
        });
      }
      if (request.url.endsWith('/pages') && request.method === 'POST') {
        return jsonResponse({ object: 'page', id: 'new-page-id' });
      }
      throw new Error(`unexpected request: ${request.url}`);
    });

    const result = await harness.call('notion_create_page', {
      parent_id: dataSourceId,
      parent_type: 'data_source',
      title: 'Launch Plan',
      properties: {
        Status: { status: { name: 'Draft' } },
      },
      markdown: '# Goal\n\n- Ship Cindy Notion',
    });

    expect(result.ok).toBe(true);
    expect(harness.requests.map((request) => request.method ?? 'GET')).toEqual([
      'GET',
      'POST',
    ]);
    const body = JSON.parse(harness.requests[1].body ?? '{}');
    expect(body.parent).toEqual({
      type: 'data_source_id',
      data_source_id: dataSourceId,
    });
    expect(body.properties.Name.title[0].text.content).toBe('Launch Plan');
    expect(body.properties.Status).toEqual({ status: { name: 'Draft' } });
    expect(body.children.map((block: { type: string }) => block.type)).toEqual([
      'heading_1',
      'bulleted_list_item',
    ]);
  });

  it('整页覆盖未确认时拒绝，且不发出任何 API 请求', async () => {
    const harness = createNotionHarness(() => {
      throw new Error('request should not happen');
    });

    const result = await harness.call('notion_update_page', {
      page_id: '12345678-1234-1234-1234-1234567890ab',
      replace_markdown: '# New content',
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('CONFIRM_REQUIRED');
    expect(result.message).toContain('confirm:true');
    expect(harness.requests).toHaveLength(0);
  });

  it('确认后用 2026-03-11 Markdown endpoint 覆盖正文', async () => {
    const id = '12345678-1234-1234-1234-1234567890ab';
    const harness = createNotionHarness((request) => {
      expect(request.url).toBe(`https://api.notion.com/v1/pages/${id}/markdown`);
      return jsonResponse({ object: 'page_markdown', id, markdown: '# New content' });
    });

    const result = await harness.call('notion_update_page', {
      page_id: id,
      replace_markdown: '# New content',
      confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(harness.requests[0].method).toBe('PATCH');
    expect(harness.requests[0].headers?.['Notion-Version']).toBe('2026-03-11');
    expect(JSON.parse(harness.requests[0].body ?? '{}')).toEqual({
      type: 'replace_content',
      replace_content: {
        new_str: '# New content',
        allow_deleting_content: false,
      },
    });
  });

  it('追加 Markdown 使用 block children API 且不覆盖现有内容', async () => {
    const id = '12345678-1234-1234-1234-1234567890ab';
    const harness = createNotionHarness(() =>
      jsonResponse({ object: 'list', results: [] }),
    );

    const result = await harness.call('notion_append_content', {
      block_id: id,
      markdown: '- [x] Checked\n\n```js\nconsole.log("ok")\n```',
    });

    expect(result.ok).toBe(true);
    expect(harness.requests[0].url).toBe(
      `https://api.notion.com/v1/blocks/${id}/children`,
    );
    expect(harness.requests[0].method).toBe('PATCH');
    const body = JSON.parse(harness.requests[0].body ?? '{}');
    expect(body.children.map((block: { type: string }) => block.type)).toEqual([
      'to_do',
      'code',
    ]);
    expect(body.children[1].code.language).toBe('javascript');
  });

  it('401 错误映射为可执行的重新连接指引', async () => {
    const harness = createNotionHarness(() =>
      jsonResponse({ object: 'error', message: 'API token is invalid.' }, 401),
    );

    const result = await harness.call('notion_status');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('重新连接');
    expect(result.message).not.toContain('API token is invalid');
  });
});
