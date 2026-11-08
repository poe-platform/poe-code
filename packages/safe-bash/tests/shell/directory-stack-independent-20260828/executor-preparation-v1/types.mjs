import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { requireAuthority, checkBytes, inside, snapshot, assertSnapshot } from "./integrity.mjs";
import { runBoundedChild } from "./child-process.mjs";
import { authenticateAuthority } from "./executor.mjs";

export const inversions = [
  { id: "TN01", line: 5, code: 2353, token: "directoryStack", from: "{ fs, directoryStack: [] }", to: "{ fs }" },
  { id: "TN02", line: 6, code: 2353, token: "directoryStack", from: "{ directoryStack: [] }", to: "{}" },
  { id: "TN03", line: 7, code: 2353, token: "directoryStack", from: "{ directoryStack: [] }", to: "{}" },
  { id: "TN04", line: 8, code: 2353, token: "directoryStackCwdPublication", from: "{ directoryStackCwdPublication: Symbol() }", to: "{}" },
  { id: "TN05", line: 9, code: 2353, token: "maxDirectoryStackEntries", from: "{ maxDirectoryStackEntries: 4096 }", to: "{}" },
  { id: "TN06", line: 10, code: 2339, token: "directoryStack", from: "result.directoryStack", to: "result.stdoutBytes" },
  { id: "TN07", line: 11, code: 2339, token: "directoryStack", from: "context.directoryStack", to: "context.cwd" },
  { id: "TN08", line: 12, code: 2322, token: "signal", from: '{ signal: "abort" }', to: "{ signal: new AbortController().signal }" }
];
export function invert(source, id) {
  const mutation = inversions.find((entry) => entry.id === id);
  assert(mutation);
  const lines = source.split("\n");
  assert(lines[mutation.line - 1].includes(mutation.id));
  assert(lines[mutation.line - 1].includes(mutation.from));
  lines[mutation.line - 1] = lines[mutation.line - 1].replace(mutation.from, mutation.to);
  return lines.join("\n");
}
export function validateDiagnostics(output, source, removed) {
  const expected = inversions.filter((entry) => entry.id !== removed);
  const diagnostics = [...output.matchAll(/([^\n]+)\((\d+),(\d+)\): error TS(\d+): ([^\n]+)/g)].map((match) => ({ file: match[1], line: Number(match[2]), column: Number(match[3]), code: Number(match[4]), message: match[5] }));
  assert.equal(diagnostics.length, expected.length, "intended diagnostics only; missing imports never pass");
  for (const entry of expected) {
    const diagnostic = diagnostics.find((item) => item.line === entry.line && item.code === entry.code);
    assert(diagnostic, `missing intended ${entry.id} diagnostic`);
    assert.equal(diagnostic.column, source.split("\n")[entry.line - 1].indexOf(entry.token) + 1);
    assert(diagnostic.file.endsWith("negative.mts"));
  }
  assert(!diagnostics.some((entry) => [2307, 2688].includes(entry.code)));
  return diagnostics;
}
export async function compileTypes(authority, layout, config) {
  requireAuthority(authority);
  authenticateAuthority(authority, config.trustedRootCommit);
  const { trustedRootCommit, runId, ...declaredConfig } = config;
  assert.equal(typeof runId, "string");
  assert.deepEqual(authority.typeRuns?.[runId], declaredConfig, "exact ROOT-bound type run/closure configuration required");
  assert(Array.isArray(config.immutableRoots) && config.immutableRoots.length >= 2, "tool/harness/declaration closures must be explicit");
  assert(config.immutableRoots.some((entry) => entry.root === authority.tools.root));
  assert(config.immutableRoots.some((entry) => inside(entry.root, new URL("./types-positive.mts.fixture", import.meta.url).pathname)), "executing fixture tree must be admitted");
  const intact = () => { for (const entry of config.immutableRoots) assertSnapshot(entry.root, entry.inventory); };
  intact();
  assertSnapshot(config.consumerRoot, config.consumerInputInventory);
  checkBytes(config.node, config.nodeIdentity);
  checkBytes(config.tsc, config.tscIdentity);
  assert(inside(config.consumerRoot, config.output), "type fixtures must resolve inside the actual consumer, never an unrelated source fallback");
  mkdirSync(config.output, { recursive: false });
  const positive = readFileSync(new URL("./types-positive.mts.fixture", import.meta.url), "utf8");
  const negative = readFileSync(new URL("./types-negative.mts.fixture", import.meta.url), "utf8");
  const results = [];
  for (const variant of ["positive", "negative", ...inversions.map((entry) => entry.id)]) {
    const directory = resolve(config.output, variant);
    mkdirSync(directory);
    const source = variant === "positive" ? positive : variant === "negative" ? negative : invert(negative, variant);
    const filename = variant === "positive" ? "positive.mts" : "negative.mts";
    writeFileSync(resolve(directory, filename), source, { flag: "wx" });
    const options = { strict: true, exactOptionalPropertyTypes: true, noEmit: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2023", lib: ["ES2023"], types: ["node"], typeRoots: [config.nodeTypesRoot], skipLibCheck: true, ...(layout === "source" ? { paths: { "virtual-bash": [config.publicDeclarations] } } : {}) };
    writeFileSync(resolve(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: [filename] }), { flag: "wx" });
    intact();
    const beforeCompiler = snapshot(config.consumerRoot);
    const result = await runBoundedChild(config.node, [config.tsc, "-p", resolve(directory, "tsconfig.json"), "--pretty", "false"], { cwd: config.consumerRoot, env: config.env });
    assertSnapshot(config.consumerRoot, beforeCompiler);
    intact();
    writeFileSync(resolve(directory, "compiler-result.json"), JSON.stringify(result), { flag: "wx" });
    assert(result.natural && !result.timedOut && !result.overflow, "compiler child did not settle cleanly");
    if (variant === "positive") { assert.equal(result.code, 0, result.stdout + result.stderr); assert.equal(result.stderr, ""); }
    else { assert.equal(result.code, 2, result.stdout + result.stderr); validateDiagnostics(result.stdout, source, variant === "negative" ? undefined : variant); }
    results.push({ variant, ...result });
  }
  intact();
  return results;
}
