'use strict';

/**
 * 设备地址解析：把用户输入统一成可访问的 URL。
 * 支持：局域网 IP、带端口 IP、域名、完整 URL、FN ID、FN ID 链接。
 *
 * 端口规则：
 *  - IP 未写端口：http -> 5666，https -> 5667
 *  - 局域网主机名（.local / .lan / .home.arpa）未写端口：与 IP 同样补默认端口
 *  - 公网域名未写端口：不补端口，保持 http://域名 / https://域名
 *  - 写显式端口：一律按输入端口，不做覆盖
 *  - FN ID：走 FN Connect 通道，固定 https://<id>.fnos.net
 *  - FN Connect 主机名（含容器应用子域名 app.<id>.fnos.net）：一律 https，端口原样保留；
 *    但中继只转发 443，非 443 端口会被标记 fnPortBlocked 供上层提示
 */

const net = require('net');

const FN_CONNECT_DOMAIN = 'fnos.net';
/* 飞牛 FN Connect 使用的两个域名（fnos.net / 5ddd.com），容器应用会以三级域名形式出现 */
const FN_CONNECT_DOMAINS = [FN_CONNECT_DOMAIN, '5ddd.com'];
const FN_STANDARD_PORT = '443';
const HTTP_DEFAULT_PORT = '5666';
const HTTPS_DEFAULT_PORT = '5667';

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_BRACKET_PATTERN = /^\[[0-9A-Fa-f:.]+\]$/;

/* 局域网专用主机名：Bonjour（.local）、常见路由器域（.lan）与家庭网络保留域 */
const LOCAL_HOST_PATTERN = /\.(?:local|lan|home\.arpa)$/i;

