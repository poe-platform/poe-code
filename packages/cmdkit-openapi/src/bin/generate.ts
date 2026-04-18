#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { UserError } from "@poe-code/cmdkit";
import { generate, type OpenApiDocument, type GeneratedFile } from "../generate.js";
import { readOpenApiLock, writeOpenApiLock } from "../lock.js";

interface GenerateCliFileSystem {
  mkdir(directoryPath: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  readdir(directoryPath: string): Promise<string[]>;
  rm(targetPath: string, options?: { force?: boolean }): Promise<void>;
  stat(targetPath: string): Promise<{ isDirectory(): boolean }>;
  writeFile(filePath: string, contents: string, encoding: BufferEncoding): Promise<void>;
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
  input: string;
  lockPath: string;
  outputDir: string;
}

interface SyncGeneratedClientResult {
  deletedFileCount: number;
  drifted: boolean;
  specSha: string;
  updatedFileCount: number;
}

const DEFAULT_OPTIONS: GenerateCliOptions = {
  check: false,
  input: "openapi.json",
  lockPath: "openapi.lock",
  outputDir: "src/generated"
};

const HELP_TEXT = `Usage: cmdkit-openapi-generate [options]

Options:
  --input <path-or-url>  OpenAPI document to read (default: openapi.json)
  --output <dir>         Directory for generated command files (default: src/generated)
  --lock <path>          Lock file path (default: openapi.lock)
  --check                Exit non-zero if generated output or lock file would change
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

    const result = await syncGeneratedClient(parsed, services);

    if (parsed.check) {
      if (result.drifted) {
        services.stderr.write(
          `OpenAPI output is out of date for ${parsed.outputDir}. Run the generator without --check to update it.\n`
        );
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

    throw error;
  }
}

export async function syncGeneratedClient(
  options: GenerateCliOptions,
  services: Pick<GenerateCliServices, "cwd" | "fetch" | "fs">
): Promise<SyncGeneratedClientResult> {
  const sourceText = await readSpecSource(options.input, services);
  const specSha = createSpecSha(sourceText);
  const document = parseDocument(sourceText, options.input);
  const generatedFiles = generate(document, { specSha });
  const outputDir = path.resolve(services.cwd, options.outputDir);
  const lockPath = path.resolve(services.cwd, options.lockPath);
  const currentLock = await readOpenApiLock(services.fs, lockPath);
  const currentFiles = await readGeneratedFiles(services.fs, outputDir);
  const desiredFiles = new Map(
    generatedFiles.map((file) => [path.resolve(outputDir, file.path), file.contents] as const)
  );
  const updatedFiles = collectUpdatedFiles(currentFiles, desiredFiles);
  const deletedFiles = collectDeletedFiles(currentFiles, desiredFiles);
  const drifted =
    currentLock?.specSha !== specSha || updatedFiles.length > 0 || deletedFiles.length > 0;

  if (!options.check && drifted) {
    await writeGeneratedFiles(services.fs, updatedFiles);
    await deleteGeneratedFiles(services.fs, deletedFiles);
    await writeOpenApiLock(services.fs, lockPath, { specSha });
  }

  return {
    drifted,
    specSha,
    updatedFileCount: updatedFiles.length,
    deletedFileCount: deletedFiles.length
  };
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

    if (argument === "--input" || argument === "--output" || argument === "--lock") {
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

    if (argument.startsWith("--lock=")) {
      assignOptionValue(options, "--lock", argument.slice("--lock=".length));
      continue;
    }

    throw new UserError(`Unknown argument ${JSON.stringify(argument)}.`);
  }

  return options;
}

function assignOptionValue(
  options: GenerateCliOptions,
  argument: "--input" | "--output" | "--lock",
  value: string
): void {
  if (value.length === 0) {
    throw new UserError(`Missing value for ${JSON.stringify(argument)}.`);
  }

  if (argument === "--input") {
    options.input = value;
    return;
  }

  if (argument === "--output") {
    options.outputDir = value;
    return;
  }

  options.lockPath = value;
}

async function readSpecSource(
  input: string,
  services: Pick<GenerateCliServices, "cwd" | "fetch" | "fs">
): Promise<string> {
  const inputUrl = tryParseUrl(input);

  try {
    if (inputUrl === null) {
      return await services.fs.readFile(path.resolve(services.cwd, input), "utf8");
    }

    if (inputUrl.protocol === "file:") {
      return await services.fs.readFile(fileURLToPath(inputUrl), "utf8");
    }

    if (inputUrl.protocol !== "http:" && inputUrl.protocol !== "https:") {
      throw new UserError(`Unsupported OpenAPI input URL protocol ${JSON.stringify(inputUrl.protocol)}.`);
    }

    const response = await services.fetch(inputUrl.toString());

    if (!response.ok) {
      throw new UserError(
        `Failed to fetch ${JSON.stringify(inputUrl.toString())}: ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  } catch (error) {
    if (error instanceof UserError) {
      throw error;
    }

    throw new UserError(
      `Failed to read OpenAPI document ${JSON.stringify(input)}: ${getErrorMessage(error)}`
    );
  }
}

function parseDocument(sourceText: string, input: string): OpenApiDocument {
  let parsed: unknown;

  try {
    parsed = parseYaml(sourceText);
  } catch (error) {
    throw new UserError(
      `Failed to parse OpenAPI document ${JSON.stringify(input)}: ${getErrorMessage(error)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UserError(
      `OpenAPI document ${JSON.stringify(input)} must parse to an object.`
    );
  }

  return parsed as OpenApiDocument;
}

function createSpecSha(sourceText: string): string {
  return `sha256:${createHash("sha256").update(sourceText).digest("hex")}`;
}

async function readGeneratedFiles(
  fs: Pick<GenerateCliFileSystem, "readdir" | "readFile" | "stat">,
  directoryPath: string
): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  try {
    const entries = await fs.readdir(directoryPath);

    for (const entry of entries) {
      const entryPath = path.resolve(directoryPath, entry);
      const stats = await fs.stat(entryPath);

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
): GeneratedFile[] {
  const updatedFiles: GeneratedFile[] = [];

  for (const [filePath, contents] of desiredFiles) {
    if (currentFiles.get(filePath) === contents) {
      continue;
    }

    updatedFiles.push({ path: filePath, contents });
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
  fs: Pick<GenerateCliFileSystem, "mkdir" | "writeFile">,
  filesToWrite: ReadonlyArray<GeneratedFile>
): Promise<void> {
  for (const file of filesToWrite) {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.contents, "utf8");
  }
}

async function deleteGeneratedFiles(
  fs: Pick<GenerateCliFileSystem, "rm">,
  filePaths: ReadonlyArray<string>
): Promise<void> {
  for (const filePath of filePaths) {
    await fs.rm(filePath, { force: true });
  }
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isDirectExecution(moduleUrl: string, argv: string[]): boolean {
  const entryPoint = argv[1];

  if (entryPoint === undefined) {
    return false;
  }

  return path.resolve(fileURLToPath(moduleUrl)) === path.resolve(entryPoint);
}

if (isDirectExecution(import.meta.url, process.argv)) {
  const exitCode = await runGenerateCli();

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
