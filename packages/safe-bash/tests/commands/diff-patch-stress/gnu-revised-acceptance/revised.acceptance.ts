import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixtures, replacement, type Fixture } from "./fixtures.js";
import { assertUntouched, captureNative, captureProduct, nativeCommand, semantics, type Entry } from "./lab.js";

const evidenceBytes = readFileSync(new URL("./evidence.json", import.meta.url));
assert.equal(createHash("sha256").update(evidenceBytes).digest("hex"), "0c81e7c2f5202a20a193aff9e72f27f54cf83c33a84b6776b6c146e53683f1eb");
const evidence: { observations: readonly { fixture: Fixture; native: Awaited<ReturnType<typeof captureNative>> }[] } = JSON.parse(evidenceBytes.toString());
assert.equal(evidence.observations.length, fixtures.length);

function expectedNamespace(before: readonly Entry[], writes: Readonly<Record<string, string>>) {
  const expected = semantics(before);
  for (const [path, text] of Object.entries(writes)) {
    const entry = { path, type: "file" as const, hex: Buffer.from(text).toString("hex") };
    const index = expected.findIndex(candidate => candidate.path === path);
    if (index < 0) expected.push(entry);
    else expected[index] = entry;
  }
  return expected.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function assertWrites(result: Awaited<ReturnType<typeof captureProduct>>, writes: Readonly<Record<string, string>>, order = Object.keys(writes)) {
  assert.deepEqual(semantics(result.after), expectedNamespace(result.before, writes), "Assert every entry, target byte, backup, reject, and absence");
  assertUntouched(result.before, result.after, Object.keys(writes));
  assert.deepEqual(result.mutations.map(({ method, path }) => ({ method, path })), order.map(path => ({ method: "writeFile", path })));
}

const syntaxReasons: Readonly<Record<string, string>> = {
  "missing-old-body": "truncated or malformed hunk body",
  "missing-new-body": "truncated or malformed hunk body",
  "extra-old-body": "hunk line counts do not match header",
  "extra-new-body": "expected --- file header",
  "zero-count-noop": "invalid zero hunk range",
  "zero-start-nonempty": "invalid zero hunk range",
  "negative-count": "malformed unified hunk header",
  "noninteger-count": "malformed unified hunk header",
  "orphan-newline-marker": "file patch has no hunks",
  "duplicate-newline-marker": "incomplete line would occur before end of file",
  "empty-incomplete-line": "empty incomplete line is not a valid text line",
  "content-after-incomplete-old": "content follows an incomplete final line",
  "content-after-incomplete-new": "content follows an incomplete final line",
  "missing-physical-newline": "patch is truncated: missing final LF",
  "header-only": "file patch has no hunks",
  "context-only-hunk": "hunk has no changes",
};

for (const [label, before, after] of [["first", "keep", "changed"], ["first", "old", "new"], ['"alias/target"', "old", "new"]]) {
  assert(label !== undefined && before !== undefined && after !== undefined);
  test(`pinned GNU diff 3.12 exact section: ${label}/${before}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "safe-bash-diff-revised-generation-"));
    try {
      await mkdir(join(root, "work"));
      await writeFile(join(root, "work/old"), `${before}\n`);
      await writeFile(join(root, "work/new"), `${after}\n`);
      const result = nativeCommand(root, "diff", ["-u", "--label", label, "--label", label, "old", "new"]);
      assert.deepEqual(result, { exitCode: 1, stdout: replacement(label, before, after), stderr: "" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

for (const fixture of fixtures) {
  const captured = evidence.observations.find(row => row.fixture.id === fixture.id);
  assert(captured);
  assert.deepEqual(captured.fixture, fixture);
  const reference = captured.native;
  test(`pinned GNU full-cohort namespace: ${fixture.id}`, async () => {
    const current = await captureNative(fixture);
    assert.deepEqual(current.args, reference.args);
    assert(!current.args.includes("--atomic"));
    assert.equal(current.input, reference.input);
    assert.equal(current.exitCode, reference.exitCode);
    assert.equal(current.stdout, reference.stdout);
    assert.equal(current.stderr, reference.stderr);
    assert.deepEqual(semantics(current.before), semantics(reference.before));
    assert.deepEqual(semantics(current.after), semantics(reference.after));
    const changed = reference.after.filter(entry => JSON.stringify(entry) !== JSON.stringify(reference.before.find(prior => prior.path === entry.path)))
      .map(entry => entry.path);
    assertUntouched(current.before, current.after, changed);
    for (const original of current.before.filter(entry => entry.type === "directory")) {
      const after = current.after.find(entry => entry.path === original.path);
      assert(after);
      assert.deepEqual({ ...after, nlink: original.nlink }, original, "Adding outputs never replaces directory identities");
    }
  });

  for (const atomic of [false, true]) test(`revised ${atomic ? "atomic extension" : "ordinary product"}: ${fixture.id}`, async () => {
    const result = await captureProduct(fixture, atomic);
    if (fixture.policy === "apply") {
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "patching file first\npatching file target\n");
      assert.equal(result.stderr, "");
      assertWrites(result, { "/work/first": "new\n", "/work/target": "new\n" });
      assert.deepEqual(semantics(result.after), semantics(reference.after));
    } else if (fixture.policy === "conflict") {
      assert.equal(result.exitCode, 1, "A complete repeated hunk is an applicability conflict, not malformed syntax");
      if (atomic) {
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "patch: hunk 2 does not match target\n");
        assertWrites(result, {});
      } else {
        assert.equal(result.stdout, reference.stdout);
        assert.equal(result.stderr, reference.stderr);
        const writes = { "/work/first": "changed\n",
          ...(fixture.args.includes("--no-backup-if-mismatch") ? {} : { "/work/target.orig": "old\nmiddle\ntail\n" }),
          "/work/target": "new\nmiddle\ntail\n", "/work/target.rej": replacement("target", "old", "other") };
        assertWrites(result, writes);
        assert.deepEqual(semantics(result.after), semantics(reference.after));
      }
    } else if (fixture.policy === "syntax") {
      const name = fixture.id.split("/")[1]!;
      const reason = atomic && name === "duplicate-newline-marker" ? "expected --- file header" : syntaxReasons[name];
      assert(reason);
      assert.equal(result.exitCode, 2);
      assert(result.stderr.endsWith(`${reason}\n`), result.stderr);
      const writes: Record<string, string> = {};
      if (!atomic && name !== "missing-physical-newline") writes["/work/first"] = "changed\n";
      if (!atomic && name === "extra-new-body") writes["/work/target"] = "new\nmiddle\ntail\n";
      assert.equal(result.stdout, Object.keys(writes).map(path => `patching file ${path.slice(6)}\n`).join(""));
      assertWrites(result, writes);
      if (name === "missing-new-body" || name === "missing-old-body") {
        assert.equal(reference.exitCode, 2);
        assert.match(reference.stderr, /malformed patch/u);
        if (!atomic) assert.deepEqual(semantics(result.after), semantics(reference.after));
      }
    } else if (fixture.family === "selected-output") {
      assert.equal(result.exitCode, atomic ? 1 : 2);
      if (atomic) {
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "patch: hunk 2 does not match target\n");
        assertWrites(result, {});
      } else {
        const suffix = fixture.id.startsWith("selected-backup") ? "orig" : "rej";
        assert.equal(result.stdout, "patching file first\n");
        assert.equal(result.stderr, `patch: commit stopped; 1/2 files committed; failing operation may have side effects; path /work/target: symlink paths are unsupported: /work/target.${suffix}\n`);
        assertWrites(result, { "/work/first": "changed\n" });
      }
    } else {
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      const path = fixture.id.startsWith("quoted-basename") ? "target" : "alias";
      assert.equal(result.stderr, `patch: symlink paths are unsupported: /work/${path}\n`);
      assertWrites(result, {});
    }
  });
}
