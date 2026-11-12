import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeWavpackTrack, allMediaAsts, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = Buffer.alloc(256 * 4);
for (let i = 0; i < 256; i++) for (let ch = 0; ch < 2; ch++) {
  input.writeInt16LE((i * 31337 + ch * 997) % 65536 - 32768, i * 4 + ch * 2);
}
const inputArgs = ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw", "-c:a", "wavpack"];

async function run(args: string[]) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.raw", input);
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: [...inputArgs, ...args], command: "ffmpeg", cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  return { fs, stdout };
}

it("encodes distinct stereo PCM as WavPack packets for framecrc", async () => {
  const { stdout } = await run(["-f", "framecrc", "pipe:1"]);
  assert.ok(stdout.includes("#codec_id 0: wavpack\n"), stdout);
  assert.ok(stdout.includes("#tb 0: 1/8000\n"), stdout);
  const rows = stdout.split("\n").filter(line => line.startsWith("0,")).map(line => line.split(",").map(value => value.trim()));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.slice(0, 4).map(Number), [0, 0, 0, 256]);
  assert.ok(Number(rows[0]![4]) > 32);
});

it("encodes WavPack in Matroska with an exact native PCM round trip", async () => {
  const { fs } = await run(["-f", "matroska", "/out.mkv"]);
  const output = await fs.readFile("/out.mkv");
  assert.ok(Buffer.from(output).includes(Buffer.from("A_WAVPACK4")));
  const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input: output });
  assert.equal(decoded.status, 0, decoded.stderr?.toString() ?? String(decoded.error));
  assert.deepEqual(decoded.stdout, input);
  let syncOutput: Uint8Array | undefined;
  assert.equal(evalSyncFfmpeg([...inputArgs, "-f", "matroska", "/out.mkv"], undefined,
    path => path === "/in.raw" ? input : undefined,
    (_path, bytes) => { syncOutput = bytes; return true; }), "");
  assert.deepEqual(syncOutput, output);
});

it("hashes encoded WavPack packets with native frame checksums and stream hashes", async () => {
  const doc = allMediaAsts().find(plugin => plugin.id === "s16le")!.parse(input, { sampleRate: 8000, channels: 2 });
  const packets = Buffer.concat(encodeWavpackTrack(doc.tracks[0]!, new MediaBudgetTracker()).samples.map(packet => packet.data));
  for (const format of ["framecrc", "framemd5", "framehash"]) {
    const { stdout } = await run(["-f", format, "pipe:1"]);
    const native = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "copy", "-f", format, "pipe:1"], { input: packets });
    assert.equal(native.status, 0, native.stderr?.toString() ?? String(native.error));
    assert.deepEqual(stdout.split("\n").filter(line => line.startsWith("0,")),
      native.stdout.toString().split("\n").filter(line => line.startsWith("0,")));
  }
  const digest = createHash("sha256").update(packets).digest("hex");
  assert.equal((await run(["-f", "hash", "pipe:1"])).stdout, `SHA256=${digest}\n`);
  assert.equal((await run(["-f", "streamhash", "pipe:1"])).stdout, `0,a,SHA256=${digest}\n`);
});
