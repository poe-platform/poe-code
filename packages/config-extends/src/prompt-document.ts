import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import { resolve as resolveConfigDocument } from "./resolve.js";

export interface PromptDocumentFileSystem {
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  realpath(filePath: string): Promise<string>;
}

export interface PromptDocumentBaseDocument {
  filePath: string;
  content: string;
}

export interface ResolvePromptDocumentInput {
  cwd: string;
  filePath: string;
  content?: string;
  optional?: boolean;
  basePaths?: readonly string[];
  baseDocuments?: readonly PromptDocumentBaseDocument[];
  variables?: Record<string, unknown>;
  validate?: boolean;
  fs?: PromptDocumentFileSystem;
}

export interface ResolvedPromptDocument {
  template: string;
  prompt: string;
  metadata: Record<string, unknown>;
  sources: Record<string, string>;
  source: string;
  chain: string[];
}

const nativeFs: PromptDocumentFileSystem = {
  readFile: (filePath, encoding) => readFile(filePath, encoding),
  realpath: (filePath) => realpath(filePath)
};

export async function resolvePromptDocument(
  input: ResolvePromptDocumentInput
): Promise<ResolvedPromptDocument> {
  const cwd = path.resolve(input.cwd);
  const filePath = path.resolve(cwd, input.filePath);
  assertInsideRoot(filePath, cwd, "Prompt document path must remain inside cwd");
  const baseDocuments = (input.baseDocuments ?? []).map((document) => ({
    filePath: requireAbsolutePath(document.filePath, "Prompt document base document paths"),
    content: document.content
  }));
  const basePaths = [
    ...(input.basePaths ?? []).map((basePath) =>
      requireAbsolutePath(basePath, "Prompt document base paths")
    ),
    ...baseDocuments.map(({ filePath: baseFilePath }) => path.dirname(baseFilePath))
  ];
  const fs = createRootedFileSystem(
    createDocumentFileSystem(input.fs ?? nativeFs, baseDocuments),
    [cwd, ...basePaths]
  );
  const content = input.content ?? (await readDocumentContent(fs, filePath, input.optional));
  const chain = [
    { source: "document", filePath, content },
    ...basePaths.map((basePath, index) => ({ source: `base-${index + 1}`, path: basePath }))
  ];
  const composed = await resolveConfigDocument(chain, { fs });
  const rendered = await resolveConfigDocument(chain, {
    fs,
    view: input.variables ?? {},
    validate: input.validate ?? true
  });
  const template = requirePrompt(getOwnEntry(composed.data, "prompt"), filePath);
  const prompt = requirePrompt(getOwnEntry(rendered.data, "prompt"), filePath);
  const { prompt: _ignored, ...metadata } = rendered.data;
  void _ignored;
  return {
    template,
    prompt,
    metadata,
    sources: rendered.sources,
    source: filePath,
    chain: rendered.chain
  };
}

function createDocumentFileSystem(
  fs: PromptDocumentFileSystem,
  documents: readonly PromptDocumentBaseDocument[]
): PromptDocumentFileSystem {
  const contentByPath = new Map(
    documents.map(({ filePath, content }) => [path.resolve(filePath), content] as const)
  );
  return {
    readFile(filePath, encoding) {
      const content = contentByPath.get(path.resolve(filePath));
      return content === undefined ? fs.readFile(filePath, encoding) : Promise.resolve(content);
    },
    realpath(filePath) {
      const resolvedPath = path.resolve(filePath);
      return contentByPath.has(resolvedPath) ? Promise.resolve(resolvedPath) : fs.realpath(filePath);
    }
  };
}

async function readDocumentContent(
  fs: PromptDocumentFileSystem,
  filePath: string,
  optional: boolean | undefined
): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (optional && hasOwnErrorCode(error, "ENOENT")) {
      return "---\nextends: true\n---\n";
    }
    throw error;
  }
}

function createRootedFileSystem(
  fs: PromptDocumentFileSystem,
  roots: readonly string[]
): PromptDocumentFileSystem {
  return {
    async readFile(filePath, encoding) {
      await assertRealPathInsideOriginalRoot(fs, filePath, roots);
      return fs.readFile(filePath, encoding);
    },
    realpath: (filePath) => fs.realpath(filePath)
  };
}

async function assertRealPathInsideOriginalRoot(
  fs: PromptDocumentFileSystem,
  filePath: string,
  roots: readonly string[]
): Promise<void> {
  const resolvedPath = path.resolve(await fs.realpath(filePath));
  const originalRoot = roots.find((root) => isInsideRoot(filePath, root));
  if (!originalRoot || !isInsideRoot(resolvedPath, originalRoot)) {
    throw new Error(`Prompt document path escapes configured root: ${filePath}`);
  }
}

function requireAbsolutePath(filePath: string, label: string): string {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`${label} must be absolute: ${filePath}`);
  }
  return path.resolve(filePath);
}

function assertInsideRoot(filePath: string, root: string, message: string): void {
  if (!isInsideRoot(filePath, root)) {
    throw new Error(`${message}: ${filePath}`);
  }
}

function isInsideRoot(filePath: string, root: string): boolean {
  const relativePath = path.relative(path.resolve(root), path.resolve(filePath));
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
  );
}

function requirePrompt(value: unknown, filePath: string): string {
  if (typeof value !== "string") {
    throw new Error(`Prompt document does not resolve to a Markdown prompt: ${filePath}`);
  }
  return value;
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
