import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, relative } from "node:path";

export interface SourceInputFileSystem {
  readdirSync(path: string): string[];
  lstatSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number };
  readFileSync(path: string): Buffer;
}

interface SourceBoundaries {
  heldSourceFiles: readonly string[];
  heldEvidenceDirectories: readonly string[];
}

const { loadBoundaries } = await import(new URL("../scripts/integration-inputs.mjs", import.meta.url).href) as {
  loadBoundaries(root: string, fileSystem: SourceInputFileSystem): SourceBoundaries;
};
const { assertLiteralInputPath, readRegularInput } = await import(new URL("../scripts/typecheck-integration-inputs.mjs", import.meta.url).href) as {
  assertLiteralInputPath(path: string): void;
  readRegularInput(root: string, path: string, maximum: number, fileSystem: SourceInputFileSystem): Buffer;
};

export function isAdmittedSourcePath(path: string, boundaries: SourceBoundaries): boolean {
  assertLiteralInputPath(path);
  assert.ok(path === "src" || path.startsWith("src/"), `source census path must stay below src: ${path}`);
  const folded = path.toLowerCase();
  for (const held of boundaries.heldSourceFiles) {
    if (folded !== held.toLowerCase()) continue;
    assert.equal(path, held, `case alias of held source: ${path}`);
    return false;
  }
  for (const directory of boundaries.heldEvidenceDirectories.filter(entry => entry.startsWith("src/"))) {
    if (folded !== directory.toLowerCase() && !folded.startsWith(`${directory.toLowerCase()}/`)) continue;
    assert.equal(path.slice(0, directory.length), directory, `case alias of held directory: ${path}`);
    return false;
  }
  for (const directory of new Set(boundaries.heldSourceFiles.map(path => posix.dirname(path)))) {
    if (folded === directory.toLowerCase()) assert.equal(path, directory, `case alias of held source directory: ${path}`);
    assert.ok(!folded.startsWith(`${directory.toLowerCase()}/`), `unclassified held source path: ${path}`);
  }
  return true;
}

export function collectSourceInputs(root: string, fileSystem: SourceInputFileSystem = { lstatSync, readFileSync, readdirSync }) {
  const admissionInputs = new Map<string, Buffer>();
  const recording: SourceInputFileSystem = {
    ...fileSystem,
    readFileSync(path) {
      const bytes = fileSystem.readFileSync(path);
      admissionInputs.set(relative(root, path), bytes);
      return bytes;
    },
  };
  const boundaries = loadBoundaries(root, recording);
  for (const path of ["scripts/integration-inputs.mjs", "scripts/typecheck-integration-inputs.mjs", "tests/source-census.ts"]) {
    readRegularInput(root, path, 300000, recording);
  }
  const files = new Map<string, Buffer>();
  let sourceBytes = 0;
  const visit = (path: string): void => {
    if (!isAdmittedSourcePath(path, boundaries)) return;
    const absolute = join(root, path);
    const stat = fileSystem.lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const name of fileSystem.readdirSync(absolute).sort((left, right) => left.localeCompare(right))) visit(`${path}/${name}`);
    } else {
      assert.ok(stat.isFile(), `source census input must be a regular file: ${path}`);
      assert.ok(files.size < 5000 && sourceBytes + stat.size <= 64 * 1024 * 1024, "source census exceeds its explicit input budget");
      const bytes = readRegularInput(root, path, 1048576, fileSystem);
      sourceBytes += bytes.length;
      files.set(path, bytes);
    }
  };
  visit("src");
  return {
    files,
    admissionInputs,
    admission: {
      qualification: "Current admitted source plus authenticated boundary inputs; held source/evidence are not read or certified",
      heldSourceFiles: [...boundaries.heldSourceFiles],
      heldEvidenceDirectories: boundaries.heldEvidenceDirectories.filter(path => path.startsWith("src/")),
    },
  };
}
