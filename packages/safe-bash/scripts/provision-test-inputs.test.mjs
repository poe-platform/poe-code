import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { Volume, createFsFromVolume } from "memfs";
import { COREUTILS_INPUT, extractTarMembers, fetchVerified, inflateArchive, main, provisionInputs, validateLinuxRgProfile } from "./provision-test-inputs.mjs";
import * as sourceBootstrap from "./provision-test-inputs.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const payload = Buffer.from("authenticated source\n");
const members = [{ path: "fixture/src/input.c", output: "fixture/src/input.c", size: payload.length, sha256: sha256(payload), mode: 0o644 }];

function archive(entries = [{ name: members[0].path, bytes: payload }]) {
  const chunks = [];
  for (const entry of entries) {
    const bytes = entry.bytes ?? Buffer.alloc(0);
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    if (entry.format !== "v7") {
      header.write("ustar\0", 257);
      header.write("00", 263);
    }
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}

function fixture() {
  const volume = new Volume();
  const memory = createFsFromVolume(volume);
  const fileSystem = memory.promises;
  const memoryOpen = fileSystem.open.bind(fileSystem);
  fileSystem.open = (name, flags, mode) => {
    if (typeof flags !== "number") return memoryOpen(name, flags, mode);
    let translated = 0;
    for (const flag of ["O_WRONLY", "O_RDWR", "O_CREAT", "O_EXCL", "O_NOFOLLOW"]) if (flags & constants[flag]) translated |= memory.constants[flag];
    return memoryOpen(name, translated, mode);
  };
  const bytes = archive();
  const input = { url: "https://ftp.gnu.org/gnu/coreutils/fixture.tar.xz", size: bytes.length, sha256: sha256(bytes), archiveName: "fixture.tar.xz", prefix: "fixture", format: "xz", members };
  const calls = [];
  return { fileSystem, volume, input, calls, dependencies: { fileSystem, uid: process.getuid(), fetch: async () => new Response(bytes), inflate: async value => { calls.push("inflate"); return value; } } };
}

async function prepare(state) {
  await state.fileSystem.chmod("/", 0o755);
  await state.fileSystem.mkdir("/job", { mode: 0o700 });
  return state;
}

test("coreutils input is exactly the historical archive plus six source members", () => {
  assert.equal(COREUTILS_INPUT.size, 6158960);
  assert.equal(COREUTILS_INPUT.sha256, "e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf");
  assert.equal(COREUTILS_INPUT.members.length, 6);
  assert.deepEqual(COREUTILS_INPUT.members.map(member => member.path), ["src/chmod.c", "src/stat.c", "src/mktemp.c", "lib/modechange.c", "src/comm.c", "doc/coreutils.texi"].map(name => `coreutils-9.7/${name}`));
});

test("fetch authenticates exact size and hash with no ambient credentials", async () => {
  const bytes = Buffer.from("archive");
  const input = { url: "https://ftp.gnu.org/gnu/coreutils/input.tar.xz", size: bytes.length, sha256: sha256(bytes) };
  const result = await fetchVerified(input, { fetch: async (url, options) => {
    assert.equal(url, input.url);
    assert.equal(options.redirect, "manual");
    assert.deepEqual(options.headers, { "Accept-Encoding": "identity" });
    return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
  } });
  assert.deepEqual(result, bytes);
});

test("fetch rejects truncation, excess, bad hash and advertised oversize", async context => {
  const bytes = Buffer.from("right");
  const input = { url: "https://ftp.gnu.org/input", size: bytes.length, sha256: sha256(bytes) };
  for (const [name, response] of [
    ["short", () => new Response("no")],
    ["long", () => new Response("much too long")],
    ["hash", () => new Response("wrong")],
    ["header", () => new Response(bytes, { headers: { "content-length": "999999999" } })],
    ["encoded", () => new Response(bytes, { headers: { "content-encoding": "gzip" } })],
    ["HTTP error", () => new Response("no", { status: 404 })],
  ]) await context.test(name, async () => assert.rejects(fetchVerified(input, { fetch: async () => response() })));
});

test("fetch rejects redirect escapes, loops, credentials and invalid pins", async () => {
  const input = { url: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/archive", size: 1, sha256: sha256("a") };
  for (const location of ["http://github.com/archive", "https://evil.invalid/archive", "https://user:secret@github.com/archive", "https://github.com:444/archive"]) {
    await assert.rejects(fetchVerified(input, { fetch: async () => new Response(null, { status: 302, headers: { location } }) }));
  }
  let calls = 0;
  await assert.rejects(fetchVerified(input, { fetch: async () => { calls += 1; return new Response(null, { status: 302, headers: { location: input.url } }); } }));
  assert.equal(calls, 4);
  for (const invalid of [{ ...input, size: 0 }, { ...input, size: 2 ** 30 }, { ...input, sha256: "bad" }]) await assert.rejects(fetchVerified(invalid, { fetch: async () => { assert.fail("invalid pin fetched"); } }));
});

test("tar selects only exact authenticated regular members", () => {
  const result = extractTarMembers(archive([{ name: "fixture/", type: "5" }, { name: members[0].path, bytes: payload }, { name: "fixture/ignored", bytes: Buffer.from("not emitted") }]), members, "fixture");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].bytes, payload);
  assert.equal(result[0].output, members[0].output);
});

