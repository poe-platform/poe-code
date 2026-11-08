import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderTerminalPng } from "../src/index.js";

const NEW_OUTPUT_PATH = "/tmp/ts-compare-new.png";

interface CompareWriter {
  write(chunk: string | Uint8Array): boolean;
}

interface CompareOutput {
  stdout: CompareWriter;
  stderr: CompareWriter;
}

const defaultOutput: CompareOutput = {
  stdout: process.stdout,
  stderr: process.stderr
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function buildCommandPath(tempDir: string): string {
  const workspaceBin = path.resolve(SCRIPT_DIR, "../../../node_modules/.bin");
  const currentPath = process.env.PATH ?? "";
  const pathEntries = [tempDir, workspaceBin];

  if (currentPath) {
    pathEntries.push(currentPath);
  }

  return pathEntries.join(path.delimiter);
}

function escapeShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function createPoeCodeShim(tempDir: string): Promise<void> {
  const cliPath = path.resolve(SCRIPT_DIR, "../../../dist/bin.cjs");
  const shimPath = path.join(tempDir, "poe-code");
  const shimSource = `#!/bin/sh
exec ${escapeShellArgument(process.execPath)} ${escapeShellArgument(cliPath)} "$@"
`;

  await writeFile(shimPath, shimSource, "utf8");
  await chmod(shimPath, 0o755);
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(error);
    });

    child.once("close", (code) => {
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

async function capturePoeCodeHelp(tempDir: string): Promise<string> {
  const child = spawn("poe-code", ["--help"], {
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      PATH: buildCommandPath(tempDir)
    },
    stdio: ["ignore", "pipe", "inherit"]
  });

  if (!child.stdout) {
    throw new Error("Unable to capture poe-code help output");
  }

  const chunks: string[] = [];
  child.stdout.on("data", (chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
  });

  const exitCode = await waitForExit(child);

  if (exitCode !== 0) {
    throw new Error(`poe-code --help failed with exit code ${exitCode}`);
  }

  return chunks.join("");
}

export async function runCompare(output: CompareOutput = defaultOutput): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ts-compare-"));

  try {
    await createPoeCodeShim(tempDir);

    const ansiText = await capturePoeCodeHelp(tempDir);
    await renderTerminalPng(ansiText, {
      window: true,
      padding: 20,
      output: NEW_OUTPUT_PATH
    });

    output.stdout.write(`PNG: ${NEW_OUTPUT_PATH}\n`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (entryPoint === import.meta.url) {
  runCompare().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
