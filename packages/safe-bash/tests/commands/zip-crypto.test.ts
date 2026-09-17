import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { zipCrypto, decryptZipPayload, ZipHostFailure } from "../../src/commands/archive/zip/crypto.js";
import { collectBytes, CommandRegistry, toByteSource, createCommandArguments, type CommandContext } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { makeZipEntry, writeZipArchive, readZipArchive, decodeZipEntry, streamZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings, type ArchiveCommandsOptions } from "../../src/commands/archive/internal.js";
import { createUnzipCommand } from "../../src/commands/archive/unzip.js";
import nativeFixtures from "./fixtures/zip-crypto-infozip.json" with { type: "json" };
import { createZipCommand } from "../../src/commands/archive/zip.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

test("zip -P creates an encrypted archive instead of rejecting the password option", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("secret payload"));
  const diagnostics: Uint8Array[] = [];
  const result = await createZipCommand({ zipHost: { entropy: length => new Uint8Array(length).fill(42) } }).execute({
    command: "zip", args: ["-P", "test", "archive.zip", "file"], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(new Uint8Array()),
    stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(new Uint8Array(bytes)); } },
  });
  assert.equal(result.exitCode, 0, Buffer.concat(diagnostics).toString());
  assert.equal(new DataView((await fs.readFile("/archive.zip")).buffer).getUint16(6, true) & 1, 1);
});

// Independently generated with native Zip -0 -P; Python zipfile verified both
// member payloads and the decrypted 12-byte encryption headers.
const cases = [
  { password: "test", ciphertext: "fjJ/9M4s6Prvwq8v4hP2O+O08UmGLiA4j0752H0zUHIP22wOiG4yRXK3+Q==", plaintext: "oZkL4jDiZjj1aCCFAP+ADQpBWmlwQ3J5cHRvIGJpbmFyeSBmaXh0dXJlCg==" },
  { password: "tiger", ciphertext: "ARbIdiYAws2+muQUdIJzAa6RXZncW7Jx/LMW23YYIO9jW+7r53GqHrZQ0g==", plaintext: "3LQVQJSSPdwNFiCFAP+ADQpBWmlwQ3J5cHRvIGJpbmFyeSBmaXh0dXJlCg==" },
  { password: "é🐯", ciphertext: "CPz+VKZpRMy8BiMDL1fM+eYxIbvi7EctYqOABbW/2FOTry/HBkE/tfUkGA==", plaintext: "1c7dhMXU1fi83iCFAP+ADQpBWmlwQ3J5cHRvIGJpbmFyeSBmaXh0dXJlCg==" },
];

for (const chunkSize of [65535, 65536, 65537, 150012]) {
  test(`ZipCrypto matches native 150000-byte ciphertext across ${chunkSize}-byte chunks`, async () => {
    // Native STORE encryption, independently extracted and hashed with Python.
    const bytes = Buffer.concat([Buffer.from("mxQF01U5hdCPgGmF", "base64"), Uint8Array.from({ length: 150000 }, (_, index) => index % 256)]);
    const source = (async function* () {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
    })();
    const signal = new AbortController().signal;
    const digest = createHash("sha256");
    for await (const chunk of zipCrypto(source, new TextEncoder().encode("tiger"), false, signal)) digest.update(chunk);
    assert.equal(digest.digest("hex"), "9dd249b65bf7c2e1c859a22fd885dfa4a86b2b725bbfe1b36306f6d44a5dadb5");
  });
}

for (const entry of cases) {
  for (const decode of [false, true]) {
    for (const chunkSize of [1, 7, 65536]) {
      test(`ZipCrypto native vector ${entry.password}, decode=${decode}, chunks=${chunkSize}`, async () => {
        const source = Buffer.from(decode ? entry.ciphertext : entry.plaintext, "base64");
        const chunks = (async function* () {
          for (let offset = 0; offset < source.length; offset += chunkSize) yield source.subarray(offset, offset + chunkSize);
        })();
        const signal = new AbortController().signal;
        const output = await collectBytes(zipCrypto(chunks, new TextEncoder().encode(entry.password), decode, signal), { maxBytes: 1000, signal });
        assert.deepEqual(Buffer.from(output), Buffer.from(decode ? entry.plaintext : entry.ciphertext, "base64"));
      });
    }
  }
}

