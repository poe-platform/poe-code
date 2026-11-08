import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const base = fileURLToPath(new URL("./", import.meta.url));
const gnu = join(base, ".oracle/gnu-tar/1.35/bin/gtar");
const temporary = mkdtempSync(join(base, ".native-profile-"));
const profile = {};
let invocations = 0;
try {
  mkdirSync(join(temporary, "input"));
  mkdirSync(join(temporary, "input/sub"));
  mkdirSync(join(temporary, "out"));
  writeFileSync(join(temporary, "input/alpha"), Buffer.from([0, 255, 128, 10, 1]));
  writeFileSync(join(temporary, "input/sub/keep.txt"), "keep");
  writeFileSync(join(temporary, "input/sub/drop.tmp"), "drop");
  writeFileSync(join(temporary, "input/line\nname"), "newline");
  symlinkSync("alpha", join(temporary, "input/symbol"));
  linkSync(join(temporary, "input/alpha"), join(temporary, "input/hard"));
  writeFileSync(join(temporary, "names"), "-Cinput\n alpha \n-Csub\nkeep.txt\n");
  for (const [kind, executable] of [["gnu", gnu], ["apple", "/usr/bin/tar"]]) {
    const run = args => {
      invocations++;
      const result = spawnSync(executable, args, { cwd: temporary, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", COPYFILE_DISABLE: "1" }, timeout: 5000 });
      return { args, status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString().replaceAll(temporary, "<TEMP>") };
    };
    const observations = [];
    observations.push(run(["--format=ustar", "-cf", `${kind}.tar`, "-C", "input", "alpha", "sub", "symbol", "hard", "line\nname"]));
    observations.push(run(["-tf", `${kind}.tar`]));
    observations.push(run(["-tf", `${kind}.tar`, "--exclude=*.tmp"]));
    observations.push(run(["-tf", `${kind}.tar`, "--strip-components=1"]));
    observations.push(run(["-cf", `${kind}-names.tar`, "-T", "names"]));
    observations.push(run(["-tf", `${kind}-names.tar`]));
    observations.push(run(["-xf", `${kind}.tar`, "-C", "out", "--strip-components=1", "sub/keep.txt"]));
    profile[kind] = { executable, sha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), version: execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 5000 }).split("\n")[0], observations };
  }
  console.log(JSON.stringify({ date: "2026-08-26", nativeBehaviorInvocations: invocations, identityVersionInvocations: 2, profile }, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
