import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { networkCommands } from "../../../src/commands/network/index.js";
import { fixture, run, server } from "./helpers.js";

test("VFS binary upload and output preserve input bytes", async () => {
  const host = await server(); const fs = await fixture();
  const payload = Buffer.from([0, 255, 13, 10, 195, 169, 127]);
  try {
    await fs.writeFile("/work/input.bin", payload);
    const args = ["--data-binary", "@input.bin", "-o", "result", host.origin + "/echo"];
    const actual = await run(args, { fs });
    assert.equal(actual.exitCode, 0); assert.equal(actual.stdout.length, 0);
    assert.deepEqual(Buffer.from(await fs.readFile("/work/input.bin")), payload);
  } finally { await host.close(); }
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