test("authenticated GNU source archive's V7 regular format is accepted without extensions", () => {
  const result = extractTarMembers(archive([{ name: members[0].path, bytes: payload, format: "v7" }]), members, "fixture");
  assert.deepEqual(result[0].bytes, payload);
});

test("tar rejects traversal, links, duplicates, extensions and missing members", async context => {
  for (const [name, entries] of [
    ["parent traversal", [{ name: "fixture/../escape" }]],
    ["absolute", [{ name: "/escape" }]],
    ["backslash", [{ name: "fixture\\escape" }]],
    ["symlink", [{ name: members[0].path, type: "2", bytes: payload }]],
    ["hardlink", [{ name: members[0].path, type: "1", bytes: payload }]],
    ["duplicate", [{ name: members[0].path, bytes: payload }, { name: members[0].path, bytes: payload }]],
    ["pax", [{ name: "fixture/pax", type: "x" }]],
    ["other root", [{ name: "elsewhere/file", bytes: payload }]],
    ["missing", []],
  ]) await context.test(name, () => assert.throws(() => extractTarMembers(archive(entries), members, "fixture")));
});

test("tar rejects checksum, truncation, trailing data and member identity mismatch", () => {
  const damaged = archive();
  damaged[0] ^= 1;
  assert.throws(() => extractTarMembers(damaged, members, "fixture"));
  assert.throws(() => extractTarMembers(archive().subarray(0, 900), members, "fixture"));
  assert.throws(() => extractTarMembers(Buffer.concat([archive(), Buffer.alloc(512, 1)]), members, "fixture"));
  assert.throws(() => extractTarMembers(archive(), [{ ...members[0], sha256: "0".repeat(64) }], "fixture"));
  assert.throws(() => extractTarMembers(archive(), [{ ...members[0], output: "../escape" }], "fixture"));
});

test("provision creates private unique root, exact archive/member files and no executable launch", async () => {
  const state = await prepare(fixture());
  const result = await provisionInputs({ parent: "/job", inputs: [state.input] }, state.dependencies);
  assert.equal(result.status, "INPUTS_VERIFIED_NOT_QUALIFIED");
  assert.equal((await state.fileSystem.stat(result.root)).mode & 0o777, 0o700);
  assert.deepEqual(await state.fileSystem.readFile(`${result.root}/fixture/src/input.c`), payload);
  assert.equal((await state.fileSystem.stat(`${result.root}/fixture/src/input.c`)).mode & 0o777, 0o644);
  assert.deepEqual(state.calls, ["inflate"]);
  const second = await provisionInputs({ parent: "/job", inputs: [state.input] }, state.dependencies);
  assert.notEqual(result.root, second.root);
});

test("authentication failure precedes decompression and cleans owned root", async () => {
  const state = await prepare(fixture());
  state.dependencies.fetch = async () => new Response("bad");
  await assert.rejects(provisionInputs({ parent: "/job", inputs: [state.input] }, state.dependencies), /download truncated/u);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(await state.fileSystem.readdir("/job"), []);
});

test("member failure cleans partial owned outputs without touching siblings", async () => {
  const state = await prepare(fixture());
  await state.fileSystem.writeFile("/job/keep", "sentinel");
  state.input = { ...state.input, members: [{ ...members[0], sha256: "0".repeat(64) }] };
  await assert.rejects(provisionInputs({ parent: "/job", inputs: [state.input] }, state.dependencies), /member SHA-256 mismatch/u);
  assert.deepEqual(await state.fileSystem.readdir("/job"), ["keep"]);
  assert.equal(await state.fileSystem.readFile("/job/keep", "utf8"), "sentinel");
});

test("unsafe, aliased and non-owned parents are rejected before network", async () => {
  for (const kind of ["writable", "symlink", "owner", "relative"]) {
    const state = await prepare(fixture());
    let parent = "/job";
    if (kind === "writable") await state.fileSystem.chmod(parent, 0o777);
    if (kind === "symlink") { await state.fileSystem.symlink(parent, "/alias"); parent = "/alias"; }
    if (kind === "owner") state.dependencies.uid = process.getuid() + 1;
    if (kind === "relative") parent = "job";
    state.dependencies.fetch = async () => { assert.fail("unsafe parent fetched"); };
    await assert.rejects(provisionInputs({ parent, inputs: [state.input] }, state.dependencies));
  }
});

