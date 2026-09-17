import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { FsError, type FsOptions, type ReadDirectoryOptions } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/index.js";

function probingFileSystem(probe: (method: string, path: string, options?: FsOptions) => void) {
  return new Proxy(new MemoryFileSystem(), {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        probe(String(key), args[0] as string, args[1] as FsOptions | undefined);
        return Reflect.apply(value, target, args);
      };
    },
  });
}

test("unquoted URL glob retains its original argument when colon pathname probes are invalid", async () => {
  const probes: string[] = [];
  const fs = probingFileSystem((method, path) => {
    if (["stat", "readdir"].includes(method) && path.includes(":")) {
      probes.push(`${method}:${path}`);
      throw new FsError("EINVAL", { path, syscall: method });
    }
  });
  const { shell } = setup({ fs });
  const url = "https://browser-test.example/page?size=2";
  try {
    const result = await shell.exec(`args ${url}`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, JSON.stringify([url]));
    assert.deepEqual(probes, ["readdir:/https:/browser-test.example"]);
    probes.length = 0;
    const quoted = await shell.exec(`args '${url}' "${url}" /missing-*`);
    assert.equal(quoted.exitCode, 0);
    assert.equal(quoted.stderr, "");
    assert.equal(quoted.stdout, JSON.stringify([url, url, "/missing-*"]));
    assert.deepEqual(probes, []);
  } finally { await shell.dispose(); }
});

const invalidProbeCases = [
  { name: "ordinary directory read", pattern: "bad:/*", method: "readdir" },
  { name: "ordinary final stat", pattern: "bad?", method: "stat" },
  { name: "recursive root stat", pattern: "bad:/**", method: "stat" },
  { name: "recursive directory walk", pattern: "**/leaf?", method: "readdir" },
  { name: "recursive wildcard segment", pattern: "**/bad:/*", method: "readdir" },
  { name: "recursive final lstat", pattern: "**/bad?", method: "lstat" },
  { name: "recursive final directory stat", pattern: "**/bad?/", method: "stat" },
] as const;

for (const { name, pattern, method: rejectedMethod } of invalidProbeCases) {
  for (const code of ["EINVAL", "ENOENT", "ENOTDIR", "EACCES", "EIO", "EPERM"] as const) {
    test(`${name} treats only unmatched pathname errors as nonmatches: ${code}`, async () => {
      let probes = 0;
      const fs = probingFileSystem((method, path, options) => {
        if (method === rejectedMethod && path === "/work/bad:") {
          assert(options?.signal);
          probes++;
          throw new FsError(code, { path, syscall: method, message: "probe rejected" });
        }
      });
      await fs.mkdir("/work/bad:", { recursive: true });
      await fs.writeFile("/work/bad:/leaf1", new Uint8Array());
      const { shell } = setup({ fs, cwd: "/work" });
      try {
        const result = await shell.exec(`shopt -s globstar; args ${pattern}`);
        assert(probes > 0);
        if (code === "EIO" || code === "EPERM") {
          assert.equal(result.exitCode, 1);
          assert.equal(result.stdout, "");
          assert(result.stderr.includes("probe rejected"), result.stderr);
        } else {
          assert.equal(result.exitCode, 0);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, JSON.stringify([pattern]));
        }
      } finally { await shell.dispose(); }
    });
  }

  for (const reason of [new FsError("EINVAL", { message: "cancelled glob" }), false]) {
    test(`${name} does not swallow cancellation with ${typeof reason} reason`, async () => {
      const controller = new AbortController();
      let probes = 0;
      const fs = probingFileSystem((method, path, options) => {
        if (method === rejectedMethod && path === "/work/bad:") {
          assert(options?.signal);
          probes++;
          controller.abort(reason);
          throw new FsError("EINVAL", { path, syscall: method });
        }
      });
      await fs.mkdir("/work/bad:", { recursive: true });
      await fs.writeFile("/work/bad:/leaf1", new Uint8Array());
      const { shell } = setup({ fs, cwd: "/work" });
      let commands = 0;
      shell.use(async (context, next) => { if (context.command === "args") commands++; return next(); });
      try {
        await assert.rejects(shell.exec(`shopt -s globstar; args ${pattern}`, { signal: controller.signal }), error => Object.is(error, reason));
        assert(probes > 0);
        assert.equal(commands, 0);
      } finally { await shell.dispose(); }
    });
  }
}

