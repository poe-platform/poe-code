import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { collectBytes } from "../../src/contracts/index.js";
import type { FileStat } from "../../src/contracts/index.js";
import { readZipArchive, decodeZipEntry } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";
import { createZipCommand } from "../../src/commands/archive/zip.js";
import { standardCommands } from "../../src/commands/index.js";

import { flatStore } from "./zip-flat-store.helpers.js";
import { ShellLimitError } from "../../src/shell/index.js";

const destination = "/work/colored_animals.zip";

async function existingArchive() {
  const host = flatStore();
  host.write("/work/colored/cat.png", Uint8Array.of(0, 255, 42));
  const shell = new Shell({ fs: host.fs }).register(createZipCommand());
  assert.equal((await shell.exec(`zip -j ${destination} /work/colored/cat.png`)).exitCode, 0);
  return { host, shell, before: await host.fs.readFile(destination) };
}

test("#731 unchanged PNG command creates and updates without POSIX identities or staging", async () => {
  const { fs } = flatStore();
  const first = Uint8Array.of(137, 80, 78, 71, 0, 255, 128);
  const absent = Uint8Array.of(0, 254, 10);
  await fs.writeFile("/work/colored/cat.png", first);
  await fs.writeFile("/work/colored/dog.png", absent);
  const shell = new Shell({ fs }).use(standardCommands());
  shell.register(createZipCommand());
  const command = "cd /work/colored && zip -j /work/colored_animals.zip *.png && ls -la /work/colored_animals.zip";
  try {
    const created = await shell.exec(command);
    assert.equal(created.exitCode, 0, created.stderr + created.stdout);
    await fs.rm("/work/colored/dog.png");
    const replaced = Uint8Array.of(255, 0, 42, 13, 10);
    await fs.writeFile("/work/colored/cat.png", replaced);
    await fs.writeFile("/work/colored/fox.png", first);
    const updated = await shell.exec(command);
    assert.equal(updated.exitCode, 0, updated.stderr + updated.stdout);
    const signal = new AbortController().signal;
    const limits = settings({});
    const archive = await readZipArchive(await fs.readFile("/work/colored_animals.zip"), limits, signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), ["cat.png", "dog.png", "fox.png"]);
    for (const [index, expected] of [replaced, absent, first].entries()) {
      assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[index]!, limits, signal), { maxBytes: 100 }), expected);
    }
  } finally { await shell.dispose(); }
});

test("opaque host identities exclude source aliases without fabricated link counts", async () => {
  const { host, shell } = await existingArchive();
  host.alias("/work/colored/archive.png", destination);
  try {
    const result = await shell.exec(`cd /work/colored && zip -j ${destination} *.png`);
    assert.equal(result.exitCode, 0, result.stderr);
    const archive = await readZipArchive(await host.fs.readFile(destination), settings({}), new AbortController().signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), ["cat.png"]);
  } finally { await shell.dispose(); }
});

test("competing updates of one observed version admit exactly one publication", async () => {
  const { host, shell } = await existingArchive();
  const sibling = new Shell({ fs: host.fs }).register(createZipCommand());
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  host.beforeCommit = async () => { if (++arrived === 2) release(); await barrier; };
  try {
    const results = await Promise.all([shell.exec(`zip -j ${destination} /work/colored/cat.png`), sibling.exec(`zip -j ${destination} /work/colored/cat.png`)]);
    assert.deepEqual(results.map(result => result.exitCode).sort(), [0, 2]);
    assert.equal(arrived, 2);
    const archive = await readZipArchive(await host.fs.readFile(destination), settings({}), new AbortController().signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), ["cat.png"]);
  } finally { release(); await shell.dispose(); await sibling.dispose(); }
});

test("delete/recreate invalidates an observed opaque version despite identical bytes", async () => {
  const { host, shell, before } = await existingArchive();
  host.beforeCommit = async () => { await host.fs.rm(destination); host.write(destination, before); };
  try {
    const result = await shell.exec(`zip -j ${destination} /work/colored/cat.png`);
    assert.equal(result.exitCode, 2);
    assert.deepEqual(await host.fs.readFile(destination), before);
  } finally { await shell.dispose(); }
});

test("upload failure leaves the old archive intact", async () => {
  const { host, shell, before } = await existingArchive();
  host.beforeCommit = () => { throw new Error("upload failed"); };
  try {
    const result = await shell.exec(`zip -j ${destination} /work/colored/cat.png`);
    assert.equal(result.exitCode, 2);
    assert.deepEqual(await host.fs.readFile(destination), before);
  } finally { await shell.dispose(); }
});

test("cancellation after private upload preserves the destination", async () => {
  const { host, shell, before } = await existingArchive();
  const controller = new AbortController();
  host.beforeCommit = () => { controller.abort(new Error("cancel upload")); };
  try {
    await assert.rejects(shell.exec(`zip -j ${destination} /work/colored/cat.png`, { signal: controller.signal }));
    assert.deepEqual(await host.fs.readFile(destination), before);
  } finally { await shell.dispose(); }
});

test("source generation changes are detected even when identity, size and times agree", async () => {
  const { host, shell, before } = await existingArchive();
  const stream = host.fs.readStream!;
  host.fs.readStream = async function* (path, options) {
    yield* stream(path, options);
    if (path.endsWith("cat.png")) {
      const row = host.rows.get(path)!;
      host.rows.set(path, { ...row, version: "recreated" });
    }
  };
  try {
    const result = await shell.exec(`zip -j ${destination} /work/colored/cat.png`);
    assert.equal(result.exitCode, 2);
    assert.match(result.stdout + result.stderr, /source changed/);
    assert.deepEqual(await host.fs.readFile(destination), before);
  } finally { await shell.dispose(); }
});

