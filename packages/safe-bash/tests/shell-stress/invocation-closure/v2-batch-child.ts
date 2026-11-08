import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CommandRegistry } from "../../../src/contracts/index.js";
import type { ByteSource } from "../../../src/contracts/index.js";
import { createStandardCommands } from "../../../src/commands/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { cases } from "./v2-cases.js";
import { fixtureBytes, quote } from "./support.js";

export async function differentialBatch(ids: readonly string[]) {
  assert.ok(ids.length > 0 && ids.length <= 8, "Differential batch requires 1..8 rows");
  assert.equal(new Set(ids).size, ids.length, "Duplicate differential batch ID");
  for (const id of ids) assert.ok(cases.some(row => row.id === id), `Unknown differential batch ID: ${id}`);
  const rows = [];
  for (const id of ids) {
    const row = cases.find(candidate => candidate.id === id)!;
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    const locale = row.locale ?? "C";
    const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()), cwd: "/work", env: { PATH: "unused", HOME: "/nonexistent", LC_ALL: locale, LANG: locale, TZ: "UTC" } });
    const outcome = await (async () => {
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
      const result = await shell.exec([role, ...args].map(quote).join(" "), { stdin });
      return { id: row.id, source, role, args, inputHex: bytes.toString("hex"), exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), stdout: result.stdout, stderr: result.stderr };
    })().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    try { await shell.dispose(); }
    catch (error) { if (outcome.ok) throw error; }
    if (!outcome.ok) throw outcome.error;
    rows.push(outcome.value);
  }
  return rows;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    assert.equal(process.argv[2], "--batch");
    console.log(JSON.stringify({ sourceScope: "batch", rows: await differentialBatch(process.argv.slice(3)) }));
  } catch (error) {
    console.log(JSON.stringify({ ids: process.argv.slice(3), error: String(error), stack: error instanceof Error ? error.stack : undefined }));
    process.exitCode = 1;
  }
}