test("unmatched expansion does not relax actual file access restrictions", async () => {
  const rejected: string[] = [];
  const fs = probingFileSystem((method, path) => {
    if (["stat", "readdir", "readFile"].includes(method) && path.includes(":")) {
      rejected.push(method);
      throw new FsError("EINVAL", { path, syscall: method, message: "restricted pathname" });
    }
  });
  await fs.writeFile("/bad:", new TextEncoder().encode("private"));
  const { shell } = setup({ fs });
  try {
    const result = await shell.exec("pass < 'bad:'");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert(result.stderr.includes("restricted pathname"), result.stderr);
    assert(rejected.length > 0);
    assert.throws(() => fs.stat("/bad:"), error => error instanceof FsError && error.code === "EINVAL");
    assert.throws(() => fs.readdir("/bad:"), error => error instanceof FsError && error.code === "EINVAL");
  } finally { await shell.dispose(); }
});

const siblingProbeCases = [
  { name: "ordinary directory read", pattern: "*/leaf?", method: "readdir", sibling: "good/leaf1" },
  { name: "ordinary final stat", pattern: "bad?", method: "stat", sibling: "bad1" },
  { name: "recursive root stat", pattern: "*/**/leaf?", method: "stat", sibling: "good/leaf1" },
  { name: "recursive directory walk", pattern: "**/leaf?", method: "readdir", sibling: "good/leaf1" },
  { name: "recursive wildcard segment", pattern: "**/bad:/*", method: "readdir", sibling: "good/bad:/leaf1" },
  { name: "recursive final lstat", pattern: "**/bad?", method: "lstat", sibling: "good/bad1" },
  { name: "recursive final directory stat", pattern: "**/bad?/", method: "stat", sibling: "good/bad1/" },
] as const;

for (const { name, pattern, method: rejectedMethod, sibling } of siblingProbeCases) {
  for (const reason of [new FsError("EINVAL"), Object.assign(new Error("invalid pathname"), { code: "EINVAL" }), { code: "EINVAL" }]) {
    test(`${name} retains matching siblings after ${reason.constructor.name} EINVAL`, async () => {
      let probes = 0;
      const fs = probingFileSystem((method, path) => {
        if (method === rejectedMethod && path === "/work/bad:") { probes++; throw reason; }
      });
      await fs.mkdir("/work/bad:", { recursive: true });
      await fs.writeFile("/work/bad:/leaf1", new Uint8Array());
      if (sibling.endsWith("/")) await fs.mkdir(`/work/${sibling}`, { recursive: true });
      else {
        await fs.mkdir(`/work/${sibling.slice(0, sibling.lastIndexOf("/") + 1)}`, { recursive: true });
        await fs.writeFile(`/work/${sibling}`, new Uint8Array());
      }
      const { shell } = setup({ fs, cwd: "/work" });
      try {
        const result = await shell.exec(`shopt -s globstar; args ${pattern}`);
        assert(probes > 0);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, JSON.stringify([sibling]));
      } finally { await shell.dispose(); }
    });
  }
}

