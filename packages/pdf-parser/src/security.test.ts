import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parsePdfObjects } from "./syntax.js";
import { createPdfSecurity, PdfSecurityError } from "./security.js";
import type { PdfCrypto } from "./security.js";
import { createNodePdfCrypto } from "./node-crypto.js";
const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const text = (s: string) => new TextEncoder().encode(s);
const cat = (...a: Uint8Array[]) => Uint8Array.from(Buffer.concat(a));
// Test-only mock for the caller's legacy primitive. No production RC4 fallback.
function rc4(key: Uint8Array, bytes: Uint8Array) {
  const state = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i]! + key[i % key.length]!) % 256;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }
  let i = 0;
  j = 0;
  return Uint8Array.from(bytes, (b) => {
    i = (i + 1) % 256;
    j = (j + state[i]!) % 256;
    [state[i], state[j]] = [state[j]!, state[i]!];
    return b ^ state[(state[i]! + state[j]!) % 256]!;
  });
}
const crypto: PdfCrypto = createNodePdfCrypto();
const dictionary = (s: string) =>
  parsePdfObjects(text(`<< ${s} >>`), { duplicateKeys: "reject" })[0]!;
const padding = hex("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a");
const id = text("original-id-1234");
const password = { bytes: text("reader"), encoding: "legacy" as const };
// Independent fixture producer: emits original dictionaries, not PDFs from an oracle.
function legacy(
  revision: number,
  metadata = true,
  reader = text("reader"),
  writer = text("owner"),
  n = revision === 2 ? 5 : 16
) {
  const padded = (s: Uint8Array) => cat(s, padding).slice(0, 32);
  const md5 = (b: Uint8Array) => Uint8Array.from(createHash("md5").update(b).digest());
  let owner = md5(padded(writer));
  if (revision > 2) for (let i = 0; i < 50; i++) owner = md5(owner);
  owner = owner.slice(0, n);
  let o = rc4(owner, padded(reader));
  if (revision > 2)
    for (let i = 1; i <= 19; i++)
      o = rc4(
        owner.map((b) => b ^ i),
        o
      );
  const p = hex("fcffffff");
  let key = md5(
    cat(padded(reader), o, p, id, ...(!metadata && revision === 4 ? [hex("ffffffff")] : []))
  );
  if (revision > 2) for (let i = 0; i < 50; i++) key = md5(key.slice(0, n));
  key = key.slice(0, n);
  let u = revision === 2 ? rc4(key, padding) : rc4(key, md5(cat(padding, id)));
  if (revision > 2) {
    for (let i = 1; i <= 19; i++)
      u = rc4(
        key.map((b) => b ^ i),
        u
      );
    u = cat(u, new Uint8Array(16));
  }
  const encode = (b: Uint8Array) => Buffer.from(b).toString("hex");
  return {
    key,
    dict: dictionary(
      `/Filter /Standard /V ${revision === 2 ? 1 : revision === 3 ? 2 : 4} /R ${revision} /Length ${n * 8} /O <${encode(o)}> /U <${encode(u)}> /P -4 /EncryptMetadata ${metadata} ${revision === 4 ? "/CF << /StdCF << /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF" : ""}`
    )
  };
}
for (const revision of [2, 3, 4])
  test(`R${revision} user/owner authentication and object decryption`, async () => {
    const fixture = legacy(revision);
    const security = createPdfSecurity(fixture.dict, id, { crypto });
    const session = await security.authenticate(password);
    assert.equal(session.role, "user");
    const owner = await security.authenticate({ bytes: text("owner"), encoding: "legacy" });
    assert.equal(owner.role, "owner");
    const salt = revision === 4 ? text("sAlT") : new Uint8Array();
    const objectKey = Uint8Array.from(
      createHash("md5")
        .update(cat(fixture.key, hex("0700000200"), salt))
        .digest()
    ).slice(0, Math.min(16, fixture.key.length + 5));
    const plain = text("original binary\u0000data");
    let encrypted: Uint8Array;
    if (revision === 4) {
      const iv = new Uint8Array(16).fill(9);
      const pad = 16 - (plain.length % 16);
      encrypted = cat(
        iv,
        await crypto.aes("encrypt", "CBC", objectKey, iv, cat(plain, new Uint8Array(pad).fill(pad)))
      );
    } else encrypted = rc4(objectKey, plain);
    assert.deepEqual(
      await session.decrypt(encrypted, { objectNumber: 7, generation: 2, kind: "string" }),
      plain
    );
    await assert.rejects(
      security.authenticate({ bytes: text("wrong"), encoding: "legacy" }),
      (e: unknown) => e instanceof PdfSecurityError && e.code === "WRONG_PASSWORD"
    );
    await assert.rejects(
      security.authenticate(),
      (e: unknown) => e instanceof PdfSecurityError && e.code === "MISSING_PASSWORD"
    );
  });
