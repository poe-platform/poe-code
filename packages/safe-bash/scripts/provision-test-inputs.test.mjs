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
    header.write(`${(entry.mode ?? 0o644).toString(8).padStart(7, "0")}\0`, 100);
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

async function gnuBuildFixture() {
  const state = await prepare(fixture());
  const { fileSystem } = state;
  await fileSystem.mkdir("/sources", { mode: 0o700 });
  await fileSystem.mkdir("/tools", { mode: 0o755 });
  const host = { platform: "linux", arch: "x64", release: "fixture-kernel", node: process.version };
  const toolchain = { id: "reviewed-fixture-toolchain", host, provenance: "fixture image and library closure", searchPath: ["/tools"], tools: {} };
  for (const name of ["xz", "shell", "make", "cc"]) {
    const bytes = Buffer.from(`fixture tool ${name}`);
    const path = `/tools/${name}`;
    await fileSystem.writeFile(path, bytes, { mode: 0o755 });
    toolchain.tools[name] = { path, size: bytes.length, sha256: sha256(bytes), ...(name === "shell" ? {} : { version: `fixture ${name} 1` }) };
  }
  const sources = [
    { name: "diffutils", version: "3.12", binary: "diff", versionLine: "diff (GNU diffutils) 3.12" },
    { name: "patch", version: "2.8", binary: "patch", versionLine: "GNU patch 2.8" },
  ].map(source => {
    const prefix = `${source.name}-${source.version}`;
    const bytes = archive([
      { name: `${prefix}/`, type: "5" },
      { name: `${prefix}/configure`, bytes: Buffer.from("fixture configure"), mode: 0o755 },
      { name: `${prefix}/src/input.c`, bytes: payload },
    ]);
    return { ...source, prefix, sha256: sha256(bytes), bytes };
  });
  for (const source of sources) await fileSystem.writeFile(`/sources/${source.prefix}.tar.xz`, source.bytes, { mode: 0o600 });
  const launches = [];
  const groups = new Map();
  const signals = [];
  let nextPid = 100;
  const controls = { async beforeStep() {}, async afterStep() {} };
  const dependencies = {
    fileSystem, uid: process.getuid(), host, sources,
    limits: { stepTimeoutMs: 1000, cleanupTimeoutMs: 100, outputBytes: 65536 },
    killGroup(pid, signal) {
      const group = groups.get(pid);
      if (!group) throw Object.assign(new Error("absent group"), { code: "ESRCH" });
      if (signal === 0) return;
      signals.push([pid, signal]);
      queueMicrotask(() => group.finish(null, signal));
    },
    spawn(command, args, options) {
      const child = Object.assign(new EventEmitter(), { pid: nextPid++, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
      const call = { command, args, options, child, finish(code = 0, signal = null) {
        groups.delete(child.pid);
        child.stdout.end(); child.stderr.end();
        child.emit("close", code, signal);
      } };
      groups.set(child.pid, call);
      launches.push(call);
      const input = [];
      child.stdin.on("data", chunk => input.push(Buffer.from(chunk)));
      queueMicrotask(async () => {
        try {
          if (await controls.beforeStep(call) === false) return;
          if (args[0] === "--version") {
            const tool = Object.values(toolchain.tools).find(item => item.path === command);
            const source = sources.find(item => command.endsWith(`/src/${item.binary}`));
            child.stdout.write(`${tool?.version ?? source.versionLine}\n`);
          } else if (command === toolchain.tools.xz.path) {
            child.stdout.write(Buffer.concat(input));
          } else if (command === toolchain.tools.make.path) {
            const source = sources.find(item => options.cwd.endsWith(`/${item.prefix}`));
            await fileSystem.writeFile(`${options.cwd}/src/${source.binary}`, `fixture built ${source.binary}`, { mode: 0o700 });
          }
          if (await controls.afterStep(call) !== false) call.finish();
        } catch (error) { child.emit("error", error); call.finish(1); }
      });
      return child;
    },
  };
  return { ...state, host, toolchain, sources, launches, groups, signals, controls, dependencies, options: { parent: "/job", sourceRoot: "/sources", toolchain } };
}

test("GNU build keeps fixed source pins and the source-only recipe separate", () => {
  assert.deepEqual(sourceBootstrap.GNU_BUILD_SOURCES.map(source => [source.prefix, source.sha256]), [
    ["diffutils-3.12", "7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd"],
    ["patch-2.8", "f87cee69eec2b4fcbf60a396b030ad6aa3415f192aa5f7ee84cad5e11f7f5ae3"],
  ]);
  assert.equal(COREUTILS_INPUT.members.length, 6);
});

test("GNU full-tree extraction retains all regular members and executable intent", () => {
  const entries = sourceBootstrap.extractGnuSourceTree(archive([
    { name: "source/", type: "5" },
    { name: "source/configure", bytes: payload, mode: 0o755 },
    { name: "source/sub/input.c", bytes: Buffer.alloc(0) },
  ]), "source");
  assert.deepEqual(entries.map(entry => [entry.path, entry.mode]), [["source", 0o700], ["source/configure", 0o700], ["source/sub/input.c", 0o600]]);
  assert.deepEqual(entries[1].bytes, payload);
});

test("GNU full-tree extraction rejects unsafe or ambiguous trees", async context => {
  for (const [name, entries] of [
    ["traversal", [{ name: "source/../outside" }]],
    ["outside", [{ name: "outside/file" }]],
    ["symlink", [{ name: "source/link", type: "2" }]],
    ["hardlink", [{ name: "source/link", type: "1" }]],
    ["extension", [{ name: "source/pax", type: "x" }]],
    ["directory payload", [{ name: "source/dir", type: "5", bytes: payload }]],
    ["duplicate", [{ name: "source/file" }, { name: "source/file" }]],
    ["file ancestor", [{ name: "source/file" }, { name: "source/file/child" }]],
    ["late file ancestor", [{ name: "source/file/child" }, { name: "source/file" }]],
    ["privileged mode", [{ name: "source/file", mode: 0o4755 }]],
  ]) await context.test(name, () => assert.throws(() => sourceBootstrap.extractGnuSourceTree(archive(entries), "source")));
});

test("GNU producer binds observed outputs to supervised sources, recipe and toolchain without native parity claims", async () => {
  const state = await gnuBuildFixture();
  const result = await sourceBootstrap.provisionGnuBuild(state.options, state.dependencies);
  assert.equal(result.status, "GNU_SOURCE_BUILD_COMPLETED_NOT_QUALIFIED");
  assert.equal(result.reproducibility, "NOT_ESTABLISHED");
  assert.equal(result.behavioralQualification, "NOT_RUN");
  assert.equal(result.receiptAuthority, "trusted-caller-supervised-build; not standalone authorization");
  assert.equal(result.sources.length, 2);
  assert.equal(result.outputs.length, 2);
  assert.equal(result.commands.length, 11);
  assert.deepEqual(result.host, state.host);
  assert.equal(result.toolchain.id, state.toolchain.id);
  assert.equal(result.recipe.sha256, sha256(JSON.stringify(result.recipe.definition)));
  assert.equal(state.groups.size, 0);
  for (const output of result.outputs) assert.equal(output.sha256, sha256(await state.fileSystem.readFile(output.path)));
  for (const call of state.launches) {
    assert.equal(call.options.detached, true);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.env.CC, "/tools/cc");
    assert.equal(call.options.env.LC_ALL, "C");
    assert.equal(call.options.env.PATH, "/tools");
    assert(call.options.env.HOME.startsWith(`${result.root}/`));
  }
  assert.deepEqual((await state.fileSystem.readdir(result.root)).sort(), ["diffutils-3.12", "home", "patch-2.8", "tmp"]);
});

test("GNU producer rejects host, source and toolchain drift before any child launch", async context => {
  for (const kind of ["host", "source", "tool", "tool mode", "toolchain host"]) await context.test(kind, async () => {
    const state = await gnuBuildFixture();
    if (kind === "host") state.dependencies.host = { ...state.host, platform: "darwin" };
    if (kind === "source") await state.fileSystem.writeFile("/sources/patch-2.8.tar.xz", "bad source");
    if (kind === "tool") state.options.toolchain.tools.cc.sha256 = "0".repeat(64);
    if (kind === "tool mode") await state.fileSystem.chmod("/tools/cc", 0o777);
    if (kind === "toolchain host") state.options.toolchain = { ...state.toolchain, host: { ...state.host, release: "different" } };
    await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies));
    assert.equal(state.launches.length, 0);
    assert.deepEqual(await state.fileSystem.readdir("/job"), []);
  });
});

