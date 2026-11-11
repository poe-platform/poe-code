import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(firstRate: number, secondRate: number, secondLength: number, explicit: boolean) {
  const volume = Volume.fromJSON({});
  for (const [path, count, rate, gain] of [
    ["/a.wav", 75, firstRate, 101], ["/b.wav", secondLength, secondRate, -203]
  ] as const) {
    volume.writeFileSync(path, encodeWav({ sampleRate: rate,
      channels: [Float64Array.from({ length: count }, (_, i) => gain * (i + 1) / 32768)] }));
  }
  const stdout: Buffer[] = [];
  let stderr = "";
  const graph = explicit
    ? `[1:a]aresample=${firstRate}[b];[0:a][b]concat=n=2:v=0:a=1[out]`
    : "[0:a][1:a]concat=n=2:v=0:a=1[out]";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex", graph,
      "-map", "[out]", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(stdout);
}

// FFmpeg 7.0.2, complete signed 16-bit little-endian mono output.
for (const [firstRate, secondRate, length, samples, hash] of [
  [16000, 8000, 97, 269, "65a5355665a46968ccc8bf5aa924999653e80313b554cc26fcaa78172a118823"],
  [8000, 16000, 97, 124, "f03b8a2ca36d161fd01a95470fc09e2e7dc1e08eb832e1353ee7dcf35f501b8f"],
  [11025, 8000, 97, 209, "7ca8610b630ba515407f7da1225ca29dc2f43bb495f9e578607e811c08a58b1e"],
  [16000, 8000, 25, 119, "002301d70557d6eccc5b6e3836b93f87d91b3ae09ae29849b6a7c3d492f3981a"],
  [16000, 8000, 10, 75, "2d39907d931254f910776ffa08cc47e4a8fb40f6cf3847eb8d7694a3dabb8b23"]
] as const) {
  for (const explicit of [false, true]) {
    it(`matches native concat resampling: ${secondRate} to ${firstRate}, ${length} samples (${explicit ? "explicit" : "automatic"})`, async () => {
      const output = await run(firstRate, secondRate, length, explicit);
      assert.equal(output.length, samples * 2);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
