// Crypto primitives. Node built-ins only.
//
// Passwords:   crypto.scrypt, random salt per password, stored as one string.
// Cookies:     HMAC-SHA256, key = HKDF(MASTER_KEY, salt: 'yncms-cookie', info: 'session-cookie')
// Settings:    AES-256-GCM, key = HKDF(MASTER_KEY, salt: 'yncms-settings', info: 'settings-value')
//              per-value random IV, distinct key from the cookie key.

import { scrypt, randomBytes, timingSafeEqual, hkdfSync, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options?: object) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// ---- Passwords -------------------------------------------------------

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = Number.parseInt(nStr, 10);
  const r = Number.parseInt(rStr, 10);
  const p = Number.parseInt(pStr, 10);
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scryptAsync(password, salt, expected.length, { N, r, p });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// ---- Key derivation ---------------------------------------------------

function deriveKey(masterKey, salt, info, length = 32) {
  if (!masterKey) {
    throw new Error('MASTER_KEY is not set. Copy .env.example to .env and set MASTER_KEY.');
  }
  const ikm = Buffer.from(masterKey, 'utf8');
  const keyBuf = hkdfSync('sha256', ikm, Buffer.from(salt), Buffer.from(info), length);
  return Buffer.from(keyBuf);
}

export function cookieKey(masterKey) {
  return deriveKey(masterKey, 'yncms-cookie', 'session-cookie', 32);
}

export function settingsKey(masterKey) {
  return deriveKey(masterKey, 'yncms-settings', 'settings-value', 32);
}

// ---- Cookie signing (HMAC-SHA256) -------------------------------------

export function signValue(masterKey, value) {
  const key = cookieKey(masterKey);
  const mac = createHmac('sha256', key).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function verifySignedValue(masterKey, signed) {
  if (!signed || typeof signed !== 'string') return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const key = cookieKey(masterKey);
  const expected = createHmac('sha256', key).update(value).digest('base64url');
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (macBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(macBuf, expectedBuf)) return null;
  return value;
}

// ---- Settings encryption (AES-256-GCM) --------------------------------

export function encryptSetting(masterKey, plaintext) {
  const key = settingsKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decryptSetting(masterKey, { iv, ciphertext, tag }) {
  const key = settingsKey(masterKey);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
