import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { withFileSystemQuota } from "poe-code/safe-fs";
import { FsError, toByteSource, type FileSystem } from "../../src/contracts/index.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

function observe(fs: FileSystem, refuse = false) {
  const calls: { method: string; path: string }[] = [];
  const view = new Proxy(fs, { get(target, property) {
    const original: unknown = Reflect.get(target, property);
    if (typeof original !== "function") return original;
    return (...args: unknown[]) => {
      if (typeof args[0] === "string" && typeof property === "string") calls.push({ method: property, path: args[0] });
      if (refuse && property === "canonicalizeMissingTarget") return undefined;
      return Reflect.apply(original, target, args);
    };
  } });
  return { view, calls };
}

async function execute(
  fs: FileSystem, args: string[], signal = new AbortController().signal,
  output = { stdout: "", stderr: "" }, command = "realpath",
) {
  const definition = filesystemCommands().find(candidate => candidate.name === command);
  assert.ok(definition);
  const decoder = new TextDecoder();
  const result = await definition.execute({
    command, args, fs, cwd: "/", env: {}, signal, stdin: toByteSource(""),
    stdout: { async write(chunk) { output.stdout += decoder.decode(chunk); } },
    stderr: { async write(chunk) { output.stderr += decoder.decode(chunk); } },
  });
  return { ...result, ...output };
}

test("realpath -m admits the owned resolver without redundant missing-prefix calls", async () => {
  const fs = createMemoryFileSystem();
  const observed = observe(fs);
  const path = `/${Array<string>(64).fill("absent").join("/")}`;
  const result = await execute(observed.view, ["-m", path]);
  assert.deepEqual(result, { exitCode: 0, stdout: `${path}\n`, stderr: "" });
  assert.deepEqual(observed.calls, [
    { method: "lstat", path }, { method: "canonicalizeMissingTarget", path },
  ]);
});

for (const option of ["--relative-to", "--relative-base"]) {
  test(`realpath -m admits owned resolution for ${option}`, async () => {
    const observed = observe(createMemoryFileSystem());
    const result = await execute(observed.view, ["-m", `${option}=/missing/deeper`, "/"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, option === "--relative-to" ? "../..\n" : "/\n");
    assert.equal(observed.calls.filter(call => call.method === "realpath").length, 0);
    assert.equal(observed.calls.filter(call => call.method === "canonicalizeMissingTarget" && call.path === "/missing/deeper").length, option === "--relative-to" ? 1 : 2);
  });
}

for (const phase of ["descent", "reconstruction"]) {
  test(`realpath -m fallback yields during ${phase} and preserves output before cancellation`, async () => {
    const fs = createMemoryFileSystem();
    const observed = observe(fs, true);
    const realpath = fs.realpath.bind(fs);
    const controller = new AbortController();
    const reason = phase === "reconstruction" ? 0 : { phase };
    let handle: ReturnType<typeof setImmediate> | undefined;
    let calls = 0;
    fs.realpath = async (path, options) => {
      calls++;
      if (handle === undefined && (phase === "descent" ? path !== "/" : path === "/" && calls > 1)) {
        handle = setImmediate(() => controller.abort(reason));
      }
      return realpath(path, options);
    };
    const output = { stdout: "", stderr: "" };
    try {
      await assert.rejects(execute(observed.view, ["-m", "/", `/${Array<string>(96).fill("missing").join("/")}`], controller.signal, output), error => error === reason);
      assert.equal(output.stdout, "/\n");
      assert.equal(output.stderr, "");
      if (phase === "descent") assert.ok(calls < 97, `processed all ${calls} calls before cancellation`);
      else assert.equal(calls, 98);
    } finally { if (handle !== undefined) clearImmediate(handle); }
  });
}

for (const reason of [false, 0, "", null]) {
  test(`realpath -m preserves ${JSON.stringify(reason)} cancellation from the owned hook`, async () => {
    const fs = createMemoryFileSystem();
    const controller = new AbortController();
    fs.canonicalizeMissingTarget = () => { controller.abort(reason); return "/not-output"; };
    await assert.rejects(execute(fs, ["-m", "/missing"], controller.signal), error => error === reason);
  });
}

test("realpath -m pre-abort does not invoke the filesystem", async () => {
  const observed = observe(createMemoryFileSystem());
  const controller = new AbortController();
  controller.abort(false);
  await assert.rejects(execute(observed.view, ["-m", "/missing"], controller.signal), error => error === false);
  assert.deepEqual(observed.calls, []);
});

test("realpath -m retains preliminary lstat errors before the hook", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array());
  const observed = observe(fs);
  const result = await execute(observed.view, ["-m", "/file/child"]);
  assert.deepEqual(result, { exitCode: 1, stdout: "", stderr: "realpath: ENOTDIR: not a directory, lstat '/file/child'\n" });
  assert.deepEqual(observed.calls, [{ method: "lstat", path: "/file/child" }]);
});

