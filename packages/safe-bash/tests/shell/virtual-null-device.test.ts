import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { metadataCommands } from "../../src/commands/metadata/index.js";
import { fileCommands } from "../../src/commands/file/index.js";
import { createDuCommand } from "../../src/commands/du/index.js";
import type { FileStat, FileSystem, FsOptions } from "../../src/contracts/index.js";
import { MountFileSystem, ReadOnlyFileSystem } from "poe-code/safe-fs/core";
import { predicateCommands } from "../../src/commands/predicates.js";
import { agentCommands } from "../../src/plugins/index.js";
import { collectBytes, FsError, toByteSource } from "../../src/contracts/index.js";
import { safeJsCommands } from "../../src/commands/safejs/index.js";
import { contractRuntime } from "../commands/safejs/helpers.js";
import { networkCommands } from "../../src/commands/network/index.js";

function fixture(context: TestContext, fs = new MemoryFileSystem()) {
  const shell = new Shell({ fs }).use(standardCommands()).use(metadataCommands()).use(fileCommands());
  shell.register(createDuCommand());
  context.after(() => shell.dispose());
  return { shell, fs };
}

test("null device discards redirects and command writes without mutating historical backing rows", async context => {
  const { shell, fs } = fixture(context);
  await fs.mkdir("/dev");
  await fs.writeFile("/dev/null", new TextEncoder().encode("historical diagnostics"));
  await fs.writeFile("/input", new TextEncoder().encode("payload"));
  const mutations: string[] = [];
  for (const method of ["writeFile", "appendFile", "writeStream", "copyFile", "rm", "rename"] as const) {
    const original = fs[method].bind(fs);
    context.mock.method(fs, method, (...args: unknown[]) => {
      mutations.push(`${method}:${String(args[0])}`);
      return Reflect.apply(original, fs, args);
    });
  }
  const result = await shell.exec("missing700 2>/dev/null; printf discard >/dev/null; printf append >>/dev/null; cat /dev/null; printf tee | tee /dev/null; cp /input /dev/null; cp -f /input /dev/null; cat /dev/null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "tee");
  assert.equal(result.stderr, "");
  assert.deepEqual(mutations, []);
  assert.equal(new TextDecoder().decode(await fs.readFile("/dev/null")), "historical diagnostics");
});

test("fresh null device exists through overrides, relative paths, aliases and nested commands", async context => {
  const { shell, fs } = fixture(context);
  const override = new MemoryFileSystem();
  await override.mkdir("/work");
  await override.symlink("/dev/null", "/alias");
  const result = await shell.exec("printf hidden >../dev/./null; printf alias >/alias; sh -c 'cat /dev/null; printf nested >/dev/null'; value=$(cat /alias); (cat /dev/null); printf '<%s>' \"$value\"", { fs: override, cwd: "/work" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "<>");
  assert.equal(result.stderr, "");
  await assert.rejects(override.stat("/dev/null"), { code: "ENOENT" });
  await assert.rejects(fs.stat("/dev"), { code: "ENOENT" });
});

test("null device has character metadata and is never classified as a regular file", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("test -c /dev/null && test ! -f /dev/null && test -r /dev/null && test -w /dev/null && test ! -x /dev/null && stat -c '%F|%A|%a|%f|%s' /dev/null; find /dev -type c; find /dev -type f; file -b /dev/null; file -b --mime-type /dev/null; ls -l /dev/null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.startsWith("character special file|crw-rw-rw-|666|21b6|0\n/dev/null\ncharacter special\ninode/chardevice\n"), result.stdout);
  assert.ok(result.stdout.split("\n").some(line => line.startsWith("crw-rw-rw- ")), result.stdout);
});

test("null directory listings merge siblings without duplicates or backing allocation", async context => {
  const { shell, fs } = fixture(context);
  assert.equal((await shell.exec("ls /dev")).stdout, "null\n");
  await assert.rejects(fs.stat("/dev"), { code: "ENOENT" });
  await fs.mkdir("/dev");
  await fs.writeFile("/dev/null", new Uint8Array([1]));
  await fs.writeFile("/dev/sibling", new Uint8Array([2]));
  assert.equal((await shell.exec("ls /dev")).stdout, "null\nsibling\n");
  assert.equal((await shell.exec("ls /")).stdout, "dev\n");
});

test("regular file copies, identity and capabilities survive the root device view", async context => {
  const { shell, fs } = fixture(context);
  await fs.writeFile("/input", new TextEncoder().encode("ordinary"));
  await fs.link("/input", "/alias");
  const before = await fs.stat("/input");
  const backing: FileSystem = fs;
  shell.register({ name: "inspect-view", async execute(command) {
    assert.deepEqual(await command.fs.stat("/input"), before);
    assert.deepEqual(await command.fs.capabilitiesFor?.("/input") ?? command.fs.capabilities, await backing.capabilitiesFor?.("/input") ?? backing.capabilities);
    return { exitCode: 0 };
  } });
  const result = await shell.exec("inspect-view && test /input -ef /alias && test -f /input && cp /input /copy && cat /copy");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "ordinary");
  const after = await fs.stat("/input");
  assert.equal(after.identityScope, before.identityScope);
  assert.equal(after.ino, before.ino);
  assert.equal(after.dev, before.dev);
  assert.equal(after.nlink, before.nlink);
});

test("directory commands classify existing device entries before mutation admission", async context => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/existing");
  await backing.symlink("/dev", "/device-directory");
  await backing.symlink("/dev/null", "/device-file");
  const shell = new Shell({ fs: new ReadOnlyFileSystem(backing) }).use(standardCommands());
  context.after(() => shell.dispose());
  for (const source of ["mkdir -p /dev", "mkdir -p /device-directory", "mkdir -p /existing"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, `${source}: ${result.stderr}`);
    assert.equal(result.stderr, "");
  }
  for (const [source, code] of [
    ["mkdir -p /dev/null", "EEXIST"], ["mkdir -p /device-file", "EEXIST"],
    ["rmdir /dev/null", "ENOTDIR"], ["rmdir /device-file", "ENOTDIR"],
    ["mkdir /new", "EROFS"], ["rmdir /existing", "EROFS"],
  ] as const) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1, source);
    assert.ok(result.stderr.includes(code), `${source}: ${result.stderr}`);
  }
  await assert.rejects(backing.stat("/dev"), { code: "ENOENT" });
  await assert.rejects(backing.stat("/new"), { code: "ENOENT" });
  assert.equal((await backing.stat("/existing")).type, "directory");
});

