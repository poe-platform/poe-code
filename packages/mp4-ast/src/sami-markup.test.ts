import assert from "node:assert/strict";
import { it } from "node:test";
import { samiAst } from "./containers/sami.js";

it("retains SAMI emphasis and font markup with text, timing, and line breaks", () => {
  const doc = samiAst().parse(new TextEncoder().encode('<SAMI><BODY><SYNC Start=1000><P><B>bold</B> <font color=red>red</font><br><i>next</i><SYNC Start=4000><P>done</BODY></SAMI>'));
  assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.duration, new TextDecoder().decode(s.data)]),
    [[1000, 3000, '<b>bold</b> <font color="red">red</font>\n<i>next</i>'], [4000, 0xffffffff, "done"]]);
});