test("GNU producer kills and settles failed process groups before removing its destination", async context => {
  for (const kind of ["exit", "timeout", "overflow"]) await context.test(kind, async () => {
    const state = await gnuBuildFixture();
    state.dependencies.limits.stepTimeoutMs = 15;
    state.controls.beforeStep = call => {
      if (call.command !== "/tools/make" || call.args[0] !== "-j2") return;
      if (kind === "exit") call.finish(2);
      if (kind === "overflow") call.child.stderr.write(Buffer.alloc(65537));
      return false;
    };
    await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies));
    assert.equal(state.groups.size, 0);
    if (kind !== "exit") assert(state.signals.some(([, signal]) => signal === "SIGKILL"));
    assert.deepEqual(await state.fileSystem.readdir("/job"), []);
  });
});

async function gnuBuildCliFixture() {
  const state = await gnuBuildFixture();
  const bytes = Buffer.from(JSON.stringify(state.toolchain));
  await state.fileSystem.writeFile("/sources/toolchain.json", bytes, { mode: 0o600 });
  return { ...state, args: ["--build-gnu", "--parent", "/job", "--sources", "/sources", "--toolchain", "/sources/toolchain.json", "--toolchain-size", String(bytes.length), "--toolchain-sha256", sha256(bytes)] };
}

