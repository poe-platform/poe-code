import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const cases = [
  { flags: [], interlace: 0 },
  { flags: ["-flags", "+ildct"], interlace: 1 },
  { flags: ["-flags:v", "ildct"], interlace: 1 },
  { flags: ["-flags:v:0", "262144"], interlace: 1 },
  { flags: ["-flags", "+ildct", "-flags", "-ildct"], interlace: 0 },
  { flags: ["-flags", "+ildct", "-flags", "0"], interlace: 0 },
];

for (const mode of ["pipe", "sequence", "sync"] as const) {
  for (const [width, height] of [[8, 4], [9, 9], [1, 1]] as const) {
    for (const { flags, interlace } of cases) {
      it(`preserves RGB pixels with PNG ${flags.join(" ") || "defaults"} (${mode}, ${width}x${height})`, async () => {
        const rgb = Buffer.from(Array.from({ length: width * height * 3 }, (_, i) => {
          const pixel = Math.floor(i / 3);
          return ((pixel % width) * 23 + Math.floor(pixel / width) * 41 + (i % 3) * 53) % 256;
        }));
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.raw", rgb);
        const target = mode === "pipe" ? "pipe:1" : "/out%02d.png";
        let input = ["-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", `${width}x${height}`, "-i", "/in.raw"];
        if (mode === "sync") {
          const rgba = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : rgb[Math.floor(i / 4) * 3 + i % 4]!);
          volume.writeFileSync("/in.png", encodeImage({ width: width, height: height, data: rgba,
            channels: 3, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
          }, { format: "png" }).data);
          input = ["-i", "/in.png"];
        }
        const args = ["-v", "error", ...input, "-frames:v", "1", "-c:v", "png", ...flags,
          "-f", mode === "pipe" ? "image2pipe" : "image2", target];
        const stdout: Uint8Array[] = [];
        if (mode === "sync") {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        const png = mode === "pipe" ? Buffer.concat(stdout) : volume.readFileSync("/out01.png") as Buffer;
        assert.equal(png[24], 8);
        if (mode !== "sync") assert.equal(png[25], 2);
        assert.equal(png[28], interlace);
        const decoded = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(decoded.info.width, width);
        assert.equal(decoded.info.height, height);
        assert.deepEqual(decoded.data, rgb);
      });
    }
  }
}

for (const flag of ["unknown", "+ildct+", "1"]) {
  it(`rejects unsupported PNG flags without replacing output: ${flag}`, async () => {
    const volume = Volume.fromJSON({ "/out.png": "keep" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-f", "lavfi", "-i", "color=red:s=2x2", "-frames:v", "1", "-c:v", "png", "-flags", flag, "/out.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("Unsupported -flags value"), stderr);
    assert.equal(volume.readFileSync("/out.png", "utf8"), "keep");
  });
}
