(function () {
  'use strict';

  var CHANNEL = 'taptap-maker-settings';
  var bc = new BroadcastChannel(CHANNEL);
  var stateDot = document.getElementById('state-dot');
  var accountState = document.getElementById('account-state');
  var connectButton = document.getElementById('connect');
  var patForm = document.getElementById('pat-form');
  var getPatButton = document.getElementById('get-pat');
  var patInput = document.getElementById('pat');
  var savePatButton = document.getElementById('save-pat');
  var refreshProjectsButton = document.getElementById('refresh-projects');
  var projectFilter = document.getElementById('project-filter');
  var projectsElement = document.getElementById('projects');
  var selectedCount = document.getElementById('selected-count');
  var syncProjectsButton = document.getElementById('sync-projects');
  var message = document.getElementById('message');
  var projectMessage = document.getElementById('project-message');

  var busy = false;
  var accountConnected = false;
  var projects = [];
  var selectedProjectIds = new Set();
  var nextRequestId = 1;

  function request(action, payload, longRunning) {
    return new Promise(async function executor(resolve, reject) {
      var reqId = 'settings-' + Date.now() + '-' + nextRequestId++;
      var settled = false;
      var interval = null;
      var timeout = null;

      function cleanup() {
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        bc.removeEventListener('message', onMessage);
      }

      function onMessage(event) {
        var response = event && event.data;
        if (!response || response.type !== 'settings-result' || response.reqId !== reqId) return;
        if (settled) return;
        settled = true;
        cleanup();
        if (response.ok === true) resolve(response.result || {});
        else reject(new Error(response.message || 'TapTap Maker 设置操作失败'));
      }

      function post() {
        bc.postMessage({
          type: 'settings-request',
          reqId: reqId,
          action: action,
          payload: payload || {},
        });
      }

      bc.addEventListener('message', onMessage);
      try {
        await fetch('/wake');
      } catch (_error) {
        // 重发机制会继续等待已在启动中的逻辑页。
      }
      post();
      interval = setInterval(post, 400);
      timeout = setTimeout(function onTimeout() {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('TapTap Maker 插件响应超时，请稍后重试'));
      }, longRunning ? 15 * 60 * 1000 : 60 * 1000);
    });
  }

  function renderState(state, patHint) {
    stateDot.className = 'dot ' + state;
    accountConnected = state === 'connected';
    if (state === 'connected') {
      accountState.textContent = '已连接 TapTap Maker';
      patInput.placeholder = patHint || '已连接，可粘贴新 PAT 覆盖';
    } else if (state === 'disconnected') {
      accountState.textContent = '尚未连接';
      patInput.placeholder = '粘贴 TapTap Maker PAT';
    } else {
      accountState.textContent = '暂时无法验证登录状态';
      patInput.placeholder = '粘贴 TapTap Maker PAT';
    }
    updateControls();
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    updateControls();
  }

  function updateControls() {
    connectButton.disabled = busy;
    getPatButton.disabled = busy;
    patInput.disabled = busy;
    savePatButton.disabled = busy;
    refreshProjectsButton.disabled = busy || !accountConnected;
    projectFilter.disabled = busy || !accountConnected;
    syncProjectsButton.disabled = busy || !accountConnected || selectedProjectIds.size === 0;
    Array.from(projectsElement.querySelectorAll('input[type="checkbox"]')).forEach(function disable(checkbox) {
      checkbox.disabled = busy;
    });
    selectedCount.textContent = '已选择 ' + selectedProjectIds.size + ' 个';
  }

  function projectActivityText(project) {
    if (!project.lastActiveAt) return project.id;
    var date = new Date(project.lastActiveAt);
    if (Number.isNaN(date.getTime())) return project.id;
    return project.id + ' · 最近活动 ' + date.toLocaleDateString('zh-CN');
  }

  function renderProjects() {
    projectsElement.replaceChildren();
    if (!accountConnected) {
      var disconnected = document.createElement('div');
      disconnected.className = 'empty';
      disconnected.textContent = '连接账号后加载项目';
      projectsElement.append(disconnected);
      updateControls();
      return;
    }

    var query = projectFilter.value.trim().toLocaleLowerCase();
    var visible = projects.filter(function matches(project) {
      return !query
        || project.name.toLocaleLowerCase().includes(query)
        || project.id.toLocaleLowerCase().includes(query);
    }).slice(0, 5);
    if (visible.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = projects.length === 0 ? '暂无可用项目' : '没有匹配的项目';
      projectsElement.append(empty);
      updateControls();
      return;
    }

    visible.forEach(function renderProject(project) {
      var row = document.createElement('label');
      row.className = 'project-row';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedProjectIds.has(project.id);
      checkbox.addEventListener('change', function onChange() {
        if (checkbox.checked) {
          if (selectedProjectIds.size >= 5) {
            checkbox.checked = false;
            projectMessage.textContent = '一次最多同步 5 个项目';
            return;
          }
          selectedProjectIds.add(project.id);
        } else {
          selectedProjectIds.delete(project.id);
        }
        updateControls();
      });
      var main = document.createElement('span');
      main.className = 'project-main';
      var name = document.createElement('div');
      name.className = 'project-name';
      name.textContent = project.name;
      var meta = document.createElement('div');
      meta.className = 'project-meta';
      meta.textContent = projectActivityText(project);
      main.append(name, meta);
      row.append(checkbox, main);
      projectsElement.append(row);
    });
    updateControls();
  }

  async function refreshProjects() {
    if (!accountConnected) {
      projects = [];
      selectedProjectIds.clear();
      renderProjects();
      return;
    }
    projectsElement.replaceChildren();
    var loading = document.createElement('div');
    loading.className = 'empty';
    loading.textContent = '正在加载项目…';
    projectsElement.append(loading);
    try {
      var result = await request('projects', {}, false);
      projects = Array.isArray(result.projects)
        ? result.projects.filter(function valid(project) {
          return project && typeof project.id === 'string' && typeof project.name === 'string';
        })
        : [];
      var availableIds = new Set(projects.map(function id(project) { return project.id; }));
      Array.from(selectedProjectIds).forEach(function removeUnavailable(id) {
        if (!availableIds.has(id)) selectedProjectIds.delete(id);
      });
      renderProjects();
    } catch (error) {
      projects = [];
      selectedProjectIds.clear();
      renderProjects();
      projectMessage.textContent = error.message || 'TapTap Maker 项目列表获取失败，请重试';
    }
  }

  async function refreshAccount() {
    message.textContent = '';
    try {
      var result = await request('status', {}, false);
      renderState(result.state || 'unknown', result.patHint);
      await refreshProjects();
    } catch (_error) {
      renderState('unknown');
      await refreshProjects();
    }
  }

  connectButton.addEventListener('click', async function connect() {
    setBusy(true);
    accountState.textContent = '请在浏览器中完成 TapTap 授权…';
    message.textContent = '';
    try {
      var result = await request('login', {}, true);
      renderState('connected', result.patHint);
      await refreshProjects();
    } catch (error) {
      renderState('unknown');
      message.textContent = error.message || 'TapTap Maker 登录未完成，请重试';
    } finally {
      setBusy(false);
    }
  });

  getPatButton.addEventListener('click', async function openPatPage() {
    setBusy(true);
    message.textContent = '';
    try {
      await request('open_pat_page', {}, false);
      message.textContent = '已在系统默认浏览器打开 TapTap Maker PAT 页面';
    } catch (error) {
      message.textContent = error.message || '无法打开 TapTap Maker PAT 页面，请重试';
    } finally {
      setBusy(false);
    }
  });

  patForm.addEventListener('submit', async function savePat(event) {
    event.preventDefault();
    var pat = patInput.value.trim();
    if (!pat) {
      message.textContent = '请输入 TapTap Maker PAT';
      patInput.focus();
      return;
    }
    setBusy(true);
    accountState.textContent = '正在验证并保存 PAT…';
    message.textContent = '';
    try {
      var result = await request('set_pat', { pat: pat }, true);
      patInput.value = '';
      renderState('connected', result.patHint);
      message.textContent = 'PAT 已由 TapTap Maker Runtime 验证并保存';
      await refreshProjects();
    } catch (error) {
      renderState('unknown');
      message.textContent = error.message || 'TapTap Maker PAT 保存失败，请重试';
    } finally {
      // 完整 PAT 不写入任何持久化状态，交给 Runtime 后立即丢弃页面引用。
      pat = '';
      setBusy(false);
    }
  });

  refreshProjectsButton.addEventListener('click', async function refresh() {
    setBusy(true);
    projectMessage.textContent = '';
    try {
      await refreshProjects();
    } finally {
      setBusy(false);
    }
  });

  projectFilter.addEventListener('input', renderProjects);

  syncProjectsButton.addEventListener('click', async function syncProjects() {
    if (selectedProjectIds.size === 0) return;
    setBusy(true);
    projectMessage.textContent = '请选择父目录，随后将逐个同步所选项目…';
    try {
      var result = await request('sync_projects', {
        projectIds: Array.from(selectedProjectIds),
      }, true);
      if (result.canceled) {
        projectMessage.textContent = '已取消同步';
        return;
      }
      var results = Array.isArray(result.results) ? result.results : [];
      var succeeded = results.filter(function success(item) { return item && item.ok === true; });
      var failed = results.filter(function failure(item) { return !item || item.ok !== true; });
      succeeded.forEach(function clearSelection(item) { selectedProjectIds.delete(item.id); });
      renderProjects();
      if (failed.length === 0) {
        projectMessage.textContent = '已同步 ' + succeeded.length + ' 个项目到 ' + result.parentDir;
      } else {
        var failures = failed.map(function failureText(item) {
          var name = item && typeof item.name === 'string' ? item.name : '未知项目';
          var reason = item && typeof item.message === 'string' ? item.message : '同步失败，请重试';
          return name + '：' + reason;
        }).join('；');
        projectMessage.textContent = '已同步 ' + succeeded.length + ' 个，失败 ' + failed.length
          + (failures ? '。' + failures : '');
      }
    } catch (error) {
      projectMessage.textContent = error.message || 'TapTap Maker 项目同步失败，请重试';
    } finally {
      setBusy(false);
    }
  });

  updateControls();
  void refreshAccount();
}());