test("GNU CLI requires explicit pinned toolchain input and never enters default downloading", async () => {
  const state = await gnuBuildCliFixture();
  state.dependencies.fetch = () => assert.fail("GNU CLI must not download");
  const result = await main(state.args, state.dependencies);
  assert.equal(result.status, "GNU_SOURCE_BUILD_COMPLETED_NOT_QUALIFIED");
  assert.equal(result.toolchain.tools.cc.version, "fixture cc 1");
  assert.equal(result.commands.length, 11);
  assert.equal(state.groups.size, 0);
});

test("GNU CLI rejects malformed flags and unauthenticated toolchain JSON before spawning", async context => {
  for (const kind of ["missing", "duplicate", "metadata flag", "relative", "large descriptor", "descriptor hash", "descriptor symlink", "receipt JSON"]) await context.test(kind, async () => {
    const state = await gnuBuildCliFixture();
    if (kind === "missing") state.args.splice(3, 2);
    if (kind === "duplicate") state.args.push("--parent", "/other");
    if (kind === "metadata flag") state.args.push("--stage-metadata");
    if (kind === "relative") state.args[6] = "toolchain.json";
    if (kind === "large descriptor") state.args[8] = "65537";
    if (kind === "descriptor hash") state.args[10] = "0".repeat(64);
    if (kind === "descriptor symlink") {
      await state.fileSystem.rename("/sources/toolchain.json", "/sources/actual.json");
      await state.fileSystem.symlink("/sources/actual.json", "/sources/toolchain.json");
    }
    if (kind === "receipt JSON") {
      const bytes = Buffer.from(JSON.stringify({ status: "GNU_SOURCE_BUILD_COMPLETED_NOT_QUALIFIED", outputs: [], sha256: "0".repeat(64) }));
      await state.fileSystem.writeFile("/sources/toolchain.json", bytes);
      state.args[8] = String(bytes.length); state.args[10] = sha256(bytes);
    }
    state.dependencies.fetch = () => assert.fail("GNU CLI must not download");
    await assert.rejects(main(state.args, state.dependencies));
    assert.equal(state.launches.length, 0);
    assert.deepEqual(await state.fileSystem.readdir("/job"), []);
  });
});

