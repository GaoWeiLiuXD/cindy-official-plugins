import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';

import adapter from '../taptap-maker/node/child-process-adapter.cjs';
import rootRouterModule from '../taptap-maker/node/mcp-root-router.cjs';

const pluginRoot = new URL('../taptap-maker/', import.meta.url);
const mainSource = readFileSync(new URL('main.js', pluginRoot), 'utf8');
const accountSource = readFileSync(new URL('node/account.cjs', pluginRoot), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('ghost.json', pluginRoot), 'utf8'));
const provisioning = JSON.parse(readFileSync(new URL('../provisioning.json', import.meta.url), 'utf8'));
const vendorPackage = JSON.parse(
  readFileSync(new URL('vendor/taptap-maker/package.json', pluginRoot), 'utf8'),
);
const requireFromTest = createRequire(import.meta.url);

class FakeBroadcastChannel {
  static instances = [];

  constructor(name) {
    this.name = name;
    this.messages = [];
    this.onmessage = null;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
  }
}

function createMainHarness(nodeResponder) {
  FakeBroadcastChannel.instances.length = 0;
  const nodeRequests = [];
  const previewRequests = [];
  const pickRequests = [];
  const sentMessages = [];
  let handler;
  let resolveToolResult;

  const cindy = {
    node: {
      request: async (request) => {
        nodeRequests.push(request);
        return nodeResponder(request);
      },
    },
    preview: async (request) => {
      previewRequests.push(request);
      return { ok: true };
    },
    pick: async (request) => {
      pickRequests.push(request);
      return { ok: true, path: '/tmp/maker-projects' };
    },
    onHostMessage(nextHandler) {
      handler = nextHandler;
    },
    async send(message) {
      sentMessages.push(message);
      if (message.type === 'tool-result' && resolveToolResult) {
        const resolve = resolveToolResult;
        resolveToolResult = null;
        resolve(message);
      }
    },
  };

  new Script(mainSource, { filename: 'taptap-maker/main.js' }).runInContext(
    createContext({
      BroadcastChannel: FakeBroadcastChannel,
      URL,
      cindy,
      fetch: async () => ({ ok: true }),
      setTimeout: () => 1,
    }),
  );
  assert.equal(typeof handler, 'function');

  return {
    nodeRequests,
    previewRequests,
    pickRequests,
    sentMessages,
    settingsChannel: FakeBroadcastChannel.instances[0],
    call(tool, args = {}) {
      return new Promise((resolve) => {
        resolveToolResult = resolve;
        handler({
          type: 'tool-call',
          tool,
          callId: `call-${tool}`,
          args,
        });
      });
    },
  };
}

function fakeChildHandle() {
  const events = new EventEmitter();
  return {
    pid: 123,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
    on: events.on.bind(events),
    once: events.once.bind(events),
    off: events.off.bind(events),
    emit: events.emit.bind(events),
  };
}

function loadAccountInternals() {
  const readline = {
    createInterface() {
      return { on() {} };
    },
  };
  const context = createContext({
    Buffer,
    clearInterval,
    clearTimeout,
    process,
    require(id) {
      if (id === 'node:readline') return readline;
      if (id === './child-process-adapter.cjs') return adapter;
      return requireFromTest(id);
    },
    setInterval,
    setTimeout,
  });
  new Script(
    `${accountSource}\nglobalThis.__accountInternals = { ensureTargetAvailable, projectDirectoryName };`,
    { filename: 'taptap-maker/node/account.cjs' },
  ).runInContext(context);
  return context.__accountInternals;
}

