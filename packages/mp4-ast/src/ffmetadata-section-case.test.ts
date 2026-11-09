import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const section of ["chapter", "Chapter", "CHAPTER"]) {
  it(`recognizes only uppercase chapter sections: ${section}`, () => {
    const doc = parseFfmetadata(new TextEncoder().encode(
      `;FFMETADATA1\n[${section}]\nTIMEBASE=1/1000\nSTART=100\nEND=500\ntitle=Intro\n`
    ));
    if (section === "CHAPTER") {
      assert.equal(doc.chapters?.length, 1);
      assert.equal(doc.chapters[0]!.startTimeSeconds, 0.1);
      assert.equal(doc.chapters[0]!.endTimeSeconds, 0.5);
      assert.equal(doc.chapters[0]!.title, "Intro");
      assert.equal(doc.metadata.title, undefined);
    } else {
      assert.equal(doc.chapters?.length ?? 0, 0);
      assert.equal(doc.metadata.title, "Intro");
    }
    const roundtrip = parseFfmetadata(serializeFfmetadata(doc));
    assert.deepEqual(roundtrip.chapters, doc.chapters);
    assert.equal(roundtrip.metadata.title, doc.metadata.title);
  });
}
