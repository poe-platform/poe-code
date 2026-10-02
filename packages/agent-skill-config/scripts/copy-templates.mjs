import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";

const sourceDir = "src/templates";
const outputDir = "dist/templates";

await assertSafeOutputDirectory(process.cwd(), path.resolve(outputDir));
mkdirSync(outputDir, { recursive: true });

const templates = {};

for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || path.extname(entry.name) !== ".md") {
    continue;
  }

  templates[entry.name] = readFileSync(path.join(sourceDir, entry.name), "utf8");
  cpSync(path.join(sourceDir, entry.name), path.join(outputDir, entry.name));
}

writeFileSync("dist/template-data.js", `export const templates = Object.freeze(${JSON.stringify(templates)});\n`);
