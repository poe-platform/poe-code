import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem } from "../../../src/contracts/index.js";
import { oracleIdentity } from "../diff-patch-stress/gnu-target/oracle.js";
import { nativeGnuBinding } from "../../native-profile.js";
import { contents, native, replacement, run, type Files } from "./helpers.js";

const formats = {
  unified: {
    deletion: "--- a\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
    creation: "--- /dev/null\n+++ a\n@@ -0,0 +1 @@\n+old\n",
  },
  context: {
    deletion: "*** a\n--- /dev/null\n***************\n*** 1 ****\n- old\n--- 0 ----\n",
    creation: "*** /dev/null\n--- a\n***************\n*** 0 ****\n--- 1 ----\n+ old\n",
  },
} as const;
const profiles = [
  { name: "default", args: [] },
  { name: "batch", args: ["--batch"] },
  { name: "force", args: ["-f"] },
  { name: "reverse", args: ["-R"] },
  { name: "reverse force", args: ["-R", "-f"] },
  { name: "force before batch", args: ["-f", "--batch"] },
] as const;
const second = replacement.replace("--- target", "--- a").replace("+++ target", "+++ unused-long-name");
const reverseSecond = "--- unused-long-name\n+++ a\n@@ -1 +1 @@\n-new\n+old\n";

async function namespace(fs: FileSystem) {
  const files: Record<string, string> = {};
  const directories: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    for (const entry of await fs.readdir(`/work/${relative}`)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.type === "directory") { directories.push(path); await visit(path); }
      else {
        assert.equal(entry.type, "file", `unexpected namespace entry ${path}`);
        files[path] = await contents(fs, path);
      }
    }
  };
  assert.equal((await fs.lstat("/work")).type, "directory");
  await visit("");
  return { files, directories: directories.sort(), rootExists: true };
}

interface Fixture {
  readonly format?: keyof typeof formats;
  readonly creation?: boolean;
  readonly args: readonly string[];
  readonly sequential?: boolean;
  readonly existingAuxiliaries?: boolean;
}

async function check(fixture: Fixture) {
  const format = formats[fixture.format ?? "unified"];
  const creation = fixture.creation ?? false;
  const reverse = fixture.args.includes("-R");
  const force = fixture.args.includes("-f");
  const dryRun = fixture.args.includes("--dry-run");
  const declaredCreation = creation !== reverse;
  const deletion = force ? !declaredCreation : declaredCreation;
  const rejectOption = fixture.args.indexOf("-r");
  const rejectName = rejectOption < 0 ? "a.rej" : fixture.args[rejectOption + 1]!;
  const saveReject = !dryRun && rejectName !== "-";
  const files: Files = {
    a: "wrong\n", "unused-long-name": "old\n", "sentinels/untouched": "boundary bytes\n",
    ...(fixture.existingAuxiliaries ? { "a.orig": "stale backup\n", "a.rej": "stale rejects\n" } : {}),
  };
  const input = format[creation ? "creation" : "deletion"] + (fixture.sequential ? second : "");
  const args = ["-p0", ...fixture.args];
  const nativeArgs = args.includes("--batch") ? args : ["--batch", ...args];
  const expected = await native("patch", nativeArgs, files, input);
  const actual = await run("patch", args, { files, input });
  const final = { ...files };
  if (!dryRun && !args.includes("--no-backup-if-mismatch")) final["a.orig"] = "wrong\n";
  if (saveReject) final[rejectName] = format[deletion ? "deletion" : "creation"]
    + (fixture.sequential ? reverse ? reverseSecond : second : "");
  assert.equal(expected.exitCode, 1, expected.stderr);
  assert.equal(actual.exitCode, expected.exitCode, actual.stderr);
  assert.deepEqual(expected.files, final, "independent native reject orientation and exact auxiliary bytes");
  assert.deepEqual(await namespace(actual.fs), {
    files: expected.files, directories: expected.directories, rootExists: expected.rootExists,
  }, "complete namespace, including original target, backup, rejects, unused candidate and sentinel");
  assert.equal(expected.stderr, "");
  assert.equal(actual.stderr, expected.stderr);
  const heading = `${dryRun ? "checking" : "patching"} file a\n`;
  const failure = "Hunk #1 FAILED at 1.\n";
  const summary = `1 out of 1 hunk FAILED${saveReject ? ` -- saving rejects to file ${rejectName}` : ""}\n`;
  const retained = deletion ? "Not deleting file a as content differs from patch\n" : "";
  const tail = fixture.sequential ? heading + failure + summary : "";
  const nativePrefix = declaredCreation
    ? `The next patch${reverse ? ", when reversed," : ""} would create the file a,\nwhich already exists!  ${force ? "Applying it anyway." : reverse ? "Ignoring -R." : "Assuming -R."}\n`
    : "";
  const nativeReversal = !force && !declaredCreation
    ? reverse ? "Unreversed patch detected!  Ignoring -R.\n" : "Reversed (or previously applied) patch detected!  Assuming -R.\n"
    : "";
  assert.equal(expected.stdout, nativePrefix + heading + nativeReversal + failure + retained + summary + tail);
  const virtualReversal = force ? "" : "Reversed (or previously applied) patch detected!  Assuming -R.\n";
  assert.equal(actual.stdout, heading + virtualReversal + failure + summary + retained + tail);
}

test("reject orientation oracle is the pinned GNU patch 2.8 executable", () => {
  const identity = oracleIdentity("patch");
  assert.equal(identity.version.split("\n")[0], "GNU patch 2.8");
  assert.equal(identity.sha256, nativeGnuBinding("patch")?.sha256 ?? "c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00");
});

for (const format of ["unified", "context"] as const) for (const creation of [false, true]) {
  for (const profile of profiles) test(`reject orientation ${format} ${creation ? "creation" : "deletion"}: ${profile.name}`, async () => {
    await check({ format, creation, args: profile.args });
  });
}

for (const profile of profiles) test(`failed deletion retains candidate and appends exact rejects: ${profile.name}`, async () => {
  await check({ args: profile.args, sequential: true });
});

for (const creation of [false, true]) for (const args of [
  ["--no-backup-if-mismatch"], ["-r", "chosen.rej"], ["-r", "-"], ["--dry-run"],
] as const) test(`reject orientation actual-write-only auxiliaries, reverse=${creation}: ${args.join(" ")}`, async () => {
  await check({ creation, args: [...(creation ? ["-R"] : []), ...args], sequential: true, existingAuxiliaries: true });
});

for (const args of [[], ["-R"], ["-f"], ["-R", "-f"], ["--dry-run"]]) {
  test(`reject orientation atomic conflicts leave the full namespace unchanged: ${args.join(" ")}`, async () => {
    const files = { a: "wrong\n", "a.orig": "prior backup\n", "a.rej": "prior rejects\n", "sentinel": "untouched\n" };
    const actual = await run("patch", ["--atomic", "-p0", ...args], { files, input: formats.unified.deletion });
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.stdout, "");
    assert.match(actual.stderr, /hunk 1 does not match a/u);
    assert.deepEqual(await namespace(actual.fs), { files, directories: [], rootExists: true });
  });
}
