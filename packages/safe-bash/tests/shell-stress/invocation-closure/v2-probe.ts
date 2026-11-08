import assert from "node:assert/strict";
import { dirname } from "node:path";
import { CommandRegistry } from "../../../src/contracts/index.js";
import type { ByteSource } from "../../../src/contracts/index.js";
import { createStandardCommands } from "../../../src/commands/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { cases } from "./v2-cases.js";
import { fixtureBytes, quote } from "./support.js";

const row = cases.find(candidate => candidate.id === process.argv[2]);
assert.ok(row);
const fs = new MemoryFileSystem();
await fs.mkdir("/work");
const locale = row.locale ?? "C";
const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()), cwd: "/work", env: { PATH: "unused", HOME: "/nonexistent", LC_ALL: locale, LANG: locale, TZ: "UTC" } });
for (const fixture of row.fixtures ?? []) {
  const path = `/work/${fixture.path}`;
  await fs.mkdir(dirname(path), { recursive: true });
  if (fixture.directory) await fs.mkdir(path, { recursive: true });
  else if (fixture.link) await fs.symlink(fixture.link, path);
  else await fs.writeFile(path, fixtureBytes(fixture, "/bin/bash"), { mode: fixture.mode ?? 0o644 });
}
for (const fixture of row.fixtures ?? []) if (fixture.directory && fixture.mode !== undefined) await fs.chmod(`/work/${fixture.path}`, fixture.mode);
const source = row.source.replaceAll("{{bash}}", "bash").replaceAll("{{sh}}", "sh");
const role = row.role ?? "bash";
let args = ["-c", source, role];
let bytes = row.stdinHex === undefined ? Buffer.from(row.stdin ?? "") : Buffer.from(row.stdinHex, "hex");
if (row.entry === "stdin") { args = ["-s"]; bytes = Buffer.from(source); }
else if (row.entry === "file") { args = ["entry.sh"]; await fs.writeFile("/work/entry.sh", Buffer.from(source)); }
const stdin: ByteSource = (async function* () { for (let offset = 0; offset < bytes.length; offset += row.chunkBytes ?? bytes.length) yield bytes.subarray(offset, offset + (row.chunkBytes ?? bytes.length)); })();
try {
  const result = await shell.exec([role, ...args].map(quote).join(" "), { stdin });
  console.log(JSON.stringify({ id: row.id, source, role, args, inputHex: bytes.toString("hex"), exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), stdout: result.stdout, stderr: result.stderr }));
} catch (error) { console.log(JSON.stringify({ id: row.id, error: String(error) })); process.exitCode = 1; }
