import { cpSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const sourceDir = "src/templates";
const outputDir = "dist/templates";

mkdirSync(outputDir, { recursive: true });

for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const sourceTemplateDir = path.join(sourceDir, entry.name);
  const outputTemplateDir = path.join(outputDir, entry.name);
  mkdirSync(outputTemplateDir, { recursive: true });

  for (const templateFile of readdirSync(sourceTemplateDir, { withFileTypes: true })) {
    if (!templateFile.isFile()) {
      continue;
    }

    const extension = path.extname(templateFile.name);
    if (extension !== ".ajs" && extension !== ".md") {
      continue;
    }

    cpSync(
      path.join(sourceTemplateDir, templateFile.name),
      path.join(outputTemplateDir, templateFile.name)
    );
  }
}
