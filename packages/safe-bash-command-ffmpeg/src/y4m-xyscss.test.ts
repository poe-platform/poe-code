import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [tags, chroma, size] of [["XYSCSS=444", "444", 27], ["C420jpeg XYSCSS=444", "420jpeg", 17], ["XYSCSS=444 C420jpeg", "420jpeg", 17]] as const) {
  for (const target of ["-", "/out.y4m"]) {
    it(`preserves ${tags} chroma placement and payloads copying to ${target}`, async () => {
      const payloads = [128, 160].map(value => Buffer.from(Array.from({ length: size }, (_, i) => value + i)));
      const input = Buffer.concat([
        Buffer.from(`YUV4MPEG2 W3 H3 F25:1 Ip A1:1 ${tags}\n`),
        ...payloads.flatMap(payload => [Buffer.from("FRAME\n"), payload])
      ]);
      const volume = Volume.fromJSON({ "/out.y4m": "keep" });
      volume.writeFileSync("/in.y4m", input);
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-c:v", "copy", "-f", "yuv4mpegpipe", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const bytes = target === "-" ? Buffer.concat(output) : volume.readFileSync(target) as Buffer;
      let cursor = bytes.indexOf(10) + 1;
      assert.ok(cursor > 0);
      const header = bytes.subarray(0, cursor - 1).toString().split(" ");
      assert.ok(header.includes(`C${chroma}`));
      assert.ok(header.includes("W3"));
      assert.ok(header.includes("H3"));
      for (const payload of payloads) {
        const end = bytes.indexOf(10, cursor);
        assert.equal(bytes.subarray(cursor, end).toString(), "FRAME");
        cursor = end + 1;
        assert.deepEqual(bytes.subarray(cursor, cursor + payload.length), payload);
        cursor += payload.length;
      }
      assert.equal(cursor, bytes.length);
    });
  }
}
