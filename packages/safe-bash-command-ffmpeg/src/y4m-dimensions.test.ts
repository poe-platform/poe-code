import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const fields of ["H2 F25:1", "W0 H2 F25:1", "W2 F25:1", "W2 H0 F25:1", "W2 H2 F25:1"]) {
  for (const target of ["-", "/out.y4m"]) {
    it(`handles Y4M dimensions ${fields} before writing ${target}`, async () => {
      const encode = (text: string) => new TextEncoder().encode(text);
      const input = concatBytes([encode(`YUV4MPEG2 ${fields} Ip A1:1 C420jpeg\n`),
        encode("FRAME\n"), new Uint8Array(fields === "W2 H2 F25:1" ? 6 : 192).fill(128)]);
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
      if (fields !== "W2 H2 F25:1") {
        assert.notEqual(result.exitCode, 0);
        assert.equal(writes, 0);
        assert.ok(stderr.includes("Invalid YUV4MPEG2 dimensions"), stderr);
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
