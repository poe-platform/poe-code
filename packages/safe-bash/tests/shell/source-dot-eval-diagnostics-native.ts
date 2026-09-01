import assert from "node:assert/strict";
import { dirname } from "node:path";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { quote } from "./invocation-closure-native.js";
import { diagnosticFiles } from "./source-dot-eval-diagnostics-cases.js";

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
