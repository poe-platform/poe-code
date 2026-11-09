import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const length of [127, 128]) {
  for (const target of ["-", "/out.y4m"]) {
    it(`handles a ${length}-byte Y4M stream header before writing ${target}`, async () => {
      const encode = (text: string) => new TextEncoder().encode(text);
      const header = "YUV4MPEG2 W3 H3 F25:1 Ip A1:1 C420jpeg X";
      const input = concatBytes([encode(header.padEnd(length, "a") + "\n"),
        encode("FRAME\n"), new Uint8Array(17).fill(128),
        encode("FRAME\n"), new Uint8Array(17).fill(160)]);
      const volume = Volume.fromJSON({ "/out.y4m": "keep" });
      volume.writeFileSync("/in.y4m", input);
      const chunks: Uint8Array[] = [];
      let stderr = "";
      let writes = 0;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-c:v", "copy", "-f", "yuv4mpegpipe", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { writes++; volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (length === 128) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(writes, 0);
        assert.ok(stderr.includes("Header too large"), stderr);
        assert.equal(concatBytes(chunks).length, 0);
        assert.equal(volume.readFileSync("/out.y4m", "utf8"), "keep");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = target === "-" ? concatBytes(chunks) : new Uint8Array(volume.readFileSync(target) as Buffer);
        assert.deepEqual(output.subarray(output.indexOf(10) + 1), input.subarray(length + 1));
      }
    });
  }
}