test("GNU producer rejects malformed authority, unsafe roots and extractor aliases before launch", async context => {
  for (const kind of ["receipt option", "recipe override", "extractor alias", "search alias", "search writable", "parent alias", "source alias", "source writable", "tool shell syntax", "wrong version"]) await context.test(kind, async () => {
    const state = await gnuBuildFixture();
    if (kind === "receipt option") state.options.receipt = { status: "accepted" };
    if (kind === "recipe override") state.toolchain.configure = ["unreviewed"];
    if (kind === "extractor alias") {
      await state.fileSystem.rename("/tools/xz", "/tools/actual-xz");
      await state.fileSystem.symlink("/tools/actual-xz", "/tools/xz");
    }
    if (kind === "search alias") { await state.fileSystem.symlink("/tools", "/tool-alias"); state.toolchain.searchPath = ["/tool-alias"]; }
    if (kind === "search writable") await state.fileSystem.chmod("/tools", 0o777);
    if (kind === "parent alias") { await state.fileSystem.symlink("/job", "/job-alias"); state.options.parent = "/job-alias"; }
    if (kind === "source alias") { await state.fileSystem.symlink("/sources", "/source-alias"); state.options.sourceRoot = "/source-alias"; }
    if (kind === "source writable") await state.fileSystem.chmod("/sources", 0o777);
    if (kind === "tool shell syntax") {
      await state.fileSystem.rename("/tools/cc", "/tools/cc;unreviewed");
      state.toolchain.tools.cc.path = "/tools/cc;unreviewed";
    }
    if (kind === "wrong version") state.controls.beforeStep = call => {
      if (call.command === "/tools/xz" && call.args[0] === "--version") {
        call.child.stdout.write("unreviewed xz\n"); call.finish(); return false;
      }
    };
    await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies));
    assert.equal(state.launches.length, kind === "wrong version" ? 1 : 0);
    assert.equal(state.groups.size, 0);
    assert.deepEqual(await state.fileSystem.readdir("/job"), []);
  });
});

test("GNU producer rejects an initially root-owned sticky writable PATH directory before launch", async () => {
  const state = await gnuBuildFixture();
  await state.fileSystem.mkdir("/public", { mode: 0o1777 });
  await state.fileSystem.chown("/public", 0, 0);
  state.toolchain.searchPath.unshift("/public");
  await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies), /writable tool search directory/u);
  assert.equal(state.launches.length, 0);
  assert.equal(state.groups.size, 0);
  assert.deepEqual(await state.fileSystem.readdir("/job"), []);
});

test("GNU producer rejects a root-owned PATH directory becoming sticky writable after the first step", async () => {
  const state = await gnuBuildFixture();
  await state.fileSystem.chown("/tools", 0, 0);
  state.controls.afterStep = async call => {
    if (call.command === "/tools/xz" && call.args[0] === "--version") await state.fileSystem.chmod("/tools", 0o1777);
  };
  await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies), /writable tool search directory/u);
  assert.equal(state.launches.length, 1);
  assert.equal(state.launches[0].command, "/tools/xz");
  assert.deepEqual(state.launches[0].args, ["--version"]);
  assert.equal(state.groups.size, 0);
  assert.deepEqual(await state.fileSystem.readdir("/job"), []);
});

test("GNU producer revalidates tools and owns executable outputs without accepting aliases or hardlinks", async context => {
  for (const kind of ["tool drift", "nonexecutable", "output symlink", "output hardlink", "output version", "late output drift"]) await context.test(kind, async () => {
    const state = await gnuBuildFixture();
    state.controls.afterStep = async call => {
      if (call.command !== "/tools/make" || call.args[0] !== "-j2") return;
      const output = `${call.options.cwd}/src/${call.options.cwd.endsWith("diffutils-3.12") ? "diff" : "patch"}`;
      if (kind === "tool drift") await state.fileSystem.writeFile("/tools/cc", "changed tool");
      if (kind === "nonexecutable") await state.fileSystem.chmod(output, 0o600);
      if (kind === "output symlink") { await state.fileSystem.rename(output, `${output}-actual`); await state.fileSystem.symlink(`${output}-actual`, output); }
      if (kind === "output hardlink") await state.fileSystem.link(output, `${output}-alias`);
      if (kind === "late output drift" && call.options.cwd.endsWith("patch-2.8")) await state.fileSystem.writeFile(`${call.options.cwd.slice(0, -"patch-2.8".length)}diffutils-3.12/src/diff`, "replaced earlier output");
    };
    if (kind === "output version") state.controls.beforeStep = call => {
      if (call.command.endsWith("/src/diff")) { call.child.stdout.write("diff unreviewed\n"); call.finish(); return false; }
    };
    await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies));
    assert.equal(state.groups.size, 0);
    assert.deepEqual(await state.fileSystem.readdir("/job"), []);
  });
});

