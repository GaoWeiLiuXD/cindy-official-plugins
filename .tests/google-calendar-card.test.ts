import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type HostMessageHandler = (message: Record<string, unknown>) => Promise<void>;

interface CindyMessage {
  type: string;
  callId?: string;
  ok?: boolean;
  html?: string;
  height?: number;
  kind?: string;
  url?: string;
  message?: string;
}

const calendarSource = readFileSync(
  new URL('../google-calendar/main.js', import.meta.url),
  'utf8',
);

const manifest = JSON.parse(
  readFileSync(new URL('../google-calendar/ghost.json', import.meta.url), 'utf8'),
) as {
  slots: string[];
  network: { secrets: Array<{ url?: string; oauth?: { clientSecret?: string } }> };
};

function createCalendarHarness(apiBody: unknown, status = 200) {
  let handler: HostMessageHandler | undefined;
  const messages: CindyMessage[] = [];
  const cindy = {
    onHostMessage: vi.fn((nextHandler: HostMessageHandler) => {
      handler = nextHandler;
    }),
    send: vi.fn(async (message: CindyMessage) => {
      messages.push(message);
      return { ok: true };
    }),
    fetch: vi.fn(async () => ({
      ok: true,
      status,
      body: JSON.stringify(apiBody),
      headers: {},
    })),
  };

  new Script(calendarSource, {
    filename: 'builtin-ghosts/official/google-calendar/main.js',
  }).runInContext(
    createContext({
      cindy,
      fetch: vi.fn(),
      Intl,
      Date,
      isNaN,
      isFinite,
      encodeURIComponent,
    }),
  );

  if (!handler) throw new Error('Google Calendar did not register its host-message handler');
  return { handler, messages };
}

describe('Google Calendar 自绘卡', () => {
  it('身份卡声明 card 槽和系统浏览器目标 URL', () => {
    expect(manifest.slots).toContain('card');
    expect(manifest.network.secrets.some((secret) => secret.url === 'https://calendar.google.com/')).toBe(true);
    expect(manifest.network.secrets[0]?.oauth?.clientSecret).toBeTruthy();
  });

  it('事件列表先发送 Apple 风格 card-update,再发送 tool-result', async () => {
    const harness = createCalendarHarness({
      items: [
        {
          id: 'evt-1',
          summary: '产品评审',
          start: { dateTime: '2026-07-24T10:00:00+08:00' },
          end: { dateTime: '2026-07-24T11:00:00+08:00' },
          attendees: [{ email: 'a@example.com' }],
        },
      ],
    });

    await harness.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-1',
      args: { action: 'list_events' },
    });

    expect(harness.messages.map((message) => message.type)).toEqual(['card-update', 'tool-result']);
    const card = harness.messages[0];
    expect(card.html).toContain('class="gc-card"');
    expect(card.html).toContain('产品评审');
    expect(card.html).toContain('data-ghost-action="open-calendar"');
    expect(card.html).toContain('-apple-system');
    expect(card.height).toBeGreaterThanOrEqual(220);
    expect(card.height).toBeLessThanOrEqual(560);
  });

  it('动态日程文本会转义,空结果和 API 错误也有明确卡片', async () => {
    const escaped = createCalendarHarness({
      items: [
        {
          id: 'evt-x',
          summary: '<script>alert("x")</script>',
          start: { date: '2026-07-25' },
          end: { date: '2026-07-26' },
        },
      ],
    });
    await escaped.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-x',
      args: { action: 'list_events' },
    });
    expect(escaped.messages[0].html).toContain('&lt;script&gt;');
    expect(escaped.messages[0].html).not.toContain('<script>alert');

    const empty = createCalendarHarness({ items: [] });
    await empty.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-empty',
      args: { action: 'list_events' },
    });
    expect(empty.messages[0].html).toContain('这段时间没有安排');

    const failed = createCalendarHarness({ error: { message: 'Quota exceeded' } }, 429);
    await failed.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-fail',
      args: { action: 'list_events' },
    });
    expect(failed.messages.map((message) => message.type)).toEqual(['card-update', 'tool-result']);
    expect(failed.messages[0].html).toContain('需要处理');
    expect(failed.messages[1].ok).toBe(false);
  });

  it('旧宿主回传 open-calendar 动作时请求打开已声明外链', async () => {
    const harness = createCalendarHarness({ items: [] });

    await harness.handler({
      type: 'event',
      name: 'card-action',
      callId: 'call-1',
      actionId: 'open-calendar',
    });

    expect(harness.messages).toEqual([
      {
        type: 'host-request',
        kind: 'open-external',
        url: 'https://calendar.google.com/',
      },
    ]);
  });
});
