import { memoryFileSystem, type MemoryRuntime } from "./filesystem.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { posixPath as path } from "@poe-code/safe-fs/runtime-core";
import { writeFileAtomically } from "./atomic-write.js";
import { parseClaims } from "./confidence.js";
import { hasOwnErrorCode } from "./errors.js";
import { parseFrontmatter, serializeFrontmatter, serializeSourceRef } from "./frontmatter.js";
import { initMemory } from "./init.js";
import { collectMarkdownRelPaths, listPages } from "./pages.js";
import {
  assertNoSymlinkSegments,
  MEMORY_INDEX_RELPATH,
  MEMORY_LOG_RELPATH,
  MEMORY_PAGES_DIR_RELPATH
} from "./paths.js";
import type {
  LogVerb,
  MemoryDiff,
  MemoryRoot,
  MemorySnapshot,
  PageFrontmatter,
  SourceRef
} from "./types.js";

export async function snapshot(root: MemoryRoot, runtime: MemoryRuntime = {}): Promise<MemorySnapshot> {
  const fs = memoryFileSystem(runtime);
  const pages = Object.fromEntries(
    await Promise.all(
      (await collectMarkdownRelPaths(root, MEMORY_PAGES_DIR_RELPATH, runtime)).map(async (relPath) => [
        relPath,
        hashContent(await fs.readFile(path.join(root, relPath), "utf8"))
      ])
    )
  );

  return { pages };
}

export async function reconcile(
  root: MemoryRoot,
  before: MemorySnapshot,
  _verb: LogVerb,
  detail: string, runtime: MemoryRuntime = {}
): Promise<MemoryDiff> {
  const fs = memoryFileSystem(runtime);
  await assertNoSymlinkSegments(root, MEMORY_INDEX_RELPATH, runtime);
  await assertNoSymlinkSegments(root, MEMORY_LOG_RELPATH, runtime);
  const originalIndex = await readFileIfPresent(path.join(root, MEMORY_INDEX_RELPATH), runtime);
  const originalLog = await readFileIfPresent(path.join(root, MEMORY_LOG_RELPATH), runtime);
  await initMemory(root, runtime);

  const timestamp = new Date().toISOString();
  const currentPages = await Promise.all(
    (await collectMarkdownRelPaths(root, MEMORY_PAGES_DIR_RELPATH, runtime)).map(async (relPath) => {
      const absPath = path.join(root, relPath);
      const markdown = await fs.readFile(absPath, "utf8");
      const parsed = parsePageMarkdown(relPath, markdown);
      const normalizedFrontmatter = withDenormalizedSources(parsed.frontmatter, parsed.body);
      const normalizedMarkdown = serializeFrontmatter(normalizedFrontmatter, parsed.body);
      const changed = before.pages[relPath] !== hashContent(normalizedMarkdown);
      const nextMarkdown = changed
        ? serializeFrontmatter(
            {
              ...normalizedFrontmatter,
              lastTouchedAt: timestamp
            },
            parsed.body
          )
        : normalizedMarkdown;

      return {
        relPath,
        changed,
        currentMarkdown: markdown,
        nextMarkdown
      };
    })
  );

  try {
    await Promise.all(
      currentPages
        .filter((page) => page.currentMarkdown !== page.nextMarkdown)
        .map((page) => writeFileAtomically(path.join(root, page.relPath), page.nextMarkdown, runtime))
    );

    const diff = diffSnapshots(before, await snapshot(root, runtime));
    await writeIndex(root, runtime);
    await appendLogEntries(root, diff, detail, timestamp, runtime);
    return diff;
  } catch (error) {
    await Promise.all(
      currentPages
        .filter((page) => page.currentMarkdown !== page.nextMarkdown)
        .map((page) => writeFileAtomically(path.join(root, page.relPath), page.currentMarkdown, runtime).catch(() => undefined))
    );
    await restoreGeneratedFile(path.join(root, MEMORY_INDEX_RELPATH), originalIndex, runtime);
    await restoreGeneratedFile(path.join(root, MEMORY_LOG_RELPATH), originalLog, runtime);
    throw error;
  }
}

