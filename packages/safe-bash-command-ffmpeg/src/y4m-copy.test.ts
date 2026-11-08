import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const codec of [[], ["-c:v", "copy"]]) {
  it(`preserves both YUV420 frame payloads with ${codec.join(" ") || "the default codec"}`, async () => {
    const payloads = [Buffer.from("103050708090", "hex"), Buffer.from("90b0d0eb4048", "hex")];
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F2:1 Ip A1:1 C420jpeg\n"),
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
