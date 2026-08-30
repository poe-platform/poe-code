import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { bounded, hash, profiles, quote, sourceHashes } from "./invocation-closure-native.js";
import { diagnosticCases, diagnosticFiles } from "./source-dot-eval-diagnostics-cases.js";

export interface DiagnosticRow { name: string; mode: "root" | "bash" | "sh"; cwd: string; source: string; expected: { stdout: string; stderr: string; status: number; files: Record<string, string> } }
export interface DiagnosticReference { profiles: { name: string; executable: string; sha256: string; version: string; rows: DiagnosticRow[] }[] }
export async function virtualDiagnostic(row: DiagnosticRow) {
  assert.match(import.meta.resolve("../../src/shell/runtime.js"), /runtime\.ts$/u);
  const fs = new MemoryFileSystem();
  for (const [name, text] of Object.entries(diagnosticFiles)) {
    await fs.mkdir(dirname(`${row.cwd}/${name}`), { recursive: true });
    await fs.writeFile(`${row.cwd}/${name}`, Buffer.from(text));
  }
  await fs.symlink("directory", `${row.cwd}/dirlink`);
  const source = row.mode === "root" ? row.source : `${row.mode} -c ${quote(row.source)} shell`;
  const result = await new Shell({ fs, cwd: row.cwd, env: { PATH: "", LC_ALL: "C", LANG: "C", HOME: row.cwd, TZ: "UTC" } }).exec(source);
  const files = Object.fromEntries(await Promise.all(Object.keys(diagnosticFiles).map(async name => [name, Buffer.from(await fs.readFile(`${row.cwd}/${name}`)).toString("base64")])));
  return { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode, files };
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const [action, output] = process.argv.slice(2);
  assert.ok(output);
  const before = await sourceHashes();
  if (action === "capture") {
    const report = { source: before, casesHash: hash(await readFile(new URL("./source-dot-eval-diagnostics-cases.ts", import.meta.url))), profiles: [] as DiagnosticReference["profiles"] };
    for (const profile of profiles) {
      const version = await bounded(profile.executable, ["--version"], process.cwd(), "bash", "C");
      const rows: DiagnosticRow[] = [];
      for (const mode of ["root", "bash", "sh"] as const) for (const fixture of diagnosticCases) {
        const cwd = await mkdtemp(resolve("tests/shell/.source-dot-eval-diagnostics-"));
        try {
          await mkdir(`${cwd}/bin`);
          await symlink(profile.executable, `${cwd}/bin/bash`);
          await symlink(profile.executable, `${cwd}/bin/sh`);
          for (const [name, text] of Object.entries(diagnosticFiles)) { await mkdir(dirname(`${cwd}/${name}`), { recursive: true }); await writeFile(`${cwd}/${name}`, text); }
          await symlink("directory", `${cwd}/dirlink`);
          const source = `PATH=${quote(`${cwd}/bin`)}; ${fixture.source}`;
          const result = await bounded(profile.executable, ["--noprofile", "--norc", "-c", source, "shell"], cwd, mode === "sh" ? "sh" : "bash", "C");
          const files = Object.fromEntries(await Promise.all(Object.keys(diagnosticFiles).map(async name => [name, (await readFile(`${cwd}/${name}`)).toString("base64")])));
          rows.push({ name: fixture.name, mode, cwd, source, expected: { stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), status: result.status, files } });
        } finally { await rm(cwd, { recursive: true, force: true }); }
      }
      report.profiles.push({ ...profile, sha256: hash(await readFile(profile.executable)), version: version.stdout.toString(), rows });
    }
    assert.deepEqual(await sourceHashes(), before);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    console.log("Captured48 rows per actual profile; role children use matching profile symlinks");
  } else {
    assert.equal(action, "compare");
    const reference = JSON.parse(await readFile(new URL("./source-dot-eval-diagnostics-native.json", import.meta.url), "utf8")) as DiagnosticReference;
    const results = [];
    for (const profile of reference.profiles) {
      const rows = [];
      for (const row of profile.rows) {
        const actual = await virtualDiagnostic(row);
        let match = true;
        try { assert.deepEqual(actual, row.expected); } catch { match = false; }
        rows.push({ name: row.name, mode: row.mode, expected: row.expected, actual, match });
      }
      results.push({ name: profile.name, passed: rows.filter(row => row.match).length, total: rows.length, rows });
    }
    assert.deepEqual(await sourceHashes(), before);
    await writeFile(output, `${JSON.stringify({ source: before, results }, null, 2)}\n`, { flag: "wx" });
    console.log(results.map(result => `${result.name}:${result.passed}/${result.total}`).join("; "));
    if (results.some(result => result.passed !== result.total)) process.exitCode = 1;
  }
}
