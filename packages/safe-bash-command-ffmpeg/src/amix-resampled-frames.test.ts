import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function mix(rate: number, count: number, transition: string, explicit: boolean, format: string) {
  const volume = Volume.fromJSON({});
  for (const [name, length, value] of [["a", count, 12000], ["b", 200, 4000]] as const) {
    const bytes = Buffer.alloc(length * 2);
    for (let i = 0; i < length; i++) bytes.writeInt16LE(value, i * 2);
    volume.writeFileSync(`/${name}.raw`, bytes);
  }
  const graph = explicit ? "[1:a]aresample=2000[b];[0:a][b]" : "[0:a][1:a]";
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "2000", "-ac", "1", "-i", "/a.raw",
      "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", "/b.raw", "-filter_complex",
      `${graph}amix${transition === "2" ? "" : `=dropout_transition=${transition}`}`,
      "-f", format, "/out"],
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
  return volume.readFileSync("/out") as Buffer;
}

// Native FFmpeg 7.0.2: retain resampler startup delay and the separate EOF flush frame.
for (const { rate, count, transition, runs, frames } of [
  {"rate": 1000, "count": 145, "transition": "0.2", "runs": [[145, 8000], [79, 2219], [128, 2698], [16, 2773], [32, 2936]], "frames": [[128, "0xe1592f80"], [17, "0x6f7f064f"], [79, "0x4197373d"], [128, "0x472b4a00"], [16, "0xec500df0"], [32, "0x1b1e1060"]]},
  {"rate": 1000, "count": 145, "transition": "2", "runs": [[145, 8000], [79, 2020], [128, 2053], [16, 2057], [32, 2066]], "frames": [[128, "0xe1592f80"], [17, "0x6f7f064f"], [79, "0xa8b14885"], [128, "0x42ad0680"], [16, "0x11900110"], [32, "0x6a400340"]]},
  {"rate": 1000, "count": 145, "transition": "0", "runs": [[145, 8000], [255, 4000]], "frames": [[128, "0xe1592f80"], [17, "0x6f7f064f"], [79, "0xdc9f3601"], [128, "0x12945780"], [16, "0xb9000af0"], [32, "0xd01e15e0"]]},
  {"rate": 4000, "count": 45, "transition": "0.2", "runs": [[45, 8000], [39, 2102], [16, 2148]], "frames": [[45, "0xfad510b3"], [39, "0x78a70972"], [16, "0x724006c0"]]},
  {"rate": 2000, "count": 145, "transition": "0.2", "runs": [[145, 8000], [55, 2148]], "frames": [[128, "0xe1592f80"], [17, "0x6f7f064f"], [55, "0x11f31734"]]},
] as const) {
  for (const explicit of [false, true]) {
    it(`amix recovers gain at resampled frames: rate=${rate}, transition=${transition}, explicit=${explicit}`, async () => {
      const pcm = await mix(rate, count, transition, explicit, "s16le");
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
        runs.flatMap(([length, value]) => Array<number>(length).fill(value)));
    });

    it(`amix preserves resampled framecrc: rate=${rate}, transition=${transition}, explicit=${explicit}`, async () => {
      const output = await mix(rate, count, transition, explicit, "framecrc");
      let pts = 0;
      const expected = frames.map(([duration, checksum]) => {
        const row = ["0", String(pts), String(pts), String(duration), String(duration * 2), checksum];
        pts += duration;
        return row;
      });
      assert.deepEqual(output.toString().split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim())), expected);
    });
  }
}
