import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import {
  cosArray,
  cosBool,
  cosDict,
  cosHexString,
  cosName,
  cosNumber,
  cosRef,
  dictGet,
  type PdfCosDict,
  type PdfCosNode,
  type PdfEncryptionState,
  type PdfIndirectObject,
  type PdfPermissions,
} from "../ast.js";
import { PdfError } from "../errors.js";
import type { ParsedCosDocument } from "./parser.js";
import { serializeCosDocument } from "./writer.js";

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

function md5(chunks: readonly Uint8Array[]): Uint8Array {
  const h = createHash("md5");
  for (const c of chunks) h.update(c);
  return new Uint8Array(h.digest());
}

function sha256(chunks: readonly Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return new Uint8Array(h.digest());
}

function padPassword32(password: string): Uint8Array {
  const bytes = new TextEncoder().encode(password);
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

/**
 * PDF 2.0 / ISO 32000-2 Algorithm 2.B (R6 hash) and R5 SHA-256 hash.
 */
export function computeR5R6Hash(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  userKey: Uint8Array,
  revision: 5 | 6
): Uint8Array {
  const pwd = passwordBytes.subarray(0, 127);
  let k = sha256([pwd, salt, userKey]);
  if (revision === 5) return k;

  let round = 0;
  while (true) {
    const k1BlockLen = pwd.length + k.length + userKey.length;
    const k1 = new Uint8Array(k1BlockLen * 64);
    for (let i = 0; i < 64; i++) {
      const base = i * k1BlockLen;
      k1.set(pwd, base);
      k1.set(k, base + pwd.length);
      k1.set(userKey, base + pwd.length + k.length);
    }
    const cipher = createCipheriv("aes-128-cbc", k.subarray(0, 16), k.subarray(16, 32));
    cipher.setAutoPadding(false);
    const e = new Uint8Array(Buffer.concat([cipher.update(k1), cipher.final()]));
    let sumMod3 = 0;
    for (let i = 0; i < 16; i++) {
      sumMod3 = (sumMod3 + e[i]!) % 3;
    }
    const algo = sumMod3 === 0 ? "sha256" : sumMod3 === 1 ? "sha384" : "sha512";
    k = new Uint8Array(createHash(algo).update(e).digest());
    round++;
    if (round >= 64 && e[e.length - 1]! <= round - 32) {
      break;
    }
  }
  return k.subarray(0, 32);
}

export function derivePdfEncryptionKey(
  encryptDict: PdfCosDict,
  documentId0: Uint8Array,
  password = ""
): PdfEncryptionState {
  const filterNode = dictGet(encryptDict, "Filter");
  const filter = filterNode?.kind === "name" ? filterNode.decoded : "Standard";
  if (filter !== "Standard") {
    throw new PdfError("E_CAPABILITY", `Unsupported PDF security handler: ${filter}`);
  }
  const vNode = dictGet(encryptDict, "V");
  const rNode = dictGet(encryptDict, "R");
  const lengthNode = dictGet(encryptDict, "Length");
  const pNode = dictGet(encryptDict, "P");
  const uNode = dictGet(encryptDict, "U");
  const oNode = dictGet(encryptDict, "O");
  const ueNode = dictGet(encryptDict, "UE");
  const oeNode = dictGet(encryptDict, "OE");
  const encMetaNode = dictGet(encryptDict, "EncryptMetadata");

  const version = vNode?.kind === "number" ? vNode.value : 1;
  const revision = rNode?.kind === "number" ? rNode.value : 2;
  const keyLengthBits = lengthNode?.kind === "number" ? lengthNode.value : revision >= 5 ? 256 : version >= 2 ? 128 : 40;
  const pMask = pNode?.kind === "number" ? pNode.value : -4;
  const encryptMetadata = encMetaNode?.kind === "boolean" ? encMetaNode.value : true;
  const uBytes = uNode?.kind === "string" ? uNode.bytes : new Uint8Array(0);
  const oBytes = oNode?.kind === "string" ? oNode.bytes : new Uint8Array(0);

  if (revision === 5 || revision === 6) {
    if (uBytes.length < 48 || oBytes.length < 48 || ueNode?.kind !== "string" || oeNode?.kind !== "string") {
      throw new PdfError("E_CAPABILITY", "Invalid R5/R6 encryption dictionary entries");
    }
    const pwdBytes = new TextEncoder().encode(password).subarray(0, 127);
    const rev = revision as 5 | 6;

    // Check user password
    const uValHash = computeR5R6Hash(pwdBytes, uBytes.subarray(32, 40), new Uint8Array(0), rev);
    const isUserMatch = uValHash.every((b, idx) => b === uBytes[idx]);
    if (isUserMatch) {
      const uKeyHash = computeR5R6Hash(pwdBytes, uBytes.subarray(40, 48), new Uint8Array(0), rev);
      const decipher = createDecipheriv("aes-256-cbc", uKeyHash, new Uint8Array(16));
      decipher.setAutoPadding(false);
      const fileKey = new Uint8Array(Buffer.concat([decipher.update(ueNode.bytes.subarray(0, 32)), decipher.final()]));
      return {
        filter,
        version,
        revision,
        keyLengthBits: 256,
        encryptMetadata,
        permissions: decodePermissionsMask(pMask),
        fileKey,
      };
    }

    // Check owner password
    const oValHash = computeR5R6Hash(pwdBytes, oBytes.subarray(32, 40), uBytes.subarray(0, 48), rev);
    const isOwnerMatch = oValHash.every((b, idx) => b === oBytes[idx]);
    if (isOwnerMatch) {
      const oKeyHash = computeR5R6Hash(pwdBytes, oBytes.subarray(40, 48), uBytes.subarray(0, 48), rev);
      const decipher = createDecipheriv("aes-256-cbc", oKeyHash, new Uint8Array(16));
      decipher.setAutoPadding(false);
      const fileKey = new Uint8Array(Buffer.concat([decipher.update(oeNode.bytes.subarray(0, 32)), decipher.final()]));
      return {
        filter,
        version,
        revision,
        keyLengthBits: 256,
        encryptMetadata,
        permissions: decodePermissionsMask(pMask),
        fileKey,
      };
    }

    throw new PdfError("E_CAPABILITY", "Invalid PDF password");
  }

  // Revision 2, 3, or 4
  const keyBytesLen = Math.max(5, Math.floor(keyLengthBits / 8));
  const computeR2To4FileKey = (pwdPad: Uint8Array): Uint8Array => {
    const pBuf = new Uint8Array(4);
    new DataView(pBuf.buffer).setInt32(0, pMask, true);
    const chunks: Uint8Array[] = [pwdPad, oBytes.subarray(0, 32), pBuf, documentId0];
    if (revision >= 4 && !encryptMetadata) {
      chunks.push(Uint8Array.from([0xff, 0xff, 0xff, 0xff]));
    }
    let digest = md5(chunks);
    if (revision >= 3) {
      for (let i = 0; i < 50; i++) {
        digest = md5([digest.subarray(0, keyBytesLen)]);
      }
    }
    return digest.subarray(0, keyBytesLen);
  };

  const computeUserValue = (fileKey: Uint8Array): Uint8Array => {
    if (revision === 2) {
      return rc4Transform(fileKey, PADDING_32);
    }
    const digest = md5([PADDING_32, documentId0]);
    let encrypted = rc4Transform(fileKey, digest);
    for (let i = 1; i <= 19; i++) {
      const iterKey = new Uint8Array(fileKey.length);
      for (let j = 0; j < fileKey.length; j++) iterKey[j] = fileKey[j]! ^ i;
      encrypted = rc4Transform(iterKey, encrypted);
    }
    return encrypted;
  };

  const userKeyCandidate = computeR2To4FileKey(padPassword32(password));
  const expectedU = computeUserValue(userKeyCandidate);
  const checkLen = revision === 2 ? 32 : 16;
  if (expectedU.subarray(0, checkLen).every((b, idx) => b === uBytes[idx])) {
    return {
      filter,
      version,
      revision,
      keyLengthBits,
      encryptMetadata,
      permissions: decodePermissionsMask(pMask),
      fileKey: userKeyCandidate,
    };
  }

  throw new PdfError("E_CAPABILITY", "Invalid PDF password");
}

export function decryptPdfBuffer(
  state: PdfEncryptionState,
  objectNumber: number,
  generationNumber: number,
  data: Uint8Array
): Uint8Array {
  if (data.length === 0) return data;

  if (state.revision === 5 || state.revision === 6) {
    if (data.length < 16 || data.length % 16 !== 0) {
      return data;
    }
    const iv = data.subarray(0, 16);
    const ciphertext = data.subarray(16);
    if (ciphertext.length === 0) return new Uint8Array(0);
    const decipher = createDecipheriv("aes-256-cbc", state.fileKey, iv);
    return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
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
  const objKey = md5([state.fileKey, suffix]).subarray(0, Math.min(16, state.fileKey.length + 5));
  if (useAes128) {
    if (data.length < 16 || data.length % 16 !== 0) return data;
    const iv = data.subarray(0, 16);
    const ciphertext = data.subarray(16);
    const decipher = createDecipheriv("aes-128-cbc", objKey.subarray(0, 16), iv);
    return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  }
  return rc4Transform(objKey, data);
}

export function encryptPdfBuffer(
  state: PdfEncryptionState,
  objectNumber: number,
  generationNumber: number,
  plaintext: Uint8Array
): Uint8Array {
  if (state.revision === 5 || state.revision === 6) {
    // Deterministic 16-byte IV from objectNumber/generationNumber for reproducible tests
    const iv = sha256([
      state.fileKey,
      Uint8Array.from([
        objectNumber & 0xff,
        (objectNumber >>> 8) & 0xff,
        generationNumber & 0xff,
      ]),
    ]).subarray(0, 16);
    const cipher = createCipheriv("aes-256-cbc", state.fileKey, iv);
    const enc = new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final()]));
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
  const objKey = md5([state.fileKey, suffix]).subarray(0, Math.min(16, state.fileKey.length + 5));
  return rc4Transform(objKey, plaintext);
}

