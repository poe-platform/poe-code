import { cpSync, mkdirSync, readdirSync } from "fs";
import path from "path";

const sourceDir = "src/templates";
const outputDir = "dist/templates";

mkdirSync(outputDir, { recursive: true });

for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || path.extname(entry.name) !== ".md") {
    continue;
  }

  cpSync(path.join(sourceDir, entry.name), path.join(outputDir, entry.name));
}
