import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: 4x2 RGBA, first frame linear, second frame sRGB.
const packets = [
  "716f696600000004000000020401ff003b76b1ff17528dc8ff2e69a4dfff4580bbf6ff2f6aa5e0ff4681bcf7ff5d98d30eff74afea250000000000000001",
  "716f696600000004000000020400ff25eaaf74ff0ed3985dfff7bc8146ffe0a56a2ffff6bb8045ffdfa4692effc88d5217ffb1763b000000000000000001"
].map(hex => Buffer.from(hex, "hex"));
const first = Buffer.from(Array.from({ length: 32 }, (_, i) =>
  (Math.floor(i / 4) % 4 * 23 + Math.floor(i / 16) * 47 + i % 4 * 59) % 256));
const frames = [first, Buffer.from(first).reverse()];

for (const source of ["/input.qoi", "/input", "pipe:0"]) {
  for (const mode of ["single", "pair", "explicit", "copy", "images", "trimmed", "limited", "truncated"] as const) {
    it(`auto-detects QOI ${source}: ${mode}`, async () => {
      const stream = Buffer.concat(mode === "single" ? packets.slice(0, 1) : packets);
      const input = mode === "truncated" ? stream.subarray(0, stream.length - 1) : stream;
      const volume = Volume.fromJSON({ [source]: input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand({ limits: mode === "limited" ? { maxFrames: 1 } : undefined }).execute({
        args: ["-v", "error", ...(mode === "explicit" ? ["-f", "image2pipe", "-c:v", "qoi"] : []),
          ...(mode === "trimmed" ? ["-framerate", "2"] : []), "-i", source,
          ...(mode === "trimmed" ? ["-ss", "0.5", "-t", "0.5"] : []),
          ...(mode === "copy" ? ["-c:v", "copy"] : ["-pix_fmt", "rgba"]),
          ...(mode === "images" ? ["/out%d.png"] : ["-f", mode === "copy" ? "framecrc" : "rawvideo", "pipe:1"])],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {
          for (let offset = 0; offset < input.length; offset += 7) yield input.subarray(offset, offset + 7);
        })(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (mode === "limited" || mode === "truncated") {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes(mode === "limited" ? "maxFrames" : "Invalid or truncated image2pipe qoi frame"), stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        if (mode === "copy") {
          assert.ok(Buffer.concat(stdout).toString().includes("#tb 0: 1/25\n"));
          assert.deepEqual(Buffer.concat(stdout).toString().trim().split("\n").filter(line => !line.startsWith("#")), [
            "0,          0,          0,        1,       62, 0x0c941a03",
            "0,          1,          1,        1,       62, 0x3b831a02"
          ]);
        } else if (mode === "images") {
          for (const [index, frame] of frames.entries()) {
            assert.deepEqual(Buffer.from(decodeImage(volume.readFileSync(`/out${index + 1}.png`) as Buffer).data), frame);
          }
        } else {
          assert.deepEqual(Buffer.concat(stdout), Buffer.concat(
            mode === "single" ? frames.slice(0, 1) : mode === "trimmed" ? frames.slice(1) : frames));
        }
      }
    });
  }
}

it("defers concatenated QOI input to the asynchronous demuxer before writing images", () => {
  const input = Buffer.concat(packets);
  const volume = Volume.fromJSON({ "/input.qoi": input });
  let writes = 0;
  assert.equal(evalSyncFfmpeg(["-y", "-i", "/input.qoi", "/out%d.png"], undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    () => { writes++; return true; }), undefined);
  assert.equal(writes, 0);
});
