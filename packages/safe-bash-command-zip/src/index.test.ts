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
  const fs = new S3FileSystem({ bucket: "test", transport: createS3Transport(new MockS3Client({ buckets: ["test"] }), { conditionalPut: true }) });
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