test("private parent below a writable non-sticky ancestor is not isolated", async () => {
  const state = await prepare(fixture());
  await state.fileSystem.mkdir("/shared", { mode: 0o777 });
  await state.fileSystem.mkdir("/shared/private", { mode: 0o700 });
  state.dependencies.fetch = async () => assert.fail("unsafe ancestor fetched");
  await assert.rejects(provisionInputs({ parent: "/shared/private", inputs: [state.input] }, state.dependencies), /untrusted ancestor/u);
});

test("exclusive output creation rejects overwrite and symlink insertion", async () => {
  for (const kind of ["file", "symlink"]) {
    const state = await prepare(fixture());
    const originalOpen = state.fileSystem.open.bind(state.fileSystem);
    let inserted = false;
    state.fileSystem.open = async (name, flags, mode) => {
      if (!inserted && name.endsWith("fixture.tar.xz")) {
        inserted = true;
        assert(flags & constants.O_EXCL);
        assert(flags & constants.O_NOFOLLOW);
        if (kind === "file") await state.fileSystem.writeFile(name, "collision");
        else { await state.fileSystem.writeFile("/job/sentinel", "outside"); await state.fileSystem.symlink("/job/sentinel", name); }
      }
      return originalOpen(name, flags, mode);
    };
    await assert.rejects(provisionInputs({ parent: "/job", inputs: [state.input] }, state.dependencies));
    if (kind === "symlink") assert.equal(await state.fileSystem.readFile("/job/sentinel", "utf8"), "outside");
  }
});

test("parent replacement is detected and cleanup does not traverse substituted parent", async () => {
  const state = await prepare(fixture());
  state.dependencies.inflate = async bytes => {
    await state.fileSystem.rename("/job", "/moved");
    await state.fileSystem.mkdir("/job", { mode: 0o700 });
    await state.fileSystem.writeFile("/job/keep", "replacement");
    return bytes;
  };
  await assert.rejects(provisionInputs({ parent: "/job", inputs: [state.input] }, state.dependencies), /identity|cleanup/u);
  assert.equal(await state.fileSystem.readFile("/job/keep", "utf8"), "replacement");
});

test("Linux profile cannot claim execution qualification or admit another platform", () => {
  assert.throws(() => validateLinuxRgProfile({ qualification: { status: "PASS" } }, { platform: "linux", arch: "x64" }));
  assert.throws(() => validateLinuxRgProfile({}, { platform: "darwin", arch: "arm64" }));
});

test("decompression admits only existing pinned xz and supplies clean arguments/environment", async () => {
  const state = await prepare(fixture());
  const tool = Buffer.from("fake existing tool identity, never executed");
  await state.fileSystem.writeFile("/job/xz", tool, { mode: 0o755 });
  const xz = { path: "/job/xz", size: tool.length, sha256: sha256(tool) };
  const bytes = archive();
  let launches = 0;
  function launch(executable, args, options) {
    launches += 1;
    assert.equal(executable, xz.path);
    assert.deepEqual(args, ["--decompress", "--stdout", "--memlimit-decompress=128MiB"]);
    assert.deepEqual(options.env, { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", HOME: "/job", TMPDIR: "/job" });
    assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit("close", null, "SIGKILL")); return true; };
    child.stdin.on("data", received => assert.deepEqual(received, bytes));
    queueMicrotask(() => { child.stdout.end(bytes); child.emit("close", 0, null); });
    return child;
  }
  assert.deepEqual(await inflateArchive(bytes, { format: "xz" }, { xz, root: "/job", fileSystem: state.fileSystem, spawn: launch }), bytes);
  assert.equal(launches, 1);
  await assert.rejects(inflateArchive(bytes, { format: "xz" }, { xz: { ...xz, sha256: "0".repeat(64) }, root: "/job", fileSystem: state.fileSystem, spawn: launch }), /SHA-256 mismatch/u);
  assert.equal(launches, 1);
});

test("xz failure and stderr overflow kill/settle the child without accepting output", async context => {
  for (const kind of ["exit", "stderr", "launch", "timeout", "output"]) await context.test(kind, async () => {
    const state = await prepare(fixture());
    const tool = Buffer.from("mock xz");
    await state.fileSystem.writeFile("/job/xz", tool, { mode: 0o755 });
    let killed = false;
    const launch = () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => { killed = true; queueMicrotask(() => child.emit("close", null, "SIGKILL")); return true; };
      queueMicrotask(() => {
        if (kind === "exit") child.emit("close", 2, null);
        if (kind === "stderr") child.stderr.write(Buffer.alloc(65537));
        if (kind === "launch") child.emit("error", new Error("launch refused"));
        if (kind === "output") child.stdout.write(Buffer.alloc(1025));
      });
      return child;
    };
    await assert.rejects(inflateArchive(Buffer.from("compressed"), { format: "xz" }, { xz: { path: "/job/xz", size: tool.length, sha256: sha256(tool) }, root: "/job", fileSystem: state.fileSystem, spawn: launch, timeoutMs: 10, maxInflatedBytes: 1024 }));
    assert.equal(killed, kind !== "exit");
  });
});

