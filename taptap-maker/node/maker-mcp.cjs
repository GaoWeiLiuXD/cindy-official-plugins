'use strict';

const path = require('node:path');
const readline = require('node:readline');
const { PassThrough } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');
const { pathToFileURL } = require('node:url');

const { installMakerSpawnAdapter } = require('./child-process-adapter.cjs');
const { createMcpRootRouter } = require('./mcp-root-router.cjs');

const makerEntry = path.resolve(__dirname, '../vendor/taptap-maker/dist/maker.js');
const childApi = globalThis.__CINDY_NODE__;

if (!childApi || typeof childApi.spawnEntry !== 'function') {
  throw new Error('TapTap Maker 需要 Cindy 的 node.childSpawn 能力');
}

installMakerSpawnAdapter({
  makerEntry,
  childEntry: 'node/maker-child.cjs',
  spawnEntry: childApi.spawnEntry,
});

// Maker 的 MCP server 运行在虚拟 stdio 上；外层只代理 roots/list，把当前
// session-context 的可信本地目录作为本次 tools/list 的唯一 root。
const hostStdin = process.stdin;
const hostStdout = process.stdout;
const runtimeStdin = new PassThrough();
const runtimeStdout = new PassThrough();
const runtimeDecoder = new StringDecoder('utf8');
let runtimeBuffer = '';

const router = createMcpRootRouter({
  writeHost(line) {
    hostStdout.write(line);
  },
  writeRuntime(line) {
    runtimeStdin.write(line);
  },
  onFatal(error) {
    process.stderr.write(`${error.message}\n`);
    setImmediate(function terminatePoisonedRouter() {
      process.exit(1);
    });
  },
});

readline.createInterface({ input: hostStdin }).on('line', function onHostLine(line) {
  router.handleHostLine(line);
});
runtimeStdout.on('data', function onRuntimeData(chunk) {
  runtimeBuffer += runtimeDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  for (;;) {
    const newline = runtimeBuffer.indexOf('\n');
    if (newline < 0) break;
    const line = runtimeBuffer.slice(0, newline).trim();
    runtimeBuffer = runtimeBuffer.slice(newline + 1);
    if (line) router.handleRuntimeLine(line);
  }
});

Object.defineProperty(process, 'stdin', {
  configurable: true,
  enumerable: true,
  value: runtimeStdin,
});
Object.defineProperty(process, 'stdout', {
  configurable: true,
  enumerable: true,
  value: runtimeStdout,
});

// utilityProcess 普通 worker 的 argv 含 Cindy 引导层；Maker 只应看到自己的入口。
process.argv = [process.argv[0], makerEntry];

import(pathToFileURL(makerEntry).href).catch(function onImportError(error) {
  process.stderr.write(`TapTap Maker Runtime 启动失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
