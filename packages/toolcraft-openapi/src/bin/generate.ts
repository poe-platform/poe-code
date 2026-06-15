#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "toolcraft";
import { hasOwnErrorCode } from "../error-codes.js";
import { withOutputFormat, type OutputFormat } from "toolcraft-design";
import { readToolcraftConfig } from "../config.js";
import type { ToolcraftConfig } from "../config.js";
import { diagnose } from "../diagnose.js";
import { formatDiagnostics, type Diagnostic } from "../diagnostics.js";
import { generate, type GeneratedFile } from "../generate.js";
import { inspectOpenApiSource } from "../inspect-source.js";
import { renderOpenApiInspection } from "../render-inspection.js";
import { parseOpenApiDocument, readOpenApiSourceText } from "../spec-source.js";

interface GenerateCliFileSystem {
  lstat(targetPath: string): Promise<{ isDirectory(): boolean; isSymbolicLink(): boolean }>;
  mkdir(directoryPath: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  readdir(directoryPath: string): Promise<string[]>;
  rename(oldPath: string, newPath: string): Promise<unknown>;
  rm(targetPath: string, options?: { force?: boolean }): Promise<void>;
  realpath(targetPath: string): Promise<string>;
  unlink(targetPath: string): Promise<void>;
  writeFile(
    filePath: string,
    contents: string,
    options: BufferEncoding | { encoding?: BufferEncoding; flag?: string }
  ): Promise<void>;
}

interface GenerateCliWriter {
  write(chunk: string | Uint8Array): boolean;
}

interface GenerateCliServices {
  cwd: string;
  fetch: typeof globalThis.fetch;
  fs: GenerateCliFileSystem;
  stderr: GenerateCliWriter;
  stdout: GenerateCliWriter;
}

interface GenerateCliOptions {
  check: boolean;
  diff: boolean;
  input: string;
  inspect: boolean;
  outputFormat: OutputFormat;
  outputDir: string;
}

interface SyncGeneratedClientResult {
  deletedFileCount: number;
  deletedFiles: string[];
  diagnostics: Diagnostic[];
  drifted: boolean;
  specSha: string;
  updatedFiles: UpdatedGeneratedFile[];
  updatedFileCount: number;
}

interface UpdatedGeneratedFile extends GeneratedFile {
  previousContents?: string;
}

const DEFAULT_OPTIONS: GenerateCliOptions = {
  check: false,
  diff: false,
  input: "openapi.json",
  inspect: false,
  outputFormat: "terminal",
  outputDir: "src/generated"
};

const HELP_TEXT = `Usage: toolcraft-openapi-generate [options]

Options:
  --input <path-or-url>  OpenAPI document to read (default: openapi.json)
  --output <dir>         Directory for generated command files (default: src/generated)
  --check                Exit non-zero if generated output would change
  --diff                 Print a diff of generated changes without writing files
  --inspect              Inspect route compatibility without writing files
  --output-format <fmt>  Inspection output: terminal, markdown, or json (default: terminal)
  -h, --help             Show this help text
`;

export async function runGenerateCli(
  argv: string[] = process.argv,
  services: GenerateCliServices = {
    cwd: process.cwd(),
    fetch: globalThis.fetch,
    fs,
    stderr: process.stderr,
    stdout: process.stdout
  }
): Promise<number> {
  try {
    const parsed = parseGenerateCliArgs(argv.slice(2));

    if (parsed === "help") {
      services.stdout.write(HELP_TEXT);
      return 0;
    }

    if (parsed.inspect) {
      const report = await inspectOpenApiSource(parsed.input, services);
      services.stdout.write(
        `${withOutputFormat(parsed.outputFormat, () => renderOpenApiInspection(report))}\n`
      );
      return 0;
    }

    const result = await syncGeneratedClient(parsed, services);

    if (result.diagnostics.length > 0) {
      services.stderr.write(formatDiagnostics(result.diagnostics));
    }

    const diagnosticsFailed = hasErrorDiagnostics(result.diagnostics);

    if (!parsed.check && !parsed.diff && diagnosticsFailed) {
      services.stderr.write("OpenAPI diagnostics failed for toolcraft.yml.\n");
      return 1;
    }

    if (parsed.diff) {
      if (!result.drifted) {
        services.stdout.write(`OpenAPI output is up to date (${result.specSha}).\n`);
        return 0;
      }

      services.stdout.write(renderGeneratedDiff(result, services.cwd));
      return 1;
    }

    if (parsed.check) {
      if (result.drifted) {
        services.stderr.write(
          `OpenAPI output is out of date for ${parsed.outputDir}. Run the generator without --check to update it.\n`
        );
        return 1;
      }

      if (diagnosticsFailed) {
        services.stderr.write("OpenAPI diagnostics failed for toolcraft.yml.\n");
        return 1;
      }

      services.stdout.write(`OpenAPI output is up to date (${result.specSha}).\n`);
      return 0;
    }

    if (result.drifted) {
      services.stdout.write(
        `Updated OpenAPI output (${result.updatedFileCount} written, ${result.deletedFileCount} deleted).\n`
      );
      return 0;
    }

    services.stdout.write(`OpenAPI output is up to date (${result.specSha}).\n`);
    return 0;
  } catch (error) {
    if (error instanceof UserError) {
      services.stderr.write(`${error.message}\n`);
      return 1;
    }

    if (error instanceof Error && error.name === "ToolcraftBugError") {
      services.stderr.write(
        `toolcraft hit an internal invariant: ${error.message}\n` +
          `This is a bug in toolcraft or in the command definition; ` +
          `it cannot be worked around by changing argv. ` +
          `File an issue.\n`
      );
      return 1;
    }

    throw error;
  }
}

export async function syncGeneratedClient(
  options: GenerateCliOptions,
  services: Pick<GenerateCliServices, "cwd" | "fetch" | "fs">
): Promise<SyncGeneratedClientResult> {
  const sourceText = await readOpenApiSourceText(options.input, services);
  const specSha = createSpecSha(sourceText);
  const document = parseOpenApiDocument(sourceText, options.input);
  const configResult = await readAdjacentToolcraftConfig(options.input, services);
  const diagnostics =
    configResult.config === undefined
      ? configResult.diagnostics
      : [...configResult.diagnostics, ...diagnose(configResult.config, document)];
  const effectiveConfig = hasErrorDiagnostics(diagnostics) ? undefined : configResult.config;
  const generatedFiles = generate(document, { specSha, config: effectiveConfig });
  const outputDir = path.resolve(services.cwd, options.outputDir);
  const currentFiles = await readGeneratedFiles(services.fs, outputDir);
  const desiredFiles = new Map([
    ...generatedFiles.map((file) => [path.resolve(outputDir, file.path), file.contents] as const),
    ...createDownloadedSpecFiles(options.input, sourceText).map(
      (file) => [path.resolve(outputDir, file.path), file.contents] as const
    )
  ]);
  const updatedFiles = collectUpdatedFiles(currentFiles, desiredFiles);
  const deletedFiles = collectDeletedFiles(currentFiles, desiredFiles);
  const drifted = updatedFiles.length > 0 || deletedFiles.length > 0;

  if (!options.check && !options.diff && drifted && !hasErrorDiagnostics(diagnostics)) {
    try {
      await writeGeneratedFiles(services.fs, outputDir, updatedFiles);
      await deleteGeneratedFiles(services.fs, outputDir, deletedFiles);
    } catch (error) {
      await restoreGeneratedFiles(services.fs, outputDir, currentFiles, updatedFiles, deletedFiles);
      throw error;
    }
  }

  return {
    deletedFiles,
    deletedFileCount: deletedFiles.length,
    diagnostics,
    drifted,
    specSha,
    updatedFiles,
    updatedFileCount: updatedFiles.length
  };
}

async function readAdjacentToolcraftConfig(
  input: string,
  services: Pick<GenerateCliServices, "cwd" | "fs">
): Promise<{ config?: ToolcraftConfig; diagnostics: Diagnostic[] }> {
  const configPath = resolveAdjacentConfigPath(input, services.cwd);
  if (configPath === undefined) {
    return { diagnostics: [] };
  }

  try {
    return await readToolcraftConfig(configPath, { fs: services.fs });
  } catch (error) {
    if (isNotFoundError(error)) {
      return { diagnostics: [] };
    }

    throw error;
  }
}

function resolveAdjacentConfigPath(input: string, cwd: string): string | undefined {
  const inputUrl = tryParseUrl(input);
  if (inputUrl !== null && (inputUrl.protocol === "http:" || inputUrl.protocol === "https:")) {
    return undefined;
  }

  return path.resolve(cwd, path.dirname(input), "toolcraft.yml");
}

function hasErrorDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function renderGeneratedDiff(result: SyncGeneratedClientResult, outputDir: string): string {
  const sections: string[] = [];

  for (const file of result.updatedFiles) {
    const relativePath = path.relative(outputDir, file.path);
    sections.push(renderFileDiff(relativePath, file.previousContents ?? "", file.contents));
  }

  for (const filePath of result.deletedFiles) {
    const relativePath = path.relative(outputDir, filePath);
    sections.push([`--- ${relativePath}`, `+++ /dev/null`, "-<deleted>"].join("\n"));
  }

  return `${sections.join("\n")}\n`;
}

function renderFileDiff(relativePath: string, previousContents: string, nextContents: string): string {
  const previousLines = previousContents.split("\n");
  const nextLines = nextContents.split("\n");

  return [
    `--- ${relativePath}`,
    `+++ ${relativePath}`,
    ...collectChangedDiffLines(previousLines, nextLines)
  ].join("\n");
}

function collectChangedDiffLines(previousLines: string[], nextLines: string[]): string[] {
  const lengths = Array.from({ length: previousLines.length + 1 }, () =>
    Array<number>(nextLines.length + 1).fill(0)
  );

  for (let leftIndex = previousLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = nextLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex]![rightIndex] =
        previousLines[leftIndex] === nextLines[rightIndex]
          ? lengths[leftIndex + 1]![rightIndex + 1]! + 1
          : Math.max(lengths[leftIndex + 1]![rightIndex]!, lengths[leftIndex]![rightIndex + 1]!);
    }
  }

  const lines: string[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < previousLines.length && rightIndex < nextLines.length) {
    if (previousLines[leftIndex] === nextLines[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (lengths[leftIndex + 1]![rightIndex]! >= lengths[leftIndex]![rightIndex + 1]!) {
      lines.push(`-${previousLines[leftIndex]}`);
      leftIndex += 1;
      continue;
    }

    lines.push(`+${nextLines[rightIndex]}`);
    rightIndex += 1;
  }

  while (leftIndex < previousLines.length) {
    lines.push(`-${previousLines[leftIndex]}`);
    leftIndex += 1;
  }

  while (rightIndex < nextLines.length) {
    lines.push(`+${nextLines[rightIndex]}`);
    rightIndex += 1;
  }

  return lines;
}

function parseGenerateCliArgs(argv: string[]): GenerateCliOptions | "help" {
  const options: GenerateCliOptions = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";

    if (argument === "-h" || argument === "--help") {
      return "help";
    }

    if (argument === "--check") {
      options.check = true;
      continue;
    }

    if (argument === "--diff") {
      options.diff = true;
      continue;
    }

    if (argument === "--inspect") {
      options.inspect = true;
      continue;
    }

    if (argument === "--input" || argument === "--output" || argument === "--output-format") {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new UserError(`Missing value for ${JSON.stringify(argument)}.`);
      }

      assignOptionValue(options, argument, value);
      index += 1;
      continue;
    }

    if (argument.startsWith("--input=")) {
      assignOptionValue(options, "--input", argument.slice("--input=".length));
      continue;
    }

    if (argument.startsWith("--output=")) {
      assignOptionValue(options, "--output", argument.slice("--output=".length));
      continue;
    }

    if (argument.startsWith("--output-format=")) {
      assignOptionValue(options, "--output-format", argument.slice("--output-format=".length));
      continue;
    }

    throw new UserError(`Unknown argument ${JSON.stringify(argument)}.`);
  }

  return options;
}

