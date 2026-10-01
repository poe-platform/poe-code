import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, S3FileSystem, MockS3Client, createS3Transport, WebDavFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition, type FileSystem } from "safe-bash-contracts";
import { createTarCommand, createTarCommands, tarCommands } from "./index.js";

for (const mutation of ["growth", "shrink", "mtime", "canonical", "none"]) test(`tar validates fallback source ${mutation}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array([1, 2, 3]));
  let consumed = false;
  const view = new Proxy(fs, { get(target, property) {
    if (property === "openReadFile") return undefined;
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
