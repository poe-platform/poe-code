import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { bounded, hash, profiles, sourceHashes } from "./invocation-closure-native.js";
import { diagnosticContextCases, quoteDiagnostic } from "./diagnostic-context-cases.js";
import type { DiagnosticContextCase } from "./diagnostic-context-cases.js";

export interface ContextObservation { stdout: string; stderr: string; status: number; files: Record<string, string> }
export interface ContextReference { profiles: { name: string; executable: string; sha256: string; version: string; rows: { name: string; expected: ContextObservation }[] }[] }
export async function virtualContext(fixture: DiagnosticContextCase): Promise<ContextObservation> {
  assert.match(import.meta.resolve("../../src/shell/runtime.js"), /runtime\.ts$/u);
  const fs = new MemoryFileSystem();
  for (const [name, text] of Object.entries(fixture.files ?? {})) await fs.writeFile(`/${name}`, Buffer.from(text));
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()), env: { PATH: "", LC_ALL: "C", LANG: "C", TZ: "UTC" } });
  const result = await shell.exec(fixture.source);
  const files: Record<string, string> = {};
  for (const entry of await fs.readdir("/")) if (entry.type === "file") files[entry.name] = Buffer.from(await fs.readFile(`/${entry.name}`)).toString("base64");
  return { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode, files };
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const before = await sourceHashes();
  if (process.argv[2] === "capture") {
    const reference = { source: before, casesHash: hash(await readFile(new URL("./diagnostic-context-cases.ts", import.meta.url))), locale: "C", osArgv0: "bash", commandName: "shell", cat: { executable: "/bin/cat", sha256: hash(await readFile("/bin/cat")) }, profiles: [] as ContextReference["profiles"] };
    for (const profile of profiles) {
      const version = await bounded(profile.executable, ["--version"], process.cwd(), "bash", "C");
      const rows: ContextReference["profiles"][number]["rows"] = [];
      for (const fixture of diagnosticContextCases) {
        const cwd = await mkdtemp("/tmp/safe-bash-diagnostic-context-");
        try {
          await symlink(profile.executable, `${cwd}/bash`);
          await symlink("/bin/cat", `${cwd}/cat`);
          for (const [name, text] of Object.entries(fixture.files ?? {})) await writeFile(`${cwd}/${name}`, text);
          const result = await bounded(profile.executable, ["--noprofile", "--norc", "-c", `PATH=${quoteDiagnostic(cwd)}; ${fixture.source}`, "shell"], cwd, "bash", "C");
          const files: Record<string, string> = {};
          for (const entry of await readdir(cwd, { withFileTypes: true })) if (entry.isFile()) files[entry.name] = (await readFile(`${cwd}/${entry.name}`)).toString("base64");
          rows.push({ name: fixture.name, expected: { stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), status: result.status, files } });
        } finally { await rm(cwd, { recursive: true, force: true }); }
      }
      reference.profiles.push({ ...profile, version: version.stdout.toString(), sha256: hash(await readFile(profile.executable)), rows });
    }
    console.log(JSON.stringify(reference, null, 2));
  } else {
    const reference = JSON.parse(await readFile(new URL("./diagnostic-context-native.json", import.meta.url), "utf8")) as ContextReference;
    const actual = await Promise.all(diagnosticContextCases.map(async fixture => ({ name: fixture.name, observation: await virtualContext(fixture) })));
    console.log(JSON.stringify({ source: before, actual, comparisons: reference.profiles.map(profile => ({ name: profile.name, total: profile.rows.length, mismatches: profile.rows.filter(row => JSON.stringify(row.expected) !== JSON.stringify(actual.find(entry => entry.name === row.name)!.observation)).map(row => row.name) })) }, null, 2));
  }
  assert.deepEqual(await sourceHashes(), before);
}
