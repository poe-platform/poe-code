import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { tableTextCommands } from "../../../src/commands/table-text/index.js";

export const directory = resolve("tests/commands/table-text-stress");
export const hash = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export interface Fixture { name: string; command: "paste" | "comm" | "join"; args: string[]; files: Record<string, string>; stdinHex: string }
export interface Row { exitCode: number; stdoutHex: string; stderrHex: string; files: Record<string, string> }
export async function product(fixture: Fixture, pipeline = true): Promise<Row> {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, hex] of Object.entries(fixture.files)) await fs.writeFile(`/work/${name}`, Buffer.from(hex, "hex"));
  await fs.writeFile("/work/input", Buffer.from(fixture.stdinHex, "hex"));
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(standardCommands()).use(tableTextCommands());
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    const invocation = [fixture.command, ...fixture.args].map(quote).join(" ");
    const result = await shell.exec(pipeline ? `cat input | ${invocation}` : `${invocation} < input`, { signal: AbortSignal.timeout(5000) });
    const files: Record<string, string> = {};
    for (const name of Object.keys(fixture.files)) files[name] = Buffer.from(await fs.readFile(`/work/${name}`)).toString("hex");
    assert.equal(Buffer.from(await fs.readFile("/work/input")).toString("hex"), fixture.stdinHex);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), [...Object.keys(files), "input"].sort());
    return { exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), files };
  } finally { await shell.dispose(); }
}