function transformNodeStringsAndStreams(
  node: PdfCosNode,
  transform: (bytes: Uint8Array) => Uint8Array
): PdfCosNode {
  switch (node.kind) {
    case "string":
      return {
        kind: "string",
        format: "hex",
        bytes: transform(node.bytes),
      };
    case "array":
      return {
        kind: "array",
        items: node.items.map(item => transformNodeStringsAndStreams(item, transform)),
      };
    case "dict":
      return {
        kind: "dict",
        entries: node.entries.map(e => ({
          key: e.key,
          value: transformNodeStringsAndStreams(e.value, transform),
        })),
      };
    case "stream": {
      const transformedStream = transform(node.rawBytes);
      const updatedDict: PdfCosDict = {
        kind: "dict",
        entries: node.dict.entries.map(e => ({
          key: e.key,
          value:
            e.key.decoded === "Length"
              ? cosNumber(transformedStream.length)
              : transformNodeStringsAndStreams(e.value, transform),
        })),
      };
      return {
        kind: "stream",
        dict: updatedDict,
        rawBytes: transformedStream,
      };
    }
    default:
      return node;
  }
}

export interface EncryptPdfOptions {
  readonly userPassword?: string | undefined;
  readonly ownerPassword?: string | undefined;
  readonly revision?: 3 | 6 | undefined;
  readonly permissions?: Partial<PdfPermissions> | undefined;
}

