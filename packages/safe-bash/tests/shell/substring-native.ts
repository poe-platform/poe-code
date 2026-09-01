import assert from "node:assert/strict";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { quote } from "./invocation-closure-native.js";
import type { SubstringCase } from "./substring-cases.js";

export const substringLocales = ["C", "en_US.UTF-8"] as const;
export interface SubstringObservation { stdout: string; stderr: string; status: number; files: Record<string, string> }
export interface SubstringReference { profiles: { name: string; executable: string; sha256: string; version: string; locales: { locale: string; control: string; rows: { name: string; expected: SubstringObservation }[] }[] }[] }
export async function virtualSubstring(fixture: SubstringCase, locale: string): Promise<SubstringObservation> {
  assert.match(import.meta.resolve("../../src/shell/runtime.js"), /runtime\.ts$/u);
  const fs = new MemoryFileSystem();
  for (const [name, text] of Object.entries(fixture.files ?? {})) await fs.writeFile(`/${name}`, Buffer.from(text));
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()), env: { PATH: "", LC_ALL: locale, LANG: locale, TZ: "UTC" } });
  const result = await shell.exec(`bash -c ${quote(fixture.source)} shell`);
  const files: Record<string, string> = {};
  for (const entry of (await fs.readdir("/")).sort((left, right) => left.name.localeCompare(right.name))) if (entry.type === "file") files[entry.name] = Buffer.from(await fs.readFile(`/${entry.name}`)).toString("base64");
  return { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode, files };
}
