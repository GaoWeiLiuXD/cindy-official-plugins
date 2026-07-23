/* global cindy */

var SECRET_KEY = 'google_sheets_account';
var PLUGIN_NAME = 'Google Sheets';
var BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function fail(message) {
  return { ok: false, message: message };
}

async function api(opts) {
  var request = {
    url: opts.url,
    method: opts.method || 'GET',
    headers: { Accept: 'application/json' },
    callId: opts.callId,
  };
  if (opts.account) request.authAccount = opts.account;
  if (opts.body !== undefined) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(opts.body);
  }
  var response = await cindy.fetch(request);
  if (!response.ok) return { err: response.message };
  var data = null;
  if (response.body) {
    try {
      data = JSON.parse(response.body);
    } catch (_err) {
      return { err: 'Google 返回了无法解析的响应(HTTP ' + response.status + ')' };
    }
  }
  if (response.status < 200 || response.status >= 300) {
    var message = data && data.error && data.error.message
      ? data.error.message
      : (response.body || '').slice(0, 200);
    return { err: 'Sheets API 返回 HTTP ' + response.status + ':' + message };
  }
  return { data: data };
}

async function listAccounts() {
  var response = await fetch('/oauth');
  if (!response.ok) return fail('账号状态查询失败(' + response.status + ')');
  var list = await response.json();
  var entry = list.find(function (item) { return item && item.key === SECRET_KEY; });
  if (!entry || !entry.clientConfigured) return fail('内置应用身份缺失，请升级 Cindy 后重试');
  if (!entry.accounts.length) {
    return fail('尚未连接 Google Sheets 账号，请到「' + PLUGIN_NAME + '」详情页单独授权');
  }
  return {
    ok: true,
    result: {
      accounts: entry.accounts.map(function (account) {
        return {
          id: account.id,
          email: account.label,
          status: account.status,
          is_default: account.isDefault,
        };
      }),
    },
  };
}

function spreadsheetId(input) {
  var match = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(input || '');
  return match ? match[1] : (input || '').trim();
}

async function sheets(args, callId) {
  var id = spreadsheetId(args.spreadsheet_id);
  if (!id) return fail('需要 spreadsheet_id(表格 id 或完整链接)');

  if (args.action === 'list_sheets') {
    var metadata = await api({
      url: BASE + '/' + encodeURIComponent(id) +
        '?fields=' + encodeURIComponent('properties(title),sheets(properties(sheetId,title,gridProperties))'),
      account: args.account,
      callId: callId,
    });
    if (metadata.err) return fail(metadata.err);
    return {
      ok: true,
      result: {
        title: metadata.data.properties ? metadata.data.properties.title : '',
        sheets: (metadata.data.sheets || []).map(function (sheet) {
          var properties = sheet.properties || {};
          return {
            title: properties.title,
            rows: properties.gridProperties ? properties.gridProperties.rowCount : null,
            cols: properties.gridProperties ? properties.gridProperties.columnCount : null,
          };
        }),
      },
    };
  }

  if (args.action === 'read_range') {
    if (!args.range) return fail('read_range 需要 range(A1 记法)');
    var read = await api({
      url: BASE + '/' + encodeURIComponent(id) + '/values/' + encodeURIComponent(args.range),
      account: args.account,
      callId: callId,
    });
    if (read.err) return fail(read.err);
    return {
      ok: true,
      result: { range: read.data.range, values: read.data.values || [] },
    };
  }

  if (args.action === 'write_range') {
    if (!args.range) return fail('write_range 需要 range(A1 记法)');
    if (!Array.isArray(args.values)) return fail('write_range 需要 values(二维数组)');
    var written = await api({
      url: BASE + '/' + encodeURIComponent(id) + '/values/' +
        encodeURIComponent(args.range) + '?valueInputOption=USER_ENTERED',
      method: 'PUT',
      body: {
        range: args.range,
        majorDimension: 'ROWS',
        values: args.values,
      },
      account: args.account,
      callId: callId,
    });
    if (written.err) return fail(written.err);
    return {
      ok: true,
      result: {
        updated_range: written.data.updatedRange,
        updated_cells: written.data.updatedCells,
      },
    };
  }

  return fail('未知 action:' + args.action);
}

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;
  try {
    var result = message.tool === 'google_sheets_accounts'
      ? await listAccounts()
      : message.tool === 'google_sheets'
        ? await sheets(message.args || {}, message.callId)
        : fail('未知工具:' + message.tool);
    if (result.ok) {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: result.result });
    } else {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: result.message });
    }
  } catch (error) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: 'Google Sheets 工具执行失败:' +
        (error && error.message ? error.message : String(error)),
    });
  }
});
