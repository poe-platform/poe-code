import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { versionGateSnippet } from "./node-version-gate.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");
const distDir = path.join(rootDir, "dist");
const binDir = path.join(distDir, "bin");

const providersModule = await import(
  pathToFileURL(path.join(distDir, "providers", "index.js")).href
);
const aliasesModule = await import(
  pathToFileURL(path.join(distDir, "cli", "binary-aliases.js")).href
);

const providers = providersModule.getDefaultProviders();
const aliases = aliasesModule.deriveWrapBinaryAliases(providers);

await mkdir(binDir, { recursive: true });

for (const alias of aliases) {
  const filePath = path.join(binDir, `${alias.binName}.js`);
  const content = [
    "#!/usr/bin/env node",
    versionGateSnippet(alias.binName),
    'import { spawn } from "node:child_process";',
    'import path from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "",
    "const currentFile = fileURLToPath(import.meta.url);",
    "const distDir = path.resolve(path.dirname(currentFile), \"..\");",
    "const entry = path.join(distDir, \"index.js\");",
    `const service = ${JSON.stringify(alias.serviceName)};`,
    "const agentArgs = process.argv.slice(2);",
    "const args = [entry, \"wrap\", service, \"--\", ...agentArgs];",
    "const child = spawn(process.execPath, args, { stdio: \"inherit\" });",
    "child.on(\"close\", (code) => process.exit(code ?? 0));",
    "child.on(\"error\", (error) => {",
    "  throw error;",
    "});",
    ""
  ].join("\n");
  await writeFile(filePath, content, { encoding: "utf8" });
}

// Generate standalone poe-agent binary wrapper
const poeAgentPath = path.join(binDir, "poe-agent.js");
const poeAgentContent = [
  "#!/usr/bin/env node",
  versionGateSnippet("poe-agent"),
  'import("../index.js").then(function (m) { m.poeAgentMain(); }).catch(function (err) { console.error(err); process.exit(1); })',
  ""
].join("\n");
await writeFile(poeAgentPath, poeAgentContent, { encoding: "utf8" });

