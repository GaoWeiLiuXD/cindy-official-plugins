(function () {
  'use strict';

  var COPY = {
    zh: {
      title: 'Cindy 能力',
      desc: '分别为出图、改图、生成视频和图生视频选择模型，配置保存在 Art 插件内。',
      imageGenerate: '出图',
      imageEdit: '改图',
      videoGenerate: '生成视频',
      videoEdit: '图生视频',
      defaultOption: '{model}(默认)',
      noModels: '暂无可用模型',
      loading: '正在读取模型目录…',
      loadFailed: '模型配置加载失败，请重新打开设置页',
      saving: '正在保存…',
      saved: '已保存',
      saveFailed: '模型配置保存失败，请重试'
    },
    en: {
      title: 'Cindy abilities',
      desc: 'Choose a model for image generation, image editing, video generation and image-to-video. These settings are saved in the Art plugin.',
      imageGenerate: 'Image generation',
      imageEdit: 'Image editing',
      videoGenerate: 'Video generation',
      videoEdit: 'Image to video',
      defaultOption: '{model} (default)',
      noModels: 'No models available',
      loading: 'Loading model catalog…',
      loadFailed: 'Could not load model settings. Reopen this page.',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Could not save model settings. Try again.'
    },
    ja: {
      title: 'Cindy 機能',
      desc: '画像生成、画像編集、動画生成、画像から動画のモデルを個別に選択できます。設定は Art プラグイン内に保存されます。',
      imageGenerate: '画像生成',
      imageEdit: '画像編集',
      videoGenerate: '動画生成',
      videoEdit: '画像から動画',
      defaultOption: '{model}(既定)',
      noModels: '利用可能なモデルがありません',
      loading: 'モデル一覧を読み込み中…',
      loadFailed: 'モデル設定を読み込めませんでした。設定ページを開き直してください。',
      saving: '保存中…',
      saved: '保存しました',
      saveFailed: 'モデル設定を保存できませんでした。再試行してください。'
    },
    ko: {
      title: 'Cindy 기능',
      desc: '이미지 생성, 이미지 편집, 동영상 생성, 이미지에서 동영상 생성에 사용할 모델을 각각 선택하세요. 설정은 Art 플러그인에 저장됩니다.',
      imageGenerate: '이미지 생성',
      imageEdit: '이미지 편집',
      videoGenerate: '동영상 생성',
      videoEdit: '이미지에서 동영상',
      defaultOption: '{model}(기본)',
      noModels: '사용 가능한 모델이 없습니다',
      loading: '모델 목록을 불러오는 중…',
      loadFailed: '모델 설정을 불러오지 못했습니다. 설정 페이지를 다시 열어 주세요.',
      saving: '저장 중…',
      saved: '저장됨',
      saveFailed: '모델 설정을 저장하지 못했습니다. 다시 시도해 주세요.'
    }
  };

  function localeKey() {
    var lang = String(document.documentElement.lang || 'zh').toLowerCase();
    if (lang.indexOf('zh') === 0) return 'zh';
    if (lang.indexOf('ja') === 0) return 'ja';
    if (lang.indexOf('ko') === 0) return 'ko';
    return 'en';
  }

  var copy = COPY[localeKey()] || COPY.en;
  function t(key, vars) {
    var value = copy[key] || COPY.en[key] || key;
    return vars ? value.replace(/\{(\w+)\}/g, function (_, name) { return String(vars[name] || ''); }) : value;
  }

  var CAPABILITIES = [
    { key: 'image.generate', type: 'image', label: 'imageGenerate', input: ['text'], output: 'image' },
    { key: 'image.edit', type: 'image', label: 'imageEdit', input: ['text', 'image'], output: 'image' },
    { key: 'video.generate', type: 'video', label: 'videoGenerate', input: ['text'], output: 'video' },
    { key: 'video.edit', type: 'video', label: 'videoEdit', input: ['text', 'image'], output: 'video' }
  ];

  var providerMark = artSettingsIcons.providerMark;

  var root = document.getElementById('capabilities');
  var status = document.getElementById('status');
  var catalogs = { image: { models: [], defaultModelId: null }, video: { models: [], defaultModelId: null } };
  var state = {};
  var overrides = {};
  var lastSavedOverrides = {};
  var writeQueue = Promise.resolve();

  function setStatus(message, isError) {
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  function readJson(path, fallback) {
    return fetch(path)
      .then(function (response) {
        if (!response.ok) throw new Error('request failed');
        return response.json();
      })
      .catch(function () { return fallback; });
  }

  async function readKvForWrite() {
    var response = await fetch('/kv');
    if (!response.ok) throw new Error('kv read failed');
    var value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('kv state invalid');
    return value;
  }

  function normalizeOverride(value) {
    if (typeof value === 'string' && value.trim()) return { modelId: value.trim() };
    if (value && typeof value === 'object' && typeof value.modelId === 'string' && value.modelId.trim()) {
      return {
        modelId: value.modelId.trim(),
        ...(typeof value.providerId === 'string' && value.providerId.trim()
          ? { providerId: value.providerId.trim() }
          : {})
      };
    }
    return null;
  }

  function legacyOverride(capability) {
    var id = state[capability.type + 'ModelId'];
    var providerId = state[capability.type + 'ModelProviderId'];
    return typeof id === 'string' && id.trim()
      ? { modelId: id.trim(), ...(typeof providerId === 'string' && providerId.trim() ? { providerId: providerId.trim() } : {}) }
      : null;
  }

  function configuredOverride(capability) {
    var map = state.modelOverrides && typeof state.modelOverrides === 'object' && !Array.isArray(state.modelOverrides)
      ? state.modelOverrides
      : null;
    if (map && Object.prototype.hasOwnProperty.call(map, capability.key)) {
      var normalized = normalizeOverride(map[capability.key]);
      if (normalized) return normalized;
    }
    return legacyOverride(capability);
  }

  function supportsCapability(model, capability) {
    var modalities = model && model.modalities;
    if (!modalities || !Array.isArray(modalities.input) || !Array.isArray(modalities.output)) return false;
    return capability.input.every(function (input) { return modalities.input.indexOf(input) !== -1; }) &&
      modalities.output.indexOf(capability.output) !== -1;
  }

  function availableModels(capability) {
    return catalogs[capability.type].models.filter(function (model) {
      return model && typeof model.id === 'string' && supportsCapability(model, capability);
    });
  }

  function defaultModel(capability, models) {
    var catalog = catalogs[capability.type];
    return models.find(function (model) {
      return model.id === catalog.defaultModelId &&
        (!catalog.defaultProviderId || model.providerId === catalog.defaultProviderId);
    }) || models[0] || null;
  }

  function optionRow(option, selected, capability) {
    return '<button class="model-option" type="button" role="option" aria-selected="' + selected + '"' +
      ' data-capability="' + capability.key + '"' +
      ' data-model-id="' + option.modelId.replace(/"/g, '&quot;') + '"' +
      ' data-provider-id="' + String(option.providerId || '').replace(/"/g, '&quot;') + '"' +
      ' data-default="' + String(option.isDefault) + '">' +
      (option.stale ? '' : providerMark(option)) +
      '<span class="option-label">' + option.label.replace(/</g, '&lt;') + '</span>' +
      (selected ? artSettingsIcons.icon('check', 'check') : '') +
      '</button>';
  }

  function renderRow(capability) {
    var models = availableModels(capability);
    var fallback = defaultModel(capability, models);
    var configured = configuredOverride(capability);
    var selected = configured
      ? models.find(function (model) {
          return model.id === configured.modelId &&
            model.providerId === (configured.providerId || 'xd');
        }) || (!configured.providerId
          ? models.find(function (model) { return model.id === configured.modelId; })
          : null) || null
      : null;
    var stale = configured && !selected ? configured : null;
    var triggerLabel = selected
      ? selected.name
      : stale
        ? stale.modelId
        : fallback
          ? t('defaultOption', { model: fallback.name })
          : t('noModels');
    var row = document.createElement('div');
    row.className = 'cap-row';
    row.dataset.capability = capability.key;
    row.innerHTML =
      '<span class="cap-label">' + t(capability.label) + '</span>' +
      (models.length === 0 && !stale
        ? '<span class="no-models">' + t('noModels') + '</span>'
        : '<div class="model-picker" data-capability="' + capability.key + '">' +
          '<button class="model-trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-label="' + t(capability.label) + '">' +
          (stale ? '' : providerMark(selected || fallback)) +
          '<span class="model-name">' + triggerLabel.replace(/</g, '&lt;') + '</span>' +
          artSettingsIcons.icon('chevron-down', 'chevron') +
          '</button>' +
          '<div class="model-popover"><div class="model-list" role="listbox" aria-label="' + t(capability.label) + '">' +
          (fallback ? optionRow({
            modelId: fallback.id,
            providerId: fallback.providerId,
            providerName: fallback.providerName,
            routing: fallback.routing,
            label: t('defaultOption', { model: fallback.name }),
            isDefault: true
          }, !configured, capability) : '') +
          models.filter(function (model) {
            return !fallback || model.id !== fallback.id || model.providerId !== fallback.providerId;
          }).map(function (model) {
            var active = selected && selected.id === model.id && selected.providerId === model.providerId;
            return optionRow({
              modelId: model.id,
              providerId: model.providerId,
              providerName: model.providerName,
              routing: model.routing,
              label: model.name || model.id,
              isDefault: false
            }, active, capability);
          }).join('') +
          (stale ? optionRow({
            modelId: stale.modelId,
            providerId: stale.providerId || '',
            label: stale.modelId,
            stale: true,
            isDefault: false
          }, true, capability) : '') +
          '</div></div></div>');
    root.appendChild(row);

    var picker = row.querySelector('.model-picker');
    if (!picker) return;
    var trigger = picker.querySelector('.model-trigger');
    var popover = picker.querySelector('.model-popover');
    trigger.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = !popover.classList.contains('open');
      document.querySelectorAll('.model-popover.open').forEach(function (item) { item.classList.remove('open'); });
      document.querySelectorAll('.model-trigger[aria-expanded="true"]').forEach(function (item) { item.setAttribute('aria-expanded', 'false'); });
      popover.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (open) positionPopover(trigger, popover);
    });
    popover.querySelectorAll('.model-option').forEach(function (option) {
      option.addEventListener('click', function (event) {
        event.stopPropagation();
        if (option.dataset.default === 'true') delete overrides[capability.key];
        else overrides[capability.key] = {
          modelId: option.dataset.modelId,
          ...(option.dataset.providerId ? { providerId: option.dataset.providerId } : {})
        };
        persistPreferences();
      });
    });
  }

  function positionPopover(trigger, popover) {
    var bounds = trigger.getBoundingClientRect();
    var list = popover.querySelector('.model-list');
    var below = Math.max(0, window.innerHeight - bounds.bottom - 6);
    var above = Math.max(0, bounds.top - 6);
    var desired = Math.min(300, list.scrollHeight) + 10;
    var placeAbove = desired > below && above > below;
    popover.dataset.side = placeAbove ? 'top' : 'bottom';
    popover.style.top = placeAbove ? 'auto' : '38px';
    popover.style.bottom = placeAbove ? '38px' : 'auto';
    list.style.maxHeight = Math.max(0, Math.min(300, (placeAbove ? above : below) - 10)) + 'px';
  }

  function render() {
    root.textContent = '';
    CAPABILITIES.forEach(renderRow);
  }

  function persistPreferences() {
    writeQueue = writeQueue.then(async function () {
      setStatus(t('saving'), false);
      var next = {};
      CAPABILITIES.forEach(function (capability) {
        var value = overrides[capability.key];
        if (value) next[capability.key] = value;
      });
      var kv = await readKvForWrite();
      kv.modelOverrides = next;
      delete kv.imageModelId;
      delete kv.imageModelProviderId;
      delete kv.videoModelId;
      delete kv.videoModelProviderId;
      var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
      if (!response.ok) throw new Error('kv write failed');
      state.modelOverrides = next;
      delete state.imageModelId;
      delete state.imageModelProviderId;
      delete state.videoModelId;
      delete state.videoModelProviderId;
      lastSavedOverrides = JSON.parse(JSON.stringify(next));
      render();
      setStatus('', false);
    }).catch(function () {
      overrides = JSON.parse(JSON.stringify(lastSavedOverrides));
      render();
      setStatus(t('saveFailed'), true);
    });
  }

  function load() {
    setStatus(t('loading'), false);
    Promise.all([
      readKvForWrite(),
      readJson('/media-models?type=image', { ok: false, models: [] }),
      readJson('/media-models?type=video', { ok: false, models: [] })
    ]).then(function (values) {
      state = values[0] && typeof values[0] === 'object' && !Array.isArray(values[0]) ? values[0] : {};
      catalogs.image = values[1] && values[1].ok === true ? values[1] : { models: [], defaultModelId: null };
      catalogs.video = values[2] && values[2].ok === true ? values[2] : { models: [], defaultModelId: null };
      overrides = {};
      CAPABILITIES.forEach(function (capability) {
        var configured = configuredOverride(capability);
        if (configured) overrides[capability.key] = configured;
      });
      lastSavedOverrides = JSON.parse(JSON.stringify(overrides));
      render();
      var noModels = CAPABILITIES.every(function (capability) { return availableModels(capability).length === 0; });
      setStatus(noModels ? t('noModels') : '', noModels);
    }).catch(function () {
      setStatus(t('loadFailed'), true);
    });
  }

  document.getElementById('card-icon').innerHTML = artSettingsIcons.icon('sparkles');
  document.getElementById('card-title').textContent = t('title');
  document.getElementById('card-desc').textContent = t('desc');
  document.addEventListener('click', function () {
    document.querySelectorAll('.model-popover.open').forEach(function (item) { item.classList.remove('open'); });
    document.querySelectorAll('.model-trigger[aria-expanded="true"]').forEach(function (item) { item.setAttribute('aria-expanded', 'false'); });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      document.querySelectorAll('.model-popover.open').forEach(function (item) { item.classList.remove('open'); });
      document.querySelectorAll('.model-trigger[aria-expanded="true"]').forEach(function (item) {
        item.setAttribute('aria-expanded', 'false');
        item.focus();
      });
    }
  });
  load();
})();
