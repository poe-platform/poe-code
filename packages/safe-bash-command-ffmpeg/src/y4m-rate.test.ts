import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const rate of ["25:1", "30000:1001", "24000:1001", "12345:1001"]) {
  for (const codec of [["-c:v", "copy"], ["-vf", "fps=2"]]) {
    it(`keeps exact Y4M rate ${rate} with ${codec.join(" ")}`, async () => {
      const payloads = Array.from({ length: 30 }, () => Buffer.alloc(6, 128));
      const input = Buffer.concat([
        Buffer.from(`YUV4MPEG2 W2 H2 F${rate} Ip A1:1 C420jpeg\n`),
        ...payloads.flatMap(payload => [Buffer.from("FRAME\n"), payload])
      ]);
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.y4m", input);
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", ...codec, "-f", "yuv4mpegpipe", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const bytes = Buffer.concat(output);
      let cursor = bytes.indexOf(10) + 1;
      assert.ok(cursor > 0);
      const header = bytes.subarray(0, cursor - 1).toString().split(" ");
      assert.ok(header.includes(`F${codec[0] === "-vf" ? "2:1" : rate}`), header.join(" "));
      assert.ok(header.includes("W2"));
      assert.ok(header.includes("H2"));
      if (codec[0] === "-vf") return;
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
