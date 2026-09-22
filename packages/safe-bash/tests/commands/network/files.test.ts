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

test("curl --output-dir writes explicit and remote filenames in the existing VFS directory", async () => {
  const host = await server(); const fs = await fixture();
  const payload = Buffer.from([0, 255, 195, 169, 10, 13, 128]);
  try {
    await fs.mkdir("/work/sub");
    await fs.writeFile("/work/sub/placeholder", Buffer.from(""));
    const shell = new Shell({ fs, cwd: "/work" }).use(networkCommands({ authorize: request => new URL(request.url).origin === host.origin }));
    try {
      const actual = await shell.exec(`curl --output-dir sub -o output '${host.origin}/bytes'`, { signal: AbortSignal.timeout(2000) });
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(actual.stdout, "");
      assert.deepEqual(Buffer.from(await fs.readFile("/work/sub/output")), payload);
      await assert.rejects(fs.stat("/work/output"), { code: "ENOENT" });
    } finally { await shell.dispose(); }
    const remote = await run(["--output-dir", "sub", "-O", "-w", "%{filename_effective}", host.origin + "/bytes"], { fs });
    assert.equal(remote.exitCode, 0, remote.stderr.toString());
    assert.equal(remote.stdout.toString(), "sub/bytes");
    assert.deepEqual(Buffer.from(await fs.readFile("/work/sub/bytes")), payload);
  } finally { await host.close(); }
});

test("curl output directory applies only to body files and preserves stdout", async () => {
  const host = await server(); const fs = await fixture();
  try {
    await fs.mkdir("/work/sub");
    const actual = await run(["--output-dir=sub", "-o", "body", "-D", "headers", "-w", "%{filename_effective}", host.origin + "/bytes"], { fs });
    assert.equal(actual.exitCode, 0, actual.stderr.toString());
    assert.equal(actual.stdout.toString(), "sub/body");
    assert.ok((await fs.readFile("/work/headers")).length > 0);
    await assert.rejects(fs.stat("/work/sub/headers"), { code: "ENOENT" });
    for (const output of [[], ["-o", "-"]]) {
      const stdout = await run(["--output-dir", "missing", ...output, host.origin + "/bytes"], { fs });
      assert.equal(stdout.exitCode, 0, stdout.stderr.toString());
      assert.deepEqual(stdout.stdout, Buffer.from([0, 255, 195, 169, 10, 13, 128]));
    }
  } finally { await host.close(); }
});

test("curl output directory does not create parents or bypass body/header collision checks", async () => {
  const host = await server(); const fs = await fixture();
  try {
    const missing = await run(["--output-dir", "missing", "-o", "output", host.origin + "/bytes"], { fs });
    assert.equal(missing.exitCode, 23, missing.stderr.toString());
    await assert.rejects(fs.stat("/work/missing"), { code: "ENOENT" });
    await fs.mkdir("/work/sub");
    const collision = await run(["--output-dir", "sub", "-o", "output", "-D", "sub/output", host.origin + "/bytes"], { fs });
    assert.equal(collision.exitCode, 23, collision.stderr.toString());
    await assert.rejects(fs.stat("/work/sub/output"), { code: "ENOENT" });
    const invalid = await run([host.origin + "/bytes", "--output-dir"], { fs });
    assert.equal(invalid.exitCode, 2);
    assert.match(invalid.stderr.toString(), /Option requires an argument/);
  } finally { await host.close(); }
});

test("curl output directory prefixes absolute filenames and remains the retry destination", async () => {
  const host = await server(); const fs = await fixture();
  try {
    await fs.mkdir("/work/sub");
    const absolute = await run(["--output-dir", "sub", "-o", "/output", "-w", "%{filename_effective}", host.origin + "/bytes"], { fs });
    assert.equal(absolute.exitCode, 0, absolute.stderr.toString());
    assert.equal(absolute.stdout.toString(), "sub//output");
    assert.deepEqual(Buffer.from(await fs.readFile("/work/sub/output")), Buffer.from([0, 255, 195, 169, 10, 13, 128]));
    await assert.rejects(fs.stat("/output"), { code: "ENOENT" });
    const retried = await run(["--output-dir", "sub", "-o", "output", "--retry", "2", "--retry-delay", "0.001", host.origin + "/retry"], { fs });
    assert.equal(retried.exitCode, 0, retried.stderr.toString());
    assert.equal(retried.stdout.length, 0);
    assert.equal(Buffer.from(await fs.readFile("/work/sub/output")).toString(), "recovered");
    await assert.rejects(fs.stat("/work/output"), { code: "ENOENT" });
  } finally { await host.close(); }
});

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