test("ZipCrypto interleaved streams have independent key state", async () => {
  const signal = new AbortController().signal;
  const streams = cases.map(entry => zipCrypto((async function* () {
    for (const byte of Buffer.from(entry.ciphertext, "base64")) yield Uint8Array.of(byte);
  })(), new TextEncoder().encode(entry.password), true, signal)[Symbol.asyncIterator]());
  const output: number[][] = cases.map(() => []);
  for (;;) {
    const steps = await Promise.all(streams.map(stream => stream.next()));
    if (steps.every(step => step.done)) break;
    steps.forEach((step, index) => { if (!step.done) output[index]!.push(...step.value); });
  }
  cases.forEach((entry, index) => assert.deepEqual(Buffer.from(output[index]!), Buffer.from(entry.plaintext, "base64")));
});

test("ZipCrypto output owns its bytes and is bounded to 64 KiB", async () => {
  const bytes = new Uint8Array(150000).fill(42);
  const original = new Uint8Array(bytes);
  const signal = new AbortController().signal;
  const stream = zipCrypto(toByteSource(bytes), Uint8Array.of(1, 2), false, signal)[Symbol.asyncIterator]();
  const first = await stream.next();
  assert.equal(first.done, false);
  assert.ok(first.value!.length <= 65536);
  const saved = new Uint8Array(first.value!);
  for (;;) { const next = await stream.next(); if (next.done) break; assert.ok(next.value.length <= 65536); }
  assert.deepEqual(first.value, saved);
  assert.deepEqual(bytes, original);
});

test("ZipCrypto cancellation after output retires the input without another pull", async () => {
  const controller = new AbortController();
  const reason = { stop: "cipher" };
  let pulls = 0, closed = false;
  const source = (async function* () {
    try { pulls++; yield new Uint8Array(70000); pulls++; yield Uint8Array.of(1); }
    finally { closed = true; }
  })();
  const stream = zipCrypto(source, Uint8Array.of(1), false, controller.signal)[Symbol.asyncIterator]();
  await stream.next();
  controller.abort(reason);
  await assert.rejects(stream.next(), error => error === reason);
  assert.equal(pulls, 1);
  assert.equal(closed, true);
});

test("ZipCrypto rejects a pre-aborted signal before touching input", async () => {
  const controller = new AbortController();
  controller.abort(false);
  let pulls = 0;
  const source = (async function* () { pulls++; yield Uint8Array.of(1); })();
  await assert.rejects(collectBytes(zipCrypto(source, new Uint8Array(), true, controller.signal), { maxBytes: 10, signal: controller.signal }), error => error === false);
  assert.equal(pulls, 0);
});

test("ZipCrypto consumer retirement closes input without pulling ahead", async () => {
  let pulls = 0, closed = false;
  const source = (async function* () {
    try { pulls++; yield Uint8Array.of(1, 2); pulls++; yield Uint8Array.of(3); }
    finally { closed = true; }
  })();
  const stream = zipCrypto(source, new Uint8Array(), false, new AbortController().signal);
  await stream.next();
  await stream.return(undefined);
  assert.equal(pulls, 1);
  assert.equal(closed, true);
});

test("ZipCrypto preserves source failures after a published chunk", async () => {
  const reason = { source: "failure" };
  let closed = false;
  const source = (async function* () {
    try { yield Uint8Array.of(1); throw reason; }
    finally { closed = true; }
  })();
  const signal = new AbortController().signal;
  await assert.rejects(collectBytes(zipCrypto(source, new Uint8Array(), true, signal), { maxBytes: 10, signal }), error => error === reason);
  assert.equal(closed, true);
});

const limits = settings({});
const attributes = { modified: new Date("2026-09-16T13:24:36Z"), mode: 0o100644, directory: false, symlink: false };
const entropy = (length: number) => new Uint8Array(length).fill(42);
const passwords = [new Uint8Array(), Buffer.from("é🐯"), Uint8Array.of(255, 128, 1)];

