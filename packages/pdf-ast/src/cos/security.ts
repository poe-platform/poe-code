import { drainWork } from "../work.js";
import { CipherTransformFactory, Dict, Name, Stream, PDF17, PDF20, saslPrep } from "../vendor/pdfjs-fonts.mjs";
import { bytesToString, stringToBytes } from "../bytes.js";
import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  md5Bytes,
} from "./crypto-primitives.js";
import {
  cosArray,
  cosBool,
  cosDict,
  cosHexString,
  cosName,
  cosNumber,
  cosRef,
  dictGet,
  dictDelete,
  dictSet,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosStream,
  type PdfEncryptionState,
  type PdfIndirectObject,
  type PdfPermissions,
} from "../ast.js";
import { PdfError } from "../errors.js";
import type { ParsedCosDocument } from "./parser.js";
import { decodeStreamObject } from "./filters.js";
import { assertDecodedByteBudget } from "./limits.js";
import { serializeCosDocumentSteps } from "./writer.js";

const PADDING_32 = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export function rc4Transform(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    const tmp = s[i]!;
    s[i] = s[j]!;
    s[j] = tmp;
  }
  const out = new Uint8Array(data.length);
  let x = 0;
  let y = 0;
  for (let k = 0; k < data.length; k++) {
    x = (x + 1) & 0xff;
    y = (y + s[x]!) & 0xff;
    const tmp = s[x]!;
    s[x] = s[y]!;
    s[y] = tmp;
    out[k] = data[k]! ^ s[(s[x]! + s[y]!) & 0xff]!;
  }
  return out;
}

function padPassword32(password: string): Uint8Array {
  const bytes = stringToBytes(password);
  const out = new Uint8Array(32);
  const copyLen = Math.min(32, bytes.length);
  out.set(bytes.subarray(0, copyLen), 0);
  if (copyLen < 32) {
    out.set(PADDING_32.subarray(0, 32 - copyLen), copyLen);
  }
  return out;
}

export function decodePermissionsMask(p: number): PdfPermissions {
  return {
    print: (p & (1 << 2)) !== 0,
    modify: (p & (1 << 3)) !== 0,
    copy: (p & (1 << 4)) !== 0,
    addNotes: (p & (1 << 5)) !== 0,
    fillForms: (p & (1 << 8)) !== 0,
    extractAccessibility: (p & (1 << 9)) !== 0,
    assemble: (p & (1 << 10)) !== 0,
    printHighRes: (p & (1 << 11)) !== 0,
  };
}

export function encodePermissionsMask(perms: Partial<PdfPermissions>): number {
  // Set reserved high bits per PDF specification (-4 base mask)
  let p = ~0x0fff | 0;
  p |= 0b11000000; // bits 7 and 8 reserved = 1
  if (perms.print ?? true) p |= 1 << 2;
  if (perms.modify ?? false) p |= 1 << 3;
  if (perms.copy ?? false) p |= 1 << 4;
  if (perms.addNotes ?? true) p |= 1 << 5;
  if (perms.fillForms ?? true) p |= 1 << 8;
  if (perms.extractAccessibility ?? true) p |= 1 << 9;
  if (perms.assemble ?? false) p |= 1 << 10;
  if (perms.printHighRes ?? true) p |= 1 << 11;
  return p;
}

/** PDF.js ISO 32000-2 Algorithm 2.B, with the public byte-oriented API retained. */
export function computeR5R6Hash(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  userKey: Uint8Array,
  revision: 5 | 6
): Uint8Array {
  const password = passwordBytes.subarray(0, 127);
  const input = new Uint8Array(password.length + salt.length + userKey.length);
  input.set(password);
  input.set(salt, password.length);
  input.set(userKey, password.length + salt.length);
  return (revision === 6 ? new PDF20() : new PDF17())._hash(password, input, userKey);
}

