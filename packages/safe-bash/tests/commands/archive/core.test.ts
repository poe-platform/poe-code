import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, type PluginHost } from "../../../src/contracts/index.js";
import { archiveCommands, createArchiveCommands, DEFAULT_ARCHIVE_LIMITS } from "../../../src/commands/archive/index.js";
import { archive, binary, direct, fixture, member, source, wrapped } from "./helpers.js";

test("archive plugin is explicit, collision-atomic, and validates limits", async () => {
  assert.deepEqual(createArchiveCommands().map(command => command.name), ["tar"]);
  const registry = new CommandRegistry([{ name: "tar", execute: () => ({ exitCode: 19 }) }]);
  const host: PluginHost = { commands: registry, use() {}, registerFileSystem() {} };
  assert.throws(() => archiveCommands().setup(host), /already registered/u);
  assert.equal(registry.list().length, 1);
  archiveCommands({ replace: true }).setup(host);
  assert.equal(registry.list().length, 1);
  assert.throws(() => createArchiveCommands({ limits: { maxMembers: 0 } }), /limit/u);
  assert.throws(() => createArchiveCommands({ limits: { chunkSize: 1 } }), /chunkSize/u);
  assert.equal(DEFAULT_ARCHIVE_LIMITS.maxEntryBytes, 64 * 1024 * 1024);
});

for (const gzip of [false, true]) test(`Shell binary create/list/extract ${gzip ? "gzip" : "plain"}`, async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.mkdir("/work/tree");
    await fs.writeFile("/work/tree/binary", binary);
    await fs.writeFile("/work/tree/empty", new Uint8Array());
    await fs.writeFile("/work/tree/large", new Uint8Array(2 * 1024 * 1024).fill(197));
    await fs.symlink!("binary", "/work/tree/symbol");
    await fs.link!("/work/tree/binary", "/work/tree/hard");
    const created = await shell.exec(`tar -c${gzip ? "z" : ""}f archive tree`);
    assert.equal(created.exitCode, 0, created.stderr);
    assert.equal(created.stdout, "");
    const listing = await shell.exec(`cat archive | tar -t${gzip ? "z" : ""}f -`);
    assert.equal(listing.exitCode, 0, listing.stderr);
    assert.match(listing.stdout, /tree\/binary\n/u);
    assert.match(listing.stdout, /tree\/symbol\n/u);
    const extracted = await shell.exec(`cat archive | tar -x${gzip ? "z" : ""}f - -C /out`);
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.deepEqual(await fs.readFile("/out/tree/binary"), binary);
    assert.equal((await fs.readFile("/out/tree/empty")).length, 0);
    assert.equal((await fs.readFile("/out/tree/large")).length, 2 * 1024 * 1024);
    assert.equal(await fs.readlink!("/out/tree/symbol"), "binary");
    assert.equal((await fs.stat("/out/tree/binary")).ino, (await fs.stat("/out/tree/hard")).ino);
  } finally { await shell.dispose(); }
});

test("real Shell pipelines preserve binary bytes through tar, cat, gzip and gunzip", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/data", binary);
    for (const command of ["tar cf - data | cat | tar xf - -C /out", "tar cf - data | gzip | tar xzf - -C /out", "tar czf - data | gunzip | tar xf - -C /out"]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
      assert.deepEqual(await fs.readFile("/out/data"), binary);
    }
  } finally { await shell.dispose(); }
});

test("verbose archive stdout stays binary; list and extract use stdout", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/file", binary);
    const result = await shell.exec("tar cvf - file");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "file\n");
    const listed = await shell.exec("tar tf -", { stdin: result.stdoutBytes });
    assert.equal(listed.stdout, "file\n");
    const extracted = await shell.exec("tar xvf - -C /out", { stdin: result.stdoutBytes });
    assert.equal(extracted.stdout, "file\n");
    const verbose = await shell.exec("tar tvf -", { stdin: result.stdoutBytes });
    assert.match(verbose.stdout, /^-[rwx-]{9} \d+\/\d+ 2051 [0-9.]+ file\n$/u);
  } finally { await shell.dispose(); }
});

test("PAX Unicode, newline names, long component and USTAR prefix split", async () => {
  const { fs, shell } = await fixture();
  try {
    const names = ["zażółć-雪", "line\nname", "x".repeat(140), `${"p".repeat(120)}/${"q".repeat(90)}`];
    await fs.mkdir(`/work/${"p".repeat(120)}`);
    for (const name of names) await fs.writeFile(`/work/${name}`, binary);
    await fs.writeFile("/work/names", Buffer.from(names.join("\0") + "\0"));
    let result = await shell.exec("tar --create --file=archive --null -T names");
    assert.equal(result.exitCode, 0, result.stderr);
    result = await shell.exec("tar xf archive -C /out");
    assert.equal(result.exitCode, 0, result.stderr);
    for (const name of names) assert.deepEqual(await fs.readFile(`/out/${name}`), binary);
    const split = await shell.exec(`tar --format=ustar -cf split '${names[3]}'`);
    assert.equal(split.exitCode, 0, split.stderr);
    const bytes = await fs.readFile("/work/split");
    assert.equal(Buffer.from(bytes.subarray(345, 465)).toString(), "p".repeat(120));
  } finally { await shell.dispose(); }
});