for (const password of passwords) for (const method of [0, 8, 12]) for (const live of [false, true]) for (const descriptors of [false, true]) {
  test(`encrypted ZIP roundtrip password=${password.toString()} method=${method} live=${live} descriptor=${descriptors}`, async () => {
    const signal = new AbortController().signal;
    const bytes = Buffer.from("Unicode 🐯\n".repeat(100));
    const entry = await makeZipEntry("secret", bytes, attributes, limits, signal, method === 0 ? 0 : 6, true, method === 12 ? "bzip2" : "deflate");
    if (live) { entry.data = new Uint8Array(); entry.source = toByteSource(bytes); entry.size = 0; entry.expectedSize = bytes.length; }
    entry.encryption = { password, entropy };
    const plain = await makeZipEntry("plain", new Uint8Array(), attributes, limits, signal, 0);
    const archive = await collectBytes(streamZipArchive({ entries: [entry, plain], comment: Buffer.from("archive comment") }, limits, signal, descriptors), { maxBytes: limits.maxArchiveBytes, signal });
    const read = await readZipArchive(archive, limits, signal);
    assert.equal(read.entries[0]!.flags! & 1, 1);
    assert.equal(Boolean(read.entries[0]!.flags! & 8), live || descriptors);
    assert.equal(read.entries[1]!.flags! & 1, 0);
    assert.equal(Buffer.from(read.comment).toString(), "archive comment");
    assert.deepEqual(Buffer.from(await collectBytes(decodeZipEntry(read.entries[0]!, limits, signal, password), { maxBytes: limits.maxEntryBytes, signal })), bytes);
    await assert.rejects(collectBytes(decodeZipEntry(read.entries[0]!, limits, signal, Buffer.from("wrong")), { maxBytes: limits.maxEntryBytes, signal }));
    const copied = await readZipArchive(await writeZipArchive(read, limits, signal, !descriptors), limits, signal);
    assert.deepEqual(copied.entries[0]!.data, read.entries[0]!.data);
    assert.equal(copied.entries[0]!.flags! & 8, read.entries[0]!.flags! & 8);
    assert.deepEqual(Buffer.from(await collectBytes(decodeZipEntry(copied.entries[0]!, limits, signal, password), { maxBytes: limits.maxEntryBytes, signal })), bytes);
  });
}

async function command(command: "zip" | "unzip", args: readonly string[], options: ArchiveCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const fs = overrides.fs ?? createMemoryFileSystem();
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command, args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: toByteSource(new Uint8Array()), stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } }, ...overrides };
  const registry = new CommandRegistry([createUnzipCommand(options)]);
  const registered: CommandContext = { ...context, invoke: context.invoke ?? (async (name, args, invocation = {}) => {
    const definition = registry.get(name);
    if (!definition) return { exitCode: 127 };
    const { argumentValues: ignoredValues, ...base } = context;
    return definition.execute({ ...base, ...invocation, signal: invocation.signal ?? context.signal, command: name, args });
  }) };
  const result = await (command === "zip" ? createZipCommand(options) : createUnzipCommand(options)).execute(registered);
  return { ...result, fs, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

test("password commands preserve raw argv bytes and verify -T and -p", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("payload"));
  const password = shellValueFromBytes(Uint8Array.of(255, 128, 42));
  const values = createCommandArguments(["-P", password, "-T", "archive.zip", "file"]);
  const zipped = await command("zip", values.args, { zipHost: { entropy } }, { fs, argumentValues: values });
  assert.equal(zipped.exitCode, 0, zipped.stdout.toString() + zipped.stderr.toString());
  const args = createCommandArguments(["-pP", password, "archive.zip"]);
  const unzipped = await command("unzip", args.args, {}, { fs, argumentValues: args });
  assert.equal(unzipped.exitCode, 0, unzipped.stderr.toString());
  assert.equal(unzipped.stdout.toString(), "payload");
});

test("zip -e confirms a no-echo host password without consuming member stdin", async () => {
  let calls = 0;
  const zipped = await command("zip", ["-e", "-q", "-", "-"], { zipHost: { entropy, password: async request => { assert.ok(request.signal); calls++; return Buffer.from("secret"); } } }, { stdin: toByteSource(Buffer.from("input payload")) });
  assert.equal(zipped.exitCode, 0, zipped.stderr.toString());
  assert.equal(calls, 2);
  const read = await readZipArchive(zipped.stdout, limits, new AbortController().signal);
  assert.equal(Buffer.from(await collectBytes(decodeZipEntry(read.entries[0]!, limits, new AbortController().signal, Buffer.from("secret")), { maxBytes: 100 })).toString(), "input payload");
});

