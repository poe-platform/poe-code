#!/usr/bin/env tsx
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeOutputDirectory } from "./guard-package-dist.mjs";
import { getDefaultProviders } from "../src/providers/index.js";
import {
  collectSpawnLabels,
  renderLabelDocument
} from "../src/tools/label-generator.js";

async function main(): Promise<void> {
  const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const docPath = path.join(rootDir, "docs", "LABELS.md");
  const providers = getDefaultProviders();
  const labels = collectSpawnLabels(providers);
  const markdown = renderLabelDocument(labels);
  await assertSafeOutputDirectory(rootDir, docPath);
  await writeFile(docPath, `${markdown}\n`, { encoding: "utf8" });
  console.log(`Generated ${docPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
