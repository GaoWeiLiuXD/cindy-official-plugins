/**
 * TapTap Maker 官方插件。
 *
 * 业务与 Runtime 全部在插件包内；宿主只提供通用 session-context、pick、
 * preview 与 node 能力。
 */

/* global BroadcastChannel, cindy, fetch */

var ACCOUNT_ENTRY = 'node/account.cjs';
var ACCOUNT_TOOL = 'cindy_maker_account';
var FIXED_MAKER_TOOLS = {
  maker_status_lite: true,
  maker_build_current_directory: true,
};
var SETTINGS_CHANNEL = 'taptap-maker-settings';
var WORKSPACE_HINT = '请先在 Cindy 中打开目标 TapTap Maker 项目目录，再重新调用本插件。';
var nextProgressToken = 1;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function previewCardHtml(url) {
  var safeUrl = escapeHtml(url);
  return [
    '<div style="padding:12px;border:1px solid var(--border-default);border-radius:10px;">',
    '<div style="font-weight:600;">TapTap Maker 预览已在右侧打开</div>',
    '<div style="margin-top:6px;color:var(--text-secondary);">如需在浏览器中打开：</div>',
    '<a href="' + safeUrl + '" style="display:block;margin-top:4px;word-break:break-all;">',
    safeUrl,
    '</a>',
    '</div>',
  ].join('');
}

async function nodeRequest(request) {
  var response = await cindy.node.request(request);
  if (!response || response.ok !== true) {
    throw new Error(response && response.message ? response.message : 'TapTap Maker Node Runtime 调用失败');
  }
  return response.result;
}

function parseAccountResult(result) {
  if (isObject(result) && isObject(result.structuredContent)) {
    return result.structuredContent;
  }
  var content = isObject(result) && Array.isArray(result.content) ? result.content : [];
  for (var i = 0; i < content.length; i += 1) {
    if (!isObject(content[i]) || content[i].type !== 'text' || typeof content[i].text !== 'string') continue;
    try {
      var parsed = JSON.parse(content[i].text);
      if (isObject(parsed)) return parsed;
    } catch (_error) {
      // 检查下一段。
    }
  }
  throw new Error('TapTap Maker 账号 Runtime 返回了无法识别的结果');
}

async function accountRequest(action, payload, longRunning) {
  var args = Object.assign({ action: action }, payload || {});
  var result = await nodeRequest({
    entry: ACCOUNT_ENTRY,
    method: 'tools/call',
    params: {
      name: ACCOUNT_TOOL,
      arguments: args,
    },
    timeoutMs: longRunning ? 60000 : 30000,
    ...(longRunning ? { maxTotalMs: 900000 } : {}),
  });
  var parsed = parseAccountResult(result);
  if (parsed.ok === false) throw new Error(parsed.message || 'TapTap Maker 账号操作失败');
  return parsed;
}

function requireLocalContext(message) {
  var context = isObject(message.args) && isObject(message.args.session_context)
    ? message.args.session_context
    : null;
  if (!context || context.workdir_is_local !== true || typeof context.workdir !== 'string' || !context.workdir) {
    throw new Error('当前会话没有可用的本地工作目录。' + WORKSPACE_HINT);
  }
  return context;
}

function withoutSessionContext(args) {
  var result = {};
  var source = isObject(args) ? args : {};
  for (var key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key) || key === 'session_context') continue;
    result[key] = source[key];
  }
  return result;
}

async function listMakerTools(workdir) {
  var result = await nodeRequest({
    method: 'cindy/tools-list',
    params: { target_dir: workdir },
    timeoutMs: 60000,
  });
  var tools = isObject(result) && Array.isArray(result.tools) ? result.tools : [];
  return tools.filter(function visible(tool) {
    return isObject(tool) && typeof tool.name === 'string' && !FIXED_MAKER_TOOLS[tool.name];
  });
}

async function callMakerTool(name, args, longRunning) {
  var progressToken = longRunning ? 'cindy-maker-' + nextProgressToken++ : null;
  return nodeRequest({
    method: 'tools/call',
    params: {
      name: name,
      arguments: args,
      ...(progressToken ? { _meta: { progressToken: progressToken } } : {}),
    },
    timeoutMs: longRunning ? 60000 : 30000,
    ...(longRunning ? { maxTotalMs: 900000 } : {}),
  });
}

function previewUrlFromResult(result) {
  var content = isObject(result) && Array.isArray(result.content) ? result.content : [];
  for (var i = 0; i < content.length; i += 1) {
    if (!isObject(content[i]) || content[i].type !== 'text' || typeof content[i].text !== 'string') continue;
    var match = /(?:^|\n)-?\s*maker_url:\s*(https:\/\/maker\.taptap\.cn\/app\/[^\s]+)/i.exec(content[i].text);
    if (!match) continue;
    try {
      var url = new URL(match[1]);
      if (url.protocol !== 'https:' || url.hostname !== 'maker.taptap.cn') continue;
      if (!url.pathname.startsWith('/app/') || url.searchParams.get('localDev') !== '1') continue;
      return url.toString();
    } catch (_error) {
      // 检查下一段。
    }
  }
  return null;
}

