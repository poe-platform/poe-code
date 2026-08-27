import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = process.cwd(), revision = execFileSync("git", ["rev-parse", process.argv[2]], { encoding: "utf8" }).trim();
const directory = await mkdtemp(join(tmpdir(), "safe-core-replay-"));
try {
  const source = join(directory, "source"); await mkdir(source);
  execFileSync("git", ["archive", "-o", join(directory, "source.tar"), revision, "src", "package.json", "tests/commands/helpers.ts"]);
  execFileSync("tar", ["-xf", join(directory, "source.tar"), "-C", source]);
  await symlink(join(repo, "node_modules"), join(source, "node_modules"), "dir");
  await cp(join(repo, "tests/commands/core-expanded"), join(source, "tests/commands/core-expanded"), { recursive: true });
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "tests/commands/core-expanded/regressions.test.ts"], { cwd: source, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const sourceSha256 = {};
  for (const path of ["src/commands/filesystem.ts", "src/commands/streams.ts"]) sourceSha256[path] = createHash("sha256").update(await readFile(join(source, path))).digest("hex");
  const report = { capturedAt: new Date().toISOString(), revision, sourceSha256, exitCode: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message ?? null };
  await writeFile(resolve(process.argv[3]), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ revision, exitCode: result.status, counts: result.stdout.match(/^# (?:tests|pass|fail|skipped|todo).*$/gm) }));
} finally { await rm(directory, { recursive: true, force: true }); }
