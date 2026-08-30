#!/usr/bin/env tsx
import * as nodeFs from "node:fs";
import * as nodeFsPromises from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Volume } from "memfs";

import {
  CASE_ROOT,
  CASE_VOLUME,
  FS_CONFORMANCE_CASES,
  type FsCaseDriver,
  type FsConformanceCase,
  type NodeTruthFixture,
  type RecordedCase,
  type RecordedTruth,
  readRecordedOutcome
} from "../packages/safe-js/src/modules/fs.conformance-cases.js";

// Records what real node:fs/promises answers for every case in the shared conformance table, so
// the suite is grounded in node's truth rather than in memfs's approximation of it. This is a
// script rather than a test because it is the one thing the tests must never do: it creates real
// files. It stages each case in its own directory under os.tmpdir(), drives the case's call
// against real node:fs/promises, and removes everything it made before it exits.
//
// Recording and refreshing:
//
//   npm run record:fs-conformance
//
// Run it on each platform the suite runs on: node's fs errors are the platform's, not node's —
// ENOTEMPTY is errno -66 on darwin and -39 on linux, and darwin's copyfile refuses a directory
// source with ENOTSUP where linux answers EISDIR. The fixture is therefore keyed by
// process.platform and a run only rewrites the entry for the platform it ran on, leaving every
// other platform's recording untouched. fs.conformance.test.ts fails rather than passes when the
// platform it is running on has no recording, and fails when the recording is missing a case the
// table defines — so adding a case to the table forces a re-record.
//
// Never hand-edit the fixture. It is node's answer, and the whole point is that nobody reasoned
// it out.

const FIXTURE_PATH = fileURLToPath(
  new URL("../packages/safe-js/src/modules/fs.node-truth.json", import.meta.url)
);

// A case names every path it touches under CASE_ROOT, which does not exist on the real
// filesystem and must not be created there. Each path is rewritten onto the case's own temporary
// directory on the way in, and rewritten back out of the recorded answer, so the fixture reads in
// the same '/repo/...' spelling the table uses. Concatenated rather than joined because join
// normalises, and one case exists to record that node echoes back the './' it was handed.
export function toTemporaryPath(value: string, caseRoot: string): string {
  const names = value === CASE_ROOT || value.startsWith(`${CASE_ROOT}/`);
  return names ? `${caseRoot}${value}` : value;
}

// Rewrites every string a case hands an operation. A path is the only argument a case spells
// under CASE_ROOT — data, encodings, and modes never are — so the prefix is what identifies one,
// which keeps this free of a per-operation table of which argument is a path.
function rewriteArguments(args: readonly unknown[], caseRoot: string): unknown[] {
  return args.map((arg) => (typeof arg === "string" ? toTemporaryPath(arg, caseRoot) : arg));
}

type AnyFunction = (...args: unknown[]) => unknown;

// Real node:fs/promises with a case's paths rewritten onto its temporary directory. Every
// operation is forwarded by name rather than listed: the table's driver is node's own surface, so
// a case reaching an operation this did not name would be a case reaching something node does not
// have.
function createRealDriver(caseRoot: string): FsCaseDriver {
  return new Proxy({} as FsCaseDriver, {
    get:
      (_target, name: string) =>
      (...args: unknown[]) =>
        (nodeFsPromises as unknown as Record<string, AnyFunction>)[name](
          ...rewriteArguments(args, caseRoot)
        )
  });
}

// The same rewrite over node's sync API, standing in for the memfs Volume a case's setup stages
// into. memfs mirrors node's sync surface, so forwarding by name lets a setup use any of it.
function createRealVolume(caseRoot: string): Volume {
  return new Proxy({} as Volume, {
    get:
      (_target, name: string) =>
      (...args: unknown[]) =>
        (nodeFs as unknown as Record<string, AnyFunction>)[name](
          ...rewriteArguments(args, caseRoot)
        )
  });
}

// Removes the temporary paths from node's answer, which is what makes the fixture a recording of
// the case rather than of the directory it happened to run in. Recursive because an answer can be
// an array of names or the reduced objects a readsAnswer case builds, and a rejection carries its
// paths in message, path, and dest.
export function stripTemporaryPaths(value: unknown, roots: readonly string[]): unknown {
  if (typeof value === "string") {
    return roots.reduce((text, root) => text.split(root).join(""), value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stripTemporaryPaths(entry, roots));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stripTemporaryPaths(entry, roots)])
    );
  }

  return value;
}

