import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { decodeDialogueTable } from "./audio-dialogue-double-tables.js";

// Digests of the original uncompressed FFmpeg/glibc binary64 tables.
for (const [size, digest] of [
  [2048, "6bd29381301055dd9b949d2f5c19b10fc94fdc24b9e5a17c962377fea12869a8"],
  [4096, "2943b4fa8880a6ee29838d42e266d57132641ac90bd919d058990bbd2fb620c7"],
  [8192, "507fff28f27fda8d53dcfbb007f2ec7a4e05978f0006cb25460dd54521a27439"],
  ["cosine", "1591af890d7ff6e2b15006c61614f66309b8cf46499809bb21a9aa87fdc80975"]
] as const) {
  it(`preserves every binary64 constant in dialogue table ${size}`, () => {
    const decoded = decodeDialogueTable(size);
    assert.equal(createHash("sha256").update(new Uint8Array(decoded.buffer)).digest("hex"), digest);
  });
}
