import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { platform, release, arch } from "node:os";
import { spawnSync } from "node:child_process";
import { native, nativeRoot, shell, quote } from "../stream-format/helpers.ts";
import { seqFormatCases } from "./seq-format.test.ts";
import { streamCases } from "./native-streams.test.ts";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const paths = (await readdir("src/commands/stream-format")).filter(name => name.endsWith(".ts")).map(name => `src/commands/stream-format/${name}`);
paths.push("src/commands/text-programs/regex.ts", "src/commands/text-programs/shared.ts", "src/commands/stream-inspection/index.ts", "src/plugins/index.ts");
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, sha256(await readFile(path))])));
const references = Object.fromEntries(await Promise.all(["seq", "nl", "rev", "unexpand"].map(async name => {
  const path = name === "rev" ? "/usr/bin/rev" : nativeRoot + name;
  return [name, { path, sha256: sha256(await readFile(path)), identity: name === "rev" ? "Apple BSD-derived rev; no version flag" : spawnSync(path, ["--version"], { encoding: "utf8", env: { LC_ALL: "C" } }).stdout.split("\n")[0] }];
})));
const fixtures = [];
for (const name of ["seq", "nl", "rev", "unexpand"]) {
  const prior = JSON.parse(await readFile(`tests/commands/stream-format/evidence/${name}-initial.json`, "utf8"));
  for (const entry of prior.cases) fixtures.push({ name, cohort: "initial", fixture: {
    args: entry.args, input: Buffer.from(entry.inputHex ?? "", "hex"),
    locale: entry.env ? entry.env.LC_ALL ?? "" : "C",
  } });
}
for (const fixture of seqFormatCases) fixtures.push({ name: "seq", cohort: "format-regression", fixture });
for (const { name, fixture } of streamCases) fixtures.push({ name, cohort: "mixed-stream", fixture });

const results = [];
for (const { name, cohort, fixture } of fixtures) {
  const reference = native(name, fixture);
  const env = fixture.locale === "" ? {} : { LC_ALL: fixture.locale ?? "C" };
  const instance = shell({}, env);
  const actual = await instance.exec([name, ...fixture.args.map(quote)].join(" "), { stdin: fixture.input ?? "" });
  await instance.dispose();
  const selectedSemantic = actual.exitCode === reference.exitCode && Buffer.from(actual.stdoutBytes).equals(reference.stdout) && Boolean(actual.stderr) === Boolean(reference.stderr.length);
  results.push({ name, cohort, args: fixture.args, env, inputHex: Buffer.from(fixture.input ?? "").toString("hex"),
    native: { exitCode: reference.exitCode, stdoutHex: reference.stdout.toString("hex"), stderr: reference.stderr.toString() },
    virtual: { exitCode: actual.exitCode, stdoutHex: Buffer.from(actual.stdoutBytes).toString("hex"), stderr: actual.stderr },
    strict: selectedSemantic && Buffer.from(actual.stderrBytes).equals(reference.stderr), selectedSemantic,
  });
}
const summary = Object.fromEntries(["seq", "nl", "rev", "unexpand"].map(name => {
  const entries = results.filter(entry => entry.name === name);
  return [name, { count: entries.length, strict: entries.filter(entry => entry.strict).length, selectedSemantic: entries.filter(entry => entry.selectedSemantic).length }];
}));
const report = { capturedAt: new Date().toISOString(), platform: { platform: platform(), release: release(), arch: arch(), node: process.version },
  currentHead: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  sourceHashes, references, summary, limits: "Native bytes/status/stderr recorded exactly. Selected semantic = same status/stdout and stderr presence, NOT diagnostic equality. Read-only commands: no VFS writes. Author evidence, not independent proof. Concurrent unrelated dirty source not frozen by this report.", results };
const text = JSON.stringify(report, null, 2);
if (process.argv[2]) {
  const target = process.argv[2];
  if (!/^tests\/commands\/stream-format(?:-author-stress)?\/evidence\/[a-z0-9-]+\.json$/u.test(target)) throw new Error("report path must be an owned evidence JSON path");
  const patch = `*** Begin Patch\n*** Add File: ${target}\n${text.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`;
  const written = spawnSync("apply_patch", { input: patch, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (written.status !== 0) throw new Error(written.stderr);
  console.log(written.stdout);
} else console.log(text);
console.log(JSON.stringify(summary));
if (results.some(entry => !entry.selectedSemantic)) process.exitCode = 1;
