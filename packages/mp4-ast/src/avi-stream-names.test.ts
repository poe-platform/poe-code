import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi } from "./containers/avi.js";

// Native FFmpeg: sine=frequency=440:duration=0.03 -map 0:a -map 0:a -c:a aac
// -metadata title=Meeting -metadata:s:a:0 title=Alice -metadata:s:a:1 title=Bob.
const fixture = readFileSync(new URL("./fixtures/stream-names.avi", import.meta.url));

it("reads each native AVI stream name separately from the container title", () => {
  const doc = parseAvi(fixture);
  assert.deepEqual(doc.tracks.map(track => track.metadata), [{ title: "Alice" }, { title: "Bob" }]);
  assert.equal(doc.metadata.title, "Meeting");
});

it("does not copy a neighboring stream name to an unnamed stream", () => {
  const bytes = Buffer.from(fixture);
  bytes.write("JUNK", bytes.indexOf("strn"));
  assert.deepEqual(parseAvi(bytes).tracks.map(track => track.metadata), [undefined, { title: "Bob" }]);
});

it("stops stream names at the first NUL and accepts unterminated names", () => {
  const bytes = Buffer.from(fixture);
  const first = bytes.indexOf("strn") + 8;
  bytes.set(Buffer.from("Al\0ice"), first);
  const second = bytes.indexOf("strn", first) + 8;
  bytes.set(Buffer.from("Bobs"), second);
  assert.deepEqual(parseAvi(bytes).tracks.map(track => track.metadata), [{ title: "Al" }, { title: "Bobs" }]);
});

it("reads all container INFO fields without leaking them to streams", () => {
  const bytes = Buffer.from(fixture);
  bytes.write("IART", bytes.indexOf("INAM"));
  assert.deepEqual(parseAvi(bytes).metadata.custom, { artist: "Meeting", software: "Lavf63.1.101" });
  bytes.write("ZZZZ", bytes.indexOf("IART"));
  assert.deepEqual(parseAvi(bytes).metadata.custom, { ZZZZ: "Meeting", software: "Lavf63.1.101" });
});
