'use strict';

const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { syncBuiltinESMExports } = require('node:module');
const path = require('node:path');
const { PassThrough } = require('node:stream');

/**
 * `spawnEntry()` 异步返回宿主子进程把手，但 Node 的 spawn() 必须同步返回。
 * 这个窄 facade 先交出稳定的 stdio/EventEmitter，宿主答复后再接通真实把手。
 */
function createDeferredChild(startPromise, options) {
  const child = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let handle = null;
  let exited = false;
  let killRequested = false;
  let abortListener = null;

  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.pid = undefined;
  child.killed = false;
  child.ref = function ref() {
    return child;
  };
  child.unref = function unref() {
    return child;
  };
  child.kill = function kill() {
    if (exited) return false;
    child.killed = true;
    if (handle) return handle.kill();
    killRequested = true;
    return true;
  };

  function detachAbortListener() {
    if (abortListener && options && options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
    abortListener = null;
  }

  function finishStreams() {
    if (!stdout.destroyed) stdout.end();
    if (!stderr.destroyed) stderr.end();
  }

  Promise.resolve(startPromise).then(function onStarted(nextHandle) {
    if (!nextHandle || !nextHandle.stdin || !nextHandle.stdout || !nextHandle.stderr) {
      throw new Error('Cindy Node 子进程把手不完整');
    }
    handle = nextHandle;
    child.pid = nextHandle.pid;

    stdin.on('data', function onStdin(chunk) {
      if (!exited) nextHandle.stdin.write(chunk);
    });
    stdin.once('end', function onStdinEnd() {
      if (!exited) nextHandle.stdin.end();
    });
    nextHandle.stdout.on('data', function onStdout(chunk) {
      stdout.write(chunk);
    });
    nextHandle.stderr.on('data', function onStderr(chunk) {
      stderr.write(chunk);
    });
    nextHandle.once('exit', function onExit(code, signal) {
      if (exited) return;
      exited = true;
      child.killed = true;
      child.emit('exit', code, signal);
    });
    nextHandle.once('close', function onClose(code, signal) {
      exited = true;
      child.killed = true;
      finishStreams();
      detachAbortListener();
      child.emit('close', code, signal);
    });

    if (killRequested) {
      nextHandle.kill();
      return;
    }
    queueMicrotask(function emitSpawn() {
      child.emit('spawn');
    });
  }).catch(function onStartError(error) {
    exited = true;
    child.killed = true;
    finishStreams();
    detachAbortListener();
    queueMicrotask(function emitError() {
      child.emit('error', error instanceof Error ? error : new Error(String(error)));
      child.emit('close', null, null);
    });
  });

  if (options && options.signal) {
    abortListener = function onAbort() {
      child.kill();
    };
    if (options.signal.aborted) abortListener();
    else options.signal.addEventListener('abort', abortListener, { once: true });
  }

  return child;
}

function parseJsonValues(output) {
  const text = String(output || '').trim();
  if (!text) return [];
  try {
    return [JSON.parse(text)];
  } catch {
    return text.split(/\r?\n/).filter(Boolean).flatMap(function parseLine(line) {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
}

/**
 * 官方 CLI 成功时不会主动 process.exit；Electron ParentPort 会让一次性
 * utilityProcess 继续存活。这里只识别本插件实际调用的最终 JSON 结果，
 * 让调用方在完整输出抵达后主动回收进程；中间进度绝不视为完成。
 */
function isMakerCliOutputComplete(args, output) {
  const command = Array.isArray(args) ? args[0] : undefined;
  const values = parseJsonValues(output);
  const last = values[values.length - 1];
  if (command === 'apps') return values.length === 1 && Array.isArray(last);
  if (!last || typeof last !== 'object' || Array.isArray(last)) return false;
  if (command === 'doctor') return values.length === 1;
  if (command === 'init') return last.step === 'done' && last.status === 'ok';
  if (command === 'login') {
    return Boolean(last.step === 'login'
      && last.status === 'ok'
      && last.data
      && typeof last.data.tap_auth_path === 'string');
  }
  if (command === 'pat') {
    return Boolean(last.step === 'pat'
      && last.status === 'ok'
      && last.data
      && typeof last.data.tap_auth_path === 'string');
  }
  return false;
}

/**
 * Maker build 会启动长驻 `logs watch`。在插件仍有 MCP 活动时保留它；
 * 空闲后主动结束，宿主才能按 node.idleTimeoutSeconds 回收外层 worker。
 */
function createRuntimeLogWatcherIdleController(options) {
  const idleTimeoutMs = options && options.idleTimeoutMs
    ? options.idleTimeoutMs
    : 10 * 60 * 1000;
  const schedule = options && options.setTimeout ? options.setTimeout : setTimeout;
  const cancel = options && options.clearTimeout ? options.clearTimeout : clearTimeout;
  let watcher = null;
  let idleTimer = null;

  function clearIdleTimer() {
    if (idleTimer === null) return;
    cancel(idleTimer);
    idleTimer = null;
  }

  function forget(expected) {
    if (watcher !== expected) return;
    watcher = null;
    clearIdleTimer();
  }

  function touch() {
    if (!watcher) return;
    clearIdleTimer();
    idleTimer = schedule(function stopIdleWatcher() {
      idleTimer = null;
      const current = watcher;
      watcher = null;
      if (current) current.kill();
    }, idleTimeoutMs);
    if (idleTimer && typeof idleTimer.unref === 'function') idleTimer.unref();
  }

  function track(nextWatcher) {
    watcher = nextWatcher;
    // 原 Runtime 把 watcher stdio 指向文件；childSpawn 只提供管道，这里持续
    // 消费无人读取的状态输出，避免 10 分钟窗口内在内存积压。
    nextWatcher.stdout.resume();
    nextWatcher.stderr.resume();
    nextWatcher.once('exit', function onExit() {
      forget(nextWatcher);
    });
    nextWatcher.once('close', function onClose() {
      forget(nextWatcher);
    });
    touch();
  }

  return { touch, track };
}

/**
 * 只接管 Maker 对自身入口的 `spawn(process.execPath, ...)`。
 * 其它脚本失败关闭，避免适配器退化成任意 Node 命令执行器。
 */
function installMakerSpawnAdapter(options) {
  if (!options || typeof options.spawnEntry !== 'function') {
    throw new Error('Cindy Node childSpawn 能力不可用');
  }
  const makerEntry = path.resolve(options.makerEntry);
  const realSpawn = childProcess.spawn;

  childProcess.spawn = function spawn(command, args, spawnOptions) {
    if (command !== process.execPath) {
      return realSpawn.call(childProcess, command, args, spawnOptions);
    }
    const argv = Array.isArray(args) ? args.slice() : [];
    const script = typeof argv[0] === 'string' ? path.resolve(argv[0]) : '';
    if (script !== makerEntry) {
      return createDeferredChild(
        Promise.reject(new Error('Maker Runtime 尝试启动未声明的 Node 脚本')),
        spawnOptions,
      );
    }

    const childArgs = argv.slice(1);
    if (
      childArgs[0] === '__maker-proxy'
      && childArgs.length === 1
      && spawnOptions
      && spawnOptions.env
      && typeof spawnOptions.env.PROXY_CONFIG === 'string'
    ) {
      // Maker proxy 原本通过环境变量收配置；childSpawn 刻意不开放任意 env，
      // 改用 Runtime 已支持的命令行 JSON 配置入口。
      childArgs.push(spawnOptions.env.PROXY_CONFIG);
    }
    const child = createDeferredChild(
      options.spawnEntry(options.childEntry, childArgs),
      spawnOptions,
    );
    if (
      childArgs[0] === 'logs'
      && childArgs[1] === 'watch'
      && typeof options.onRuntimeLogWatcher === 'function'
    ) {
      options.onRuntimeLogWatcher(child);
    }
    return child;
  };
  syncBuiltinESMExports();

  return function restore() {
    childProcess.spawn = realSpawn;
    syncBuiltinESMExports();
  };
}

module.exports = {
  createDeferredChild,
  createRuntimeLogWatcherIdleController,
  isMakerCliOutputComplete,
  installMakerSpawnAdapter,
};
