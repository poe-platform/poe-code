import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { networkCommands } from "../../../src/commands/network/index.js";
import { fixture, nativeCurl, run, server } from "./helpers.js";

test("VFS binary upload and output match native curl bytes", async () => {
  const host = await server(); const fs = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "safe-bash-curl-native-"));
  const payload = Buffer.from([0, 255, 13, 10, 195, 169, 127]);
  try {
    await fs.writeFile("/work/input.bin", payload); await writeFile(join(directory, "input.bin"), payload);
    const args = ["--data-binary", "@input.bin", "-o", "result", host.origin + "/echo"];
    const actual = await run(args, { fs }); const expected = await nativeCurl(args, undefined, directory);
    assert.equal(actual.exitCode, expected.exitCode); assert.deepEqual(actual.stdout, expected.stdout);
    assert.deepEqual(Buffer.from(await fs.readFile("/work/result")), await readFile(join(directory, "result")));
    assert.deepEqual(Buffer.from(await fs.readFile("/work/input.bin")), payload);
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test("-O and -D write VFS-only files with exact native header bytes", async () => {
  const host = await server(); const fs = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "safe-bash-curl-output-"));
  try {
    const args = ["-O", "-D", "headers", host.origin + "/bytes"];
    const actual = await run(args, { fs }); const expected = await nativeCurl(args, undefined, directory);
    assert.equal(actual.exitCode, expected.exitCode);
    assert.deepEqual(Buffer.from(await fs.readFile("/work/bytes")), await readFile(join(directory, "bytes")));
    assert.deepEqual(Buffer.from(await fs.readFile("/work/headers")), await readFile(join(directory, "headers")));
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test("HEAD/include and dumped headers preserve every redirect block", async () => {
  const host = await server(); const fs = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "safe-bash-curl-redirect-"));
  try {
    for (const mode of ["-i", "-I"]) {
      const args = [mode, "-L", "-D", "headers", host.origin + "/redirect/302"];
      const actual = await run(args, { fs }); const expected = await nativeCurl(args, undefined, directory);
      assert.equal(actual.exitCode, expected.exitCode); assert.deepEqual(actual.stdout, expected.stdout);
      assert.deepEqual(Buffer.from(await fs.readFile("/work/headers")), await readFile(join(directory, "headers")));
    }
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test("writeout format comes from VFS, not the host home/config", async () => {
  const host = await server(); const fs = await fixture();
  try {
    await fs.writeFile("/work/format", Buffer.from("%{http_code}:%{size_download}\\n"));
    const actual = await run(["-o", "body", "-w", "@format", host.origin + "/bytes"], { fs });
    assert.equal(actual.exitCode, 0); assert.equal(actual.stdout.toString(), "200:7\n");
    const bad = await run(["-w", "%{unknown}", host.origin + "/bytes"], { fs });
    assert.equal(bad.exitCode, 2); assert.equal(bad.stdout.length, 0);
  } finally { await host.close(); }
});

test("fail flags do not report success or fabricate successful output", async () => {
  const host = await server(); const fs = await fixture();
  try {
    await fs.writeFile("/work/out", Buffer.from("existing"));
    const empty = await run(["-f", "-o", "out", host.origin + "/fail"], { fs });
    assert.equal(empty.exitCode, 22); assert.equal(Buffer.from(await fs.readFile("/work/out")).toString(), "existing");
    const body = await run(["--fail-with-body", "-o", "out", host.origin + "/fail"], { fs });
    assert.equal(body.exitCode, 22); assert.equal(Buffer.from(await fs.readFile("/work/out")).toString(), "teapot\n");
  } finally { await host.close(); }
});

test("multipart literal/file fields match native structural bytes", async () => {
  const host = await server(); const fs = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "safe-bash-curl-form-"));
  try {
    const bytes = Buffer.from([0, 255, 13, 10, 65]);
    await fs.writeFile("/work/input.bin", bytes); await writeFile(join(directory, "input.bin"), bytes);
    const args = ["-F", "field=hello", "--form-string", "literal=@not-a-file", "-F", "upload=@input.bin;type=application/octet-stream;filename=payload.bin", host.origin + "/echo"];
    const actual = await run(args, { fs }); const expected = await nativeCurl(args, undefined, directory);
    assert.equal(actual.exitCode, expected.exitCode);
    const normalize = (buffer: Buffer) => {
      const object = JSON.parse(buffer.toString());
      const boundary = object.contentType.split("boundary=")[1];
      return Buffer.from(object.body, "hex").toString("latin1").split(boundary).join("BOUNDARY");
    };
    assert.equal(normalize(actual.stdout), normalize(expected.stdout));
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test("real filesystem download is streamed and confined to its supplied root", async () => {
  const host = await server(); const directory = await mkdtemp(join(tmpdir(), "safe-bash-curl-real-"));
  try {
    const fs = await createRealFileSystem({ root: directory }); await fs.mkdir("/work");
    const actual = await run(["-o", "out", host.origin + "/bytes"], { fs });
    assert.equal(actual.exitCode, 0); assert.deepEqual(await readFile(join(directory, "work/out")), Buffer.from([0, 255, 195, 169, 10, 13, 128]));
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test("actual Shell can pipe binary curl output through virtual commands", async () => {
  const host = await server(); const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(networkCommands({ authorize: request => new URL(request.url).origin === host.origin }));
  try {
    const result = await shell.exec(`curl '${host.origin}/bytes' | wc -c`, { signal: AbortSignal.timeout(2000) });
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "7\n");
    const upload = await shell.exec(`printf 'hello' | curl -T - '${host.origin}/echo'`, { signal: AbortSignal.timeout(2000) });
    assert.equal(upload.exitCode, 0); assert.equal(JSON.parse(upload.stdout).body, Buffer.from("hello").toString("hex"));
  } finally { await shell.dispose(); await host.close(); }
});
