import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const plugin = new URL('../desktop-emotes/', import.meta.url);
const source = name => readFileSync(new URL(name, plugin), 'utf8');
const library = require('../desktop-emotes/emote-library.js');
const { validateConfig, migrateConfig } = require('../desktop-emotes/node/config.cjs');
const defaults = () => migrateConfig(library.defaults('en'));
const clone = value => structuredClone(value);
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const sendEmote = (config = defaults()) => ({ ...config.emotes[0], action: 'existing', prompt: 'Inspect this example.',
  target: { mode: 'fixed', ref: { kind: 'task', id: 'fixture-task' }, label: 'Example task' }, delivery: 'queue' });

function clockedScheduler(capture = async () => ({ text: 'example' })) {
  let now = 0, next = 0;
  const timers = new Map(), events = [];
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ module: { exports: {} }, require, structuredClone, Date: Clock,
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id) });
  vm.runInContext(source('node/scheduler.cjs'), context);
  const scheduler = new context.module.exports.LatestAction({ capture, notify: (kind, data) => events.push({ kind, ...data }) });
  return { scheduler, events, async tick(ms) {
    const until = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry; now = timer.at; timers.delete(id); timer.fn(); await settle();
    }
    now = until; await settle();
  } };
}

async function host({ saved = {}, send, cancel, list, capabilities, failWrite = () => false } = {}) {
  let stored = clone(saved), handler;
  const writes = [], calls = [], events = [];
  const snapshot = { capturedAt: 1000, text: 'fixture-window-text', jpeg: 'ZmFrZS1pbWFnZQ==',
    source: { target: { windowId: 1, app: 'Example', title: 'Example window' }, point: { x: 10, y: 20 } }, issues: [] };
  const info = { operations: ['create', 'get', 'list', 'send', 'getRun', 'cancel', 'models', 'setModel'], messageAttachments: { kinds: ['image'] } };
  const context = vm.createContext({ TextEncoder, console,
    BroadcastChannel: class { postMessage(value) { events.push(clone(value)); } },
    fetch: async (url, options) => {
      assert.equal(url, '/kv');
      if (options?.method === 'PUT') {
        if (failWrite()) return { ok: false };
        stored = JSON.parse(options.body); writes.push(clone(stored));
      }
      return { ok: true, json: async () => clone(stored) };
    },
    cindy: {
      request: async () => ({ context: { locale: 'en' } }),
      onHostMessage: fn => { handler = fn; }, send: async () => {},
      node: { request: async ({ method, params }) => {
        calls.push({ method, params: clone(params) });
        const result = (() => {
          switch (method) {
            case 'defaults': return library.defaults(params.locale);
            case 'validate': return validateConfig(params);
            case 'migrate': return migrateConfig(params);
            case 'configRevision': return { revision: revision(params) };
            case 'configure': return { enabled: params.runtimeEnabled !== false, issues: [] };
            case 'status': return { enabled: true, permissions: {}, issues: [] };
            case 'current': return { current: true };
            case 'readSnapshot': return clone(snapshot);
            case 'wheelTargets': return { current: true };
            case 'resolveTarget': return { current: true };
            default: throw new Error(`Unexpected node method: ${method}`);
          }
        })();
        return { ok: true, result: clone(result) };
      } },
      tasks: { capabilities: async () => capabilities || info, models: async () => ({ models: [] }) },
      targets: {
        list: async params => list ? list(params) : { targets: [] },
        resolve: async ({ target }) => ({ ...target, label: 'Example', detail: '' }),
        send: async params => { calls.push({ method: 'send', params: clone(params) }); return send ? send(params) : { taskId: 'fixture-task', accepted: true, delivery: params.delivery }; },
        cancel: async params => { calls.push({ method: 'cancel', params: clone(params) }); return cancel ? cancel(params) : { cancelled: true, runningWorkMayHaveStarted: true }; },
      },
    },
  });
  vm.runInContext(source('main.js') + '\nglobalThis.api = { boot, queueSetting, dispatch, invalidate, capabilities, inspect: () => ({state, recovered, outcome}), drained: () => dispatchQueue };', context);
  await context.api.boot;
  await context.api.capabilities();
  return { api: context.api, calls, writes, events, snapshot, stored: () => clone(stored),
    event: params => handler({ type: 'event', name: 'node-notification', method: 'emote/event', params }) };
}

test('defaults have four display-only emotes, a distinct undo image and Command+G', () => {
  const config = defaults();
  assert.equal(config.emotes.length, 4);
  assert.deepEqual(config.wheelShortcut, { code: 'KeyG', modifiers: 8 });
  for (const emote of config.emotes) { assert.equal(emote.action, 'none'); assert.equal(emote.prompt, ''); }
  assert.equal(config.emotes[3].id, 'ping-undo');
  for (const preset of library.presets()) assert.ok(readFileSync(new URL(preset.imagePath, plugin)).length);
});

