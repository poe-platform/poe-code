import assert from "node:assert/strict";
import { it } from "node:test";
import { ffmetadataAst, parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const [first, last] of [["Title", "title"], ["title", "TITLE"], ["artist", "ARTIST"], ["Custom", "custom"], ["__proto__", "__PROTO__"]] as const) {
  for (const value of ["second", ""]) {
    it(`replaces chapter ${first} with ${last}=${value} independently of other metadata`, () => {
      const prefix = ";FFMETADATA1\ntitle=Album\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\n";
      const suffix = "genre=Talk\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=8000\ntitle=Body\nartist=Ada\n";
      const input = new TextEncoder().encode(`${prefix}${first}=first\n${last}=${value}\n${suffix}`);
      const doc = parseFfmetadata(input);
      assert.deepEqual(doc.chapters?.[0]?.tags, { [last]: value, genre: "Talk" });
      assert.equal(doc.chapters?.[0]?.title, last.toLowerCase() === "title" ? value : "");
      assert.equal(new TextDecoder().decode(serializeFfmetadata(doc)), `${prefix}${last}=${value}\n${suffix}`);
      assert.deepEqual(ffmetadataAst().probe!(input, {}).chapters[0]?.tags, { [last]: value, genre: "Talk" });
    });
  }
}
