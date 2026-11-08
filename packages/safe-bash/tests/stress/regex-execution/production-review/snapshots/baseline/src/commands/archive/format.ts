import { checkPath, fail, text, type ArchiveLimits } from "./internal.js";

export interface Entry {
  name: string;
  type: string;
  linkname: string;
  size: number;
  mode: number;
  uid: number;
  gid: number;
  mtime: number;
  atime?: number;
}

export interface ReadEntry extends Omit<Entry, "uid" | "gid" | "mtime" | "atime"> {
  uid: number | undefined;
  gid: number | undefined;
  mtime: number | undefined;
  atime: number | undefined;
  atimeDeleted: boolean;
}

export interface Header {
  bytes: Uint8Array;
  posix: boolean;
  type: string;
  mode: number;
}

export function numberField(header: Uint8Array, offset: number, width: number, signed = false): number {
  const bytes = header.subarray(offset, offset + width);
  let value: bigint;
  if (bytes[0]! & 0x80) {
    value = BigInt(bytes[0]! & 0x7f);
    for (const byte of bytes.subarray(1)) value = value * 256n + BigInt(byte);
    if (bytes[0]! & 0x40) value -= 1n << BigInt(width * 8 - 1);
  } else {
    const digits = Buffer.from(bytes).toString("latin1").replace(/^[ \0]+|[ \0]+$/gu, "");
    if (digits && !/^[0-7]+$/u.test(digits)) fail("invalid octal numeric field");
    value = digits ? BigInt(`0o${digits}`) : 0n;
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || (!signed && result < 0)) fail("invalid or oversized numeric field");
  return result;
}

function stringField(header: Uint8Array, offset: number, width: number): string {
  const bytes = header.subarray(offset, offset + width);
  const end = bytes.indexOf(0);
  return text(end === -1 ? bytes : bytes.subarray(0, end));
}

export function parseHeader(header: Uint8Array): Header {
  if (header.length !== 512) fail("invalid header size");
  const expected = numberField(header, 148, 8);
  let actual = 0;
  for (let offset = 0; offset < 512; offset++) actual += offset >= 148 && offset < 156 ? 32 : header[offset]!;
  if (actual !== expected) fail("header checksum mismatch");
  const magic = Buffer.from(header.subarray(257, 265)).toString("latin1");
  const posix = magic === "ustar\0" + "00";
  if (!posix && magic !== "ustar  \0") fail("unsupported archive format (expected USTAR, PAX, or GNU basic headers)");
  const entry: Header = {
    bytes: header,
    posix,
    type: header[156] === 0 ? "0" : String.fromCharCode(header[156]!),
    mode: numberField(header, 100, 8),
  };
  numberField(header, 329, 8);
  numberField(header, 337, 8);
  if (entry.mode > 0o7777) fail("invalid archive permission bits");
  return entry;
}

function octal(header: Uint8Array, offset: number, width: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value.toString(8).length >= width) fail("number does not fit USTAR field");
  header.set(Buffer.from(value.toString(8).padStart(width - 1, "0")), offset);
}

function splitName(name: string): [string, string] | undefined {
  if (!/^[\x01-\x7f]*$/u.test(name)) return undefined;
  if (Buffer.byteLength(name) <= 100) return [name, ""];
  for (let offset = name.length - 2; offset > 0; offset--) {
    if (name[offset] === "/" && Buffer.byteLength(name.slice(0, offset)) <= 155 && Buffer.byteLength(name.slice(offset + 1)) <= 100) {
      return [name.slice(offset + 1), name.slice(0, offset)];
    }
  }
  return undefined;
}

