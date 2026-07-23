/* global cindy */

var SECRET_KEY = 'google_calendar_account';
var PLUGIN_NAME = 'Google Calendar';
var BASE = 'https://www.googleapis.com/calendar/v3';
var CALENDAR_WEB_URL = 'https://calendar.google.com/';
var CARD_MAX_EVENTS = 6;

var CARD_STYLE = [
  '.gc-card{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",system-ui,sans-serif;color:var(--text-primary,#1d1d1f);background:var(--surface,#fff);border:1px solid var(--border-default,#e5e5ea);border-radius:20px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.04)}',
  '.gc-head{display:flex;align-items:center;gap:12px;padding:18px 18px 15px}',
  '.gc-mark{position:relative;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid #e5e5ea;border-radius:12px;background:#fff;color:#1d1d1f;overflow:hidden}',
  '.gc-mark-bar{position:absolute;left:0;right:0;top:0;height:14px;background:#ff3b30;color:#fff;font-size:7px;font-weight:750;line-height:14px;letter-spacing:.7px;text-align:center}',
  '.gc-mark-day{margin-top:12px;font-size:19px;font-weight:500;line-height:1;letter-spacing:-.7px}',
  '.gc-kicker{font-size:11px;line-height:1.2;color:var(--text-tertiary,#86868b);letter-spacing:.02em}',
  '.gc-title{margin-top:3px;font-size:17px;line-height:1.18;font-weight:650;letter-spacing:-.02em}',
  '.gc-head-copy{min-width:0;flex:1}',
  '.gc-open{flex:0 0 auto;padding:8px 11px;border:0;border-radius:999px;background:#f2f2f7;color:#007aff;font:600 12px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;white-space:nowrap}',
  '.gc-open:active{background:#e5e5ea}',
  '.gc-body{padding:0 18px 17px}',
  '.gc-divider{height:1px;background:var(--border-default,#e5e5ea);opacity:.72}',
  '.gc-section-label{padding:13px 0 8px;color:var(--text-tertiary,#86868b);font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}',
  '.gc-row{display:flex;gap:12px;padding:11px 0;border-top:1px solid var(--border-default,#e5e5ea)}',
  '.gc-row:first-child{border-top:0}',
  '.gc-time{flex:0 0 76px;color:#ff3b30;font-size:11px;font-weight:650;line-height:1.35}',
  '.gc-event-main{min-width:0;flex:1}',
  '.gc-event-title{font-size:14px;font-weight:600;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.gc-event-meta{margin-top:3px;color:var(--text-secondary,#6e6e73);font-size:11px;line-height:1.35}',
  '.gc-empty{padding:18px 0 4px;color:var(--text-secondary,#6e6e73);font-size:13px;line-height:1.45}',
  '.gc-detail{padding:14px 0 2px}',
  '.gc-detail-line{display:flex;gap:10px;padding:8px 0;font-size:13px;line-height:1.4}',
  '.gc-detail-icon{flex:0 0 19px;color:#ff3b30;font-size:14px;text-align:center}',
  '.gc-detail-value{min-width:0;flex:1}',
  '.gc-description{margin:7px 0 3px;padding:11px 12px;border-radius:12px;background:var(--surface-chip,#f2f2f7);color:var(--text-secondary,#6e6e73);font-size:12px;line-height:1.5;white-space:pre-wrap}',
  '.gc-footer{display:flex;justify-content:space-between;gap:12px;padding-top:12px;color:var(--text-tertiary,#86868b);font-size:10px;line-height:1.35}',
  '.gc-status{display:inline-flex;align-items:center;gap:6px;color:#34c759;font-size:12px;font-weight:600}',
  '.gc-status:before{content:"";width:7px;height:7px;border-radius:50%;background:#34c759}',
  '.gc-status-error{color:#ff3b30}',
  '.gc-status-error:before{background:#ff3b30}',
  '.gc-calendar-name{min-width:0;flex:1;font-size:13px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.gc-calendar-badge{color:var(--text-tertiary,#86868b);font-size:10px}',
].join('');