test("gzip decoding is bounded and never spawns an archive executable", async () => {
  const bytes = archive();
  assert.deepEqual(await inflateArchive(gzipSync(bytes), { format: "gzip" }, { spawn: () => assert.fail("gzip spawned") }), bytes);
  await assert.rejects(inflateArchive(gzipSync(bytes), { format: "gzip" }, { maxInflatedBytes: 1024 }));
});

test("CLI rejects omitted prerequisites, duplicate/unknown arguments and package output", async () => {
  await assert.rejects(main([]), /parent/u);
  await assert.rejects(main(["--parent", "/job", "--parent", "/other"]), /duplicate/u);
  await assert.rejects(main(["--execute-rg"]), /unknown/u);
  await assert.rejects(main(["--parent", "/job"]), /xz/u);
});

function gzipFixture(state) {
  const compressed = gzipSync(archive());
  const gzipSource = { ...state.input, url: "https://ftp.gnu.org/gnu/coreutils/fixture.tar.gz", archiveName: "fixture.tar.gz", format: "gzip", size: compressed.length, sha256: sha256(compressed) };
  const fetches = [];
  state.dependencies.fetch = async url => {
    fetches.push(url);
    return new Response(url === gzipSource.url ? compressed : archive());
  };
  state.dependencies.inflate = async (bytes, input) => {
    assert.equal(input.format, "gzip");
    state.calls.push("gzip");
    return inflateArchive(bytes, input, { spawn: () => assert.fail("gzip source spawned") });
  };
  state.dependencies.spawn = () => assert.fail("gzip source spawned");
  return { gzipSource, fetches };
}

async function stagingFixture() {
  const state = await prepare(fixture());
  const packageRoot = "/repo/packages/safe-bash";
  const destination = `${packageRoot}/tests/commands/metadata-stress/.oracle`;
  await state.fileSystem.mkdir(`${packageRoot}/tests/commands/metadata-stress`, { recursive: true, mode: 0o755 });
  const sourceRoot = "/job/verified";
  await state.fileSystem.mkdir(sourceRoot, { mode: 0o700 });
  const contents = new Map([[COREUTILS_INPUT.archiveName, Buffer.from("retained synthetic xz")]]);
  for (const member of COREUTILS_INPUT.members) contents.set(member.output, Buffer.from(`synthetic ${member.output}\n`));
  const coreutilsInput = { ...COREUTILS_INPUT, size: contents.get(COREUTILS_INPUT.archiveName).length, sha256: sha256(contents.get(COREUTILS_INPUT.archiveName)), members: COREUTILS_INPUT.members.map(member => ({ ...member, size: contents.get(member.output).length, sha256: sha256(contents.get(member.output)) })) };
  for (const [name, bytes] of contents) {
    const parent = name.slice(0, name.lastIndexOf("/"));
    if (name.includes("/")) await state.fileSystem.mkdir(`${sourceRoot}/${parent}`, { recursive: true, mode: 0o700 });
    await state.fileSystem.writeFile(`${sourceRoot}/${name}`, bytes, { mode: 0o644 });
  }
  return { ...state, sourceRoot, packageRoot, destination, contents, coreutilsInput, stageDependencies: { fileSystem: state.fileSystem, uid: process.getuid(), coreutilsInput } };
}

test("gzip source pin is official and preserves every existing member pin", () => {
  const input = sourceBootstrap.COREUTILS_GZIP_INPUT;
  assert.equal(input.url, "https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.gz");
  assert.equal(input.size, 15107617);
  assert.equal(input.sha256, "0898a90191c828e337d5e4e4feb71f8ebb75aacac32c434daf5424cda16acb42");
  assert.equal(input.format, "gzip");
  assert.deepEqual(input.members, COREUTILS_INPUT.members);
  assert(Object.isFrozen(input));
});

test("explicit gzip mode retains xz but obtains members only from authenticated gzip", async () => {
  const state = await prepare(fixture());
  const { gzipSource, fetches } = gzipFixture(state);
  const result = await provisionInputs({ parent: "/job", inputs: [state.input], sourceMode: "gzip", gzipSource }, state.dependencies);
  assert.equal(result.sourceMode, "gzip");
  assert.equal(result.extractor, null);
  assert.deepEqual(fetches, [state.input.url, gzipSource.url]);
  assert.deepEqual(state.calls, ["gzip"]);
  assert.deepEqual(result.inputs.map(input => input.url), fetches);
  assert.deepEqual(await state.fileSystem.readFile(`${result.root}/${state.input.archiveName}`), archive());
  assert.deepEqual(await state.fileSystem.readFile(`${result.root}/${members[0].output}`), payload);
  assert.deepEqual(result.outputs.map(output => output.path), [state.input.archiveName, members[0].output]);
  await assert.rejects(state.fileSystem.lstat(`${result.root}/${gzipSource.archiveName}`), { code: "ENOENT" });
});