test("R4 metadata flag and explicit Identity bypass preserve bytes", async () => {
  const fixture = legacy(4, false);
  const session = await createPdfSecurity(fixture.dict, id, { crypto }).authenticate(password);
  const raw = hex("ff0001");
  assert.deepEqual(
    await session.decrypt(raw, { objectNumber: 1, generation: 0, kind: "stream", metadata: true }),
    raw
  );
  assert.deepEqual(
    await session.decrypt(raw, {
      objectNumber: 1,
      generation: 0,
      kind: "stream",
      cryptFilter: "Identity"
    }),
    raw
  );
  assert.equal(session.permissions, -4);
  assert.equal(session.encryptMetadata, false);
});
test("handler and malformed controls fail before crypto", () => {
  assert.throws(
    () => createPdfSecurity(dictionary("/Filter /Adobe.PubSec"), id, { crypto }),
    (e: unknown) => e instanceof PdfSecurityError && e.code === "PUBLIC_KEY_UNSUPPORTED"
  );
  for (const fields of [
    "/Filter /Standard /V 3 /R 3",
    "/Filter /Standard /V 4 /R 4 /Length 0",
    "/Filter /Standard /V 5 /R 7"
  ])
    assert.throws(() => createPdfSecurity(dictionary(fields), id, { crypto }));
});
test("cancellation and budgets propagate without crypto fallback", async () => {
  const fixture = legacy(2);
  const controller = new AbortController();
  const reason = new Error("cancel encryption");
  controller.abort(reason);
  assert.throws(
    () => createPdfSecurity(fixture.dict, id, { crypto, signal: controller.signal }),
    (e) => e === reason
  );
  assert.throws(
    () => createPdfSecurity(fixture.dict, id, { crypto, limits: { work: 1 } }),
    /limit/
  );
  const failure = new Error("platform primitive unavailable");
  const security = createPdfSecurity(fixture.dict, id, {
    crypto: {
      ...crypto,
      digest: () => {
        throw failure;
      }
    }
  });
  await assert.rejects(security.authenticate(password), (e) => e === failure);
});
const modernVectors = [
  {
    r: 5,
    U: "ae5cce95f88d039162934a11edf76d3bcf10272f3920bcee7ae153c302afe10a01020304050607081112131415161718",
    O: "c08145503f980c64079c8ee8cf099a8c19c3f5c8fa1bedc83cb5d4b6a05539c821222324252627283132333435363738",
    UE: "5aeab2159ba8b20f9230577706bf622f4e6ae30f7dc0548fb5d66f9b1df6354e",
    OE: "47bd97bcd493e78c450aa417214f52ff41de03c5ad851e378e655a1b12d9d8cf"
  },
  {
    r: 6,
    U: "41b6380467fec1c8e204466c98beda899790be735eb42b42e48db6a19fee585101020304050607081112131415161718",
    O: "19fb68001d57cec0f88d9c3c40854848e0684ad02316fe8b255af28a77bf00a421222324252627283132333435363738",
    UE: "dcb3675d6251d3461b613c9c5a415b8bcbd85df5ee8076e651509e170bf7f167",
    OE: "42061d25e8596299140cb6ecd9aa37a2702671f7a2f997488ee3445766f0f4a1"
  }
];
const modernDictionary = (v: (typeof modernVectors)[number], extra = "") =>
  dictionary(
    `/Filter /Standard /V 5 /R ${v.r} /Length 256 /P -4 /EncryptMetadata false /O <${v.O}> /U <${v.U}> /OE <${v.OE}> /UE <${v.UE}> /Perms <a031b9f83100491e445d570b53a79b99> /CF << /StdCF << /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF ${extra}`
  );