for (const { name, pattern, method: rejectedMethod } of invalidProbeCases) {
  for (const reason of [new Error("provider failure"), { code: "EIO" }, Object.assign(new Error("provider failure"), { code: "EPERM" })]) {
    test(`${name} preserves plain and own-code provider failures: ${"code" in reason ? reason.code : "no code"}`, async () => {
      const seen: unknown[] = [];
      let probes = 0;
      let commands = 0;
      const fs = probingFileSystem((method, path) => {
        if (method === rejectedMethod && path === "/work/bad:") { probes++; throw reason; }
      });
      await fs.mkdir("/work/bad:", { recursive: true });
      await fs.writeFile("/work/bad:/leaf1", new Uint8Array());
      const { shell } = setup({ fs, cwd: "/work", onInternalError(error) { seen.push(error); } });
      shell.use(async (context, next) => { if (context.command === "args") commands++; return next(); });
      try {
        const result = await shell.exec(`shopt -s globstar; args ${pattern}`);
        assert(probes > 0);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        assert.notEqual(result.stderr, "");
        assert(seen.includes(reason));
        assert.equal(commands, 0);
      } finally { await shell.dispose(); }
    });
  }

  for (const reason of [0, null, { code: "EINVAL" }]) {
    test(`${name} preserves additional cancellation reason ${JSON.stringify(reason)}`, async () => {
      const controller = new AbortController();
      let probes = 0;
      let commands = 0;
      const fs = probingFileSystem((method, path, options) => {
        if (method === rejectedMethod && path === "/work/bad:") {
          assert(options?.signal);
          probes++;
          controller.abort(reason);
          throw { code: "EINVAL" };
        }
      });
      await fs.mkdir("/work/bad:", { recursive: true });
      await fs.writeFile("/work/bad:/leaf1", new Uint8Array());
      const { shell } = setup({ fs, cwd: "/work" });
      shell.use(async (context, next) => { if (context.command === "args") commands++; return next(); });
      try {
        await assert.rejects(shell.exec(`shopt -s globstar; args ${pattern}`, { signal: controller.signal }), error => Object.is(error, reason));
        assert(probes > 0);
        assert.equal(commands, 0);
      } finally { await shell.dispose(); }
    });
  }
}