test("gzip mode rejects either archive authentication failure before inflation", async context => {
  for (const target of ["xz", "gzip"]) await context.test(target, async () => {
    const state = await prepare(fixture());
    const { gzipSource } = gzipFixture(state);
    const fetcher = state.dependencies.fetch;
    state.dependencies.fetch = url => url === (target === "xz" ? state.input.url : gzipSource.url) ? new Response("wrong") : fetcher(url);
    await assert.rejects(provisionInputs({ parent: "/job", inputs: [state.input], sourceMode: "gzip", gzipSource }, state.dependencies));
    assert.deepEqual(state.calls, []);
    assert.deepEqual(await state.fileSystem.readdir("/job"), []);
  });
});

test("gzip failure never falls back to an xz subprocess", async () => {
  const state = await prepare(fixture());
  const { gzipSource } = gzipFixture(state);
  state.dependencies.inflate = async () => { throw new Error("gzip refused"); };
  await assert.rejects(provisionInputs({ parent: "/job", inputs: [state.input], sourceMode: "gzip", gzipSource }, state.dependencies), /gzip refused/u);
  assert.deepEqual(await state.fileSystem.readdir("/job"), []);
});

test("source mode and cross-archive member agreement are checked before fetch", async context => {
  for (const kind of ["mode", "null-mode", "xz-in-gzip", "gzip-in-xz", "prefix", "member", "retained-format"]) await context.test(kind, async () => {
    const state = await prepare(fixture());
    const { gzipSource } = gzipFixture(state);
    const options = { parent: "/job", inputs: [state.input], sourceMode: "gzip", gzipSource };
    if (kind === "mode") options.sourceMode = "auto";
    if (kind === "null-mode") { options.sourceMode = null; delete options.gzipSource; }
    if (kind === "xz-in-gzip") options.xz = { path: "/ambient/xz" };
    if (kind === "gzip-in-xz") options.sourceMode = "xz";
    if (kind === "prefix") options.gzipSource = { ...gzipSource, prefix: "other" };
    if (kind === "member") options.gzipSource = { ...gzipSource, members: [{ ...members[0], sha256: "0".repeat(64) }] };
    if (kind === "retained-format") options.inputs = [{ ...state.input, format: "gzip" }];
    let fetches = 0;
    state.dependencies.fetch = () => { fetches += 1; assert.fail("invalid mode fetched"); };
    await assert.rejects(provisionInputs(options, state.dependencies));
    assert.equal(fetches, 0);
  });
});

test("CLI mode is explicit with legacy xz compatibility and optional exact staging", () => {
  const parse = sourceBootstrap.parseProvisionArguments;
  const legacy = ["--parent", "/job", "--xz", "/tools/xz", "--xz-size", "1", "--xz-sha256", "a".repeat(64)];
  assert.equal(parse(legacy).sourceMode, "xz");
  assert.deepEqual(parse([...legacy, "--source-mode", "xz"]), parse(legacy));
  const gzip = parse(["--parent", "/job", "--source-mode", "gzip", "--stage-metadata"]);
  assert.equal(gzip.sourceMode, "gzip");
  assert.equal(gzip.xz, undefined);
  assert.equal(gzip.stageMetadata, true);
  assert.equal(parse([...legacy, "--include-linux-rg"]).includeLinuxRg, true);
  for (const args of [
    ["--parent", "/job", "--source-mode", "auto"],
    [...legacy, "--source-mode", "gzip"],
    ["--parent", "/job", "--source-mode", "gzip", "--xz-size", "1"],
    ["--parent", "/job", "--source-mode", "gzip", "--source-mode", "gzip"],
    ["--parent", "/job", "--source-mode", "gzip", "--stage-metadata", "--stage-metadata"],
    ["--parent", "/job", "--source-mode", "gzip", "--destination", "/arbitrary"],
  ]) assert.throws(() => parse(args));
});

test("staging materializes only seven fixed authenticated outputs in a new private destination", async () => {
  const state = await stagingFixture();
  await state.fileSystem.writeFile(`${state.sourceRoot}/unrelated`, "must not copy");
  const result = await sourceBootstrap.stageMetadataInputs(state, state.stageDependencies);
  assert.equal(result.status, "METADATA_INPUTS_STAGED_NOT_QUALIFIED");
  assert.equal(result.destination, state.destination);
  assert.equal(result.outputs.length, 7);
  assert.equal((await state.fileSystem.stat(state.destination)).mode & 0o777, 0o700);
  for (const [name, bytes] of state.contents) {
    assert.deepEqual(await state.fileSystem.readFile(`${state.destination}/${name}`), bytes);
    assert.equal((await state.fileSystem.stat(`${state.destination}/${name}`)).mode & 0o777, 0o644);
  }
  assert.deepEqual((await state.fileSystem.readdir(state.destination)).sort(), ["coreutils-9.7", "coreutils-9.7.tar.xz"]);
  await assert.rejects(state.fileSystem.lstat(`${state.destination}/unrelated`), { code: "ENOENT" });
});