async function recordCase(
  testCase: FsConformanceCase,
  caseRoot: string
): Promise<RecordedCase> {
  for (const [path, contents] of Object.entries(CASE_VOLUME)) {
    const target = toTemporaryPath(path, caseRoot);
    nodeFs.mkdirSync(dirname(target), { recursive: true });
    nodeFs.writeFileSync(target, contents);
  }

  testCase.setup?.(createRealVolume(caseRoot));

  const truth = await readRecordedOutcome(testCase.invoke(createRealDriver(caseRoot)));

  return {
    title: testCase.title,
    resolved: "result" in truth,
    node: stripTemporaryPaths(
      truth,
      toCaseRoots(caseRoot, nodeFs.realpathSync(caseRoot))
    ) as RecordedTruth,
    ...(testCase.gap === undefined ? {} : { gap: testCase.gap.reason })
  };
}

// Every prefix one case directory answers to, longest first. On darwin os.tmpdir() sits under a
// symlinked /var, so the directory mkdir was given and the one realpath resolves it to are two
// spellings of it — '/var/folders/x/case-0' and '/private/var/folders/x/case-0' — and node answers
// with whichever the operation reached it by. Both have to be stripped, and the shorter is a
// substring of the longer: stripping it first would cut the middle out of the longer and leave the
// '/private' it starts with behind.
export function toCaseRoots(caseRoot: string, resolved: string): readonly string[] {
  return [...new Set([resolved, caseRoot])].sort((first, second) => second.length - first.length);
}

// A directory a case made unreadable to record what node refuses is still unreadable when the
// run is over, and rm cannot empty what it cannot enter. Restoring the mode is what lets this
// script leave nothing behind. lstat rather than stat so a symlink is never followed — two cases
// stage a cycle, and following one would recurse until the stack gave out.
function unlockDirectories(path: string): void {
  let stats: nodeFs.Stats;

  try {
    stats = nodeFs.lstatSync(path);
  } catch {
    return;
  }

  if (!stats.isDirectory()) {
    return;
  }

  nodeFs.chmodSync(path, 0o700);

  for (const name of nodeFs.readdirSync(path)) {
    unlockDirectories(join(path, name));
  }
}

// Absent is the only failure this forgives, and it forgives it because the first recording on a
// checkout that has none has to start somewhere. Anything else — unreadable, or JSON that does not
// parse — is raised: the merge below is what keeps a platform's recording that only that platform
// can make, so reading a broken fixture as "no fixture" would quietly drop it.
function readFixture(): NodeTruthFixture | undefined {
  let text: string;

  try {
    text = nodeFs.readFileSync(FIXTURE_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  return JSON.parse(text) as NodeTruthFixture;
}

// Merges this platform's recording into whatever is already committed rather than replacing the
// file: a run on darwin must not drop the linux recording that only a linux run can make.
async function writeFixture(cases: readonly RecordedCase[]): Promise<void> {
  const platforms = {
    ...readFixture()?.platforms,
    [process.platform]: { nodeVersion: process.version, cases }
  };

  const ordered = Object.fromEntries(
    Object.entries(platforms).sort(([first], [second]) => first.localeCompare(second))
  );

  await writeFile(FIXTURE_PATH, `${JSON.stringify({ platforms: ordered }, undefined, 2)}\n`);
}

async function record(): Promise<void> {
  // root refuses nothing, so the cases that record what a mode denies would record a success and
  // the fixture would claim node permits what it does not.
  if (process.getuid?.() === 0) {
    throw new Error(
      "Refusing to record as root: the EACCES cases would record a success, since root ignores the mode that denies them."
    );
  }

  const root = await mkdtemp(join(tmpdir(), "fs-conformance-"));

  try {
    const cases: RecordedCase[] = [];

    for (const [index, testCase] of FS_CONFORMANCE_CASES.entries()) {
      cases.push(await recordCase(testCase, join(root, `case-${index}`)));
    }

    await writeFixture(cases);
    console.log(
      `Recorded ${cases.length} cases from node ${process.version} on ${process.platform} into ${FIXTURE_PATH}`
    );
  } finally {
    unlockDirectories(root);
    nodeFs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await record();
}