test("absent capabilities, EOF, mismatched and empty interactive passwords fail without publication or secret diagnostics", async () => {
  let prompt = 0;
  for (const options of [{}, { zipHost: { entropy } }, { zipHost: { entropy, password: async () => undefined } }, { zipHost: { entropy, password: async () => new Uint8Array() } }, { zipHost: { entropy, password: async () => Buffer.from(String(prompt++)) } }]) {
    const result = await command("zip", ["-e", "archive.zip", "file"], options);
    assert.notEqual(result.exitCode, 0);
    assert.equal((await result.fs.readdir("/")).length, 0);
    assert.doesNotMatch(result.stdout.toString() + result.stderr.toString(), /secret/u);
  }
});

test("matching verifier bytes are not authentication; wrong password cannot publish -p or a file", async () => {
  const signal = new AbortController().signal;
  const password = Buffer.from("secret");
  const entry = await makeZipEntry("file", Buffer.from("payload"), attributes, limits, signal, 0);
  entry.encryption = { password, entropy };
  const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal);
  const read = await readZipArchive(bytes, limits, signal);
  const encrypted = read.entries[0]!;
  let collision: string | undefined;
  for (let index = 0; index < 4096; index++) {
    const candidate = `wrong${index}`;
    const header = await collectBytes(zipCrypto(toByteSource(encrypted.data.subarray(0, 12)), Buffer.from(candidate), true, signal), { maxBytes: 12, signal });
    if (header[11] === encrypted.crc32 >>> 24) { collision = candidate; break; }
  }
  assert.ok(collision, "fixed fixture must have a wrong-password verifier collision");
  for (const flags of [["-p"], ["-o"]]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/archive.zip", bytes);
    await fs.writeFile("/file", Buffer.from("preserved"));
    const result = await command("unzip", [...flags, "-P", collision, "archive.zip"], {}, { fs });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr.toString(), /CRC32 mismatch/u);
    if (flags.includes("-p")) assert.equal(result.stdout.length, 0);
    else assert.doesNotMatch(result.stdout.toString(), /payload|extracting/u);
    assert.equal(Buffer.from(await fs.readFile("/file")).toString(), "preserved");
    assert.doesNotMatch(result.stderr.toString(), /wrong[0-9]/u);
  }
});

test("encrypted empty members, per-member passwords, comments and final size/CRC controls", async () => {
  const signal = new AbortController().signal;
  const entries = await Promise.all(["empty", "second"].map(name => makeZipEntry(name, new Uint8Array(), attributes, limits, signal, 0)));
  entries.forEach((entry, index) => { entry.encryption = { password: Buffer.from(`password${index}`), entropy }; entry.comment = Buffer.from(`comment${index}`); });
  const bytes = await writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal);
  const read = await readZipArchive(bytes, limits, signal);
  for (const [index, entry] of read.entries.entries()) {
    const password = Buffer.from(`password${index}`);
    assert.equal(entry.data.length, 12);
    assert.equal(Buffer.from(entry.comment!).toString(), `comment${index}`);
    assert.equal((await collectBytes(decodeZipEntry(entry, limits, signal, password), { maxBytes: 20, signal })).length, 0);
    await assert.rejects(collectBytes(decodeZipEntry({ ...entry, size: 1 }, limits, signal, password), { maxBytes: 20, signal }), /size mismatch/u);
    await assert.rejects(collectBytes(decodeZipEntry({ ...entry, crc32: 1 }, limits, signal, password), { maxBytes: 20, signal }), /CRC32 mismatch/u);
    for (const length of [0, 1, 11]) await assert.rejects(collectBytes(decodeZipEntry({ ...entry, data: entry.data.subarray(0, length) }, limits, signal, password), { maxBytes: 20, signal }), /truncated encryption header/u);
  }
  await assert.rejects(collectBytes(decryptZipPayload(toByteSource(new Uint8Array(11)), new Uint8Array(), 0, signal), { maxBytes: 20, signal }), /truncated encryption header/u);
});