export function renderIndex(entries: Array<{ relPath: string; description: string }>): string {
  if (entries.length === 0) {
    return "# Memory index\n";
  }

  return [
    "# Memory index",
    "",
    ...entries.map(({ relPath, description }) => {
      const pageName = relPath.slice(`${MEMORY_PAGES_DIR_RELPATH}/`.length).replace(/\.md$/i, "");

      return description.length === 0
        ? `- [${pageName}](${relPath})`
        : `- [${pageName}](${relPath}) — ${description}`;
    }),
    ""
  ].join("\n");
}

export async function appendLogEntries(
  root: MemoryRoot,
  diff: MemoryDiff,
  detail: string,
  timestamp = new Date().toISOString(), runtime: MemoryRuntime = {}
): Promise<void> {
  const fs = memoryFileSystem(runtime);
  const entries = [
    ...diff.updated.map((relPath) => formatLogLine(timestamp, "update", relPath, detail)),
    ...diff.deleted.map((relPath) => formatLogLine(timestamp, "delete", relPath, detail)),
    ...diff.created.map((relPath) => formatLogLine(timestamp, "create", relPath, detail))
  ];

  if (entries.length === 0) {
    return;
  }

  await assertNoSymlinkSegments(root, MEMORY_LOG_RELPATH, runtime);
  const logPath = path.join(root, MEMORY_LOG_RELPATH);
  const existing = await fs.readFile(logPath, "utf8");
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFileAtomically(logPath, `${existing}${separator}${entries.join("\n")}\n`, runtime);
}

export function denormalizeSources(markdown: string): SourceRef[] {
  const seen = new Map<string, SourceRef>();

  for (const claim of parseClaims(parsePageMarkdown("inline-memory-page", markdown).body)) {
    const source = "source" in claim.tag ? claim.tag.source : undefined;
    if (source === undefined) {
      continue;
    }

    seen.set(serializeSourceRef(source), source);
  }

  return Array.from(seen.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, source]) => source);
}

async function writeIndex(root: MemoryRoot, runtime: MemoryRuntime = {}): Promise<void> {
  await assertNoSymlinkSegments(root, MEMORY_INDEX_RELPATH, runtime);
  const index = renderIndex(
    (await listPages(root, runtime)).map((page) => ({
      relPath: page.relPath,
      description: page.frontmatter.description ?? ""
    }))
  );

  await writeFileAtomically(path.join(root, MEMORY_INDEX_RELPATH), index, runtime);
}

async function readFileIfPresent(filePath: string, runtime: MemoryRuntime = {}): Promise<string | undefined> {
  const fs = memoryFileSystem(runtime);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }

    throw error;
  }
}

async function restoreGeneratedFile(filePath: string, content: string | undefined, runtime: MemoryRuntime = {}): Promise<void> {
  const fs = memoryFileSystem(runtime);
  if (content === undefined) {
    await fs.unlink(filePath).catch(() => undefined);
    return;
  }

  await writeFileAtomically(filePath, content, runtime).catch(() => undefined);
}

function parsePageMarkdown(
  relPath: string,
  markdown: string
): {
  frontmatter: PageFrontmatter;
  body: string;
} {
  try {
    return parseFrontmatter(markdown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to parse frontmatter for "${relPath}": ${message}`);
    return {
      frontmatter: {},
      body: markdown
    };
  }
}

function withDenormalizedSources(frontmatter: PageFrontmatter, body: string): PageFrontmatter {
  const sources = denormalizeSources(body);
  return {
    ...frontmatter,
    ...(sources.length === 0 ? { sources: undefined } : { sources })
  };
}

function diffSnapshots(before: MemorySnapshot, after: MemorySnapshot): MemoryDiff {
  const created = Object.keys(after.pages)
    .filter((relPath) => before.pages[relPath] === undefined)
    .sort((left, right) => left.localeCompare(right));
  const updated = Object.keys(after.pages)
    .filter(
      (relPath) =>
        before.pages[relPath] !== undefined && before.pages[relPath] !== after.pages[relPath]
    )
    .sort((left, right) => left.localeCompare(right));
  const deleted = Object.keys(before.pages)
    .filter((relPath) => after.pages[relPath] === undefined)
    .sort((left, right) => left.localeCompare(right));

  return {
    created,
    updated,
    deleted
  };
}

function formatLogLine(
  timestamp: string,
  verb: "create" | "update" | "delete",
  relPath: string,
  detail: string
): string {
  return `- ${timestamp}  **${verb}** \`${relPath}\` — ${detail}`;
}

function hashContent(content: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(content)));
}

function isMissing(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
