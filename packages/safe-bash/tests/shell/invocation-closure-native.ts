import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname } from "node:path";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import type { ClosureCase } from "./invocation-closure-cases.js";
export const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const hash = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
export interface Observation { stdout: string; stderr: string; status: number; files: Record<string, string> }

export interface CapturedReference {
  profiles: { observations: { name: string; mode: "bash" | "sh"; cwd: string; observation: Observation }[] }[];
}

export async function sourceHashes(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir("src/shell")).filter(name => name.endsWith(".ts")).sort()) result[name] = hash(await readFile(`src/shell/${name}`));
  return result;
}

export async function virtualObservation(fixture: ClosureCase, mode: "bash" | "sh", cwd = "/work"): Promise<Observation> {
  assert.match(import.meta.resolve("../../src/shell/runtime.js"), /\/runtime\.ts$/u);
  const fs = new MemoryFileSystem();
  await fs.mkdir(cwd, { recursive: true });
  for (const [name, file] of Object.entries(fixture.files ?? {})) {
    await fs.mkdir(dirname(`${cwd}/${name}`), { recursive: true });
    await fs.writeFile(`${cwd}/${name}`, Buffer.from(file.text), { mode: file.mode });
  }
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()) });
  const result = await shell.exec(`${mode} -c ${quote(fixture.source)} probe`, { cwd, env: { PATH: "", LC_ALL: fixture.locale ?? "C", LANG: fixture.locale ?? "C", TZ: "UTC", HOME: cwd }, stdin: fixture.stdin ?? "" });
  const files: Record<string, string> = {};
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(directory)) {
      if (entry.type === "directory") await visit(`${directory}/${entry.name}`, `${prefix}${entry.name}/`);
      else files[`${prefix}${entry.name}`] = Buffer.from(await fs.readFile(`${directory}/${entry.name}`)).toString("base64");
    }
  };
  await visit(cwd, "");
  return { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode, files };
}
