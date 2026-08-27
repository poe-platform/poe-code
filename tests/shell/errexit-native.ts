import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { bounded, hash, profiles, quote, sourceHashes } from "./invocation-closure-native.js";
import { errexitCases } from "./errexit-cases.js";
import type { ErrexitCase } from "./errexit-cases.js";

export interface ErrexitObservation { stdout: string; stderr: string; status: number; marker: string | null }
export interface ErrexitReference { profiles: { name: string; executable: string; sha256: string; version: string; rows: { name: string; mode: "bash" | "sh"; observation: ErrexitObservation }[] }[] }
export async function virtualErrexit(fixture: ErrexitCase, mode: "bash" | "sh"): Promise<ErrexitObservation> {
  assert.match(import.meta.resolve("../../src/shell/runtime.js"), /runtime\.ts$/u);
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, file] of Object.entries(fixture.files ?? {})) await fs.writeFile(`/work/${name}`, Buffer.from(file.text), { mode: file.mode ?? 0o644 });
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()), cwd: "/work", env: { PATH: "", LC_ALL: "C", LANG: "C", TZ: "UTC" } });
  const args = fixture.args ?? ["-c", fixture.source!, "shell"];
  const result = await shell.exec([mode, ...args].map(quote).join(" "), { stdin: fixture.stdin ?? "" });
  const entries = await fs.readdir("/work");
  return { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode, marker: entries.some(entry => entry.name === "marker") ? Buffer.from(await fs.readFile("/work/marker")).toString("base64") : null };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const before = await sourceHashes();
  if (process.argv[2] === "capture" || process.argv[2] === "capture-extra") {
    const cases: readonly ErrexitCase[] = process.argv[2] === "capture-extra" ? (JSON.parse(await readFile(new URL("./errexit-extra-native.json", import.meta.url), "utf8")) as { fixtures: ErrexitCase[] }).fixtures : errexitCases;
    const reference = { source: before, casesHash: hash(await readFile(new URL("./errexit-cases.ts", import.meta.url))), locale: "C", profiles: [] as ErrexitReference["profiles"] };
    for (const profile of profiles) {
      const version = await bounded(profile.executable, ["--version"], process.cwd(), "bash", "C");
      const rows: ErrexitReference["profiles"][number]["rows"] = [];
      for (const mode of ["bash", "sh"] as const) for (const fixture of cases) {
        const cwd = await mkdtemp("/tmp/safe-bash-errexit-");
        try {
          for (const name of ["bash", "sh"]) await symlink(profile.executable, `${cwd}/${name}`);
          await symlink("/bin/cat", `${cwd}/cat`);
          for (const [name, file] of Object.entries(fixture.files ?? {})) await writeFile(`${cwd}/${name}`, file.text, { mode: file.mode ?? 0o644 });
          const args = fixture.args ?? ["-c", fixture.source!, "shell"];
          const result = await bounded(profile.executable, ["--noprofile", "--norc", ...args], cwd, mode, "C", fixture.stdin ?? "");
          const marker = (await readdir(cwd)).includes("marker") ? (await readFile(`${cwd}/marker`)).toString("base64") : null;
          rows.push({ name: fixture.name, mode, observation: { stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), status: result.status, marker } });
        } finally { await rm(cwd, { recursive: true, force: true }); }
      }
      reference.profiles.push({ ...profile, sha256: hash(await readFile(profile.executable)), version: version.stdout.toString(), rows });
    }
    console.log(JSON.stringify(reference, null, 2));
  } else {
    const reference = JSON.parse(await readFile(new URL("./errexit-native.json", import.meta.url), "utf8")) as ErrexitReference;
    const rows: ErrexitReference["profiles"][number]["rows"] = [];
    for (const mode of ["bash", "sh"] as const) for (const fixture of errexitCases) rows.push({ name: fixture.name, mode, observation: await virtualErrexit(fixture, mode) });
    const comparisons = reference.profiles.map(profile => ({ profile: profile.name, total: rows.length, failures: rows.filter(row => JSON.stringify(row.observation) !== JSON.stringify(profile.rows.find(expected => expected.mode === row.mode && expected.name === row.name)!.observation)).map(row => `${row.mode}/${row.name}`) }));
    console.log(JSON.stringify({ source: before, importedRuntime: import.meta.resolve("../../src/shell/runtime.js"), rows, comparisons }, null, 2));
  }
  assert.deepEqual(await sourceHashes(), before);
}
