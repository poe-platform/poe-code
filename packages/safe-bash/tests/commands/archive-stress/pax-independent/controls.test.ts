import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createTarCommand, type ArchiveCommandsOptions } from "../../../../src/commands/archive/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ByteSource, FileSystem } from "../../../../src/contracts/index.js";
import { archive, extended, fileData, member, opaque, record } from "./fixtures.js";

async function filesystem(): Promise<FileSystem> {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/output");
  await fs.mkdir("/outside");
  await fs.writeFile("/outside/keep", Buffer.from("outside unchanged"));
  return fs;
}

async function execute(fs: FileSystem, bytes: Uint8Array, gzip = false, options: ArchiveCommandsOptions = {}, extra: string[] = [], listing = false) {
  const input = gzip ? gzipSync(bytes) : Buffer.from(bytes);
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    for (let offset = 0; offset < input.length; offset += 17) yield input.subarray(offset, offset + 17);
  } };
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let collected = 0;
  const sink = (chunks: Buffer[]) => ({ async write(chunk: Uint8Array) {
    collected += chunk.length;
    assert.ok(collected <= 65536, "independent output capture limit");
    chunks.push(Buffer.from(chunk));
  } });
  const result = await createTarCommand(options).execute({
    command: "tar", args: [`-${listing ? "t" : "x"}${gzip ? "z" : ""}f`, "-", ...(listing ? [] : ["-C", "/output"]), ...extra],
    fs, cwd: "/", env: {}, signal: AbortSignal.timeout(4000), stdin, stdout: sink(stdout), stderr: sink(stderr),
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

async function rejected(bytes: Uint8Array, options: ArchiveCommandsOptions = {}, extra: string[] = [], diagnostic = /PAX|checksum|truncated|limit|unsupported|parent|orphan|charset|UTF-8|nonzero/i): Promise<void> {
  for (const gzip of [false, true]) {
    const fs = await filesystem();
    await fs.writeFile("/output/keep", Buffer.from("destination unchanged"));
    const result = await execute(fs, bytes, gzip, options, extra);
    assert.notEqual(result.exitCode, 0, `negative control accepted (${gzip ? "gzip" : "plain"})`);
    assert.match(result.stderr, diagnostic);
    assert.equal(Buffer.from(await fs.readFile("/output/keep")).toString(), "destination unchanged");
    assert.equal(Buffer.from(await fs.readFile("/outside/keep")).toString(), "outside unchanged");
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name), ["keep"]);
    assert.deepEqual((await fs.readdir("/outside")).map(entry => entry.name), ["keep"]);
  }
}

test("I01 opaque optional bytes cannot change effective size, path, type or literal dot-underscore members", async () => {
  const metadata = Buffer.concat([
    record("SCHILY.xattr.user.blob", opaque), record("path", "renamed-雪"),
    record("LIBARCHIVE.xattr.user.note", "AP8="), record("size", String(fileData.length)),
    record("SCHILY.xattr.user.path", Buffer.from("../outside/keep\0")),
  ]);
  const bytes = archive(
    member("metadata", metadata, "x"), member("raw", fileData, "0", "", 1),
    member("._literal", Buffer.from("ordinary file, not AppleDouble metadata")),
    member("metadata", Buffer.concat([record("SCHILY.xattr.user.type", opaque), record("linkpath", "renamed-雪")]), "x"),
    member("symbol", Buffer.alloc(0), "2", "raw"), member("following", Buffer.from("end")),
  );
  for (const gzip of [false, true]) {
    const fs = await filesystem();
    const listed = await execute(fs, bytes, gzip, {}, [], true);
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.equal(listed.stdout.toString(), "renamed-雪\n._literal\nsymbol\nfollowing\n");
    const result = await execute(fs, bytes, gzip);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(await fs.readFile("/output/renamed-雪")), fileData);
    assert.equal((await fs.stat("/output/renamed-雪")).size, fileData.length);
    assert.equal((await fs.lstat("/output/renamed-雪")).type, "file");
    assert.equal((await fs.lstat("/output/symbol")).type, "symlink");
    assert.equal(await fs.readlink!("/output/symbol"), "renamed-雪");
    assert.equal(Buffer.from(await fs.readFile("/output/._literal")).toString(), "ordinary file, not AppleDouble metadata");
    assert.equal(Buffer.from(await fs.readFile("/output/following")).toString(), "end");
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name).sort(), ["._literal", "following", "renamed-雪", "symbol"]);
    assert.equal(Buffer.from(await fs.readFile("/outside/keep")).toString(), "outside unchanged");
  }
});