async function handleTool(message) {
  var args = withoutSessionContext(message.args);
  if (message.tool === 'maker_login') {
    return accountRequest('login', {}, true);
  }
  if (message.tool === 'maker_apps') {
    return accountRequest('apps', {}, false);
  }
  if (message.tool === 'maker_init') {
    var initContext = requireLocalContext(message);
    return accountRequest('init', Object.assign({}, args, { workdir: initContext.workdir }), true);
  }
  if (message.tool === 'maker_doctor') {
    var doctorContext = requireLocalContext(message);
    return accountRequest('doctor', { workdir: doctorContext.workdir }, true);
  }
  if (message.tool === 'maker_status') {
    var statusContext = requireLocalContext(message);
    return callMakerTool(
      'maker_status_lite',
      Object.assign({}, args, { target_dir: statusContext.workdir }),
      false,
    );
  }
  if (message.tool === 'maker_build') {
    var buildContext = requireLocalContext(message);
    var built = await callMakerTool(
      'maker_build_current_directory',
      Object.assign({}, args, { target_dir: buildContext.workdir }),
      true,
    );
    if (isObject(built) && built.isError === true) return built;
    var previewUrl = previewUrlFromResult(built);
    if (!previewUrl) return built;
    var preview;
    try {
      preview = await cindy.preview({
        url: previewUrl,
        ...(typeof buildContext.session_id === 'string' ? { sessionId: buildContext.session_id } : {}),
      });
    } catch (error) {
      preview = { ok: false, message: errorMessage(error) };
    }
    return Object.assign({}, built, {
      preview: preview && preview.ok === true
        ? { ok: true, url: previewUrl }
        : { ok: false, url: previewUrl, message: preview && preview.message ? preview.message : '右侧预览打开失败' },
      preview_url: previewUrl,
      user_facing_markdown: '[打开 TapTap Maker 预览](' + previewUrl + ')',
    });
  }
  if (message.tool === 'maker_list_tools') {
    var listContext = requireLocalContext(message);
    return { tools: await listMakerTools(listContext.workdir) };
  }
  if (message.tool === 'maker_call_tool') {
    var callContext = requireLocalContext(message);
    if (typeof args.name !== 'string' || !args.name || (args.args !== undefined && !isObject(args.args))) {
      throw new Error('maker_call_tool 需要 name 与可选的 args 对象');
    }
    if (FIXED_MAKER_TOOLS[args.name]) {
      throw new Error('固定 Maker 工具必须使用 maker_status 或 maker_build');
    }
    var available = await listMakerTools(callContext.workdir);
    if (!available.some(function sameTool(tool) { return tool.name === args.name; })) {
      throw new Error('Maker 动态工具不存在或当前不可用：' + args.name);
    }
    return callMakerTool(
      args.name,
      Object.assign({}, args.args || {}, { target_dir: callContext.workdir }),
      true,
    );
  }
  throw new Error('未知 TapTap Maker 工具：' + String(message.tool));
}

async function sendToolResult(message) {
  try {
    var result = await handleTool(message);
    if (
      message.tool === 'maker_build'
      && isObject(result)
      && typeof result.preview_url === 'string'
    ) {
      try {
        await cindy.send({
          type: 'card-update',
          callId: message.callId,
          v: 2,
          state: 'done',
          html: previewCardHtml(result.preview_url),
        });
      } catch (_error) {
        // 卡片只是可点击地址的补充；右侧预览和构建结果不受影响。
      }
    }
    await cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: true,
      result: result,
    });
  } catch (error) {
    await cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: errorMessage(error),
    });
  }
}

async function handleSettingsRequest(action, payload) {
  if (action === 'status') return accountRequest('status', {}, false);
  if (action === 'login') return accountRequest('login', {}, true);
  if (action === 'open_pat_page') return accountRequest('open_pat_page', {}, false);
  if (action === 'set_pat') {
    return accountRequest('set_pat', { pat: payload && payload.pat }, true);
  }
  if (action === 'projects') return accountRequest('projects', {}, false);
  if (action === 'sync_projects') {
    var picked = await cindy.pick({
      mode: 'directory',
      title: '选择 TapTap Maker 项目父目录',
    });
    if (!picked || picked.ok !== true) {
      if (picked && picked.errorCode === 'CANCELLED') return { ok: true, canceled: true };
      throw new Error(picked && picked.message ? picked.message : '父目录选择失败');
    }
    if (typeof picked.path !== 'string' || !picked.path) {
      throw new Error('宿主没有返回可用的父目录路径');
    }
    return accountRequest('sync_projects', {
      parentDir: picked.path,
      projectIds: payload && payload.projectIds,
    }, true);
  }
  throw new Error('未知设置动作：' + String(action));
}

var settingsChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel(SETTINGS_CHANNEL)
  : null;
var settingsRequests = new Map();

if (settingsChannel) {
  settingsChannel.onmessage = function onSettingsMessage(event) {
    var message = event && event.data;
    if (
      !isObject(message)
      || message.type !== 'settings-request'
      || typeof message.reqId !== 'string'
      || typeof message.action !== 'string'
    ) {
      return;
    }
    var existing = settingsRequests.get(message.reqId);
    if (existing) {
      if (existing.response) settingsChannel.postMessage(existing.response);
      return;
    }
    var entry = { response: null };
    var promise = handleSettingsRequest(message.action, isObject(message.payload) ? message.payload : {})
      .then(function success(result) {
        return { type: 'settings-result', reqId: message.reqId, ok: true, result: result };
      })
      .catch(function failure(error) {
        return { type: 'settings-result', reqId: message.reqId, ok: false, message: errorMessage(error) };
      });
    settingsRequests.set(message.reqId, entry);
    promise.then(function reply(response) {
      entry.response = response;
      settingsChannel.postMessage(response);
    }).finally(function retainResultForLateRetries() {
      setTimeout(function releaseRequest() {
        if (settingsRequests.get(message.reqId) === entry) {
          settingsRequests.delete(message.reqId);
        }
      }, 60000);
    });
  };
}

cindy.onHostMessage(function onHostMessage(message) {
  if (!message || message.type !== 'tool-call') return;
  void sendToolResult(message);
});