test("URL-shaped arguments still glob when real pathname matches exist", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/https:/browser-test.example", { recursive: true });
  await fs.writeFile("/https:/browser-test.example/pageXsize=2", new Uint8Array());
  const url = "https://browser-test.example/page?size=2";
  try {
    const result = await shell.exec(`args ${url} '${url}' "${url}"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, JSON.stringify(["https:/browser-test.example/pageXsize=2", url, url]));
  } finally { await shell.dispose(); }
});

test("unmatched URL expansion preserves exact separators, query and fragment bytes", async () => {
  const probes: string[] = [];
  const fs = probingFileSystem((method, path) => {
    if (method === "readdir" && path.includes(":")) { probes.push(path); throw { code: "EINVAL" }; }
  });
  const { shell } = setup({ fs });
  const urls = ["https://browser-test.example//page?size=2%20two#part", "https://browser-test.example/page[12]?size=2"];
  try {
    const result = await shell.exec(`args ${urls.join(" ")}`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, JSON.stringify(urls));
    assert.equal(probes.length, urls.length);
  } finally { await shell.dispose(); }
});

for (const pattern of ["bad?", "**/bad?"]) test(`invalid nonmatch cannot bypass subsequent actual redirection access: ${pattern}`, async () => {
  const accesses: string[] = [];
  const fs = probingFileSystem((method, path) => {
    if ((method === "stat" || method === "lstat") && path === "/work/bad:") throw new FsError("EINVAL", { path, syscall: method });
    if (method === "access" && path === `/work/${pattern}`) {
      accesses.push(path);
      throw new FsError("EINVAL", { path, syscall: method, message: "read access refused" });
    }
  });
  await fs.mkdir("/work");
  await fs.writeFile("/work/bad:", new Uint8Array());
  const { shell } = setup({ fs, cwd: "/work" });
  try {
    const result = await shell.exec(`shopt -s globstar; pass < ${pattern}`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert(result.stderr.includes("read access refused"), result.stderr);
    assert.deepEqual(accesses, [`/work/${pattern}`]);
  } finally { await shell.dispose(); }
});

async function fixture() {
  const result = setup({ cwd: "/tree" });
  for (const directory of ["/tree/a/b", "/tree/.hidden/deep"]) await result.fs.mkdir(directory, { recursive: true });
  for (const path of ["/tree/root.txt", "/tree/a/one.txt", "/tree/a/b/two.txt", "/tree/.hidden/deep/secret.txt"]) await result.fs.writeFile(path, new Uint8Array());
  return result;
}

test("globstar includes zero, one and multiple directories only when enabled", async () => {
  const { shell } = await fixture();
  try {
    assert.equal((await shell.exec("args **/*.txt")).stdout, '["a/one.txt"]');
    const result = await shell.exec("shopt -s globstar; args **/*.txt");
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["a/b/two.txt","a/one.txt","root.txt"]');
  } finally { await shell.dispose(); }
});

test("adjacent globstars deduplicate and trailing separators select directories", async () => {
  const { shell } = await fixture();
  try {
    assert.equal((await shell.exec("shopt -s globstar; args **/**/two.txt")).stdout, '["a/b/two.txt"]');
    assert.equal((await shell.exec("shopt -s globstar; args **/")).stdout, '["a/","a/b/"]');
    assert.equal((await shell.exec("shopt -s globstar; args a/**")).stdout, '["a/","a/b","a/b/two.txt","a/one.txt"]');
  } finally { await shell.dispose(); }
});

test("globstar honors quoting, unmatched patterns, absolute paths and dotglob", async () => {
  const { shell } = await fixture();
  try {
    assert.equal((await shell.exec("shopt -s globstar; args '**/*.txt' no/**/*.txt")).stdout, '["**/*.txt","no/**/*.txt"]');
    assert.equal((await shell.exec("shopt -s globstar dotglob; args **/secret.txt")).stdout, '[".hidden/deep/secret.txt"]');
    assert.equal((await shell.exec("shopt -s globstar; args /tree/**/two.txt")).stdout, '["/tree/a/b/two.txt"]');
  } finally { await shell.dispose(); }
});

for (const prefix of ["'a*'", "a\\*"]) test(`globstar preserves a literal wildcard prefix: ${prefix}`, async () => {
  const { shell, fs } = await fixture();
  await fs.mkdir("/tree/a*/b", { recursive: true });
  await fs.writeFile("/tree/a*/b/x", new Uint8Array());
  try {
    const result = await shell.exec(`shopt -s globstar; args ${prefix}/**`);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), ["a*/", "a*/b", "a*/b/x"]);
  } finally { await shell.dispose(); }
});

test("globstar lists symlinks without recursively following them", async () => {
  const { shell, fs } = await fixture();
  await fs.symlink("a", "/tree/alias");
  await fs.symlink("..", "/tree/a/loop");
  await fs.symlink("missing", "/tree/dangling");
  try {
    const result = await shell.exec("shopt -s globstar; args **");
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), ["a", "a/b", "a/b/two.txt", "a/loop", "a/one.txt", "alias", "dangling", "root.txt"]);
  } finally { await shell.dispose(); }
});

test("globstar option is cloned for subshells and reset between invocations", async () => {
  const { shell } = await fixture();
  try {
    const result = await shell.exec("shopt -s globstar; (shopt -u globstar); shopt -q globstar; args **/two.txt");
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["a/b/two.txt"]');
    assert.equal((await shell.exec("shopt -q globstar")).exitCode, 1);
    assert.equal((await shell.exec("shopt -p globstar")).stdout, "shopt -u globstar\n");
  } finally { await shell.dispose(); }
});

