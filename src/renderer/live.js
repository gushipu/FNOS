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
  lineSelect: document.getElementById('line-select'),
  btnProbe: document.getElementById('btn-probe'),
  btnCatchup: document.getElementById('btn-catchup'),
  catchup: document.getElementById('catchup'),
  catchupStart: document.getElementById('catchup-start'),
  catchupEnd: document.getElementById('catchup-end'),
  catchupPlay: document.getElementById('catchup-play'),
  catchupClose: document.getElementById('catchup-close'),
  catchupHint: document.getElementById('catchup-hint'),
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
  syncCatchup(channel);
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
  const result = await window.fnos.live.load({ sourceId: sourceId || '', line: dom.lineSelect.value || '' });
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

/* ---------------- P1-1 线路锁定与探测 ---------------- */
function lineLabel(line) {
  return ({ inner: '内网直连', ipv6: 'IPv6', frp: '公网穿透' })[line] || '自动';
}

dom.lineSelect.addEventListener('change', async () => {
  const line = dom.lineSelect.value;
  try {
    await window.fnos.live.setLine(line || '');
  } catch (err) { /* 忽略 */ }
  toast(line ? `已锁定线路：${lineLabel(line)}` : '已改为自动选线');
});

dom.btnProbe.addEventListener('click', async () => {
  const target = (state.current && state.current.url)
    || (state.sources[0] && state.sources[0].url) || '';
  if (!target) { toast('先加载一个播放列表再测速'); return; }
  dom.btnProbe.disabled = true;
  dom.btnProbe.textContent = '测速中…';
  try {
    const result = await window.fnos.live.probeLines(target);
    if (!result || result.ok === false) {
      toast((result && result.error) || '线路探测失败');
      return;
    }
    const rows = result.results || [];
    const okRows = rows.filter((row) => row.ok);
    if (okRows.length) {
      const best = okRows.slice().sort((a, b) => (a.ms || 0) - (b.ms || 0))[0];
      toast(`可用线路：${okRows.map((row) => `${lineLabel(row.line)} ${row.ms}ms`).join(' / ')}（建议 ${lineLabel(best.line)}）`);
    } else {
      toast('三条线路都没探测通，检查 NAS 的 DDNS / IPv6 / FN Connect');
    }
  } catch (err) {
    toast('线路探测失败');
  } finally {
    dom.btnProbe.disabled = false;
    dom.btnProbe.textContent = '测速';
  }
});

/* ---------------- P1-2 直播回看 ---------------- */
function pad2(value) {
  return String(value).padStart(2, '0');
}

function localInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function syncCatchup(channel) {
  const support = !!(channel && (channel.catchup || channel.catchupSource));
  dom.btnCatchup.disabled = !support;
  dom.btnCatchup.title = support ? '按时间回看该频道' : '该频道播放列表未提供回看（catchup）信息';
  if (!support) dom.catchup.hidden = true;
}

dom.btnCatchup.addEventListener('click', () => {
  if (!state.current) return;
  const now = Date.now();
  if (!dom.catchupStart.value) dom.catchupStart.value = localInput(now - 30 * 60 * 1000);
  if (!dom.catchupEnd.value) dom.catchupEnd.value = localInput(now);
  const days = Number(state.current.catchupDays) || 7;
  dom.catchupHint.textContent = `该频道支持回看 ${days} 天；时间按 NAS 所在时区填写`;
  dom.catchup.hidden = !dom.catchup.hidden;
});

dom.catchupClose.addEventListener('click', () => {
  dom.catchup.hidden = true;
});

dom.catchupPlay.addEventListener('click', async () => {
  if (!state.current) return;
  const start = dom.catchupStart.value ? new Date(dom.catchupStart.value).getTime() : 0;
  const end = dom.catchupEnd.value ? new Date(dom.catchupEnd.value).getTime() : 0;
  if (!start || !end || end <= start) { toast('请填写正确的起止时间'); return; }
  const result = await window.fnos.live.catchup({ channel: state.current, start, end });
  if (!result || !result.ok) {
    toast((result && result.error) || '该频道不支持回看');
    return;
  }
  playUrl(result.url, `${state.current.name || '频道'} · 回看`);
});

function playUrl(url, title) {
  if (!url) return;
  dom.playerHint.hidden = true;
  dom.player.src = url;
  dom.player.play().catch(() => {
    dom.playerHint.hidden = false;
    dom.playerHint.querySelector('p').textContent = '当前内核无法直接播放该流';
    dom.playerHint.querySelector('span').textContent = '请点击"用 MPV 播放"，使用内置播放内核播放。';
  });
  if (title) dom.nowGroup.textContent = title;
}

async function init() {
  try {
    const status = await window.fnos.mpv.status();
    state.mpvReady = !!(status && status.available);
  } catch (err) {
    state.mpvReady = false;
  }
  try {
    const settings = await window.fnos.settings.get();
    const line = (settings && settings.liveLine) || '';
    dom.lineSelect.value = ['inner', 'ipv6', 'frp'].indexOf(line) >= 0 ? line : '';
  } catch (err) { /* 忽略 */ }
  await refreshState(true);
}

init().catch(() => toast('初始化失败'));