/** 主机类型：IPv4 点分四段、或 [IPv6] 视为 IP；其余视为域名。 */
function isIpHost(hostname) {
  const host = String(hostname || '').trim();
  if (!host) return false;
  if (IPV6_BRACKET_PATTERN.test(host)) return true;
  if (!IPV4_PATTERN.test(host)) return false;
  return host.split('.').every((segment) => {
    const value = Number(segment);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function trimTrailingSlash(href) {
  return href.endsWith('/') ? href.slice(0, -1) : href;
}

function isFnIdToken(value) {
  if (!value) return false;
  if (!/^[A-Za-z0-9-]{3,60}$/.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
}

function isFnConnectHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return FN_CONNECT_DOMAINS.some((domain) => host === domain || host.endsWith('.' + domain));
}

function fnIdToUrl(id) {
  const normalized = String(id || '').replace(/^fn-/i, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) return null;
  return 'https://' + normalized + '.' + FN_CONNECT_DOMAIN;
}

/** FN Connect 目标：中继只走 https，非 443 端口标记 fnPortBlocked（中继无法转发） */
function fnTargetOf(hostname, port, domain) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  const portValue = port ? String(port) : '';
  const url = 'https://' + host + (portValue ? ':' + portValue : '');
  return {
    url,
    bare: url,
    hostname: host,
    protocol: 'https:',
    explicitPort: Boolean(portValue),
    defaultPort: false,
    hostKind: 'fn',
    localHost: false,
    fnConnect: true,
    fnDomain: domain || FN_CONNECT_DOMAIN,
    port: portValue || FN_STANDARD_PORT,
    fnPortBlocked: Boolean(portValue) && portValue !== FN_STANDARD_PORT
  };
}

function buildFnTarget(id, port) {
  const url = fnIdToUrl(id);
  if (!url) return null;
  const parsed = new URL(url);
  return fnTargetOf(parsed.hostname, port, FN_CONNECT_DOMAIN);
}

/** 任意层级 FN Connect 主机名：<id>.fnos.net、app.<id>.fnos.net、<id>.5ddd.com */
function buildFnHostTarget(hostname, port) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (labels.length < 3) return null;
  const domain = labels.slice(-2).join('.');
  const prefix = labels.slice(0, -2).join('.');
  if (!prefix) return null;
  return fnTargetOf(host, port, domain);
}

/**
 * 从原始输入中读取显式端口。
 * URL 解析会把 http://x:80、https://x:443 的端口规范化掉，因此必须回到原文判断。
 * @returns {string} 显式端口字符串，未写端口返回空串
 */
function readExplicitPort(raw) {
  const value = String(raw || '');
  const schemeMatch = value.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//);
  let rest = schemeMatch ? value.slice(schemeMatch[0].length) : value;
  rest = rest.split(/[/?#]/)[0];
  if (!rest) return '';

  /* 凭据形态 user:pass@host 先剥离 */
  const atIndex = rest.lastIndexOf('@');
  if (atIndex >= 0) rest = rest.slice(atIndex + 1);

  if (rest.startsWith('[')) {
    const match = rest.match(/^\[[^\]]*\]:(\d{1,5})$/);
    return match ? match[1] : '';
  }
  const match = rest.match(/:(\d{1,5})$/);
  return match ? match[1] : '';
}

/**
 * 把原始输入拆成结构化目标；无法识别时返回 null。
 * @returns {{url:string,bare:string,hostname:string,protocol:string,explicitPort:boolean,defaultPort:boolean,hostKind:'ip'|'domain'|'fn',localHost:boolean,fnConnect:boolean}|null}
 */
function parseTarget(input) {
  let value = String(input || '').trim();
  if (!value) return null;
  value = value.replace(/\s+/g, '');

  /* FN ID 链接：fnos.net/abc123、https://fnos.net/abc123、5ddd.com/abc123 */
  let match = value.match(/^(?:https?:\/\/)?(?:www\.)?(?:fnos\.net|5ddd\.com)\/([A-Za-z0-9-]{2,})\/?$/i);
  if (match) return buildFnTarget(match[1]);

  /* FN Connect 主机名：abc123.fnos.net、fn-abc123.fnos.net、app.abc123.fnos.net、abc123.5ddd.com（可带端口） */
  match = value.match(/^(?:https?:\/\/)?([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/?$/i);
  if (match && isFnConnectHost(match[1])) {
    const hostTarget = buildFnHostTarget(match[1], match[2]);
    if (hostTarget) return hostTarget;
  }

  /* 裸 FN ID：abc123、fn-abc123（不含点、冒号、斜杠） */
  if (!/[./:\\]/.test(value) && isFnIdToken(value)) {
    const target = buildFnTarget(value);
    if (target) return target;
  }

  /* 裸 FN ID + 端口：abc123:8080 —— 仍属 FN Connect 通道，端口无法经中继直连 */
  match = value.match(/^([A-Za-z0-9-]{6,60}):(\d{1,5})$/);
  if (match && isFnIdToken(match[1])) {
    const target = buildFnTarget(match[1], match[2]);
    if (target) return target;
  }

  /* 其余按 URL 处理，缺协议时补 http:// */
  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
  let parsed;
  try {
    parsed = new URL(hasScheme ? value : 'http://' + value);
  } catch (err) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(parsed.hostname) && !IPV6_BRACKET_PATTERN.test(parsed.hostname)) return null;

  /* http(s)://fnos.net/<id> 归一为子域名 */
  const bareFnDomain = FN_CONNECT_DOMAINS.some((domain) => parsed.hostname === domain
    || parsed.hostname === 'www.' + domain);
  if (bareFnDomain) {
    const segment = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (!segment) return null;
    return buildFnTarget(segment);
  }

  /* 容器应用子域名 http(s)://app.<id>.fnos.net/path —— FN Connect 通道，强制 https */
  if (isFnConnectHost(parsed.hostname)) {
    const fnTarget = buildFnHostTarget(parsed.hostname, readExplicitPort(value));
    if (fnTarget) {
      const fnPath = parsed.pathname + parsed.search;
      if (fnPath && fnPath !== '/') {
        fnTarget.url = trimTrailingSlash(fnTarget.url + fnPath);
        fnTarget.bare = fnTarget.url;
      }
      return fnTarget;
    }
  }

  const explicitPortValue = readExplicitPort(value);
  const explicitPort = Boolean(explicitPortValue);
  const hostKind = isIpHost(parsed.hostname) ? 'ip' : 'domain';
  /* 局域网主机名与 IP 同属直连设备：都没写端口时按 NAS 默认端口补全 */
  const localHost = hostKind === 'ip' || LOCAL_HOST_PATTERN.test(parsed.hostname);

  /* 端口填充：局域网地址（IP / .local 等主机名）未写端口才补默认端口；公网域名与显式端口一律保持原样 */
  let port = explicitPortValue;
  let defaultPort = false;
  if (!explicitPort && localHost) {
    port = parsed.protocol === 'https:' ? HTTPS_DEFAULT_PORT : HTTP_DEFAULT_PORT;
    defaultPort = true;
  }

  const path = parsed.pathname + parsed.search;
  const hostPort = port ? parsed.hostname + ':' + port : parsed.hostname;
  const url = trimTrailingSlash(parsed.protocol + '//' + hostPort + path);
  const bare = trimTrailingSlash(parsed.protocol + '//' + parsed.host + path);

  return {
    url,
    bare,
    hostname: parsed.hostname,
    protocol: parsed.protocol,
    explicitPort,
    defaultPort,
    hostKind,
    localHost,
    fnConnect: false
  };
}

function normalizeUrl(input) {
  const target = parseTarget(input);
  return target ? target.url : '';
}

/**
 * TCP 端口探测（保留导出，供诊断等场景按需调用）。
 * resolveServerInput 不再调用本函数，地址登录一律按解析结果直接使用。
 */
function probePort(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout || 1500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try {
      socket.connect(Number(port), host);
    } catch (err) {
      finish(false);
    }
  });
}

/**
 * 解析地址：不做端口探测，直接返回按规则补全后的 URL。
 * 保留异步签名，调用方无需改动 await 写法。
 * @returns {Promise<{ok:boolean,url?:string,hostKind?:string,localHost?:boolean,explicitPort?:boolean,defaultPort?:boolean,error?:string}>}
 */
async function resolveServerInput(input) {
  const target = withPrivateFlag(input && input.url);
  if (!target) {
    return { ok: false, error: '地址无效：请填写局域网 IP、带端口 IP、域名、完整 URL 或 FN ID' };
  }
  return {
    ok: true,
    url: target.url,
    hostKind: target.hostKind,
    localHost: target.localHost,
    privateHost: target.privateHost,
    explicitPort: target.explicitPort,
    defaultPort: target.defaultPort,
    fnConnect: !!target.fnConnect,
    fnPortBlocked: !!target.fnPortBlocked,
    port: target.port || ''
  };
}

/* ---------------- 局域网判定与连接前诊断 ---------------- */

/**
 * 是否为局域网/私有网段地址：macOS 对这类访问会走「本地网络」授权，
 * 被拒绝时表现为连接直接超时（公网域名、FN ID 不受影响）。
 * @param {string} host
 * @returns {boolean}
 */
function isPrivateHost(host) {
  const value = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return false;
  if (LOCAL_HOST_PATTERN.test(value)) return true;
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!parts) return false;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 169 && second === 254) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return false;
}

