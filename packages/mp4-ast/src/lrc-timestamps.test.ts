import assert from "node:assert/strict";
import { it } from "node:test";
import { lrcAst } from "./containers/lrc.js";

for (const [line, expected] of [
  ["[00:01.00][00:03.00]Chorus", [[1000, 2000, "Chorus"], [3000, 2000, "Chorus"]]],
  ["[00:01.00][00:03.00][00:04.00]Chorus", [[1000, 2000, "Chorus"], [3000, 1000, "Chorus"], [4000, 1000, "Chorus"]]],
  ["[00:01.00]one", [[1000, 4000, "one"]]],
  ["[00:03.00][00:01.00]Café", [[1000, 2000, "Café"], [3000, 2000, "Café"]]],
  ["[00:01.00][00:01.00]repeat", [[1000, 0, "repeat"], [1000, 4000, "repeat"]]],
  ["[00:01.00][00:03.00][Chorus]", [[1000, 2000, "[Chorus]"], [3000, 2000, "[Chorus]"]]]
] as const) {
  it(`expands adjacent LRC timestamps: ${line}`, () => {
    const doc = lrcAst().parse(new TextEncoder().encode(`${line}\r\n[00:05.00]end\r\n`));
    const samples = doc.tracks[0]!.samples;
    assert.deepEqual(samples.slice(0, -1).map(sample =>
      [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]), expected);
    assert.equal(samples.at(-1)!.pts, 5000);
    assert.equal(new TextDecoder().decode(samples.at(-1)!.data), "end");
  });
}
