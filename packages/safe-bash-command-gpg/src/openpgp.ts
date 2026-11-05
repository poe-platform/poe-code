// V4 EdDSALegacy signing certificates (RFC 9580), with one self-certified user ID.
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";

const curve = [22, 9, 0x2b, 6, 1, 4, 1, 0xda, 0x47, 0x0f, 1, 1, 7, 0x40];
const invalid = () => new PublicDiagnostic("invalid or unsupported public certificate");
type Bytes = Uint8Array | readonly number[];
export function concat(...parts: Bytes[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function u32(n: number) { return [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255]; }
function equals(a: Bytes, b: Bytes) { return a.length === b.length && a.every((x, i) => x === b[i]); }
function packet(tag: number, body: Uint8Array) {
  return concat([192 | tag], body.length < 192 ? [body.length] : [255, ...u32(body.length)], body);
}

class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(n: number) {
    if (this.at + n > this.bytes.length) throw invalid();
    const b = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return b;
  }
  number(n: number) { return this.take(n).reduce((x, b) => x * 256 + b, 0); }
  packet(tag: number) {
    const ctb = this.number(1);
    let length: number;
    if (ctb === (192 | tag)) {
      const first = this.number(1);
      if (first < 192) length = first;
      else if (first < 224) length = (first - 192) * 256 + this.number(1) + 192;
      else if (first === 255) length = this.number(4);
      else throw invalid();
    } else if ((ctb & 252) === (128 | tag << 2) && (ctb & 3) !== 3) {
      length = this.number(1 << (ctb & 3));
    } else throw invalid();
    return this.take(length);
  }
  mpi() {
    const bits = this.number(2);
    if (bits > 256) throw invalid();
    const b = this.take(Math.ceil(bits / 8));
    if (b.length * 8 - (b.length ? Math.clz32(b[0]!) - 24 : 0) !== bits) throw invalid();
    const result = new Uint8Array(32);
    result.set(b, 32 - b.length);
    return result;
  }
}

function mpi(bytes: Uint8Array) {
  const start = bytes.findIndex(b => b !== 0);
  const b = start < 0 ? bytes.subarray(0, 0) : bytes.subarray(start);
  const bits = b.length * 8 - (b.length ? Math.clz32(b[0]!) - 24 : 0);
  return concat([bits >> 8, bits & 255], b);
}

function keyHashInput(body: Uint8Array) { return concat([0x99, body.length >> 8, body.length & 255], body); }
function certInput(body: Uint8Array, uid: Uint8Array) { return concat(keyHashInput(body), [0xb4, ...u32(uid.length)], uid); }
function header(kind: number, fp: Uint8Array, time: number) {
  const hashed = concat([5, 2, ...u32(time), 22, 33, 4], fp, kind === 0x13 ? [2, 27, 3] : []);
  return concat([4, kind, 22, 8, 0, hashed.length], hashed);
}
async function digest(payload: Uint8Array, head: Uint8Array) {
  const alg = ({ 8: "SHA-256", 9: "SHA-384", 10: "SHA-512" } as Record<number, string>)[head[3]!];
  if (!alg) throw invalid();
  return new Uint8Array(await crypto.subtle.digest(alg, concat(payload, head, [4, 255, ...u32(head.length)])));
}

export async function sign(kind: number, fp: Uint8Array, time: number, privateKey: CryptoKey, payload: Uint8Array) {
  const head = header(kind, fp, time);
  const hash = await digest(payload, head);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, hash));
  return packet(2, concat(head, [0, 10, 9, 16], fp.subarray(12), hash.subarray(0, 2), mpi(sig.subarray(0, 32)), mpi(sig.subarray(32))));
}

// Some WebCrypto providers accept the Ed25519 identity as a signing key.
// For the remaining order-eight points, doubling yields y=0, i.e.
// d*y^4 + 2*y^2 - 1 = 0 in the Edwards field.
export function validPoint(bytes: Uint8Array) {
  if (bytes.length !== 32) return false;
  const p = (1n << 255n) - 19n;
  const d = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
  let y = BigInt(bytes[31]! & 127);
  for (let i = 30; i >= 0; --i) y = (y << 8n) | BigInt(bytes[i]!);
  if (y <= 1n || y >= p - 1n) return false;
  const y2 = y * y % p;
  return (d * y2 * y2 + 2n * y2 - 1n) % p !== 0n;
}

