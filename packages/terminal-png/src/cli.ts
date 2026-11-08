import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { renderTerminalPng } from "./index.js";

interface CliWriter {
  write(chunk: string | Uint8Array): boolean;
}

interface CliOutput {
  stderr: CliWriter;
}

interface CliOptions {
  output: string;
  padding?: number;
  window: boolean;
}

const defaultOutput: CliOutput = {
  stderr: process.stderr
};

function parsePadding(value: string): number {
  if (!isDecimalInteger(value)) {
    throw new InvalidArgumentError("padding must be a non-negative decimal integer");
  }

  return Number.parseInt(value, 10);
}

function isDecimalInteger(value: string): boolean {
  if (value === "0") {
    return true;
  }

  if (value.length === 0 || value[0] === "0") {
    return false;
  }

  for (const char of value) {
    if (char < "0" || char > "9") {
      return false;
    }
  }

  return true;
}

function parseOutputPath(value: string): string {
  if (value.length === 0) {
    throw new InvalidArgumentError("output path must not be empty");
  }

  return value;
}

export async function main(
  args: string[] = process.argv.slice(2),
  output: CliOutput = defaultOutput
): Promise<number> {
  const program = new Command();

  program
    .name("terminal-png")
    .description("Render a PNG image from ANSI terminal output")
    .argument("<input>", "Path to the ANSI input file")
    .requiredOption("-o, --output <output>", "Path to the output PNG file", parseOutputPath)
    .option("--window", "Include terminal window chrome", true)
    .option("--no-window", "Exclude terminal window chrome")
    .option("--padding <n>", "Padding around terminal content", parsePadding)
    .action(async (input: string, options: CliOptions) => {
      const ansiText = await readFile(input, "utf8");
      await renderTerminalPng(ansiText, {
        output: options.output,
        padding: options.padding,
        window: options.window
      });
    });

  program.configureOutput({
    writeErr: (value) => {
      output.stderr.write(value);
    }
  });

  program.exitOverride();

  try {
    await program.parseAsync(args, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }

    const message = error instanceof Error ? error.message : String(error);
    output.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;

if (entryPoint === import.meta.url) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