for (const vector of modernVectors)
  test(`R${vector.r} frozen original vectors: UTF8 user, owner, AES256 and Perms`, async () => {
    const encoding = vector.r === 5 ? "utf8" : "saslprep-utf8";
    const security = createPdfSecurity(modernDictionary(vector), new Uint8Array(), { crypto });
    const session = await security.authenticate({ bytes: text("päss😀"), encoding });
    assert.equal(session.role, "user");
    assert.equal((await security.authenticate({ bytes: text("owner"), encoding })).role, "owner");
    const plain = hex("00ff01");
    const iv = new Uint8Array(16).fill(4);
    const key = Uint8Array.from({ length: 32 }, (_, i) => i);
    const encrypted = cat(
      iv,
      await crypto.aes("encrypt", "CBC", key, iv, cat(plain, new Uint8Array(13).fill(13)))
    );
    assert.deepEqual(
      await session.decrypt(encrypted, { objectNumber: 99, generation: 3, kind: "string" }),
      plain
    );
    await assert.rejects(
      createPdfSecurity(modernDictionary(vector), id, { crypto }).authenticate({
        bytes: text("wrong"),
        encoding
      }),
      (e: unknown) => e instanceof PdfSecurityError && e.code === "WRONG_PASSWORD"
    );
    await assert.rejects(
      createPdfSecurity(modernDictionary(vector), id, { crypto }).authenticate(),
      (e: unknown) => e instanceof PdfSecurityError && e.code === "MISSING_PASSWORD"
    );
    await assert.rejects(
      security.authenticate({ bytes: hex("ff"), encoding }),
      (e: unknown) => e instanceof PdfSecurityError && e.code === "PASSWORD_ENCODING"
    );
    await assert.rejects(
      security.authenticate({ bytes: text("owner"), encoding: "legacy" }),
      /requires/
    );
  });
