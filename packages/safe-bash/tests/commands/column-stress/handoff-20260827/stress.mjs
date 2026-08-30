import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { safety } from "./safety.mjs";

const [candidatePath, output, corpusPath = fileURLToPath(new URL("../recipes.json", import.meta.url)), nativePath = fileURLToPath(new URL("../native-observations.json", import.meta.url))] = process.argv.slice(2);
assert(candidatePath && output, "Explicit immutable candidate and unique output required");
const candidate = await realpath(candidatePath);
assert(candidate.startsWith("/private/tmp/safe-bash-column-") || candidate.startsWith("/tmp/safe-bash-column-"));
const corpusBytes = await readFile(corpusPath);
const corpus = JSON.parse(corpusBytes);
const native = JSON.parse(await readFile(nativePath));
const expectedBytes = await readFile(new URL("expectations.json", import.meta.url));
const expected = JSON.parse(expectedBytes);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(corpusBytes), expected.recipeSha256);
const rootEntry = pathToFileURL(join(candidate, "dist/index.js")).href;
const columnEntry = pathToFileURL(join(candidate, "dist/commands/column/index.js")).href;
const api = await import(rootEntry);
const column = await import(columnEntry);
const cases = [];
const unhandled = [];
const onUnhandled = (error) => unhandled.push({ message: String(error), stack: error?.stack ?? null });
process.on("unhandledRejection", onUnhandled);
const hex = (value) => Buffer.from(value).toString("hex");
const errorRecord = (error) => ({ name: error?.name ?? typeof error, message: String(error), code: error?.code ?? null, stack: error?.stack ?? null });
const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));
const gate = () => { let resolveGate, rejectGate; const promise = new Promise((resolveValue, rejectValue) => { resolveGate = resolveValue; rejectGate = rejectValue; }); void promise.catch(() => {}); return { promise, resolve: resolveGate, reject: rejectGate }; };
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Harness deadline: ${label}`)), 2000); })]); }
  finally { clearTimeout(timer); }
}
async function check(recipe, variant, body) {
  const record = { recipe, variant, verdict: "pending", observations: [] };
  cases.push(record);
  try { await body(record); record.verdict = "pass"; }
  catch (error) { record.verdict = "fail"; record.failure = errorRecord(error); }
}
function source(chunks) {
  return { async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield new Uint8Array(chunk); } };
}
async function memory(files = {}) {
  const fs = api.createMemoryFileSystem();
  for (const [name, value] of Object.entries(files)) await fs.writeFile(`/${name}`, Buffer.from(value));
  return fs;
}
async function direct(config = {}) {
  const fs = config.fs ?? await memory(config.files);
  const stdout = [], stderr = [], cleanups = [];
  const signal = config.signal ?? new AbortController().signal;
  const context = {
    command: "column", args: config.argv ?? ["-t"], cwd: "/", env: {}, fs, signal,
    stdin: config.source ?? source(config.chunks ?? [Buffer.from(config.stdinUtf8 ?? "")]),
    stdinIsDefault: config.stdinIsDefault ?? false,
    stdout: config.stdout ?? { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: config.stderr ?? { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); config.onRegister?.(cleanup); },
  };
  if (config.noHook) delete context.registerCleanup;
  const outcome = { status: null, stdoutHex: "", stderrHex: "", rejection: null, registered: cleanups };
  let rejection;
  try { outcome.status = (await column.createColumnCommand({ limits: config.limits }).execute(config.context?.(context) ?? context)).exitCode; }
  catch (error) { rejection = error; outcome.rejection = errorRecord(error); }
  outcome.stdoutHex = hex(Buffer.concat(stdout));
  outcome.stderrHex = hex(Buffer.concat(stderr));
  return { ...outcome, rejectionValue: rejection, fs };
}
async function shell(config = {}) {
  const fs = config.fs ?? await memory(config.files);
  const host = new api.Shell({ fs, cwd: "/", env: config.env ?? {}, limits: { maxOutputBytes: 131072, maxCommands: 64 } });
  host.use(column.columnCommands({ limits: config.limits }));
  config.setup?.(host);
  const stdout = [], stderr = [];
  const quote = (argument) => `'${argument.replaceAll("'", "'\\''")}'`;
  const command = config.command ?? ["column", ...(config.argv ?? ["-t"]).map(quote)].join(" ");
  const record = { status: null, stdoutHex: "", stderrHex: "", rejection: null, effects: {} };
  let rejection;
  try {
    const result = await host.exec(command, {
      stdin: config.source ?? (config.chunks ? source(config.chunks) : Buffer.from(config.stdinUtf8 ?? "")),
      ...(config.signal ? { signal: config.signal } : {}),
      stdout: config.stdout ?? { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
      stderr: config.stderr ?? { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    });
    record.status = result.exitCode;
  } catch (error) { rejection = error; record.rejection = errorRecord(error); }
  finally { await host.dispose(); }
  record.stdoutHex = hex(Buffer.concat(stdout));
  record.stderrHex = hex(Buffer.concat(stderr));
  for (const name of Object.keys(config.files ?? {})) record.effects[name] = hex(await fs.readFile(`/${name}`));
  return { ...record, rejectionValue: rejection, fs };
}
function retain(record, result) {
  const { fs, registered, rejectionValue, ...serializable } = result;
  record.observations.push(serializable);
}
const helpers = { api, column, candidate, corpus, check, cases, direct, shell, memory, source, gate, tick, bounded, retain, hex, errorRecord, assert, unhandled };
try {
  for (const recipe of corpus.nativeRecipes) for (const variant of recipe.variants) {
    await check(recipe.id, variant.name, async (record) => {
      const input = Object.hasOwn(variant, "stdinHex") ? Buffer.from(variant.stdinHex, "hex") : Buffer.from(variant.stdinUtf8);
      const result = await shell({ argv: variant.argv, chunks: [input], files: variant.files });
      retain(record, result);
      const expectation = expected.rows.find((row) => row.key === `${recipe.id}/${variant.name}`);
      assert(expectation);
      record.expected = expectation;
      record.nativeComparisons = native.observations.filter((row) => row.recipe === recipe.id && row.variant === variant.name).map((row) => ({ profile: row.profile, statusEqual: row.status === result.status, stdoutEqual: row.stdoutHex === result.stdoutHex, stderrEqual: row.stderrHex === result.stderrHex, rawNativeStatus: row.status, rawNativeStdoutHex: row.stdoutHex, rawNativeStderrHex: row.stderrHex, originalOracleUse: row.oracleUse }));
      assert.equal(result.rejection, null);
      assert.equal(result.status, expectation.status);
      if (expectation.stdoutHex !== null) assert.equal(result.stdoutHex, expectation.stdoutHex);
      if (expectation.stderrEmpty) assert.equal(result.stderrHex, "");
      if (expectation.stderrNonempty) assert(result.stderrHex.length > 0);
      if (expectation.stderrContains) assert(Buffer.from(result.stderrHex, "hex").toString().includes(expectation.stderrContains));
      if (expectation.help) assert(Buffer.from(result.stdoutHex, "hex").toString().includes("column"));
      for (const [name, contents] of Object.entries(variant.files ?? {})) assert.equal(result.effects[name], hex(Buffer.from(contents)));
    });
  }
  await safety(helpers);
  await tick(); await tick();
} finally { process.removeListener("unhandledRejection", onUnhandled); }
const recipeVerdicts = Object.fromEntries([...corpus.nativeRecipes, ...corpus.safetyRecipes].map((recipe) => {
  const rows = cases.filter((row) => row.recipe === recipe.id);
  return [recipe.id, { executedVariants: rows.length, verdict: !rows.length ? "unexecuted" : rows.some((row) => row.verdict === "fail") ? "fail" : "pass" }];
}));
const result = {
  classification: "independent-frozen-recipe-execution-not-full-gate",
  capturedAt: new Date().toISOString(), candidate, rootEntry, columnEntry,
  rootEntrySha256: hash(await readFile(fileURLToPath(rootEntry))), columnEntrySha256: hash(await readFile(fileURLToPath(columnEntry))),
  recipeSha256: hash(corpusBytes), expectationsSha256: hash(expectedBytes), harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), safetySha256: hash(await readFile(new URL("safety.mjs", import.meta.url))),
  node: process.version, cases, recipeVerdicts, unhandledRejections: unhandled,
  counts: { topLevelRecipes: Object.keys(recipeVerdicts).length, topLevelPass: Object.values(recipeVerdicts).filter((row) => row.verdict === "pass").length, topLevelFail: Object.values(recipeVerdicts).filter((row) => row.verdict === "fail").length, topLevelUnexecuted: Object.values(recipeVerdicts).filter((row) => row.verdict === "unexecuted").length, executedVariants: cases.length, originalRecipeVariants: cases.filter((row) => Object.hasOwn(recipeVerdicts, row.recipe)).length, supplementalVariants: cases.filter((row) => !Object.hasOwn(recipeVerdicts, row.recipe)).length, variantPass: cases.filter((row) => row.verdict === "pass").length, variantFail: cases.filter((row) => row.verdict === "fail").length, denominatorCaveat: "Top-level and variant counts overlap, never add them; native comparisons are a separate profile partition, not extra product passes." },
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output, ...result.counts, failures: cases.filter((row) => row.verdict === "fail").map((row) => ({ recipe: row.recipe, variant: row.variant, failure: row.failure.message })), unhandledRejections: unhandled.length }, null, 2));
if (result.counts.variantFail || result.counts.topLevelUnexecuted || unhandled.length) process.exitCode = 1;
