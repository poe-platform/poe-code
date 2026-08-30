import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isolatedSpawn } from "../process.ts";

const directory = dirname(fileURLToPath(import.meta.url));
const output = join(directory, "evidence.json");
assert.equal(existsSync(output), false, "Use a separately named review rather than overwrite frozen evidence");
const digest = value => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();
const legacyPaths = ["tests/shell/invocation-modes.test.ts", "tests/shell/unsupported-options.test.ts", "tests/shell/script-entrypoint.test.ts"];
const protectedPaths = [...legacyPaths, "tests/shell/helpers.ts", "tests/shell/bash-bugfix-helpers.ts", "tests/shell-stress/process.ts"];
const originals = Object.fromEntries(protectedPaths.map(path => [path, { text: readFileSync(path, "utf8"), sha256: digest(readFileSync(path)), gitBlob: git("hash-object", path) }]));
const validationPath = "/tmp/safe-bash-errexit-validation.json";
const validationBytes = readFileSync(validationPath);
const validation = JSON.parse(validationBytes);
const authorRuns = validation.runs.filter(run => ["invocation", "file-entry"].includes(run.name)).map(run => {
  const path = `${validationPath}.${run.name}.log`;
  const bytes = readFileSync(path);
  return { metadata: run, logPath: path, logSha256: digest(bytes), rawLogBase64: bytes.toString("base64"), failureBlocks: bytes.toString().split(/(?=# Subtest:)/u).filter(block => /^not ok /mu.test(block)), importedShellAndLegacy: Object.fromEntries(Object.entries(validation.manifests[run.actualImports] ?? {}).filter(([path]) => path.includes("src/shell/") || legacyPaths.some(legacy => path.endsWith(legacy)))) };
});
function nodes(path, predicate) {
  const result = [];
  const source = ts.createSourceFile(path, originals[path].text, ts.ScriptTarget.Latest, true);
  function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }
  visit(source);
  return result;
}
const arrays = path => nodes(path, ts.isArrayLiteralExpression);
const strings = array => array.elements.filter(ts.isStringLiteral).map(element => element.text);
const flags = strings(arrays(legacyPaths[0]).find(array => strings(array).includes("-csx")));
const modes = strings(arrays(legacyPaths[0]).find(array => JSON.stringify(strings(array)) === '["bash","sh"]'));
const sources = strings(arrays(legacyPaths[1]).find(array => strings(array).some(value => value.startsWith("set -e;"))));
const referenceCall = nodes(legacyPaths[1], node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "bashResult")[0];
const optionsRow = arrays(legacyPaths[2]).find(array => array.elements[0] && ts.isStringLiteral(array.elements[0]) && array.elements[0].text === "options");
const body = optionsRow.elements[1].text;
const mode = Number(optionsRow.elements[2].text);
assert.deepEqual(flags, ["-e", "-i", "-l", "-x", "--login", "--norc", "--posix", "+s", "-csx"]);
assert.deepEqual(sources, ["set -e; false; say bad >after", "set -o errexit; false; say bad >after", "set -eu || say unsafe >after"]);
assert.equal(body, "#!/bin/bash -e\nsay bad");
const cases = [
  ...modes.map(mode => ({ id: `invocation-${mode}-e`, role: "affected invocation row", mode, args: ["-e"], stdin: "say bad" })),
  ...sources.map((source, index) => ({ id: ["set-e", "set-o-errexit", "set-eu-retained-policy-neighbor"][index], role: index === 2 ? "neighbor: unsupported -u policy NOT authorized for revision" : "affected set row", mode: "bash", args: ["-c", source, "shell"], stdin: "" })),
  { id: "existing-printf-reference", role: "existing native reference uses printf, not the registry say helper", mode: "bash", args: ["-c", referenceCall.arguments[0].text, "shell"], stdin: "" },
  { id: "literal-bin-bash-e-shebang", role: "affected direct path row; exact /bin/bash kernel interpreter is historical3.2 even under GNU parent", mode: "bash", args: ["-c", "./options", "shell"], stdin: "", file: { name: "options", body, mode } },
  { id: "profile-e-file-bridge", role: "supplemental profile interpreter -e proof, NOT literal kernel shebang dispatch", mode: "bash", args: ["-e", "./options"], stdin: "", file: { name: "options", body, mode } },
];
const profiles = [
  { name: "GNU5.3-primary", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash", sha256: "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c" },
  { name: "Bash3.2-historical", executable: "/bin/bash", sha256: "35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3" },
];
const evidence = {
  startedAt: new Date().toISOString(), head: git("rev-parse", "HEAD"), state: "PREPARATION ONLY: no product execution/import, source acceptance or existing test edit", node: process.version,
  authorObservation: { path: validationPath, sha256: digest(validationBytes), head: validation.head, node: validation.node, runs: authorRuns, limitation: "Author-reported dirty-product results; failures short-circuit grouped loops. TAP has assertion status observations, not complete raw command stdout/stderr/effects for unexecuted later rows." },
  preparationNote: "Initial AST extraction failed on an empty array before any native or product execution. Added an empty-array guard to this new capture helper; no legacy assertion changed.",
  originals, groups: { invocation: { modes, flags, totalRows: modes.length * flags.length, affectedRows: 2, retainedUnsupportedRows: 16 }, set: { sources, totalRows: 3, affectedRows: 2, retainedUnsupportedRows: 1 }, shebang: { name: "options", bodyHex: Buffer.from(body).toString("hex"), mode, affectedRows: 1 } },
  native: { profiles, cases, rows: [], stdoutEncoding: "exact hex, no normalization", environmentInherited: false, kernelInterpreter: { path: "/bin/bash", sha256: digest(readFileSync("/bin/bash")) }, helperMapping: "Virtual registry say(args) emits args joined by a space plus newline. Native say is an isolated /bin/bash script implementing printf '%s\\n' \"$*\" for the exact single-argument inputs here. This is a declared harness mapping, not an identical command implementation. No registry args helper is used.", limits: { timeoutMs: 2500, maxBuffer: 65536 }, protectedProtocol: "Do not split literal env 'bash -e', approve env -S, or generalize native flag acceptance to retained unsupported options." },
  sourceDirtyBefore: git("status", "--short", "--", "src/shell"),
};
for (const profile of profiles) {
  assert.equal(digest(readFileSync(profile.executable)), profile.sha256);
  const version = await isolatedSpawn(profile.executable, ["--version"], { cwd: process.cwd(), env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" }, timeout: 2500, maxBuffer: 65536 });
  assert.equal(version.status, 0);
  profile.version = version.stdout.toString();
  for (const fixture of cases) {
    const scratch = realpathSync(mkdtempSync(join(directory, ".native-")));
    try {
      const roles = join(scratch, "roles");
      const work = join(scratch, "work");
      mkdirSync(roles); mkdirSync(work);
      for (const name of ["bash", "sh"]) symlinkSync(profile.executable, join(roles, name));
      const helper = "#!/bin/bash\nprintf '%s\\n' \"$*\"\n";
      writeFileSync(join(roles, "say"), helper); chmodSync(join(roles, "say"), 0o755);
      if (fixture.file) { writeFileSync(join(work, fixture.file.name), Buffer.from(fixture.file.body)); chmodSync(join(work, fixture.file.name), fixture.file.mode); }
      const snapshot = () => Object.fromEntries(readdirSync(work).sort().map(name => [name, { hex: readFileSync(join(work, name)).toString("hex"), mode: lstatSync(join(work, name)).mode & 0o777 }]));
      const before = snapshot();
      const executable = join(roles, fixture.mode);
      const args = ["--noprofile", "--norc", ...fixture.args];
      const environment = { PATH: roles, HOME: work, LC_ALL: "C", LANG: "C", TZ: "UTC" };
      const outcome = await isolatedSpawn(executable, args, { cwd: work, env: environment, input: Buffer.from(fixture.stdin), timeout: 2500, maxBuffer: 65536 });
      const after = snapshot();
      const row = { id: fixture.id, profile: profile.name, role: fixture.role, launcher: executable, resolvedProfile: profile.executable, argv: args, argv0Mode: fixture.mode, environment, cwd: work, stdinHex: Buffer.from(fixture.stdin).toString("hex"), inputSha256: digest(Buffer.from(fixture.stdin)), before, after, status: outcome.status, signal: outcome.signal, error: outcome.error?.message ?? null, stdoutHex: outcome.stdout.toString("hex"), stderrHex: outcome.stderr.toString("hex"), pid: outcome.pid, helperSha256: digest(Buffer.from(helper)), extraLauncherFlags: "--noprofile/--norc prevent startup files; they are harness guards, not a product feature expectation", afterFileAbsent: !Object.hasOwn(after, "after") };
      evidence.native.rows.push(row);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.signal, null);
      assert.deepEqual(after, before);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  assert.equal(digest(readFileSync(profile.executable)), profile.sha256);
}
evidence.finishedAt = new Date().toISOString();
evidence.originalsUnchanged = protectedPaths.every(path => digest(readFileSync(path)) === originals[path].sha256);
assert.equal(evidence.originalsUnchanged, true);
evidence.sourceDirtyAfter = git("status", "--short", "--", "src/shell");
evidence.processAndReadLimits = "Reused existing isolatedSpawn process-group helper; no product module imported. Native generated fixtures confined to this review subtree and deleted in finally. Hidden errexit-holdout/errexit-consumer contents never read. No READY polling or source-author stop.";
const patch = `*** Begin Patch\n*** Add File: ${output}\n${JSON.stringify(evidence, null, 2).split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`;
const result = spawnSync("apply_patch", [patch], { encoding: "utf8", maxBuffer: 1024 * 1024 });
assert.equal(result.status, 0, result.stderr);
console.log(JSON.stringify({ groups: evidence.groups, rows: evidence.native.rows.map(({ id, profile, status, stdoutHex, stderrHex, afterFileAbsent }) => ({ id, profile, status, stdoutHex, stderrHex, afterFileAbsent })), originalsUnchanged: evidence.originalsUnchanged }, null, 2));
