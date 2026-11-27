'use strict';

/*
 * P1-7 请求头 / 跨域统一收敛
 * 统一在一个 onBeforeSendHeaders 里做 UA 兜底与媒体请求头规整：
 * - Electron 的 ses.webRequest 同一事件只保留最后一个回调，因此必须集中挂载（WeakSet 防重复）；
 * - onHeadersReceived 由 media.js 独占（媒体嗅探），本模块不重复挂载，避免互相覆盖；
 * - 页面已带的自定义业务头（例如 NAS 的鉴权头、防盗链头）原样保留，不删除、不改名。
 */
const log = require('./logger').create('headers');

const UA = 'Mozilla/5.0 (FNOS Desktop) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MEDIA_RE = /\.(m3u8|flv|mp4|mkv|mpd|ts|aac|flac|mp3)(\?|#|$)/i;
const hooked = new WeakSet();

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (err) {
    return '';
  }
}

function attach(ses) {
  if (!ses || hooked.has(ses)) return false;
  hooked.add(ses);
  try {
    ses.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      const headers = Object.assign({}, details.requestHeaders || {});
      const url = String(details.url || '');
      if (!headers['User-Agent'] && !headers['user-agent']) headers['User-Agent'] = UA;
      const accept = String(headers['Accept'] || headers['accept'] || '');
      const isMedia = MEDIA_RE.test(url) || /mpegurl|octet-stream|dash\+xml/i.test(accept);
      if (isMedia) {
        const origin = originOf(url);
        if (origin) {
          if (!headers['Referer'] && !headers['referer']) headers['Referer'] = origin + '/';
          if (!headers['Origin'] && !headers['origin']) headers['Origin'] = origin;
        }
        /* 关掉缓存重校验头，避免部分 NAS 网关对 If-Range / If-None-Match 回 JSON */
        delete headers['If-None-Match'];
        delete headers['If-Modified-Since'];
      }
      callback({ requestHeaders: headers });
    });
  } catch (err) {
    log.error('请求头收敛挂载失败', err && err.message);
    return false;
  }
  return true;
}

function attachContents(contents) {
  try {
    if (!contents || contents.isDestroyed()) return false;
    return attach(contents.session);
  } catch (err) {
    return false;
  }
}

module.exports = { attach, attachContents, UA };
