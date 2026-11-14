'use strict';

const dom = {
  sourceSelect: document.getElementById('source-select'),
  btnLoad: document.getElementById('btn-load'),
  btnAdd: document.getElementById('btn-add'),
  btnRemove: document.getElementById('btn-remove'),
  counter: document.getElementById('counter'),
  addBar: document.getElementById('add-bar'),
  addName: document.getElementById('add-name'),
  addUrl: document.getElementById('add-url'),
  addSave: document.getElementById('add-save'),
  addCancel: document.getElementById('add-cancel'),
  search: document.getElementById('search'),
  groups: document.getElementById('groups'),
  channels: document.getElementById('channels'),
  sideEmpty: document.getElementById('side-empty'),
  player: document.getElementById('player'),
  playerHint: document.getElementById('player-hint'),
  nowName: document.getElementById('now-name'),
  nowGroup: document.getElementById('now-group'),
  btnMpv: document.getElementById('btn-mpv'),
  btnFav: document.getElementById('btn-fav'),
  btnCopy: document.getElementById('btn-copy'),
  epg: document.getElementById('epg'),
  toast: document.getElementById('toast')
};

const state = {
  sources: [],
  favorites: [],
  channels: [],
  groups: [],
  group: '',
  keyword: '',
  current: null,
  mpvReady: false
};

let toastTimer = null;

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 2800);
}

function isFavorite(channel) {
  const key = channel.tvgId || channel.url;
  return state.favorites.some((row) => row.key === key || row.url === channel.url);
}

function renderSources() {
  dom.sourceSelect.textContent = '';
  if (!state.sources.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '尚未添加播放列表';
    dom.sourceSelect.appendChild(option);
    return;
  }
  state.sources.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.id;
    option.textContent = row.name || row.url;
    dom.sourceSelect.appendChild(option);
  });
}

