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

for (const recursive of [false, true]) {
  for (const junkPaths of [false, true]) {
    for (const pattern of ["sub/README.md", "README.md", "*.md", "sub/*.md", "sub/README.*", "sub/READM?.md", "sub/[R]EADME.md"]) {
      for (const option of ["-i", "-x"]) {
        test(`zip filters ${pattern} with ${option} (recursive=${recursive}, junkPaths=${junkPaths})`, async () => {
          const fs = createMemoryFileSystem();
          await fs.mkdir("/sub");
          await fs.writeFile("/sub/README.md", new TextEncoder().encode("readme"));
          await fs.writeFile("/sub/keep.txt", new TextEncoder().encode("keep"));
          const matches = junkPaths ? pattern === "*.md" || pattern === "sub/*.md" : pattern !== "README.md";
          const prefix = junkPaths ? "" : "sub/";
          const expected = option === "-i"
            ? matches ? [`${prefix}README.md`] : []
            : [...(recursive && !junkPaths ? ["sub/"] : []), ...(!matches ? [`${prefix}README.md`] : []), `${prefix}keep.txt`];
          const result = await run(createZipCommand(), [
            ...(recursive ? ["-r"] : []), ...(junkPaths ? ["-j"] : []), "a.zip",
            ...(recursive ? ["sub"] : ["sub/README.md", "sub/keep.txt"]), option, pattern,
          ], "", fs);
          assert.equal(result.exitCode, 0, result.stderr);
          const archive = await readZipArchive(await fs.readFile("/a.zip"), settings({}), new AbortController().signal);
          assert.deepEqual(archive.entries.map(entry => entry.name), expected);
        });
      }
    }
  }
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

for (const flags of [[], ["-X"], ["-X-"], ["-0"], ["--encryption=aes-256-ae2", "-P", "secret"]]) {
  test(`zip records source access time in local timestamps (${flags.join(" ")})`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/guide.md", new TextEncoder().encode("guide"));
    await fs.utimes!("/guide.md", 1900000123000, 1700000001000);
    const command = createZipCommand({ zipHost: { entropy: async size => new Uint8Array(size).fill(7) } });
    const result = await run(command, ["-q", ...flags, "a.zip", "guide.md"], "", fs);
    assert.equal(result.exitCode, 0, result.stderr);
    const archive = await readZipArchive(await fs.readFile("/a.zip"), settings({}), new AbortController().signal);
    const entry = archive.entries[0]!;
    for (const [extra, central] of [[entry.localExtra!, false], [entry.centralExtra!, true]] as const) {
      const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
      let timestamp: Uint8Array | undefined;
      for (let offset = 0; offset < extra.length;) {
        const length = view.getUint16(offset + 2, true);
        if (view.getUint16(offset, true) === 0x5455) timestamp = extra.subarray(offset + 4, offset + 4 + length);
        offset += 4 + length;
      }
      if (flags.includes("-X")) assert.equal(timestamp, undefined);
      else {
        assert.ok(timestamp);
        const time = new DataView(timestamp.buffer, timestamp.byteOffset, timestamp.byteLength);
        assert.equal(timestamp.length, central ? 5 : 9);
        assert.equal(timestamp[0], central ? 1 : 3);
        assert.equal(time.getInt32(1, true), 1700000001);
        if (!central) assert.equal(time.getInt32(5, true), 1900000123);
      }
    }
  });
}

for (const flags of [[], ["-X"], ["-X-"], ["-0"], ["--encryption=aes-256-ae2", "-P", "secret"]]) {
  for (const owner of [{ uid: 0, gid: 0 }, { uid: 501, gid: 20 }, {}]) {
    test(`zip records only virtual owner IDs (${JSON.stringify(owner)}, ${flags.join(" ")})`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/guide.md", new TextEncoder().encode("guide"));
      const view = new Proxy(fs, { get(target, property) {
        if (property === "stat") return async (...args: Parameters<typeof fs.stat>) => {
          const stat = { ...await fs.stat(...args) };
          delete stat.uid;
          delete stat.gid;
          return { ...stat, ...owner };
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const command = createZipCommand({ zipHost: { entropy: async size => new Uint8Array(size).fill(7) } });
      const result = await run(command, ["-q", ...flags, "a.zip", "guide.md"], "", view);
      assert.equal(result.exitCode, 0, result.stderr);
      const archive = await readZipArchive(await fs.readFile("/a.zip"), settings({}), new AbortController().signal);
      for (const extra of [archive.entries[0]!.localExtra!, archive.entries[0]!.centralExtra!]) {
        const data = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
        const owners: Uint8Array[] = [];
        for (let offset = 0; offset < extra.length;) {
          const length = data.getUint16(offset + 2, true);
          if (data.getUint16(offset, true) === 0x7875) owners.push(extra.subarray(offset + 4, offset + 4 + length));
          offset += 4 + length;
        }
        if (flags.includes("-X") || owner.uid === undefined) assert.equal(owners.length, 0);
        else {
          assert.equal(owners.length, 1);
          const field = owners[0]!;
          assert.equal(field[0], 1);
          assert.equal(field[1], 4);
          assert.equal(field[6], 4);
          const ids = new DataView(field.buffer, field.byteOffset, field.byteLength);
          const stat = await view.stat("/guide.md");
          assert.equal(ids.getUint32(2, true), stat.uid);
          assert.equal(ids.getUint32(7, true), stat.gid);
        }
      }
    });
  }
}
