import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, S3FileSystem, MockS3Client, createS3Transport, WebDavFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createCommandArguments, toByteSource, type CommandDefinition, type FileSystem } from "safe-bash-contracts";
import { readZipArchive, decodeZipEntry } from "safe-bash-zip-engine/zip-format";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { createZipCommand, createZipCommands, zipCommands } from "./index.js";

test("zip reads WebDAV sources without retained identity", async () => {
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
  const result = await run(createZipCommand(), ["-0", "-", "hello.txt"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("hello"));
});

async function run(command: CommandDefinition, args: string[], input = "", fs: FileSystem = createMemoryFileSystem()) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const chunks: Uint8Array[] = [];
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs, stdin: toByteSource(input),
    stdout: { async write(bytes) { chunks.push(Uint8Array.from(bytes)); stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr, stdoutBytes: Buffer.concat(chunks) };
}

test("standalone zip works with only portable filesystem and command contracts", async () => {
  assert.equal(createZipCommand().name, "zip");
  assert.ok(createZipCommands().some(command => command.name === "zip"));
  assert.equal(zipCommands().name, "zip-commands");
  const result = await run(createZipCommand(), ["--help"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.length > 0);
});

for (const destination of ["-", "/new.zip"]) test(`zip creates ${destination} from S3 sources`, async () => {
  const fs = new S3FileSystem({ bucket: "test", transport: createS3Transport(new MockS3Client({ buckets: ["test"] }), { conditionalPut: true, streamingRead: true }) });
  await fs.writeFile("/hello.txt", new TextEncoder().encode("hello"));
  const result = await run(createZipCommand(), ["-0", destination, "hello.txt"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  const signal = new AbortController().signal;
  const limits = settings({});
  const archive = await readZipArchive(destination === "-" ? result.stdoutBytes : await fs.readFile(destination), limits, signal);
  assert.equal(archive.entries.length, 1);
  assert.equal(archive.entries[0]!.name, "hello.txt");
  assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), { signal }), new TextEncoder().encode("hello"));
});

for (const encrypted of [false, true]) test(`zip streams file creation and updates (encrypted=${encrypted})`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array(300000).fill(65));
  await fs.writeFile("/b", new Uint8Array(300000).fill(66));
  let largest = 0;
  const view = new Proxy(fs, { get(target, property) {
    if (property === "readFile") return () => { throw new Error("whole-file input"); };
    if (property === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const stage = await fs.createStagedFile!(...args);
      assert.ok(stage.writer);
      return { ...stage, writer: { ...stage.writer, async write(...args: Parameters<typeof stage.writer.write>) {
        largest = Math.max(largest, args[0].length);
        await Promise.resolve();
        return stage.writer!.write(...args);
      } } };
    };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const command = createZipCommand({ limits: { maxInputMemoryBytes: 1024, maxBufferedFileBytes: 1024 }, zipHost: { entropy: async size => new Uint8Array(size).fill(7) } });
  const flags = encrypted ? ["--encryption=aes-256-ae2", "-P", "secret"] : [];
  for (const file of ["a", "b"]) {
    const result = await run(command, [...flags, "/archive.zip", file], "", view);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.ok(largest > 0 && largest <= 65536);
  const archive = await readZipArchive(await fs.readFile("/archive.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(archive.entries.map(entry => entry.name), ["a", "b"]);
});

test("recursive ZIP spills member metadata without archiving invocation scratch", async () => {
  const fs = createMemoryFileSystem();
  for (let index = 0; index < 140; index++) await fs.writeFile(`/file-${String(index).padStart(3, "0")}`, Uint8Array.of(index));
  let largest = 0, active = 0, maximum = 0, registrations = 0;
  const view = new Proxy(fs, { get(target, property) {
    if (property === "readdir") return () => { throw new Error("unbounded directory listing"); };
    if (property === "readFile") return () => { throw new Error("whole-file input"); };
    if (property === "openReadFile") return async (...args: Parameters<NonNullable<FileSystem["openReadFile"]>>) => {
      const handle = await fs.openReadFile!(...args);
      active++; maximum = Math.max(maximum, active);
      let closed = false;
      return { ...handle, async read(offset: number, length: number, options?: Parameters<typeof handle.read>[2]) {
        largest = Math.max(largest, length);
        return handle.read(offset, length, options);
      }, async close() { if (!closed) { closed = true; active--; } await handle.close(); } };
    };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const command = createZipCommand({ limits: { chunkSize: 1024, maxBufferedFileBytes: 1024 } });
  for (let pass = 0; pass < 2; pass++) {
    const values = createCommandArguments(["-qr", "archive.zip", "."]);
    let diagnostic = "";
    const result = await command.execute({ command: "zip", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: view,
      stdin: toByteSource(""), signal: new AbortController().signal, stdout: { async write() {} },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }, registerCleanup() { registrations++; },
    });
    assert.equal(result.exitCode, 0, diagnostic);
    assert.equal(active, 0);
    const archive = await readZipArchive(await fs.readFile("/archive.zip"), settings({}), new AbortController().signal);
    assert.equal(archive.entries.length, 140);
    assert.ok(archive.entries.every(entry => entry.name.startsWith("file-")));
    assert.equal((await fs.readdir("/")).length, 141);
  }
  assert.ok(largest <= 1024, `range read ${largest}`);
  assert.ok(maximum <= 64, `outstanding retained handles ${maximum}`);
  assert.ok(registrations <= 8, `lifetime callbacks ${registrations}`);
});
