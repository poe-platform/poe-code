import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertSafeOutputDirectory } from "./guard-package-dist.mjs";
import { versionGateSnippet } from "./node-version-gate.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");
const distDir = path.join(rootDir, "dist");
const binDir = path.join(distDir, "bin");

await mkdir(binDir, { recursive: true });

// Generate standalone poe-agent binary wrapper
const poeAgentPath = path.join(binDir, "poe-agent.js");
await assertSafeOutputDirectory(rootDir, poeAgentPath);
const poeAgentContent = [
  "#!/usr/bin/env node",
  versionGateSnippet("poe-agent"),
  'import("../cli/poe-agent-main.js").then(function (m) { m.poeAgentMain(); }).catch(function (err) { console.error(err); process.exit(1); })',
  ""
].join("\n");
await writeFile(poeAgentPath, poeAgentContent, { encoding: "utf8" });