test("realpath -m preserves a hook refusal error without trying fallback", async () => {
  const fs = createMemoryFileSystem();
  const refusal = new FsError("ENOTSUP", { syscall: "realpath", path: "/missing" });
  fs.canonicalizeMissingTarget = () => { throw refusal; };
  const observed = observe(fs);
  const result = await execute(observed.view, ["-m", "/missing", "/"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `realpath: ${refusal.message}\nrealpath: ${refusal.message}\n`);
  assert.equal(observed.calls.filter(call => call.method === "realpath").length, 0);
});

test("realpath -m honors undefined-hook refusal and quota masking", async () => {
  const stock = createMemoryFileSystem();
  const refused = observe(stock, true);
  const masked = observe(withFileSystemQuota(stock, { maxBytes: 1 }));
  for (const observed of [refused, masked]) {
    const result = await execute(observed.view, ["-m", "/missing/child"]);
    assert.deepEqual(result, { exitCode: 0, stdout: "/missing/child\n", stderr: "" });
    assert.deepEqual(observed.calls.filter(call => call.method === "realpath").map(call => call.path), ["/missing/child", "/missing", "/"]);
  }
  assert.equal(masked.calls.some(call => call.method === "canonicalizeMissingTarget"), false);
});

for (const method of ["realpath", "lstat"] as const) {
  test(`realpath -m respects stock hook refusal for an own ${method} override`, async () => {
    const fs = createMemoryFileSystem();
    const refusal = new FsError("ENOTSUP", { syscall: method, path: "/missing" });
    if (method === "realpath") {
      const original = fs.realpath.bind(fs);
      fs.realpath = async (path, options) => {
        if (path === "/missing") throw refusal;
        return original(path, options);
      };
    } else {
      const original = fs.lstat.bind(fs);
      fs.lstat = async (path, options) => {
        if (path === "/missing") throw refusal;
        return original(path, options);
      };
    }
    assert.equal(fs.canonicalizeMissingTarget("/missing/child"), undefined);
    const observed = observe(fs);
    const result = await execute(observed.view, ["-m", "/missing/child"]);
    assert.deepEqual(result, { exitCode: 1, stdout: "", stderr: `realpath: ${refusal.message}\n` });
    assert.deepEqual(observed.calls, [
      { method: "lstat", path: "/missing/child" },
      { method: "canonicalizeMissingTarget", path: "/missing/child" },
      { method: "realpath", path: "/missing/child" },
      { method: "lstat", path: "/missing/child" },
      { method: "realpath", path: "/missing" },
      ...(method === "lstat" ? [{ method: "lstat", path: "/missing" }] : []),
    ]);
  });
}

test("realpath -m does not yield away an immediate fatal fallback error", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const fatal = new FsError("EACCES", { syscall: "realpath", path: "/missing" });
  let handle: ReturnType<typeof setImmediate> | undefined;
  fs.realpath = async () => {
    handle = setImmediate(() => controller.abort("later cancellation"));
    throw fatal;
  };
  try {
    const result = await execute(fs, ["-m", "/missing"], controller.signal);
    assert.deepEqual(result, { exitCode: 1, stdout: "", stderr: `realpath: ${fatal.message}\n` });
    assert.equal(controller.signal.aborted, false);
  } finally { if (handle !== undefined) clearImmediate(handle); }
});

test("realpath -m owned and fallback paths preserve legacy dot-dot, links and slash folds", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/existing/child", { recursive: true });
  await fs.symlink("/existing/child", "/link");
  await fs.symlink("/absent", "/dangling");
  const cases = [
    ["/existing/child", "/existing/child"], ["/missing/deeper", "/missing/deeper"],
    ["/link/../new", "/existing/new"], ["/missing/../link/new", "/link/new"],
    ["/existing/child/", "/existing/child"], ["/dangling/", "/dangling"],
    ["//missing//../new/.", "/new"], ["/missing/../../new", "/new"],
  ];
  for (const [path, expected] of cases) {
    assert.ok(path);
    for (const view of [fs, observe(fs, true).view]) {
      assert.deepEqual(await execute(view, ["-m", path]), { exitCode: 0, stdout: `${expected}\n`, stderr: "" });
    }
  }
  for (const view of [fs, observe(fs, true).view]) {
    const result = await execute(view, ["-m", "/dangling", "/dangling/child", "/"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "/\n");
    assert.equal(result.stderr, "realpath: ENOENT: no such file or directory, realpath '/dangling'\n".repeat(2));
  }
});

test("realpath -m preserves the small native lexical corpus", async context => {
  const paths = ["/", "/.__realpath_645_absent__/child", "/.__realpath_645_absent__/../other"];
  const native = spawnSync("realpath", ["-m", ...paths], { encoding: "utf8", timeout: 1000, env: { ...process.env, LC_ALL: "C" } });
  if (native.error && "code" in native.error && native.error.code === "ENOENT") { context.skip("native realpath unavailable"); return; }
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  if (native.status === 1 && native.stdout === "" && native.stderr.startsWith("realpath: illegal option -- m\n")) {
    context.skip("native realpath lacks -m support"); return;
  }
  assert.equal(native.status, 0, native.stderr);
  const result = await execute(createMemoryFileSystem(), ["-m", ...paths]);
  assert.deepEqual(result, { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
});

test("realpath -e and unsupported readlink -m do not admit the missing hook", async () => {
  const observed = observe(createMemoryFileSystem());
  assert.equal((await execute(observed.view, ["-e", "/missing"])).exitCode, 1);
  assert.equal((await execute(observed.view, ["-m", "/missing"], undefined, undefined, "readlink")).exitCode, 2);
  assert.equal(observed.calls.some(call => call.method === "canonicalizeMissingTarget"), false);
});