test("forced compression replacement admits the ordinary destination capability", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  context.after(() => shell.dispose());
  await fs.writeFile("/input", new TextEncoder().encode("payload"));
  await fs.writeFile("/input.gz", new TextEncoder().encode("previous"));
  const result = await shell.exec("gzip -fk /input && zcat /input.gz");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "payload");
  assert.equal(new TextDecoder().decode(await fs.readFile("/input")), "payload");
});

for (const permissions of [true, false, undefined]) test(`path permission admission requires explicit true: ${String(permissions)}`, async context => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/tmp");
  await backing.writeFile("/tool", new TextEncoder().encode("printf executed"), { mode: 0o755 });
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilitiesFor") return async () => ({ ...target.capabilities, permissions });
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const shell = new Shell({ fs, env: { PATH: "/" } }).use(standardCommands()).use(metadataCommands());
  context.after(() => shell.dispose());
  for (const source of ["tool", "/tool", "[[ -r /tool ]]", "mktemp /tmp/private.XXXXXX"]) {
    const result = await shell.exec(source);
    if (permissions === true) assert.equal(result.exitCode, 0, `${source}: ${result.stderr}`);
    else {
      assert.notEqual(result.exitCode, 0, source);
      assert.ok(result.stderr.includes("permission"), `${source}: ${result.stderr}`);
      assert.equal(result.stdout, "");
    }
  }
  if (permissions !== true) assert.deepEqual(await backing.readdir("/tmp"), []);
});