function fail(message) {
  return { ok: false, message: message };
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clip(value, max) {
  var text = String(value === undefined || value === null ? '' : value).trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function parseDate(value) {
  var raw = String(value || '');
  if (!raw) return null;
  var date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(raw + 'T00:00:00')
    : new Date(raw);
  return isNaN(date.getTime()) ? null : date;
}

function dayLabel(value) {
  var date = parseDate(value);
  if (!date) return clip(value, 34);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function timeLabel(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '全天';
  var date = parseDate(value);
  if (!date) return clip(value, 24);
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function eventRange(event) {
  var start = event && event.start ? String(event.start) : '';
  var end = event && event.end ? String(event.end) : '';
  if (!start) return '时间未提供';
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return dayLabel(start) + ' · 全天';
  var startDay = dayLabel(start);
  var endDay = end ? dayLabel(end) : '';
  var range = startDay + ' · ' + timeLabel(start);
  if (end) range += endDay === startDay ? '–' + timeLabel(end) : ' → ' + endDay + ' ' + timeLabel(end);
  return range;
}

function accountLabel(args) {
  return args && args.account ? '指定账号' : '默认账号';
}

function cardButton() {
  return '<button type="button" class="gc-open" data-ghost-action="open-calendar" aria-label="在浏览器中打开 Google Calendar">打开日历&nbsp;↗</button>';
}

function calendarMark() {
  return '<div class="gc-mark"><span class="gc-mark-bar">CAL</span><span class="gc-mark-day">' +
    escapeHtml(new Date().getDate()) + '</span></div>';
}

function cardFrame(title, body, footer, statusClass, statusText) {
  return '<div class="gc-card"><style>' + CARD_STYLE + '</style>' +
    '<div class="gc-head">' +
      calendarMark() +
      '<div class="gc-head-copy"><div class="gc-kicker">Google Calendar</div><div class="gc-title">' + escapeHtml(title) + '</div></div>' +
      cardButton() +
    '</div>' +
    '<div class="gc-body">' +
      body +
      '<div class="gc-footer"><span class="gc-status ' + (statusClass || '') + '">' + escapeHtml(statusText || '已完成') + '</span><span>' + escapeHtml(footer || '') + '</span></div>' +
    '</div></div>';
}

function renderAccountsCard(result) {
  var accounts = (result && result.accounts) || [];
  var body = accounts.length
    ? '<div class="gc-section-label">已连接账号</div>' + accounts.slice(0, 3).map(function (account) {
      return '<div class="gc-row"><div class="gc-calendar-name">' + escapeHtml(account.email || account.id) + '</div><div class="gc-calendar-badge">' +
        (account.status === 'expired' ? '需重新连接' : account.is_default ? '默认' : '已连接') + '</div></div>';
    }).join('')
    : '<div class="gc-empty">还没有连接 Google Calendar 账号。先在插件详情页完成授权。</div>';
  return cardFrame(accounts.length ? '账号已就绪' : '需要连接账号', body, accounts.length + ' 个账号', accounts.length ? '' : 'gc-status-error', accounts.length ? '已连接' : '待授权');
}

function renderCalendarsCard(result) {
  var calendars = (result && result.calendars) || [];
  var body = calendars.length
    ? '<div class="gc-section-label">你的日历</div>' + calendars.slice(0, 6).map(function (calendar) {
      return '<div class="gc-row"><div class="gc-calendar-name">' + escapeHtml(calendar.summary || calendar.id) + '</div><div class="gc-calendar-badge">' +
        (calendar.primary ? '主日历' : '日历') + '</div></div>';
    }).join('')
    : '<div class="gc-empty">没有找到可用日历。</div>';
  return cardFrame('日历列表', body, calendars.length + ' 个日历', '', '已完成');
}

function renderEventsCard(result, args) {
  var events = (result && result.events) || [];
  var visible = events.slice(0, CARD_MAX_EVENTS);
  var body = '<div class="gc-section-label">' +
    escapeHtml(args && (args.time_min || args.time_max) ? '筛选结果' : '近期安排') + '</div>';
  if (!visible.length) {
    body += '<div class="gc-empty">这段时间没有安排。日程表很干净，适合留一点空白。</div>';
  } else {
    body += visible.map(function (event) {
      var attendees = Array.isArray(event.attendees) && event.attendees.length
        ? event.attendees.length + ' 位参与者'
        : '';
      return '<div class="gc-row"><div class="gc-time">' + escapeHtml(timeLabel(event.start)) + '</div>' +
        '<div class="gc-event-main"><div class="gc-event-title">' + escapeHtml(event.summary || '无标题日程') + '</div>' +
        '<div class="gc-event-meta">' + escapeHtml(dayLabel(event.start)) + (attendees ? ' · ' + escapeHtml(attendees) : '') + '</div></div></div>';
    }).join('');
    if (events.length > visible.length) {
      body += '<div class="gc-empty">还有 ' + escapeHtml(events.length - visible.length) + ' 条日程，已在结果中保留完整数据。</div>';
    }
  }
  return cardFrame('接下来的安排', body, accountLabel(args), '', events.length ? '已找到' : '暂无安排');
}

function renderEventCard(event, title, args) {
  event = event || {};
  var body = '<div class="gc-detail">' +
    '<div class="gc-detail-line"><span class="gc-detail-icon">◷</span><span class="gc-detail-value">' + escapeHtml(eventRange(event)) + '</span></div>';
  if (event.attendees && event.attendees.length) {
    body += '<div class="gc-detail-line"><span class="gc-detail-icon">⌁</span><span class="gc-detail-value">' +
      escapeHtml(event.attendees.slice(0, 8).join('、')) + (event.attendees.length > 8 ? ' 等' + (event.attendees.length - 8) + ' 人' : '') + '</span></div>';
  }
  if (event.description) {
    body += '<div class="gc-description">' + escapeHtml(clip(event.description, 600)) + '</div>';
  }
  body += '</div>';
  return cardFrame(title || event.summary || '日程详情', body, accountLabel(args), '', '已完成');
}

function renderReceiptCard(title, detail, args) {
  var body = '<div class="gc-detail"><div class="gc-detail-line"><span class="gc-detail-icon">✓</span><span class="gc-detail-value">' +
    escapeHtml(detail) + '</span></div></div>';
  return cardFrame(title, body, accountLabel(args), '', '已完成');
}

function renderErrorCard(message) {
  var body = '<div class="gc-empty">' + escapeHtml(clip(message || 'Calendar 操作失败，请稍后重试。', 420)) + '</div>';
  return cardFrame('需要处理', body, 'Google Calendar', 'gc-status-error', '未完成');
}

function renderCalendarCard(action, result, args) {
  if (action === 'accounts') return renderAccountsCard(result);
  if (action === 'list_calendars') return renderCalendarsCard(result);
  if (action === 'list_events') return renderEventsCard(result, args);
  if (action === 'get_event') return renderEventCard(result && result.event, '日程详情', args);
  if (action === 'create_event') return renderEventCard(result && result.event, '日程已创建', args);
  if (action === 'update_event') return renderEventCard(result && result.event, '日程已更新', args);
  if (action === 'delete_event') return renderReceiptCard('日程已删除', '这条日程已经从 Google Calendar 中移除。', args);
  return renderReceiptCard('Calendar 已完成', '操作已完成。', args);
}

async function sendCard(callId, html, height) {
  if (!callId) return;
  try {
    await cindy.send({ type: 'card-update', callId: callId, v: 2, html: html, height: height });
  } catch (_err) {
    // 卡片只是增强展示，供片失败时仍保留原始工具结果。
  }
}

function cardHeight(action, result) {
  if (action === 'list_events') {
    var count = result && Array.isArray(result.events) ? Math.min(result.events.length, CARD_MAX_EVENTS) : 0;
    return Math.min(560, Math.max(220, 210 + count * 58));
  }
  if (action === 'list_calendars') {
    var calendars = result && Array.isArray(result.calendars) ? Math.min(result.calendars.length, 6) : 0;
    return Math.min(480, Math.max(220, 210 + calendars * 45));
  }
  if (action === 'accounts') {
    var accounts = result && Array.isArray(result.accounts) ? Math.min(result.accounts.length, 3) : 0;
    return Math.min(380, Math.max(220, 210 + accounts * 45));
  }
  return 260;
}

function clampInt(value, fallback, max) {
  var n = typeof value === 'number' && isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(1, n));
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
  if (response.status === 204) return { data: null };
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
    return { err: 'Calendar API 返回 HTTP ' + response.status + ':' + message };
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
    return fail('尚未连接 Google Calendar 账号，请到「' + PLUGIN_NAME + '」详情页单独授权');
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

function calTime(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: value };
}

function eventView(event) {
  return {
    id: event.id,
    summary: event.summary || '',
    description: event.description || '',
    start: (event.start && (event.start.dateTime || event.start.date)) || '',
    end: (event.end && (event.end.dateTime || event.end.date)) || '',
    status: event.status,
    link: event.htmlLink || '',
    attendees: (event.attendees || []).map(function (attendee) { return attendee.email; }),
  };
}

async function calendar(args, callId) {
  var account = args.account;
  var calendarId = encodeURIComponent(args.calendar_id || 'primary');
  if (args.action === 'list_calendars') {
    var calendars = await api({
      url: BASE + '/users/me/calendarList',
      account: account,
      callId: callId,
    });
    if (calendars.err) return fail(calendars.err);
    return {
      ok: true,
      result: {
        calendars: (calendars.data.items || []).map(function (item) {
          return { id: item.id, summary: item.summary, primary: Boolean(item.primary) };
        }),
      },
    };
  }

  if (args.action === 'list_events') {
    var query = '?singleEvents=true&orderBy=startTime&maxResults=' +
      clampInt(args.max_results, 10, 25);
    if (args.time_min) query += '&timeMin=' + encodeURIComponent(args.time_min);
    if (args.time_max) query += '&timeMax=' + encodeURIComponent(args.time_max);
    var events = await api({
      url: BASE + '/calendars/' + calendarId + '/events' + query,
      account: account,
      callId: callId,
    });
    if (events.err) return fail(events.err);
    return {
      ok: true,
      result: { events: (events.data.items || []).map(eventView) },
    };
  }

  if (args.action === 'get_event') {
    if (!args.event_id) return fail('get_event 需要 event_id');
    var event = await api({
      url: BASE + '/calendars/' + calendarId + '/events/' + encodeURIComponent(args.event_id),
      account: account,
      callId: callId,
    });
    if (event.err) return fail(event.err);
    return { ok: true, result: { event: eventView(event.data) } };
  }

  if (args.action === 'create_event') {
    if (!args.summary || !args.start || !args.end) {
      return fail('create_event 需要 summary / start / end');
    }
    var body = {
      summary: args.summary,
      start: calTime(args.start),
      end: calTime(args.end),
    };
    if (args.description) body.description = args.description;
    if (Array.isArray(args.attendees)) {
      body.attendees = args.attendees.map(function (email) { return { email: email }; });
    }
    var created = await api({
      url: BASE + '/calendars/' + calendarId + '/events',
      method: 'POST',
      body: body,
      account: account,
      callId: callId,
    });
    if (created.err) return fail(created.err);
    return { ok: true, result: { created: true, event: eventView(created.data) } };
  }

  if (args.action === 'update_event') {
    if (!args.event_id) return fail('update_event 需要 event_id');
    var patch = {};
    if (args.summary !== undefined) patch.summary = args.summary;
    if (args.description !== undefined) patch.description = args.description;
    if (args.start !== undefined) patch.start = calTime(args.start);
    if (args.end !== undefined) patch.end = calTime(args.end);
    if (args.attendees !== undefined) {
      patch.attendees = args.attendees.map(function (email) { return { email: email }; });
    }
    var updated = await api({
      url: BASE + '/calendars/' + calendarId + '/events/' + encodeURIComponent(args.event_id),
      method: 'PATCH',
      body: patch,
      account: account,
      callId: callId,
    });
    if (updated.err) return fail(updated.err);
    return { ok: true, result: { updated: true, event: eventView(updated.data) } };
  }

  if (args.action === 'delete_event') {
    if (!args.event_id) return fail('delete_event 需要 event_id');
    var removed = await api({
      url: BASE + '/calendars/' + calendarId + '/events/' + encodeURIComponent(args.event_id),
      method: 'DELETE',
      account: account,
      callId: callId,
    });
    if (removed.err) return fail(removed.err);
    return { ok: true, result: { deleted: true } };
  }

  return fail('未知 action:' + args.action);
}

cindy.onHostMessage(async function (message) {
  if (!message) return;

  // 新版宿主会在卡片点击处直接调用系统浏览器。旧版宿主仍会把动作
  // 回传给意识，这个兼容分支通过受信宿主请求完成同样的行为。
  if (message.type === 'event' && message.name === 'card-action') {
    if (message.actionId === 'open-calendar') {
      try {
        await cindy.send({
          type: 'host-request',
          kind: 'open-external',
          url: CALENDAR_WEB_URL,
        });
      } catch (_err) {
        // 旧宿主不认识该请求时静默降级，不影响卡片和工具结果。
      }
    }
    return;
  }

  if (message.type !== 'tool-call') return;
  var action = message.tool === 'google_calendar_accounts'
    ? 'accounts'
    : message.tool === 'google_calendar'
      ? (message.args || {}).action
      : '';
  try {
    var result = message.tool === 'google_calendar_accounts'
      ? await listAccounts()
      : message.tool === 'google_calendar'
        ? await calendar(message.args || {}, message.callId)
        : fail('未知工具:' + message.tool);
    if (result.ok) {
      await sendCard(
        message.callId,
        renderCalendarCard(action, result.result, message.args || {}),
        cardHeight(action, result.result),
      );
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: result.result });
    } else {
      await sendCard(message.callId, renderErrorCard(result.message), 260);
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: result.message });
    }
  } catch (error) {
    await sendCard(
      message.callId,
      renderErrorCard('Google Calendar 工具执行失败:' +
        (error && error.message ? error.message : String(error))),
      260,
    );
    await cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: 'Google Calendar 工具执行失败:' +
        (error && error.message ? error.message : String(error)),
    });
  }
});
