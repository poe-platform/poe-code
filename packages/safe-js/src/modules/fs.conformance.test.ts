import { describe, expect, it } from "vitest";

import nodeTruth from "./fs.node-truth.json" with { type: "json" };
import {
  driveCase,
  FS_CONFORMANCE_CASES,
  type FsConformanceCase,
  HANGS,
  type NodeTruthFixture,
  readObserved,
  readRecordedOutcome,
  readSystemError,
  toRecordedObserved
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

  // The one claim about another platform's errno that this platform can check: every system
  // error the table declares carries the errno *this* platform gives that code. An errno is the
  // platform's number — ENOTEMPTY is -66 on darwin and -39 on linux — so a typed-out one is a
  // claim only the platform it was typed on keeps, and it would keep it quietly here while
  // failing wherever CI runs. Truth composed through systemErrorTruth passes by construction;
  // a literal typed back in over it is what this catches.
  //
  // node's own ERR_FS_* errors are excluded by name: those are its JavaScript layer's, carry a
  // positive constant rather than an OS errno, and are the same on every platform.
  it("carries the running platform's errno for every system error the table claims", () => {
    const disagreeing = FS_CONFORMANCE_CASES.filter((entry) => {
      const truth = entry.node;

      return (
        !("result" in truth) &&
        truth.name === "Error" &&
        truth.errno !== readSystemError(truth.code).errno
      );
    }).map((entry) => entry.title);

    expect(disagreeing).toEqual([]);
  });
});

// The node-truth half. The differential above proves the module answers exactly what the
// filesystem under it answered; it cannot prove that filesystem is node, because memfs only
// approximates node — it returns the path mkdir was asked for rather than the first directory it
// created, forgives a read-only flag, and blames the fs function where node blames the syscall.
// So every case is driven through the module over memfs once more and held against what real node
// answered, recorded from real node:fs/promises by scripts/record-fs-conformance.ts.
//
// Which platform this is recorded on, and how to refresh it:
//
//   npm run record:fs-conformance
//
// The committed fixture holds **darwin** alone, recorded on node v22.22.2. node's fs errors are
// the platform's — an errno is the platform's number for a code (ENOTEMPTY is -66 on darwin and
// -39 on linux) and which code an operation fails with is the platform's choice too (darwin's
// copyfile refuses a directory source with ENOTSUP where linux answers EISDIR) — so a recording
// describes the platform that made it and no other. The fixture is therefore keyed by
// process.platform, a recording is only ever read for the platform the suite is running on, and
// this suite fails rather than passes when that platform has none: an unrecorded platform is
// reported, never assumed to behave like a recorded one.
//
// A contributor on a platform the fixture does not hold runs the recorder on that platform and
// commits the result. It merges rather than replaces, so recording on linux leaves darwin's entry
// untouched and vice versa; neither can be produced from the other, since only real node on that
// platform knows what it answers. The recorder stages each case in os.tmpdir() and removes it
// again — it is the one thing here allowed near the real disk, which is why it is a script rather
// than a test. It also refuses to run as root, since root ignores the modes the EACCES cases turn
// on. Adding a case to the table forces a re-record: this suite fails when the recording is
// missing a case the table defines.
//
// CI runs `test:unit` on ubuntu-latest, so it reads a linux recording. Until one is committed the
// node-truth half of this suite is what reports that absence — it fails there rather than
// quietly proving nothing.
//
// A case memfs cannot reproduce is a reference gap: the fixture carries the reason, and the case
// is skipped by name so the run reports it. That is the whole of what may be skipped — where the
// module diverges from node and memfs is not to blame, that is a module bug to fix in fs.ts rather
// than a gap to record.
const RECORDED = (nodeTruth as NodeTruthFixture).platforms[process.platform];

const RECORDED_BY_TITLE = new Map((RECORDED?.cases ?? []).map((entry) => [entry.title, entry]));

const REFRESH = "Re-record with `npm run record:fs-conformance`";

describe("fs module conformance against real node's recorded truth", () => {
  it("has a recording for the platform the suite is running on", () => {
    expect(
      RECORDED,
      `No node truth is recorded for ${process.platform}. Run \`npm run record:fs-conformance\` on ${process.platform} and commit the fixture.`
    ).toBeDefined();
  });

  // Sorted title lists rather than a missing-only check so a stale entry fails too: a renamed case
  // leaves a recording nothing asks for, which would otherwise sit in the fixture claiming to
  // prove something.
  it("records every case the table defines and no case it does not", () => {
    expect([...RECORDED_BY_TITLE.keys()].sort(), REFRESH).toEqual(
      FS_CONFORMANCE_CASES.map((entry) => entry.title).sort()
    );
  });

  // The fixture's gap markers are the table's, so a gap cannot be invented in the fixture alone to
  // silence a case the module actually fails.
  it("marks exactly the reference gaps the table declares, with each reason", () => {
    const recorded = (RECORDED?.cases ?? [])
      .filter((entry) => entry.gap !== undefined)
      .map((entry) => `${entry.title}: ${entry.gap}`);

    expect(recorded, REFRESH).toEqual(
      FS_CONFORMANCE_CASES.filter((entry) => entry.gap !== undefined).map(describeCase)
    );
  });

  for (const testCase of FS_CONFORMANCE_CASES) {
    const recorded = RECORDED_BY_TITLE.get(testCase.title);

    // An unrecorded case is reported by the coverage test above rather than silently passing here.
    if (recorded === undefined) {
      continue;
    }

    if (recorded.gap !== undefined) {
      // Skipped by name and reason rather than filtered out of the list: the runner reports every
      // skip, which is what keeps a gap something a reader sees rather than something absent.
      it.skip(`reference gap — ${recorded.gap}: ${testCase.title}`, () => {});
      continue;
    }

    it(`answers exactly what node answered: ${testCase.title}`, async () => {
      const { fs } = driveCase(testCase);

      // Compared over the fields memfs models: it sets no errno, syscall, or dest, so those three
      // are proven against node's recorded numbers by the replay drive in fs.test.ts instead.
      expect(await readObserved(testCase.invoke(fs))).toEqual(toRecordedObserved(recorded));
    });
  }
});

function describeCase(testCase: FsConformanceCase): string {
  return `${testCase.title}: ${testCase.gap?.reason ?? ""}`;
}
