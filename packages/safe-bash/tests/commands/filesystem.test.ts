import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, FsError, type FileSystem, type MkdirOptions } from "../../src/contracts/index.js";
import { fixture, run } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const command of ["cp", "mv", "ln"]) {
  test(`${command} rejects the undocumented -B option before changing files`, async () => {
    const fs = await fixture({ source: "new", target: "old" });
    const result = await run(command, ["-B", "simple", "source", "target"], { fs });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(Buffer.from(await fs.readFile("/work/source")).toString(), "new");
    assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), "old");
    await assert.rejects(fs.stat("/work/target~"), { code: "ENOENT" });
  });
}

for (const flags of ["-v", "--verbose", ""]) {
  for (const operand of ["empty", "./empty", "empty/", "/work/empty"]) {
    test(`rmdir ${flags} preserves operand spelling ${operand}`, async context => {
      const fs = await fixture({});
      const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(`mkdir empty; rmdir ${flags} ${operand}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, flags ? `rmdir: removing directory, '${operand}'\n` : "");
      await assert.rejects(fs.stat("/work/empty"), { code: "ENOENT" });
    });
  }
}

for (const flags of ["-pv", "--parents --verbose"]) {
  test(`rmdir ${flags} preserves parent operand spelling`, async context => {
    const fs = await fixture({});
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`mkdir -p outer/inner; rmdir ${flags} outer/inner`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "rmdir: removing directory, 'outer/inner'\nrmdir: removing directory, 'outer'\n");
    await assert.rejects(fs.stat("/work/outer"), { code: "ENOENT" });
    assert.equal((await fs.stat("/work")).type, "directory");
  });
}

for (const option of ["-l", "--link", "-s", "--symbolic-link"]) {
  test(`cp ${option} creates a filesystem link through Shell`, async () => {
    const fs = await fixture({ input: "original" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`cp ${option} ./input output`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    if (option === "-s" || option === "--symbolic-link") {
      assert.equal(await fs.readlink("/work/output"), "./input");
    } else {
      assert.equal((await fs.stat("/work/input")).ino, (await fs.stat("/work/output")).ino);
    }
    await fs.writeFile("/work/input", new TextEncoder().encode("changed"));
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "changed");
  });
}

test("cp link modes replace destinations, honor no-clobber and back up entries", async () => {
  for (const option of ["-l", "-s"]) {
    const fs = await fixture({ input: "new", output: "old" });
    assert.equal((await run("cp", [option, "-n", "input", "output"], { fs })).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "old");
    assert.equal((await run("cp", [option, "-b", "input", "output"], { fs })).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output~")), "old");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "new");
    await fs.rm("/work/output", { recursive: false });
    await fs.writeFile("/work/output", new TextEncoder().encode("replacement"));
    assert.equal((await run("cp", [option, "input", "output"], { fs })).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "new");
    assert.equal((await run("cp", [option, "input", "input"], { fs })).exitCode, 1);
  }
});

test("cp refuses unsupported link modes before replacing a destination", async () => {
  for (const [option, method] of [["-l", "link"], ["-s", "symlink"]]) {
    const backing = await fixture({ input: "new", output: "old" });
    const fs: FileSystem = new Proxy(backing, { get(target, property) {
      if (property === method) return undefined;
      const member: unknown = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    assert.equal((await run("cp", [option!, "input", "output"], { fs })).exitCode, 1);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/output")), "old");
  }
});

test("cp recursively links files and rejects relative symbolic targets outside cwd", async () => {
  const fs = await fixture({ "tree/child": "data" });
  assert.equal((await run("cp", ["-Rl", "tree", "output"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/tree/child")).ino, (await fs.stat("/work/output/child")).ino);
  assert.equal((await run("cp", ["-Rs", "/work/tree", "symbolic"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/symbolic/child"), "/work/tree/child");
  assert.equal((await run("cp", ["-s", "tree/child", "output/link"], { fs })).exitCode, 1);
  assert.equal((await run("cp", ["-ls", "tree/child", "link"], { fs })).exitCode, 2);
});

for (const option of ["-u", "--update"]) {
  for (const targetTime of [undefined, 1000, 2000, 3000]) {
    test(`mv ${option} updates destination with mtime ${targetTime}`, async () => {
      const fs = await fixture({ input: "new", ...(targetTime === undefined ? {} : { output: "old" }) });
      await fs.utimes("/work/input", 2000, 2000);
      if (targetTime !== undefined) await fs.utimes("/work/output", targetTime, targetTime);
      const shell = new Shell({ fs, cwd: "/work" });
      shell.use(agentCommands());
      const result = await shell.exec(`mv ${option} -bv input output`);
      const skipped = targetTime !== undefined && targetTime >= 2000;
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, skipped ? "" : "renamed 'input' -> 'output'\n");
      assert.equal(Buffer.from(await fs.readFile("/work/output")).toString(), skipped ? "old" : "new");
      if (skipped) assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), "new");
      else await assert.rejects(fs.lstat("/work/input"), { code: "ENOENT" });
      if (targetTime === 1000) assert.equal(Buffer.from(await fs.readFile("/work/output~")).toString(), "old");
      else await assert.rejects(fs.lstat("/work/output~"), { code: "ENOENT" });
    });
  }
}

for (const option of ["--preserve=mode", "-p"]) {
  test(`cp ${option} preserves mode and copies contents`, async () => {
    const fs = await fixture({ input: "new", output: "old" });
    await fs.chmod("/work/input", 0o600);
    await fs.utimes("/work/input", 1000, 2000);
    const result = await run("cp", [option, "input", "output"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "new");
    assert.equal((await fs.stat("/work/output")).mode & 0o7777, 0o600);
    if (option === "-p") assert.equal((await fs.stat("/work/output")).mtimeMs, 2000);
  });
}

test("cp --attributes-only retains existing contents and creates empty missing files", async () => {
  const fs = await fixture({ input: "new", output: "old" });
  for (const target of ["output", "missing"]) {
    const result = await run("cp", ["--attributes-only", "input", target], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${target}`)), target === "output" ? "old" : "");
  }
});