test('manifest、默认播种和官方 Runtime 版本保持一致', () => {
  assert.equal(manifest.id, 'taptap-maker');
  assert.equal(manifest.author, 'Cindy');
  assert.deepEqual(manifest.slots, ['tool', 'card', 'node', 'session-context', 'pick', 'preview']);
  assert.deepEqual(manifest.card, { externalLinks: true });
  assert.deepEqual(manifest.node.entries, ['node/account.cjs', 'node/maker-child.cjs']);
  assert.equal(manifest.node.childSpawn, true);
  assert.deepEqual(manifest.preview.hosts, ['maker.taptap.cn']);
  assert.deepEqual(provisioning.ghosts['taptap-maker'], { audience: 'all' });
  assert.equal(vendorPackage.name, '@taptap/maker');
  assert.equal(vendorPackage.version, '0.0.24');
});

test('项目目录名跨批次稳定，并用 project id 区分清洗后同名项目', () => {
  const { projectDirectoryName } = loadAccountInternals();
  const first = projectDirectoryName({ id: 'project-a', name: '同名 / 项目' });
  const firstAgain = projectDirectoryName({ id: 'project-a', name: '同名 / 项目' });
  const second = projectDirectoryName({ id: 'project-b', name: '同名 / 项目' });

  assert.equal(first, firstAgain);
  assert.notEqual(first.toLocaleLowerCase(), second.toLocaleLowerCase());
  assert.match(first, /^同名 - 项目-[a-f0-9]{16}$/);
  assert.match(second, /^同名 - 项目-[a-f0-9]{16}$/);

  const longName = projectDirectoryName({
    id: 'project-long',
    name: `${'a'.repeat(62)}. ${'b'.repeat(20)}`,
  });
  assert.ok(longName.length <= 80);
  assert.match(longName, /^[^. ]+-[a-f0-9]{16}$/);
});

test('项目目标只允许空目录或同一 Maker 项目的安全重试', async (t) => {
  const { ensureTargetAvailable } = loadAccountInternals();
  const root = await mkdtemp(path.join(os.tmpdir(), 'cindy-maker-target-'));
  t.after(() => rm(root, { force: true, recursive: true }));

  const empty = path.join(root, 'empty');
  await mkdir(empty);
  await assert.doesNotReject(ensureTargetAvailable(empty, 'project-a'));

  const unrelated = path.join(root, 'unrelated');
  await mkdir(unrelated);
  await writeFile(path.join(unrelated, 'local-change.txt'), 'keep');
  await assert.rejects(
    ensureTargetAvailable(unrelated, 'project-a'),
    /目标目录已被其他内容占用/,
  );

  const bound = path.join(root, 'bound');
  await mkdir(path.join(bound, '.maker-mcp'), { recursive: true });
  await writeFile(
    path.join(bound, '.maker-mcp', 'config.json'),
    JSON.stringify({ project_id: 'project-a' }),
  );
  await writeFile(path.join(bound, 'local-change.txt'), 'keep');
  await assert.rejects(
    ensureTargetAvailable(bound, 'project-a'),
    /目标目录已被其他内容占用/,
  );
  await assert.rejects(
    ensureTargetAvailable(bound, 'project-b'),
    /目标目录已被其他内容占用/,
  );

  const makerRepo = path.join(root, 'maker-repo');
  await mkdir(path.join(makerRepo, '.maker-mcp'), { recursive: true });
  await mkdir(path.join(makerRepo, '.git'), { recursive: true });
  await writeFile(
    path.join(makerRepo, '.maker-mcp', 'config.json'),
    JSON.stringify({ project_id: 'project-a' }),
  );
  await writeFile(
    path.join(makerRepo, '.git', 'config'),
    [
      '[remote "origin"]',
      '\turl = https://git:secret@maker.taptap.cn/git/project-a.git',
    ].join('\n'),
  );
  await assert.doesNotReject(ensureTargetAvailable(makerRepo, 'project-a'));

  const noOrigin = path.join(root, 'no-origin');
  await mkdir(path.join(noOrigin, '.maker-mcp'), { recursive: true });
  await mkdir(path.join(noOrigin, '.git'), { recursive: true });
  await writeFile(
    path.join(noOrigin, '.maker-mcp', 'config.json'),
    JSON.stringify({ project_id: 'project-a' }),
  );
  await writeFile(path.join(noOrigin, '.git', 'config'), '[core]\n\tbare = false\n');
  await assert.rejects(
    ensureTargetAvailable(noOrigin, 'project-a'),
    /目标目录已被其他内容占用/,
  );

  for (const origin of [
    'https://maker.taptap.cn/git/project-b.git',
    'https://github.com/example/project-a.git',
  ]) {
    await writeFile(
      path.join(makerRepo, '.git', 'config'),
      `[remote "origin"]\n\turl = ${origin}\n`,
    );
    await assert.rejects(
      ensureTargetAvailable(makerRepo, 'project-a'),
      /目标目录已被其他内容占用/,
    );
  }

  const occupied = path.join(root, 'occupied');
  await writeFile(occupied, 'not a directory');
  await assert.rejects(ensureTargetAvailable(occupied, 'project-a'), /目标路径已被占用/);
});

