import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { decodeAudio } from "./index.js";

const data = readFileSync(new URL("../../mp4-ast/src/fixtures/amr-nb-decode.3gp", import.meta.url)).subarray(44, 76);

it("releases AMR-NB decoder state after malformed input and early iterator disposal", () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.throws(() => [...decodeAudio("AMR-NB", [{ data: data.subarray(0, 4), pts: 0, dts: 0, duration: 160 }])], /AMR-NB/);
    const frames = decodeAudio("AMR-NB", [{ data, pts: 0, dts: 0, duration: 160 }]);
    const frame = frames.next().value!;
    assert.equal(frame.sampleRate, 8000);
    assert.equal(frame.channelData.length, 1);
    assert.equal(frame.channelData[0]!.length, 160);
    frames.return(undefined);
  }
});
