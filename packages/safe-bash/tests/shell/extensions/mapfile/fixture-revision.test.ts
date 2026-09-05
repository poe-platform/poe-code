import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyMapfileFixtureRevision } from "./fixture-revision.js";

const referenceSHA256 = "8b36b77a1a9e1d922dc7c69976c33da779a275251341bc5c8a96a532f48b3e6f";
const fixture = { file: "review.test.ts", sha256: "c7945003e742e9062875ae64e8c3dfba73616bae71e0f7323419f30c4eb9e0e3" };
const current = readFileSync(new URL("./review.test.ts", import.meta.url));
const receipt = readFileSync(new URL("./fixture-revision.json", import.meta.url));

test("the exact observer mock insertion reconstructs the sealed native fixture", () => {
  verifyMapfileFixtureRevision(fixture, current, referenceSHA256, receipt);
});

test("altered observer insertion is not an authorized fixture revision", () => {
  const altered = Buffer.from(current);
  altered[6890] = 120;
  assert.throws(() => verifyMapfileFixtureRevision(fixture, altered, referenceSHA256, receipt));
});

for (const offset of [0, current.length - 2]) test(`fixture bytes outside the insertion remain sealed: ${offset}`, () => {
  const altered = Buffer.from(current);
  altered[offset] = altered[offset]! ^ 1;
  assert.throws(() => verifyMapfileFixtureRevision(fixture, altered, referenceSHA256, receipt));
});

test("moving the insertion does not authorize the same method elsewhere", () => {
  const altered = Buffer.concat([current.subarray(0, 6883), current.subarray(6884, 6972), current.subarray(6883, 6884), current.subarray(6972)]);
  assert.throws(() => verifyMapfileFixtureRevision(fixture, altered, referenceSHA256, receipt));
});

test("wrong insertion offsets in a receipt fail authentication", () => {
  const altered = Buffer.from(receipt.toString().replace('"offset": 6884', '"offset": 6883'));
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, altered));
});

test("the revision cannot authorize another sealed fixture", () => {
  assert.throws(() => verifyMapfileFixtureRevision({ ...fixture, file: "native.test.ts" }, current, referenceSHA256, receipt));
});

test("the original native fixture and reference bindings cannot change", () => {
  assert.throws(() => verifyMapfileFixtureRevision({ ...fixture, sha256: "0".repeat(64) }, current, referenceSHA256, receipt));
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, "0".repeat(64), receipt));
});

test("receipt tampering is rejected before parsing", () => {
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, Buffer.from("{")));
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, Buffer.concat([receipt, Buffer.from(" ")])));
});

test("the receipt and candidate fixture retain their admission size limits", () => {
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, Buffer.alloc(4097)));
  assert.throws(() => verifyMapfileFixtureRevision(fixture, Buffer.alloc(65537), referenceSHA256, receipt));
});