test("I02 malformed opaque-value framing and checksum mutations fail before publication", async () => {
  const valid = record("SCHILY.xattr.user.blob", opaque);
  const space = valid.indexOf(32);
  const mutants = [
    Buffer.concat([Buffer.from(String(valid.length - 1)), valid.subarray(space)]),
    Buffer.concat([Buffer.from(String(valid.length + 1)), valid.subarray(space)]),
    Buffer.concat([valid.subarray(0, -1), Buffer.from("!")]),
    Buffer.concat([Buffer.from("0"), valid.subarray(space)]),
    Buffer.concat([Buffer.from("9007199254740993"), valid.subarray(space)]),
    Buffer.concat([valid, Buffer.from("garbage")]),
    record(Buffer.from([255]), opaque), record("SCHILY.xattr.user.bad\0key", opaque),
  ];
  const missingEquals = Buffer.from(valid);
  missingEquals[missingEquals.indexOf(61)] = 58;
  mutants.push(missingEquals);
  const crossedDelimiter = record("SCHILY.xattr.user.blob", "opaque");
  crossedDelimiter[crossedDelimiter.indexOf(61)] = 58;
  mutants.push(Buffer.concat([crossedDelimiter, record("path", "keep")]));
  for (const mutant of mutants) await rejected(extended(mutant));
  const corrupt = extended(valid);
  corrupt[0] = corrupt[0]! ^ 1;
  await rejected(corrupt, {}, [], /checksum/i);
  await rejected(extended(valid).subarray(0, 512 + valid.length - 1));
  await rejected(extended(valid).subarray(0, 512 + valid.length + 1));
});

test("I03 essential layout and effective-path controls remain fail-closed beside ignored metadata", async () => {
  for (const key of ["GNU.sparse.map", "GNU.sparse.name", "GNU.sparse.major", "GNU.sparse.realsize", "SCHILY.realsize", "SCHILY.filetype", "SUN.holesdata"]) {
    for (const type of ["x", "g"]) {
      const bytes = archive(member("metadata", Buffer.concat([record("SCHILY.xattr.user.blob", opaque), record(key, "1")]), type), member("keep", fileData));
      await rejected(bytes, {}, [], /unsupported/i);
      await rejected(bytes, {}, ["--exclude=*"], /unsupported/i);
    }
  }
  for (const value of [Buffer.from("../outside/keep"), Buffer.from([255]), Buffer.from("safe\0unsafe")]) {
    await rejected(extended(Buffer.concat([record("SCHILY.xattr.user.blob", opaque), record("path", value)])), {}, ["--strip-components=1", "--exclude=*"]);
  }
  await rejected(extended(Buffer.concat([record("SCHILY.xattr.user.blob", opaque), record("hdrcharset", "BINARY")])));
  await rejected(extended(record("SCHILY.xattr.user.blob", opaque), member("keep", Buffer.alloc(0), "S")), {}, [], /unsupported/i);
});

