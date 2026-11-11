import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const codec of [[], ["-c:v", "copy"]]) {
  for (const [aspect, interlace, range] of [["1:1", "p"], ["4:3", "p"], ["0:0", "p"], ["0:1", "p"], ["1:1", "t"], ["1:1", "b"], ["1:1", "p", "FULL"], ["1:1", "p", "LIMITED"]]) {
    it(`preserves YUV420 payloads and aspect ${aspect}, field order I${interlace}, range ${range ?? "unspecified"} with ${codec.join(" ") || "the default codec"}`, async () => {
      const payloads = [Buffer.from("103050708090", "hex"), Buffer.from("90b0d0eb4048", "hex")];
      const input = Buffer.concat([
        Buffer.from(`YUV4MPEG2 W2 H2 F2:1 I${interlace} A${aspect} C420jpeg${range ? ` XCOLORRANGE=${range}` : ""}\n`),
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
      assert.ok(header.includes(`A${aspect === "0:1" && codec.length === 0 ? "0:0" : aspect}`));
      assert.ok(header.includes(`I${interlace}`));
      assert.ok(header.includes("W2"));
      assert.ok(header.includes("H2"));
      assert.deepEqual(header.filter(token => token.startsWith("XCOLORRANGE=")), range ? [`XCOLORRANGE=${range}`] : []);
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