const securityHandlers = new WeakMap<PdfEncryptionState, {
  factory: CipherTransformFactory;
  plaintextObjects: Set<number>;
}>();

export function derivePdfEncryptionKey(
  encryptDict: PdfCosDict,
  documentId0: Uint8Array,
  password = "",
  options: {
    resolve?: (node: PdfCosNode) => PdfCosNode | undefined;
    maxRecursionDepth?: number | undefined;
  } = {}
): PdfEncryptionState {
  const plaintextObjects = new Set<number>();
  const converted = new Map<PdfCosNode, unknown>();
  const convert = (node: PdfCosNode, depth = 0): unknown => {
    if (converted.has(node)) return converted.get(node);
    if (depth > (options.maxRecursionDepth ?? Infinity)) throw new PdfError("E_LIMIT", "PDF encryption dictionary recursion limit exceeded");
    switch (node.kind) {
      case "ref": {
        plaintextObjects.add(node.objectNumber);
        const resolved = options.resolve?.(node);
        if (!resolved || resolved === node) throw new PdfError("E_PARSE", "Unresolved encryption dictionary reference");
        // Record references before descending so cyclic dictionaries remain bounded.
        converted.set(node, null);
        const value = convert(resolved, depth + 1);
        converted.set(node, value);
        return value;
      }
      case "dict": {
        const dict = new Dict();
        converted.set(node, dict);
        for (const entry of node.entries) dict.set(entry.key.decoded, convert(entry.value, depth + 1));
        return dict;
      }
      case "array": {
        const items: unknown[] = [];
        converted.set(node, items);
        for (const item of node.items) items.push(convert(item, depth + 1));
        return items;
      }
      case "name": return Name.get(node.decoded);
      case "string": return bytesToString(node.bytes);
      case "number": case "boolean": return node.value;
      case "null": return null;
      default: throw new PdfError("E_PARSE", "Invalid encryption dictionary value");
    }
  };
  try {
    const dict = convert(encryptDict) as Dict;
    // An absent crypt-filter dictionary denotes the default Identity filters.
    if (!dict.get("CF")) dict.set("CF", new Dict());
    const revision = dict.get("R");
    let factory: CipherTransformFactory;
    try {
      factory = new CipherTransformFactory(dict, bytesToString(documentId0), password);
    } catch (error) {
      // pypdf applies SASLprep to R5 too. Keep raw UTF-8 compatibility first,
      // then try the standard prepared candidate when authentication fails.
      const prepared = revision === 5 ? saslPrep(password) : password;
      if (!(error instanceof Error) || error.name !== "PasswordException" || prepared === password) throw error;
      factory = new CipherTransformFactory(dict, bytesToString(documentId0), prepared);
    }
    const permissions = dict.get("P");
    if (typeof revision !== "number") throw new PdfError("E_CAPABILITY", "Invalid PDF encryption revision");
    const fileKey = factory.encryptionKey ?? new Uint8Array(0);
    const state: PdfEncryptionState = {
      filter: "Standard", version: factory.algorithm, revision,
      keyLengthBits: fileKey.length * 8,
      encryptMetadata: factory.algorithm < 4 || factory.encryptMetadata,
      permissions: decodePermissionsMask(typeof permissions === "number" ? permissions : -4), fileKey,
    };
    securityHandlers.set(state, { factory, plaintextObjects });
    return state;
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError("E_CAPABILITY", error instanceof Error && error.name === "PasswordException"
      ? "Invalid PDF password" : `PDF security handler: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function decryptPdfBuffer(
  state: PdfEncryptionState,
  objectNumber: number,
  generationNumber: number,
  data: Uint8Array
): Uint8Array {
  if (data.length === 0) return data;
  const handler = securityHandlers.get(state);
  if (handler) return stringToBytes(handler.factory.createCipherTransform(objectNumber, generationNumber).decryptString(bytesToString(data)));

  if (state.revision === 5 || state.revision === 6) {
    if (data.length < 16 || data.length % 16 !== 0) {
      return data;
    }
    const iv = data.subarray(0, 16);
    const ciphertext = data.subarray(16);
    if (ciphertext.length === 0) return new Uint8Array(0);
    return aesCbcDecrypt(state.fileKey, iv, ciphertext, true);
  }

  // Object key for R2–R4
  const useAes128 = state.version === 4;
  const suffix = new Uint8Array(useAes128 ? 9 : 5);
  suffix[0] = objectNumber & 0xff;
  suffix[1] = (objectNumber >>> 8) & 0xff;
  suffix[2] = (objectNumber >>> 16) & 0xff;
  suffix[3] = generationNumber & 0xff;
  suffix[4] = (generationNumber >>> 8) & 0xff;
  if (useAes128) {
    // "sAlT"
    suffix[5] = 0x73;
    suffix[6] = 0x41;
    suffix[7] = 0x6c;
    suffix[8] = 0x54;
  }
  const objKey = md5Bytes([state.fileKey, suffix]).subarray(0, Math.min(16, state.fileKey.length + 5));
  if (useAes128) {
    if (data.length < 16 || data.length % 16 !== 0) return data;
    const iv = data.subarray(0, 16);
    const ciphertext = data.subarray(16);
    if (ciphertext.length === 0) return new Uint8Array(0);
    return aesCbcDecrypt(objKey.subarray(0, 16), iv, ciphertext, true);
  }
  return rc4Transform(objKey, data);
}

export function encryptPdfBuffer(
  state: PdfEncryptionState,
  objectNumber: number,
  generationNumber: number,
  plaintext: Uint8Array
): Uint8Array {
  const handler = securityHandlers.get(state);
  if (handler) return stringToBytes(handler.factory.createCipherTransform(objectNumber, generationNumber).encryptString(bytesToString(plaintext)));
  if (state.revision === 5 || state.revision === 6) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const enc = aesCbcEncrypt(state.fileKey, iv, plaintext, true);
    const out = new Uint8Array(16 + enc.length);
    out.set(iv, 0);
    out.set(enc, 16);
    return out;
  }

  const suffix = Uint8Array.from([
    objectNumber & 0xff,
    (objectNumber >>> 8) & 0xff,
    (objectNumber >>> 16) & 0xff,
    generationNumber & 0xff,
    (generationNumber >>> 8) & 0xff,
  ]);
  const objKey = md5Bytes([state.fileKey, suffix]).subarray(0, Math.min(16, state.fileKey.length + 5));
  return rc4Transform(objKey, plaintext);
}

function* transformNodeStringsAndStreamsSteps(
  node: PdfCosNode,
  transform: (bytes: Uint8Array) => Uint8Array,
  transformStream?: (stream: PdfCosStream) => PdfCosStream
): Generator<void, PdfCosNode, void> {
  yield;
  switch (node.kind) {
    case "string": return { kind: "string", format: "hex", bytes: transform(node.bytes) };
    case "array": {
      const items: PdfCosNode[] = [];
      for (const item of node.items) items.push(yield* transformNodeStringsAndStreamsSteps(item, transform, transformStream));
      return { kind: "array", items };
    }
    case "dict": {
      const type = dictGet(node, "Type"), fieldType = dictGet(node, "FT"), byteRange = dictGet(node, "ByteRange");
      const signature = (type?.kind === "name" && type.decoded === "Sig") || (fieldType?.kind === "name" && fieldType.decoded === "Sig") || (byteRange?.kind === "array" && dictGet(node, "Filter")?.kind === "name");
      const entries: PdfCosDict["entries"] = [];
      for (const e of node.entries) entries.push({ key: e.key, value: signature && e.key.decoded === "Contents" ? e.value : yield* transformNodeStringsAndStreamsSteps(e.value, transform, transformStream) });
      return { kind: "dict", entries };
    }
    case "stream": {
      const type = dictGet(node.dict, "Type");
      if (type?.kind === "name" && type.decoded === "XRef") return node;
      const stream = transformStream ? transformStream(node) : { ...node, rawBytes: transform(node.rawBytes) };
      const entries: PdfCosDict["entries"] = [];
      for (const e of stream.dict.entries) entries.push({ key: e.key, value: e.key.decoded === "Length" ? cosNumber(stream.rawBytes.length) : yield* transformNodeStringsAndStreamsSteps(e.value, transform, transformStream) });
      return { kind: "stream", dict: { kind: "dict", entries }, rawBytes: stream.rawBytes };
    }
    default: return node;
  }
}

export interface EncryptPdfOptions {
  readonly userPassword?: string | undefined;
  readonly ownerPassword?: string | undefined;
  readonly revision?: 3 | 6 | undefined;
  readonly permissions?: Partial<PdfPermissions> | undefined;
}

// Algorithms 2–5 and 3.8–3.10 follow pypdf 6.19.0 _encryption.py.
// See THIRD_PARTY_NOTICES.md for provenance and modifications.
function createR3Encryption(userPassword: string, ownerPassword: string, pMask: number, id: Uint8Array) {
  let ownerKey = md5Bytes([padPassword32(ownerPassword)]);
  for (let i = 0; i < 50; i++) ownerKey = md5Bytes([ownerKey]);
  let owner = padPassword32(userPassword);
  for (let i = 0; i < 20; i++) owner = rc4Transform(ownerKey.map(byte => byte ^ i), owner);

  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, pMask, true);
  let fileKey = md5Bytes([padPassword32(userPassword), owner, pBytes, id]);
  for (let i = 0; i < 50; i++) fileKey = md5Bytes([fileKey]);
  let user = md5Bytes([PADDING_32, id]);
  for (let i = 0; i < 20; i++) user = rc4Transform(fileKey.map(byte => byte ^ i), user);
  const uFull = new Uint8Array(32);
  uFull.set(user);
  uFull.set(PADDING_32.subarray(0, 16), 16);
  return { fileKey, dict: cosDict({
    Filter: cosName("Standard"), V: cosNumber(2), R: cosNumber(3),
    Length: cosNumber(128), P: cosNumber(pMask),
    U: cosHexString(uFull), O: cosHexString(owner),
  }) };
}

function createR6Encryption(userPassword: string, ownerPassword: string, pMask: number) {
  const fileKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const userSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const ownerSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const userBytes = new TextEncoder().encode(saslPrep(userPassword)).subarray(0, 127);
  const ownerBytes = new TextEncoder().encode(saslPrep(ownerPassword)).subarray(0, 127);
  const uFull = new Uint8Array(48);
  uFull.set(computeR5R6Hash(userBytes, userSalt.subarray(0, 8), new Uint8Array(0), 6));
  uFull.set(userSalt, 32);
  const userKey = computeR5R6Hash(userBytes, userSalt.subarray(8), new Uint8Array(0), 6);
  const ue = aesCbcEncrypt(userKey, new Uint8Array(16), fileKey, false);
  const oFull = new Uint8Array(48);
  oFull.set(computeR5R6Hash(ownerBytes, ownerSalt.subarray(0, 8), uFull, 6));
  oFull.set(ownerSalt, 32);
  const ownerKey = computeR5R6Hash(ownerBytes, ownerSalt.subarray(8), uFull, 6);
  const oe = aesCbcEncrypt(ownerKey, new Uint8Array(16), fileKey, false);

  const permissions = new Uint8Array(16);
  new DataView(permissions.buffer).setInt32(0, pMask, true);
  permissions.fill(255, 4, 8);
  permissions.set([84, 97, 100, 98], 8); // EncryptMetadata=true, followed by "adb".
  permissions.set(globalThis.crypto.getRandomValues(new Uint8Array(4)), 12);
  // A single CBC block with a zero IV is the required AES-ECB block.
  const perms = aesCbcEncrypt(fileKey, new Uint8Array(16), permissions, false);
  return { fileKey, dict: cosDict({
    Filter: cosName("Standard"), V: cosNumber(5), R: cosNumber(6),
    Length: cosNumber(256), P: cosNumber(pMask), EncryptMetadata: cosBool(true),
    U: cosHexString(uFull), O: cosHexString(oFull), UE: cosHexString(ue), OE: cosHexString(oe),
    Perms: cosHexString(perms),
    CF: cosDict({ StdCF: cosDict({ CFM: cosName("AESV3"), AuthEvent: cosName("DocOpen"), Length: cosNumber(32) }) }),
    StmF: cosName("StdCF"), StrF: cosName("StdCF"),
  }) };
}

export function* encryptCosDocumentSteps(doc: ParsedCosDocument, options: EncryptPdfOptions = {}): Generator<void, Uint8Array, void> {
  yield;

  const userPassword = options.userPassword ?? "";
  const ownerPassword = options.ownerPassword ?? userPassword;
  const revision = options.revision ?? 6;
  if (revision !== 3 && revision !== 6) throw new PdfError("E_CAPABILITY", `Unsupported encryption revision: ${revision}`);
  const pMask = encodePermissionsMask(options.permissions ?? {});
  const idBytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const { fileKey, dict: encryptDict } = revision === 6
    ? createR6Encryption(userPassword, ownerPassword, pMask)
    : createR3Encryption(userPassword, ownerPassword, pMask, idBytes);
  const state: PdfEncryptionState = {
    filter: "Standard", version: revision === 6 ? 5 : 2, revision,
    keyLengthBits: fileKey.length * 8, encryptMetadata: true,
    permissions: decodePermissionsMask(pMask), fileKey,
  };
  let maxObjNum = 0;
  for (const obj of doc.objects.values()) maxObjNum = Math.max(maxObjNum, obj.objectNumber);
  const encryptObjNum = maxObjNum + 1;
  const encryptedObjects: PdfIndirectObject[] = [];
  for (const obj of doc.objects.values()) {
    yield;

    const transformed = (yield* transformNodeStringsAndStreamsSteps(obj.value, plain =>
      encryptPdfBuffer(state, obj.objectNumber, obj.generationNumber, plain)
    ));
    encryptedObjects.push({ objectNumber: obj.objectNumber, generationNumber: obj.generationNumber, value: transformed });
  }
  encryptedObjects.push({ objectNumber: encryptObjNum, generationNumber: 0, value: encryptDict });
  return (yield* serializeCosDocumentSteps({
    objects: encryptedObjects, rootRef: doc.rootRef, infoRef: doc.infoRef,
    encryptRef: cosRef(encryptObjNum),
    idArray: cosArray([cosHexString(idBytes), cosHexString(idBytes)]),
    version: revision === 6 ? "2.0" : Number.parseFloat(doc.version) < 1.4 ? "1.4" : doc.version,
  }));
}
export function encryptCosDocument(doc: ParsedCosDocument, options: EncryptPdfOptions = {}): Uint8Array { return drainWork(encryptCosDocumentSteps(doc, options)); }


// PDF.js Parser.makeStream/filter: explicit Crypt suppresses StmF and is
// evaluated at its declared position. Preserve all remaining encoded filters.
function decryptStream(
  doc: ParsedCosDocument,
  stream: PdfCosStream,
  transform: ReturnType<CipherTransformFactory["createCipherTransform"]>
): PdfCosStream {
  const type = doc.resolve(dictGet(stream.dict, "Type"));
  const decrypt = (bytes: Uint8Array, cryptName?: Name) => {
    const input = new Stream(bytes);
    input.dict = new Dict();
    if (type?.kind === "name") input.dict.set("Type", Name.get(type.decoded));
    return transform.createStream(input, bytes.length, cryptName).getBytes();
  };
  const filter = doc.resolve(dictGet(stream.dict, "Filter") ?? dictGet(stream.dict, "F"));
  const filters = filter?.kind === "array" ? filter.items.map(node => doc.resolve(node)) : [filter];
  let lastCrypt = -1;
  for (let i = 0; i < filters.length; i++) {
    const node = filters[i];
    if (node?.kind === "name" && node.decoded === "Crypt") lastCrypt = i;
  }
  if (lastCrypt < 0) return { ...stream, rawBytes: decrypt(stream.rawBytes) };

  const params = doc.resolve(dictGet(stream.dict, "DecodeParms") ?? dictGet(stream.dict, "DP"));
  let bytes = stream.rawBytes;
  for (let i = 0; i <= lastCrypt; i++) {
    const filter = filters[i];
    if (filter?.kind !== "name") throw new PdfError("E_PARSE", "Invalid encrypted stream filter");
    const parameter = doc.resolve(params?.kind === "array" ? params.items[i] : params);
    if (filter.decoded === "Crypt") {
      const name = parameter?.kind === "dict" ? doc.resolve(dictGet(parameter, "Name")) : undefined;
      bytes = decrypt(bytes, Name.get(name?.kind === "name" ? name.decoded : "Identity"));
    } else {
      bytes = decodeStreamObject({ kind: "stream", rawBytes: bytes, dict: cosDict({ Filter: filter, DecodeParms: parameter }) }, doc.maxDecompressedBytes, node => doc.resolve(node));
    }
    assertDecodedByteBudget(bytes.length, doc.maxDecompressedBytes);
  }
  const dict: PdfCosDict = { kind: "dict", entries: [...stream.dict.entries] };
  for (const key of ["Filter", "F", "DecodeParms", "DP"]) dictDelete(dict, key);
  const remaining = filters.slice(lastCrypt + 1);
  if (remaining.length) {
    if (remaining.some(node => node?.kind !== "name")) throw new PdfError("E_PARSE", "Invalid encrypted stream filter");
    dictSet(dict, "Filter", cosArray(remaining as PdfCosNode[]));
    if (params?.kind === "array") dictSet(dict, "DecodeParms", cosArray(params.items.slice(lastCrypt + 1)));
    else if (params?.kind === "dict") dictSet(dict, "DecodeParms", params);
  }
  return { kind: "stream", dict, rawBytes: bytes };
}

export function* decryptCosDocumentSteps(doc: ParsedCosDocument, state: PdfEncryptionState): Generator<void, void, void> {
  yield;

  const encryptObjNum = doc.encryptRef?.objectNumber;
  const handler = securityHandlers.get(state);
  for (const [num, obj] of doc.objects.entries()) {
    yield;

    if (num === encryptObjNum || handler?.plaintextObjects.has(num)) continue;
    if (obj.value.kind === "stream") {
      const type = doc.resolve(dictGet(obj.value.dict, "Type"));
      if (type?.kind === "name" && (type.decoded === "XRef" || (type.decoded === "Metadata" && !state.encryptMetadata))) continue;
    }
    const transform = handler?.factory.createCipherTransform(obj.objectNumber, obj.generationNumber);
    const decrypted = (yield* transformNodeStringsAndStreamsSteps(obj.value,
      cipher => decryptPdfBuffer(state, obj.objectNumber, obj.generationNumber, cipher),
      transform ? stream => decryptStream(doc, stream, transform) : undefined
    ));
    doc.objects.set(num, { objectNumber: obj.objectNumber, generationNumber: obj.generationNumber, value: decrypted, span: obj.span });
  }
}
export function decryptCosDocument(doc: ParsedCosDocument, state: PdfEncryptionState): void { return drainWork(decryptCosDocumentSteps(doc, state)); }


export const authenticateStandardEncryption = derivePdfEncryptionKey;
