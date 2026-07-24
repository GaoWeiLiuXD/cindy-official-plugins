(function () {
  'use strict';

  var KEY = 'notion_token';
  var bc = new BroadcastChannel('cindy-notion');
  var statusTimer = null;
  var testSeq = 0;
  var cancelActiveTest = null;
  var saved = false;
  var tail = '';
  var identity = null;
  var stepsExpanded = true;
  var openStepId = 'step-create';
  var rebindMode = false;

  function $(id) {
    return document.getElementById(id);
  }

  function showStatus(text, sticky) {
    $('status').textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky && text) {
      statusTimer = setTimeout(function () {
        $('status').textContent = '';
      }, 6000);
    }
  }

  function hasVisibleContent() {
    return Boolean(
      saved &&
      identity &&
      identity.botId &&
      identity.visibilityChecked &&
      !identity.visibilityError &&
      identity.visibleCount > 0
    );
  }

  function currentState() {
    if (!saved) {
      return {
        status: '尚未连接',
        meta: '完成下面 3 个步骤后即可使用',
        complete: false,
        summary: '尚未完成',
      };
    }
    if (rebindMode) {
      return {
        status: '重新绑定 Notion',
        meta: '粘贴新的访问令牌后保存',
        complete: false,
        summary: '正在重新绑定',
      };
    }
    if (!identity || !identity.botId) {
      return {
        status: 'Token 已保存',
        meta: '点击检查，确认 Cindy 能看到哪些页面',
        complete: false,
        summary: '等待检查',
      };
    }
    if (identity.visibilityError) {
      return {
        status: '连接正常，但页面授权需要处理',
        meta: 'Token 有效 · 页面检查失败',
        complete: false,
        summary: '需要处理页面授权',
      };
    }
    if (identity.visibilityChecked && identity.visibleCount === 0) {
      return {
        status: '连接正常，但尚未授权页面',
        meta: 'Token 有效 · 当前可见页面为 0',
        complete: false,
        summary: '2 / 3 已完成',
      };
    }
    if (hasVisibleContent()) {
      return {
        status: '已连接到 ' + (identity.workspaceName || 'Notion'),
        meta: (identity.visibleCount + (identity.visibleHasMore ? '+' : '')) +
          ' 个页面/数据库 · 刚刚检查',
        complete: true,
        summary: '3 个步骤已完成',
      };
    }
    return {
      status: 'Token 已保存',
      meta: '点击检查，确认 Cindy 能看到哪些页面',
      complete: false,
      summary: '等待检查',
    };
  }

  function setStep(step, state, result, expanded) {
    step.classList.remove('is-complete', 'is-active', 'is-pending', 'is-open');
    step.classList.add(state);
    step.querySelector('.step-result').textContent = result;
    step.querySelector('.step-head').setAttribute('aria-expanded', expanded ? 'true' : 'false');
    step.querySelector('.chevron').textContent = expanded ? '⌃' : '⌄';
    if (expanded) step.classList.add('is-open');
  }

  function renderVisibleList(nextIdentity) {
    var box = $('visible-list');
    box.textContent = '';
    if (!nextIdentity || !nextIdentity.visibilityChecked) {
      if (nextIdentity && nextIdentity.visibilityError) {
        box.className = 'visible-list show';
        box.textContent = '页面检查失败：' + nextIdentity.visibilityError;
      } else {
        box.className = 'visible-list';
      }
      return;
    }
    box.className = 'visible-list show';
    if (!nextIdentity.visibleCount) {
      var emptyTitle = document.createElement('strong');
      emptyTitle.textContent = 'Token 有效，但当前可见页面为 0';
      box.appendChild(emptyTitle);
      var emptyText = document.createElement('p');
      emptyText.textContent = '回到 Notion 的 Content access 中选择页面后，再次检查。';
      box.appendChild(emptyText);
      return;
    }
    var title = document.createElement('strong');
    title.textContent = '已发现 ' + nextIdentity.visibleCount +
      (nextIdentity.visibleHasMore ? '+' : '') + ' 项可见内容';
    box.appendChild(title);
    var samples = Array.isArray(nextIdentity.visibleSamples) ? nextIdentity.visibleSamples : [];
    if (samples.length) {
      var list = document.createElement('ul');
      samples.forEach(function (sample) {
        var item = document.createElement('li');
        item.textContent = (sample.title || '未命名内容') +
          (sample.object ? ' · ' + sample.object : '');
        list.appendChild(item);
      });
      box.appendChild(list);
    }
  }

  function render() {
    var state = currentState();
    var attention = !state.complete;
    $('connection-row').classList.toggle('needs-attention', attention);
    $('hero-status').textContent = state.status;
    $('workspace-meta').textContent = state.meta;
    $('steps-summary').textContent = state.summary;
    $('clear').hidden = !saved;
    $('clear').disabled = !saved;
    $('rebind').textContent = state.complete ? '重新绑定' : (saved ? '检查连接' : '开始连接');
    $('test').disabled = !saved;

    var createState = saved ? ['is-complete', '已完成'] : ['is-active', '当前步骤'];
    var tokenState = saved ? ['is-complete', '已完成'] : ['is-pending', '待完成'];
    var accessState = ['is-pending', '待完成'];

    if (saved && !state.complete) {
      accessState = ['is-active', identity && identity.visibilityChecked && !identity.visibleCount ? '需要授权' : '当前步骤'];
    }
    if (rebindMode) {
      tokenState = ['is-active', '当前步骤'];
      accessState = ['is-pending', '待检查'];
    } else if (state.complete) {
      accessState = ['is-complete', '已完成'];
    }

    setStep($('step-create'), createState[0], createState[1], openStepId === 'step-create');
    setStep($('step-token'), tokenState[0], tokenState[1], openStepId === 'step-token');
    setStep($('step-access'), accessState[0], accessState[1], openStepId === 'step-access');

    var section = document.querySelector('.steps-section');
    section.classList.toggle('expanded', stepsExpanded);
    $('steps-toggle').setAttribute('aria-expanded', stepsExpanded ? 'true' : 'false');
    $('toggle-copy').textContent = stepsExpanded ? '收起步骤' : '查看步骤';
    document.querySelector('.toggle-chevron').textContent = stepsExpanded ? '⌃' : '⌄';
    renderVisibleList(identity);
  }

  async function load() {
    try {
      var nextSaved = false;
      var nextTail = '';
      var secrets = await (await fetch('/secrets')).json();
      for (var i = 0; i < secrets.length; i++) {
        if (secrets[i] && secrets[i].key === KEY) {
          nextSaved = Boolean(secrets[i].saved);
          nextTail = secrets[i].tail || '';
        }
      }
      saved = nextSaved;
      tail = nextTail;
      identity = null;
      try {
        var kv = await (await fetch('/kv')).json();
        if (saved && kv && kv.notionIdentity && typeof kv.notionIdentity === 'object') {
          identity = kv.notionIdentity;
        }
      } catch (e) {
        /* 缓存读取失败不影响 token 状态。 */
      }
      if (!saved) {
        rebindMode = false;
        openStepId = 'step-create';
        stepsExpanded = true;
      } else if (!rebindMode && hasVisibleContent()) {
        stepsExpanded = false;
        openStepId = '';
      } else if (!rebindMode) {
        stepsExpanded = true;
        openStepId = 'step-access';
      }
      $('token').placeholder = saved ? '粘贴新 token 以更换当前连接' : '粘贴 ntn_…';
      render();
    } catch (e) {
      showStatus('连接状态加载失败，请稍后重试', true);
    }
  }

  function syncEye() {
    var input = $('token');
    var eye = $('eye');
    var empty = input.value.length === 0;
    eye.hidden = empty;
    if (empty) {
      input.type = 'password';
      eye.textContent = '显示';
    }
  }

  async function save() {
    var value = $('token').value.trim();
    if (!value) {
      showStatus('请先粘贴 Notion Integration Token');
      return;
    }
    $('save').disabled = true;
    showStatus('正在安全保存 Token…', true);
    try {
      var response = await fetch('/secrets/' + KEY, {
        method: 'PUT',
        body: JSON.stringify({ value: value }),
      });
      if (response.status !== 204) {
        showStatus('保存失败（HTTP ' + response.status + '），请重试', true);
        return;
      }
      $('token').value = '';
      syncEye();
      rebindMode = false;
      openStepId = 'step-access';
      stepsExpanded = true;
      await load();
      await test();
    } catch (e) {
      showStatus('保存失败，请重试', true);
    } finally {
      $('save').disabled = false;
    }
  }

  async function test() {
    var generation = ++testSeq;
    var reqId = 'notion-test-' + Date.now() + '-' + generation;
    if (cancelActiveTest) cancelActiveTest();
    $('test').disabled = true;
    showStatus('正在验证 Token 并检查可见页面…', true);
    try {
      await fetch('/wake');
    } catch (e) {
      /* 广播重发与超时会提供最终反馈。 */
    }
    if (generation !== testSeq) return;

    var settled = false;
    var resendTimer = null;
    var deadline = null;

    function cleanup() {
      bc.removeEventListener('message', onMessage);
      if (deadline) clearTimeout(deadline);
      if (resendTimer) clearInterval(resendTimer);
      if (cancelActiveTest === cancel) cancelActiveTest = null;
    }

    function cancel() {
      if (settled) return;
      settled = true;
      cleanup();
    }

    cancelActiveTest = cancel;
    deadline = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      showStatus('检查超时——请稍后重试', true);
      void load();
    }, 15000);

    function onMessage(event) {
      var message = event && event.data;
      if (!message || message.type !== 'test-connection-result' || message.reqId !== reqId) return;
      if (settled) return;
      settled = true;
      cleanup();

      if (!message.ok) {
        showStatus(message.message || 'Token 无效，请检查后重新保存', true);
      } else if (message.visibilityError) {
        showStatus('Token 有效，但页面检查失败：' + message.visibilityError, true);
      } else if (!message.visibleCount) {
        showStatus('Token 有效，但还没有授权任何 Notion 页面。', true);
      } else {
        showStatus('连接完成，Cindy 已能读取授权内容');
      }
      void load();
    }

    bc.addEventListener('message', onMessage);
    var send = function () {
      bc.postMessage({ type: 'test-connection', reqId: reqId });
    };
    send();
    resendTimer = setInterval(function () {
      if (settled) {
        clearInterval(resendTimer);
        return;
      }
      send();
    }, 400);
  }

  async function clearConnection() {
    $('clear').disabled = true;
    try {
      var response = await fetch('/secrets/' + KEY, { method: 'DELETE' });
      if (response.status !== 204) {
        throw new Error('secret delete failed');
      }
      try {
        var kv = await (await fetch('/kv')).json();
        if (kv && typeof kv === 'object') {
          delete kv.notionIdentity;
          await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
        }
      } catch (e) {
        /* 展示缓存清理失败不影响凭证清除。 */
      }
      showStatus('Notion 连接已清除');
    } catch (e) {
      showStatus('清除失败，请重试', true);
    } finally {
      await load();
    }
  }

  $('steps-toggle').addEventListener('click', function () {
    stepsExpanded = !stepsExpanded;
    render();
  });

  $('rebind').addEventListener('click', function () {
    if (!saved) {
      stepsExpanded = true;
      openStepId = 'step-create';
      render();
      return;
    }
    if (!hasVisibleContent()) {
      stepsExpanded = true;
      openStepId = 'step-access';
      void test();
      render();
      return;
    }
    rebindMode = true;
    stepsExpanded = true;
    openStepId = 'step-token';
    render();
    $('token').focus();
  });

  $('eye').addEventListener('click', function () {
    var input = $('token');
    var reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('eye').textContent = reveal ? '隐藏' : '显示';
  });
  $('token').addEventListener('input', syncEye);
  $('token').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
  });
  $('save').addEventListener('click', function () {
    void save();
  });
  $('test').addEventListener('click', function () {
    void test();
  });
  $('clear').addEventListener('click', function () {
    void clearConnection();
  });

  document.querySelectorAll('.step-head').forEach(function (head) {
    head.addEventListener('click', function () {
      var step = head.closest('.step');
      openStepId = step.id;
      stepsExpanded = true;
      render();
    });
  });

  syncEye();
  void load();
})();
