import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

async function render(filter: string, graph: boolean) {
  const input = Buffer.alloc(1536 * 4);
  for (let i = 0; i < 1536; i++) {
    input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
    input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600 + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
  }
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.raw", input);
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const pcm = Buffer.concat(output);
  assert.equal(pcm.length, 18432);
  return createHash("sha256").update(pcm).digest("hex");
}

// Native FFmpeg 7.0.2, 1536 stereo PCM16 samples at 8 kHz.
const surround = "surround=win_size=1024";
const baseline = "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da";
for (const graph of [false, true]) {
  it(`surround retains baseline and unmatched-target PCM (${graph ? "graph" : "simple"})`, async () => {
    assert.equal(await render(surround, graph), baseline);
    assert.equal(await render(`asendcmd=c='0.064 surround@other fl_out 0',${surround}`, graph), baseline);
  });
  for (const [option, initial, scheduled] of [
    ["fl_out", "8f7993a6dda3bc73c7423d720c1f60f365bfdecaefabb43af4e95980eb9d5be6",
      "48af2d90c15c704a120027f9647cba6932438c9520e4ca59db9c0dff48e043d4"],
    ["lfe", "910c5afc1fe40d52dc39989722c5e8b82b326a0d6fd23503d8c6bc8677bdfa3f",
      "46789fec6a0ec2f608d65f932545d3271b2be8bd076cc6715879a0260dc46d2a"]
  ]) {
    it(`surround retains static ${option} PCM (${graph ? "graph" : "simple"})`, async () => {
      assert.equal(await render(`${surround}:${option}=0`, graph), initial);
    });
    for (const [time, expected] of [["0", initial], ["0.064", scheduled]]) {
      it(`surround applies ${option} at ${time} preserving overlap (${graph ? "graph" : "simple"})`, async () => {
        assert.equal(await render(`asendcmd=c='${time} surround ${option} 0',${surround}`, graph), expected);
      });
    }
  }
}

it("surround targets named instances and accepts every speaker's output level", async () => {
  for (const option of ["fl_out", "fr_out", "fc_out", "lfe_out", "bl_out", "br_out"]) {
    assert.equal(await render(`asendcmd=c='0 surround@room ${option} 0.5',surround@room=win_size=1024`, false),
      await render(`${surround}:${option}=0.5`, false));
  }
  assert.equal(await render(`asendcmd=c='0 surround@room lfe DISABLED',surround@room=win_size=1024`, true),
    await render(`${surround}:lfe=0`, true));
});

it("surround retains accepted settings after rejected commands and ignores changes at EOF", async () => {
  const expected = await render(`asendcmd=c='0.064 surround fl_out 0',${surround}`, false);
  for (const command of ["fl_out -1", "fl_out 11", "fl_out invalid", "lfe invalid", "win_size 2048", "unknown 0"]) {
    assert.equal(await render(`asendcmd=c='0.064 surround fl_out 0;0.128 surround ${command}',${surround}`, false), expected);
  }
  assert.equal(await render(`asendcmd=c='0.192 surround lfe 0',${surround}`, false), baseline);
});