test('主工具只使用宿主注入的本地 workdir，并为长构建开启续命与右侧预览', async () => {
  const buildResult = {
    content: [{
      type: 'text',
      text: '- maker_url: https://maker.taptap.cn/app/demo?localDev=1',
    }],
  };
  const harness = createMainHarness(async (request) => {
    if (request.entry === 'node/account.cjs') {
      return {
        ok: true,
        result: { structuredContent: { ok: true } },
      };
    }
    return { ok: true, result: buildResult };
  });

  const init = await harness.call('maker_init', {
    app_id: 'app-1',
    workdir: '/tmp/untrusted',
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
      session_id: 'session-1',
    },
  });
  assert.equal(init.ok, true);
  assert.equal(
    harness.nodeRequests[0].params.arguments.workdir,
    '/tmp/trusted-maker',
  );

  const build = await harness.call('maker_build', {
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
      session_id: 'session-1',
    },
  });
  assert.equal(build.ok, true);
  assert.equal(harness.nodeRequests[1].timeoutMs, 60_000);
  assert.equal(harness.nodeRequests[1].maxTotalMs, 900_000);
  assert.match(
    harness.nodeRequests[1].params._meta.progressToken,
    /^cindy-maker-\d+$/,
  );
  assert.equal(
    harness.nodeRequests[1].params.arguments.target_dir,
    '/tmp/trusted-maker',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(harness.previewRequests)), [{
    url: 'https://maker.taptap.cn/app/demo?localDev=1',
    sessionId: 'session-1',
  }]);
  assert.equal(
    build.result.user_facing_markdown,
    '[打开 TapTap Maker 预览](https://maker.taptap.cn/app/demo?localDev=1)',
  );
  const card = harness.sentMessages.find((message) => message.type === 'card-update');
  assert.equal(card.callId, 'call-maker_build');
  assert.equal(card.state, 'done');
  assert.match(card.html, /href="https:\/\/maker\.taptap\.cn\/app\/demo\?localDev=1"/);
});

