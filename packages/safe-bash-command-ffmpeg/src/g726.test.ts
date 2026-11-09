import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("transcodes G.726 WAV to the complete native PCM16 output", async () => {
  const input = readFileSync(new URL("../../mp4-ast/src/fixtures/g726-4.wav", import.meta.url));
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out.raw") as Buffer;
  assert.equal(output.length, 8192);
  assert.equal(output.subarray(0, 16).toString("hex"), "a8ff98ff80ff4cff0cff84febcfdf0fb");
  assert.equal(createHash("sha256").update(output).digest("hex"), "2c8cc229e99f2773759900b1b78fd2e3d582232083839266bd839332287eeb46");
});

it("encodes raw PCM as G.726 WAV with native headers and payload", async () => {
  const input = Buffer.alloc(320);
  for (let i = 0; i < 160; i++) input.writeInt16LE((i * 331) % 60001 - 30000, i * 2);
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.pcm", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm", "-c:a", "g726", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out.wav") as Buffer;
  const fmt = output.indexOf("fmt ") + 8;
  const fact = output.indexOf("fact") + 8;
  const data = output.indexOf("data") + 8;
  assert.equal(output.readUInt16LE(fmt), 69);
  assert.equal(output.readUInt16LE(fmt + 2), 1);
  assert.equal(output.readUInt32LE(fmt + 4), 8000);
  assert.equal(output.readUInt32LE(fmt + 8), 4000);
  assert.equal(output.readUInt16LE(fmt + 12), 1);
  assert.equal(output.readUInt16LE(fmt + 14), 4);
  assert.equal(output.readUInt32LE(fact), 160);
  assert.equal(output.readUInt32LE(data - 4), 80);
  assert.equal(output.subarray(data, data + 16).toString("hex"), "88888888888abbbcbcbbbbbbcbbcbbbc");
});
