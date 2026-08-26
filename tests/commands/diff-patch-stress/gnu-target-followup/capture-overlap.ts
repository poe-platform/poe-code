import { writeFile } from "node:fs/promises";
import { oracleIdentity } from "../gnu-target/oracle.js";
import { overlapDefaultProbes } from "./fixtures.js";
import { nativeProbe, sha256 } from "./helpers.js";

const records = [];
for (const probe of overlapDefaultProbes) records.push({ probe, inputSha256: sha256(probe.input), native: await nativeProbe(probe) });
await writeFile(new URL("./native-overlap-default-2026-08-26.json", import.meta.url), `${JSON.stringify({ patch: oracleIdentity("patch"), diff: oracleIdentity("diff"), timeoutMs: 3000, shell: false, records }, null, 2)}\n`, { flag: "wx" });