test("metadata preserves supported ordinary permissions and fractional timestamps", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.mkdir("/work/tree");
    await fs.writeFile("/work/tree/file", binary);
    await fs.chmod!("/work/tree/file", 0o640);
    await fs.utimes!("/work/tree/file", 1_700_000_000_123, 1_700_000_010_456);
    await fs.chmod!("/work/tree", 0o755);
    await fs.utimes!("/work/tree", 1_700_000_000_001, 1_700_000_002_789);
    const result = await shell.exec("tar cf archive tree; tar xf archive -C /out");
    assert.equal(result.exitCode, 0, result.stderr);
    const stat = await fs.stat("/out/tree/file");
    assert.equal(stat.mode & 0o777, 0o640);
    assert.equal(stat.mtimeMs, 1_700_000_010_456);
    assert.equal((await fs.stat("/out/tree")).mtimeMs, 1_700_000_002_789);
  } finally { await shell.dispose(); }
});

test("duplicates replace regular files without mutating earlier hardlink aliases", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("first", Buffer.from("old")), member("hard", new Uint8Array(), "1", "first"), member("first", Buffer.from("new")));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/out/first")).toString(), "new");
    assert.equal(Buffer.from(await fs.readFile("/out/hard")).toString(), "old");
  } finally { await shell.dispose(); }
});

test("creation never points hardlinks at an overwritten duplicate archive pathname", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.mkdir("/work/one"); await fs.mkdir("/work/two");
    await fs.writeFile("/work/one/file", Buffer.from("original"));
    await fs.link!("/work/one/file", "/work/one/hard");
    await fs.writeFile("/work/two/file", Buffer.from("replacement"));
    const result = await shell.exec("tar cf archive -C one file -C ../two ./file -C ../one hard; tar xf archive -C /out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/out/file")).toString(), "replacement");
    assert.equal(Buffer.from(await fs.readFile("/out/hard")).toString(), "original");
  } finally { await shell.dispose(); }
});

test("safe file/symlink/directory replacement and existing external hardlink isolation", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/outside", Buffer.from("untouched"));
    await fs.link!("/work/outside", "/out/item");
    const bytes = archive(member("item", binary), member("item", new Uint8Array(), "2", "target"), member("item/", new Uint8Array(), "5"), member("item", Buffer.from("last")));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/work/outside")).toString(), "untouched");
    assert.equal(Buffer.from(await fs.readFile("/out/item")).toString(), "last");
  } finally { await shell.dispose(); }
});

test("creation avoids self-inclusion and rejects explicit output payload aliases before effects", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/data", binary);
    assert.equal((await shell.exec("tar cf archive .")).exitCode, 0);
    const result = await shell.exec("tar cf archive .");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /file is the archive/u);
    assert.doesNotMatch((await shell.exec("tar tf archive")).stdout, /archive/u);
    await fs.link!("/work/data", "/work/alias");
    assert.equal((await shell.exec("tar cf alias data")).exitCode, 2);
    assert.deepEqual(await fs.readFile("/work/data"), binary);
    await fs.symlink!("data", "/work/outputlink");
    assert.equal((await shell.exec("tar cf outputlink data")).exitCode, 2);
    assert.deepEqual(await fs.readFile("/work/data"), binary);
  } finally { await shell.dispose(); }
});

test("non-streaming adapters use bounded reads and incremental append writes", async () => {
  const { fs, shell } = await fixture();
  await shell.dispose();
  await fs.writeFile("/work/data", binary);
  const adapter = wrapped(fs, { readStream: undefined, writeStream: undefined } as unknown as Partial<typeof fs>);
  const created = await direct(["-cf", "-", "data"], adapter);
  assert.equal(created.exitCode, 0, created.stderr);
  const extracted = await direct(["-xf", "-", "-C", "/out"], adapter, { stdin: source(created.stdoutBytes, 29) });
  assert.equal(extracted.exitCode, 0, extracted.stderr);
  assert.deepEqual(await fs.readFile("/out/data"), binary);
  const limited = await direct(["-cf", "-", "data"], adapter, {}, { limits: { maxBufferedFileBytes: 32 } });
  assert.equal(limited.exitCode, 2);
  assert.match(limited.stderr, /buffered file limit/u);
});
