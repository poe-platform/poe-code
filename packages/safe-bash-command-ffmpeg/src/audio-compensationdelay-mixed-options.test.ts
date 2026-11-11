import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 128 mono PCM16 samples (256 + i) at 8 kHz.
// ffmpeg -v error -i in.wav -af compensationdelay=OPTIONS -f s16le pipe:1
for (const [options, hash] of [
  ["m=1", "fc5877946372d4c8c9c5fc929b2c84da71840806dc170d992205254b6a456b48"],
  ["m=1:", "fc5877946372d4c8c9c5fc929b2c84da71840806dc170d992205254b6a456b48"],
  ["wet=0.5:dry=0:10", "cdd51be3837b3fac3136d9ff6eaa2951acef02d23b275d228f18d0dcba95cccb"],
  ["wet=0.5:dry=0:mm=10", "cdd51be3837b3fac3136d9ff6eaa2951acef02d23b275d228f18d0dcba95cccb"],
  ["wet=0.5:dry=0:cm=10", "5f15c1cb9735e62b8649e2c02737fc80075e28d734b143fcd24ebfb17a716f34"],
  ["wet=0.5:dry=0:m=10", "5341e6b2646979a70e57653007a1f310169421ec9bdd9f1a5648f75ade005af1"],
  ["wet=0.5:10", "5f15c1cb9735e62b8649e2c02737fc80075e28d734b143fcd24ebfb17a716f34"],
  ["wet=0.5:dry=0:wet=0.5:10", "5f15c1cb9735e62b8649e2c02737fc80075e28d734b143fcd24ebfb17a716f34"],
  ["wet=0.5:dry=0:10:", "cdd51be3837b3fac3136d9ff6eaa2951acef02d23b275d228f18d0dcba95cccb"],
  ["0:0:1:0:1:20:", "fc5877946372d4c8c9c5fc929b2c84da71840806dc170d992205254b6a456b48"],
  ["1:dry=0:10", "a99bbb35b9d9d1258924ef4840b0f634ccfb9b299f31bbe9ee92d2baf1565e5d"]
] as const) {
  for (const graph of [false, true]) {
    it(`compensationdelay=${options} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "keep" });
      volume.writeFileSync("/in.wav", encodeWav({
        sampleRate: 8000,
        channels: [Float64Array.from({ length: 128 }, (_, i) => (256 + i) / 32768)]
      }, { bitsPerSample: 16 }));
      const filter = `compensationdelay=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, 256);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}