test("staging never overwrites an existing destination of any type", async context => {
  for (const kind of ["directory", "file", "symlink"]) await context.test(kind, async () => {
    const state = await stagingFixture();
    if (kind === "directory") await state.fileSystem.mkdir(state.destination, { mode: 0o700 });
    if (kind === "file") await state.fileSystem.writeFile(state.destination, "keep");
    if (kind === "symlink") await state.fileSystem.symlink(state.sourceRoot, state.destination);
    const before = await state.fileSystem.lstat(state.destination);
    await assert.rejects(sourceBootstrap.stageMetadataInputs(state, state.stageDependencies));
    assert.equal((await state.fileSystem.lstat(state.destination)).ino, before.ino);
  });
});

test("staging rejects aliased unsafe or non-owned roots and parents", async context => {
  for (const kind of ["source-alias", "package-alias", "source-mode", "source-owner", "target-parent-mode", "target-parent-alias", "relative", "traversal"]) await context.test(kind, async () => {
    const state = await stagingFixture();
    if (kind === "source-alias") { await state.fileSystem.symlink(state.sourceRoot, "/job/alias"); state.sourceRoot = "/job/alias"; }
    if (kind === "package-alias") { await state.fileSystem.symlink(state.packageRoot, "/repo/alias"); state.packageRoot = "/repo/alias"; }
    if (kind === "source-mode") await state.fileSystem.chmod(state.sourceRoot, 0o755);
    if (kind === "source-owner") await state.fileSystem.chown(state.sourceRoot, process.getuid() + 1, process.getgid());
    if (kind === "target-parent-mode") await state.fileSystem.chmod(`${state.packageRoot}/tests/commands/metadata-stress`, 0o777);
    if (kind === "target-parent-alias") { await state.fileSystem.rename(`${state.packageRoot}/tests/commands/metadata-stress`, "/repo/metadata"); await state.fileSystem.symlink("/repo/metadata", `${state.packageRoot}/tests/commands/metadata-stress`); }
    if (kind === "relative") state.sourceRoot = "job/verified";
    if (kind === "traversal") state.sourceRoot = "/job/../job/verified";
    await assert.rejects(sourceBootstrap.stageMetadataInputs(state, state.stageDependencies));
    await assert.rejects(state.fileSystem.lstat(state.destination), { code: "ENOENT" });
  });
});

test("every staged input is verified before destination creation", async context => {
  for (const kind of ["missing", "size", "hash", "mode", "owner", "symlink", "directory", "hardlink", "ancestor-alias"]) await context.test(kind, async () => {
    const state = await stagingFixture();
    const name = `${state.sourceRoot}/coreutils-9.7/doc/coreutils.texi`;
    if (kind === "missing") await state.fileSystem.unlink(name);
    if (kind === "size") await state.fileSystem.writeFile(name, "short");
    if (kind === "hash") await state.fileSystem.writeFile(name, Buffer.alloc(state.contents.get("coreutils-9.7/doc/coreutils.texi").length));
    if (kind === "mode") await state.fileSystem.chmod(name, 0o666);
    if (kind === "owner") await state.fileSystem.chown(name, process.getuid() + 1, process.getgid());
    if (kind === "symlink") { await state.fileSystem.rename(name, "/job/outside"); await state.fileSystem.symlink("/job/outside", name); }
    if (kind === "directory") { await state.fileSystem.unlink(name); await state.fileSystem.mkdir(name); }
    if (kind === "hardlink") await state.fileSystem.link(name, "/job/link");
    if (kind === "ancestor-alias") { await state.fileSystem.rename(`${state.sourceRoot}/coreutils-9.7/doc`, "/job/doc"); await state.fileSystem.symlink("/job/doc", `${state.sourceRoot}/coreutils-9.7/doc`); }
    await assert.rejects(sourceBootstrap.stageMetadataInputs(state, state.stageDependencies));
    await assert.rejects(state.fileSystem.lstat(state.destination), { code: "ENOENT" });
  });
});

test("staging rejects widened or traversing output declarations", async () => {
  for (const kind of ["archive", "member", "extra"]) {
    const state = await stagingFixture();
    if (kind === "archive") state.coreutilsInput.archiveName = "../outside";
    if (kind === "member") state.coreutilsInput.members[0].output = "coreutils-9.7/../../outside";
    if (kind === "extra") state.coreutilsInput.members.push({ ...state.coreutilsInput.members[0] });
    await assert.rejects(sourceBootstrap.stageMetadataInputs(state, state.stageDependencies));
    await assert.rejects(state.fileSystem.lstat(state.destination), { code: "ENOENT" });
  }
});