test("encrypted archive and decoded-byte budgets admit exact boundaries and reject one-byte-short limits", async () => {
  const signal = new AbortController().signal;
  const entry = await makeZipEntry("file", Buffer.from("payload"), attributes, limits, signal, 0);
  entry.encryption = { password: Buffer.from("secret"), entropy };
  const archive = { entries: [entry], comment: new Uint8Array() };
  const bytes = await writeZipArchive(archive, limits, signal);
  assert.equal((await writeZipArchive(archive, { ...limits, maxArchiveBytes: bytes.length }, signal)).length, bytes.length);
  await assert.rejects(writeZipArchive(archive, { ...limits, maxArchiveBytes: bytes.length - 1 }, signal), /limit/u);
  const read = await readZipArchive(bytes, limits, signal);
  const decoded = decodeZipEntry(read.entries[0]!, { ...limits, maxEntryBytes: 6 }, signal, Buffer.from("secret"));
  await assert.rejects(collectBytes(decoded, { maxBytes: 100, signal }), /limit/u);
});

test("entropy cancellation retires command ownership without consuming input or publishing an archive", async () => {
  const controller = new AbortController();
  const reason = { cancel: "entropy" };
  let acquired!: () => void;
  const started = new Promise<void>(resolve => { acquired = resolve; });
  let closed = false, pulls = 0;
  const source = (async function* () { try { pulls++; yield Buffer.from("payload"); } finally { closed = true; } })();
  let cleanup: (() => void | Promise<void>) | undefined;
  const pending = command("zip", ["-qP", "secret", "-", "-"], { zipHost: { entropy: async (_length, signal) => { acquired(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); throw reason; } } }, { signal: controller.signal, stdin: source, registerCleanup: close => { cleanup = close; } });
  await started;
  assert.ok(cleanup);
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  await cleanup!();
  assert.equal(pulls, 0);
  // An unstarted generator has no acquired input resource/finally to retire.
  assert.equal(closed, false);
});

test("entropy and prompt exceptions never reach diagnostics or internal-error callbacks", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("payload"));
  let errors = 0;
  for (const zipHost of [{ entropy: () => { throw new Error("secret password value"); } }, { entropy, password: async () => { throw new Error("secret password value"); } }, { entropy: () => new Uint8Array(10) }]) {
    const result = await command("zip", [zipHost.password ? "-e" : "-Psecret", "archive.zip", "file"], { zipHost }, { fs, onInternalError: () => { errors++; } });
    assert.notEqual(result.exitCode, 0);
    assert.doesNotMatch(result.stdout.toString() + result.stderr.toString(), /secret password value/u);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["file"]);
  }
  assert.equal(errors, 0);
});

test("Info-ZIP encrypted STORE profile admits version 10 with a descriptor", async () => {
  const signal = new AbortController().signal;
  const entry = await makeZipEntry("file", Buffer.from("native payload"), attributes, limits, signal, 0);
  entry.encryption = { password: Buffer.from("test"), entropy };
  const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal, true);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const central = view.getUint32(bytes.length - 6, true);
  view.setUint16(4, 10, true);
  view.setUint16(central + 6, 10, true);
  const read = await readZipArchive(bytes, limits, signal);
  assert.equal(Buffer.from(await collectBytes(decodeZipEntry(read.entries[0]!, limits, signal, Buffer.from("test")), { maxBytes: 100, signal })).toString(), "native payload");
});

test("native zip -P rejects an empty supplied password before publication", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("payload"));
  const result = await command("zip", ["-P", "", "archive.zip", "file"], { zipHost: { entropy } }, { fs });
  assert.equal(result.exitCode, 16);
  assert.match(result.stdout.toString(), /Invalid command arguments/u);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["file"]);
});

test("recursive suggestions and debug progress redact supplied passwords", async () => {
  for (const args of [["-P", "private-value", "-r", "archive.zip", "missing"], ["--password=private-value", "-r", "archive.zip", "missing"], ["-sdPprivate-value", "-r", "archive.zip", "missing"]]) {
    const result = await command("zip", args, { zipHost: { entropy } });
    assert.equal(result.exitCode, 12);
    assert.doesNotMatch(result.stdout.toString() + result.stderr.toString(), /private-value/u);
  }
});