const oracleCases: readonly [string, string[]][] = [
  ["**/*.txt", ["a/b/deep/three.txt", "a/b/two.txt", "a/one.txt", "root.txt"]],
  ["./**/*.txt", ["./a/b/deep/three.txt", "./a/b/two.txt", "./a/link/two.txt", "./a/one.txt", "./alias/one.txt", "./root.txt"]],
  ["a/**/*.txt", ["a/b/deep/three.txt", "a/b/two.txt", "a/link/two.txt", "a/one.txt"]],
  ["alias/**/*.txt", ["alias/b/deep/three.txt", "alias/b/two.txt", "alias/link/two.txt", "alias/one.txt"]],
  ["./**/deep/*.txt", ["./a/b/deep/three.txt", "./a/link/deep/three.txt"]],
  ["./**/**/three.txt", ["./a/b/deep/three.txt"]],
  ["./**/**/two.txt", ["./a/b/two.txt", "./a/link/two.txt"]],
  ["**/link/**/*.txt", ["a/link/deep/three.txt", "a/link/two.txt"]],
  ["empty/**", ["empty/"]],
  ["empty/**/**", ["empty"]],
  ["empty/**/", ["empty/"]],
  ["dangling/**", ["dangling/**"]],
  ["dangling/**/", ["dangling/**/"]],
  ["**/", ["a/", "a/b/", "a/b/deep/", "a/link/", "alias/", "empty/"]],
];
for (const [pattern, expected] of oracleCases) test(`GNU Bash 5.2.37 globstar oracle: ${pattern}`, async () => {
  const { shell, fs } = await fixture();
  await fs.mkdir("/tree/a/b/deep");
  await fs.mkdir("/tree/empty");
  await fs.writeFile("/tree/a/b/deep/three.txt", new Uint8Array());
  await fs.symlink("b", "/tree/a/link");
  await fs.symlink("a", "/tree/alias");
  await fs.symlink("missing", "/tree/dangling");
  try {
    const result = await shell.exec(`shopt -s globstar; args ${pattern}`);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), expected);
  } finally { await shell.dispose(); }
});

test("globstar bounds directory admission before reading oversized provider entries", async () => {
  class Oversized extends MemoryFileSystem {
    override async readdir(_path: string, options?: ReadDirectoryOptions) {
      assert.equal(options?.maxEntries, 100_000);
      assert(options?.signal);
      const entries = new Array<{ name: string; type: "file" }>(100_001);
      Object.defineProperty(entries, 0, { get() { assert.fail("oversized entries must not be read"); } });
      return entries;
    }
  }
  const fs = new Oversized();
  await fs.mkdir("/work");
  const { shell } = setup({ fs, cwd: "/work" });
  try { await assert.rejects(shell.exec("shopt -s globstar; args **"), error => error instanceof FsError && error.code === "EFBIG"); }
  finally { await shell.dispose(); }
});

test("a provider's directory admission refusal terminates traversal with its original error", async () => {
  const reason = new FsError("EFBIG", { syscall: "readdir", message: "directory entry limit exceeded" });
  class Admitting extends MemoryFileSystem {
    override async readdir(_path: string, options?: ReadDirectoryOptions): Promise<{ name: string; type: "file" }[]> {
      assert.equal(options?.maxEntries, 100_000);
      throw reason;
    }
  }
  const fs = new Admitting();
  await fs.mkdir("/work");
  const { shell } = setup({ fs, cwd: "/work" });
  let effects = 0;
  shell.register({ name: "effect", execute() { effects++; return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec("shopt -s globstar; args **; effect"), error => error === reason);
    assert.equal(effects, 0);
  } finally { await shell.dispose(); }
});

test("hidden nonmatches consume invocation-wide entry admission without consuming emitted fields", async () => {
  class Hidden extends MemoryFileSystem {
    readonly limits: number[] = [];
    override async readdir(_path: string, options?: ReadDirectoryOptions) {
      this.limits.push(options!.maxEntries!);
      return Array.from({ length: 50_000 }, () => ({ name: ".hidden", type: "file" as const }));
    }
  }
  const fs = new Hidden();
  await fs.mkdir("/work");
  const { shell } = setup({ fs, cwd: "/work", limits: { maxExpansionFields: 20 } });
  try {
    await assert.rejects(shell.exec("shopt -s globstar; args **; args **; args **"), error => error instanceof FsError && error.code === "EFBIG");
    assert.deepEqual(fs.limits, [100_000, 50_000, 0]);
    assert.equal((await shell.exec("shopt -s globstar; args **")).stdout, '["**"]');
    assert.equal(fs.limits.at(-1), 100_000);
  } finally { await shell.dispose(); }
});

test("recursive directory depth is independently bounded", async () => {
  class Endless extends MemoryFileSystem {
    override async stat() { return super.stat("/"); }
    override async readdir() { return [{ name: "d", type: "directory" as const }]; }
  }
  const { shell } = setup({ fs: new Endless(), limits: { maxPathComponents: 1000 } });
  try { await assert.rejects(shell.exec("shopt -s globstar; args **/missing"), error => error instanceof FsError && error.message.includes("depth limit")); }
  finally { await shell.dispose(); }
});

test("files at the admitted recursive directory depth do not add another directory level", async () => {
  const fs = new MemoryFileSystem();
  const directory = "/work/" + Array.from({ length: 128 }, () => "d").join("/");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(`${directory}/leaf`, new Uint8Array());
  const { shell } = setup({ fs, cwd: "/work", limits: { maxPathComponents: 1000 } });
  try {
    const result = await shell.exec("shopt -s globstar; args **/leaf");
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), [directory.slice("/work/".length) + "/leaf"]);
  } finally { await shell.dispose(); }
});