test("partial staging failure cleans only its exclusive outputs and permits retry", async () => {
  const state = await stagingFixture();
  const open = state.fileSystem.open.bind(state.fileSystem);
  state.fileSystem.open = async (name, flags, mode) => {
    const handle = await open(name, flags, mode);
    if (name === `${state.destination}/coreutils-9.7/src/stat.c` && (flags & constants.O_WRONLY)) handle.writeFile = async () => { throw new Error("injected partial write"); };
    return handle;
  };
  await assert.rejects(sourceBootstrap.stageMetadataInputs(state, state.stageDependencies), /injected partial write/u);
  await assert.rejects(state.fileSystem.lstat(state.destination), { code: "ENOENT" });
  for (const [name, bytes] of state.contents) assert.deepEqual(await state.fileSystem.readFile(`${state.sourceRoot}/${name}`), bytes);
  state.fileSystem.open = open;
  assert.equal((await sourceBootstrap.stageMetadataInputs(state, state.stageDependencies)).outputs.length, 7);
});

test("staging preserves success, single failures and combined write/close identities", async context => {
  const outcomes = [
    { name: "success", failed: false },
    { name: "Error", failed: true, reason: new Error("injected I/O failure") },
    ...[undefined, null, false, 0, ""].map(reason => ({ name: `${typeof reason}:${String(reason)}`, failed: true, reason })),
  ];
  for (const primary of outcomes) for (const closing of outcomes) await context.test(`write ${primary.name}; close ${closing.name}`, async () => {
    const state = await stagingFixture();
    const open = state.fileSystem.open.bind(state.fileSystem);
    const handles = new Set();
    const target = `${state.destination}/${COREUTILS_INPUT.members[1].output}`;
    const primaryReason = primary.reason instanceof Error ? new Error("write ENOSPC") : primary.reason;
    const closeReason = closing.reason instanceof Error ? new Error("close EIO") : closing.reason;
    let closeCalls = 0;
    state.fileSystem.open = async (name, flags, mode) => {
      const handle = await open(name, flags, mode);
      handles.add(handle);
      const selected = name === target && (flags & constants.O_WRONLY);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        assert(handles.has(handle), "handle must close exactly once");
        await close();
        handles.delete(handle);
        if (selected) {
          closeCalls++;
          if (closing.failed) throw closeReason;
        }
      };
      if (selected && primary.failed) {
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async bytes => { await write(bytes.subarray(0, 1)); throw primaryReason; };
      }
      return handle;
    };
    const outcome = await sourceBootstrap.stageMetadataInputs(state, state.stageDependencies).then(
      value => ({ failed: false, value }),
      error => ({ failed: true, error }),
    );
    assert.equal(handles.size, 0);
    assert.equal(closeCalls, 1);
    assert.equal(outcome.failed, primary.failed || closing.failed);
    if (outcome.failed) {
      await assert.rejects(state.fileSystem.lstat(state.destination), { code: "ENOENT" });
      assert.deepEqual(await state.fileSystem.readdir(`${state.packageRoot}/tests/commands/metadata-stress`), []);
    } else {
      assert.equal(outcome.value.status, "METADATA_INPUTS_STAGED_NOT_QUALIFIED");
      assert.equal(outcome.value.outputs.length, 7);
    }
    for (const [name, bytes] of state.contents) assert.deepEqual(await state.fileSystem.readFile(`${state.sourceRoot}/${name}`), bytes);
    if (primary.failed && closing.failed) {
      assert(outcome.error instanceof AggregateError);
      assert.equal(outcome.error.errors.length, 2);
      assert(Object.is(outcome.error.errors[0], primaryReason));
      assert(Object.is(outcome.error.errors[1], closeReason));
    } else if (outcome.failed) assert(Object.is(outcome.error, primary.failed ? primaryReason : closeReason));
  });
});