test('动态工具列表携带可信项目 root，并过滤固定工具', async () => {
  const harness = createMainHarness(async () => ({
    ok: true,
    result: {
      tools: [
        { name: 'maker_status_lite' },
        { name: 'generate_image', inputSchema: { type: 'object' } },
      ],
    },
  }));

  const result = await harness.call('maker_list_tools', {
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.result.tools, [{
    name: 'generate_image',
    inputSchema: { type: 'object' },
  }]);
  assert.equal(harness.nodeRequests[0].method, 'cindy/tools-list');
  assert.deepEqual(JSON.parse(JSON.stringify(harness.nodeRequests[0].params)), {
    target_dir: '/tmp/trusted-maker',
  });
});

test('远程 workdir 在启动 Node Runtime 前即被拒绝', async () => {
  const harness = createMainHarness(async () => {
    throw new Error('不应调用 Node Runtime');
  });
  const result = await harness.call('maker_status', {
    session_context: {
      workdir_is_local: false,
      workdir: '/remote/project',
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /没有可用的本地工作目录/);
  assert.equal(harness.nodeRequests.length, 0);
});

test('设置页重发同一 reqId 不会重复执行长任务', async () => {
  let resolveNode;
  const nodeResult = new Promise((resolve) => {
    resolveNode = resolve;
  });
  const harness = createMainHarness(async () => nodeResult);
  const request = {
    type: 'settings-request',
    reqId: 'settings-1',
    action: 'status',
    payload: {},
  };

  harness.settingsChannel.onmessage({ data: request });
  harness.settingsChannel.onmessage({ data: request });
  await Promise.resolve();
  assert.equal(harness.nodeRequests.length, 1);

  resolveNode({
    ok: true,
    result: { structuredContent: { ok: true, state: 'connected' } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.settingsChannel.messages.length, 1);
  assert.equal(harness.settingsChannel.messages[0].reqId, 'settings-1');
  assert.equal(harness.settingsChannel.messages[0].result.state, 'connected');

  harness.settingsChannel.onmessage({ data: request });
  assert.equal(harness.nodeRequests.length, 1);
  assert.equal(harness.settingsChannel.messages.length, 2);
  assert.deepEqual(
    harness.settingsChannel.messages[1],
    harness.settingsChannel.messages[0],
  );
});

test('MCP root router 只为当前 tools/list 暴露一个可信 file root', () => {
  const hostLines = [];
  const runtimeLines = [];
  const router = rootRouterModule.createMcpRootRouter({
    writeHost: (line) => hostLines.push(JSON.parse(line)),
    writeRuntime: (line) => runtimeLines.push(JSON.parse(line)),
  });

  router.handleHostLine(JSON.stringify({
    jsonrpc: '2.0',
    id: '1',
    method: 'initialize',
    params: { capabilities: {} },
  }));
  assert.deepEqual(runtimeLines.shift().params.capabilities.roots, {
    listChanged: false,
  });

  router.handleHostLine(JSON.stringify({
    jsonrpc: '2.0',
    id: '2',
    method: 'cindy/tools-list',
    params: { target_dir: '/tmp/trusted-maker' },
  }));
  assert.equal(runtimeLines.shift().method, 'tools/list');

  router.handleRuntimeLine(JSON.stringify({
    jsonrpc: '2.0',
    id: 'root-1',
    method: 'roots/list',
    params: {},
  }));
  assert.deepEqual(runtimeLines.shift().result.roots, [{
    uri: 'file:///tmp/trusted-maker',
    name: 'trusted-maker',
  }]);

  router.handleRuntimeLine(JSON.stringify({
    jsonrpc: '2.0',
    id: '2',
    result: { tools: [{ name: 'maker_status_lite' }] },
  }));
  assert.deepEqual(hostLines, [{
    jsonrpc: '2.0',
    id: '2',
    result: { tools: [{ name: 'maker_status_lite' }] },
  }]);
});

test('MCP root router 超时后拒绝陈旧响应并触发进程重建', async () => {
  const hostLines = [];
  const runtimeLines = [];
  const fatalErrors = [];
  const router = rootRouterModule.createMcpRootRouter({
    writeHost: (line) => hostLines.push(JSON.parse(line)),
    writeRuntime: (line) => runtimeLines.push(JSON.parse(line)),
    listTimeoutMs: 10,
    onFatal: (error) => fatalErrors.push(error),
  });

  router.handleHostLine(JSON.stringify({
    jsonrpc: '2.0',
    id: 'stale-list',
    method: 'cindy/tools-list',
    params: { target_dir: '/tmp/stale-maker' },
  }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hostLines[0].id, 'stale-list');
  assert.match(hostLines[0].error.message, /响应超时/);
  assert.equal(fatalErrors.length, 1);

  router.handleRuntimeLine(JSON.stringify({
    jsonrpc: '2.0',
    id: 'stale-list',
    result: { tools: [{ name: 'stale' }] },
  }));
  assert.equal(hostLines.length, 1);
});

test('真实 Maker Runtime 可经插件入口完成 initialize 与 roots-aware tools/list', {
  timeout: 15_000,
}, async () => {
  const makerMcpEntry = fileURLToPath(new URL('node/maker-mcp.cjs', pluginRoot));
  const bootstrap = [
    'globalThis.__CINDY_NODE__ = {',
    '  spawnEntry() { return Promise.reject(new Error("unexpected child spawn")); }',
    '};',
    `require(${JSON.stringify(makerMcpEntry)});`,
  ].join('\n');
  const child = childProcess.spawn(process.execPath, ['-e', bootstrap], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let stdoutBuffer = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(String(message.id))) {
        pending.get(String(message.id))(message);
        pending.delete(String(message.id));
      }
    }
  });

  function request(id, method, params) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error(`Maker Runtime 请求超时：${method}\n${stderr}`));
      }, 10_000);
      pending.set(String(id), (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      })}\n`);
    });
  }

  try {
    const initialized = await request('1', 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    assert.equal(initialized.result.serverInfo.name, 'taptap-maker');
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    })}\n`);

    const listed = await request('2', 'cindy/tools-list', {
      target_dir: '/tmp/cindy-taptap-maker-unbound-test',
    });
    assert.equal(listed.error, undefined, stderr);
    assert.ok(listed.result.tools.some((tool) => tool.name === 'maker_status_lite'));
    assert.ok(listed.result.tools.some((tool) => tool.name === 'maker_build_current_directory'));
  } finally {
    child.kill();
    await once(child, 'close');
  }
});

