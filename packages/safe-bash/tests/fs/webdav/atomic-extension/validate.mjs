import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const own = dirname(import.meta.filename);
const repo = resolve(own, "../../../..");
const label = process.argv[2];
if (!/^[a-z0-9-]+$/u.test(label ?? "")) throw new Error("unique cohort required");
const output = join(own, "evidence", label);
await mkdir(output);
const workspace = await mkdtemp(join(own, ".validation-"));
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: workspace, TMPDIR: workspace };
const records = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: workspace, env, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  records.push({ command, args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}
try {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const fixturePaths = execFileSync("git", ["ls-files", "tests/fs/webdav"], { cwd: repo, encoding: "utf8" }).trim().split("\n")
    .filter((path) => /^tests\/fs\/webdav\/[^/]+\.(ts|json)$/u.test(path));
  const extra = ["tests/fs/mount/copy-identity-guards.test.ts", "tests/fs/overlay/copy-identity.test.ts", "tests/fs/overlay/helpers.ts", "tests/fs/webdav/real-service/evidence/apache-final/raw.json",
    ...["legacy-lock", "direct-comparison", "timestamp-postcondition", "lock-scope"].map((name) => `tests/fs/webdav/real-service/${name}.test.ts`)];
  const archive = execFileSync("git", ["archive", head, "src", "package.json", "tsconfig.json", "tsconfig.build.json", ...fixturePaths, ...extra], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
  await writeFile(join(workspace, "input.tar"), archive);
  run("tar", ["xf", "input.tar"]);
  const overlays = ["src/fs/webdav/webdav.ts", "src/fs/webdav/index.ts", "src/fs/webdav/README.md", "tests/fs/webdav/atomic-extension/capability.test.ts"];
  await mkdir(join(workspace, "tests/fs/webdav/atomic-extension"), { recursive: true });
  for (const path of overlays) await copyFile(join(repo, path), join(workspace, path));
  const inputs = Object.fromEntries(await Promise.all([...fixturePaths, ...extra, ...overlays].map(async (path) => [path, hash(await readFile(join(workspace, path)))])));
  await writeFile(join(output, "inputs.json"), JSON.stringify({ head, archiveSha256: hash(archive), inputs }, null, 2));
  const tests = (paths) => run(join(repo, "node_modules/.bin/tsx"), ["--test", ...paths]);
  tests(["tests/fs/webdav/atomic-extension/capability.test.ts"]);
  tests(fixturePaths.filter((path) => path.endsWith(".test.ts")));
  for (const path of extra.filter((path) => path.includes("/real-service/") && path.endsWith(".test.ts"))) tests([path]);
  tests(extra.slice(0, 2));
  run(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--skipLibCheck", "--typeRoots", join(repo, "node_modules/@types"), "tests/fs/webdav/atomic-extension/capability.test.ts"]);
  run(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json", "--typeRoots", join(repo, "node_modules/@types")]);
} finally {
  await writeFile(join(output, "commands.json"), JSON.stringify(records, null, 2));
  await rm(workspace, { recursive: true, force: true });
  await writeFile(join(output, "cleanup.json"), JSON.stringify({ workspace, removed: true }));
  console.log(records.map((record) => ({ command: record.args.slice(-2), status: record.status, totals: record.stdout?.match(/# (?:tests|pass|fail) \d+/gu) })));
}