test("staging awaits close and owned cleanup before rejecting combined failures", { timeout: 5000 }, async () => {
  const state = await stagingFixture();
  const primary = new Error("write ENOSPC");
  const closing = new Error("close EIO");
  const open = state.fileSystem.open.bind(state.fileSystem);
  const unlink = state.fileSystem.unlink.bind(state.fileSystem);
  let signalClose;
  let releaseClose;
  let signalCleanup;
  let releaseCleanup;
  const closeEntered = new Promise(resolve => { signalClose = resolve; });
  const closeGate = new Promise(resolve => { releaseClose = resolve; });
  const cleanupEntered = new Promise(resolve => { signalCleanup = resolve; });
  const cleanupGate = new Promise(resolve => { releaseCleanup = resolve; });
  let closed = false;
  let cleanupStarted = false;
  let settled = false;
  state.fileSystem.open = async (name, flags, mode) => {
    const handle = await open(name, flags, mode);
    if (name === `${state.destination}/${COREUTILS_INPUT.members[1].output}` && (flags & constants.O_WRONLY)) {
      handle.writeFile = async () => { throw primary; };
      const close = handle.close.bind(handle);
      handle.close = async () => {
        signalClose();
        await closeGate;
        await close();
        closed = true;
        throw closing;
      };
    }
    return handle;
  };
  state.fileSystem.unlink = async name => {
    cleanupStarted = true;
    signalCleanup();
    await cleanupGate;
    return unlink(name);
  };
  const result = sourceBootstrap.stageMetadataInputs(state, state.stageDependencies).then(
    value => ({ failed: false, value }),
    error => ({ failed: true, error }),
  ).finally(() => { settled = true; });
  try {
    await closeEntered;
    assert.equal(settled, false);
    assert.equal(cleanupStarted, false);
    assert.equal(closed, false);
    releaseClose();
    await cleanupEntered;
    assert.equal(closed, true);
    assert.equal(settled, false);
    releaseCleanup();
    const outcome = await result;
    assert.equal(outcome.failed, true);
    await assert.rejects(state.fileSystem.lstat(state.destination), { code: "ENOENT" });
    assert(outcome.error instanceof AggregateError);
    assert.equal(outcome.error.errors.length, 2);
    assert.equal(outcome.error.errors[0], primary);
    assert.equal(outcome.error.errors[1], closing);
  } finally {
    releaseClose();
    releaseCleanup();
    await result;
  }
});

test("staging collision preserves foreign data instead of recursively deleting it", async () => {
  const state = await stagingFixture();
  const open = state.fileSystem.open.bind(state.fileSystem);
  let inserted = false;
  state.fileSystem.open = async (name, flags, mode) => {
    if (!inserted && name === `${state.destination}/coreutils-9.7/src/stat.c` && (flags & constants.O_WRONLY)) {
      inserted = true;
      assert(flags & constants.O_EXCL);
      assert(flags & constants.O_NOFOLLOW);
      await state.fileSystem.writeFile(name, "foreign sentinel");
    }
    return open(name, flags, mode);
  };
  await assert.rejects(sourceBootstrap.stageMetadataInputs(state, state.stageDependencies), /cleanup/u);
  assert.equal(await state.fileSystem.readFile(`${state.destination}/coreutils-9.7/src/stat.c`, "utf8"), "foreign sentinel");
});

test("staging destination replacement refuses cleanup of the substitute", async () => {
  const state = await stagingFixture();
  const open = state.fileSystem.open.bind(state.fileSystem);
  let replaced = false;
  state.fileSystem.open = async (name, flags, mode) => {
    const handle = await open(name, flags, mode);
    if (!replaced && name.startsWith(`${state.destination}/`) && (flags & constants.O_WRONLY)) {
      replaced = true;
      await state.fileSystem.rename(state.destination, "/repo/moved");
      await state.fileSystem.mkdir(state.destination, { mode: 0o700 });
      await state.fileSystem.writeFile(`${state.destination}/keep`, "foreign");
    }
    return handle;
  };
  await assert.rejects(sourceBootstrap.stageMetadataInputs(state, state.stageDependencies), /cleanup/u);
  assert.equal(await state.fileSystem.readFile(`${state.destination}/keep`, "utf8"), "foreign");
});

test("staging snapshots caller paths and identity declarations before await", async () => {
  const state = await stagingFixture();
  const lstat = state.fileSystem.lstat.bind(state.fileSystem);
  let mutated = false;
  state.fileSystem.lstat = async name => {
    if (!mutated) {
      mutated = true;
      state.sourceRoot = "/unvalidated";
      state.packageRoot = "/unvalidated";
      state.coreutilsInput.members[0].sha256 = "0".repeat(64);
    }
    return lstat(name);
  };
  const result = await sourceBootstrap.stageMetadataInputs(state, state.stageDependencies);
  assert.equal(result.sourceRoot, "/job/verified");
  assert.equal(result.destination, state.destination);
  assert.equal(result.outputs[1].sha256, sha256(state.contents.get(COREUTILS_INPUT.members[0].output)));
});

test("source fetch has a finite empty-chunk budget and closes rejected streams", async () => {
  let reads = 0;
  let closed = false;
  const response = {
    status: 200,
    headers: new Headers(),
    body: (async function* () {
      try {
        for (let index = 0; index < 16385; index += 1) { reads += 1; yield Buffer.alloc(0); }
      } finally { closed = true; }
    })(),
  };
  await assert.rejects(fetchVerified({ url: "https://ftp.gnu.org/input", size: 1, sha256: sha256("x") }, { fetch: async () => response }), /chunk-read/u);
  assert.equal(reads, 16385);
  assert.equal(closed, true);
});
