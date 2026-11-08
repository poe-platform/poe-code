import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { image2Ast } from "@poe-code/mp4-ast";
import { decodeImage } from "@poe-code/image-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// ImageMagick 7 QOI fixtures, independently encoded from the expected RGBA pixels.
const fixtures = [
  "716f696600000004000000020400fe1234567fc0ffabcdef8009ffabcdef00ff808080fffe0000000000000000000001",
  "716f696600000004000000020300fe1234567fc0feabcdef0900fe808080fe0000000000000000000001"
];
for (const [index, fixture] of fixtures.entries()) {
  for (const sync of [false, true]) {
    // Raw video uses the asynchronous command path.
    for (const raw of sync ? [false] : [false, true]) {
      it(`decodes native QOI pixels (alpha=${index === 0}, sync=${sync}, raw=${raw})`, async () => {
        const expected = Buffer.from("123456ff133557ff133557ffabcdef80123456ffabcdef00808080ff000000ff", "hex");
        if (index === 1) for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
        // No extension: detection must recognize the bytes themselves.
        const volume = Volume.fromJSON({ "/input": Buffer.from(fixture, "hex") });
        const output = raw ? "/out.rgba" : "/out.png";
        const args = ["-y", "-v", "error", "-i", "/input", ...(raw ? ["-pix_fmt", "rgba", "-f", "rawvideo"] : []), output];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
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
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        const bytes = volume.readFileSync(output) as Buffer;
        if (raw) assert.deepEqual(bytes, expected);
        else {
          const image = decodeImage(bytes);
          assert.equal(image.width, 4);
          assert.equal(image.height, 2);
          assert.deepEqual(Buffer.from(image.data), expected);
        }
      });
    }
  }
}

it("reports QOI pixel formats and rejects corrupt input instead of fabricating pixels", () => {
  for (const [index, fixture] of fixtures.entries()) {
    const bytes = Buffer.from(fixture, "hex");
    const plugin = image2Ast();
    assert.equal(plugin.detect(bytes, "input.qoi"), true);
    const doc = plugin.parse(bytes);
    assert.equal(doc.tracks[0]?.codecDescriptions[0]?.codecName, "qoi");
    assert.equal(doc.tracks[0]?.codecDescriptions[0]?.pixFmt, index === 0 ? "rgba" : "rgb24");
    assert.throws(() => plugin.parse(bytes.subarray(0, 20)), /QOI/);
  }
});
