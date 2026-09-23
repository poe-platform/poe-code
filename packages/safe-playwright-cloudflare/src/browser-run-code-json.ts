import { PlaywrightResourceLimitError } from "@poe-platform/safe-bash/playwright";

// Worker results have a tighter host budget than the transport's 16 MiB cap.
const MAX_JSON_CHARACTERS = 1024 * 1024;
const MAX_JSON_CONTAINERS = 10_000;
const MAX_JSON_ENTRIES = 50_000;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_ALLOCATION = 8 * 1024 * 1024;
const MAX_JSON_SCAN_MS = 100;

export function parseRunCodeJson(json: string, signal: AbortSignal): unknown {
  signal.throwIfAborted();
  if (json.length > MAX_JSON_CHARACTERS)
    throw new PlaywrightResourceLimitError("Run-code JSON scan limit exceeded");
  const deadline = performance.now() + MAX_JSON_SCAN_MS;
  let quoted = false;
  let escaped = false;
  let depth = 0;
  let containers = 0;
  let entries = 0;
  // Reserve source and decoded string storage, then container/slot overhead.
  // Counting punctuation also counts duplicate keys and malformed input.
  let allocation = json.length * 4;
  for (let index = 0; index < json.length; index++) {
    if (index % 4096 === 0) {
      signal.throwIfAborted();
      if (performance.now() > deadline)
        throw new PlaywrightResourceLimitError("Run-code JSON scan deadline exceeded");
    }
    const character = json[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "[" || character === "{") {
      depth++;
      containers++;
      entries++;
      allocation += 128;
    } else if (character === "]" || character === "}") depth--;
    else if (character === "," || character === ":") {
      entries++;
      allocation += 32;
    }
    if (depth > MAX_JSON_DEPTH || containers > MAX_JSON_CONTAINERS ||
        entries > MAX_JSON_ENTRIES || allocation > MAX_JSON_ALLOCATION)
      throw new PlaywrightResourceLimitError("Run-code JSON structure limit exceeded");
  }
  signal.throwIfAborted();
  if (performance.now() > deadline)
    throw new PlaywrightResourceLimitError("Run-code JSON scan deadline exceeded");
  // Native grammar validation and allocation happen only after bounded admission.
  return JSON.parse(json) as unknown;
}
