import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const length of [79, 80, 4096]) {
  for (const target of ["-", "/out.y4m"]) {
    it(`handles a ${length}-byte Y4M second frame header when writing ${target}`, async () => {
      const encode = (text: string) => new TextEncoder().encode(text);
      const header = "YUV4MPEG2 W3 H3 F25:1 Ip A1:1 C420jpeg\n";
      const firstFrame = concatBytes([encode("FRAME\n"), new Uint8Array(17).fill(128)]);
      const secondFrame = concatBytes([encode("FRAME\n"), new Uint8Array(17).fill(160)]);
      const input = concatBytes([encode(header), firstFrame,
        encode("FRAME X".padEnd(length, "a") + "\n"), new Uint8Array(17).fill(160)]);
      const volume = Volume.fromJSON({ "/out.y4m": "keep" });
      volume.writeFileSync("/in.y4m", input);
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-c:v", "copy", "-f", "yuv4mpegpipe", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = target === "-" ? concatBytes(chunks) : new Uint8Array(volume.readFileSync(target) as Buffer);
      assert.deepEqual(output.subarray(output.indexOf(10) + 1),
        length < 80 ? concatBytes([firstFrame, secondFrame]) : firstFrame);
      if (length >= 80) {
        assert.ok(stderr.includes("Error during demuxing: Invalid data found when processing input"), stderr);
      } else {
        assert.equal(stderr, "");
      }
    });
  }
}
