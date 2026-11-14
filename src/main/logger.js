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

module.exports = { create, dir, tail };