test("a failing streaming producer is retired without creating an archive", async () => {
  const host = flatStore();
  host.write("/work/colored/cat.png", Uint8Array.of(0, 255, 42));
  let retired = 0;
  host.fs.readStream = async function* () {
    try { yield Uint8Array.of(0); throw new Error("producer failed"); }
    finally { retired++; }
  };
  const shell = new Shell({ fs: host.fs }).register(createZipCommand());
  try {
    const result = await shell.exec(`zip -0 -j ${destination} /work/colored/cat.png`);
    assert.equal(result.exitCode, 2);
    assert.equal(host.publications, 1);
    assert.equal(retired, 1);
    assert.equal(host.rows.has(destination), false);
  } finally { await shell.dispose(); }
});

test("streaming conditional publication honors the Shell output budget before commit", async () => {
  const host = flatStore();
  host.write("/work/colored/cat.png", new Uint8Array(256));
  const shell = new Shell({ fs: host.fs, limits: { maxOutputBytes: 64 } }).register(createZipCommand());
  try {
    await assert.rejects(shell.exec(`zip -0 -j ${destination} /work/colored/cat.png`), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(host.rows.has(destination), false);
  } finally { await shell.dispose(); }
});

test("unknown hardlink semantics do not relax single-link output requirements", async () => {
  const { host, shell, before } = await existingArchive();
  const { hardlinks: ignoredHardlinks, ...capabilities } = host.fs.capabilities;
  Object.defineProperty(host.fs, "capabilities", { value: capabilities });
  try {
    const result = await shell.exec(`zip -j ${destination} /work/colored/cat.png`);
    assert.equal(result.exitCode, 2);
    assert.equal(host.publications, 1);
    assert.deepEqual(await host.fs.readFile(destination), before);
  } finally { await shell.dispose(); }
});

for (const invalid of ["identity", "version", "nlink", "primitive"] as const) {
  test(`conditional publication refuses missing or conflicting ${invalid} authority`, async () => {
    const { host, shell, before } = await existingArchive();
    const original = host.fs.stat;
    if (invalid === "primitive") delete host.fs.publishFileConditional;
    else {
      host.fs.stat = host.fs.lstat = async (path, options) => {
        const stat = await original(path, options);
        if (path !== destination) return stat;
        const metadata: FileStat = { ...stat };
        if (invalid === "identity") delete (metadata as { opaqueIdentity?: string }).opaqueIdentity;
        if (invalid === "version") delete (metadata as { opaqueVersion?: string }).opaqueVersion;
        return invalid === "nlink" ? { ...metadata, nlink: 2 } : metadata;
      };
    }
    try {
      const result = await shell.exec(`zip -j ${destination} /work/colored/cat.png`);
      assert.equal(result.exitCode, 2);
      assert.equal(host.publications, 1);
      assert.deepEqual(await host.fs.readFile(destination), before);
    } finally { await shell.dispose(); }
  });
}

test("a premature publication acknowledgement is rejected without consuming sources", async () => {
  const host = flatStore();
  host.write("/work/colored/cat.png", Uint8Array.of(0, 255, 42));
  let reads = 0;
  host.fs.readStream = async function* () { reads++; yield Uint8Array.of(0, 255, 42); };
  host.fs.publishFileConditional = async () => ({ type: "file", size: 0, mode: 0o100644,
    mtimeMs: 0, atimeMs: 0, ctimeMs: 0, identityScope: host.scope, opaqueIdentity: "bad", opaqueVersion: "bad" });
  const shell = new Shell({ fs: host.fs }).register(createZipCommand());
  try {
    const result = await shell.exec(`zip -0 -j ${destination} /work/colored/cat.png`);
    assert.equal(result.exitCode, 2);
    assert.equal(reads, 0);
    assert.equal(host.rows.has(destination), false);
  } finally { await shell.dispose(); }
});

for (const opaqueVersion of ["", "x".repeat(4097)]) {
  test(`publication rejects an invalid opaque version of length ${opaqueVersion.length} even with native identity`, async () => {
    const host = flatStore();
    host.write("/work/colored/cat.png", Uint8Array.of(0, 255, 42));
    host.fs.publishFileConditional = async (_path, source) => {
      const bytes = await collectBytes(source, { maxBytes: 1048576 });
      return { type: "file", size: bytes.length, mode: 0o100644, mtimeMs: 0, atimeMs: 0, ctimeMs: 0,
        identityScope: host.scope, ino: 1, dev: 0, nlink: 1, opaqueVersion };
    };
    const shell = new Shell({ fs: host.fs }).register(createZipCommand());
    try {
      const result = await shell.exec(`zip -0 -j ${destination} /work/colored/cat.png`);
      assert.equal(result.exitCode, 2);
      assert.equal(host.rows.has(destination), false);
    } finally { await shell.dispose(); }
  });
}

test("recursive ZIP updates accept implicit directories without backing file identities", async () => {
  const host = flatStore();
  host.write("/work/colored/cat.png", Uint8Array.of(0, 255, 42));
  const shell = new Shell({ fs: host.fs }).register(createZipCommand());
  try {
    const command = `zip -r ${destination} /work/colored`;
    assert.equal((await shell.exec(command)).exitCode, 0);
    const updated = await shell.exec(command);
    assert.equal(updated.exitCode, 0, updated.stdout + updated.stderr);
    const archive = await readZipArchive(await host.fs.readFile(destination), settings({}), new AbortController().signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), ["work/colored/", "work/colored/cat.png"]);
  } finally { await shell.dispose(); }
});
