import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tableCases, type TableCase } from "./cases.js";

export interface Observation { readonly name: string; readonly caseSha256: string; readonly exitCode: number; readonly stdoutHex: string; readonly stderrHex: string }
export const caseHash = (fixture: TableCase): string => createHash("sha256").update(JSON.stringify(fixture)).digest("hex");

export async function capture(bin: string) {
  const identities: Record<string, { version: string; sha256: string }> = {};
  for (const command of ["paste", "comm", "join"]) {
    const binary = join(bin, command);
    const result = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 5000, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
    assert.equal(result.status, 0, String(result.error));
    const version = result.stdout.split("\n")[0]!;
    assert.equal(version, `${command} (GNU coreutils) 9.7`);
    identities[command] = { version, sha256: createHash("sha256").update(await readFile(binary)).digest("hex") };
  }
  const observations: Observation[] = [];
  const root = await mkdtemp(join(tmpdir(), "safe-table-oracle-"));
  try {
    for (let index = 0; index < tableCases.length; index++) {
      const fixture = tableCases[index]!, cwd = join(root, String(index));
      await mkdir(cwd);
      for (const [path, hex] of Object.entries(fixture.files)) {
        await mkdir(dirname(join(cwd, path)), { recursive: true });
        await writeFile(join(cwd, path), Buffer.from(hex, "hex"));
      }
      const result = spawnSync(join(bin, fixture.command), fixture.args, { cwd, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, input: Buffer.from(fixture.stdinHex, "hex"), timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(result.error, undefined, fixture.name);
      assert.equal(result.signal, null, fixture.name);
      for (const [path, hex] of Object.entries(fixture.files)) assert.equal((await readFile(join(cwd, path))).toString("hex"), hex, `${fixture.name}: native input mutation`);
      observations.push({ name: fixture.name, caseSha256: caseHash(fixture), exitCode: result.status!, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex") });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
  return { target: "GNU coreutils 9.7, LC_ALL=C", identities, observations };
}

if (process.argv[1]?.endsWith("/oracle.ts")) {
  assert.ok(process.env.GNU_TABLE_BIN, "set GNU_TABLE_BIN to pinned coreutils 9.7 src directory");
  console.log(JSON.stringify(await capture(process.env.GNU_TABLE_BIN), null, 2));
}