for (const fixture of nativeFixtures.entries) {
  test(`native encrypted fixture method=${fixture.method} passwordBytes=${fixture.password}`, async () => {
    const signal = new AbortController().signal;
    const bytes = Buffer.from(fixture.archive, "base64");
    const password = Buffer.from(fixture.password, "base64");
    const read = await readZipArchive(bytes, limits, signal);
    const entry = read.entries[0]!;
    assert.equal(entry.flags! & 9, 9);
    assert.equal(entry.method, fixture.method);
    assert.equal(Buffer.from(await collectBytes(decodeZipEntry(entry, limits, signal, password), { maxBytes: 1000, signal })).toString(), nativeFixtures.payload);
    await assert.rejects(collectBytes(decodeZipEntry(entry, limits, signal, Buffer.from("wrong")), { maxBytes: 1000, signal }));
    await assert.rejects(readZipArchive(bytes, { ...limits, maxArchiveBytes: bytes.length - 1 }, signal), /limit/u);
    const controller = new AbortController();
    controller.abort(false);
    await assert.rejects(collectBytes(decodeZipEntry(entry, limits, controller.signal, password), { maxBytes: 1000, signal: controller.signal }), error => error === false);
  });
}

test("unzip retries a no-echo password at most three times and reuses only a verified password", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/archive.zip", Buffer.from(nativeFixtures.entries[0]!.archive, "base64"));
  let calls = 0;
  const success = await command("unzip", ["-p", "archive.zip"], { zipHost: { password: async () => Buffer.from(++calls < 3 ? "wrong" : "test") } }, { fs });
  assert.equal(success.exitCode, 0, success.stderr.toString());
  assert.equal(calls, 3);
  assert.equal(success.stdout.toString(), nativeFixtures.payload);
  calls = 0;
  const failed = await command("unzip", ["-p", "archive.zip"], { zipHost: { password: async () => { calls++; return Buffer.from("wrong"); } } }, { fs });
  assert.notEqual(failed.exitCode, 0);
  assert.equal(calls, 3);
  assert.equal(failed.stdout.length, 0);
});

test("command copy, comments, mixed-member update and -T preserve encrypted neighbors", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("first"));
  assert.equal((await command("zip", ["-Ptest", "-T", "-cz", "archive.zip", "file"], { zipHost: { entropy } }, { fs, stdin: toByteSource(Buffer.from("entry comment\narchive comment\n.\n")) })).exitCode, 0);
  const original = await readZipArchive(await fs.readFile("/archive.zip"), limits, new AbortController().signal);
  await fs.writeFile("/plain", Buffer.from("second"));
  assert.equal((await command("zip", ["archive.zip", "plain"], {}, { fs })).exitCode, 0);
  const updated = await readZipArchive(await fs.readFile("/archive.zip"), limits, new AbortController().signal);
  assert.deepEqual(updated.entries[0]!.data, original.entries[0]!.data);
  assert.equal(updated.entries[1]!.flags! & 1, 0);
  assert.equal((await command("zip", ["-U", "-Ptest", "-T", "archive.zip", "-O", "copy.zip"], { zipHost: { entropy } }, { fs })).exitCode, 0);
  const copied = await readZipArchive(await fs.readFile("/copy.zip"), limits, new AbortController().signal);
  assert.deepEqual(copied.entries[0]!.data, original.entries[0]!.data);
  assert.deepEqual(copied.comment, original.comment);
  assert.deepEqual(copied.entries[0]!.comment, original.entries[0]!.comment);
  const pipe = await command("unzip", ["-pPtest", "copy.zip"], {}, { fs });
  assert.equal(pipe.exitCode, 0, pipe.stderr.toString());
  assert.equal(pipe.stdout.toString(), "firstsecond");
  const failedTest = await command("zip", ["-Pwrong", "-T", "archive.zip"], { zipHost: { entropy } }, { fs });
  assert.equal(failedTest.exitCode, 8);
  assert.deepEqual(await fs.readFile("/archive.zip"), await fs.readFile("/copy.zip"));
});

