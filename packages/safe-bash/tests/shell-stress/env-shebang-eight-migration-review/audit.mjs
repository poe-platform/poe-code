import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, "../../..");
const candidate = process.argv[2];
assert.match(candidate ?? "", /^[a-f0-9]{40}$/u);
const accepted = "ea409a6b49d5c1523e3238f0384048218b559c4c";
const files = ["tests/shell-stress/env-split-author/resume-host.ts", "tests/shell/errexit-host.test.ts", "tests/shell/expanded-gaps-env-host.test.ts"];
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout.toString();
};
const sha = value => createHash("sha256").update(value).digest("hex");
const old = files.map(path => git("show", `${accepted}:${path}`));
const current = files.map(path => git("show", `${candidate}:${path}`));
assert.deepEqual(git("diff-tree", "--no-commit-id", "--name-only", "-r", candidate).trim().split("\n").sort(), [...files].sort());
for (let index = 0; index < files.length; index++) assert.equal(git("show", `${candidate}^:${files[index]}`), old[index]);
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, "whitelisted old text must occur exactly once");
  return source.replace(before, after);
}
const expected = [...old];
expected[0] = replaceOnce(expected[0], String.raw`    assert.equal(result.exitCode, 126); assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsupported interpreter: \/usr\/bin\/env bash -e/u);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["script"]);`, String.raw`    assert.equal(result.exitCode, 127); assert.equal(result.stdout, "");
    assert.equal(result.stderr, "env: bash -e: command not found\n");
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["script"]);
    assert.deepEqual(Buffer.from(await fs.readFile("/work/script")), Buffer.from("#!/usr/bin/env bash -e\nprintf forbidden > marker\n"));`);
const oldErrexitLoop = 'for (const header of ["#!/usr/bin/env bash -e", "#!/usr/bin/env -S bash -e", "#!/bin/bash -e -e", "#!/bin/bash -c", "#!/bin/bash \'-e\'", "#!/unknown -e"])';
expected[1] = replaceOnce(expected[1], oldErrexitLoop, String.raw`for (const [header, expected] of [
  ["#!/usr/bin/env bash -e", [127, "", "env: bash -e: command not found\n"]],
  ["#!/usr/bin/env -S bash -e", [0, "BAD", ""]],
] as const) test(` + '`env shebang literal optional argument ${header}`' + String.raw`, async () => {
  const { shell, fs } = setup(); await fs.writeFile("/script", Buffer.from(` + '`${header}\\nprintf BAD\\n`'.replaceAll('\\\\', '\\') + String.raw`), { mode: 0o755 });
  try {
    const result = await shell.exec("/script"); assert.deepEqual([result.exitCode, result.stdout, result.stderr], expected);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["script"]);
    assert.deepEqual(Buffer.from(await fs.readFile("/script")), Buffer.from(` + '`${header}\\nprintf BAD\\n`'.replaceAll('\\\\', '\\') + String.raw`));
  } finally { await shell.dispose(); }
});

for (const header of ["#!/bin/bash -e -e", "#!/bin/bash -c", "#!/bin/bash '-e'", "#!/unknown -e"])`);
expected[2] = replaceOnce(expected[2], 'import { Shell, agentCommands, createMemoryFileSystem }', 'import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem }');
expected[2] = replaceOnce(expected[2], String.raw`for (const header of ["/usr/bin/env bash -e", "/usr/bin/env -S bash -e", "/usr/bin/env python", "/usr/bin/env", "/usr/bin/env bash\r"]) test(` + '`explicit unsupported env interpreter ${JSON.stringify(header)}`', String.raw`for (const [header, expected] of [
  ["/usr/bin/env bash -e", [127, "", "env: bash -e: command not found\n"]],
  ["/usr/bin/env -S bash -e", [0, "forbidden", ""]],
  ["/usr/bin/env python", [127, "", "env: python: command not found\n"]],
  ["/usr/bin/env", null],
  ["/usr/bin/env bash\r", [127, "", "env: bash\r: command not found\n"]],
] as const) test(` + '`explicit env interpreter outcome ${JSON.stringify(header)}`');
expected[2] = replaceOnce(expected[2], '  try { const result = await shell.exec("/script"); assert.equal(result.exitCode, 126); assert.equal(result.stdout, ""); assert.match(result.stderr, /unsupported interpreter/u); }', String.raw`  try {
    if (expected === null) await assert.rejects(shell.exec("/script"), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
    else { const result = await shell.exec("/script"); assert.deepEqual([result.exitCode, result.stdout, result.stderr], expected); }
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["script"]);
    assert.deepEqual(Buffer.from(await fs.readFile("/script")), Buffer.from(` + '`#!${header}\\nprintf forbidden`'.replaceAll('\\\\', '\\') + String.raw`));
  }`);