export function encryptCosDocument(doc: ParsedCosDocument, options: EncryptPdfOptions = {}): Uint8Array {
  const userPassword = options.userPassword ?? "";
  const ownerPassword = options.ownerPassword ?? userPassword;
  const revision = options.revision ?? 6;
  const pMask = encodePermissionsMask(options.permissions ?? {});
  const permissions = decodePermissionsMask(pMask);

  const fileKey = sha256([
    new TextEncoder().encode(`poe-pdf-key:${userPassword}:${ownerPassword}:${pMask}`),
  ]);

  const uValSalt = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const uKeySalt = Uint8Array.from([9, 10, 11, 12, 13, 14, 15, 16]);
  const oValSalt = Uint8Array.from([17, 18, 19, 20, 21, 22, 23, 24]);
  const oKeySalt = Uint8Array.from([25, 26, 27, 28, 29, 30, 31, 32]);

  const userBytes = new TextEncoder().encode(userPassword).subarray(0, 127);
  const ownerBytes = new TextEncoder().encode(ownerPassword).subarray(0, 127);

  const uHash = computeR5R6Hash(userBytes, uValSalt, new Uint8Array(0), 6);
  const uFull = new Uint8Array(48);
  uFull.set(uHash, 0);
  uFull.set(uValSalt, 32);
  uFull.set(uKeySalt, 40);

  const uKeyHash = computeR5R6Hash(userBytes, uKeySalt, new Uint8Array(0), 6);
  const ueCipher = createCipheriv("aes-256-cbc", uKeyHash, new Uint8Array(16));
  ueCipher.setAutoPadding(false);
  const ueBytes = new Uint8Array(Buffer.concat([ueCipher.update(fileKey), ueCipher.final()]));

  const oHash = computeR5R6Hash(ownerBytes, oValSalt, uFull, 6);
  const oFull = new Uint8Array(48);
  oFull.set(oHash, 0);
  oFull.set(oValSalt, 32);
  oFull.set(oKeySalt, 40);

  const oKeyHash = computeR5R6Hash(ownerBytes, oKeySalt, uFull, 6);
  const oeCipher = createCipheriv("aes-256-cbc", oKeyHash, new Uint8Array(16));
  oeCipher.setAutoPadding(false);
  const oeBytes = new Uint8Array(Buffer.concat([oeCipher.update(fileKey), oeCipher.final()]));

  const state: PdfEncryptionState = {
    filter: "Standard",
    version: 5,
    revision,
    keyLengthBits: 256,
    encryptMetadata: true,
    permissions,
    fileKey,
  };

  let maxObjNum = 0;
  for (const obj of doc.objects.values()) {
    if (obj.objectNumber > maxObjNum) maxObjNum = obj.objectNumber;
  }
  const encryptObjNum = maxObjNum + 1;

  const encryptedObjects: PdfIndirectObject[] = [];
  for (const obj of doc.objects.values()) {
    const transformed = transformNodeStringsAndStreams(obj.value, plain =>
      encryptPdfBuffer(state, obj.objectNumber, obj.generationNumber, plain)
    );
    encryptedObjects.push({
      objectNumber: obj.objectNumber,
      generationNumber: obj.generationNumber,
      value: transformed,
    });
  }

  const encryptDict = cosDict({
    Filter: cosName("Standard"),
    V: cosNumber(5),
    R: cosNumber(6),
    Length: cosNumber(256),
    P: cosNumber(pMask),
    EncryptMetadata: cosBool(true),
    U: cosHexString(uFull),
    O: cosHexString(oFull),
    UE: cosHexString(ueBytes),
    OE: cosHexString(oeBytes),
  });

  encryptedObjects.push({
    objectNumber: encryptObjNum,
    generationNumber: 0,
    value: encryptDict,
  });

  const idBytes = sha256([fileKey]).subarray(0, 16);
  return serializeCosDocument({
    objects: encryptedObjects,
    rootRef: doc.rootRef,
    infoRef: doc.infoRef,
    encryptRef: cosRef(encryptObjNum),
    idArray: cosArray([cosHexString(idBytes), cosHexString(idBytes)]),
  });
}

export function decryptCosDocument(doc: ParsedCosDocument, state: PdfEncryptionState): void {
  const encryptObjNum = doc.encryptRef?.objectNumber;
  for (const [num, obj] of doc.objects.entries()) {
    if (num === encryptObjNum) continue;
    const decrypted = transformNodeStringsAndStreams(obj.value, cipher =>
      decryptPdfBuffer(state, obj.objectNumber, obj.generationNumber, cipher)
    );
    doc.objects.set(num, {
      objectNumber: obj.objectNumber,
      generationNumber: obj.generationNumber,
      value: decrypted,
      span: obj.span,
    });
  }
}

export const authenticateStandardEncryption = derivePdfEncryptionKey;