test("patch admission preserves declared ordinary permission failures", async context => {
  const backing = new MemoryFileSystem();
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "access") return async () => { throw new FsError("ENOTSUP"); };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const shell = new Shell({ fs }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("apply_patch '*** Begin Patch\n*** Add File: new\n+created\n*** End Patch'");
  assert.equal(result.exitCode, 1, result.stdout);
  assert.equal(result.stderr, "apply_patch: operation not supported: /\n");
  assert.deepEqual(await backing.readdir("/"), []);
});

test("null writes stay available while ordinary paths retain backing read-only capabilities", async context => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/input", new TextEncoder().encode("retained"));
  const fs = new ReadOnlyFileSystem(backing);
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  const discard = await shell.exec("printf discarded >/dev/null; cat /input; printf tee | tee -a /dev/null; cp /input /dev/null");
  assert.equal(discard.exitCode, 0, discard.stderr);
  assert.equal(discard.stdout, "retainedtee");
  assert.equal(discard.stderr, "");
  const denied = await shell.exec("printf changed >/input");
  assert.notEqual(denied.exitCode, 0);
  assert.equal(new TextDecoder().decode(await backing.readFile("/input")), "retained");
  await assert.rejects(backing.stat("/dev"), { code: "ENOENT" });
});

for (const source of ["cat /input", "head /input", "cat < /input", "split /input /piece", "sort /input -o /sorted"]) {
  test(`ordinary buffered capability survives the mixed device view: ${source}`, async context => {
    const backing = new MemoryFileSystem();
    await backing.writeFile("/input", new TextEncoder().encode("b\na\n"));
    let streamCalls = 0;
    const fs = new Proxy(backing, {
      get(target, property) {
        const capabilities = { ...target.capabilities, streamingRead: false, streamingWrite: false };
        if (property === "capabilities") return capabilities;
        if (property === "capabilitiesFor") return async () => capabilities;
        if (property === "readStream" || property === "writeStream") return () => { streamCalls++; throw new Error("declared-disabled stream"); };
        const member = Reflect.get(target, property);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const shell = new Shell({ fs }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(streamCalls, 0);
    if (source.startsWith("split")) assert.equal(new TextDecoder().decode(await backing.readFile("/pieceaa")), "b\na\n");
    else if (source.startsWith("sort")) assert.equal(new TextDecoder().decode(await backing.readFile("/sorted")), "a\nb\n");
    else assert.equal(result.stdout, "b\na\n");
    const bounded = await shell.exec("gzip -c /input");
    assert.equal(bounded.exitCode, 1);
    assert.ok(bounded.stderr.includes("ENOTSUP"), bounded.stderr);
    assert.equal(streamCalls, 0);
  });
}

test("cross-mount moves preserve ordinary directory permissions and timestamps", async context => {
  const origin = new MemoryFileSystem();
  const destination = new MemoryFileSystem();
  await origin.mkdir("/directory", { mode: 0o751 });
  await origin.utimes("/directory", 123000, 456000);
  const shell = new Shell({ fs: new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/origin": origin, "/destination": destination } }) }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("mv /origin/directory /destination/directory");
  assert.equal(result.exitCode, 0, result.stderr);
  const stat = await destination.stat("/directory");
  assert.equal(stat.mode & 0o7777, 0o751);
  assert.equal(stat.mtimeMs, 456000);
  await assert.rejects(origin.stat("/directory"), { code: "ENOENT" });
});

for (const source of ["join /input /input", "diff /input /input", "html-to-markdown /input", "rg -F a /input", "safejs /input", "curl --data-binary @/input https://example.test/"]) {
  test(`absent optional reader retains bounded ordinary fallback: ${source}`, async context => {
    const backing = new MemoryFileSystem();
    await backing.writeFile("/input", new TextEncoder().encode("a\nb\n"));
    const readLimits: number[] = [];
    const fs = new Proxy(backing, {
      get(target, property) {
        const capabilities = { ...target.capabilities, streamingRead: false, streamingWrite: false };
        if (property === "capabilities") return capabilities;
        if (property === "capabilitiesFor") return async () => capabilities;
        if (property === "readStream" || property === "writeStream") return undefined;
        if (property === "readFile") return async (path: string, options?: Parameters<FileSystem["readFile"]>[1]) => {
          assert.ok(typeof options?.maxBytes === "number" && Number.isFinite(options.maxBytes));
          readLimits.push(options.maxBytes);
          return target.readFile(path, options);
        };
        const member = Reflect.get(target, property);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const shell = new Shell({ fs }).use(agentCommands()).use(safeJsCommands({ runtime: contractRuntime(async value => {
      assert.equal(value, "a\nb\n");
    }) })).use(networkCommands({
      authorize: () => true,
      async transport(request) {
        assert.equal(new TextDecoder().decode(await collectBytes(request.body!, { signal: request.signal, maxBytes: 16 })), "a\nb\n");
        return { status: 200, statusText: "OK", headers: [], body: toByteSource("accepted"), async dispose() {} };
      },
    }));
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(readLimits.length > 0);
  });
}

test("reserved null replacement and descendants cannot bypass the Shell device view", async context => {
  const { shell, fs } = fixture(context);
  await fs.mkdir("/dev");
  await fs.writeFile("/dev/null", new TextEncoder().encode("historical"));
  await fs.writeFile("/input", new TextEncoder().encode("ordinary"));
  for (const command of ["rm /dev/null", "mv /input /dev/null", "mv /dev/null /moved", "printf child >/dev/null/child", "rm -r /dev"]) {
    const result = await shell.exec(command);
    assert.notEqual(result.exitCode, 0, command);
    assert.equal((await shell.exec("cat /dev/null")).stdout, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/dev/null")), "historical");
  }
  assert.equal(new TextDecoder().decode(await fs.readFile("/input")), "ordinary");
});

test("null-device traversal is rejected before lexical normalization can publish another path", async context => {
  const { shell, fs } = fixture(context);
  await fs.writeFile("/input", new TextEncoder().encode("ordinary"));
  await fs.symlink("/dev/null", "/alias");
  for (const path of ["/dev/null/../../escaped", "/alias/../escaped"]) {
    for (const command of [`printf leaked >${path}`, `cp /input ${path}`, `printf leaked | tee ${path}`]) {
      const result = await shell.exec(command);
      assert.notEqual(result.exitCode, 0, command);
      assert.ok(result.stderr.includes("Not a directory") || result.stderr.includes("ENOTDIR"), result.stderr);
      await assert.rejects(fs.stat("/escaped"), { code: "ENOENT" });
    }
  }
  const read = await shell.exec("cat /alias/../input");
  assert.notEqual(read.exitCode, 0);
  assert.equal(read.stdout, "");
  const predicate = await shell.exec("test -d /dev/null/..");
  assert.equal(predicate.exitCode, 1);
});

test("command-family filesystem operands retain device traversal before reads", async context => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("0\n"));
  await fs.symlink("/dev/null", "/alias");
  const shell = new Shell({ fs }).use(agentCommands());
  context.after(() => shell.dispose());
  for (const path of ["/dev/null/../../input", "/alias/../input"]) {
    for (const source of [`file ${path}`, `du ${path}`, `tree ${path}`, `jq . ${path}`, `yq . ${path}`, `od ${path}`, `nl ${path}`, `join ${path} /input`, `date -r ${path}`, `diff ${path} /input`]) {
      const result = await shell.exec(source);
      assert.notEqual(result.exitCode, 0, source);
    }
  }
  for (const source of ["cat /dev/null/", "cat /alias/.", "cat </dev/null/", "cd /alias/..", "[[ -d /alias/.. ]]"]) {
    assert.notEqual((await shell.exec(source)).exitCode, 0, source);
  }
  await fs.writeFile("/empty.tar", new Uint8Array(1024));
  assert.notEqual((await shell.exec("tar -xf /empty.tar -C /alias/..")).exitCode, 0);
});

test("virtual directory entries count toward command listing admission", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands({ maxDirectoryEntries: 0 }));
  context.after(() => shell.dispose());
  for (const source of ["ls /", "ls /dev", "find /dev"]) {
    const result = await shell.exec(source);
    assert.notEqual(result.exitCode, 0, source);
    assert.ok(result.stderr.includes("limit"), result.stderr);
  }
  await assert.rejects(fs.stat("/dev"), { code: "ENOENT" });
});

test("copying from null creates an ordinary empty destination", async context => {
  const { shell, fs } = fixture(context);
  const result = await shell.exec("cp /dev/null /empty && test -f /empty && test ! -s /empty && cat /empty");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/empty"), new Uint8Array());
  await assert.rejects(fs.stat("/dev"), { code: "ENOENT" });
});

test("streaming redirect to null cooperatively cancels and retires its producer", { timeout: 3000 }, async context => {
  const { shell, fs } = fixture(context);
  const controller = new AbortController();
  const reason = new Error("cancel null stream");
  let pulls = 0;
  let retired = false;
  const pending = shell.exec("cat >/dev/null", {
    signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {
      const chunk = new Uint8Array(65536);
      try { for (;;) { pulls++; yield chunk; } }
      finally { retired = true; }
    } },
  });
  const rejected = assert.rejects(pending, error => error === reason);
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await rejected; } finally { clearTimeout(timer); }
  assert.ok(pulls > 0);
  assert.equal(retired, true);
  await assert.rejects(fs.stat("/dev"), { code: "ENOENT" });
});

for (const failure of [undefined, null, false, 0, ""]) {
  test(`null streaming retains original ${typeof failure} producer failure`, async context => {
    const { shell, fs } = fixture(context);
    const seen: unknown[] = [];
    const result = await shell.exec("cat >/dev/null", {
      onInternalError(error) { seen.push(error); },
      stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array([1]); throw failure; } },
    });
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(seen, [failure]);
    await assert.rejects(fs.stat("/dev"), { code: "ENOENT" });
  });
}

test("character metadata consumers work independently of device path routing", async context => {
  const { shell, fs } = fixture(context);
  await fs.writeFile("/special", new Uint8Array());
  const ordinary = await fs.stat("/special");
  const character: FileStat = { ...ordinary, type: "character", mode: 0o20666, size: 0, allocatedBytes: 0 };
  for (const method of ["stat", "lstat"] as const) {
    const original = fs[method].bind(fs);
    context.mock.method(fs, method, (path: string, options?: FsOptions) => path === "/special" ? Promise.resolve(character) : original(path, options));
  }
  const result = await shell.exec("test -c /special && test ! -f /special && [[ -c /special && ! -f /special ]] && stat -c '%F|%A|%s' /special; find /special -type c; file -b /special; file -b --mime-type /special; du -b /special; ls -l /special");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.startsWith("character special file|crw-rw-rw-|0\n/special\ncharacter special\ninode/chardevice\n0\t/special\n"), result.stdout);
  assert.ok(result.stdout.split("\n").some(line => line.startsWith("crw-rw-rw- ")), result.stdout);
});

test("device identity cannot alias an ordinary file with matching inode numbers", async context => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/ordinary", new Uint8Array());
  const ordinary = await fs.stat("/ordinary");
  const stat = fs.stat.bind(fs);
  context.mock.method(fs, "stat", (path: string, options?: FsOptions) => path === "/special"
    ? Promise.resolve({ ...ordinary, type: "character", mode: 0o20666, identityScope: Symbol("device") } satisfies FileStat)
    : stat(path, options));
  const result = await predicateCommands()[0]!.execute({
    command: "test", args: ["/special", "-ef", "/ordinary"], fs, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() { assert.fail("unexpected predicate diagnostic"); } },
  });
  assert.equal(result.exitCode, 1);
});
