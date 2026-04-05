import * as esbuild from "esbuild";
import path from "node:path";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootDir = path.resolve(packageDir, "../..");
const srcDir = path.join(packageDir, "src");
const distDir = path.join(packageDir, "dist");

async function getWorkspaceAliases() {
  const aliases = {};
  const packagesDir = path.join(rootDir, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    aliases[packageJson.name] = path.join(packagesDir, entry.name, "src");
  }

  return aliases;
}

async function getEntryPoints(directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryRelativePath = path.join(relative, entry.name);
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await getEntryPoints(entryPath, entryRelativePath));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }

    files.push(path.join(srcDir, entryRelativePath));
  }

  return files;
}

const packageJson = JSON.parse(
  await readFile(path.join(packageDir, "package.json"), "utf8")
);
const aliases = await getWorkspaceAliases();
const entryPoints = await getEntryPoints(srcDir);
const external = [...Object.keys(packageJson.dependencies ?? {}), "node:*"];

for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
  delete aliases[dependency];
}

await esbuild.build({
  entryPoints,
  outdir: distDir,
  outbase: srcDir,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: true,
  alias: aliases,
  external
});

const cliPath = path.join(distDir, "cli.js");
const cliContents = await readFile(cliPath, "utf8");

if (!cliContents.startsWith("#!/usr/bin/env node")) {
  await writeFile(cliPath, `#!/usr/bin/env node\n${cliContents}`, "utf8");
}

await mkdir(path.join(distDir, "templates"), { recursive: true });
await cp(
  path.join(rootDir, "packages", "agent-skill-config", "src", "templates", "terminal-pilot.md"),
  path.join(distDir, "templates", "terminal-pilot.md")
);
