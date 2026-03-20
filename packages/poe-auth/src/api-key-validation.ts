export function stripBracketedPaste(input: string): string {
  let value = input.split("\u001b[200~").join("");
  value = value.split("\u001b[201~").join("");

  if (value.endsWith("undefinedndefined")) {
    return value.slice(0, -"undefinedndefined".length);
  }

  if (value.endsWith("undefined")) {
    return value.slice(0, -"undefined".length);
  }

  if (value.endsWith("ndefined")) {
    return value.slice(0, -"ndefined".length);
  }

  return value;
}

function isAlphanumeric(value: string): boolean {
  if (value.length === 0) return false;

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;

    if (!isDigit && !isUpper && !isLower) return false;
  }

  return true;
}

function isAlphanumericWithSeparators(value: string): boolean {
  if (value.length === 0) return false;

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

  return true;
}

const API_KEY_PREFIX = "sk-poe-";
const MIN_API_KEY_LENGTH = 34;

function hasMinimumApiKeyLength(value: string): boolean {
  return value.length >= MIN_API_KEY_LENGTH;
}

export function isValidApiKeyFormat(key: string): boolean {
  if (!hasMinimumApiKeyLength(key)) return false;

  if (key.startsWith(API_KEY_PREFIX)) {
    const hash = key.slice(API_KEY_PREFIX.length);
    return isAlphanumeric(hash);
  }

  return isAlphanumericWithSeparators(key);
}

export function normalizeApiKey(raw: string): string {
  const normalized = stripBracketedPaste(raw).trim();

  if (normalized.length === 0) {
    throw new Error("POE API key cannot be empty.");
  }

  if (!isValidApiKeyFormat(normalized)) {
    throw new Error("POE API key format is invalid.");
  }

  return normalized;
}
