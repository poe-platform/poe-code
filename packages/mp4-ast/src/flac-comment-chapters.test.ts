import assert from "node:assert/strict";
import { it } from "node:test";
import { flacChapters } from "./containers/flac-probe.js";

it("orders chapter boundaries by start time and preserves unnamed chapters", () => {
  const tags = { CHAPTER002: "00:00:00.625", CHAPTER001: "00:00:00.125", CHAPTER001NAME: "Intro", TITLE: "Meeting" };
  assert.deepEqual(flacChapters(tags, 1), [
    { id: 1, timescale: 1000, startTimeSeconds: 0.125, endTimeSeconds: 0.625, title: "Intro", tags: { title: "Intro" } },
    { id: 2, timescale: 1000, startTimeSeconds: 0.625, endTimeSeconds: 1, title: "", tags: {} }
  ]);
  assert.deepEqual(tags, { TITLE: "Meeting" });
});
it("keeps malformed chapter-like comments as metadata", () => {
  const tags = { CHAPTERABC: "00:00:01.000", CHAPTER003: "invalid", CHAPTER004: "::", CHAPTER005: "-1:00:00", CHAPTER003NAME: "Unparsed" };
  const original = { ...tags };
  assert.deepEqual(flacChapters(tags, 1), []);
  assert.deepEqual(tags, original);
});
