import { PDF17, PDF20, saslPrep } from "../vendor/pdfjs-fonts.mjs";
import { stringToBytes } from "../bytes.js";
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
    const prepared = revision === 6 ? saslPrep(password) : password;
    for (const candidate of prepared === password ? [password] : [prepared, password]) {
      const pwdBytes = new TextEncoder().encode(candidate).subarray(0, 127);
      const rev = revision as 5 | 6;

      // Check user password
      const uValHash = computeR5R6Hash(pwdBytes, uBytes.subarray(32, 40), new Uint8Array(0), rev);
      const isUserMatch = uValHash.every((b, idx) => b === uBytes[idx]);
      if (isUserMatch) {
        const uKeyHash = computeR5R6Hash(pwdBytes, uBytes.subarray(40, 48), new Uint8Array(0), rev);
        const fileKey = aesCbcDecrypt(uKeyHash, new Uint8Array(16), ueNode.bytes.subarray(0, 32), false);
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
        const fileKey = aesCbcDecrypt(oKeyHash, new Uint8Array(16), oeNode.bytes.subarray(0, 32), false);
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
    let digest = md5Bytes(chunks);
    if (revision >= 3) {
      for (let i = 0; i < 50; i++) {
        digest = md5Bytes([digest.subarray(0, keyBytesLen)]);
      }
    }
    return digest.subarray(0, keyBytesLen);
  };

  const computeUserValue = (fileKey: Uint8Array): Uint8Array => {
    if (revision === 2) {
      return rc4Transform(fileKey, PADDING_32);
    }
    const digest = md5Bytes([PADDING_32, documentId0]);
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

export function encryptCosDocument(doc: ParsedCosDocument, options: EncryptPdfOptions = {}): Uint8Array {
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
    const transformed = transformNodeStringsAndStreams(obj.value, plain =>
      encryptPdfBuffer(state, obj.objectNumber, obj.generationNumber, plain)
    );
    encryptedObjects.push({ objectNumber: obj.objectNumber, generationNumber: obj.generationNumber, value: transformed });
  }
  encryptedObjects.push({ objectNumber: encryptObjNum, generationNumber: 0, value: encryptDict });
  return serializeCosDocument({
    objects: encryptedObjects, rootRef: doc.rootRef, infoRef: doc.infoRef,
    encryptRef: cosRef(encryptObjNum),
    idArray: cosArray([cosHexString(idBytes), cosHexString(idBytes)]),
    version: revision === 6 ? "2.0" : Number.parseFloat(doc.version) < 1.4 ? "1.4" : doc.version,
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
