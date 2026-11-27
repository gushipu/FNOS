'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const MAX_FILES = 7;
let logDir = '';
let current = '';
let stream = null;

function pad(n) {
  return String(n).padStart(2, '0');
}

function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function time(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function prune() {
  try {
    if (!logDir || !fs.existsSync(logDir)) return;
    const files = fs.readdirSync(logDir)
      .filter((name) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(name))
      .sort();
    while (files.length > MAX_FILES) {
      const name = files.shift();
      fs.unlinkSync(path.join(logDir, name));
    }
  } catch (err) { /* 清理失败不影响主流程 */ }
}

function ensure(date) {
  const name = `app-${stamp(date)}.log`;
  if (name === current && stream) return;
  try {
    if (stream) stream.end();
    logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    current = name;
    stream = fs.createWriteStream(path.join(logDir, name), { flags: 'a' });
    prune();
  } catch (err) {
    current = '';
    stream = null;
  }
}

function write(level, scope, args) {
  const now = new Date();
  ensure(now);
  const body = args.map((item) => {
    if (item instanceof Error) return item.stack || item.message;
    if (typeof item === 'string') return item;
    try { return JSON.stringify(item); } catch (err) { return String(item); }
  }).join(' ');
  const line = `[${time(now)}] [${level}] [${scope}] ${body}`;
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
  if (stream) {
    try { stream.write(line + '\n'); } catch (err) { /* 忽略写入失败 */ }
  }
}

function create(scope) {
  return {
    info: (...args) => write('INFO', scope, args),
    warn: (...args) => write('WARN', scope, args),
    error: (...args) => write('ERROR', scope, args)
  };
}

function dir() {
  return logDir || path.join(app.getPath('userData'), 'logs');
}

function tail(limit) {
  const max = Math.max(1, Number(limit) || 400);
  try {
    const file = path.join(dir(), `app-${stamp(new Date())}.log`);
    if (!fs.existsSync(file)) return '';
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    return lines.slice(-max).join('\n');
  } catch (err) {
    return '';
  }
}

function listFiles() {
  try {
    const root = dir();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
      .filter((name) => /\.log$/i.test(name))
      .map((name) => {
        const full = path.join(root, name);
        let stat = { size: 0, mtimeMs: 0 };
        try { stat = fs.statSync(full); } catch (err) { /* ignore */ }
        return { name, size: stat.size, at: stat.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
  } catch (err) {
    return [];
  }
}

function readFile(name, options) {
  const opts = options || {};
  const file = path.join(dir(), path.basename(String(name || '')));
  if (!/\.log$/i.test(file)) return { ok: false, error: '仅支持读取 .log 文件' };
  if (!fs.existsSync(file)) return { ok: false, error: '日志文件不存在' };
  try {
    const max = Math.max(50, Math.min(20000, Number(opts.limit) || 2000));
    const level = String(opts.level || '').trim().toUpperCase();
    const keyword = String(opts.keyword || '').trim().toLowerCase();
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const matched = lines.filter((line) => {
      if (!line) return false;
      if (level && level !== 'ALL' && line.indexOf('[' + level + ']') < 0) return false;
      if (keyword && line.toLowerCase().indexOf(keyword) < 0) return false;
      return true;
    });
    return {
      ok: true,
      name: path.basename(file),
      total: lines.length,
      matched: matched.length,
      truncated: matched.length > max,
      content: matched.slice(-max).join('\n')
    };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '读取失败' };
  }
}

module.exports = { create, dir, tail, listFiles, readFile };
