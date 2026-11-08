import assert from "node:assert/strict";
import { it } from "node:test";
import { ffmetadataAst, parseFfmetadata, serializeFfmetadata } from "./index.js";

it("retains chapter tag dictionaries independently from globals and other chapters", () => {
  const input = new TextEncoder().encode([
    ";FFMETADATA1", "artist=Global", "[CHAPTER]", "TIMEBASE=1/1000", "START=0", "END=250",
    "artist=Alice", "MixedCase=value", "__proto__=data", "[CHAPTER]", "TIMEBASE=1/1000",
    "START=250", "END=500", "title=", "artist=Bob", "[CHAPTER]", "TIMEBASE=1/1000",
    "START=500", "END=750", "title=Final", "[CHAPTER]", "TIMEBASE=1/1000", "START=750", "END=1000", ""
  ].join("\n"));
  const expected = [{ artist: "Alice", MixedCase: "value", ["__proto__"]: "data" },
    { title: "", artist: "Bob" }, { title: "Final" }, {}];
  const doc = parseFfmetadata(input);
  const output = serializeFfmetadata(doc);
  assert.deepEqual(ffmetadataAst().probe!(output, {}).chapters.map(ch => ch.tags), expected);
  assert.equal(parseFfmetadata(output).metadata.artist, "Global");
  assert.equal(new TextDecoder().decode(output).includes("Chapter 1"), false);
});
