import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prepareNative, observeNative } from "./native.mjs";
import { recipes } from "./recipes.mjs";
import { hash } from "./common.mjs";

const output = resolve(process.argv[2]); await mkdir(output, { recursive: true });
const profile = await prepareNative(process.cwd());
const specimen = recipes().find(row => row.id === "command/patch/dry-run");
const check = phase => `if test -e "$TMPDIR"; then printf '${phase}:present\\n'; else printf '${phase}:absent\\n'; fi`;
try {
  const external = join(profile.workspace, "preexisting-scratch"); await mkdir(external);
  const observations = [];
  for (const externalScratch of [false, true]) for (const command of [":", specimen.script]) {
    const script = `${externalScratch ? `export TMPDIR='${external}'; ` : 'export TMPDIR="$PWD/tmp"; '}${check("before")}; ${command}; status=$?; ${check("after")}; exit "$status"`;
    observations.push({ externalScratch, command, script, ...await observeNative(profile, { ...specimen, script }) });
  }
  const [noop, patch, externalNoop, externalPatch] = observations;
  assert.equal(Buffer.from(noop.stdout, "base64").toString(), "before:absent\nafter:absent\n");
  assert.equal(Buffer.from(patch.stdout, "base64").toString(), "before:absent\nafter:present\n");
  assert.deepEqual(patch.entries.tmp, { type: "directory" });
  assert.equal(noop.entries.tmp, undefined);
  assert.equal(Buffer.from(externalPatch.stdout, "base64").toString(), "before:present\nafter:present\n");
  assert.deepEqual(externalNoop.entries, externalPatch.entries);
  assert.deepEqual(await readdir(external), []);
  const alignedDefault = await observeNative(profile, specimen);
  assert.deepEqual(alignedDefault.entries, externalNoop.entries);
  assert.equal(alignedDefault.stdout, ""); assert.equal(alignedDefault.stderr, ""); assert.equal(alignedDefault.exitCode, 0);
  const report = { capturedAt: new Date().toISOString(), recipe: specimen, observations, alignedDefault, tools: { bash: profile.tools.bash, patch: profile.tools.patch },
    harnessHashes: Object.fromEntries(await Promise.all(["scratch-control.mjs", "native.mjs", "common.mjs", "recipes.mjs"].map(async path => [path, hash(await readFile(new URL(path, import.meta.url)))]))),
    finding: "tmp is absent before command and after noop; native patch creates the empty directory because the harness supplied a nonexistent TMPDIR inside the fixture. With a preexisting external owned scratch directory, patch dry-run leaves exactly the same fixture namespace as noop. This is a real native effect of unequal harness scratch configuration, not a preexisting fixture artifact and not a product requirement to fabricate tmp.",
    scope: "Controls only; no original native JSON, recipe or product result overwritten. Scratch profile correction requires a separate documented cohort." };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ controls: observations.length, allExitZero: observations.every(row => row.exitCode === 0), finding: report.finding }, null, 2));
} finally { await profile.close(); }
