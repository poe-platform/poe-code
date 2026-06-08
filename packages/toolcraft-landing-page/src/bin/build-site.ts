import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ACME_LANDING_PAGE } from "../examples/acme.js";
import { renderLandingPage } from "../render.js";

interface BuildSiteFileSystem {
  mkdir(directoryPath: string, options: { recursive: true }): Promise<unknown>;
  writeFile(filePath: string, contents: string, encoding: "utf8"): Promise<void>;
}

interface BuildSiteOptions {
  fs?: BuildSiteFileSystem;
  outputDirectory?: string;
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function buildSite(options: BuildSiteOptions = {}): Promise<void> {
  const fileSystem = options.fs ?? fs;
  const outputDirectory = options.outputDirectory ?? path.join(packageRoot, "dist-site");
  const html = renderLandingPage(ACME_LANDING_PAGE);

  await fileSystem.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    fileSystem.writeFile(path.join(outputDirectory, "index.html"), html, "utf8"),
    fileSystem.writeFile(path.join(outputDirectory, ".nojekyll"), "", "utf8")
  ]);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildSite();
}