/** 解析地址并补 privateHost 标记；FN ID 走公网通道，不算局域网 */
function withPrivateFlag(input) {
  const target = parseTarget(input);
  if (!target) return target;
  return Object.assign({}, target, {
    privateHost: !target.fnConnect && isPrivateHost(target.hostname)
  });
}

/**
 * 连接前做一次 TCP 探测：区分「端口不通」与「被系统拦下」，
 * 同时让主进程主动发起连接，触发 macOS 的本地网络授权弹窗。
 * @param {string} host
 * @param {number} port
 * @param {number} [timeout]
 * @returns {Promise<{status:string,elapsed:number,detail:string}>}
 */
function diagnose(host, port, timeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (status, detail) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (err) {
        /* 忽略销毁异常 */
      }
      resolve({ status, elapsed: Date.now() - started, detail: detail || '' });
    };
    socket.setTimeout(timeout || 2500);
    socket.once('connect', () => finish('ok'));
    socket.once('timeout', () => finish('timeout', '连接超时'));
    socket.once('error', (err) => finish((err && err.code) || 'error', (err && err.message) || ''));
    try {
      socket.connect(Number(port), host);
    } catch (err) {
      finish('error', String(err && err.message));
    }
  });
}

module.exports = {
  FN_CONNECT_DOMAIN,
  FN_CONNECT_DOMAINS,
  FN_STANDARD_PORT,
  HTTP_DEFAULT_PORT,
  HTTPS_DEFAULT_PORT,
  isIpHost,
  isPrivateHost,
  isFnConnectHost,
  parseTarget: withPrivateFlag,
  normalizeUrl,
  probePort,
  diagnose,
  resolveServerInput
};