for (let index = 0; index < files.length; index++) assert.equal(current[index], expected[index], `non-whitelisted candidate delta: ${files[index]}`);
const mutations = [
  ["hidden-failing-command", 1, String.raw`\nprintf BAD\n`, String.raw`\nprintf BAD; false\n`],
  ["changed-no-final-LF-body", 2, String.raw`\nprintf forbidden`, String.raw`\nprintf forbidden\n`],
  ["changed-argv", 0, 'shell.exec("./script")', 'shell.exec("./script changed")'],
  ["changed-cwd", 0, 'cwd: "/work"', 'cwd: "/other"'],
  ["changed-env", 0, 'PUBLIC: "parent value"', 'PUBLIC: "different"'],
  ["changed-registration", 0, 'name: "report"', 'name: "python"'],
  ["blanket-unsupported-127", 1, 'assert.equal(result.exitCode, 126)', 'assert.equal(result.exitCode, 127)'],
  ["changed-CR-header", 2, String.raw`env bash\r`, 'env bash'],
];
for (const [id, index, before, after] of mutations) {
  assert.ok(current[index].includes(before), id);
  assert.throws(() => assert.equal(current[index].replace(before, after), expected[index]), assert.AssertionError, id);
}
const review = "tests/shell-stress/env-shebang-integration-review";
const history = git("ls-tree", "-r", "--name-only", candidate, "--", review, "tests/shell-stress/env-shebang-author/guarded-completion", "tests/shell-stress/env-shebang-author/guarded-expectation-correction").trim().split("\n");
const historyHashes = {};
for (const path of history) {
  const bytes = readFileSync(join(root, path));
  assert.equal(sha(bytes), sha(Buffer.from(git("show", `${candidate}:${path}`))), path);
  historyHashes[path] = sha(bytes);
}
const originalObservations = `${review}/guarded-ea409a6b-20260827-review1-controls/original-assertion-observations.json`;
assert.equal(historyHashes[originalObservations], "85ba9003214cb5c6f546dbea7997b24511c0c0c5edd3eae1f41cc55ae7c3af0a");
const result = { candidate, accepted, auditedAt: new Date().toISOString(), exactChangedPaths: files, expectationRows: 8, fullFileWhitelistMatches: true, originalsEqualCandidateParent: true, fixtureHashes: files.map((path, index) => ({ path, original: sha(old[index]), candidate: sha(current[index]), whitelistedExpected: sha(expected[index]) })), negativeInputMutations: mutations.map(([id]) => ({ id, rejected: true })), historicalHashes: historyHashes, historyScope: "All candidate-tracked paths in the three listed historical evidence roots; hashes cover existing file bytes, not untracked append detection or metadata.", originalInputs: JSON.parse(readFileSync(join(root, originalObservations))).originals.map(({ id, source, cwd, command, file }) => ({ id, source, cwd, command, file })) };
const destination = process.argv[3];
if (destination) writeFileSync(resolve(owned, destination), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ candidate, exactChangedPaths: files.length, expectationRows: 8, negativeInputMutations: mutations.length, authenticatedHistoricalFiles: history.length }));
