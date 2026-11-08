import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { cases } from "./expanded-gaps-cases.js";
import type { GapCase } from "./expanded-gaps-cases.js";
export const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
export interface Observation { stdout: string; stderr: string; status: number | null }
export async function virtual(fixture: GapCase, cwd: string, env: Record<string, string>): Promise<Observation> {
  const fs = createMemoryFileSystem(); await fs.mkdir(`${cwd}/child`, { recursive: true });
  for (const [name, text] of Object.entries(fixture.files ?? {})) {
    await fs.mkdir(dirname(`${cwd}/${name}`), { recursive: true });
    await fs.writeFile(`${cwd}/${name}`, Buffer.from(text), { mode: fixture.modes?.[name] ?? 0o755 });
  }
  const shell = new Shell({ fs, cwd, env }).use(agentCommands());
  try {
    const result = await shell.exec(fixture.source, { stdin: fixture.stdin ?? "" });
    return { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode };
  } finally { await shell.dispose(); }
}
async function capture() {
  const root = await realpath(await mkdtemp("/tmp/safe-bash-expanded-gaps-"));
  const profiles = [
    { name: "GNU5.3-primary", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash" },
    { name: "Bash3.2-historical", executable: "/bin/bash" },
  ];
  const cwd = `${root}/work`;
  const environment = { PATH: `${root}/bin`, HOME: cwd, LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8", TZ: "UTC" };
  const run = (executable: string, args: string[], stdin = "") => {
    const options = { cwd, env: environment, argv0: "shell", detached: true, timeout: 3000, maxBuffer: 256 * 1024, input: stdin };
    const child = spawnSync(executable, args, options);
    if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
    assert.equal(child.error, undefined); assert.equal(child.signal, null);
    return { stdout: child.stdout.toString("base64"), stderr: child.stderr.toString("base64"), status: child.status };
  };
  const results = [];
  try {
    await mkdir(`${root}/bin`); await mkdir(cwd);
    await symlink("/bin/cat", `${root}/bin/cat`);
    for (const profile of profiles) {
      for (const name of ["bash", "sh"]) { await rm(`${root}/bin/${name}`, { force: true }); await symlink(profile.executable, `${root}/bin/${name}`); }
      const version = run(profile.executable, ["--version"]);
      const rows = [];
      for (const fixture of cases) {
        await rm(cwd, { recursive: true }); await mkdir(`${cwd}/child`, { recursive: true });
        for (const [name, text] of Object.entries(fixture.files ?? {})) {
          await mkdir(dirname(`${cwd}/${name}`), { recursive: true }); await writeFile(`${cwd}/${name}`, text); await chmod(`${cwd}/${name}`, fixture.modes?.[name] ?? 0o755);
        }
        rows.push({ name: fixture.name, group: fixture.group, actual: run(profile.executable, ["--noprofile", "--norc", "-c", fixture.source, "shell"], fixture.stdin) });
      }
      results.push({ ...profile, sha256: hash(await readFile(profile.executable)), version, childProfiles: "headerless uses parent Bash fallback; env shebang uses actual /usr/bin/env with PATH bash/sh symlinks to this profile", rows });
    }
    console.log(JSON.stringify({ capturedAt: new Date().toISOString(), cwd, environment, scenariosHash: hash(await readFile(new URL("./expanded-gaps-cases.ts", import.meta.url))), envExecutable: { path: "/usr/bin/env", sha256: hash(await readFile("/usr/bin/env")) }, results }, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
}
if (process.argv[2] === "capture") await capture();
