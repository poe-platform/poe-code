import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBoundaries } from "../../../../../scripts/integration-inputs.mjs";
import { isHeldInputPath } from "../../../../../scripts/typecheck-integration-inputs.mjs";

if (process.argv.length !== 2) throw new Error("Capture accepts no paths or options; output is always a new OS-temp directory");
const root = realpathSync(fileURLToPath(new URL("../../../../../", import.meta.url)));
const temporaryRoot = realpathSync(tmpdir());
const contained = (parent, child) => {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith("../"));
};
if (contained(root, temporaryRoot)) {
  throw new Error("Capture temp root must be outside the repository");
}
const fixtureDirectory = "tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl";
const harnessDirectory = "tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const boundaries = validateBoundaries(JSON.parse(readFileSync(join(root, "integration-boundaries.json"), "utf8")));
const snapshot = () => {
  const files = {};
  const visit = path => {
    if (isHeldInputPath(path, boundaries)) return;
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) {
      for (const name of readdirSync(join(root, path)).sort()) visit(`${path}/${name}`);
    } else if (stat.isFile()) files[path] = sha256(readFileSync(join(root, path)));
    else throw new Error(`Refusing non-regular source or fixture: ${path}`);
  };
  for (const path of ["src", "package.json", "package-lock.json", "tsconfig.json", "integration-boundaries.json", "scripts/integration-inputs.mjs", "scripts/typecheck-integration-inputs.mjs", fixtureDirectory, `${harnessDirectory}/capture.mjs`]) visit(path);
  return { files, sha256: sha256(JSON.stringify(files)) };
};
const before = snapshot();
const vectors = JSON.parse(readFileSync(join(root, fixtureDirectory, "expectations.json"), "utf8"));
const directory = mkdtempSync(join(temporaryRoot, "virtual-bash-direct-curl-capture-"));
const write = (name, content) => writeFileSync(join(directory, name), content, { flag: "wx", mode: 0o600 });
const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", `${fixtureDirectory}/direct-curl.test.ts`];
const childEnv = { ...process.env, VIRTUAL_BASH_DIRECT_CURL_CAPTURE: "1" };
delete childEnv.NODE_TEST_CONTEXT;
const child = spawnSync(process.execPath, args, {
  cwd: root,
  env: childEnv,
  encoding: "utf8",
  timeout: 20_000,
  killSignal: "SIGKILL",
  maxBuffer: 4 * 1024 * 1024,
});
write("raw.tap", child.stdout ?? "");
write("stderr.txt", child.stderr ?? "");
const observations = [];
const errors = [];
for (const line of (child.stdout ?? "").split("\n")) {
  const match = /^# VIRTUAL_BASH_DIRECT_CURL_OBSERVATION ([A-Za-z0-9+/=]+)$/.exec(line);
  if (match) {
    try { observations.push(JSON.parse(Buffer.from(match[1], "base64").toString("utf8"))); }
    catch (error) { errors.push(String(error)); }
  }
}
if (JSON.stringify(observations.map(item => item.id)) !== JSON.stringify(vectors.cases.map(item => item.id))) {
  errors.push("Missing, duplicate, or unexpected observations; no acceptance performed");
}
let after;
try { after = snapshot(); }
catch (error) { errors.push(String(error)); }
if (before.sha256 !== after?.sha256) errors.push("Source/fixture integrity changed during capture");
const exitCode = errors.length ? 1 : (child.status ?? 1);
write("observations.json", `${JSON.stringify(observations, null, 2)}\n`);
write("manifest.json", `${JSON.stringify({
  profile: "Explicit new capture, not replay or historical expectation acceptance; injected transport, no external network",
  node: process.version, platform: process.platform, arch: process.arch,
  command: [process.execPath, ...args], before, after,
  expectedVectorsSha256: before.files[`${fixtureDirectory}/expectations.json`],
  observationsSha256: sha256(readFileSync(join(directory, "observations.json"))),
  outcome: { status: child.status, signal: child.signal, error: child.error?.message ?? null },
  errors, exitCode,
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ directory, exitCode })}\n`);
process.exitCode = exitCode;
