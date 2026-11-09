import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = encodeWav({ sampleRate: 8000, channels: [
  Float64Array.from({ length: 64 }, (_, i) => (i + 1) / 32768),
  Float64Array.from({ length: 64 }, (_, i) => -(i + 1) / 32768)
] });

async function run(args: string[], limits = {}) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/digest.txt": "KEEP" });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-i", "in.wav", ...args],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { fs, result, stdout: Buffer.concat(chunks), stderr };
}

for (const format of ["s16be", "s16le"]) for (const target of ["md5:digest.txt", "md5:"]) {
  it(`${target} hashes final ${format} bytes and writes a bare digest line`, async () => {
    const args = ["-c:a", `pcm_${format}`, "-f", format];
    const control = await run([...args, "control.pcm"]);
    assert.equal(control.result.exitCode, 0, control.stderr);
    const bytes = control.fs.readFileSync("/control.pcm") as Buffer;
    assert.equal(bytes.length, 256);
    const expected = `${createHash("md5").update(bytes).digest("hex")}\n`;
    assert.equal(expected, format === "s16be" ? "66877087ade19ddff4dc50f7162c9a0a\n" : "f0f5014c46af5eeaf53fa2557e09c388\n");
    assert.notEqual(expected.trim(), createHash("md5").update(input).digest("hex"));
    const actual = await run([...args, target]);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(actual.fs.existsSync(`/${target}`), false);
    assert.equal(actual.stdout.toString(), target === "md5:" ? expected : "");
    assert.equal(actual.fs.readFileSync("/digest.txt", "utf8"), target === "md5:" ? "KEEP" : expected);
  });
}

it("md5 output is nonseekable, so WAV headers match pipe output", async () => {
  const control = await run(["-c:a", "pcm_s16le", "-f", "wav", "-"]);
  assert.equal(control.result.exitCode, 0, control.stderr);
  const actual = await run(["-c:a", "pcm_s16le", "-f", "wav", "md5:"]);
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout.toString(), `${createHash("md5").update(control.stdout).digest("hex")}\n`);
  assert.equal(actual.fs.existsSync("/md5:"), false);
});

it("multiple outputs never pre-create a literal md5 protocol filename", async () => {
  const actual = await run(["-f", "s16be", "md5:digest.txt", "-f", "s16le", "md5:"]);
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.fs.readdirSync("/"), ["digest.txt", "in.wav"]);
  assert.equal(actual.stdout.length, 33);
  assert.equal((actual.fs.readFileSync("/digest.txt") as Buffer).length, 33);
  assert.notEqual(actual.stdout.toString(), actual.fs.readFileSync("/digest.txt", "utf8"));
});

it("md5 keeps the encoded output budget even though the digest is small", async () => {
  const actual = await run(["-f", "s16be", "md5:digest.txt"], { maxOutputBytes: 64 });
  assert.notEqual(actual.result.exitCode, 0);
  assert.match(actual.stderr, /maxOutputBytes/);
  assert.equal(actual.fs.readFileSync("/digest.txt", "utf8"), "KEEP");
  assert.equal(actual.fs.existsSync("/md5:digest.txt"), false);
});

it("the synchronous optimization defers md5 URLs before any file writes", () => {
  const writes: string[] = [];
  const result = evalSyncFfmpeg(["-y", "-i", "/in.wav", "-f", "s16be", "md5:digest.txt"],
    undefined, path => path === "/in.wav" ? input : undefined,
    path => { writes.push(path); return true; });
  assert.equal(result, undefined);
  assert.deepEqual(writes, []);
});

for (const format of ["data", "md5"]) {
  it(`md5 protocol hashes the complete ${format} muxer output`, async () => {
    const args = ["-map", "0:a", "-c:a", "copy", "-f", format];
    const control = await run([...args, "-"]);
    assert.equal(control.result.exitCode, 0, control.stderr);
    const actual = await run([...args, "md5:"]);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(actual.stdout.toString(), `${createHash("md5").update(control.stdout).digest("hex")}\n`);
    assert.equal(actual.fs.existsSync("/md5:"), false);
  });
}

it("md5 reports destination write errors without creating a protocol filename", async () => {
  const actual = await run(["-f", "s16be", "md5:missing/digest.txt"]);
  assert.notEqual(actual.result.exitCode, 0);
  assert.match(actual.stderr, /ENOENT/);
  assert.deepEqual(actual.fs.readdirSync("/"), ["digest.txt", "in.wav"]);
});