test('spawn adapter 只改道固定 Maker 入口并用参数传递 proxy 配置', async () => {
  const makerEntry = path.resolve('/tmp/vendor/maker.js');
  const calls = [];
  const handle = fakeChildHandle();
  const restore = adapter.installMakerSpawnAdapter({
    makerEntry,
    childEntry: 'node/maker-child.cjs',
    spawnEntry: async (entry, args) => {
      calls.push({ entry, args });
      return handle;
    },
  });

  try {
    const child = childProcess.spawn(
      process.execPath,
      [makerEntry, '__maker-proxy'],
      { env: { PROXY_CONFIG: '{"server":{"url":"https://example.test"}}' } },
    );
    assert.equal(child.unref(), child);
    assert.equal(child.ref(), child);
    await once(child, 'spawn');
    assert.deepEqual(calls, [{
      entry: 'node/maker-child.cjs',
      args: [
        '__maker-proxy',
        '{"server":{"url":"https://example.test"}}',
      ],
    }]);
  } finally {
    restore();
  }
});

test('只在 Maker CLI 最终 JSON 到达后判定完成', () => {
  assert.equal(adapter.isMakerCliOutputComplete(
    ['apps', '--json'],
    '[{"id":"app-1"}]\n',
  ), true);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['login', '--json'],
    '{"step":"login","status":"ok","message":"Opening Maker PAT page"}\n',
  ), false);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['login', '--json'],
    '{"step":"login","status":"ok","data":{"tap_auth_path":"/tmp/tap-auth.json"}}\n',
  ), true);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['init', '--json'],
    '{"step":"clone","status":"progress"}\n',
  ), false);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['init', '--json'],
    '{"step":"clone","status":"progress"}\n{"step":"done","status":"ok"}\n',
  ), true);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['doctor', '--json'],
    '{"env":"production","git":{"ready":true}}\n',
  ), true);
});

test('deferred child 会保留宿主答复前写入 stdin 的 PAT 字节', async () => {
  let resolveHandle;
  const handle = fakeChildHandle();
  const received = [];
  handle.stdin.on('data', (chunk) => received.push(Buffer.from(chunk)));
  const ended = once(handle.stdin, 'end');
  const child = adapter.createDeferredChild(new Promise((resolve) => {
    resolveHandle = resolve;
  }), {});

  child.stdin.end('pat-secret\n');
  resolveHandle(handle);
  await once(child, 'spawn');
  await ended;
  assert.equal(Buffer.concat(received).toString('utf8'), 'pat-secret\n');
});