export function headerBytes(entry: Entry): Uint8Array {
  const split = splitName(entry.name);
  if (!split) fail("name does not fit USTAR header");
  if (Buffer.byteLength(entry.linkname) > 100) fail("link does not fit USTAR header");
  const header = new Uint8Array(512);
  header.set(Buffer.from(split[0]), 0);
  header.set(Buffer.from(split[1]), 345);
  octal(header, 100, 8, entry.mode);
  octal(header, 108, 8, entry.uid);
  octal(header, 116, 8, entry.gid);
  octal(header, 124, 12, entry.size);
  octal(header, 136, 12, entry.mtime);
  header.fill(32, 148, 156);
  header[156] = entry.type.charCodeAt(0);
  header.set(Buffer.from(entry.linkname), 157);
  header.set(Buffer.from("ustar\0" + "00"), 257);
  octal(header, 329, 8, 0);
  octal(header, 337, 8, 0);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.set(Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `), 148);
  return header;
}

export function paxRecord(key: string, value: string): Uint8Array {
  const payload = ` ${key}=${value}\n`;
  const bytes = Buffer.byteLength(payload);
  let size = bytes + 1;
  while (size !== bytes + String(size).length) size = bytes + String(size).length;
  return Buffer.from(`${size}${payload}`);
}

export function encodeEntry(entry: Entry, limits: ArchiveLimits): Uint8Array[] {
  checkPath(entry.name, limits);
  if (entry.linkname) checkPath(entry.linkname, limits);
  const base = { ...entry };
  if (!Number.isFinite(entry.mtime) || Math.abs(entry.mtime * 1000) > 8.64e15) fail("invalid source mtime");
  const records: Uint8Array[] = [];
  if (!splitName(base.name)) { records.push(paxRecord("path", base.name)); base.name = "PaxEntry"; }
  if (Buffer.byteLength(base.linkname) > 100 || /[^\x01-\x7f]/u.test(base.linkname)) {
    records.push(paxRecord("linkpath", base.linkname)); base.linkname = "PaxLink";
  }
  for (const key of ["uid", "gid", "size", "mtime"] as const) {
    const value = base[key];
    const maximum = key === "uid" || key === "gid" ? 0o7777777 : 0o77777777777;
    if (!Number.isFinite(value) || (key !== "mtime" && (!Number.isSafeInteger(value) || value < 0))) fail(`invalid source ${key}`);
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      records.push(paxRecord(key, key === "mtime" ? decimalTime(value) : String(value))); base[key] = 0;
    }
  }
  if (entry.atime !== undefined) {
    if (!Number.isFinite(entry.atime) || Math.abs(entry.atime * 1000) > 8.64e15) fail("invalid source atime");
    records.push(paxRecord("atime", decimalTime(entry.atime)));
  }
  if (!records.length) return [headerBytes(base)];
  const payload = Buffer.concat(records);
  if (payload.length > limits.maxPaxBytes) fail("PAX header byte limit exceeded");
  const extension = headerBytes({ ...base, name: "PaxHeader", linkname: "", type: "x", size: payload.length, mode: 0o644 });
  return [extension, payload, new Uint8Array((512 - payload.length % 512) % 512), headerBytes(base)];
}

function decimalTime(value: number): string {
  return value.toFixed(9).replace(/(\.[0-9]*?)0+$/u, "$1").replace(/\.$/u, "");
}

const supportedKeywords = new Set(["path", "linkpath", "size", "uid", "gid", "mtime", "atime", "ctime", "uname", "gname", "comment", "charset", "hdrcharset"]);
const optionalKeywords = new Set(["SCHILY.fflags", "LIBARCHIVE.creationtime"]);
const optionalKeywordPrefixes = ["LIBARCHIVE.xattr.", "SCHILY.xattr."];

export function parsePax(payload: Uint8Array): Map<string, string> {
  const result = new Map<string, string>();
  let offset = 0;
  while (offset < payload.length) {
    let space = offset;
    while (space < payload.length && payload[space] !== 32 && space - offset < 16) space++;
    const digits = Buffer.from(payload.subarray(offset, space)).toString("latin1");
    if (!/^[1-9][0-9]*$/u.test(digits) || payload[space] !== 32) fail("invalid PAX record length");
    const size = Number(digits);
    if (!Number.isSafeInteger(size) || size <= space - offset + 3 || size > payload.length - offset || payload[offset + size - 1] !== 10) fail("invalid PAX record framing");
    const record = payload.subarray(space + 1, offset + size - 1);
    const equals = record.indexOf(61);
    if (equals <= 0) fail("invalid PAX key/value");
    const key = text(record.subarray(0, equals));
    if (/[\0\n]/u.test(key)) fail("invalid PAX key/value");
    offset += size;
    if (optionalKeywords.has(key) || optionalKeywordPrefixes.some(prefix => key.startsWith(prefix) && key.length > prefix.length)) continue;
    if (!supportedKeywords.has(key)) fail(`unsupported PAX keyword: ${key}`);
    const value = text(record.subarray(equals + 1));
    if (value.includes("\0")) fail("invalid PAX key/value");
    if (key === "hdrcharset" && value !== "" && value !== "ISO-IR 10646 2000 UTF-8") fail("unsupported PAX header charset");
    result.set(key, value);
  }
  return result;
}

export function applyPax(header: Header, global: ReadonlyMap<string, string>, local: ReadonlyMap<string, string>, longName?: string, longLink?: string): ReadEntry {
  const merged = new Map(global);
  for (const [key, value] of local) merged.set(key, value);
  for (const [key, value] of merged) {
    if (value === "") continue;
    if (key === "uid" || key === "gid" || key === "size") {
      if (!/^[0-9]+$/u.test(value) || !Number.isSafeInteger(Number(value))) fail(`invalid PAX ${key}`);
    } else if (key === "mtime" || key === "atime" || key === "ctime") {
      if (!/^-?[0-9]+(?:\.[0-9]+)?$/u.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value) * 1000) > 8.64e15) fail(`invalid PAX ${key}`);
    }
  }
  const numeric = (key: string, raw: () => number | undefined): number | undefined => {
    if (!merged.has(key)) return raw();
    const value = merged.get(key)!;
    return value === "" ? undefined : Number(value);
  };
  const name = merged.has("path") ? merged.get("path")! : longName ?? (() => {
    const prefix = header.posix ? stringField(header.bytes, 345, 155) : "";
    const raw = stringField(header.bytes, 0, 100);
    return prefix ? `${prefix}/${raw}` : raw;
  })();
  if (!name) fail("missing effective path");
  const linkname = merged.has("linkpath") ? merged.get("linkpath")! : longLink ?? stringField(header.bytes, 157, 100);
  if ((header.type === "1" || header.type === "2") && !linkname) fail("missing effective linkpath");
  const size = numeric("size", () => numberField(header.bytes, 124, 12));
  if (size === undefined) fail("missing effective size");
  return {
    name, linkname, size, type: header.type, mode: header.mode,
    uid: numeric("uid", () => numberField(header.bytes, 108, 8)),
    gid: numeric("gid", () => numberField(header.bytes, 116, 8)),
    mtime: numeric("mtime", () => numberField(header.bytes, 136, 12, true)),
    atime: numeric("atime", () => undefined),
    atimeDeleted: merged.get("atime") === "",
  };
}
