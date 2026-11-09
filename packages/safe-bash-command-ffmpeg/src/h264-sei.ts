import { concatBytes, escapeRbsp, unescapeRbsp, type MediaBudgetTracker } from "@poe-code/mp4-ast";

/** Encode an unregistered SEI message, including the UUID and NUL-terminated UTF-8 text. */
export function encodeH264UserData(value: string, budget: MediaBudgetTracker): Uint8Array {
  const uuid = new Uint8Array(16);
  let offset = 0, digits = 0;
  for (; offset < 64 && offset < value.length && digits < 32; offset++) {
    const char = value[offset]!.toLowerCase();
    if (char === "-") continue;
    const digit = "0123456789abcdef".indexOf(char);
    if (digit < 0) break;
    uuid[digits >>> 1] = uuid[digits >>> 1]! * 16 + digit;
    digits++;
  }
  if (digits !== 32 || value[offset] !== "+") throw new Error("Invalid H.264 user data: expected UUID+string");
  budget.checkOutputBytes(value.length - offset + 16);
  const text = new TextEncoder().encode(value.slice(offset + 1));
  const size = 16 + text.length + 1;
  const sizeBytes = Math.floor(size / 255) + 1;
  budget.checkOutputBytes(1 + sizeBytes + size);
  const message = new Uint8Array(1 + sizeBytes + size);
  message[0] = 5; // user_data_unregistered
  message.fill(255, 1, sizeBytes);
  message[sizeBytes] = size % 255;
  message.set(uuid, 1 + sizeBytes);
  message.set(text, 1 + sizeBytes + 16);
  return message;
}

/** Add a message to the first existing SEI NAL, or construct a new length-prefixed NAL. */
export function appendH264UserData(nal: Uint8Array | undefined, message: Uint8Array, lengthSize: number, budget: MediaBudgetTracker): Uint8Array {
  const rbsp = nal ? unescapeRbsp(nal) : new Uint8Array([6, 128]);
  if (rbsp[rbsp.length - 1] !== 128) throw new Error("Invalid H.264 SEI trailing bits");
  budget.checkOutputBytes(lengthSize + rbsp.length + message.length);
  const updated = escapeRbsp(concatBytes([rbsp.subarray(0, -1), message, new Uint8Array([128])]));
  if (updated.length >= 256 ** lengthSize) throw new Error("H.264 SEI exceeds NAL length");
  budget.checkOutputBytes(lengthSize + updated.length);
  const data = new Uint8Array(lengthSize + updated.length);
  let length = updated.length;
  for (let i = lengthSize - 1; i >= 0; i--) { data[i] = length & 255; length = Math.floor(length / 256); }
  data.set(updated, lengthSize);
  return data;
}