async function verify(body: Uint8Array, kind: number, fp: Uint8Array, pub: Uint8Array, payload: Uint8Array) {
  const r = new Reader(body);
  if (!equals(r.take(3), [4, kind, 22])) throw invalid();
  const hashAlgorithm = r.number(1);
  const subs = new Reader(r.take(r.number(2)));
  const head = body.subarray(0, r.at);
  let time: number | undefined, lifetime: number | undefined, flags = false, issuer = false;
  while (subs.at < subs.bytes.length) {
    const first = subs.number(1);
    const length = first < 192 ? first : first === 255 ? subs.number(4) : (first - 192) * 256 + subs.number(1) + 192;
    const sub = new Reader(subs.take(length));
    const tag = sub.number(1);
    const data = sub.bytes.subarray(1);
    switch (tag & 127) {
      case 2:
        if (time !== undefined || data.length !== 4) throw invalid();
        time = sub.number(4); break;
      case 33:
        if (issuer || !equals(data, concat([4], fp))) throw invalid();
        issuer = true; break;
      case 27:
        if (kind !== 0x13 || flags || !(data[0]! & 2)) throw invalid();
        flags = true; break;
      case 9:
        if (kind !== 0x13 || lifetime !== undefined || data.length !== 4) throw invalid();
        lifetime = sub.number(4); break;
      case 11: case 21: case 22: case 23: case 30: case 34:
        if (kind !== 0x13 || tag >= 128) throw invalid();
        break;
      case 28: // The signer's hint is not an authenticated identity binding.
        if (kind !== 0 || tag >= 128) throw invalid();
        break;
      default: throw invalid();
    }
  }
  if (!issuer || time === undefined || (kind === 0x13 && !flags) ||
      !equals(r.take(12), concat([0, 10, 9, 16], fp.subarray(12)))) throw invalid();
  const hash = await digest(payload, head);
  if (!equals(r.take(2), hash.subarray(0, 2))) throw invalid();
  const sig = concat(r.mpi(), r.mpi());
  if (r.at !== r.bytes.length || !validPoint(pub) || !validPoint(sig.subarray(0, 32))) throw invalid();
  const key = await crypto.subtle.importKey("raw", new Uint8Array(pub), "Ed25519", false, ["verify"]);
  if (!await crypto.subtle.verify("Ed25519", key, sig, hash)) throw invalid();
  return { time, hashAlgorithm, lifetime };
}

export async function certify(name: string, pub: Uint8Array, secret: CryptoKey, time: number) {
  const body = concat([4, ...u32(time), ...curve], pub);
  const fp = new Uint8Array(await crypto.subtle.digest("SHA-1", keyHashInput(body)));
  const uid = new TextEncoder().encode(name);
  const sig = await sign(0x13, fp, time, secret, certInput(body, uid));
  return { fp, bytes: concat(packet(6, body), packet(13, uid), sig) };
}

export async function readCertificates(bytes: Uint8Array) {
  const r = new Reader(bytes);
  const certs = [];
  while (r.at < bytes.length) {
    const start = r.at;
    const body = r.packet(6);
    if (body.length !== 5 + curve.length + 32 || body[0] !== 4 || !equals(body.subarray(5, -32), curve)) throw invalid();
    const publicKey = body.subarray(-32);
    const fp = new Uint8Array(await crypto.subtle.digest("SHA-1", keyHashInput(body)));
    const uidBytes = r.packet(13);
    const uid = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(uidBytes);
    const binding = await verify(r.packet(2), 0x13, fp, publicKey, certInput(body, uidBytes));
    const created = new DataView(body.buffer, body.byteOffset, body.length).getUint32(1);
    if (binding.time < created) throw invalid();
    certs.push({ uid, publicKey, fp, created, certified: binding.time, expires: binding.lifetime ? created + binding.lifetime : undefined, bytes: bytes.subarray(start, r.at) });
  }
  if (!certs.length) throw invalid();
  return certs;
}

export async function verifyMessage(bytes: Uint8Array, fp: Uint8Array, pub: Uint8Array, payload: Uint8Array) {
  try {
    const r = new Reader(bytes);
    const body = r.packet(2);
    if (r.at === bytes.length) return await verify(body, 0, fp, pub, payload);
  } catch { /* malformed signature */ }
  return undefined;
}
