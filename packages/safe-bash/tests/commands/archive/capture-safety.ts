import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { archive, binary, directory, member, oracle, oracleHash } from "./helpers.js";

if (createHash("sha256").update(await readFile(oracle)).digest("hex") !== oracleHash) throw new Error("Oracle identity mismatch");
const temporary = await mkdtemp(join(directory, ".native-safety-"));
const observations = [];
try {
  const fixtures = [
    { name: "missing-terminators", bytes: member("file", binary), args: ["-tf", "input.tar"] },
    { name: "trailing-data", bytes: Buffer.concat([archive(member("file")), Buffer.from("trailing")]), args: ["-tf", "input.tar"] },
    { name: "safe-symlink-ancestor", bytes: archive(member("link/file", binary)), args: ["-xf", "input.tar", "-C", "output"] },
    { name: "duplicate-hardlink", bytes: archive(member("file", Buffer.from("old")), member("hard", new Uint8Array(), "1", "file"), member("file", Buffer.from("new"))), args: ["-xf", "input.tar", "-C", "output"] },
    { name: "absolute-member", bytes: archive(member("/absolute", binary)), args: ["-xf", "input.tar", "-C", "output"] },
    { name: "parent-component", bytes: archive(member("a/../safe", binary)), args: ["-xf", "input.tar", "-C", "output"] },
    { name: "excluded-parent", bytes: archive(member("../escape", binary)), args: ["-xf", "input.tar", "-C", "output", "--exclude=*"] },
    { name: "preexisting-hardlink-target", bytes: archive(member("hard", new Uint8Array(), "1", "existing")), args: ["-xf", "input.tar", "-C", "output"] },
  ];
  for (const fixture of fixtures) {
    const cwd = join(temporary, fixture.name); await mkdir(cwd); await mkdir(join(cwd, "output"));
    await writeFile(join(cwd, "input.tar"), fixture.bytes);
    if (fixture.name === "safe-symlink-ancestor") { await mkdir(join(cwd, "output/safe")); await symlink("safe", join(cwd, "output/link")); }
    if (fixture.name === "preexisting-hardlink-target") await writeFile(join(cwd, "output/existing"), "old");
    const result = spawnSync(oracle, fixture.args, { cwd, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 5000 });
    const effects: Record<string, string | number> = { rootEntries: (await readdir(join(cwd, "output"))).join(",") };
    if (fixture.name === "duplicate-hardlink") { effects.hard = (await readFile(join(cwd, "output/hard"))).toString(); effects.file = (await readFile(join(cwd, "output/file"))).toString(); }
    if (fixture.name === "safe-symlink-ancestor") effects.linkType = (await lstat(join(cwd, "output/link"))).isSymbolicLink() ? "symlink" : "directory";
    if (fixture.name === "preexisting-hardlink-target") effects.hard = (await readFile(join(cwd, "output/hard"))).toString();
    observations.push({ name: fixture.name, args: fixture.args, status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString().replaceAll(oracle, "<GNU>"), effects });
  }
  console.log(JSON.stringify({ nativeBehaviorInvocations: observations.length, gnuSha256: oracleHash, observations }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
