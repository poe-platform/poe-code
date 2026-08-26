import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { oracleIdentity } from "../gnu-target/oracle.js";
import { capture, fixtures } from "./evidence.js";

async function sourceHashes() {
  const paths = (await readdir("src/commands/diff-patch")).filter(path => path.endsWith(".ts")).sort();
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(`src/commands/diff-patch/${path}`)).digest("hex")])));
}

const startedAt = new Date().toISOString();
const before = await sourceHashes();
const observations = [];
for (const fixture of fixtures) for (const args of [[], ["-p0"]]) observations.push(await capture(fixture, args));
const after = await sourceHashes();
console.log(JSON.stringify({ startedAt, oracle: oracleIdentity("patch"), before, observations, after, sourceStable: JSON.stringify(before) === JSON.stringify(after), finishedAt: new Date().toISOString() }, null, 2));