for (const limit of ["maxExpansionFields", "maxExpansionBytes", "maxFileSystemOperations"] as const) test(`recursive globs preserve ${limit}`, async () => {
  const fs = new MemoryFileSystem();
  for (let index = 0; index < 40; index++) await fs.writeFile(`/file${index}`, new Uint8Array());
  const { shell } = setup({ fs, limits: { [limit]: limit === "maxExpansionBytes" ? 512 : 10 } });
  try { await assert.rejects(shell.exec("shopt -s globstar; args **"), error => error instanceof ShellLimitError && error.limit === limit); }
  finally { await shell.dispose(); }
});

for (const reason of [false, { cancelled: "globstar" }]) test(`globstar interrupts a pending directory read with original ${typeof reason} reason`, async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  class Held extends MemoryFileSystem {
    override async readdir(_path: string, options?: ReadDirectoryOptions) {
      assert(options?.signal);
      entered();
      await held;
      return [{ name: "late", type: "file" as const }];
    }
  }
  const { shell } = setup({ fs: new Held() });
  const controller = new AbortController();
  let effects = 0;
  shell.register({ name: "effect", execute() { effects++; return { exitCode: 0 }; } });
  const pending = shell.exec("shopt -s globstar; effect **", { signal: controller.signal });
  try {
    await started;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    release();
    assert.equal((await shell.exec("status 0")).exitCode, 0);
    assert.equal(effects, 0);
  } finally { release(); await shell.dispose(); }
});

test("globstar yields while admitting a single long provider name", async () => {
  const controller = new AbortController();
  const reason = { cancelled: "name scan" };
  const name = "a".repeat(256 * 1024);
  class LongName extends MemoryFileSystem {
    override async readdir() {
      setTimeout(() => controller.abort(reason), 0);
      return [{ name, type: "file" as const }];
    }
  }
  const fs = new LongName();
  await fs.mkdir("/work");
  const { shell } = setup({ fs, cwd: "/work" });
  try { await assert.rejects(shell.exec("shopt -s globstar; args **", { signal: controller.signal }), error => error === reason); }
  finally { await shell.dispose(); }
});

test("shopt lists and filters both supported options without mutating unnamed options", async () => {
  const { shell } = setup();
  try {
    assert.equal((await shell.exec("shopt -p")).stdout, "shopt -u dotglob\nshopt -u globstar\n");
    assert.equal((await shell.exec("shopt -s globstar; shopt -sp; shopt -up; shopt -q globstar")).stdout, "shopt -s globstar\nshopt -u dotglob\n");
    const result = await shell.exec("shopt -s globstar unknown dotglob; shopt -p");
    assert.equal(result.stdout, "shopt -s dotglob\nshopt -s globstar\n");
    assert.match(result.stderr, /unknown: unsupported shell option name/u);
  } finally { await shell.dispose(); }
});
