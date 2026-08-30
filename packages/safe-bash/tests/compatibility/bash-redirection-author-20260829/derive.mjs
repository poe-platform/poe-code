import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(own, "../../..");
const capture = JSON.parse(fs.readFileSync(path.join(own, "PREPARATION-ROOT.json"))).root;
fs.writeFileSync(path.join(capture, "derive-v2-start.json"), JSON.stringify({ role: "SOURCE_DERIVATION_ONLY", started: new Date().toISOString() }), { flag: "wx" });
try {
  assert.deepEqual(process.argv.slice(2), ["--derive-source"]);
  const filename = path.join(repo, "tests/integration/git-public-20260829/run.mjs");
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && stat.size < 100000);
  let text = fs.readFileSync(filename, "utf8");
  assert.equal(createHash("sha256").update(text).digest("hex"), "8bd1cbd8f1e108b231fc399692b92ada9ea0c6846217a680edb9908cdf4492d4");
  const replace = (before, after) => { assert.equal(text.split(before).length, 2, before); text = text.replace(before, after); };
  replace("import { own, repo, sha, objectHash } from './prepare.mjs';", "import { own, repo, sha, objectHash, hashExecutable } from './prepare.mjs';");
  replace("sha(await fs.readFile(process.execPath))", "await hashExecutable(process.execPath)");
  replace("sha(await fs.readFile(executable))", "await hashExecutable(executable)");
  text = text.replaceAll("git-public-author-", "redirection-author-");
  replace("if (guarded) { loaderReservations++; assert.ok(childCount + workerCount + loaderReservations <= seal.bounds.children); }", "if (guarded) { loaderReservations++; assert.ok(loaderReservations <= 24); assert.ok(childCount + workerCount + loaderReservations <= seal.bounds.children); }");
  replace("String(seal.bounds.children - childCount - workerCount - loaderReservations)", "String(Math.min(8 - workerCount, seal.bounds.children - childCount - workerCount - loaderReservations))");
  replace("workerCount += births.length;", "workerCount += births.length; assert.ok(workerCount <= 8);");
  replace("'stream-consumer.mjs'])", "'stream-consumer.mjs', 'redirections.mjs', 'redirection-cases.json', 'close-observer.mjs'])");
  replace("path.relative(repo, path.join(own, name))", "'tests/integration/git-public-20260829/' + name");
  replace("  for (const [destination, from] of harnessMap)", "  harnessMap.push(['redirections.mjs', path.relative(repo, path.join(own, 'redirections.mjs'))], ['redirection-cases.json', path.relative(repo, path.join(own, 'CASES.json'))], ['close-observer.mjs', path.relative(repo, path.join(own, 'close-observer.mjs'))]);\n  for (const [destination, from] of harnessMap)");
  replace("assert.ok(stat.isFile() && !stat.isSymbolicLink()); const bytes", "assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, length); const bytes");
  replace("await moduleCohort(label + '-m1a', product, 'm1a.mjs', 140); await moduleCohort(label + '-packs', product, 'packs.mjs', 93);", "await cohort(label + '-redirections', product, 'redirections.mjs', 48);");
  replace("await moduleCohort('moved-m1a', movedRoot, 'm1a.mjs', 140); await moduleCohort('moved-packs', movedRoot, 'packs.mjs', 93);", "await cohort('moved-redirections', movedRoot, 'redirections.mjs', 48);");
  const start = text.indexOf("  const fixtureSources ="), end = text.indexOf("  assert.deepEqual(await inventory(path.join(source, 'src')), sourceBefore);");
  assert.ok(start > 0 && end > start);
  text = text.slice(0, start) + `  const mutant = path.join(output, 'operator-mutants'); await write(path.join(mutant, 'package.json'), '{"private":true,"type":"module"}\\n');
  const mutantRoot = path.join(mutant, 'node_modules/virtual-bash');
  for (const row of tarRows) await write(path.join(mutantRoot, row.path), await fs.readFile(path.join(movedRoot, row.path)), row.mode);
  await setupConsumer(mutantRoot, 'mutant');
  const mutations = [
    { id: 'omit-implicit', file: 'shell/parser.js', before: 'operator.value === "|&"', after: 'false', case: 'R01' },
    { id: 'early-implicit', file: 'shell/parser.js', before: 'commands.at(-1).redirects.push(', after: 'commands.at(-1).redirects.unshift(', case: 'R03' },
    { id: 'omit-file-alias', file: 'shell/runtime.js', before: 'redirect.operator === "&>"', after: 'false', case: 'R11' },
  ];
  for (const mutation of mutations) {
    const filename = path.join(mutantRoot, 'dist', mutation.file), original = await fs.readFile(filename, 'utf8');
    assert.equal(original.split(mutation.before).length, 2, mutation.id);
    await fs.writeFile(filename, original.replace(mutation.before, mutation.after));
    const changed = await run(mutation.id, mutantRoot, 'redirections.mjs', { REDIRECTION_CASE: mutation.case });
    const outcomes = changed.out.toString().trim().split('\\n').map(line => JSON.parse(line));
    const detected = changed.code === 1 && outcomes[0]?.id === mutation.case && outcomes[0]?.pass === false && outcomes.at(-1)?.summary?.cases === 1;
    receipt.controls.push({ name: mutation.id, detected, originalSha256: sha(Buffer.from(original)), mutantSha256: sha(await fs.readFile(filename)) });
    if (!detected) receipt.failures.push({ label: mutation.id, outcomes });
    await fs.writeFile(filename, original);
    await cohort(mutation.id + '-restored', mutantRoot, 'redirections.mjs', 1, { REDIRECTION_CASE: mutation.case });
    assert.equal(sha(await fs.readFile(filename)), tarRows.find(row => row.path === 'dist/' + mutation.file).sha256);
  }
  for (const kind of ['missing', 'changed']) {
    const result = await run('binding-' + kind, movedRoot, 'redirections.mjs', {}, binding => {
      if (kind === 'missing') binding.inputs = binding.inputs.filter(row => row.path !== 'index.js');
      else binding.inputs.find(row => row.path === 'shell/parser.js').sha256 = '0'.repeat(64);
    });
    assert.equal(result.code, 1); assert.match(result.err.toString(), /package (binding missing member|hash mismatch)/);
    receipt.controls.push({ name: 'binding-' + kind, pass: true });
  }
  const observedFile = path.join(mutantRoot, 'dist/shell/runtime.js'), clean = await fs.readFile(observedFile, 'utf8');
  const marker = 'if (--file.references === 0'; assert.equal(clean.split(marker).length, 2);
  await fs.writeFile(observedFile, clean.replace(marker, 'globalThis.__redirectReleaseObserver?.(); if (--file.references === 0'));
  await cohort('instrumented-release', mutantRoot, 'close-observer.mjs', 1);
  receipt.controls.push({ name: 'source-bound-private-release-observer', originalSha256: sha(Buffer.from(clean)), instrumentedSha256: sha(await fs.readFile(observedFile)), instrumentedNotNative: true });
  await fs.writeFile(observedFile, clean); assert.deepEqual(await inventory(mutantRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
` + text.slice(end);
  replace("Scoped public Git80 author composition only; no module reacceptance, native/private/network, whole gate, hard preemption or global resource census. Maintained fixture body imports routed to authenticated built package; historical fixed cohorts unchanged.", "Scoped redirection author on fixed public80; 36 literal +12 boundary rows, selected unchanged public regressions, no native/private/network/full gate or hard-preemption proof. Release counter is source-bound compiled instrumentation only. No old failure rescored.");
  const patch = `*** Begin Patch\n*** Add File: ${path.join(own, "run.mjs")}\n${text.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch`;
  const result = spawnSync("apply_patch", [patch], { encoding: "utf8", maxBuffer: 1048576, timeout: 10000 });
  fs.writeFileSync(path.join(capture, "derive-v2-result.json"), JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, sourceHash: createHash("sha256").update(text).digest("hex") }), { flag: "wx" });
  assert.equal(result.status, 0); assert.equal(result.signal, null);
} catch (error) {
  fs.writeFileSync(path.join(capture, "derive-v2-error.json"), JSON.stringify({ error: String(error), stack: error.stack }), { flag: "wx" }); throw error;
}