test("I04 discarded values still consume PAX, member, archive and effective-size budgets", async () => {
  const metadata = record("SCHILY.xattr.user.blob", Buffer.concat([opaque, Buffer.alloc(257, 255)]));
  const bytes = extended(metadata);
  for (const gzip of [false, true]) {
    const fs = await filesystem();
    const result = await execute(fs, bytes, gzip, { limits: { maxPaxBytes: metadata.length, maxEntryBytes: fileData.length, maxMembers: 2 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(await fs.readFile("/output/keep")), fileData);
  }
  await rejected(bytes, { limits: { maxPaxBytes: metadata.length - 1 } }, ["--exclude=*"], /limit/i);
  await rejected(bytes, { limits: { maxMembers: 1 } }, ["--exclude=*"], /limit/i);
  await rejected(bytes, { limits: { maxArchiveBytes: 512 } }, [], /limit/i);
  await rejected(extended(Buffer.concat([metadata, record("size", "8")])), { limits: { maxEntryBytes: 7 } }, ["--exclude=*"], /limit/i);
  await rejected(archive(member("metadata", metadata, "x")), {}, [], /orphan/i);
});

test("I05 fixed local nanoseconds and global precedence have separate virtual and native profile assertions", { timeout: 60000 }, async context => {
  const fixed = (local: string) => archive(
    member("global", record("mtime", "1700123400"), "g"),
    member("local", Buffer.concat([record("SCHILY.xattr.user.note", opaque), record("mtime", local)]), "x"),
    member("first", fileData), member("following", Buffer.from("second")),
  );
  const fs = await filesystem();
  const virtual = await execute(fs, fixed("1700123401.125"));
  assert.equal(virtual.exitCode, 0, virtual.stderr);
  assert.equal((await fs.stat("/output/first")).mtimeMs, 1700123401125);
  assert.equal((await fs.stat("/output/following")).mtimeMs, 1700123400000);
  const profiles = [
    { family: "GNU", path: fileURLToPath(new URL("../../archive/.oracle/gnu-tar/1.35/bin/gtar", import.meta.url)), hash: "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66", following: 1700123400000000000n },
    { family: "BSD", path: "/usr/bin/bsdtar", hash: "bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9", following: 1700123456000000000n },
  ];
  for (const profile of profiles) {
    assert.equal(createHash("sha256").update(await readFile(profile.path)).digest("hex"), profile.hash, "native profile binary drift");
    const directory = await mkdtemp(join(tmpdir(), "safe-bash-pax-independent-native-"));
    const observations: unknown[] = [];
    try {
      const native = (args: string[]) => {
        const result = spawnSync(profile.path, args, { cwd: directory, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, timeout: 8000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" });
        observations.push({ args, status: result.status, signal: result.signal, stdout: result.stdout?.toString(), stderr: result.stderr?.toString(), error: result.error?.message });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr?.toString());
        return result.stdout;
      };
      native(["--version"]);
      const fixedBytes = fixed("1700123401.123456789");
      await writeFile(join(directory, "fixed.tar"), fixedBytes);
      observations.push({ fixedArchiveSha256: createHash("sha256").update(fixedBytes).digest("hex"), environment: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" } });
      if (process.env.ARCHIVE_ACCEPTANCE_EVIDENCE) await writeFile(join(process.env.ARCHIVE_ACCEPTANCE_EVIDENCE, `independent-${profile.family}-fixed.tar`), fixedBytes, { flag: "wx" });
      await mkdir(join(directory, "out"));
      native(["-xf", "fixed.tar", "-C", "out"]);
      const localNs = (await lstat(join(directory, "out/first"), { bigint: true })).mtimeNs;
      const followingNs = (await lstat(join(directory, "out/following"), { bigint: true })).mtimeNs;
      observations.push({ localNs: String(localNs), followingNs: String(followingNs), posixFollowingNs: "1700123400000000000", classification: profile.family === "BSD" ? "native global semantics conflict; NOT virtual acceptance" : "nonempty POSIX precedence" });
      assert.equal(localNs, 1700123401123456789n);
      assert.equal(followingNs, profile.following);
      const sidecarBytes = archive(member("._literal", Buffer.from("ordinary data")), member("literal", fileData));
      await writeFile(join(directory, "sidecar.tar"), sidecarBytes);
      observations.push({ sidecarArchiveSha256: createHash("sha256").update(sidecarBytes).digest("hex") });
      if (process.env.ARCHIVE_ACCEPTANCE_EVIDENCE) await writeFile(join(process.env.ARCHIVE_ACCEPTANCE_EVIDENCE, `independent-${profile.family}-sidecar.tar`), sidecarBytes, { flag: "wx" });
      const listing = native(["-tf", "sidecar.tar"]);
      if (profile.family === "GNU") assert.equal(listing.toString(), "._literal\nliteral\n");
      observations.push({ sidecarClassification: "default native presentation only; no product filtering or inferred metadata restoration", noExtraNativeOptions: true });
    } finally {
      context.diagnostic(JSON.stringify({ family: profile.family, sha256: profile.hash, observations }));
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("I06 opaque PAX hardlinks share writes and unsupported publication never copies", async () => {
  const bytes = archive(member("a", fileData), member("metadata", Buffer.concat([record("SCHILY.xattr.user.blob", opaque), record("linkpath", "a")]), "x"), member("b", Buffer.alloc(0), "1", "wrong"), member("c", Buffer.alloc(0), "1", "b"));
  for (const gzip of [false, true]) {
    const fs = await filesystem();
    const result = await execute(fs, bytes, gzip);
    assert.equal(result.exitCode, 0, result.stderr);
    const original = await fs.lstat("/output/a");
    assert.ok(original.identityScope);
    assert.ok(Number.isSafeInteger(original.dev) && original.dev! >= 0);
    assert.ok(Number.isSafeInteger(original.ino) && original.ino! >= 0);
    await fs.writeFile("/output/b", Buffer.from("shared"));
    await fs.appendFile("/output/a", Buffer.from("-append"));
    for (const name of ["a", "b", "c"]) {
      const stat = await fs.lstat(`/output/${name}`);
      assert.equal(stat.type, "file");
      assert.equal(stat.identityScope, original.identityScope);
      assert.equal(stat.dev, original.dev);
      assert.equal(stat.ino, original.ino);
      assert.equal(stat.nlink, 3);
      assert.equal(Buffer.from(await fs.readFile(`/output/${name}`)).toString(), "shared-append");
    }
  }
  for (const missing of [false, true]) {
    const fs = await filesystem();
    await fs.writeFile("/output/b", Buffer.from("keep b"));
    let linkCalls = 0;
    const wrapped = new Proxy(fs, { get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, hardlinks: missing };
      if (key === "link") return missing ? undefined : async () => { linkCalls++; throw new Error("forbidden link invocation"); };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await execute(wrapped, bytes, missing);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /support.*hardlink/i);
    assert.equal(linkCalls, 0);
    assert.deepEqual(Buffer.from(await fs.readFile("/output/a")), fileData);
    assert.equal((await fs.stat("/output/a")).nlink, 1);
    assert.equal(Buffer.from(await fs.readFile("/output/b")).toString(), "keep b");
    await assert.rejects(fs.lstat("/output/c"), { code: "ENOENT" });
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name).sort(), ["a", "b"]);
  }
});
