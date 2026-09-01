import assert from "node:assert/strict";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { quote } from "./invocation-closure-native.js";
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