test('old built-in image paths migrate without changing user instructions, targets or pinned positions', () => {
  const config = defaults();
  config.emotes[0] = { ...sendEmote(config), imagePath: 'assets/emotes/help.png', pinAngle: 0 };
  config.emotes[1].imagePath = '/example.test/custom.png';
  config.emotes[3].action = 'undo';
  const next = migrateConfig(config);
  assert.deepEqual(next.emotes[0], { ...config.emotes[0], imagePath: 'assets/emotes/help.webp' });
  assert.equal(next.emotes[1].imagePath, '/example.test/custom.png');
  assert.equal(next.emotes[3].action, 'none');
  assert.equal(next.emotes[3].imagePath, config.emotes[3].imagePath);
});

test('invalid prompt, target kind, pin angle and duplicate slots are rejected', () => {
  for (const mutate of [
    config => { config.emotes[0] = { ...sendEmote(config), prompt: ' ' }; },
    config => { config.emotes[0] = { ...sendEmote(config), target: { mode: 'fixed', ref: { kind: 'bot', id: 'fixture' } } }; },
    config => { config.emotes[0].pinAngle = 15; },
    config => { config.emotes[1].angle = 0; },
    config => { config.emotes.pop(); },
  ]) { const config = defaults(); mutate(config); assert.throws(() => validateConfig(config), /CONFIG_INVALID/); }
});

test('display-only emotes never capture; an action waits the full two seconds', async () => {
  let count = 0;
  const { scheduler, events, tick } = clockedScheduler(async () => { count++; return { text: 'example' }; });
  scheduler.trigger({}, defaults().emotes[0]); await tick(5000); assert.equal(count, 0);
  scheduler.trigger({}, { ...sendEmote(), target: undefined });
  await tick(1999); assert.equal(count, 0);
  await tick(1); assert.equal(count, 1);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 1);
});

test('a display-only emote at 1999ms cancels the old action and drops late captures', async () => {
  const capture = deferred();
  const { scheduler, events, tick } = clockedScheduler(() => capture.promise);
  scheduler.trigger({}, { ...sendEmote(), target: undefined }); await tick(1999);
  scheduler.trigger({}, defaults().emotes[3]); await tick(5000);
  assert.equal(events.filter(event => event.kind === 'capturing').length, 0);
  scheduler.trigger({}, { ...sendEmote(), target: undefined }); await tick(2000);
  scheduler.trigger({}, defaults().emotes[1]); capture.resolve({ text: 'late material' }); await settle();
  assert.equal(scheduler.snapshot, null);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 0);
});

test('destination selection and delay must both complete; stale or duplicate callbacks cannot send', async () => {
  const { scheduler, events, tick } = clockedScheduler();
  scheduler.trigger({}, sendEmote()); const old = scheduler.current.id;
  await tick(2000); assert.equal(events.filter(event => event.kind === 'prepared').length, 0);
  scheduler.trigger({}, sendEmote()); const id = scheduler.current.id;
  scheduler.resolveTarget(old, { kind: 'task', id: 'wrong' });
  scheduler.resolveTarget(id, { kind: 'task', id: 'fixture-task' }); await tick(1999);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 0);
  await tick(1); scheduler.resolveTarget(id, { kind: 'task', id: 'wrong' }); await settle();
  assert.equal(events.filter(event => event.kind === 'prepared').length, 1);
  assert.equal(events.find(event => event.kind === 'prepared').target.id, 'fixture-task');
});

test('settings and Agent writes share revision checks before any native or state mutation', async () => {
  const h = await host();
  const initial = await h.api.queueSetting('load');
  const changed = clone(initial.config); changed.emotes[0].label = 'Agent label';
  const next = await h.api.queueSetting('configure', { config: changed, revision: initial.revision });
  assert.notEqual(next.revision, initial.revision);
  const count = h.calls.length;
  await assert.rejects(h.api.queueSetting('save', { config: initial.config, revision: initial.revision }), /STALE_REVISION/);
  assert.deepEqual(h.calls.slice(count).map(call => call.method), ['configRevision']);
  const latest = await h.api.queueSetting('load');
  assert.equal(latest.config.emotes[0].label, 'Agent label');
  const uiEdit = clone(latest.config); uiEdit.emotes[1].label = 'UI label';
  await h.api.queueSetting('save', { config: uiEdit, revision: latest.revision });
  await assert.rejects(h.api.queueSetting('configure', { config: changed, revision: next.revision }), /STALE_REVISION/);
  assert.equal(h.stored().config.emotes[1].label, 'UI label');
  assert.equal(h.calls.some(call => call.method === 'send'), false);
});

test('failed settings persistence restores the previous config and native runtime', async () => {
  let fail = false;
  const h = await host({ failWrite: () => fail });
  const initial = await h.api.queueSetting('load');
  const next = clone(initial.config); next.emotes[0].label = 'Unsaved'; fail = true;
  await assert.rejects(h.api.queueSetting('save', { config: next, revision: initial.revision }), /SAVE_FAILED/);
  assert.deepEqual(clone(h.api.inspect().state.config), initial.config);
  assert.equal(h.calls.filter(call => call.method === 'configure').at(-1).params.emotes[0].label, initial.config.emotes[0].label);
});

