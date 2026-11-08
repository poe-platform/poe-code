import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

const directory = "tests/stress/adapters/s3-permission-profile";
const label = process.argv[2];
assert.match(label ?? "", /^[a-z0-9-]+$/, "supply a new immutable run label");
const destination = `${directory}/${label}`;
assert.equal(existsSync(destination), false, "never overwrite existing evidence");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const files = (...paths) => git("ls-files", ...paths).split("\n").filter(Boolean);
const baseline = git("rev-parse", "HEAD");
const inputs = [...new Set([
  ...files("src/contracts", "src/fs", "tests/fs/s3", "tests/fs/conformance", "tests/fs/webdav", "tests/stress/s3-policy"),
  ...files("tests/stress/adapters").filter(path => !path.includes("/evidence/")),
  "AGENTS.md", "docs/PROJECT_LEDGER.md", "package.json", "package-lock.json", "tsconfig.json",
  `${directory}/probe.ts`, `${directory}/reproduce.mjs`,
])].sort();
const manifest = () => Object.fromEntries(inputs.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = manifest();
const records = new Map();
const statuses = [];
const record = (name, value) => records.set(`${destination}/${name}`, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
const run = (name, args) => {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  record(`${name}.stdout`, result.stdout ?? "");
  record(`${name}.stderr`, result.stderr ?? "");
  record(`${name}.exit.json`, { executable: process.execPath, args, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null });
  statuses.push(result.status);
  console.log(`${name}: exit ${result.status}`);
};
const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test"];
record("manifest-before.json", before);
record("probe.source.txt", readFileSync(`${directory}/probe.ts`, "utf8"));
record("runner.source.txt", readFileSync(`${directory}/reproduce.mjs`, "utf8"));
record("provenance.json", {
  baseline, started: new Date().toISOString(), node: process.version,
  typescript: JSON.parse(readFileSync("node_modules/typescript/package.json", "utf8")).version,
  tsx: JSON.parse(readFileSync("node_modules/tsx/package.json", "utf8")).version,
  status: git("status", "--short"),
  sourceDelta: git("diff", "HEAD", "--", "src/contracts", "src/fs/s3", "tests/fs/s3", "tests/stress/adapters/core.test.ts"),
  frozenStressTree: git("rev-parse", `${baseline}:tests/stress/adapters/evidence/four-reds-b2d202a`),
  independentPolicyTree: git("rev-parse", `${baseline}:tests/stress/s3-policy`),
  priorCoordination: readFileSync("/tmp/safe-bash-four-reds-next-coordination.txt", "utf8"),
  authority: "No permission ruling found in committed contracts/docs; Curie agent unavailable; explicit root question sent; no source or expectation delta authorized.",
});
run("observations", ["--unhandled-rejections=strict", "--import", "tsx", `${directory}/probe.ts`]);
run("required-row", [...testArgs, "--test-name-pattern=^s3: optional metadata capabilities are exercised or fail closed$", "tests/stress/adapters/core.test.ts"]);
run("s3-backend", [...testArgs, ...files("tests/fs/s3").filter(path => path.endsWith(".test.ts"))]);
run("s3-conformance", [...testArgs, "--test-name-pattern=^s3:|^independent conformance source provenance$|^conformance source state remained stable during suite$", "tests/fs/conformance/shared.test.ts"]);
run("policy-read-only", [...testArgs, ...files("tests/stress/s3-policy").filter(path => path.endsWith(".test.ts"))]);
run("targeted-stress", [...testArgs, "--test-name-pattern=^[Ss]3", "tests/stress/adapters/core.test.ts", "tests/stress/adapters/s3.test.ts", "tests/stress/adapters/s3-rename-profile.test.ts", "tests/stress/adapters/s3-truncate-profile.test.ts"]);
run("scoped-types", ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", ...files("src/fs/s3", "tests/fs/s3").filter(path => path.endsWith(".ts")), `${directory}/probe.ts`, "tests/stress/adapters/core.test.ts"]);
const after = manifest();
record("manifest-after.json", after);
record("stability.json", { baseline, finalHead: git("rev-parse", "HEAD"), changedInputs: inputs.filter(path => before[path] !== after[path]), sourceDelta: git("diff", "HEAD", "--", "src/fs/s3", "tests/fs/s3", "tests/stress/adapters/core.test.ts"), finalStatus: git("status", "--short") });
record("SHA256SUMS", [...records].map(([path, contents]) => `${createHash("sha256").update(contents.endsWith("\n") ? contents : contents + "\n").digest("hex")}  ${relative(destination, path)}`).join("\n") + "\n");
const patch = "*** Begin Patch\n" + [...records].map(([path, contents]) => `*** Add File: ${path}\n${(contents.endsWith("\n") ? contents.slice(0, -1) : contents).split("\n").map(line => "+" + line).join("\n")}\n`).join("") + "*** End Patch\n";
execFileSync("apply_patch", [], { input: patch, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
assert.deepEqual(after, before, "inputs changed; do not claim frozen validation");
process.exitCode = statuses.some(status => status !== 0) ? 1 : 0;