test("GNU producer refuses a receipt when an extracted source write is corrupted", async () => {
  const state = await gnuBuildFixture();
  const open = state.fileSystem.open.bind(state.fileSystem);
  state.fileSystem.open = async (path, flags, mode) => {
    const handle = await open(path, flags, mode);
    if ((flags & constants.O_WRONLY) && path.endsWith("/configure")) {
      const writeFile = handle.writeFile.bind(handle);
      handle.writeFile = bytes => writeFile(Buffer.alloc(bytes.length, 0));
    }
    return handle;
  };
  await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies), /SHA-256/u);
  assert(!state.launches.some(call => call.command === "/tools/shell"));
  assert.deepEqual(await state.fileSystem.readdir("/job"), []);
});

test("GNU producer rejects surviving descendants and joins cleanup even after a successful leader", async () => {
  const state = await gnuBuildFixture();
  state.controls.beforeStep = call => {
    if (call.command !== "/tools/make" || call.args[0] !== "-j2") return;
    call.child.stdout.end(); call.child.stderr.end(); call.child.emit("close", 0, null);
    return false;
  };
  await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies), /descendant survived/u);
  assert.equal(state.groups.size, 0);
  assert(state.signals.some(([, signal]) => signal === "SIGKILL"));
  assert.deepEqual(await state.fileSystem.readdir("/job"), []);
});

test("GNU producer retains unjoined roots and never issues a receipt after kill refusal", async () => {
  const state = await gnuBuildFixture();
  state.dependencies.limits.stepTimeoutMs = 10;
  state.dependencies.limits.cleanupTimeoutMs = 15;
  state.controls.beforeStep = call => call.command === "/tools/make" && call.args[0] === "-j2" ? false : undefined;
  const killGroup = state.dependencies.killGroup;
  state.dependencies.killGroup = (pid, signal) => {
    if (signal !== 0) throw Object.assign(new Error("kill refused"), { code: "EPERM" });
    return killGroup(pid, signal);
  };
  try {
    await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies), /settlement unproved.*no receipt issued/u);
    const roots = await state.fileSystem.readdir("/job");
    assert.equal(roots.length, 1);
    assert(!(await state.fileSystem.readdir(`/job/${roots[0]}`)).some(name => name.includes("receipt") || name.endsWith(".json")));
  } finally { for (const group of state.groups.values()) group.finish(null, "SIGKILL"); }
  assert.equal(state.groups.size, 0);
});

test("GNU producer refuses cleanup of a replaced root and preserves the replacement", async () => {
  const state = await gnuBuildFixture();
  let replacement;
  state.controls.afterStep = async call => {
    if (call.command !== "/tools/make" || call.args[0] !== "-j2") return;
    replacement = call.options.env.HOME.slice(0, -"/home".length);
    await state.fileSystem.rename(replacement, `${replacement}-original`);
    await state.fileSystem.mkdir(replacement, { mode: 0o700 });
    await state.fileSystem.writeFile(`${replacement}/sentinel`, "foreign replacement");
  };
  await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies), /cleanup refused.*no receipt issued/u);
  assert.equal(await state.fileSystem.readFile(`${replacement}/sentinel`, "utf8"), "foreign replacement");
  assert.equal(state.groups.size, 0);
});

test("GNU source tree rejects checksum, truncation, trailing data and non-UTF8 paths", async context => {
  const valid = archive([{ name: "source/file", bytes: payload }]);
  const checksum = Buffer.from(valid); checksum[0] ^= 1;
  const trailing = Buffer.from(valid); trailing[trailing.length - 1] = 1;
  const invalidName = archive([{ name: "source/file", bytes: payload }]);
  invalidName[7] = 255; invalidName.fill(32, 148, 156);
  const sum = invalidName.subarray(0, 512).reduce((total, value) => total + value, 0);
  invalidName.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  for (const bytes of [checksum, trailing, invalidName, valid.subarray(0, 1024), valid.subarray(0, 513)]) {
    await context.test(`refuse ${sha256(bytes)}`, () => assert.throws(() => sourceBootstrap.extractGnuSourceTree(bytes, "source")));
  }
});

