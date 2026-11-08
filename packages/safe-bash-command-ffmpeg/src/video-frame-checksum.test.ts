import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseY4m, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { serializeFrameChecksum } from "./frame-checksum.js";
import { createFfmpegCommand } from "./index.js";

const frames = [Buffer.from("103050708090", "hex"), Buffer.from("90b0d0eb4048", "hex")];
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F2:1 Ip A1:1 C420jpeg\n"),
  ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
for (const format of ["framemd5", "framehash", "framecrc"]) {
  for (const target of ["-", "/out.txt"]) {
    it(`writes native video packet checksums for ${format} to ${target}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.y4m", input);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.y4m", "-f", format, target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      const output = target === "-" ? Buffer.concat(stdout).toString() : volume.readFileSync(target, "utf8") as string;
      for (const header of ["#tb 0: 1/2", "#media_type 0: video", "#codec_id 0: rawvideo", "#dimensions 0: 2x2", "#sar 0: 1/1"]) {
        assert.ok(output.split("\n").includes(header), output);
      }
      assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim())), frames.map((frame, i) => [
          "0", String(i), String(i), "1", "6", format === "framecrc" ? ["0x05700210", "0x0d990383"][i] :
            createHash(format === "framemd5" ? "md5" : "sha256").update(frame).digest("hex")
        ]));
    });
  }
}

it("hashes video without requiring an audio AST and preserves fractional frame rates", () => {
  const doc = parseY4m(Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F30000:1001 Ip A1:1 C420jpeg\n"),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]));
  const output = new TextDecoder().decode(serializeFrameChecksum(doc, "framemd5", "md5", undefined, undefined, new MediaBudgetTracker()));
  assert.ok(output.includes("#tb 0: 1001/30000\n"), output);
  assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#"))
    .map(line => line.split(",").map(field => field.trim())), [
      ["0", "0", "0", "1", "6", "8fa976596db6f0f6de59a7a5e9c5b476"],
      ["0", "1", "1", "1", "6", "1ab5d09fd13a0bab6d9d0782e2285b04"]
    ]);
});
