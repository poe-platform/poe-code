import type { FsBridgeCodec } from "@poe-code/safe-fs/core";

const encodings = new Set(["ascii", "utf8", "utf-8", "utf16le", "utf-16le", "ucs2", "ucs-2", "base64", "base64url", "latin1", "binary", "hex"]);
const utf8 = new TextEncoder();
export const fsCodec: FsBridgeCodec = {
  isEncoding: encoding => encodings.has(encoding.toLowerCase()),
  encode(text, encoding) {
    const name = encoding.toLowerCase();
    if (name === "utf8" || name === "utf-8") return utf8.encode(text);
    if (name === "hex") {
      const bytes: number[] = [];
      const digits = "0123456789abcdef";
      for (let i = 0; i + 1 < text.length; i += 2) {
        const high = digits.indexOf(text[i]!.toLowerCase());
        const low = digits.indexOf(text[i + 1]!.toLowerCase());
        if (high < 0 || low < 0) break;
        bytes.push(high * 16 + low);
      }
      return Uint8Array.from(bytes);
    }
    if (name === "base64" || name === "base64url") {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const bytes: number[] = [];
      let bits = 0, count = 0;
      for (const char of text) {
        if (char === "=") break;
        const digit = alphabet.indexOf(char === "-" ? "+" : char === "_" ? "/" : char);
        if (digit < 0) continue;
        bits = (bits << 6) | digit; count += 6;
        if (count >= 8) { count -= 8; bytes.push((bits >>> count) & 255); }
      }
      return Uint8Array.from(bytes);
    }
    if (["utf16le", "utf-16le", "ucs2", "ucs-2"].includes(name)) {
      const bytes = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i); bytes[i * 2] = code & 255; bytes[i * 2 + 1] = code >>> 8;
      }
      return bytes;
    }
    if (["ascii", "latin1", "binary"].includes(name)) return Uint8Array.from(text.split(""), char => char.charCodeAt(0) & 255);
    throw new TypeError("Invalid encoding");
  },
  decode(bytes, encoding) {
    const name = encoding.toLowerCase();
    if (name === "utf8" || name === "utf-8") return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    if (name === "hex") return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    if (name === "base64" || name === "base64url") {
      const alphabet = name === "base64" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/" : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      let result = "";
      for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
        result += alphabet[a >>> 2]! + alphabet[((a & 3) << 4) | ((b ?? 0) >>> 4)]!;
        result += b === undefined ? (name === "base64" ? "==" : "") : alphabet[((b & 15) << 2) | ((c ?? 0) >>> 6)]! + (c === undefined ? (name === "base64" ? "=" : "") : alphabet[c & 63]!);
      }
      return result;
    }
    let result = "";
    if (["utf16le", "utf-16le", "ucs2", "ucs-2"].includes(name)) {
      for (let i = 0; i + 1 < bytes.length; i += 2) result += String.fromCharCode(bytes[i]! | bytes[i + 1]! << 8);
    } else if (["ascii", "latin1", "binary"].includes(name)) {
      for (const byte of bytes) result += String.fromCharCode(name === "ascii" ? byte & 127 : byte);
    } else throw new TypeError("Invalid encoding");
    return result;
  }
};
