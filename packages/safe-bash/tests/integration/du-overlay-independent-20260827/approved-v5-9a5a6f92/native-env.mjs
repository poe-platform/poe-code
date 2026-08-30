import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const oracle = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
const scratch = resolve(process.argv[4] ?? "");
if (!process.argv[2] || !process.argv[3] || !process.argv[4]) {
  throw new Error("usage: node native-env.mjs NATIVE_GNU_DU OUTPUT_JSON OWNED_SCRATCH");
}
const identity = JSON.parse(await readFile(join(here, "config", "oracle-identity.json"), "utf8"));
const table = JSON.parse(await readFile(join(here, "fixtures", "native-env-cases.json"), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function run(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.on("error", rejectPromise);
    child.on("close", (status, signal) => resolvePromise({ status, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

const actualRealpath = await realpath(oracle);
const actualBytes = await readFile(actualRealpath);
if (actualRealpath !== identity.realpath || sha256(actualBytes) !== identity.sha256) throw new Error("native oracle identity mismatch");
const version = await run(actualRealpath, ["--version"], { LC_ALL: "C", LANG: "C", PATH: "/usr/bin:/bin" });
if (version.status !== 0 || version.stdout.toString().split("\n")[0] !== identity.versionFirstLine) throw new Error("native oracle version mismatch");

await mkdir(scratch, { recursive: true });
const fixturePath = join(scratch, table.fixture.name);
const payload = Buffer.alloc(table.fixture.length, table.fixture.fillByte);
if (sha256(payload) !== table.fixture.sha256) throw new Error("locked payload reconstruction mismatch");
await writeFile(fixturePath, payload, { flag: "wx" });
const records = [];
for (const testCase of table.cases) {
  const env = { PATH: "/usr/bin:/bin", ...table.sanitizedEnvironment, ...testCase.env };
  for (const key of table.removedAmbientKeys) if (!Object.hasOwn(testCase.env, key)) delete env[key];
  const result = await run(actualRealpath, [...testCase.args, "--", fixturePath], env);
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  const expectedStdout = testCase.expect.statusClass === "success" ? `${testCase.expect.units}\t${fixturePath}\n` : testCase.expect.stdout;
  const classification = testCase.expect.statusClass === "success"
    ? result.status === 0 && stdout === expectedStdout && stderr === "" ? "literal-match" : "literal-mismatch"
    : result.status !== 0 && stdout === expectedStdout && /invalid.*block|block.*invalid/iu.test(stderr)
      ? "expected-strict-rejection" : "strict-rejection-mismatch";
  records.push({
    id: testCase.id,
    selected: testCase.selected,
    args: [...testCase.args, "--", fixturePath],
    env,
    expected: testCase.expect,
    expectedStdout,
    observed: { status: result.status, signal: result.signal, stdout, stderr, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr) },
    classification,
  });
}
const document = {
  schema: 1,
  scope: "GNU-9.7-single-file-apparent-size-environment-precedence-only",
  oracle: { realpath: actualRealpath, sha256: sha256(actualBytes), versionStdout: version.stdout.toString(), versionStderr: version.stderr.toString() },
  environmentPolicy: { sanitized: table.sanitizedEnvironment, removedAmbientKeys: table.removedAmbientKeys },
  fixture: { ...table.fixture, path: fixturePath },
  records,
  summary: {
    total: records.length,
    matched: records.filter(record => record.classification === "literal-match" || record.classification === "expected-strict-rejection").length,
    mismatched: records.filter(record => record.classification.endsWith("mismatch")).length,
  },
  broadNativeParityClaimed: false,
};
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx" });
if (document.summary.mismatched) process.exitCode = 1;
