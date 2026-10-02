import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, S3FileSystem, MockS3Client, createS3Transport, WebDavFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition, type FileSystem, type FileStat } from "safe-bash-contracts";
import { createTarCommand, createTarCommands, tarCommands } from "./index.js";

for (const mutation of ["growth", "shrink", "mtime", "canonical", "opaque-version", "none"]) test(`tar validates fallback source ${mutation}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array([1, 2, 3]));
  let consumed = false;
  const view = new Proxy(fs, { get(target, property) {
    if (property === "openReadFile") return undefined;
    if (property === "lstat" && mutation === "opaque-version") return async (path: string) => ({
      ...await fs.lstat(path), opaqueVersion: consumed ? "new" : "old",
    });
    if (property === "realpath") return async (path: string) => consumed && mutation === "canonical" ? "/other" : fs.realpath(path);
    if (property === "readStream") return () => (async function* () {
      yield new Uint8Array(mutation === "growth" ? 4 : mutation === "shrink" ? 2 : 3);
      consumed = true;
      if (mutation === "mtime") await fs.utimes!("/a", 0, 1000);
    })();
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run(createTarCommand(), ["-cf", "-", "a"], "", view);
  if (mutation === "none") assert.equal(result.exitCode, 0, result.stderr);
  else {
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /source (?:grew|shrank|changed)/);
  }
});

test("file-list directories and subsequent operands retain ordering", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/one");
  await fs.mkdir("/two");
  await fs.writeFile("/one/a", new Uint8Array([1]));
  await fs.writeFile("/two/b", new Uint8Array([2]));
  await fs.writeFile("/one/list", new TextEncoder().encode("a\n-C\n../two\nb\n"));
  const result = await run(createTarCommand(), ["-C", "/one", "-T", "list", "-cf", "/out.tar", "b"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await run(createTarCommand(), ["-tf", "/out.tar"], "", fs)).stdout, "a\nb\nb\n");
});

test("tar reads WebDAV sources without retained identity", async () => {
  const fs = new WebDavFileSystem({
    baseUrl: "https://example.invalid/dav/",
    fetch: async (url, init) => {
      const directory = new URL(url).pathname === "/dav/";
      if (init.method === "GET") return new Response("hello");
      assert.equal(init.method, "PROPFIND");
      return new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>'
        + (directory ? "/dav/" : "/dav/hello.txt")
        + '</d:href><d:propstat><d:prop><d:resourcetype>'
        + (directory ? "<d:collection/>" : "")
        + '</d:resourcetype><d:getcontentlength>' + (directory ? 0 : 5)
        + '</d:getcontentlength><d:getlastmodified>Wed, 26 Aug 2026 12:00:00 GMT</d:getlastmodified>'
        + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>', { status: 207 });
    },
  });
  const result = await run(createTarCommand(), ["-cf", "-", "hello.txt"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("hello"));
});

async function run(command: CommandDefinition, args: string[], input = "", fs: FileSystem = createMemoryFileSystem()) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

for (const destination of ["-", "/new.tar"]) test(`tar creates ${destination} from S3 sources`, async () => {
  const fs = new S3FileSystem({ bucket: "test", transport: createS3Transport(new MockS3Client({ buckets: ["test"] }), { conditionalPut: true }) });
  await fs.writeFile("/hello.txt", new TextEncoder().encode("hello"));
  const result = await run(createTarCommand(), ["-cf", destination, "hello.txt"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  if (destination !== "-") {
    const extracted = await run(createTarCommand(), ["-xOf", destination], "", fs);
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.equal(extracted.stdout, "hello");
  } else assert.ok(result.stdout.includes("hello"));
});

test("standalone tar works with only portable filesystem and command contracts", async () => {
  assert.equal(createTarCommand().name, "tar");
  assert.ok(createTarCommands().some(command => command.name === "tar"));
  assert.equal(tarCommands().name, "tar-commands");
  const result = await run(createTarCommand(), ["--help"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.length > 0);
});

test("exclude patterns normalize directory slashes and leading dot components", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work/node_modules/pkg", { recursive: true });
  await fs.writeFile("/work/node_modules/pkg/index.js", new Uint8Array([1]));
  await fs.writeFile("/work/app.js", new Uint8Array([2]));
  const created = await run(createTarCommand(), ["--exclude=node_modules/", "--exclude=././app.js", "-C", "/work", "-cf", "/out.tar", "."], "", fs);
  assert.equal(created.exitCode, 0, created.stderr);
  const listed = await run(createTarCommand(), ["-tf", "/out.tar"], "", fs);
  assert.equal(listed.stdout, "./\n");
});

for (const listFlag of ["-T", "--files-from"]) {
  for (const mode of ["--null", "--verbatim-files-from"]) {
    for (const stdin of [false, true]) test(`${listFlag} respects -C and trailing ${mode} (${stdin ? "stdin" : "file"})`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/sub");
      await fs.writeFile("/sub/-literal", new Uint8Array([42]));
      const list = `-literal${mode === "--null" ? "\0" : "\n"}`;
      await fs.writeFile("/sub/list", new TextEncoder().encode(list));
      const created = await run(createTarCommand(), ["-C", "/sub", listFlag, stdin ? "-" : "list", "-cf", "/out.tar", mode], stdin ? list : "", fs);
      assert.equal(created.exitCode, 0, created.stderr);
      const listed = await run(createTarCommand(), ["-tf", "/out.tar"], "", fs);
      assert.equal(listed.stdout, "-literal\n");
    });
  }
}

for (const timing of ["open", "read"] as const) for (const numeric of [true, false]) for (const mutation of ["version", "identity", "none"] as const) {
  test(`tar retained sources honor ${numeric ? "numeric and opaque" : "opaque-only"} ${mutation} during ${timing}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a", new TextEncoder().encode("old"));
    const scope = {};
    let generation = 1;
    let opened = 0;
    let closed = 0;
    const snapshot = (stat: FileStat, revision: number): FileStat => {
      const { dev: ignoredDev, ino: ignoredIno, revision: ignoredRevision, ...rest } = stat;
      return { ...rest, identityScope: scope, ...(numeric ? { dev: 0, ino: 1 } : {}),
        opaqueIdentity: mutation === "identity" ? `object:${revision}` : "object:a",
        opaqueVersion: mutation === "identity" ? "stable" : `version:${revision}`,
        mtimeMs: 0, ctimeMs: 0 };
    };
    const replace = async () => {
      if (mutation === "none" || generation !== 1) return;
      await fs.writeFile("/replacement", new TextEncoder().encode("new"));
      await fs.rename("/replacement", "/a");
      generation++;
    };
    const view = new Proxy(fs, { get(target, property) {
      if (property === "lstat") return async (path: string) => {
        const stat = await fs.lstat(path);
        return path === "/a" ? snapshot(stat, generation) : stat;
      };
      if (property === "openReadFile") return async (path: string) => {
        opened++;
        if (timing === "open") await replace();
        const handle = await fs.openReadFile!(path);
        const retained = snapshot(await handle.stat(), generation);
        return { ...handle, stat: async () => retained,
          read: async (offset: number, length: number) => {
            if (timing === "read") await replace();
            return handle.read(offset, length);
          }, close: async () => { closed++; await handle.close(); } };
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const old = await fs.openReadFile!("/a");
    try {
      const result = await run(createTarCommand(), ["-cf", "/out.tar", "a"], "", view);
      // Numeric identity takes precedence over opaque identity in the shared contract.
      const changed = mutation === "version" || mutation === "identity" && !numeric;
      assert.equal(result.exitCode, changed ? 2 : 0, result.stderr);
      if (changed) {
        assert.match(result.stderr, /source changed while archiving/);
      }
      assert.equal(opened, 1);
      assert.equal(closed, 1);
      assert.equal(new TextDecoder().decode(await old.read(0, 3)), "old");
    } finally { await old.close(); }
  });
}

for (const aliases of [true, false]) test(`tar groups opaque hardlinks: aliases=${aliases}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new TextEncoder().encode("one"));
  if (aliases) await fs.link!("/a", "/b");
  else await fs.writeFile("/b", new TextEncoder().encode("two"));
  const opaque = (stat: FileStat): FileStat => {
    const { dev: ignoredDev, ino, ...rest } = stat;
    return { ...rest, opaqueIdentity: `object:${ino}` };
  };
  const view = new Proxy(fs, { get(target, property) {
    if (property === "lstat") return async (path: string) => opaque(await fs.lstat(path));
    if (property === "openReadFile") return async (path: string) => {
      const handle = await fs.openReadFile!(path);
      return { ...handle, stat: async () => opaque(await handle.stat()) };
    };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const created = await run(createTarCommand(), ["-cf", "/archive.tar", "a", "b"], "", view);
  assert.equal(created.exitCode, 0, created.stderr);
  await fs.mkdir("/out");
  const extracted = await run(createTarCommand(), ["-C", "/out", "-xf", "/archive.tar"], "", fs);
  assert.equal(extracted.exitCode, 0, extracted.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/out/a")), "one");
  assert.equal(new TextDecoder().decode(await fs.readFile("/out/b")), aliases ? "one" : "two");
  assert.equal((await fs.stat("/out/a")).ino === (await fs.stat("/out/b")).ino, aliases);
});

for (const mode of ["c", "r", "u"]) test(`tar ${mode} applies exclusions positionally and transforms source names`, async () => {
  const fs = createMemoryFileSystem();
  for (const dir of ["src1", "src2"]) {
    await fs.mkdir(`/${dir}`);
    await fs.writeFile(`/${dir}/a.tmp`, new TextEncoder().encode(dir));
    await fs.writeFile(`/${dir}/b.txt`, new TextEncoder().encode(dir));
  }
  await fs.writeFile("/names", new TextEncoder().encode("src2\n"));
  await fs.writeFile("/empty", new Uint8Array());
  if (mode !== "c") assert.equal((await run(createTarCommand(), ["-cf", "/out.tar", "-T", "/empty"], "", fs)).exitCode, 0);
  const result = await run(createTarCommand(), [`-${mode}f`, "/out.tar", "--sort=name", "--transform=s,src,pkg,", "src1", "--exclude=*.tmp", "-T", "/names"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await run(createTarCommand(), ["-tf", "/out.tar"], "", fs)).stdout, "pkg1/\npkg1/a.tmp\npkg1/b.txt\npkg2/\npkg2/b.txt\n");
});

test("tar verbose listing formats default timestamps to minute precision", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array([1]));
  assert.equal((await run(createTarCommand(), ["-cf", "/out.tar", "--mtime=@1700000000", "a"], "", fs)).exitCode, 0);
  const result = await run(createTarCommand(), ["-tvf", "/out.tar"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.endsWith(" 2023-11-14 22:13 a\n"), result.stdout);
});

test("tar recursion controls apply to subsequent source operands", async () => {
  const fs = createMemoryFileSystem();
  for (const dir of ["one", "two"]) {
    await fs.mkdir(`/${dir}`);
    await fs.writeFile(`/${dir}/a`, new Uint8Array([1]));
  }
  const result = await run(createTarCommand(), ["-cf", "/out.tar", "--no-recursion", "one", "--recursion", "two"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await run(createTarCommand(), ["-tf", "/out.tar"], "", fs)).stdout, "one/\ntwo/\ntwo/a\n");
});

for (const show of [false, true]) test(`tar strips short members and displays extracted names (show=${show})`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/src");
  await fs.mkdir("/out");
  await fs.writeFile("/src/a", new TextEncoder().encode("payload"));
  assert.equal((await run(createTarCommand(), ["-cf", "/out.tar", "src"], "", fs)).exitCode, 0);
  const flags = ["--strip-components=1", ...(show ? ["--show-transformed-names"] : [])];
  const listed = await run(createTarCommand(), ["-tf", "/out.tar", ...flags], "", fs);
  assert.equal(listed.exitCode, 0, listed.stderr);
  assert.equal(listed.stdout, "a\n");
  const extracted = await run(createTarCommand(), ["-xvf", "/out.tar", "-C", "/out", "--xform=s,a,b,", ...flags], "", fs);
  assert.equal(extracted.exitCode, 0, extracted.stderr);
  assert.equal(extracted.stdout, show ? "b\n" : "src/a\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/out/b")), "payload");
});

test("positional exclusions share their pattern work budget", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array());
  await fs.writeFile("/b", new Uint8Array());
  const result = await run(createTarCommand({ limits: { maxPatternSteps: 3 } }), ["-cf", "/out.tar", "--exclude=z", "a", "b"], "", fs);
  assert.equal(result.exitCode, 2);
  assert.ok(result.stderr.includes("exclude pattern work limit exceeded"), result.stderr);
});

for (const mode of ["c", "x"]) test(`tar ${mode} rejects transformed traversal names`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array([1]));
  assert.equal((await run(createTarCommand(), ["-cf", "/out.tar", "a"], "", fs)).exitCode, 0);
  const result = await run(createTarCommand(), [`-${mode}f`, "/out.tar", "--transform=s,a,../escape,", "a"], "", fs);
  assert.equal(result.exitCode, 2, result.stderr);
  await assert.rejects(fs.stat("/escape"));
});
