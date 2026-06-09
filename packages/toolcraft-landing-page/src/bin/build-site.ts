import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hasOwnErrorCode } from "../error-codes.js";
import { ACME_LANDING_PAGE } from "../examples/acme.js";
import { renderLandingPage } from "../render.js";

interface BuildSiteFileSystem {
  mkdir(directoryPath: string, options: { recursive: true }): Promise<unknown>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  rm(filePath: string, options: { force: true }): Promise<void>;
  writeFile(
    filePath: string,
    contents: string,
    options: { encoding: "utf8"; flag?: string }
  ): Promise<void>;
}

interface BuildSiteOptions {
  fs?: BuildSiteFileSystem;
  outputDirectory?: string;
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEMP_WRITE_MAX_ATTEMPTS = 3;

export async function buildSite(options: BuildSiteOptions = {}): Promise<void> {
  const fileSystem = options.fs ?? fs;
  const outputDirectory = options.outputDirectory ?? path.join(packageRoot, "dist-site");
  const html = renderLandingPage(ACME_LANDING_PAGE);

  await fileSystem.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFileAtomically(fileSystem, path.join(outputDirectory, "index.html"), html),
    writeFileAtomically(fileSystem, path.join(outputDirectory, ".nojekyll"), "")
  ]);
}

async function writeFileAtomically(
  fileSystem: BuildSiteFileSystem,
  filePath: string,
  contents: string
): Promise<void> {
  for (let attempt = 1; attempt <= TEMP_WRITE_MAX_ATTEMPTS; attempt += 1) {
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

    try {
      await writeTempThenRename(fileSystem, tempPath, filePath, contents);
      return;
    } catch (error) {
      if (isExistingPath(error) && attempt < TEMP_WRITE_MAX_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }
}

async function writeTempThenRename(
  fileSystem: BuildSiteFileSystem,
  tempPath: string,
  filePath: string,
  contents: string
): Promise<void> {
  let tempCreated = false;

  try {
    await fileSystem.writeFile(tempPath, contents, { encoding: "utf8", flag: "wx" });
    tempCreated = true;
    await fileSystem.rename(tempPath, filePath);
  } catch (error) {
    if (tempCreated || !isExistingPath(error)) {
      await fileSystem.rm(tempPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

function isExistingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildSite();
}
