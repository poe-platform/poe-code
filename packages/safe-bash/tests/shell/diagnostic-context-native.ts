import assert from "node:assert/strict";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
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
