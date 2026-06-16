import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Ignore, Options as IgnoreOptions } from "ignore";

const require = createRequire(import.meta.url);
const createIgnore = require("ignore") as (options?: IgnoreOptions) => Ignore;

export interface DockerBuildContextFile {
  relativePath: string;
  bytes: Buffer;
}

interface BuildContextDirent {
  name: string | Buffer;
  isDirectory(): boolean;
  isFile(): boolean;
}

export async function readDockerBuildContextFiles(
  buildContext: string
): Promise<DockerBuildContextFile[]> {
  const rootEntries = await readdir(buildContext, { withFileTypes: true });
  const dockerignoreEntry = rootEntries.find(
    (entry) => entry.isFile() && String(entry.name) === ".dockerignore"
  );
  const ignored = createIgnore();
  if (dockerignoreEntry !== undefined) {
    ignored.add(String(await readFile(path.join(buildContext, ".dockerignore"))));
  }

  const files: DockerBuildContextFile[] = [];
  await collectBuildContextFiles(buildContext, "", files, ignored, rootEntries);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collectBuildContextFiles(
  buildContext: string,
  relativeDir: string,
  files: DockerBuildContextFile[],
  ignored: Ignore,
  entries?: BuildContextDirent[]
): Promise<void> {
  const absoluteDir = path.join(buildContext, relativeDir);
  const dirEntries = entries ?? (await readdir(absoluteDir, { withFileTypes: true }));

  for (const entry of dirEntries) {
    const relativePath = path.join(relativeDir, String(entry.name));
    const dockerPath = relativePath.split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (!ignored.ignores(`${dockerPath}/`)) {
        await collectBuildContextFiles(buildContext, relativePath, files, ignored);
      }
      continue;
    }
    if (!entry.isFile() || (dockerPath !== ".dockerignore" && ignored.ignores(dockerPath))) {
      continue;
    }
    files.push({
      relativePath: dockerPath,
      bytes: await readFile(path.join(buildContext, relativePath))
    });
  }
}
