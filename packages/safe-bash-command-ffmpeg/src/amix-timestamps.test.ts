import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createHash } from "node:crypto";
import { createFfmpegCommand } from "./index.js";

async function mix(graph: string) {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  for (const [path, value] of [["/a.wav", 12000], ["/b.wav", -4000]] as const) {
    const channel = new Float64Array(path === "/a.wav" ? 2048 : 733).fill(value / 32768);
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: [channel] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav",
      "-filter_complex", graph, "-map", "[o]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}

// Native FFmpeg 7.0.2 reference: the first input starts at 0.5 seconds.
for (const [shift, selector, bytes] of [
  [4000, "gte(t,0.5)", 4096],
  [4000, "not(t)", 0],
  [0, "not(t)", 1024]
] as const) {
  it(`preserves amix first-input offset ${shift} through aselect=${selector}`, async () => {
    const { result, volume, error } = await mix(
      `[0:a]asetpts=PTS+${shift}[x];[x][1:a]amix,aselect='${selector}'[o]`);
    assert.equal(result.exitCode, 0, error);
    const output = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, bytes);
    if (bytes === 4096) {
      assert.equal(createHash("sha256").update(output).digest("hex").slice(0, 16), "e2cef1367f969d5b");
    }
  });
}