test('delivery uses image attachments, requested queue/steer and no window content in KV', async () => {
  for (const delivery of ['queue', 'steer']) {
    const h = await host(); const emote = { ...sendEmote(), delivery };
    h.api.invalidate(delivery); await h.api.dispatch({ id: delivery, emote, target: emote.target.ref });
    const sent = h.calls.find(call => call.method === 'send').params;
    assert.equal(sent.delivery, delivery); assert.deepEqual(sent.target, emote.target.ref);
    assert.deepEqual(sent.attachments, [{ name: 'window.jpg', base64: h.snapshot.jpeg }]);
    assert.ok(sent.text.includes(h.snapshot.text)); assert.equal('route' in sent, false);
    assert.equal(JSON.stringify(h.writes).includes(h.snapshot.text), false);
    assert.equal(JSON.stringify(h.writes).includes(h.snapshot.jpeg), false);
    assert.equal(h.stored().pending, null);
  }
});

test('missing image capability never silently drops an available screenshot', async () => {
  const h = await host({ capabilities: { operations: ['create', 'get', 'list', 'send', 'getRun', 'cancel'] } });
  const emote = sendEmote(); h.api.invalidate('image');
  await assert.rejects(h.api.dispatch({ id: 'image', emote, target: emote.target.ref }), /ATTACHMENTS_UNSUPPORTED/);
  assert.equal(h.calls.some(call => call.method === 'send'), false); assert.equal(h.stored().pending, null);
});

test('late receipts withdraw only the old input and do not report the newer emote as sent', async () => {
  const entered = deferred(), receipt = deferred();
  const h = await host({ send: () => { entered.resolve(); return receipt.promise; } });
  const emote = sendEmote(); h.api.invalidate('old');
  const dispatch = h.api.dispatch({ id: 'old', emote, target: emote.target.ref }); await entered.promise;
  h.api.invalidate('display-only'); await settle();
  receipt.resolve({ taskId: 'fixture-task', accepted: true, delivery: 'queue' }); await dispatch;
  assert.ok(h.calls.filter(call => call.method === 'cancel').every(call => call.params.requestKey === 'old'));
  assert.equal(h.events.some(event => event.outcome?.phase === 'sent'), false);
});

test('uncertain sends stay paused across withdrawal, restart and subsequent triggers until acknowledged', async () => {
  const entered = deferred(), receipt = deferred();
  const h = await host({ send: () => { entered.resolve(); return receipt.promise; } });
  const emote = sendEmote(); h.api.invalidate('uncertain');
  const dispatch = h.api.dispatch({ id: 'uncertain', emote, target: emote.target.ref }); await entered.promise;
  h.api.invalidate('display-only'); await settle();
  receipt.reject(new Error('DELIVERY_UNCERTAIN')); await assert.rejects(dispatch, /DELIVERY_UNCERTAIN/);
  assert.equal(h.stored().pending.id, 'uncertain');
  h.api.invalidate('display-again'); await settle(); assert.equal(h.stored().pending.id, 'uncertain');
  const restarted = await host({ saved: h.stored() });
  restarted.api.invalidate('new');
  await assert.rejects(restarted.api.dispatch({ id: 'new', emote, target: emote.target.ref }), /CHECK_PREVIOUS_TASK/);
  assert.equal(restarted.calls.some(call => call.method === 'send'), false);
  const status = await restarted.api.queueSetting('reviewed'); assert.equal(status.needsReview, false);
  assert.equal(restarted.stored().pending, null);
});

test('a definite delivery rejection is not retried and does not become an uncertain send', async () => {
  const h = await host({ send: async () => { throw new Error('DELIVERY_REJECTED'); } });
  const emote = sendEmote(); h.api.invalidate('rejected');
  await assert.rejects(h.api.dispatch({ id: 'rejected', emote, target: emote.target.ref }), /DELIVERY_REJECTED/);
  assert.equal(h.calls.filter(call => call.method === 'send').length, 1);
  assert.equal(h.api.inspect().recovered, false); assert.equal(h.stored().pending, null);
});

test('recent destinations are limited to three and a closed wheel ignores a late catalog', async () => {
  const config = defaults(); config.emotes[0] = { ...sendEmote(config), target: { mode: 'recent' } };
  const result = deferred(); const h = await host({ saved: { config }, list: () => result.promise });
  await h.event({ kind: 'wheel-open', gestureId: 'closed', configRevision: 'example' });
  await h.event({ kind: 'wheel-closed', gestureId: 'closed' });
  const targets = Array.from({ length: 5 }, (_, i) => ({ kind: 'task', id: `task-${i}`, label: `Task ${i}`, detail: '' }));
  result.resolve({ targets }); await settle();
  assert.equal(h.calls.some(call => call.method === 'wheelTargets'), false);
  await h.event({ kind: 'wheel-open', gestureId: 'current', configRevision: 'example' }); await settle();
  const catalog = h.calls.find(call => call.method === 'wheelTargets').params;
  assert.equal(catalog.gestureId, 'current'); assert.deepEqual(catalog.catalogs.task, targets.slice(0, 3));
});
