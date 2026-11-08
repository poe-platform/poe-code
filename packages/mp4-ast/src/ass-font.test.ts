import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeAssText } from "./containers/ass.js";

for (const [input, expected] of [
  [String.raw`{\fnCourier New\fs24\c&H0000FF&}RED`, '<font face="Courier New"><font size="24"><font color="#ff0000">RED</font></font></font>'],
  [String.raw`{\1c&H123456&}color`, '<font color="#563412">color</font>'],
  [String.raw`{\fnArial\i1}A{\fnCourier New}B{\r}C`, '<font face="Arial"><i>A</i></font><i><font face="Courier New">B</font></i>C'],
  [String.raw`{\fs24}A{\fs}B{\c&HFF&}C{\c}D`, '<font size="24">A</font>B<font color="#ff0000">C</font>D'],
  [String.raw`{\fnA"&<>}text`, '<font face="A&quot;&amp;&lt;&gt;">text</font>'],
  [String.raw`{\fswat\c&Hxyz&\2c&HFFFFFF&}text`, 'text']
] as const) {
  it(`decodes ASS font overrides: ${input}`, () => {
    assert.equal(decodeAssText(input), expected);
  });
}