function assignOptionValue(
  options: GenerateCliOptions,
  argument: "--input" | "--output" | "--output-format",
  value: string
): void {
  if (value.length === 0) {
    throw new UserError(`Missing value for ${JSON.stringify(argument)}.`);
  }

  if (argument === "--input") {
    options.input = value;
    return;
  }

  if (argument === "--output-format") {
    if (value !== "terminal" && value !== "markdown" && value !== "json") {
      throw new UserError(
        `Invalid value ${JSON.stringify(value)} for "--output-format". Expected terminal, markdown, or json.`
      );
    }
    options.outputFormat = value;
    return;
  }

  options.outputDir = value;
}

function createSpecSha(sourceText: string): string {
  return `sha256:${createHash("sha256").update(sourceText).digest("hex")}`;
}

function createDownloadedSpecFiles(input: string | URL, sourceText: string): GeneratedFile[] {
  const inputUrl = tryParseUrl(input);

  if (inputUrl === null || (inputUrl.protocol !== "http:" && inputUrl.protocol !== "https:")) {
    return [];
  }

  return [
    {
      path: getDownloadedSpecFileName(inputUrl),
      contents: sourceText
    }
  ];
}

function getDownloadedSpecFileName(inputUrl: URL): string {
  const basename = path.posix.basename(inputUrl.pathname);
  return basename.length > 0 ? basename : "openapi.json";
}

