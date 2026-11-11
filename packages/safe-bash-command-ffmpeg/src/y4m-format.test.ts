import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const format of ["nonsense", "420jpeg"]) {
  for (const target of ["-", "/out.y4m"]) {
    it(`handles Y4M C${format} before writing ${target}`, async () => {
      const encode = (text: string) => new TextEncoder().encode(text);
      const input = concatBytes([encode(`YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C${format}\n`),
        ...[128, 160].flatMap(value => [encode("FRAME\n"), new Uint8Array(6).fill(value)])]);
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
      if (format === "nonsense") {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("YUV4MPEG stream contains an unknown pixel format"), stderr);
        assert.equal(concatBytes(chunks).length, 0);
        assert.equal(volume.readFileSync("/out.y4m", "utf8"), "keep");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = target === "-" ? concatBytes(chunks) : new Uint8Array(volume.readFileSync(target) as Buffer);
        assert.deepEqual(output, concatBytes([
          encode("YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C420jpeg XYSCSS=420JPEG\n"),
          input.subarray(input.indexOf(10) + 1)
        ]));
      }
    });
  }
}