test("password prompt cancellation preserves the root reason and retires registered ownership", async () => {
  const controller = new AbortController();
  const reason = { cancel: "prompt" };
  let started!: () => void;
  const acquired = new Promise<void>(resolve => { started = resolve; });
  let cleanup: (() => void | Promise<void>) | undefined;
  const result = command("zip", ["-e", "archive.zip", "file"], { zipHost: { entropy, password: async ({ signal }) => { started(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); signal.throwIfAborted(); return undefined; } } }, { signal: controller.signal, registerCleanup: close => { cleanup = close; } });
  await acquired;
  assert.ok(cleanup);
  controller.abort(reason);
  await assert.rejects(result, error => error === reason);
  await cleanup!();
});

test("native wrong-password statuses skip encrypted members and preserve plain neighbors", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/archive.zip", Buffer.from(nativeFixtures.entries[0]!.archive, "base64"));
  const wrong = await command("unzip", ["-pPwrong", "archive.zip"], {}, { fs });
  assert.equal(wrong.exitCode, 82);
  assert.equal(wrong.stdout.length, 0);
  const read = await readZipArchive(await fs.readFile("/archive.zip"), limits, new AbortController().signal);
  const plain = await makeZipEntry("plain", Buffer.from("neighbor"), attributes, limits, new AbortController().signal, 0);
  await fs.writeFile("/mixed.zip", await writeZipArchive({ ...read, entries: [...read.entries, plain] }, limits, new AbortController().signal));
  const mixed = await command("unzip", ["-pPwrong", "mixed.zip"], {}, { fs });
  assert.equal(mixed.exitCode, 1);
  assert.equal(mixed.stdout.toString(), "neighbor");
});

test("absent no-echo capability reports a precise fixed diagnostic without exposing any password", async () => {
  const result = await command("zip", ["-e", "archive.zip", "file"], { zipHost: { entropy } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr.toString(), "zip: ZIP no-echo password capability is unavailable\n");
});

test("password-only -T and ciphertext copy do not require entropy", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/archive.zip", Buffer.from(nativeFixtures.entries[0]!.archive, "base64"));
  const checked = await command("zip", ["-Ptest", "-T", "archive.zip"], {}, { fs });
  assert.equal(checked.exitCode, 0, checked.stdout.toString() + checked.stderr.toString());
  const copied = await command("zip", ["-Ptest", "-T", "-U", "archive.zip", "-O", "copy.zip"], {}, { fs });
  assert.equal(copied.exitCode, 0, copied.stdout.toString() + copied.stderr.toString());
  const signal = new AbortController().signal;
  const original = await readZipArchive(await fs.readFile("/archive.zip"), limits, signal);
  const copy = await readZipArchive(await fs.readFile("/copy.zip"), limits, signal);
  assert.deepEqual(copy.entries[0]!.data, original.entries[0]!.data);
  assert.equal(copy.entries[0]!.flags, original.entries[0]!.flags);
  assert.equal(copy.entries[0]!.dosTime, original.entries[0]!.dosTime);
});

test("no-echo password admission accepts the exact byte budget and rejects NUL or one extra byte", async () => {
  for (const [password, accepted] of [[new Uint8Array(32).fill(42), true], [new Uint8Array(33).fill(42), false], [Uint8Array.of(42, 0), false]] as const) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", Buffer.from("payload"));
    const result = await command("zip", ["-e", "archive.zip", "file"], { limits: { maxArgumentBytes: 32 }, zipHost: { entropy, password: async ({ maxBytes }) => { assert.equal(maxBytes, 32); return password; } } }, { fs });
    assert.equal(result.exitCode === 0, accepted, result.stderr.toString());
    assert.equal((await fs.readdir("/")).some(entry => entry.name === "archive.zip"), accepted);
  }
});

