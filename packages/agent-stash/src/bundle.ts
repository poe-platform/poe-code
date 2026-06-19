import path from "node:path";
import { MANIFEST_FILENAME, parseManifest, serializeManifest, validateBundlePath } from "./manifest.js";
import { sha256 } from "./hash.js";
import type { AgentStashManifest, BundleFile, GistRecord } from "./types.js";

export interface RemoteBundle {
  manifest: AgentStashManifest;
  files: Map<string, string>;
}

export function gistFilesFromBundle(manifest: AgentStashManifest, files: readonly BundleFile[]): Record<string, { content: string }> {
  const result = Object.create(null) as Record<string, { content: string }>;
  result[MANIFEST_FILENAME] = { content: serializeManifest(manifest) };
  for (const file of files) {
    result[gistFilenameForBundlePath(file.path)] = { content: file.content };
  }
  return result;
}

export function gistFilenameForBundlePath(bundlePath: string): string {
  validateBundlePath(bundlePath);
  return encodeURIComponent(bundlePath);
}

export function bundlePathFromGistFilename(filename: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    throw new Error(`Invalid encoded Gist filename: ${filename}`);
  }
  validateBundlePath(decoded);
  return decoded;
}

export function loadBundleFromGist(gist: GistRecord): RemoteBundle {
  const manifestFile = gist.files[MANIFEST_FILENAME];
  if (!manifestFile) {
    throw new Error(`Gist ${gist.id} does not contain ${MANIFEST_FILENAME}`);
  }
  validateGistFile(MANIFEST_FILENAME, manifestFile);
  const manifest = parseManifest(manifestFile.content);
  const files = new Map<string, string>();
  for (const [filename, file] of Object.entries(gist.files)) {
    if (filename === MANIFEST_FILENAME) {
      continue;
    }
    validateGistFile(filename, file);
    const bundlePath = bundlePathFromGistFilename(filename);
    if (files.has(bundlePath)) {
      throw new Error(`Duplicate Gist bundle path: ${bundlePath}`);
    }
    files.set(bundlePath, file.content);
  }
  return { manifest, files };
}

function validateGistFile(filename: string, file: unknown): asserts file is { content: string } {
  if (typeof file !== "object" || file === null || Array.isArray(file)) {
    throw new Error(`Invalid Gist file response: ${filename}`);
  }
  if (typeof (file as { content?: unknown }).content !== "string") {
    throw new Error(`Invalid Gist file content: ${filename}`);
  }
}

export function verifyBundleHashes(bundle: RemoteBundle): void {
  const expectedPaths = new Set<string>();
  for (const item of bundle.manifest.items) {
    for (const file of item.files) {
      expectedPaths.add(file.path);
      const content = bundle.files.get(file.path);
      if (content === undefined) {
        throw new Error(`Remote bundle is missing ${file.path}`);
      }
      if (Buffer.byteLength(content, "utf8") !== file.size || sha256(content) !== file.sha256) {
        throw new Error(`Remote bundle file hash mismatch for ${file.path}`);
      }
    }
  }
  for (const filePath of bundle.files.keys()) {
    if (!expectedPaths.has(filePath)) {
      throw new Error(`Remote bundle contains untracked file ${filePath}`);
    }
  }
}

export function filesForItem(bundle: RemoteBundle, itemId: string): BundleFile[] {
  const item = bundle.manifest.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error(`Remote item not found: ${itemId}`);
  }
  return item.files.map((file) => {
    const content = bundle.files.get(file.path);
    if (content === undefined) {
      throw new Error(`Remote bundle is missing ${file.path}`);
    }
    return { path: file.path, content };
  });
}

export function localPathForBundleFile(itemPath: string, filePath: string, targetPath: string): string {
  if (itemPath === filePath) {
    return targetPath;
  }
  const relative = path.posix.relative(itemPath, filePath);
  validateBundlePath(relative);
  return path.join(targetPath, ...relative.split("/"));
}
