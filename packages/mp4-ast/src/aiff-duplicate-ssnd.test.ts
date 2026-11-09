import assert from "node:assert/strict";
import { it } from "node:test";
import { parseAiff } from "./containers/aiff.js";

for (const filename of ["in.aiff", "pipe:0", "pipe:", "-"]) {
  for (const duplicate of [false, true]) {
    it(`decodes ${duplicate ? "duplicate" : "single"} SSND chunks from ${filename}`, () => {
      let bytes = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe70", "hex");
      if (duplicate) {
        bytes = Buffer.concat([bytes, Buffer.from("53534e440000000e00000002000000000000fffffffe", "hex")]);
        bytes.writeUInt32BE(bytes.length - 8, 4);
      }
      const doc = parseAiff(bytes, { filename });
      assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768),
        duplicate && filename === "in.aiff" ? [-1, -2] : [100, -200, 300, -400]);
    });
  }
}

it("decodes the final full-length SSND chunk by default", () => {
  const bytes = Buffer.from("464f524d0000004e41494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe7053534e44000000100000000000000000fffffffefffdfffc", "hex");
  assert.deepEqual(Array.from(parseAiff(bytes).tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768), [-1, -2, -3, -4]);
  bytes.writeUInt32BE(9, 70);
  assert.equal(parseAiff(bytes).tracks[0]!.decodedAudio!.channelData[0]!.length, 0);
});
