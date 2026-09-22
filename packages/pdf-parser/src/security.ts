/** Original ISO 32000 standard-security orchestration. Crypto is an explicit capability. */
import { SyntaxReader, admittedByteLength } from "./syntax.js";
import type { PdfObject, PdfParseOptions } from "./syntax.js";
export class PdfSecurityError extends Error {
  constructor(
    readonly code:
      | "MISSING_PASSWORD"
      | "WRONG_PASSWORD"
      | "PUBLIC_KEY_UNSUPPORTED"
      | "UNSUPPORTED"
      | "INVALID_SECURITY"
      | "INVALID_CIPHERTEXT"
      | "PASSWORD_ENCODING",
    message: string
  ) {
    super(message);
  }
}
/** Primitives use no automatic padding. Implementations must return owned bytes,
 * honor the signal, and perform no file/network access or algorithm fallback. */
export interface PdfCrypto {
  digest(
    algorithm: "MD5" | "SHA-256" | "SHA-384" | "SHA-512",
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Uint8Array | Promise<Uint8Array>;
  rc4(key: Uint8Array, bytes: Uint8Array, signal?: AbortSignal): Uint8Array | Promise<Uint8Array>;
  aes(
    operation: "encrypt" | "decrypt",
    mode: "CBC" | "ECB",
    key: Uint8Array,
    iv: Uint8Array,
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Uint8Array | Promise<Uint8Array>;
}
export interface PdfPassword {
  bytes: Uint8Array;
  /** Legacy bytes are caller-encoded PDFDocEncoding; R5 uses UTF-8, R6 uses
   * caller-prepared SASLprep UTF-8. No locale or lossy transcoding is inferred. */
  encoding: "legacy" | "utf8" | "saslprep-utf8";
}
export interface PdfDecryptOptions {
  objectNumber: number;
  generation: number;
  kind: "string" | "stream" | "embedded-file";
  metadata?: boolean;
  /** Explicit /Crypt /Name; omitted selects StrF, StmF or EFF. */
  cryptFilter?: string;
}
export interface PdfSecurityOptions extends Pick<PdfParseOptions, "signal" | "limits"> {
  crypto: PdfCrypto;
}
export interface PdfSecuritySession {
  readonly role: "user" | "owner";
  readonly permissions: number;
  readonly encryptMetadata: boolean;
  decrypt(bytes: Uint8Array, options: PdfDecryptOptions): Promise<Uint8Array>;
}
type Method = "Identity" | "V2" | "AESV2" | "AESV3";
interface CryptFilter {
  method: Method;
  event: "DocOpen" | "EFOpen";
}
const padding = Uint8Array.of(
  0x28,
  0xbf,
  0x4e,
  0x5e,
  0x4e,
  0x75,
  0x8a,
  0x41,
  0x64,
  0,
  0x4e,
  0x56,
  0xff,
  0xfa,
  1,
  8,
  0x2e,
  0x2e,
  0,
  0xb6,
  0xd0,
  0x68,
  0x3e,
  0x80,
  0x2f,
  0x0c,
  0xa9,
  0xfe,
  0x64,
  0x53,
  0x69,
  0x7a
);
class StandardSecurity {
  private readonly budget: SyntaxReader;
  private readonly filters = new Map<string, CryptFilter>();
  private readonly revision: number;
  private readonly keyBytes: number;
  private readonly owner: Uint8Array;
  private readonly user: Uint8Array;
  private readonly ownerKey: Uint8Array;
  private readonly userKey: Uint8Array;
  private readonly perms: Uint8Array;
  private readonly id: Uint8Array;
  private readonly permissions: number;
  private readonly metadata: boolean;
  private readonly streamFilter: string;
  private readonly stringFilter: string;
  private readonly fileFilter: string;
  private readonly options: PdfSecurityOptions;
  constructor(dictionary: PdfObject, id: Uint8Array, options: PdfSecurityOptions) {
    const provider = options.crypto;
    this.options = {
      ...options,
      crypto: Object.freeze({
        digest: provider.digest.bind(provider),
        rc4: provider.rc4.bind(provider),
        aes: provider.aes.bind(provider)
      })
    };
    this.budget = new SyntaxReader(new Uint8Array(), this.options);
    const d = this.fields(dictionary);
    const handler = this.name(d.get("Filter"));
    if (handler === "Adobe.PubSec")
      this.error("PUBLIC_KEY_UNSUPPORTED", "public-key security handlers are unsupported");
    if (handler !== "Standard") this.error("UNSUPPORTED", "unsupported PDF security handler");
    const v = this.integer(d.get("V"));
    this.revision = this.integer(d.get("R"));
    if (
      !(
        (v === 1 && this.revision === 2) ||
        (v === 2 && this.revision === 3) ||
        (v === 4 && this.revision === 4) ||
        (v === 5 && (this.revision === 5 || this.revision === 6))
      )
    )
      this.error("UNSUPPORTED", "unsupported standard security version/revision");
    const bits = d.has("Length") ? this.integer(d.get("Length")) : v === 5 ? 256 : 40;
    if (
      (v === 1 && bits !== 40) ||
      (v === 5 && bits !== 256) ||
      (v !== 5 && (bits < 40 || bits > 128 || bits % 8 !== 0))
    )
      this.error("INVALID_SECURITY", "invalid security key length");
    this.keyBytes = bits / 8;
    this.permissions = this.integer(d.get("P"));
    if (this.permissions < -2147483648 || this.permissions > 2147483647)
      this.error("INVALID_SECURITY", "permissions must be signed int32");
    const mask = this.revision === 2 ? 0xffffffc0 : 0xfffff0c0;
    if ((this.permissions & 3) !== 0 || (this.permissions & mask) >>> 0 !== mask >>> 0)
      this.error("INVALID_SECURITY", "invalid reserved permission bits");
    const metadata = d.get("EncryptMetadata");
    if (metadata && metadata.kind !== "boolean")
      this.error("INVALID_SECURITY", "EncryptMetadata must be boolean");
    this.metadata = metadata?.value !== false;
    if (v < 4 && !this.metadata)
      this.error("INVALID_SECURITY", "metadata exemption requires V4 or V5");
    this.owner = this.string(d.get("O"), this.revision >= 5 ? 48 : 32);
    this.user = this.string(d.get("U"), this.revision >= 5 ? 48 : 32);
    this.ownerKey = this.revision >= 5 ? this.string(d.get("OE"), 32) : new Uint8Array();
    this.userKey = this.revision >= 5 ? this.string(d.get("UE"), 32) : new Uint8Array();
    this.perms = this.revision >= 5 ? this.string(d.get("Perms"), 16) : new Uint8Array();
    this.id = this.copy(id);
    if (this.revision < 5 && !this.id.length)
      this.error("INVALID_SECURITY", "legacy encryption requires original trailer ID bytes");
    this.filters.set("Identity", { method: "Identity", event: "DocOpen" });
    if (v < 4) {
      if (d.has("CF") || d.has("StmF") || d.has("StrF") || d.has("EFF"))
        this.error("INVALID_SECURITY", "crypt filters require V4 or V5");
      this.filters.set("Legacy", { method: "V2", event: "DocOpen" });
      this.streamFilter = this.stringFilter = this.fileFilter = "Legacy";
    } else {
      for (const [name, object] of d.has("CF") ? this.fields(d.get("CF")!) : []) {
        if (name === "Identity") this.error("INVALID_SECURITY", "Identity is reserved");
        const f = this.fields(object);
        const cfm = f.has("CFM") ? this.name(f.get("CFM")) : "None";
        if (
          !(
            cfm === "None" ||
            (v === 4 && (cfm === "V2" || cfm === "AESV2")) ||
            (v === 5 && cfm === "AESV3")
          )
        )
          this.error("UNSUPPORTED", "unsupported crypt filter method");
        const method = cfm === "None" ? "Identity" : (cfm as Method);
        const length = f.has("Length") ? this.integer(f.get("Length")) : this.keyBytes;
        if (
          method !== "Identity" &&
          (length !== this.keyBytes ||
            (method === "AESV2" && length !== 16) ||
            (method === "AESV3" && length !== 32))
        )
          this.error("INVALID_SECURITY", "crypt filter key length disagrees with handler");
        const event = f.has("AuthEvent") ? this.name(f.get("AuthEvent")) : "DocOpen";
        if (event !== "DocOpen" && event !== "EFOpen")
          this.error("INVALID_SECURITY", "invalid crypt filter authentication event");
        this.filters.set(name, { method, event });
      }
      this.streamFilter = d.has("StmF") ? this.name(d.get("StmF")) : "Identity";
      this.stringFilter = d.has("StrF") ? this.name(d.get("StrF")) : "Identity";
      this.fileFilter = d.has("EFF") ? this.name(d.get("EFF")) : this.streamFilter;
      for (const name of [this.streamFilter, this.stringFilter, this.fileFilter])
        if (!this.filters.has(name))
          this.error("INVALID_SECURITY", "undefined default crypt filter");
      for (const name of [this.streamFilter, this.stringFilter])
        if (this.filters.get(name)!.event === "EFOpen")
          this.error("INVALID_SECURITY", "EFOpen filter cannot encrypt ordinary strings/streams");
    }
  }
  private error(code: PdfSecurityError["code"], message: string): never {
    throw new PdfSecurityError(code, message);
  }
  private copy(bytes: Uint8Array): Uint8Array {
    const length = admittedByteLength(bytes);
    if (length === undefined) this.error("INVALID_SECURITY", "expected security bytes");
    if (length > this.budget.limits.inputBytes)
      this.budget.fail("LIMIT", "security input byte limit");
    this.budget.charge(length);
    this.budget.reserve(length);
    return new Uint8Array(bytes);
  }
  private concat(...parts: Uint8Array[]): Uint8Array {
    const size = parts.reduce((n, p) => n + p.length, 0);
    this.budget.charge(size);
    this.budget.reserve(size);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      result.set(p, offset);
      offset += p.length;
    }
    return result;
  }
  private name(object: PdfObject | undefined): string {
    if (object?.kind !== "name" || !object.bytes)
      this.error("INVALID_SECURITY", "expected security name");
    const bytes = this.copy(object.bytes);
    this.budget.reserve(bytes.length * 2);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
  private fields(object: PdfObject): Map<string, PdfObject> {
    this.budget.check();
    if (object.kind !== "dictionary" || !object.entries)
      this.error("INVALID_SECURITY", "expected security dictionary; resolve references explicitly");
    const map = new Map<string, PdfObject>();
    for (const entry of object.entries) {
      this.budget.charge();
      this.budget.reserve(64);
      const key = this.name(entry.key);
      if (map.has(key)) this.error("INVALID_SECURITY", "duplicate security dictionary key");
      map.set(key, entry.value);
    }
    return map;
  }
  private integer(object: PdfObject | undefined): number {
    const raw = object?.raw ? this.copy(object.raw) : undefined;
    if (object?.kind !== "number" || !Number.isSafeInteger(object.value) || raw?.includes(46))
      this.error("INVALID_SECURITY", "expected security integer");
    return object.value as number;
  }
  private string(object: PdfObject | undefined, size: number): Uint8Array {
    if (object?.kind !== "string" || admittedByteLength(object.bytes) !== size)
      this.error("INVALID_SECURITY", `security string must contain ${size} bytes`);
    return this.copy(object.bytes!);
  }
  private equal(a: Uint8Array, b: Uint8Array): boolean {
    this.budget.charge(a.length);
    let diff = a.length ^ b.length;
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ (b[i] ?? 0);
    return diff === 0;
  }
  private async primitive(
    size: number,
    work: number,
    call: () => Uint8Array | Promise<Uint8Array>
  ): Promise<Uint8Array> {
    this.budget.charge(work);
    this.budget.reserve(size * 2);
    const result = await call();
    this.budget.check();
    if (admittedByteLength(result) !== size)
      this.error("INVALID_SECURITY", "crypto capability returned invalid output");
    return new Uint8Array(result);
  }
  private async digest(
    algorithm: "MD5" | "SHA-256" | "SHA-384" | "SHA-512",
    bytes: Uint8Array
  ): Promise<Uint8Array> {
    const size =
      algorithm === "MD5" ? 16 : algorithm === "SHA-256" ? 32 : algorithm === "SHA-384" ? 48 : 64;
    return this.primitive(size, bytes.length + 64, () =>
      this.options.crypto.digest(algorithm, bytes, this.options.signal)
    );
  }
  private async rc4(key: Uint8Array, bytes: Uint8Array, xor = 0): Promise<Uint8Array> {
    const k = this.copy(key);
    for (let i = 0; i < k.length; i++) k[i] = k[i]! ^ xor;
    return this.primitive(bytes.length, bytes.length + 256, () =>
      this.options.crypto.rc4(k, bytes, this.options.signal)
    );
  }
  private async aes(
    operation: "encrypt" | "decrypt",
    mode: "CBC" | "ECB",
    key: Uint8Array,
    iv: Uint8Array,
    bytes: Uint8Array
  ): Promise<Uint8Array> {
    return this.primitive(bytes.length, bytes.length + 256, () =>
      this.options.crypto.aes(operation, mode, key, iv, bytes, this.options.signal)
    );
  }
  private padded(bytes: Uint8Array): Uint8Array {
    return this.copy(this.concat(bytes.subarray(0, 32), padding).subarray(0, 32));
  }
  private permissionBytes(): Uint8Array {
    const p = this.permissions >>> 0;
    return this.copy(Uint8Array.of(p & 255, (p >>> 8) & 255, (p >>> 16) & 255, p >>> 24));
  }
  private async legacyKey(password: Uint8Array): Promise<Uint8Array> {
    let key = await this.digest(
      "MD5",
      this.concat(
        this.padded(password),
        this.owner,
        this.permissionBytes(),
        this.id,
        ...(!this.metadata ? [Uint8Array.of(255, 255, 255, 255)] : [])
      )
    );
    if (this.revision >= 3)
      for (let i = 0; i < 50; i++) key = await this.digest("MD5", key.subarray(0, this.keyBytes));
    return this.copy(key.subarray(0, this.keyBytes));
  }
  private async validLegacy(key: Uint8Array): Promise<boolean> {
    if (this.revision === 2) return this.equal(await this.rc4(key, padding), this.user);
    let u = await this.rc4(key, await this.digest("MD5", this.concat(padding, this.id)));
    for (let i = 1; i <= 19; i++) u = await this.rc4(key, u, i);
    return this.equal(u, this.user.subarray(0, 16));
  }
  private async modernHash(
    password: Uint8Array,
    salt: Uint8Array,
    user: Uint8Array
  ): Promise<Uint8Array> {
    let k = await this.digest("SHA-256", this.concat(password, salt, user));
    if (this.revision === 5) return k;
    let last = 0;
    for (let round = 0; round < 64 || last > round - 32; round++) {
      const unit = this.concat(password, k, user);
      this.budget.charge(unit.length * 64);
      this.budget.reserve(unit.length * 64);
      const repeated = new Uint8Array(unit.length * 64);
      for (let i = 0; i < 64; i++) repeated.set(unit, i * unit.length);
      const e = await this.aes("encrypt", "CBC", k.subarray(0, 16), k.subarray(16, 32), repeated);
      let remainder = 0;
      for (let i = 0; i < 16; i++) remainder = (remainder + e[i]!) % 3;
      last = e[e.length - 1]!;
      k = await this.digest((["SHA-256", "SHA-384", "SHA-512"] as const)[remainder]!, e);
    }
    return this.copy(k.subarray(0, 32));
  }
  async authenticate(password?: PdfPassword): Promise<PdfSecuritySession> {
    this.budget.check();
    const expected = this.revision <= 4 ? "legacy" : this.revision === 5 ? "utf8" : "saslprep-utf8";
    if (password && password.encoding !== expected)
      this.error("PASSWORD_ENCODING", `R${this.revision} requires ${expected} password bytes`);
    let bytes = password ? this.copy(password.bytes) : new Uint8Array();
    if (this.revision >= 5) {
      this.budget.charge(bytes.length);
      this.budget.reserve(bytes.length * 2);
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        this.error("PASSWORD_ENCODING", "invalid UTF-8 password bytes");
      }
      bytes = this.copy(bytes.subarray(0, 127));
    }
    let key: Uint8Array | undefined;
    let role: "user" | "owner" = "user";
    if (this.revision <= 4) {
      let ownerKey = await this.digest("MD5", this.padded(bytes));
      if (this.revision >= 3)
        for (let i = 0; i < 50; i++) ownerKey = await this.digest("MD5", ownerKey);
      ownerKey = ownerKey.subarray(0, this.keyBytes);
      let recovered = this.owner;
      if (this.revision === 2) recovered = await this.rc4(ownerKey, recovered);
      else for (let i = 19; i >= 0; i--) recovered = await this.rc4(ownerKey, recovered, i);
      const candidate = await this.legacyKey(recovered);
      if (await this.validLegacy(candidate)) {
        key = candidate;
        role = "owner";
      } else {
        const userKey = await this.legacyKey(bytes);
        if (await this.validLegacy(userKey)) key = userKey;
      }
    } else {
      for (const owner of [true, false]) {
        const entry = owner ? this.owner : this.user;
        const u = owner ? this.user : new Uint8Array();
        if (
          this.equal(await this.modernHash(bytes, entry.subarray(32, 40), u), entry.subarray(0, 32))
        ) {
          const kek = await this.modernHash(bytes, entry.subarray(40, 48), u);
          key = await this.aes(
            "decrypt",
            "CBC",
            kek,
            new Uint8Array(16),
            owner ? this.ownerKey : this.userKey
          );
          role = owner ? "owner" : "user";
          break;
        }
      }
      if (key) {
        const perms = await this.aes("decrypt", "ECB", key, new Uint8Array(), this.perms);
        if (
          !this.equal(perms.subarray(0, 4), this.permissionBytes()) ||
          !this.equal(perms.subarray(4, 8), Uint8Array.of(255, 255, 255, 255)) ||
          perms[8] !== (this.metadata ? 84 : 70) ||
          perms[9] !== 97 ||
          perms[10] !== 100 ||
          perms[11] !== 98
        )
          this.error("INVALID_SECURITY", "encrypted permissions disagree with security dictionary");
      }
    }
    if (!key)
      this.error(
        password ? "WRONG_PASSWORD" : "MISSING_PASSWORD",
        password ? "incorrect PDF password" : "PDF password required"
      );
    const fileKey = key;
    return Object.freeze({
      role,
      permissions: this.permissions,
      encryptMetadata: this.metadata,
      decrypt: (input: Uint8Array, o: PdfDecryptOptions) => this.decrypt(fileKey, input, o)
    });
  }
  private async decrypt(
    fileKey: Uint8Array,
    input: Uint8Array,
    o: PdfDecryptOptions
  ): Promise<Uint8Array> {
    this.budget.check();
    if (
      !Number.isSafeInteger(o.objectNumber) ||
      o.objectNumber < 0 ||
      o.objectNumber > 0xffffff ||
      !Number.isInteger(o.generation) ||
      o.generation < 0 ||
      o.generation > 65535
    )
      this.error("INVALID_SECURITY", "object key identifiers out of range");
    if (o.kind !== "string" && o.kind !== "stream" && o.kind !== "embedded-file")
      this.error("INVALID_SECURITY", "invalid encrypted object kind");
    const bytes = this.copy(input);
    const name =
      o.cryptFilter ??
      (o.kind === "string"
        ? this.stringFilter
        : o.kind === "embedded-file"
          ? this.fileFilter
          : this.streamFilter);
    const filter = this.filters.get(name);
    if (!filter) this.error("UNSUPPORTED", "unknown explicit crypt filter");
    if (filter.event === "EFOpen" && o.kind !== "embedded-file")
      this.error("INVALID_SECURITY", "EFOpen crypt filter used outside embedded file");
    if (filter.method === "Identity" || (!this.metadata && o.metadata && o.kind === "stream")) {
      this.budget.expand(bytes.length);
      return bytes;
    }
    if (filter.method !== "V2" && (bytes.length < 32 || (bytes.length - 16) % 16 !== 0))
      this.error("INVALID_CIPHERTEXT", "invalid AES IV/ciphertext length");
    // RC4 preserves length. AES removes an IV and at most one padding block;
    // admit its guaranteed plaintext before doing object-key or cipher work.
    const minimumPlaintext = filter.method === "V2" ? bytes.length : bytes.length - 32;
    this.budget.expand(minimumPlaintext);
    let key = fileKey;
    if (filter.method !== "AESV3") {
      const n = o.objectNumber;
      const g = o.generation;
      const suffix = Uint8Array.of(n & 255, (n >>> 8) & 255, n >>> 16, g & 255, g >>> 8);
      key = (
        await this.digest(
          "MD5",
          this.concat(
            fileKey,
            suffix,
            ...(filter.method === "AESV2" ? [Uint8Array.of(115, 65, 108, 84)] : [])
          )
        )
      ).subarray(0, Math.min(fileKey.length + 5, 16));
    }
    let result: Uint8Array;
    if (filter.method === "V2") result = await this.rc4(key, bytes);
    else {
      const plain = await this.aes(
        "decrypt",
        "CBC",
        key,
        bytes.subarray(0, 16),
        bytes.subarray(16)
      );
      const pad = plain[plain.length - 1]!;
      if (pad < 1 || pad > 16) this.error("INVALID_CIPHERTEXT", "invalid AES padding");
      let invalid = 0;
      for (let i = 1; i <= pad; i++) invalid |= plain[plain.length - i]! ^ pad;
      if (invalid) this.error("INVALID_CIPHERTEXT", "invalid AES padding");
      result = this.copy(plain.subarray(0, plain.length - pad));
    }
    this.budget.expand(result.length - minimumPlaintext);
    return result;
  }
}
/** Dictionary and original ID bytes must be supplied/resolved explicitly.
 * No document gate, permission enforcement, rewriting or redaction is implied. */
export function createPdfSecurity(
  dictionary: PdfObject,
  originalId: Uint8Array,
  options: PdfSecurityOptions
): { authenticate(password?: PdfPassword): Promise<PdfSecuritySession> } {
  const security = new StandardSecurity(dictionary, originalId, options);
  return Object.freeze({ authenticate: security.authenticate.bind(security) });
}