test("AES256 permission controls bind P, metadata and reserved bytes", async () => {
  const vector = modernVectors[0]!;
  for (const [key, value] of [
    ["P", -8],
    ["EncryptMetadata", true]
  ] as const) {
    const d = modernDictionary(vector);
    d.entries!.find((e) => Buffer.from(e.key.bytes!).toString() === key)!.value.value = value;
    await assert.rejects(
      createPdfSecurity(d, id, { crypto }).authenticate({
        bytes: text("päss😀"),
        encoding: "utf8"
      }),
      /permissions disagree/
    );
  }
  for (const offset of [4, 9]) {
    const d = modernDictionary(vector);
    const plain = hex("fcffffffffffffff4661646201020304");
    plain[offset] = 0;
    d.entries!.find((e) => Buffer.from(e.key.bytes!).toString() === "Perms")!.value.bytes =
      await crypto.aes(
        "encrypt",
        "ECB",
        Uint8Array.from({ length: 32 }, (_, i) => i),
        new Uint8Array(),
        plain
      );
    await assert.rejects(
      createPdfSecurity(d, id, { crypto }).authenticate({ bytes: text("owner"), encoding: "utf8" }),
      /permissions disagree/
    );
  }
});
test("AES ciphertext rejects missing IV, truncated blocks and invalid padding", async () => {
  const session = await createPdfSecurity(modernDictionary(modernVectors[0]!), id, {
    crypto
  }).authenticate({ bytes: text("owner"), encoding: "utf8" });
  const o = { objectNumber: 1, generation: 0, kind: "stream" as const };
  for (const bad of [new Uint8Array(), new Uint8Array(16), new Uint8Array(31), new Uint8Array(33)])
    await assert.rejects(session.decrypt(bad, o), /ciphertext length/);
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);
  for (const plain of [
    new Uint8Array(16),
    new Uint8Array(16).fill(17),
    cat(new Uint8Array(15), Uint8Array.of(2))
  ]) {
    const iv = new Uint8Array(16);
    const encrypted = cat(iv, await crypto.aes("encrypt", "CBC", key, iv, plain));
    await assert.rejects(session.decrypt(encrypted, o), /padding/);
  }
  await assert.rejects(
    session.decrypt(new Uint8Array(32), { ...o, objectNumber: 0x1000000 }),
    /identifiers/
  );
  await assert.rejects(
    session.decrypt(new Uint8Array(32), { ...o, cryptFilter: "unknown" }),
    /unknown explicit/
  );
});
test("security snapshots dictionary, ID and caller ciphertext", async () => {
  const fixture = legacy(2);
  const suppliedId = new Uint8Array(id);
  const security = createPdfSecurity(fixture.dict, suppliedId, { crypto });
  suppliedId.fill(0);
  for (const e of fixture.dict.entries!) e.value.bytes?.fill(0);
  const session = await security.authenticate(password);
  const raw = hex("0001ff");
  const result = await session.decrypt(raw, {
    objectNumber: 1,
    generation: 0,
    kind: "stream",
    cryptFilter: "Identity"
  });
  raw.fill(9);
  assert.deepEqual(result, hex("0001ff"));
});
test("pending crypto cancellation and cumulative expansion limits are fatal", async () => {
  const fixture = legacy(2);
  const controller = new AbortController();
  const reason = { cancellation: true };
  const security = createPdfSecurity(fixture.dict, id, {
    crypto: {
      ...crypto,
      digest: async (...args) => {
        const result = await crypto.digest(...args);
        controller.abort(reason);
        return result;
      }
    },
    signal: controller.signal
  });
  await assert.rejects(security.authenticate(password), (e) => e === reason);
  const session = await createPdfSecurity(fixture.dict, id, {
    crypto,
    limits: { expandedBytes: 3 }
  }).authenticate(password);
  const o = { objectNumber: 1, generation: 0, kind: "stream" as const, cryptFilter: "Identity" };
  await session.decrypt(hex("0001"), o);
  await assert.rejects(session.decrypt(hex("0001"), o), /limit/);
  const invalid = createPdfSecurity(fixture.dict, id, {
    crypto: { ...crypto, digest: () => new Uint8Array(15) }
  });
  await assert.rejects(invalid.authenticate(password), /invalid output/);
});
test("duplicate keys, undefined filters, EFOpen misuse and reserved permission controls", () => {
  const source = legacy(4).dict;
  for (const extra of [
    "/StmF /Undefined",
    "/P -1",
    "/P 0",
    "/Length 0",
    "/EncryptMetadata 0",
    "/CF << /X << /CFM /AESV3 >> >>",
    "/CF << /X << /CFM /AESV2 /Length 128 >> >>",
    "/CF << /X << /CFM /V2 /AuthEvent /EFOpen >> >> /StrF /X"
  ]) {
    const d = dictionary(extra);
    const keys = d.entries!.map((e) => Buffer.from(e.key.bytes!).toString());
    d.entries!.unshift(
      ...source.entries!.filter((e) => !keys.includes(Buffer.from(e.key.bytes!).toString()))
    );
    assert.throws(() => createPdfSecurity(d, id, { crypto }));
  }
  const duplicate = { ...source, entries: [...source.entries!, source.entries![0]!] };
  assert.throws(() => createPdfSecurity(duplicate, id, { crypto }), /duplicate/);
});
test("UTF8 interpretation is admitted before allocating decoded password text", async () => {
  let calls = 0;
  const security = createPdfSecurity(modernDictionary(modernVectors[0]!), id, {
    crypto: {
      ...crypto,
      digest: (...args) => {
        calls++;
        return crypto.digest(...args);
      }
    },
    limits: { retainedBytes: 6500 }
  });
  await assert.rejects(
    security.authenticate({ bytes: text("x".repeat(2000)), encoding: "utf8" }),
    /limit/
  );
  assert.equal(calls, 0);
});
test("primitive capabilities are captured at security admission", async () => {
  const options = { crypto };
  const security = createPdfSecurity(legacy(2).dict, id, options);
  options.crypto = {
    ...crypto,
    digest: () => {
      throw new Error("replaced capability");
    }
  };
  assert.equal((await security.authenticate(password)).role, "user");
});
test("R5 truncates UTF8 password bytes at 127 without re-encoding", async () => {
  const seen: Uint8Array[] = [];
  const security = createPdfSecurity(modernDictionary(modernVectors[0]!), id, {
    crypto: {
      ...crypto,
      digest: (...args) => {
        seen.push(new Uint8Array(args[1]));
        return crypto.digest(...args);
      }
    }
  });
  const bytes = text("x".repeat(126) + "😀");
  await assert.rejects(security.authenticate({ bytes, encoding: "utf8" }), /incorrect/);
  assert.deepEqual(seen[0]!.subarray(0, 127), bytes.subarray(0, 127));
  assert.equal(seen[0]!.length, 127 + 8 + 48);
});
test("legacy password bytes, empty passwords, 32-byte truncation and variable keys", async () => {
  for (const n of [5, 7, 16]) {
    const reader = hex("00ff8081");
    const security = createPdfSecurity(legacy(3, true, reader, text("owner"), n).dict, id, {
      crypto
    });
    assert.equal((await security.authenticate({ bytes: reader, encoding: "legacy" })).role, "user");
  }
  const empty = createPdfSecurity(legacy(2, true, new Uint8Array()).dict, id, { crypto });
  assert.equal((await empty.authenticate()).role, "user");
  const prefix = new Uint8Array(32).fill(255);
  const security = createPdfSecurity(legacy(2, true, cat(prefix, text("ignored"))).dict, id, {
    crypto
  });
  assert.equal(
    (
      await security.authenticate({
        bytes: cat(prefix, text("different tail")),
        encoding: "legacy"
      })
    ).role,
    "user"
  );
});
test("R4 EFF can select RC4 while default streams and strings remain Identity", async () => {
  const fixture = legacy(4);
  const overrides = dictionary(
    "/CF << /File << /CFM /V2 /Length 16 /AuthEvent /EFOpen >> >> /StmF /Identity /StrF /Identity /EFF /File"
  );
  const keys = overrides.entries!.map((e) => Buffer.from(e.key.bytes!).toString());
  overrides.entries!.unshift(
    ...fixture.dict.entries!.filter((e) => !keys.includes(Buffer.from(e.key.bytes!).toString()))
  );
  const session = await createPdfSecurity(overrides, id, { crypto }).authenticate(password);
  const raw = hex("ff0001");
  assert.deepEqual(
    await session.decrypt(raw, { objectNumber: 8, generation: 0, kind: "string" }),
    raw
  );
  const key = Uint8Array.from(
    createHash("md5")
      .update(cat(fixture.key, hex("0800000000")))
      .digest()
  ).slice(0, 16);
  assert.deepEqual(
    await session.decrypt(rc4(key, raw), { objectNumber: 8, generation: 0, kind: "embedded-file" }),
    raw
  );
  await assert.rejects(
    session.decrypt(raw, { objectNumber: 8, generation: 0, kind: "stream", cryptFilter: "File" }),
    /EFOpen/
  );
});
test("primitive controls independently anchor mock RC4, MD5 and AES no-padding contracts", async () => {
  assert.deepEqual(rc4(text("Key"), text("Plaintext")), hex("bbf316e8d940af0ad3"));
  assert.deepEqual(
    await crypto.digest("MD5", text("abc")),
    hex("900150983cd24fb0d6963f7d28e17f72")
  );
  const key = hex("2b7e151628aed2a6abf7158809cf4f3c");
  const iv = hex("000102030405060708090a0b0c0d0e0f");
  const plain = hex("6bc1bee22e409f96e93d7e117393172a");
  assert.deepEqual(
    await crypto.aes("encrypt", "CBC", key, iv, plain),
    hex("7649abac8119b246cee98e9b12e9197d")
  );
});
test("security integer fields reject real tokens even when numerically integral", () => {
  for (const key of ["V", "R", "Length", "P"]) {
    const d = legacy(4).dict;
    const entry = d.entries!.find((e) => Buffer.from(e.key.bytes!).toString() === key)!;
    entry.value = parsePdfObjects(text(`${entry.value.value}.0`))[0]!;
    assert.throws(() => createPdfSecurity(d, id, { crypto }), /integer/);
  }
});
test("security byte admission preserves foreign-realm storage and intrinsic length quotas", async () => {
  const { runInNewContext } = await import("node:vm");
  const foreignId = runInNewContext(
    "Uint8Array.from([111,114,105,103,105,110,97,108,45,105,100,45,49,50,51,52])"
  ) as Uint8Array;
  const session = await createPdfSecurity(legacy(2).dict, foreignId, { crypto }).authenticate(
    password
  );
  const foreign = runInNewContext("Uint8Array.from([255,0,1])") as Uint8Array;
  assert.deepEqual(
    await session.decrypt(foreign, {
      objectNumber: 1,
      generation: 0,
      kind: "stream",
      cryptFilter: "Identity"
    }),
    hex("ff0001")
  );
  const security = createPdfSecurity(legacy(2).dict, id, { crypto, limits: { inputBytes: 32 } });
  const oversized = new Uint8Array(64);
  Object.defineProperty(oversized, "length", { value: 0 });
  await assert.rejects(security.authenticate({ bytes: oversized, encoding: "legacy" }), /limit/);
  for (const view of [
    new Uint16Array([1]),
    new Uint8ClampedArray([1]),
    new DataView(new ArrayBuffer(1))
  ]) {
    Object.defineProperty(view, Symbol.toStringTag, { value: "Uint8Array" });
    await assert.rejects(
      session.decrypt(view as unknown as Uint8Array, {
        objectNumber: 1,
        generation: 0,
        kind: "stream"
      }),
      /expected security bytes/
    );
  }
});
test("plaintext expansion admission precedes object-key and cipher work", async () => {
  for (const revision of [2, 4]) {
    let calls = 0;
    const counted: PdfCrypto = {
      digest: (...args) => {
        calls++;
        return crypto.digest(...args);
      },
      rc4: (...args) => {
        calls++;
        return crypto.rc4(...args);
      },
      aes: (...args) => {
        calls++;
        return crypto.aes(...args);
      }
    };
    const session = await createPdfSecurity(legacy(revision).dict, id, {
      crypto: counted,
      limits: { expandedBytes: 1 }
    }).authenticate(password);
    calls = 0;
    // Two RC4 bytes are exact; two AES blocks cannot decode to fewer than 16 bytes.
    await assert.rejects(
      session.decrypt(new Uint8Array(revision === 2 ? 2 : 48), {
        objectNumber: 1, generation: 0, kind: "stream"
      }),
      /expanded byte limit/
    );
    assert.equal(calls, 0);
  }
});
test("AES expansion charges exact plaintext across all padding lengths", async () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);
  const iv = new Uint8Array(16);
  for (let pad = 1; pad <= 16; pad++) {
    const plain = new Uint8Array(32 - pad).fill(7);
    const encrypted = cat(iv, await crypto.aes(
      "encrypt", "CBC", key, iv, cat(plain, new Uint8Array(pad).fill(pad))
    ));
    const session = await createPdfSecurity(modernDictionary(modernVectors[0]!), id, {
      crypto, limits: { expandedBytes: plain.length }
    }).authenticate({ bytes: text("owner"), encoding: "utf8" });
    const o = { objectNumber: 1, generation: 0, kind: "stream" as const };
    assert.deepEqual(await session.decrypt(encrypted, o), plain);
    await assert.rejects(session.decrypt(encrypted, o), /expanded byte limit/);
  }
});