test("cp -d copies a symbolic link without dereferencing it", async () => {
  const fs = await fixture({ input: "new" });
  await fs.symlink("input", "/work/source");
  const result = await run("cp", ["-d", "source", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await fs.readlink("/work/output"), "input");
});

test("cp -d preserves hard links across source operands", async () => {
  const fs = await fixture({ input: "new" });
  await fs.link("/work/input", "/work/alias");
  await fs.mkdir("/work/output");
  const result = await run("cp", ["-d", "input", "alias", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  await fs.writeFile("/work/output/input", new TextEncoder().encode("changed"));
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output/alias")), "changed");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "new");
});

test("cp recursively preserves directory modes and timestamps after copying children", async () => {
  const fs = await fixture({ "input/file": "new" });
  await fs.chmod("/work/input", 0o700);
  await fs.utimes("/work/input", 1000, 2000);
  const result = await run("cp", ["-Rp", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/output")).mode & 0o7777, 0o700);
  assert.equal((await fs.stat("/work/output")).mtimeMs, 2000);
});

test("cp refuses unsupported preservation before changing destination bytes", async () => {
  const backing = await fixture({ input: "new", output: "old" });
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "chmod") return undefined;
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  for (const option of ["--preserve=mode", "--preserve=xattr", "--preserve=invalid"]) {
    const result = await run("cp", [option, "input", "output"], { fs });
    assert.notEqual(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/output")), "old");
  }
});

async function prefixFixture() {
  const backing = await fixture({ "reports/drafts/note": "draft", "other/note": "other", "explicit/note": "kept", collision: "file" });
  await backing.chmod("/work/reports/drafts", 0o755);
  await backing.chmod("/work/explicit", 0o755);
  await backing.symlink("reports/drafts", "/work/link");
  const explicit = new Set(["/", "/work", "/work/explicit"]);
  const calls: { path: string; options: MkdirOptions | undefined }[] = [];
  const overrides: { -readonly [Key in keyof FileSystem]?: FileSystem[Key] } = {
    capabilities: { ...backing.capabilities, implicitDirectories: true, explicitDirectories: true },
    async mkdir(path, options) {
      calls.push({ path, options });
      options?.signal?.throwIfAborted();
      if (options?.mode !== undefined && overrides.capabilities?.permissions === false) throw new FsError("ENOTSUP", { syscall: "mkdir", path });
      await backing.mkdir(path, options);
      let current = await backing.realpath(path);
      while (true) {
        explicit.add(current);
        if (!options?.recursive || current === "/") break;
        current = dirname(current);
      }
    },
    async rm(path, options) {
      await backing.rm(path, options);
      let current = dirname(path);
      while (!explicit.has(current) && (await backing.readdir(current)).length === 0) {
        await backing.rmdir(current, options);
        current = dirname(current);
      }
    },
  };
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    if (property === "capabilitiesFor") return undefined;
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  return { fs, backing, calls, overrides };
}

test("mkdir -p persists an implicit prefix after its last descendant is removed", async () => {
  const control = await prefixFixture();
  await control.fs.rm("/work/reports/drafts/note");
  await assert.rejects(control.fs.stat("/work/reports/drafts"), { code: "ENOENT" });
  await control.fs.rm("/work/explicit/note");
  assert.equal((await control.fs.stat("/work/explicit")).type, "directory");
  const current = await prefixFixture();
  const created = await run("mkdir", ["-p", "reports/drafts"], { fs: current.fs });
  assert.equal(created.exitCode, 0, created.stderr);
  assert.equal((await run("rm", ["reports/drafts/note"], { fs: current.fs })).exitCode, 0);
  assert.equal((await run("test", ["-d", "reports/drafts"], { fs: current.fs })).exitCode, 0);
  assert.equal((await current.fs.stat("/work/reports")).type, "directory");
  assert.equal(current.calls.length, 1);
  assert.deepEqual(current.calls[0], { path: "/work/reports/drafts", options: { recursive: true, signal: created.context.signal } });
});

for (const operand of ["reports/drafts", "explicit", "link"]) {
  test(`mkdir -pv -m 700 materializes ${operand} silently without changing existing mode`, async () => {
    const current = await prefixFixture();
    current.overrides.capabilities = { ...current.fs.capabilities, permissions: false };
    const result = await run("mkdir", ["-pv", "-m", "700", operand], { fs: current.fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal((await current.fs.stat(`/work/${operand}`)).mode & 0o777, 0o755);
    assert.equal(current.calls.length, 1);
    assert.deepEqual(current.calls[0]!.options, { recursive: true, signal: result.context.signal });
    await current.fs.rm(operand === "explicit" ? "/work/explicit/note" : "/work/reports/drafts/note");
    assert.equal((await current.fs.stat(`/work/${operand}`)).type, "directory");
  });
}

for (const global of [false, true, undefined]) for (const scoped of [false, true, undefined]) {
  test(`mkdir -p uses path-scoped implicitDirectories=${scoped} over global=${global}`, async () => {
    const current = await prefixFixture();
    const capabilities = { ...current.fs.capabilities };
    if (global === undefined) delete capabilities.implicitDirectories;
    else capabilities.implicitDirectories = global;
    current.overrides.capabilities = capabilities;
    const selected = { ...capabilities };
    if (scoped === undefined) delete selected.implicitDirectories;
    else selected.implicitDirectories = scoped;
    const operand = scoped === true ? "reports/drafts" : "explicit";
    const queried: string[] = [];
    current.overrides.capabilitiesFor = async (path, options) => {
      assert.ok(options?.signal);
      queried.push(path);
      return selected;
    };
    const result = await run("mkdir", ["-p", operand], { fs: current.fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(queried.length > 0);
    assert.ok(queried.every(path => path === `/work/${operand}`));
    assert.equal(current.calls.length, scoped === true ? 1 : 0);
  });
}

for (const implicit of [false, undefined]) {
  test(`mkdir -p leaves explicit-only existing directories untouched when implicitDirectories=${implicit}`, async () => {
    const current = await prefixFixture();
    const capabilities = { ...current.fs.capabilities, readOnly: true };
    if (implicit === undefined) delete capabilities.implicitDirectories;
    else capabilities.implicitDirectories = implicit;
    current.overrides.capabilities = capabilities;
    const result = await run("mkdir", ["-pv", "-m", "700", "explicit"], { fs: current.fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(current.calls.length, 0);
    assert.equal((await current.fs.stat("/work/explicit")).mode & 0o777, 0o755);
  });
}

test("mkdir -p preflights all implicit operands without mutation and calls the adapter once per execution", async () => {
  const current = await prefixFixture();
  const queries: { path: string; writes: number }[] = [];
  current.overrides.capabilitiesFor = async path => { queries.push({ path, writes: current.calls.length }); return current.fs.capabilities; };
  const result = await run("mkdir", ["-pv", "reports/drafts", "other"], { fs: current.fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  for (const path of ["/work/reports/drafts", "/work/other"]) assert.ok(queries.some(query => query.path === path && query.writes === 0));
  assert.deepEqual(current.calls.map(call => call.path), ["/work/reports/drafts", "/work/other"]);
});

for (const denied of ["global-readonly", "path-readonly", "recursiveMkdir", "explicitDirectories", "query-error"] as const) {
  test(`mkdir -p ${denied} preflight refusal prevents every operand mutation`, async () => {
    const current = await prefixFixture();
    if (denied === "global-readonly") current.overrides.capabilities = { ...current.fs.capabilities, readOnly: true };
    current.overrides.capabilitiesFor = async path => {
      const capabilities = { ...current.fs.capabilities, readOnly: false };
      if (path === "/work/reports/drafts") {
        if (denied === "path-readonly") capabilities.readOnly = true;
        else if (denied === "recursiveMkdir" || denied === "explicitDirectories") capabilities[denied] = false;
        else if (denied === "query-error") throw new FsError("ENOTSUP", { syscall: "capabilitiesFor", path });
      }
      return capabilities;
    };
    const result = await run("mkdir", ["-p", "new", "reports/drafts"], { fs: current.fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, denied.endsWith("readonly") ? /EROFS/u : /ENOTSUP/u);
    assert.equal(result.stdout, "");
    assert.equal(current.calls.length, 0);
    await assert.rejects(current.fs.stat("/work/new"), { code: "ENOENT" });
    await current.fs.rm("/work/reports/drafts/note");
    await assert.rejects(current.fs.stat("/work/reports/drafts"), { code: "ENOENT" });
  });
}

for (const args of [["reports/drafts"], ["explicit"], ["collision"], ["-p", "collision"]]) {
  test(`mkdir ${args.join(" ")} preserves existing-directory/file EEXIST errors`, async () => {
    const current = await prefixFixture();
    const result = await run("mkdir", args, { fs: current.fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /EEXIST/u);
    assert.equal(result.stdout, "");
    assert.equal(current.calls.length, 0);
  });
}

for (const flags of ["-pv", "--parents --verbose"]) {
  test(`mkdir ${flags} reports each new parent through Shell`, async () => {
    const fs = await fixture({});
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`mkdir ${flags} outer/inner outer/second`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "mkdir: created directory 'outer'\nmkdir: created directory 'outer/inner'\nmkdir: created directory 'outer/second'\n");
    assert.equal((await fs.stat("/work/outer/inner")).type, "directory");
    assert.equal((await shell.exec(`mkdir ${flags} outer/inner`)).stdout, "");
    const trailing = await shell.exec(`mkdir ${flags} ./relative/deep/`);
    assert.equal(trailing.exitCode, 0, trailing.stderr);
    assert.equal(trailing.stdout, "mkdir: created directory './relative'\nmkdir: created directory './relative/deep/'\n");
  });
}

test("mkdir still passes mode and emits verbose output only for absent directories", async () => {
  const current = await prefixFixture();
  const result = await run("mkdir", ["-pv", "-m", "700", "reports/drafts", "new/deep"], { fs: current.fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "mkdir: created directory 'new'\nmkdir: created directory 'new/deep'\n");
  assert.equal((await current.fs.stat("/work/new")).mode & 0o777, 0o755);
  assert.equal((await current.fs.stat("/work/new/deep")).mode & 0o777, 0o700);
  assert.equal((await current.fs.stat("/work/reports/drafts")).mode & 0o777, 0o755);
  assert.deepEqual(current.calls.map(call => call.options), [
    { recursive: true, signal: result.context.signal },
    { recursive: true, mode: 0o755, signal: result.context.signal },
    { recursive: true, mode: 0o700, signal: result.context.signal },
  ]);
});

test("mkdir preserves ordinary materialization errors and continues with other operands", async () => {
  const current = await prefixFixture();
  const mkdir = current.overrides.mkdir!;
  current.overrides.mkdir = async (path, options) => {
    if (path === "/work/reports/drafts") { current.calls.push({ path, options }); throw new FsError("EACCES", { syscall: "mkdir", path }); }
    await mkdir(path, options);
  };
  const result = await run("mkdir", ["-pv", "reports/drafts", "new"], { fs: current.fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EACCES/u);
  assert.equal(result.stdout, "mkdir: created directory 'new'\n");
  assert.deepEqual(current.calls.map(call => call.path), ["/work/reports/drafts", "/work/new"]);
});

for (const phase of ["preflight", "execution", "mkdir"]) for (const reason of [false, 0, "", null]) {
  test(`mkdir -p preserves ${JSON.stringify(reason)} cancellation during ${phase}`, async () => {
    const current = await prefixFixture();
    const controller = new AbortController();
    let observations = 0;
    current.overrides.stat = async (path, options) => { observations++; return current.backing.stat(path, options); };
    current.overrides.capabilitiesFor = async () => {
      if (phase === "preflight" || phase === "execution" && observations === 2) controller.abort(reason);
      return current.fs.capabilities;
    };
    if (phase === "mkdir") {
      const mkdir = current.overrides.mkdir!;
      current.overrides.mkdir = async (path, options) => { controller.abort(reason); await mkdir(path, options); };
    }
    await assert.rejects(run("mkdir", ["-p", "reports/drafts"], { fs: current.fs, signal: controller.signal }), error => Object.is(error, reason));
    assert.equal(current.calls.length, phase === "mkdir" ? 1 : 0);
    await current.fs.rm("/work/reports/drafts/note");
    await assert.rejects(current.fs.stat("/work/reports/drafts"), { code: "ENOENT" });
  });
}

test("mkdir creates parents and octal modes, reports errors without abandoning other operands", async () => {
  const fs = await fixture({ collision: "data" });
  assert.equal((await run("mkdir", ["-p", "-m", "700", "nested/child"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/nested/child")).mode & 0o777, 0o700);
  const result = await run("mkdir", ["collision", "other"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EEXIST/u);
  assert.equal((await fs.stat("/work/other")).type, "directory");
  assert.equal((await run("mkdir", ["-m", "invalid", "bad"], { fs })).exitCode, 2);
});

for (const [args, expected] of [
  [["-d", "@0"], 0],
  [["--date=@-1.25"], -1250],
  [["-d2024-01-02T03:04:05Z"], Date.UTC(2024, 0, 2, 3, 4, 5)],
  [["-t", "202401020304.05"], Date.UTC(2024, 0, 2, 3, 4, 5)],
  [["-t", "2401020304"], Date.UTC(2024, 0, 2, 3, 4)],
  [["-t", "6901020304"], Date.UTC(1969, 0, 2, 3, 4)],
] as const) {
  test(`touch ${args.join(" ")} sets explicit timestamps on new and existing files`, async () => {
    const fs = await fixture({ existing: "keep" });
    const result = await run("touch", [...args, "new", "existing"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    for (const name of ["new", "existing"]) {
      const stat = await fs.stat(`/work/${name}`);
      assert.equal(stat.atimeMs, expected);
      assert.equal(stat.mtimeMs, expected);
    }
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/existing")), "keep");
  });
}

test("touch explicit timestamps work through Shell and stat", async () => {
  const shell = new Shell({ fs: await fixture(), cwd: "/work", env: { TZ: "UTC" } }).use(agentCommands());
  try {
    const result = await shell.exec("touch -d @0 output; stat -c %Y output");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "0\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("touch explicit timestamps refuse unsupported timestamp creation before writing", async () => {
  const backing = await fixture();
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "capabilitiesFor") return undefined;
    if (property === "capabilities") return { ...backing.capabilities, timestamps: false };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await run("touch", ["-d", "@0", "new"], { fs });
  assert.equal(result.exitCode, 1);
  await assert.rejects(backing.stat("/work/new"), { code: "ENOENT" });
  assert.equal((await run("touch", ["-c", "-d", "@0", "new"], { fs })).exitCode, 0);
});

test("touch explicit timestamps honor TZ, selected times, no-create, and reference-relative dates", async () => {
  const fs = await fixture({ existing: "keep", reference: "" });
  await fs.utimes("/work/existing", 1000, 2000);
  await fs.utimes("/work/reference", 3000, 4000);
  assert.equal((await run("touch", ["-a", "-t", "202401020304.05", "existing"], { fs, env: { TZ: "UTC-2" } })).exitCode, 0);
  assert.equal((await fs.stat("/work/existing")).atimeMs, Date.UTC(2024, 0, 2, 1, 4, 5));
  assert.equal((await fs.stat("/work/existing")).mtimeMs, 2000);
  assert.equal((await run("touch", ["-mr", "reference", "-d", "1 second", "existing"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/existing")).mtimeMs, 5000);
  assert.equal((await run("touch", ["-c", "-d", "@0", "absent"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/absent"), { code: "ENOENT" });
});

for (const args of [["-d", "invalid"], ["-t", "202402300304"], ["-t", "202401020304.99"], ["-t", "123"], ["-d", "@0", "-t", "202401020304"]]) {
  test(`touch rejects ${args.join(" ")} before creating files`, async () => {
    const fs = await fixture();
    const result = await run("touch", [...args, "new"], { fs });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.match(result.stderr, /^touch: /);
    await assert.rejects(fs.stat("/work/new"), { code: "ENOENT" });
  });
}

test("touch ignores historical -f through Shell, including combined options", async () => {
  const fs = await fixture({ source: "keep", reference: "reference" });
  await fs.utimes("/work/source", 100, 200);
  await fs.utimes("/work/reference", 123, 456);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    for (const command of ["touch -f source created", "touch -fc missing", "touch -famr reference source created"]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
    await assert.rejects(fs.stat("/work/missing"), { code: "ENOENT" });
    for (const path of ["source", "created"]) {
      const stat = await fs.stat(`/work/${path}`);
      assert.equal(stat.atimeMs, 123);
      assert.equal(stat.mtimeMs, 456);
    }
    assert.equal(Buffer.from(await fs.readFile("/work/source")).toString(), "keep");
    assert.deepEqual(await fs.readFile("/work/created"), new Uint8Array());
  } finally {
    await shell.dispose();
  }
});

test("touch creates without truncation, honors no-create and reference access/modify times", async () => {
  const fs = await fixture({ source: "keep", reference: "ref" });
  await fs.utimes("/work/reference", 123, 456);
  await fs.utimes("/work/source", 11, 22);
  assert.equal((await run("touch", ["-ar", "reference", "source"], { fs })).exitCode, 0);
  const stat = await fs.stat("/work/source");
  assert.equal(stat.atimeMs, 123);
  assert.equal(stat.mtimeMs, 22);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "keep");
  await run("touch", ["-c", "absent"], { fs });
  await assert.rejects(fs.stat("/work/absent"), { code: "ENOENT" });
  await run("touch", ["new"], { fs });
  assert.equal((await fs.stat("/work/new")).size, 0);
});

for (const [source, target] of [
  ["input", "output"],
  ["./input", "./output"],
  ["nested/../input", "nested/../output"],
  ["/work/input", "/work/output"],
]) {
  test(`cp -v preserves operand spelling for ${source} -> ${target}`, async () => {
    const fs = await fixture({ input: "a", "nested/keep": "kept" });
    const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(agentCommands());
    const result = await shell.exec(`cp -v ${source} ${target}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `'${source}' -> '${target}'\n`);
    assert.deepEqual(await fs.readFile("/work/output"), new TextEncoder().encode("a"));
  });
}

test("cp -v preserves destination directory spelling for multiple operands", async () => {
  const fs = await fixture({ first: "one", second: "two", "out/keep": "kept" });
  const result = await run("cp", ["-v", "./first", "second", "./out//"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "'./first' -> './out/first'\n'second' -> './out/second'\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/first")), "one");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/second")), "two");
});

test("cp -Rv preserves operand spelling for nested files and symlinks", async () => {
  const fs = await fixture({ "source/deep/file": "payload" });
  await fs.symlink("deep/file", "/work/source/link");
  const result = await run("cp", ["-Rv", "./source/", "./destination"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout.trimEnd().split("\n").sort(), [
    "'./source/' -> './destination'",
    "'./source/deep' -> './destination/deep'",
    "'./source/deep/file' -> './destination/deep/file'",
    "'./source/link' -> './destination/link'",
  ].sort());
  assert.equal(await fs.readlink("/work/destination/link"), "deep/file");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/destination/deep/file")), "payload");
});

test("cp -nv stays silent when skipping an existing destination", async () => {
  const fs = await fixture({ input: "new", output: "kept" });
  const result = await run("cp", ["-nv", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "kept");
});

test("cp handles multiple files, no-clobber and same-inode protection", async () => {
  const fs = await fixture({ first: "one", second: "two", target: "keep" });
  await run("mkdir", ["out"], { fs });
  assert.equal((await run("cp", ["first", "second", "out"], { fs })).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/second")), "two");
  await run("cp", ["-n", "first", "target"], { fs });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), "keep");
  await fs.link("/work/first", "/work/alias");
  assert.match((await run("cp", ["first", "alias"], { fs })).stderr, /same file/u);
  assert.equal((await run("cp", ["first", "second", "missing-dir"], { fs })).exitCode, 1);
});

test("cp recursively copies trees, preserves nested symlinks and rejects self-descendants", async () => {
  const fs = await fixture({ "source/deep/file": "payload" });
  await fs.symlink("deep/file", "/work/source/link");
  assert.equal((await run("cp", ["-R", "source", "destination"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/destination/link"), "deep/file");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/destination/deep/file")), "payload");
  assert.equal((await run("cp", ["source", "other"], { fs })).exitCode, 1);
  assert.match((await run("cp", ["-R", "source", "source/inside"], { fs })).stderr, /into itself/u);
  await fs.symlink("source", "/work/alias");
  assert.match((await run("cp", ["-R", "source", "alias/inside"], { fs })).stderr, /into itself/u);
  await fs.symlink(".", "/work/source/loop");
  assert.match((await run("cp", ["-RL", "source", "followed"], { fs })).stderr, /ELOOP/u);
});

for (const [command, expected, target] of [
  ["mv -v input output", "renamed 'input' -> 'output'\n", "/work/output"],
  ["mv --verbose ./input ./output", "renamed './input' -> './output'\n", "/work/output"],
  ["mv -v /work/input /work/output", "renamed '/work/input' -> '/work/output'\n", "/work/output"],
  ["mv -v input ./destination//", "renamed 'input' -> './destination/input'\n", "/work/destination/input"],
] as const) {
  test(`mv verbose preserves operand spelling: ${command}`, async () => {
    const fs = await fixture({ input: "a" });
    await fs.mkdir("/work/destination");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(expected));
      assert.equal(result.stderr, "");
      assert.equal(new TextDecoder().decode(await fs.readFile(target)), "a");
      await assert.rejects(fs.stat("/work/input"), { code: "ENOENT" });
    } finally { await shell.dispose(); }
  });
}

for (const option of ["-t target", "-ttarget", "--target-directory target", "--target-directory=target"]) {
  test(`mv accepts ${option} with multiple sources and verbose output`, async () => {
    const fs = await fixture({ input: "abc\n", second: "def\n" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`mkdir target; mv -v ${option} input second`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "renamed 'input' -> 'target/input'\nrenamed 'second' -> 'target/second'\n");
    for (const [name, bytes] of [["input", "abc\n"], ["second", "def\n"]]) {
      assert.equal(new TextDecoder().decode(await fs.readFile(`/work/target/${name}`)), bytes);
      await assert.rejects(fs.stat(`/work/${name}`), { code: "ENOENT" });
    }
  });
}

for (const option of ["-T", "--no-target-directory"]) {
  test(`mv ${option} treats the destination as an exact path`, async () => {
    const fs = await fixture({ input: "abc\n" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`mv ${option} input output`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "abc\n");
    await assert.rejects(fs.stat("/work/input"), { code: "ENOENT" });
    await fs.mkdir("/work/target");
    const rejected = await shell.exec(`mv ${option} output target`);
    assert.equal(rejected.exitCode, 1, rejected.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "abc\n");
    await assert.rejects(fs.stat("/work/target/output"), { code: "ENOENT" });
  });
}

test("mv -T replaces an empty directory instead of nesting the source", async () => {
  const fs = await fixture({ "source/note": "kept" });
  await fs.mkdir("/work/target");
  const result = await run("mv", ["-T", "source", "target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/note")), "kept");
  await assert.rejects(fs.stat("/work/source"), { code: "ENOENT" });
  await assert.rejects(fs.stat("/work/target/source"), { code: "ENOENT" });
});

test("mv -t follows a directory symlink and preserves no-clobber behavior", async () => {
  const fs = await fixture({ input: "new", "target/input": "old", second: "moved" });
  await fs.symlink("target", "/work/link");
  const result = await run("mv", ["input", "second", "-nv", "-t", "link"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "renamed 'second' -> 'link/second'\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "new");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/input")), "old");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/second")), "moved");
});

for (const args of [
  ["-t"], ["--target-directory"], ["-t", "target"],
  ["-t", "target", "-T", "input"], ["-T", "input", "second", "output"],
  ["-t", "target", "-t", "other", "input"],
]) {
  test(`mv rejects invalid target-directory arguments: ${args.join(" ")}`, async () => {
    const fs = await fixture({ input: "abc\n", second: "def\n" });
    await fs.mkdir("/work/target");
    const result = await run("mv", args, { fs });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "abc\n");
    assert.deepEqual(await fs.readdir("/work/target"), []);
  });
}

for (const target of ["missing", "second"]) {
  test(`mv -t requires an existing directory: ${target}`, async () => {
    const fs = await fixture({ input: "abc\n", second: "def\n" });
    const result = await run("mv", ["-t", target, "input"], { fs });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "abc\n");
  });
}

test("mv -nv stays silent when skipping an existing destination", async () => {
  const fs = await fixture({ input: "new", output: "kept" });
  const result = await run("mv", ["-nv", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "new");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "kept");
});

test("mv renames and honors no-clobber without host filesystem operations", async () => {
  const fs = await fixture({ first: "one", second: "two" });
  await run("mv", ["-n", "first", "second"], { fs });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/second")), "two");
  assert.equal((await run("mv", ["first", "renamed"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/first"), { code: "ENOENT" });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/renamed")), "one");
});

for (const option of ["--interactive=always", "--interactive", "-i"]) {
  for (const answer of ["y\n", "n\n", ""]) test(`rm ${option} respects answer ${JSON.stringify(answer)}`, async () => {
    const fs = await fixture({ input: "abc" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`rm ${option} input`, { stdin: answer });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "rm: remove regular file 'input'? ");
    if (answer.startsWith("y")) await assert.rejects(fs.stat("/work/input"), { code: "ENOENT" });
    else assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "abc");
  });
}

for (const args of [["--interactive=never"], ["-I"], ["--interactive=once"], ["-if"], ["-i", "-f"]]) {
  test(`rm ${args.join(" ")} removes one file without prompting or reading stdin`, async () => {
    const fs = await fixture({ input: "abc" });
    const stdin = { async *[Symbol.asyncIterator]() { throw new Error("unexpected stdin read"); yield new Uint8Array(); } };
    const result = await run("rm", [...args, "input"], { fs, stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    await assert.rejects(fs.stat("/work/input"), { code: "ENOENT" });
  });
}

test("rm interactive option ordering, multiple answers, and once threshold", async () => {
  for (const args of [["-fi"], ["-f", "--interactive=always"]]) {
    const fs = await fixture({ a: "a", b: "b" });
    const result = await run("rm", [...args, "a", "b"], { fs, stdin: "n\ny\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "rm: remove regular file 'a'? rm: remove regular file 'b'? ");
    assert.equal((await fs.stat("/work/a")).type, "file");
    await assert.rejects(fs.stat("/work/b"), { code: "ENOENT" });
  }
  for (const answer of ["y\n", "n\n"]) {
    const fs = await fixture({ a: "a", b: "b", c: "c", d: "d" });
    const result = await run("rm", ["-I", "a", "b", "c", "d"], { fs, stdin: answer });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "rm: remove 4 arguments? ");
    for (const name of ["a", "b", "c", "d"]) {
      if (answer === "y\n") await assert.rejects(fs.stat(`/work/${name}`), { code: "ENOENT" });
      else assert.equal((await fs.stat(`/work/${name}`)).type, "file");
    }
  }
});

test("rm interactive recursive removal preserves declined descendants", async () => {
  const fs = await fixture({ "dir/a": "a", "dir/b": "b" });
  const result = await run("rm", ["-ri", "dir"], { fs, stdin: "y\nn\ny\ny\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "rm: descend into directory 'dir'? rm: remove regular file 'dir/a'? rm: remove regular file 'dir/b'? ");
  assert.equal((await fs.stat("/work/dir/a")).type, "file");
  await assert.rejects(fs.stat("/work/dir/b"), { code: "ENOENT" });
});

test("rm invalid interactive policy leaves files intact", async () => {
  const fs = await fixture({ input: "abc" });
  assert.equal((await run("rm", ["--interactive=invalid", "input"], { fs })).exitCode, 2);
  assert.equal((await fs.stat("/work/input")).type, "file");
});

test("rm once recursive confirmation uses singular and preserves a declined tree", async () => {
  const fs = await fixture({ "dir/input": "abc" });
  const result = await run("rm", ["--interactive=once", "-r", "dir"], { fs, stdin: "n\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "rm: remove 1 argument recursively? ");
  assert.equal((await fs.stat("/work/dir/input")).type, "file");
});

test("rm refuses directories by default, protects root, removes links not targets, and supports force", async () => {
  const fs = await fixture({ "directory/file": "keep" });
  await fs.symlink("directory", "/work/link");
  assert.equal((await run("rm", ["directory"], { fs })).exitCode, 1);
  assert.equal((await run("rm", ["link"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/directory/file")).type, "file");
  assert.equal((await run("rm", ["-rf", "/"], { fs })).exitCode, 1);
  assert.equal((await run("rm", ["-rf", "."], { fs })).exitCode, 1);
  assert.equal((await run("rm", ["-f", "missing"], { fs })).exitCode, 0);
  assert.equal((await run("rm", ["-r", "directory"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/directory"), { code: "ENOENT" });
});

test("rmdir checks directory type and emptiness and supports parent removal", async () => {
  const fs = await fixture({ file: "x", "nonempty/file": "x" });
  assert.match((await run("rmdir", ["file"], { fs })).stderr, /ENOTDIR/u);
  assert.match((await run("rmdir", ["nonempty"], { fs })).stderr, /ENOTEMPTY/u);
  await fs.mkdir("/work/parents/child", { recursive: true });
  assert.equal((await run("rmdir", ["-p", "parents/child"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/parents"), { code: "ENOENT" });
  assert.equal((await fs.stat("/work")).type, "directory");
});

test("rmdir --ignore-fail-on-non-empty preserves contents and removes other empty operands", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" });
  await shell.use(agentCommands());
  const result = await shell.exec("mkdir sub empty; touch sub/input; rmdir --ignore-fail-on-non-empty sub empty");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutBytes, new Uint8Array());
  assert.deepEqual(result.stderrBytes, new Uint8Array());
  assert.equal((await fs.stat("/work/sub/input")).type, "file");
  await assert.rejects(fs.stat("/work/empty"), { code: "ENOENT" });
});

test("rmdir --ignore-fail-on-non-empty -p stops at a nonempty parent", async () => {
  const fs = await fixture({ "parents/kept": "data" });
  await fs.mkdir("/work/parents/child/leaf", { recursive: true });
  const result = await run("rmdir", ["--ignore-fail-on-non-empty", "-p", "parents/child/leaf"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  await assert.rejects(fs.stat("/work/parents/child"), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile("/work/parents/kept"), new TextEncoder().encode("data"));
});

for (const [operand, code] of [["missing", "ENOENT"], ["file", "ENOTDIR"], ["link", "ENOTDIR"]] as const) {
  test(`rmdir --ignore-fail-on-non-empty preserves ${code} for ${operand}`, async () => {
    const fs = await fixture({ file: "data", "nonempty/file": "kept" });
    await fs.symlink("nonempty", "/work/link");
    await fs.mkdir("/work/empty");
    const result = await run("rmdir", ["--ignore-fail-on-non-empty", "nonempty", operand, "empty"], { fs });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(code));
    assert.ok(!result.stderr.includes("ENOTEMPTY"));
    assert.equal(result.stdout, "");
    await assert.rejects(fs.stat("/work/empty"), { code: "ENOENT" });
    assert.equal((await fs.stat("/work/nonempty/file")).type, "file");
  });
}

for (const code of ["EACCES", "ENOTSUP", "EROFS", "ENOTEMPTY"] as const) {
  test(`rmdir --ignore-fail-on-non-empty preserves ${code} errors and cancellation`, async () => {
    const fs = await fixture({ "sub/input": "kept" });
    const controller = new AbortController();
    const reason = new FsError(code, { path: "/work/sub" });
    fs.rmdir = async () => { throw reason; };
    const result = await run("rmdir", ["--ignore-fail-on-non-empty", "sub"], { fs });
    assert.equal(result.exitCode, code === "ENOTEMPTY" ? 0 : 1);
    assert.equal(result.stderr === "", code === "ENOTEMPTY");
    fs.rmdir = async () => { controller.abort(reason); throw reason; };
    await assert.rejects(run("rmdir", ["--ignore-fail-on-non-empty", "sub"], { fs, signal: controller.signal }), error => error === reason);
    assert.equal((await fs.stat("/work/sub/input")).type, "file");
  });
}

for (const flags of ["-sr", "--symbolic --relative"]) {
  test(`ln ${flags} creates relative targets through Shell`, async () => {
    const fs = await fixture({ source: "data", "nested/input": "nested" });
    await fs.mkdir("/work/out");
    await fs.symlink("out", "/work/alias");
    await fs.symlink("source", "/work/source-alias");
    await fs.symlink("missing/child", "/work/missing-alias");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    for (const [source, destination, expected] of [
      ["source", "output", "source"],
      ["/work/source", "out/absolute", "../source"],
      ["source-alias", "alias/resolved", "../source"],
      ["missing/child", "out/dangling", "../missing/child"],
      ["missing-alias", "out/dangling-alias", "../missing/child"],
      ["out/../source", "out/dots", "../source"],
      ["out", "out/self", "."],
    ]) {
      const result = await shell.exec(`ln ${flags} ${source} ${destination}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(await fs.readlink(`/work/${destination}`), expected);
    }
    const result = await shell.exec(`ln ${flags} -v -t alias nested/input`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await fs.readlink("/work/out/input"), "../nested/input");
    assert.equal(result.stdout, "'alias/input' -> '../nested/input'\n");
    assert.deepEqual(await fs.readFile("/work/out/input"), await fs.readFile("/work/nested/input"));
    const replaced = await shell.exec(`ln ${flags} -f -b source out/input`);
    assert.equal(replaced.exitCode, 0, replaced.stderr);
    assert.equal(await fs.readlink("/work/out/input"), "../source");
    assert.equal(await fs.readlink("/work/out/input~"), "../nested/input");
  });
}

for (const option of ["-i", "--interactive", "-fi", "--force --interactive"]) {
  for (const answer of ["y\n", " Y es\n", "n\n", "", "\n"]) {
    test(`ln ${option} respects answer ${JSON.stringify(answer)} through Shell`, async () => {
      const fs = await fixture({ source: "SOURCE\n", dest: "DEST\n" });
      const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
      const result = await shell.exec(`ln ${option} source dest`, { stdin: answer });
      const accepted = answer.trimStart().startsWith("y") || answer.trimStart().startsWith("Y");
      assert.equal(result.exitCode, accepted ? 0 : 1, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "ln: replace 'dest'? ");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), accepted ? "SOURCE\n" : "DEST\n");
    });
  }
}

test("ln force after interactive and absent destinations do not read stdin", async () => {
  for (const args of [["-if"], ["--interactive", "--force"], ["-i", "-S", "if", "-f"]]) {
    const fs = await fixture({ source: "new", dest: "old" });
    const stdin = { async *[Symbol.asyncIterator]() { throw new Error("unexpected stdin read"); yield new Uint8Array(); } };
    const result = await run("ln", [...args, "source", "dest"], { fs, stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), "new");
  }
  const fs = await fixture({ source: "new" });
  const result = await run("ln", ["-i", "source", "dest"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("ln interactive directory links consume one answer per replacement and back up accepted entries", async () => {
  const fs = await fixture({ a: "new a", b: "new b", "out/a": "old a", "out/b": "old b" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("ln -sibv a b out", { stdin: "n\ny\n" });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stderr, "ln: replace 'out/a'? ln: replace 'out/b'? ");
  assert.equal(await fs.readlink("/work/out/b"), "b");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/a")), "old a");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/b~")), "old b");
  await assert.rejects(fs.stat("/work/out/a~"), { code: "ENOENT" });
  assert.equal(result.stdout, "'out/b' -> 'b'\n");
});

test("ln relative requires symbolic mode before replacing files", async () => {
  const fs = await fixture({ source: "data", output: "keep" });
  const result = await run("ln", ["-rf", "source", "output"], { fs });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "ln: cannot do --relative without --symbolic\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "keep");
});

for (const option of ["-L", "--logical", "-P", "--physical"]) {
  test(`ln ${option} accepts regular sources through Shell`, async () => {
    const fs = await fixture({ source: "data" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`ln ${option} source output`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal((await fs.stat("/work/output")).ino, (await fs.stat("/work/source")).ino);
  });
}

for (const [flags, logical] of [
  ["", false], ["-P", false], ["--physical", false],
  ["-L", true], ["--logical", true], ["-LP", false], ["-PL", true],
  ["--logical --physical", false], ["--physical --logical", true],
  ["-L -S P", true], ["-P -S L", false], ["-L -SP", true],
] as const) {
  test(`ln ${flags} selects the source symlink mode`, async () => {
    const fs = await fixture({ source: "data" });
    await fs.symlink("source", "/work/link");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`ln ${flags} link output`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.lstat("/work/output")).type, logical ? "file" : "symlink");
    assert.equal((await fs.lstat("/work/output")).ino,
      (await fs.lstat(logical ? "/work/source" : "/work/link")).ino);
  });
}

test("ln physical links dangling sources, logical replacement preserves destinations on failure", async () => {
  const fs = await fixture({ output: "old" });
  await fs.symlink("missing", "/work/link");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  assert.equal((await shell.exec("ln -Pf link output")).exitCode, 0);
  assert.equal(await fs.readlink("/work/output"), "missing");
  assert.equal((await shell.exec("ln -Lf link output")).exitCode, 1);
  assert.equal(await fs.readlink("/work/output"), "missing");
  assert.equal((await shell.exec("ln -Ls missing symbolic")).exitCode, 0);
  assert.equal(await fs.readlink("/work/symbolic"), "missing");
  assert.equal((await shell.exec("ln -Ps missing other")).exitCode, 0);
  assert.equal(await fs.readlink("/work/other"), "missing");
});

test("ln supports hardlinks and literal relative symbolic targets, replacement and target directories", async () => {
  const fs = await fixture({ source: "data" });
  await fs.mkdir("/work/out");
  assert.equal((await run("ln", ["source", "hard"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/hard")).ino, (await fs.stat("/work/source")).ino);
  assert.equal((await run("ln", ["-s", "../source", "out/symbolic"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/out/symbolic"), "../source");
  assert.equal((await run("ln", ["-sf", "missing", "out/symbolic"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/out/symbolic"), "missing");
  assert.equal((await run("ln", ["source", "out"], { fs })).exitCode, 0);
  assert.equal((await run("ln", ["-f", "missing", "source"], { fs })).exitCode, 1);
  assert.equal((await fs.stat("/work/source")).size, 4);
});

for (const option of [["-t", "target"], ["-ttarget"], ["--target-directory", "target"], ["--target-directory=target"]]) {
  test(`ln ${option.join(" ")} links every source into the selected directory`, async () => {
    const fs = await fixture({ input: "abc\n", "nested/other": "other" });
    await fs.mkdir("/work/target");
    const result = await run("ln", [...option, "input", "nested/other"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    for (const [source, destination] of [["input", "input"], ["nested/other", "other"]]) {
      assert.deepEqual(await fs.readFile(`/work/target/${destination}`), await fs.readFile(`/work/${source}`));
      assert.equal((await fs.stat(`/work/target/${destination}`)).ino, (await fs.stat(`/work/${source}`)).ino);
    }
  });
}

test("ln target-directory supports symbolic links and directory symlinks", async () => {
  const fs = await fixture({ input: "abc\n" });
  await fs.mkdir("/work/target");
  await fs.symlink("target", "/work/alias");
  const result = await run("ln", ["-sn", "-t", "alias", "missing"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await fs.readlink("/work/target/missing"), "missing");
});

test("ln target-directory refuses absent or non-directory destinations without replacing them", async () => {
  for (const target of ["missing", "file"]) {
    const fs = await fixture({ input: "abc\n", file: "kept" });
    const result = await run("ln", ["-f", "-t", target, "input"], { fs });
    assert.equal(result.exitCode, 1);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/file")), "kept");
    await assert.rejects(fs.stat("/work/missing"), { code: "ENOENT" });
  }
});

test("ln target-directory rejects missing arguments, missing sources and conflicting -T", async () => {
  const fs = await fixture({ input: "abc\n" });
  await fs.mkdir("/work/target");
  for (const args of [["-t"], ["-t", "target"], ["-Tt", "target", "input"], ["-t", "target", "-T", "input"]]) {
    assert.equal((await run("ln", args, { fs })).exitCode, 2);
  }
  assert.deepEqual(await fs.readdir("/work/target"), []);
});

test("ln numbered backups preserve replaced bytes and select the next number", async () => {
  const fs = await fixture({ input: "new\n", output: "old\n", "output.~2~": "older" });
  const result = await run("ln", ["-f", "--backup=numbered", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "new\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output.~3~")), "old\n");
  assert.equal((await fs.stat("/work/input")).ino, (await fs.stat("/work/output")).ino);
});

test("ln short backup aliases and suffix options replace without force", async () => {
  for (const args of [["-b"], ["-b", "-S", ".audit"], ["--backup", "--suffix=.audit"]]) {
    const fs = await fixture({ source: "new", dest: "old" });
    const result = await run("ln", [...args, "source", "dest"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/dest${args.length === 1 ? "~" : ".audit"}`)), "old");
  }
});

test("ln backs up symbolic entries and restores the destination after a failed link", async () => {
  const fs = await fixture({ source: "new", dest: "old" });
  const failed = await run("ln", ["-b", "missing", "dest"], { fs });
  assert.equal(failed.exitCode, 1);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), "old");
  await fs.symlink("missing", "/work/link");
  const result = await run("ln", ["-sb", "source", "link"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await fs.readlink("/work/link~"), "missing");
  assert.equal(await fs.readlink("/work/link"), "source");
});

test("ln honors backup environment controls and existing numbered backups", async () => {
  const fs = await fixture({ source: "new", dest: "old", "dest.~4~": "older" });
  assert.equal((await run("ln", ["-b", "source", "dest"], { fs })).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest.~5~")), "old");
  await fs.writeFile("/work/other", new TextEncoder().encode("previous"));
  const result = await run("ln", ["--backup", "source", "other"], { fs, env: { VERSION_CONTROL: "simple", SIMPLE_BACKUP_SUFFIX: ".saved" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/other.saved")), "previous");
});

test("ln disabled backups preserve existing destinations and invalid controls are usage errors", async () => {
  const fs = await fixture({ source: "new", dest: "old" });
  for (const args of [["--backup=none"], ["--backup=none", "--suffix=.saved"]]) {
    assert.equal((await run("ln", [...args, "source", "dest"], { fs })).exitCode, 1);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), "old");
  }
  assert.equal((await run("ln", ["--backup=invalid", "source", "dest"], { fs })).exitCode, 2);
});

test("ln restores a backup if hardlink creation fails after the rename", async () => {
  const backing = await fixture({ source: "new", dest: "old" });
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "link") return async () => { throw new FsError("EIO"); };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  assert.equal((await run("ln", ["-b", "source", "dest"], { fs })).exitCode, 1);
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/dest")), "old");
  await assert.rejects(backing.stat("/work/dest~"), { code: "ENOENT" });
});

for (const flags of ["-v", "--verbose", "-fv", "-f --verbose"]) {
  test(`ln ${flags} reports successful hard links using operand paths`, async () => {
    const fs = await fixture({ input: "new\n", ...flags.includes("f") ? { output: "old\n" } : {} });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`ln ${flags} input output`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "'output' => 'input'\n");
    assert.equal(result.stderr, "");
    assert.equal((await fs.stat("/work/output")).ino, (await fs.stat("/work/input")).ino);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "new\n");
    await assert.rejects(fs.stat("/work/output.~1~"), { code: "ENOENT" });
  });
}

test("ln verbose reports each successful directory link and stays silent for failures", async () => {
  const fs = await fixture({ first: "one", second: "two", "out/first": "existing" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("ln -v first second missing out");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "'out/second' => 'second'\n");
  assert.notEqual(result.stderr, "");
  assert.equal((await fs.stat("/work/out/second")).ino, (await fs.stat("/work/second")).ino);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/first")), "existing");
});

test("ln verbose distinguishes symbolic links and displays the implicit target", async () => {
  const fs = await fixture({ "sub/input": "data" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const symbolic = await shell.exec("ln -sv sub/input symbolic");
  assert.equal(symbolic.exitCode, 0, symbolic.stderr);
  assert.equal(symbolic.stdout, "'symbolic' -> 'sub/input'\n");
  assert.equal(await fs.readlink("/work/symbolic"), "sub/input");
  const implicit = await shell.exec("ln -v sub/input");
  assert.equal(implicit.exitCode, 0, implicit.stderr);
  assert.equal(implicit.stdout, "'./input' => 'sub/input'\n");
});

test("readlink and realpath distinguish literal targets, existing and missing paths", async () => {
  const fs = await fixture({ file: "x" });
  await fs.symlink("file", "/work/link");
  assert.equal((await run("readlink", ["-n", "link"], { fs })).stdout, "file");
  assert.equal((await run("readlink", ["-f", "link"], { fs })).stdout, "/work/file\n");
  assert.equal((await run("readlink", ["file"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["missing"], { fs })).stdout, "/work/missing\n");
  assert.equal((await run("realpath", ["-e", "missing"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["-mz", "absent/deep/file"], { fs })).stdout, "/work/absent/deep/file\0");
  await fs.mkdir("/work/deep/inside", { recursive: true });
  await fs.symlink("deep/inside", "/work/directory-link");
  assert.equal((await run("realpath", ["directory-link/.."], { fs })).stdout, "/work/deep\n");
  assert.match((await run("realpath", ["file/.."], { fs })).stderr, /ENOTDIR/u);
});

test("readlink canonicalize-missing resolves virtual paths and preserves output bytes", async () => {
  const fs = await fixture({ file: "x", "deep/inside/file": "x" });
  await fs.symlink("deep/inside", "/work/link");
  await fs.symlink("absent/target", "/work/dangling");
  await fs.symlink("cycle", "/work/cycle");
  const shell = new Shell({ fs, cwd: "/work" });
  await shell.use(agentCommands());
  const reproduced = await shell.exec("readlink -m missing");
  assert.equal(reproduced.exitCode, 0, reproduced.stderr);
  assert.equal(reproduced.stdout, "/work/missing\n");
  const operands = ["absent/deep/file", "link/../missing", "dangling/child", "file/child", "file/..", "absent/../link/file", "cycle/child", "/../../work/missing"];
  const paths = ["/work/absent/deep/file", "/work/deep/missing", "/work/absent/target/child", "/work/file/child", "/work", "/work/deep/inside/file", "/work/cycle/child", "/work/missing"];
  for (const flags of [["-m"], ["--canonicalize-missing"], ["-mz"], ["-mn"]]) {
    const result = await run("readlink", [...flags, ...operands], { fs });
    const separator = flags[0] === "-mz" ? "\0" : "\n";
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Buffer.from(paths.map(path => path + separator).join("")));
    assert.equal(result.stderr, flags[0] === "-mn" ? "readlink: ignoring --no-newline with multiple arguments\n" : "");
  }
  assert.equal((await run("readlink", ["-mn", "missing"], { fs })).stdout, "/work/missing");
  for (const flags of ["-em", "-fem", "-mem"]) assert.equal((await run("readlink", [flags, "absent/deep"], { fs })).stdout, "/work/absent/deep\n");
  for (const flags of ["-me", "-mf", "-emf"]) assert.equal((await run("readlink", [flags, "absent/deep"], { fs })).exitCode, 1);
  assert.equal((await run("readlink", ["-m", "--", "-missing"], { fs })).stdout, "/work/-missing\n");
});

test("readlink missing canonicalization bytes match the Linux oracle without host fixtures", { skip: process.platform !== "linux" }, async context => {
  const fs = await fixture({ "/dev/null": "" });
  await fs.mkdir("/proc/self", { recursive: true });
  await fs.symlink(process.cwd(), "/proc/self/cwd");
  const operands = ["/__poe_readlink_missing_170__/deep/../file", "/dev/null/child", "/dev/null/..", "/proc/self/cwd/__poe_readlink_missing_170__/../missing"];
  for (const flags of ["-m", "--canonicalize-missing", "-mz", "-mn", "-em", "-mem"]) {
    const native = spawnSync("readlink", [flags, ...operands], { timeout: 1000, env: { ...process.env, LC_ALL: "C", TZ: "UTC" } });
    if (native.error && "code" in native.error && native.error.code === "ENOENT") { context.skip("native readlink unavailable"); return; }
    assert.ifError(native.error);
    if (native.status !== 0 && native.stderr.toString().includes("illegal option")) { context.skip("native readlink lacks GNU -m support"); return; }
    const result = await run("readlink", [flags, ...operands], { fs });
    assert.equal(result.exitCode, native.status, native.stderr.toString());
    assert.deepEqual(result.stdoutBytes, native.stdout);
    assert.deepEqual(result.stderrBytes, native.stderr);
  }
});

test("readlink missing canonicalization preserves filesystem failures and cancellation", async context => {
  const fs = await fixture();
  context.mock.method(fs, "lstat", async () => { throw new FsError("EACCES", { path: "/work" }); });
  const denied = await run("readlink", ["-m", "missing"], { fs });
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.stdout, "");
  assert.ok(denied.stderr.includes("EACCES"));
  const controller = new AbortController();
  const reason = new Error("cancel canonicalization");
  context.mock.method(fs, "lstat", async () => { controller.abort(reason); throw new FsError("ENOENT"); });
  await assert.rejects(run("readlink", ["-m", "missing"], { fs, signal: controller.signal }), error => error === reason);
});

test("realpath strips symlinks and dot components lexically", async () => {
  const fs = await fixture({ input: "a", "deep/inside/file": "x" });
  await fs.symlink("deep/inside", "/work/link");
  await fs.symlink("missing", "/work/dangling");
  await fs.symlink("cycle", "/work/cycle");
  const shell = new Shell({ fs, cwd: "/work" });
  shell.use(agentCommands());
  const reproduced = await shell.exec("realpath -s --relative-to=. input");
  assert.equal(reproduced.exitCode, 0, reproduced.stderr);
  assert.equal(reproduced.stdout, "input\n");
  assert.equal(reproduced.stderr, "");
  for (const option of ["-s", "--strip", "--no-symlinks"]) {
    const result = await run("realpath", [option, "link", "link/../input", "absent/deep", "dangling", "//work///input", "/../../work/input"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "/work/link\n/work/input\n/work/absent/deep\n/work/dangling\n/work/input\n/work/input\n");
    assert.equal(result.stderr, "");
  }
  assert.equal((await run("realpath", ["-s", "cycle"], { fs })).stdout, "/work/cycle\n");
  assert.equal((await run("realpath", ["-sz", "--relative-to=link", "link/file"], { fs })).stdout, "file\0");
  assert.equal((await run("realpath", ["-sm", "--relative-base=absent", "absent/deep", "input"], { fs })).stdout, "deep\n/work/input\n");
  assert.equal((await run("realpath", ["-se", "link"], { fs })).stdout, "/work/link\n");
  assert.equal((await run("realpath", ["-se", "absent/deep"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["-se", "dangling"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["-se", "link/../input"], { fs })).stdout, "/work/input\n");
  for (const operand of ["input/", "input/..", "absent/../input"]) {
    assert.equal((await run("realpath", ["-se", operand], { fs })).exitCode, 1, operand);
  }
  for (const operand of ["input/child", "input/", "input/..", "absent/../input", "absent/."]) {
    assert.equal((await run("realpath", ["-s", operand], { fs })).exitCode, 1, operand);
  }
  assert.equal((await run("realpath", ["-sm", "input/..", "absent/../input"], { fs })).stdout, "/work\n/work/input\n");
  assert.equal((await run("realpath", ["-s", ""], { fs })).exitCode, 1);
});

test("realpath lexical output bytes match the GNU oracle", async context => {
  const cases = [
    ["-s", "--relative-to=.", "input"],
    ["--strip", "link", "absent/deep", "//work///input"],
    ["-sm", "link/../input", "//work///input/.", "/../../work/input"],
    ["--no-symlinks", "--relative-base=absent", "absent/deep", "input"],
    ["-sz", "--relative-to=link", "link/file", "link"],
    ["-sm", "--relative-to=absent", "absent/deep"],
  ];
  const fs = await fixture({ input: "a", "deep/inside/file": "x" });
  await fs.symlink("deep/inside", "/work/link");
  for (const args of cases) {
    // Absolute virtual paths make lexical resolution independent of host fixtures.
    const nativeArgs = args.map(arg => arg.startsWith("--relative-")
      ? arg.replace("=.", "=/work").replace("=absent", "=/work/absent").replace("=link", "=/work/link")
      : arg.startsWith("-") || arg.startsWith("/") ? arg : `/work/${arg}`);
    const native = spawnSync("realpath", nativeArgs, { timeout: 1000, env: { ...process.env, LC_ALL: "C", TZ: "UTC" } });
    if (native.error && "code" in native.error && native.error.code === "ENOENT") { context.skip("native realpath unavailable"); return; }
    assert.ifError(native.error);
    if (native.status !== 0 && native.stderr.toString().startsWith("realpath: illegal option -- s")) { context.skip("native realpath lacks GNU -s support"); return; }
    const result = await run("realpath", args, { fs });
    assert.equal(result.exitCode, native.status, `${JSON.stringify(nativeArgs)}: ${native.stderr.toString()}`);
    assert.deepEqual(result.stdoutBytes, native.stdout);
    assert.deepEqual(result.stderrBytes, native.stderr);
  }
});

test("ls implements hidden names, classification, explicit directories, recursion and long records", async () => {
  const fs = await fixture({ zebra: "z", alpha: "a", ".hidden": "h", "nested/file": "x" });
  await fs.symlink("alpha", "/work/link");
  assert.equal((await run("ls", [], { fs })).stdout, "alpha\nlink\nnested\nzebra\n");
  assert.equal((await run("ls", ["-AF"], { fs })).stdout, ".hidden\nalpha\nlink@\nnested/\nzebra\n");
  assert.equal((await run("ls", ["-d", "nested"], { fs })).stdout, "nested\n");
  assert.match((await run("ls", ["-a"], { fs })).stdout, /^\.\n\.\.\n\.hidden\n/u);
  assert.match((await run("ls", ["-R", "nested"], { fs })).stdout, /^nested:\nfile\n$/u);
  assert.match((await run("ls", ["-l", "link"], { fs })).stdout, /^lrwxrwxrwx .* link -> alpha\n$/u);
  assert.equal((await run("ls", ["--made-up"], { fs })).exitCode, 2);
});

test("ls, readlink, and ln -sf handle symlinks pointing through regular files or loops", async () => {
  const fs = await fixture({});
  await fs.mkdir("/d/sub", { recursive: true });
  await fs.writeFile("/d/real_file", new TextEncoder().encode("hello"));
  await fs.symlink("real_file/sub", "/d/broken_enotdir");
  await fs.symlink("loop", "/d/loop");
  const sh = new Shell({ fs, cwd: "/" }).use(agentCommands());

  const lsDir = await sh.exec("ls /d");
  assert.equal(lsDir.exitCode, 0, lsDir.stderr);
  assert.equal(lsDir.stdout, "broken_enotdir\nloop\nreal_file\nsub\n");

  const lsLongF = await sh.exec("ls -lF /d");
  assert.equal(lsLongF.exitCode, 0, lsLongF.stderr);
  assert.match(lsLongF.stdout, /broken_enotdir -> real_file\/sub\n/u);
  assert.match(lsLongF.stdout, /loop -> loop\n/u);

  const lsLoop = await sh.exec("ls /d/loop");
  assert.equal(lsLoop.exitCode, 0, lsLoop.stderr);
  assert.equal(lsLoop.stdout, "/d/loop\n");

  assert.equal((await sh.exec("readlink /d/broken_enotdir")).stdout, "real_file/sub\n");
  assert.equal((await sh.exec("readlink /d/loop")).stdout, "loop\n");

  assert.equal((await sh.exec("ln -sf real_file /d/broken_enotdir")).exitCode, 0);
  assert.equal((await sh.exec("ln -sf real_file /d/loop")).exitCode, 0);
});

test("readlink -v/-q/-s, realpath -s -P ordering, and ls --file-type/-B/--sort=none|name|extension|version", async () => {
  const vfs = await fixture({ file: "x", "backup~": "y", "a.txt": "1", "b.md": "2" });
  await vfs.symlink("file", "/work/link");
  assert.equal((await run("readlink", ["file"], { fs: vfs })).stderr, "");
  assert.notEqual((await run("readlink", ["-v", "file"], { fs: vfs })).stderr, "");
  assert.equal((await run("readlink", ["-v", "-q", "file"], { fs: vfs })).stderr, "");
  assert.equal((await run("realpath", ["-s", "-P", "link"], { fs: vfs })).stdout, "/work/file\n");
  assert.match((await run("ls", ["--file-type"], { fs: vfs })).stdout, /link@/u);
  assert.doesNotMatch((await run("ls", ["-B"], { fs: vfs })).stdout, /backup~/u);
  assert.equal((await run("ls", ["--sort=extension", "a.txt", "b.md"], { fs: vfs })).stdout, "b.md\na.txt\n");
});

test("#630: chmod rejects parent symlink swap between inspection and mutation", async () => {
  const fs = await fixture({});
  await fs.mkdir("/work/sub", { recursive: true });
  await fs.mkdir("/private", { recursive: true });
  await fs.writeFile("/work/sub/a", new Uint8Array(), { mode: 0o644 });
  await fs.writeFile("/private/a", new Uint8Array(), { mode: 0o600 });
  const origChmod = fs.chmod.bind(fs);
  fs.chmod = async (path, mode, options) => {
    if (path === "/work/sub/a") {
      await fs.rename("/work/sub", "/work/held");
      await fs.symlink("/private", "/work/sub");
      try {
        return await origChmod(path, mode, options);
      } finally {
        await fs.rm("/work/sub");
        await fs.rename("/work/held", "/work/sub");
      }
    }
    return origChmod(path, mode, options);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("chmod 777 sub/a");
    assert.notEqual(result.exitCode, 0);
    assert.equal((await fs.lstat("/private/a")).mode & 0o777, 0o600);
    assert.equal((await fs.lstat("/work/sub/a")).mode & 0o777, 0o644);
  } finally {
    await shell.dispose();
  }
});

test("#701: rm -r rejects parent symlink swap between inspection and deletion", async () => {
  const fs = await fixture({});
  await fs.mkdir("/work/sub/tree", { recursive: true });
  await fs.mkdir("/private/tree", { recursive: true });
  await fs.writeFile("/work/sub/tree/a", Buffer.from("safe"));
  await fs.writeFile("/private/tree/a", Buffer.from("secret"));
  const origRm = fs.rm.bind(fs);
  fs.rm = async (path, options) => {
    if (path === "/work/sub/tree") {
      await fs.rename("/work/sub", "/work/held");
      await fs.symlink("/private", "/work/sub");
      try {
        return await origRm(path, options);
      } finally {
        await fs.rm("/work/sub");
        await fs.rename("/work/held", "/work/sub");
      }
    }
    return origRm(path, options);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("rm -r sub/tree");
    assert.notEqual(result.exitCode, 0);
    assert.equal(Buffer.from(await fs.readFile("/private/tree/a")).toString(), "secret");
    assert.equal(Buffer.from(await fs.readFile("/work/sub/tree/a")).toString(), "safe");
  } finally {
    await shell.dispose();
  }
});

test("#709: ls reuses directory listing metadata on S3 and bounds backend transport calls by maxFileSystemOperations", async () => {
  const { MockS3Client, S3FileSystem, MountFileSystem } = await import("@poe-code/safe-fs");
  const observedCalls: number[] = [];
  for (const count of [6, 16]) {
    const transport = new MockS3Client({ buckets: ["bucket"] });
    for (let index = 0; index < count; index++) {
      await transport.putObject({ Bucket: "bucket", Key: `item-${String(index).padStart(2, "0")}`, Body: new Uint8Array([1]) });
    }
    const s3 = new S3FileSystem({ transport, bucket: "bucket" });
    const mounted = new MountFileSystem({ root: s3 });
    const sh = new Shell({ fs: mounted, cwd: "/", limits: { maxFileSystemOperations: 100 } }).use(agentCommands());
    const start = transport.requests.length;
    const result = await sh.exec("ls /");
    assert.equal(result.exitCode, 0, result.stderr);
    const backendCalls = transport.requests.length - start;
    assert.ok(backendCalls <= 10, `expected <= 10 S3 backend calls for ls / with ${count} objects, got ${backendCalls}`);
    observedCalls.push(backendCalls);
  }
  assert.equal(observedCalls[0], observedCalls[1]);

  const transport = new MockS3Client({ buckets: ["bucket"] });
  for (let index = 0; index < 16; index++) {
    await transport.putObject({ Bucket: "bucket", Key: `item-${String(index).padStart(2, "0")}`, Body: new Uint8Array([1]) });
  }
  const s3 = new S3FileSystem({ transport, bucket: "bucket" });
  const mounted = new MountFileSystem({ root: s3 });
  const sh = new Shell({ fs: mounted, cwd: "/", limits: { maxFileSystemOperations: 20 } }).use(agentCommands());
  const start = transport.requests.length;
  await assert.rejects(() => sh.exec("ls -l /"), /maxFileSystemOperations/u);
  assert.ok(transport.requests.length - start <= 20);
});
