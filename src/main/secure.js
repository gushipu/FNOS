'use strict';

const crypto = require('node:crypto');
const { safeStorage } = require('electron');

const PREFIX = 'enc:v1:';
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function canEncrypt() {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  } catch (err) {
    return false;
  }
}

function encrypt(text) {
  const raw = String(text == null ? '' : text);
  if (!raw) return '';
  if (raw.startsWith(PREFIX)) return raw;
  if (!canEncrypt()) return raw;
  try {
    return PREFIX + safeStorage.encryptString(raw).toString('base64');
  } catch (err) {
    return raw;
  }
}

function decrypt(token) {
  const raw = String(token == null ? '' : token);
  if (!raw) return '';
  if (!raw.startsWith(PREFIX)) return raw;
  if (!canEncrypt()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(raw.slice(PREFIX.length), 'base64'));
  } catch (err) {
    return '';
  }
}

function isEncrypted(token) {
  return typeof token === 'string' && token.startsWith(PREFIX);
}

function readBlob(encrypted) {
  const plain = decrypt(encrypted);
  if (!plain) return {};
  try {
    const parsed = JSON.parse(plain);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeBlob(value) {
  try {
    return encrypt(JSON.stringify(value || {}));
  } catch (err) {
    return '';
  }
}

function derive(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(String(password), salt, 64, SCRYPT);
}

function hashPassword(password) {
  const pass = String(password == null ? '' : password);
  if (!pass) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = derive(pass, salt).toString('hex');
  return { algo: 'scrypt', salt, hash, at: Date.now() };
}

function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const pass = String(password == null ? '' : password);
  if (!pass) return false;
  try {
    const expect = Buffer.from(record.hash, 'hex');
    const actual = derive(pass, record.salt);
    return expect.length === actual.length && crypto.timingSafeEqual(expect, actual);
  } catch (err) {
    return false;
  }
}

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  canEncrypt, encrypt, decrypt, isEncrypted,
  readBlob, writeBlob, hashPassword, verifyPassword, randomToken
};