test("distinct raw password bytes with identical display text never merge", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("payload"));
  const rawPasswords = [Uint8Array.of(255), Uint8Array.of(254)];
  for (const [index, bytes] of rawPasswords.entries()) {
    const argumentsValue = createCommandArguments(["-P", shellValueFromBytes(bytes), `archive${index}.zip`, "file"]);
    const zipped = await command("zip", argumentsValue.args, { zipHost: { entropy } }, { fs, argumentValues: argumentsValue });
    assert.equal(zipped.exitCode, 0, zipped.stderr.toString());
    const signal = new AbortController().signal;
    const read = await readZipArchive(await fs.readFile(`/archive${index}.zip`), limits, signal);
    assert.equal(Buffer.from(await collectBytes(decodeZipEntry(read.entries[0]!, limits, signal, bytes), { maxBytes: 20, signal })).toString(), "payload");
    await assert.rejects(collectBytes(decodeZipEntry(read.entries[0]!, limits, signal, rawPasswords[1 - index]!), { maxBytes: 20, signal }));
  }
});

test("native -e rejects empty input before confirmation and returns 16 for confirmation mismatch", async () => {
  let calls = 0;
  const empty = await command("zip", ["-e", "archive.zip", "file"], { zipHost: { entropy, password: async () => { calls++; return new Uint8Array(); } } });
  assert.equal(empty.exitCode, 16);
  assert.equal(calls, 1);
  calls = 0;
  const mismatch = await command("zip", ["-e", "archive.zip", "file"], { zipHost: { entropy, password: async () => Buffer.from(calls++ === 0 ? "fixture-value" : "different-value") } });
  assert.equal(mismatch.exitCode, 16);
  assert.equal(calls, 2);
  assert.doesNotMatch(mismatch.stdout.toString() + mismatch.stderr.toString(), /fixture-value|different-value/u);
});

test("entropy callback cannot leak contextualized typed error messages", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("payload"));
  const failure = new ZipHostFailure("entropy");
  failure.message = "private-value";
  const result = await command("zip", ["-Ptest", "archive.zip", "file"], { zipHost: { entropy: () => { throw failure; } } }, { fs });
  assert.notEqual(result.exitCode, 0);
  assert.doesNotMatch(result.stderr.toString() + result.stdout.toString(), /private-value/u);
});

test("interactive extraction replaces a cached password for a different member and preserves plain neighbors", async () => {
  const fs = createMemoryFileSystem();
  const signal = new AbortController().signal;
  const entries = await Promise.all(["first", "plain", "last"].map(name => makeZipEntry(name, Buffer.from(name), attributes, limits, signal, 0)));
  entries[0]!.encryption = { password: Buffer.from("first-key"), entropy };
  entries[2]!.encryption = { password: Buffer.from("last-key"), entropy };
  await fs.writeFile("/archive.zip", await writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal));
  let calls = 0;
  const result = await command("unzip", ["-p", "archive.zip"], { zipHost: { password: async () => Buffer.from(calls++ === 0 ? "first-key" : "last-key") } }, { fs });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(calls, 2);
  assert.equal(result.stdout.toString(), "firstplainlast");
  assert.doesNotMatch(result.stderr.toString(), /first-key|last-key/u);
});

test("listing and selecting only a plain member never acquire password or entropy capabilities", async () => {
  const fs = createMemoryFileSystem();
  const signal = new AbortController().signal;
  const encrypted = await makeZipEntry("encrypted", Buffer.from("secret payload"), attributes, limits, signal, 0);
  encrypted.encryption = { password: Buffer.from("private-key"), entropy };
  const plain = await makeZipEntry("plain", Buffer.from("neighbor"), attributes, limits, signal, 0);
  await fs.writeFile("/archive.zip", await writeZipArchive({ entries: [encrypted, plain], comment: new Uint8Array() }, limits, signal));
  const zipHost = { password: async (): Promise<Uint8Array> => { assert.fail("unexpected password prompt"); }, entropy: (): Uint8Array => { assert.fail("unexpected entropy request"); } };
  const listed = await command("unzip", ["-l", "archive.zip"], { zipHost }, { fs });
  assert.equal(listed.exitCode, 0, listed.stderr.toString());
  assert.match(listed.stdout.toString(), /encrypted/u);
  assert.doesNotMatch(listed.stdout.toString(), /secret payload|private-key/u);
  const selected = await command("unzip", ["-p", "archive.zip", "plain"], { zipHost }, { fs });
  assert.equal(selected.exitCode, 0, selected.stderr.toString());
  assert.equal(selected.stdout.toString(), "neighbor");
});
