import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { fixture, run } from "./helpers.js";

function view(backing: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(backing, { get(target, key) {
    const owner = Object.hasOwn(overrides, key) ? overrides : target;
    const member: unknown = Reflect.get(owner, key);
    return typeof member === "function" ? member.bind(owner) : member;
  } });
}

test("cp --preserve=mode copies bytes and permissions through the agent shell", async () => {
  const fs = await fixture({ input: "abc\n", output: "old\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("chmod 600 input; cp --preserve=mode input output; stat -c %a output");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "600\n");
    assert.deepEqual(await fs.readFile("/work/output"), new TextEncoder().encode("abc\n"));
  } finally { await shell.dispose(); }
});

for (const flag of ["-p", "--preserve", "--preserve=mode,ownership,timestamps"]) {
  test(`cp ${flag} preserves mode and original timestamps`, async () => {
    const fs = await fixture({ input: "new\n", output: "old\n" });
    await fs.chmod("/work/input", 0o640);
    await fs.utimes("/work/input", 1_000, 2_000);
    const result = await run("cp", [flag, "input", "output"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const stat = await fs.stat("/work/output");
    assert.equal(stat.mode & 0o7777, 0o640);
    assert.equal(stat.atimeMs, 1_000);
    assert.equal(stat.mtimeMs, 2_000);
    assert.equal(stat.uid, (await fs.stat("/work/input")).uid);
    assert.equal(stat.gid, (await fs.stat("/work/input")).gid);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "new\n");
  });
}

for (const existing of [false, true]) for (const preserve of [false, true]) {
  test(`cp --attributes-only preserves content, existing=${existing}, preserve=${preserve}`, async () => {
    const backing = await fixture({ input: "new\n", ...(existing ? { output: "old\n" } : {}) });
    await backing.chmod("/work/input", 0o600);
    await backing.utimes("/work/input", 1_000, 2_000);
    const fs = view(backing, {
      capabilities: { ...backing.capabilities, read: false, copy: false },
      async writeStream() { assert.fail("attributes-only must not copy content"); },
      async readFile() { assert.fail("attributes-only must not read content"); },
    });
    const before = existing ? await backing.stat("/work/output") : undefined;
    const result = await run("cp", ["--attributes-only", ...preserve ? ["-p"] : [], "input", "output"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const stat = await backing.stat("/work/output");
    if (preserve) {
      assert.equal(stat.mode & 0o7777, 0o600);
      assert.equal(stat.atimeMs, 1_000);
      assert.equal(stat.mtimeMs, 2_000);
    } else if (before) {
      assert.equal(stat.mode, before.mode);
      assert.equal(stat.mtimeMs, before.mtimeMs);
    }
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/output")), existing ? "old\n" : "");
  });
}

test("cp -Rp restores directory metadata after copying children", async () => {
  const fs = await fixture({ "source/child/file": "payload" });
  await fs.chmod("/work/source", 0o550);
  await fs.utimes("/work/source", 1_000, 2_000);
  await fs.utimes("/work/source/child", 3_000, 4_000);
  const result = await run("cp", ["-Rp", "source", "target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/target")).mode & 0o7777, 0o550);
  assert.equal((await fs.stat("/work/target")).mtimeMs, 2_000);
  assert.equal((await fs.stat("/work/target")).atimeMs, 1_000);
  assert.equal((await fs.stat("/work/target/child")).mtimeMs, 4_000);
  assert.equal((await fs.stat("/work/target/child")).atimeMs, 3_000);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/child/file")), "payload");
});

test("cp -d copies a dangling symlink without following it", async () => {
  const fs = await fixture();
  await fs.symlink("missing", "/work/input");
  const result = await run("cp", ["-d", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await fs.readlink("/work/output"), "missing");
  await assert.rejects(fs.stat("/work/missing"), { code: "ENOENT" });
});

for (const args of [["-Rd", "source", "target"], ["-d", "source/one", "source/two", "target"], ["-R", "--preserve=links", "source", "target"]]) {
  test(`cp ${args.join(" ")} preserves hard links between copied files`, async () => {
    const fs = await fixture({ "source/one": "payload" });
    await fs.link("/work/source/one", "/work/source/two");
    if (!args.includes("-R") && !args.includes("-Rd")) await fs.mkdir("/work/target");
    const result = await run("cp", args, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    const first = await fs.stat("/work/target/one"), second = await fs.stat("/work/target/two");
    assert.equal(first.ino, second.ino);
    assert.notEqual(first.ino, (await fs.stat("/work/source/one")).ino);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/two")), "payload");
  });
}

for (const [flag, capability] of [["--preserve=mode", "permissions"], ["-p", "timestamps"]] as const) {
  test(`cp ${flag} rejects unsupported ${capability} before copying`, async () => {
    const backing = await fixture({ input: "new", output: "old" });
    const fs = view(backing, { capabilities: { ...backing.capabilities, [capability]: false } });
    const result = await run("cp", [flag, "input", "output"], { fs });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.ok(result.stderr.includes("ENOTSUP"), result.stderr);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/output")), "old");
  });
}

test("cp -p refuses ownership changes that the filesystem cannot perform", async () => {
  const backing = await fixture({ input: "new", output: "old" });
  const fs = view(backing, { async stat(path, options) {
    const stat = await backing.stat(path, options);
    return path === "/work/input" ? { ...stat, uid: 42 } : stat;
  } });
  const result = await run("cp", ["-p", "input", "output"], { fs });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.ok(result.stderr.includes("ENOTSUP"), result.stderr);
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/output")), "old");
});

test("cp preservation forwards cancellation from metadata operations", async () => {
  const backing = await fixture({ input: "new" });
  const controller = new AbortController(), reason = new FsError("ENOTSUP");
  const fs = view(backing, { async chmod(_path, _mode, options) {
    assert.equal(options?.signal, controller.signal);
    controller.abort(reason);
    throw reason;
  } });
  await assert.rejects(run("cp", ["--preserve=mode", "input", "output"], { fs, signal: controller.signal }), error => error === reason);
});

test("cp -d preserves the GNU link topology when the first destination is a symlink", async () => {
  const fs = await fixture({ "source/one": "new", other: "old" });
  await fs.link("/work/source/one", "/work/source/two");
  await fs.mkdir("/work/target");
  await fs.symlink("../other", "/work/target/one");
  const result = await run("cp", ["-d", "source/one", "source/two", "target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.lstat("/work/target/one")).type, "symlink");
  assert.equal((await fs.lstat("/work/target/two")).type, "symlink");
  assert.equal((await fs.lstat("/work/target/one")).ino, (await fs.lstat("/work/target/two")).ino);
  assert.equal(await fs.readlink("/work/target/two"), "../other");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/two")), "new");
});

test("cp -np skips existing targets without changing their metadata", async () => {
  const fs = await fixture({ input: "new", output: "old" });
  await fs.utimes("/work/output", 3_000, 4_000);
  await fs.chmod("/work/input", 0o600);
  const before = await fs.stat("/work/output");
  const result = await run("cp", ["-np", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.stat("/work/output"), before);
});

test("cp -d rejects unavailable hard links during preflight", async () => {
  const backing = await fixture({ "source/one": "new", "target/one": "old" });
  await backing.link("/work/source/one", "/work/source/two");
  const fs = view(backing, { capabilities: { ...backing.capabilities, hardlinks: false } });
  const result = await run("cp", ["-d", "source/one", "source/two", "target"], { fs });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.ok(result.stderr.includes("ENOTSUP"), result.stderr);
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/target/one")), "old");
  await assert.rejects(backing.stat("/work/target/two"), { code: "ENOENT" });
});

test("cp --preserve options respect the end-of-options delimiter", async () => {
  const fs = await fixture({ "--preserve=mode": "operand" });
  const result = await run("cp", ["--", "--preserve=mode", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "operand");
});

test("cp rejects unsupported preservation attributes before effects", async () => {
  const fs = await fixture({ input: "new", output: "old" });
  for (const attribute of ["context", "xattr", "all"]) {
    const result = await run("cp", ["--preserve="+attribute, "input", "output"], { fs });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.ok(result.stderr.includes("ENOTSUP"), result.stderr);
  }
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "old");
});

test("cp -dp preserves the initial access time of all copied hard links", async () => {
  const fs = await fixture({ "source/one": "payload" });
  await fs.link("/work/source/one", "/work/source/two");
  await fs.utimes("/work/source/one", 1_000, 2_000);
  await fs.mkdir("/work/target");
  const result = await run("cp", ["-dp", "source/one", "source/two", "target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  for (const name of ["one", "two"]) {
    assert.equal((await fs.stat("/work/target/"+name)).atimeMs, 1_000);
    assert.equal((await fs.stat("/work/target/"+name)).mtimeMs, 2_000);
  }
});

test("cp -d refuses colliding sources without merging their contents", async () => {
  const fs = await fixture({ "a/x": "A", "b/x": "B" });
  await fs.link("/work/a/x", "/work/a/y");
  await fs.mkdir("/work/target");
  const result = await run("cp", ["-d", "a/x", "b/x", "a/y", "target"], { fs });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/x")), "A");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/y")), "A");
  assert.equal((await fs.stat("/work/target/x")).ino, (await fs.stat("/work/target/y")).ino);
});

test("cp -Rd can populate a copy of a directory without owner write permission", async () => {
  const fs = await fixture({ "source/file": "payload" });
  await fs.chmod("/work/source", 0o550);
  const result = await run("cp", ["-Rd", "source", "target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/file")), "payload");
  assert.equal((await fs.stat("/work/target")).mode & 0o7777, 0o550);
});

test("cp restores temporary directory permissions after child cancellation", async () => {
  const backing = await fixture({ "source/file": "payload" });
  await backing.chmod("/work/source", 0o550);
  const controller = new AbortController(), reason = new Error("stop copying");
  const fs = view(backing, { async writeStream() {
    controller.abort(reason);
    throw reason;
  } });
  await assert.rejects(run("cp", ["-Rd", "source", "target"], { fs, signal: controller.signal }), error => error === reason);
  assert.equal((await backing.stat("/work/target")).mode & 0o7777, 0o550);
});

test("cp preservation combines with backups and target directories", async () => {
  const fs = await fixture({ input: "new", "target/input": "old" });
  await fs.chmod("/work/input", 0o600);
  const result = await run("cp", ["--preserve=mode", "-b", "-S", ".bak", "-t", "target", "input"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/target/input")).mode & 0o7777, 0o600);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/input")), "new");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/input.bak")), "old");
});

for (const suffix of [["-S", "--preserve=timestamps"], ["-bS", "--preserve=timestamps"], ["--suffix", "--preserve=timestamps"]]) {
  test(`cp preserves option-looking suffix values: ${suffix.join(" ")}`, async () => {
    const fs = await fixture({ input: "new", output: "old" });
    await fs.utimes("/work/input", 1_000, 2_000);
    const result = await run("cp", ["-b", ...suffix, "input", "output"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.notEqual((await fs.stat("/work/output")).mtimeMs, 2_000);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output--preserve=timestamps")), "old");
  });
}

test("cp --attributes-only backs up the previous bytes and creates an empty destination", async () => {
  const fs = await fixture({ input: "new", output: "old" });
  await fs.chmod("/work/input", 0o600);
  const result = await run("cp", ["--attributes-only", "--preserve=mode", "-b", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output~")), "old");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "");
  assert.equal((await fs.stat("/work/output")).mode & 0o7777, 0o600);
});

test("cp -dp backs up existing destinations while preserving hard links", async () => {
  const fs = await fixture({ "source/one": "new", "target/one": "old one", "target/two": "old two" });
  await fs.link("/work/source/one", "/work/source/two");
  await fs.utimes("/work/source/one", 1_000, 2_000);
  const result = await run("cp", ["-dpb", "-t", "target", "source/one", "source/two"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  const one = await fs.stat("/work/target/one"), two = await fs.stat("/work/target/two");
  assert.equal(one.ino, two.ino);
  assert.equal(one.mtimeMs, 2_000);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/one~")), "old one");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/two~")), "old two");
});

for (const dangling of [false, true]) {
  test(`cp --attributes-only backs up a destination before copying a symlink, dangling=${dangling}`, async () => {
    const fs = await fixture({ output: "old", ...dangling ? {} : { referent: "source" } });
    const linkTarget = dangling ? "missing" : "referent";
    await fs.symlink(linkTarget, "/work/input");
    const result = await run("cp", ["-db", "--attributes-only", "input", "output"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(await fs.readlink("/work/input"), linkTarget);
    assert.equal(await fs.readlink("/work/output"), linkTarget);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output~")), "old");
    if (dangling) await assert.rejects(fs.stat("/work/output"), { code: "ENOENT" });
    else assert.equal(new TextDecoder().decode(await fs.readFile("/work/referent")), "source");
  });
}

test("cp refuses a backup suffix that aliases a dangling source entry", async () => {
  const fs = await fixture({ "source/output": "old" });
  await fs.symlink("missing", "/work/source/output.bak");
  await fs.symlink("source", "/work/alias");
  const before = await fs.lstat("/work/source/output.bak");
  const result = await run("cp", ["-db", "--attributes-only", "-S", ".bak", "source/output.bak", "alias/output"], { fs });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.ok(result.stderr.includes("backup would destroy source"), result.stderr);
  assert.equal(await fs.readlink("/work/source/output.bak"), "missing");
  assert.equal((await fs.lstat("/work/source/output.bak")).ino, before.ino);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/source/output")), "old");
});

for (const symlink of [false, true]) {
  test(`cp --attributes-only removes the destination entry when requested, symlink=${symlink}`, async () => {
    const fs = await fixture({ output: "old", ...symlink ? {} : { input: "new" } });
    if (symlink) await fs.symlink("missing", "/work/input");
    await fs.link("/work/output", "/work/retained");
    const result = await run("cp", ["-d", "--attributes-only", "--remove-destination", "input", "output"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/retained")), "old");
    if (symlink) assert.equal(await fs.readlink("/work/output"), "missing");
    else assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "");
  });
}