function renderGroups() {
  dom.groups.textContent = '';
  const build = (label, value) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${state.group === value ? ' active' : ''}`;
    chip.textContent = label;
    chip.addEventListener('click', () => {
      state.group = value;
      renderGroups();
      renderChannels();
    });
    dom.groups.appendChild(chip);
  };
  build(`全部 ${state.channels.length}`, '');
  state.groups.forEach((group) => build(`${group.name} ${group.count}`, group.name));
}

function filteredChannels() {
  const keyword = state.keyword.trim().toLowerCase();
  return state.channels.filter((channel) => {
    if (state.group && channel.group !== state.group) return false;
    if (!keyword) return true;
    return String(channel.name || '').toLowerCase().includes(keyword)
      || String(channel.group || '').toLowerCase().includes(keyword);
  });
}

function renderChannels() {
  const rows = filteredChannels();
  dom.channels.textContent = '';
  dom.sideEmpty.hidden = rows.length > 0;
  if (!rows.length) dom.sideEmpty.textContent = state.channels.length ? '没有匹配的频道' : '选择或添加播放列表后加载频道';

  rows.slice(0, 800).forEach((channel) => {
    const li = document.createElement('li');
    li.className = `channel${state.current && state.current.url === channel.url ? ' active' : ''}`;

    const name = document.createElement('span');
    name.className = 'ch-name';
    name.textContent = channel.name || channel.url;

    const group = document.createElement('span');
    group.className = 'ch-group';
    group.textContent = channel.group || '';

    li.appendChild(name);
    if (channel.group) li.appendChild(group);
    if (isFavorite(channel)) {
      const star = document.createElement('span');
      star.className = 'star';
      star.textContent = '★';
      li.appendChild(star);
    }

    li.addEventListener('click', () => playChannel(channel));
    dom.channels.appendChild(li);
  });
}

function playChannel(channel) {
  state.current = channel;
  dom.nowName.textContent = channel.name || '未命名频道';
  dom.nowGroup.textContent = channel.group || '';
  dom.btnMpv.disabled = false;
  dom.btnFav.disabled = false;
  dom.btnCopy.disabled = false;
  dom.btnFav.textContent = isFavorite(channel) ? '取消收藏' : '收藏';
  renderChannels();

  const url = channel.url || '';
  const isHls = /\.m3u8(\?|$)/i.test(url);
  const nativeHls = dom.player.canPlayType('application/vnd.apple.mpegurl');

  dom.playerHint.hidden = true;
  dom.player.src = url;
  dom.player.play().catch(() => {
    dom.playerHint.hidden = false;
    dom.playerHint.querySelector('p').textContent = '当前内核无法直接播放该流';
    dom.playerHint.querySelector('span').textContent = '请点击"用 MPV 播放"，使用内置播放内核播放 HLS 直播流。';
  });

  if (isHls && !nativeHls && state.mpvReady) {
    toast('检测到 HLS 流，建议点击"用 MPV 播放"');
  }
}

async function loadChannels(sourceId) {
  const result = await window.fnos.live.load(sourceId || '');
  if (!result || !result.ok) {
    toast((result && result.error) || '加载播放列表失败');
    return;
  }
  state.channels = result.channels || [];
  state.groups = result.groups || [];
  state.group = '';
  dom.counter.textContent = `${state.channels.length} 个频道`;
  renderGroups();
  renderChannels();
}

async function refreshState(loadList) {
  const data = await window.fnos.live.state();
  state.sources = (data && data.sources) || [];
  state.favorites = (data && data.favorites) || [];
  renderSources();
  if (loadList && state.sources.length) {
    dom.sourceSelect.value = state.sources[0].id;
    await loadChannels(state.sources[0].id);
  }
}

dom.btnLoad.addEventListener('click', () => loadChannels(dom.sourceSelect.value));

dom.btnAdd.addEventListener('click', () => {
  dom.addBar.hidden = !dom.addBar.hidden;
  if (!dom.addBar.hidden) dom.addUrl.focus();
});

dom.addCancel.addEventListener('click', () => {
  dom.addBar.hidden = true;
  dom.addName.value = '';
  dom.addUrl.value = '';
});

dom.addSave.addEventListener('click', async () => {
  const url = dom.addUrl.value.trim();
  if (!url) {
    toast('请输入播放列表地址');
    return;
  }
  const result = await window.fnos.live.addSource({ name: dom.addName.value.trim(), url });
  if (!result || !result.ok) {
    toast((result && result.error) || '保存失败');
    return;
  }
  dom.addBar.hidden = true;
  dom.addName.value = '';
  dom.addUrl.value = '';
  await refreshState(false);
  dom.sourceSelect.value = result.source.id;
  await loadChannels(result.source.id);
});

dom.btnRemove.addEventListener('click', async () => {
  const id = dom.sourceSelect.value;
  if (!id) return;
  const result = await window.fnos.live.removeSource(id);
  if (!result || !result.ok) {
    toast('删除失败');
    return;
  }
  state.channels = [];
  state.groups = [];
  dom.counter.textContent = '0 个频道';
  renderGroups();
  renderChannels();
  await refreshState(false);
});

dom.search.addEventListener('input', () => {
  state.keyword = dom.search.value || '';
  renderChannels();
});

dom.btnFav.addEventListener('click', async () => {
  if (!state.current) return;
  const result = await window.fnos.live.favorite(state.current);
  if (!result || !result.ok) {
    toast('收藏失败');
    return;
  }
  state.favorites = result.favorites || [];
  dom.btnFav.textContent = isFavorite(state.current) ? '取消收藏' : '收藏';
  renderChannels();
});

dom.btnCopy.addEventListener('click', async () => {
  if (!state.current) return;
  try {
    await navigator.clipboard.writeText(state.current.url || '');
    toast('频道地址已复制');
  } catch (err) {
    toast('复制失败');
  }
});

dom.btnMpv.addEventListener('click', async () => {
  if (!state.current) return;
  const result = await window.fnos.live.playMpv(state.current);
  if (!result || !result.ok) toast((result && result.error) || 'MPV 播放失败');
});

async function init() {
  try {
    const status = await window.fnos.mpv.status();
    state.mpvReady = !!(status && status.available);
  } catch (err) {
    state.mpvReady = false;
  }
  await refreshState(true);
}

init().catch(() => toast('初始化失败'));