test("GNU producer observes empty source files without accepting empty executables", async () => {
  const state = await gnuBuildFixture();
  const source = state.sources[0];
  source.bytes = archive([{ name: `${source.prefix}/configure`, bytes: payload, mode: 0o755 }, { name: `${source.prefix}/src/empty`, bytes: Buffer.alloc(0) }]);
  source.sha256 = sha256(source.bytes);
  await state.fileSystem.writeFile(`/sources/${source.prefix}.tar.xz`, source.bytes);
  const result = await sourceBootstrap.provisionGnuBuild(state.options, state.dependencies);
  assert.equal((await state.fileSystem.stat(`${result.root}/${source.prefix}/src/empty`)).size, 0);
  const failed = await gnuBuildFixture();
  failed.controls.afterStep = async call => {
    if (call.command === "/tools/make" && call.args[0] === "-j2") await failed.fileSystem.writeFile(`${call.options.cwd}/src/diff`, Buffer.alloc(0));
  };
  await assert.rejects(sourceBootstrap.provisionGnuBuild(failed.options, failed.dependencies), /size bound/u);
  assert.deepEqual(await failed.fileSystem.readdir("/job"), []);
});

test("GNU producer snapshots caller bindings before awaiting input admission", async () => {
  const state = await gnuBuildFixture();
  const lstat = state.fileSystem.lstat.bind(state.fileSystem);
  let changed = false;
  state.fileSystem.lstat = async path => {
    if (!changed) {
      changed = true;
      state.options.parent = "/changed";
      state.options.sourceRoot = "/changed";
      state.toolchain.id = "changed-after-admission";
      state.toolchain.tools.cc.sha256 = "0".repeat(64);
    }
    return lstat(path);
  };
  const result = await sourceBootstrap.provisionGnuBuild(state.options, state.dependencies);
  assert(result.root.startsWith("/job/"));
  assert.equal(result.toolchain.id, "reviewed-fixture-toolchain");
  assert.notEqual(result.toolchain.tools.cc.sha256, "0".repeat(64));
});

test("GNU producer settles launch, stream and signal failures without issuing a receipt", async context => {
  for (const kind of ["launch", "stream", "signal", "stdout bound"]) await context.test(kind, async () => {
    const state = await gnuBuildFixture();
    const launch = state.dependencies.spawn;
    if (kind === "launch") state.dependencies.spawn = () => { throw new Error("injected launch failure"); };
    state.controls.beforeStep = call => {
      if (call.command !== "/tools/make" || call.args[0] !== "-j2") return;
      if (kind === "stream") call.child.stdout.emit("error", new Error("injected stream failure"));
      if (kind === "signal") call.finish(null, "SIGTERM");
      if (kind === "stdout bound") call.child.stdout.write(Buffer.alloc(65537));
      return false;
    };
    await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies));
    assert.equal(state.groups.size, 0);
    assert.deepEqual(await state.fileSystem.readdir("/job"), []);
    state.dependencies.spawn = launch;
  });
});

test("GNU producer closes failed source writers and preserves combined failure identities", async () => {
  const state = await gnuBuildFixture();
  const open = state.fileSystem.open.bind(state.fileSystem);
  const closing = new Error("source close failed");
  let closed = false;
  state.fileSystem.open = async (path, flags, mode) => {
    const handle = await open(path, flags, mode);
    if ((flags & constants.O_WRONLY) && path.endsWith("/configure")) {
      handle.writeFile = async () => { throw undefined; };
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); closed = true; throw closing; };
    }
    return handle;
  };
  await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies), error => {
    assert(error instanceof AggregateError);
    assert.deepEqual(error.errors, [undefined, closing]);
    return true;
  });
  assert.equal(closed, true);
  assert.deepEqual(await state.fileSystem.readdir("/job"), []);
});

test("GNU producer pins its root before chmod and refuses to remove a replacement", async () => {
  const state = await gnuBuildFixture();
  const chmod = state.fileSystem.chmod.bind(state.fileSystem);
  let replacement;
  state.fileSystem.chmod = async (path, mode) => {
    if (!replacement && path.startsWith("/job/safe-bash-gnu-build-")) {
      replacement = path;
      await state.fileSystem.rename(path, `${path}-original`);
      await state.fileSystem.mkdir(path, { mode: 0o700 });
      await state.fileSystem.writeFile(`${path}/sentinel`, "foreign root");
    }
    return chmod(path, mode);
  };
  await assert.rejects(sourceBootstrap.provisionGnuBuild(state.options, state.dependencies), /cleanup refused.*no receipt issued/u);
  assert.equal(await state.fileSystem.readFile(`${replacement}/sentinel`, "utf8"), "foreign root");
  assert.equal(state.launches.length, 0);
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
