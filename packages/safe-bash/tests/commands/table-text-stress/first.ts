import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { hash, hashes, native, oracle, product, save, type Fixture } from "./support.js";

const fixture: Fixture = { name: "historical comm shared stdin exact", command: "comm", args: ["-", "-"], files: {}, stdinHex: Buffer.from("a\na\nb\nb\nc\n").toString("hex") };
const identities: Record<string, unknown> = {};
for (const command of ["paste", "comm", "join"]) identities[command] = { version: spawnSync(`${oracle}/src/${command}`, ["--version"], { encoding: "utf8", env: { LC_ALL: "C" } }).stdout.split("\n")[0], sha256: hash(await readFile(`${oracle}/src/${command}`)) };
save("initial-inputs.json", await hashes());
save("first-discrepancy.json", { fixture, identities, archiveSha256: hash(await readFile(`${oracle}.tar.xz`)), manualSha256: hash(await readFile(`${oracle}/doc/coreutils.texi`)), native: await native(fixture), shellPipeline: await product(fixture), shellRedirection: await product(fixture, false) });
