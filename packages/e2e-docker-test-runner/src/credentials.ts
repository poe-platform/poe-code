import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const API_KEY_REFERENCE_LENGTH = 43;
const API_KEY_MIN_LENGTH_RATIO = 0.8;
const MIN_API_KEY_LENGTH = Math.ceil(
  API_KEY_REFERENCE_LENGTH * API_KEY_MIN_LENGTH_RATIO
);

type ApiKeySource = 'POE_API_KEY' | 'credentials' | null;

export interface ApiKeyResolution {
  key: string | null;
  source: ApiKeySource;
  valid: boolean;
}

function normalizeApiKey(value: string | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasMinimumApiKeyLength(value: string): boolean {
  return value.length >= MIN_API_KEY_LENGTH;
}

function isAlphanumeric(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    if (!isDigit && !isUpper && !isLower) {
      return false;
    }
  }
  return value.length > 0;
}

function isAlphanumericWithSeparators(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isHyphen = code === 45;
    const isUnderscore = code === 95;
    if (!isDigit && !isUpper && !isLower && !isHyphen && !isUnderscore) {
      return false;
    }
  }
  return value.length > 0;
}

export function isValidApiKeyFormat(key: string): boolean {
  if (key.length === 0) return false;
  if (key.startsWith('sk-poe-')) {
    const hash = key.slice(7);
    return hasMinimumApiKeyLength(hash) && isAlphanumeric(hash);
  }
  return hasMinimumApiKeyLength(key) && isAlphanumericWithSeparators(key);
}

function readStoredApiKey(): string | null {
  const credentialsPath = join(homedir(), '.poe-code', 'credentials.json');
  if (!existsSync(credentialsPath)) {
    return null;
  }
  try {
    const content = readFileSync(credentialsPath, 'utf-8');
    const credentials = JSON.parse(content);
    if (typeof credentials.apiKey !== 'string') {
      return null;
    }
    return normalizeApiKey(credentials.apiKey);
  } catch {
    // Ignore parse errors
    return null;
  }
}

export function resolveApiKey(): ApiKeyResolution {
  const envKey = normalizeApiKey(process.env.POE_API_KEY);
  if (envKey) {
    return {
      key: envKey,
      source: 'POE_API_KEY',
      valid: isValidApiKeyFormat(envKey),
    };
  }

  const storedKey = readStoredApiKey();
  if (storedKey) {
    return {
      key: storedKey,
      source: 'credentials',
      valid: isValidApiKeyFormat(storedKey),
    };
  }

  return { key: null, source: null, valid: false };
}

export function getApiKey(): string | null {
  return resolveApiKey().key;
}

export function hasApiKey(): boolean {
  return resolveApiKey().key !== null;
}

export function hasValidApiKey(): boolean {
  const resolved = resolveApiKey();
  return resolved.key !== null && resolved.valid;
}
