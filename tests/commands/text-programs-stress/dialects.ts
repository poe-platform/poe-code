import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { cases } from "./cases.js";
import { native } from "./native.js";
import { compare, type Execution } from "./model.js";
import { VirtualSession } from "./session.js";

const executable = process.env.GNU_SED_ORACLE;
const focused = cases.filter(fixture => ["sed-regex-67", "sed-regex-70", "sed-inplace-quit-per-file"].includes(fixture.name));
const results = [];
let version: string | undefined;
if (executable) {
  const result = await promisify(execFile)(executable, ["--version"], { timeout: 3000, maxBuffer: 65536 });
  version = result.stdout.split("\n")[0];
  if (!version?.includes("(GNU sed) 4.9")) throw new Error("This diagnostic requires pinned GNU sed 4.9");
}
const session = new VirtualSession();
try {
  for (const fixture of focused) {
    const bsd = await native(fixture);
    const gnu: Execution = executable ? await native(fixture, executable) : { status: "pending", reason: "Set GNU_SED_ORACLE to a separately built GNU sed 4.9 executable", durationMs: 0 };
    const virtual = await session.run({ fixture });
    results.push({ fixture, bsd: compare(fixture, bsd, virtual), gnu: compare(fixture, gnu, virtual) });
  }
} finally { await session.dispose(); }
const hashes: Record<string, string> = {};
for (const path of ["/usr/bin/sed", ...(executable ? [executable] : []), "src/commands/text-programs/regex.ts", "src/commands/text-programs/sed.ts"])
  hashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
const report = {
  purpose: "Targeted native dialect investigation, not a compatibility score or permission to change oracle expectations",
  createdAt: new Date().toISOString(), node: process.version, platform: process.platform,
  gnuSed: { version, executable, sourceArchive: "https://ftp.gnu.org/gnu/sed/sed-4.9.tar.xz", sourceArchiveSha256: "6e226b732e1cd739464ad6862bd1a1aba42d7982922da7a53519631d24975181" },
  hashes, backgroundErrors: session.backgroundErrors, results,
};
await writeFile(new URL("./native-dialect-current.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(results.map(result => ({ name: result.fixture.name, bsd: result.bsd.status, gnu: result.gnu.status }))));
if (results.some(result => result.bsd.status !== "pass" || result.gnu.status !== "pass") || session.backgroundErrors.length) process.exitCode = 1;
