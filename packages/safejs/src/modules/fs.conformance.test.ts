import { describe, expect, it } from "vitest";

import {
  driveCase,
  FS_CONFORMANCE_CASES,
  type FsConformanceCase,
  HANGS,
  readRecordedOutcome
} from "./fs.conformance-cases.js";

// The differential half of the fs module's conformance: every case in the shared table runs the
// same call twice over identical, freshly created memfs volumes — once through makeFsModule with
// no root, once against the memfs promises API directly — and the two answers must be the same.
// The reference is what node would have answered if memfs were node, so the rule for reading a
// failure here is:
//
//   ANY behaviour difference from the reference is a bug in the module, EXCEPT the deviations
//   documented in docs/plans/safejs-optional-filesystem.md — Buffer results, Buffer/URL/fd path
//   arguments, bigint stats, Date stat fields, the `signal` option, FileHandle, streams, watch,
//   and `error.stack` — and the EACCES a root raises for a path outside it.
//
// Everything on that exception list either refuses the call or reshapes an answer, so a case
// reaching for one has nothing to compare: a Stats and a Dirent cross the bridge as plain objects
// with *Ms numbers where node hands back a class with Date fields, which is why the two cases that
// want one read their predicates off it rather than returning it. The refusals are asserted for by
// message in fs.test.ts, and root confinement by its denials there, since neither is a difference
// this reference can express. No case here passes a root: with none set the module is node's
// fs/promises untouched, which is the whole of what this measures.
//
// Adding a case: put it in the shared table (fs.conformance-cases.ts) rather than here — the
// recorder in fs-node-truth-fixture reads that table to record real-node outcomes, so a case
// spelled as an assertion in this file would be a case node is never asked about. The table is
// the export the fixture task consumes; this file holds no case of its own. Record the case's
// `node` truth from real node rather than reasoning it out, and never assert readdir order: node
// does not sort, so every readdir case sorts what it was handed.
//
// What this drive cannot see: memfs sets no errno, syscall, or dest on any error, so those three
// fields compare as absent on both sides here. They are asserted against node's recorded numbers
// by the replay drive in fs.test.ts, which is also where a case memfs models differently is held
// to memfs's recorded divergence. This file is the transparency half — the module answers exactly
// what its implementation answered — and fs.test.ts is the parity half.
//
// Fast and in-memory: memfs is the only filesystem either side touches.

// The cases memfs cannot be driven for at all. A symlink cycle recurses inside memfs with the
// event loop blocked, so driving one would hang this suite rather than fail it — and a hang is the
// one failure a differential cannot report. Named rather than filtered silently.
const UNDRIVEN_CASES = FS_CONFORMANCE_CASES.filter((entry) => entry.gap?.memfs === HANGS);

const DRIVEN_CASES = FS_CONFORMANCE_CASES.filter((entry) => entry.gap?.memfs !== HANGS);

describe("fs module conformance against the reference implementation", () => {
  for (const testCase of DRIVEN_CASES) {
    it(`answers exactly what the reference answers: ${testCase.title}`, async () => {
      const { fs, reference } = driveCase(testCase);

      // readRecordedOutcome reads name, message, code, errno, syscall, path, and dest off a
      // rejection and the value off a resolution, so a single comparison covers every field a
      // difference could hide in — including a call that answers where the reference refuses.
      expect(await readRecordedOutcome(testCase.invoke(fs))).toEqual(
        await readRecordedOutcome(testCase.invoke(reference))
      );
    });
  }

  it("reports every case the reference cannot be driven for", () => {
    expect(UNDRIVEN_CASES.map(describeCase)).toEqual([
      "readFile through a symlink loop rejects with ELOOP: memfs recurses through the cycle instead of answering ELOOP",
      "stat through a symlink loop rejects with ELOOP: memfs recurses through the cycle instead of answering ELOOP",
      "realpath through a symlink loop rejects with ELOOP: memfs recurses through the cycle instead of answering ELOOP"
    ]);
  });

  // A title is how a case is named in this suite, in fs.test.ts, and in the fixture the recorder
  // writes, so two cases sharing one would be a fixture entry that answers for either.
  it("names every case in the table exactly once", () => {
    const titles = FS_CONFORMANCE_CASES.map((entry) => entry.title);

    expect([...new Set(titles)]).toEqual(titles);
  });
});

function describeCase(testCase: FsConformanceCase): string {
  return `${testCase.title}: ${testCase.gap?.reason ?? ""}`;
}