function tryParseUrl(input: string | URL): URL | null {
  if (input instanceof URL) {
    return input;
  }

  try {
    return new URL(input);
  } catch {
    return null;
  }
}

async function readGeneratedFiles(
  fs: Pick<GenerateCliFileSystem, "lstat" | "readdir" | "readFile">,
  directoryPath: string
): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  try {
    const directoryStats = await fs.lstat(directoryPath);

    if (directoryStats.isSymbolicLink()) {
      throw new Error("Generated output must remain inside the output directory.");
    }

    const entries = await fs.readdir(directoryPath);

    for (const entry of entries) {
      const entryPath = path.resolve(directoryPath, entry);
      const stats = await fs.lstat(entryPath);

      if (stats.isSymbolicLink()) {
        throw new Error("Generated output must remain inside the output directory.");
      }

      if (stats.isDirectory()) {
        for (const [nestedPath, nestedContents] of await readGeneratedFiles(fs, entryPath)) {
          files.set(nestedPath, nestedContents);
        }
        continue;
      }

      files.set(entryPath, await fs.readFile(entryPath, "utf8"));
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  return files;
}

function collectUpdatedFiles(
  currentFiles: ReadonlyMap<string, string>,
  desiredFiles: ReadonlyMap<string, string>
): UpdatedGeneratedFile[] {
  const updatedFiles: UpdatedGeneratedFile[] = [];

  for (const [filePath, contents] of desiredFiles) {
    const previousContents = currentFiles.get(filePath);
    if (previousContents === contents) {
      continue;
    }

    updatedFiles.push({ path: filePath, contents, previousContents });
  }

  return updatedFiles;
}

function collectDeletedFiles(
  currentFiles: ReadonlyMap<string, string>,
  desiredFiles: ReadonlyMap<string, string>
): string[] {
  const deletedFiles: string[] = [];

  for (const filePath of currentFiles.keys()) {
    if (desiredFiles.has(filePath)) {
      continue;
    }

    deletedFiles.push(filePath);
  }

  return deletedFiles;
}

async function writeGeneratedFiles(
  fs: Pick<
    GenerateCliFileSystem,
    "lstat" | "mkdir" | "realpath" | "rename" | "unlink" | "writeFile"
  >,
  outputDir: string,
  filesToWrite: ReadonlyArray<GeneratedFile>
): Promise<void> {
  for (const file of filesToWrite) {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await assertSafeOutputPath(fs, outputDir, file.path);
    await atomicWriteGeneratedFile(fs, outputDir, file.path, file.contents);
  }
}

async function assertSafeOutputPath(
  fs: Pick<GenerateCliFileSystem, "lstat" | "realpath">,
  outputDir: string,
  filePath: string
): Promise<void> {
  const canonicalOutputDir = await fs.realpath(outputDir);
  const canonicalFileParent = await fs.realpath(path.dirname(filePath));
  const relativeParentPath = path.relative(canonicalOutputDir, canonicalFileParent);

  if (
    relativeParentPath === ".." ||
    relativeParentPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeParentPath) ||
    canonicalOutputDir !== path.resolve(outputDir)
  ) {
    throw new Error("Generated output must remain inside the output directory.");
  }

  try {
    if ((await fs.lstat(filePath)).isSymbolicLink()) {
      throw new Error("Generated output must remain inside the output directory.");
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

async function atomicWriteGeneratedFile(
  fs: Pick<GenerateCliFileSystem, "lstat" | "realpath" | "rename" | "unlink" | "writeFile">,
  outputDir: string,
  filePath: string,
  contents: string
): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  );
  let tempCreated = false;

  try {
    await assertSafeOutputPath(fs, outputDir, tempPath);
    await fs.writeFile(tempPath, contents, { encoding: "utf8", flag: "wx" });
    tempCreated = true;
    await assertSafeOutputPath(fs, outputDir, filePath);
    await fs.rename(tempPath, filePath);
    tempCreated = false;
  } catch (error) {
    if (tempCreated || !isAlreadyExistsError(error)) {
      await fs.unlink(tempPath).catch(() => undefined);
    }

    throw error;
  }
}

async function deleteGeneratedFiles(
  fs: Pick<GenerateCliFileSystem, "lstat" | "realpath" | "rm">,
  outputDir: string,
  filePaths: ReadonlyArray<string>
): Promise<void> {
  for (const filePath of filePaths) {
    await assertSafeOutputPath(fs, outputDir, filePath);
    await fs.rm(filePath, { force: true });
  }
}

async function restoreGeneratedFiles(
  fs: Pick<
    GenerateCliFileSystem,
    "lstat" | "mkdir" | "realpath" | "rename" | "rm" | "unlink" | "writeFile"
  >,
  outputDir: string,
  currentFiles: ReadonlyMap<string, string>,
  updatedFiles: ReadonlyArray<GeneratedFile>,
  deletedFiles: ReadonlyArray<string>
): Promise<void> {
  for (const file of updatedFiles) {
    const previousContents = currentFiles.get(file.path);

    if (previousContents === undefined) {
      await assertSafeOutputPath(fs, outputDir, file.path);
      await fs.rm(file.path, { force: true });
      continue;
    }

    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await assertSafeOutputPath(fs, outputDir, file.path);
    await atomicWriteGeneratedFile(fs, outputDir, file.path, previousContents);
  }

  for (const filePath of deletedFiles) {
    const previousContents = currentFiles.get(filePath);

    if (previousContents === undefined) {
      continue;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await assertSafeOutputPath(fs, outputDir, filePath);
    await atomicWriteGeneratedFile(fs, outputDir, filePath, previousContents);
  }
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "ENOENT");
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}

function isDirectExecution(moduleUrl: string, argv: string[]): boolean {
  const entryPoint = argv[1];

  if (entryPoint === undefined) {
    return false;
  }

  try {
    return path.resolve(fileURLToPath(moduleUrl)) === realpathSync(path.resolve(entryPoint));
  } catch {
    return false;
  }
}

if (isDirectExecution(import.meta.url, process.argv)) {
  const exitCode = await runGenerateCli();

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
