import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function readPublishedMetadataFromNpm(packageName) {
  const output = execFileSync(
    "npm",
    ["view", packageName, "name", "version", "gitHead", "--json"],
    { encoding: "utf8" }
  );
  return JSON.parse(output);
}

function workspaceSourceChangedSince(packageDir, publishedGitHead) {
  const relativePackageDir = path.relative(repoRoot, packageDir);

  try {
    execFileSync(
      "git",
      ["diff", "--quiet", publishedGitHead, "HEAD", "--", relativePackageDir],
      { cwd: repoRoot, stdio: "ignore" }
    );
    return false;
  } catch (error) {
    if (error !== null && typeof error === "object" && error.status === 1) {
      return true;
    }
    throw error;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validatePublishedMetadata(packageName, metadata) {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    metadata.name !== packageName ||
    typeof metadata.version !== "string" ||
    metadata.version.length === 0 ||
    typeof metadata.gitHead !== "string" ||
    metadata.gitHead.length === 0
  ) {
    throw new Error(`Invalid published metadata for ${packageName}.`);
  }
}

export async function preparePublishedWorkspaceVersion({
  packageDir,
  attempts = 24,
  delay = () => wait(5_000),
  fileSystem = { readFileSync, writeFileSync },
  readPublishedMetadata = readPublishedMetadataFromNpm,
  sourceChangedSince = (gitHead) => workspaceSourceChangedSince(packageDir, gitHead)
}) {
  const packageJsonPath = path.join(packageDir, "package.json");
  const manifest = JSON.parse(fileSystem.readFileSync(packageJsonPath, "utf8"));
  const packageName = manifest.name;

  if (typeof packageName !== "string" || packageName.length === 0) {
    throw new Error(`Workspace package at ${packageDir} has no package name.`);
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let metadata;
    try {
      metadata = await readPublishedMetadata(packageName);
    } catch {
      if (attempt < attempts) {
        await delay();
        continue;
      }
      break;
    }
    validatePublishedMetadata(packageName, metadata);

    if (!sourceChangedSince(metadata.gitHead)) {
      fileSystem.writeFileSync(
        packageJsonPath,
        `${JSON.stringify({ ...manifest, version: metadata.version }, null, 2)}\n`,
        "utf8"
      );
      return metadata.version;
    }

    if (attempt < attempts) {
      await delay();
    }
  }

  throw new Error(
    `${packageName} has no published release containing the current workspace source.`
  );
}

async function main() {
  const packageDirArgument = process.argv[2];
  if (packageDirArgument === undefined) {
    throw new Error("Usage: prepare-published-workspace-version.mjs <package-directory>");
  }

  const packageDir = path.resolve(repoRoot, packageDirArgument);
  const version = await preparePublishedWorkspaceVersion({ packageDir });
  process.stdout.write(`${version}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
