import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, wavAst, oggAst, MediaBudgetTracker } from "./index.js";
import { extractOggFlac } from "./containers/ogg.js";

const data = Float64Array.from({ length: 4097 }, (_, i) => i < 2048 ? 0 : i % 2 ? -1 : 1 - 2 ** -23);
const doc = wavAst().parse(encodeWav({ channels: [data], sampleRate: 16000 }, { bitsPerSample: 24 }));

for (const plugin of [flacAst(), oggAst()]) {
  it(`${plugin.id} Cholesky passes preserve silence, 24-bit extrema and a one-sample tail`, () => {
    for (const lpcPasses of [1, 2, 3, 12]) {
      const bytes = plugin.serialize(doc, { audioCodec: "flac", lpcType: "cholesky", lpcPasses });
      const decoded = flacAst().parse(plugin.id === "ogg" ? extractOggFlac(bytes)! : bytes);
      assert.deepEqual(decoded.tracks[0]!.decodedAudio!.channelData[0], data);
    }
  });

  it(`${plugin.id} ignores valid pass counts for other predictors and rejects invalid counts`, () => {
    for (const lpcType of ["none", "fixed", "levinson"]) {
      const options = { audioCodec: "flac", lpcType };
      assert.deepEqual(plugin.serialize(doc, { ...options, lpcPasses: 2147483647 }), plugin.serialize(doc, options));
    }
    for (const lpcPasses of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
      assert.throws(() => plugin.serialize(doc, { audioCodec: "flac", lpcType: "cholesky", lpcPasses }), /lpc_passes/);
    }
  });

  it(`${plugin.id} checks the caller's CPU budget during Cholesky refinement`, () => {
    const budget = new MediaBudgetTracker();
    let checks = 0;
    budget.checkCpu = () => { if (++checks === 3) throw new Error("analysis budget exhausted"); };
    assert.throws(() => plugin.serialize(doc, { audioCodec: "flac", lpcType: "cholesky", lpcPasses: 2147483647, budget }), /analysis budget exhausted/);
    assert.equal(checks, 3);
  });
}
