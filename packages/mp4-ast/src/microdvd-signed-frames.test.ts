import assert from "node:assert/strict";
import { it } from "node:test";
import { microdvdAst } from "./containers/microdvd.js";

for (const [frames, start, end] of [
  ["{-25}{0}", -25, 0],
  ["{+1}{25}", 1, 25],
  ["{ 1}{25}", 1, 25],
  ["{1}{ 25}", 1, 25],
  ["{\t+1}{\v+25}", 1, 25],
  ["{-25}{-1}", -25, -1],
  ["{1}{25}", 1, 25]
] as const) {
  it(`reads and detects MicroDVD frame fields ${JSON.stringify(frames)}`, () => {
    const plugin = microdvdAst();
    const bytes = new TextEncoder().encode(`${frames}Cue\n`);
    assert.equal(plugin.detect(bytes), true);
    const samples = plugin.parse(bytes).tracks[0]!.samples;
    assert.equal(samples.length, 1);
    assert.deepEqual([samples[0]!.pts, samples[0]!.dts, samples[0]!.duration],
      [start, start, end - start]);
    assert.equal(new TextDecoder().decode(plugin.serialize(plugin.parse(bytes))),
      `{${start}}{${end}}Cue\n`);
  });
}

for (const frames of ["{+}{25}", "{ }{25}", "{1 }{25}", "{1}{25 }", "{1}{ }",
  "{1}{+}", "{1.5}{25}", "{0x1}{25}", "{1e1}{25}", "{--1}{25}", "{+ 1}{25}",
  "{9007199254740992}{25}", "{-9007199254740992}{25}"]) {
  it(`rejects malformed MicroDVD frame fields ${JSON.stringify(frames)}`, () => {
    const plugin = microdvdAst();
    const bytes = new TextEncoder().encode(`${frames}Cue\n`);
    assert.equal(plugin.detect(bytes), false);
    assert.deepEqual(plugin.parse(bytes).tracks[0]!.samples, []);
  });
}
