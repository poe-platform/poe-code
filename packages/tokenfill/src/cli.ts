import { Command, CommanderError, InvalidArgumentError } from "commander";
import type { TiktokenEncoding } from "tiktoken";
import { tokenfill } from "./tokenfill.js";
import { DEFAULT_ENCODING } from "./tokenizer.js";

interface CliWriter {
  write(chunk: string | Uint8Array): boolean;
}

interface CliOutput {
  stdout: CliWriter;
  stderr: CliWriter;
}

interface CliOptions {
  json?: boolean;
  tokenizer?: string;
}

const defaultOutput: CliOutput = {
  stdout: process.stdout,
  stderr: process.stderr
};

function parseTokenCount(value: string): number {
  const isDecimalDigit = (character: string): boolean => {
    const code = character.charCodeAt(0);
    return code >= 48 && code <= 57;
  };
  const isCanonicalDecimal =
    value === "0" ||
    (value.length > 0 && value[0] !== "0" && Array.from(value).every(isDecimalDigit));

  if (!isCanonicalDecimal) {
    throw new InvalidArgumentError("count must be a non-negative decimal integer");
  }

  const tokenCount = Number(value);

  if (!Number.isSafeInteger(tokenCount) || tokenCount < 0) {
    throw new InvalidArgumentError("count must be a non-negative decimal integer");
  }

  return tokenCount;
}

function createTokenfillProgram(output: CliOutput): Command {
  const program = new Command();

  program
    .name("tokenfill")
    .description("Generate deterministic text with exact token counts")
    .argument("<count>", "Number of tokens to generate", parseTokenCount)
    .option("--json", "Output structured JSON to stdout")
    .option("--tokenizer <encoding>", `Tokenizer encoding (default: ${DEFAULT_ENCODING})`)
    .action((count: number, options: CliOptions) => {
      const encoding = (options.tokenizer ?? DEFAULT_ENCODING) as TiktokenEncoding;
      const result = tokenfill(count, { encoding });

      if (options.json) {
        output.stdout.write(
          `${JSON.stringify({
            text: result.text,
            stats: {
              requestedTokens: count,
              actualTokens: result.actualTokens,
              encoding
            }
          })}\n`
        );
        return;
      }

      output.stdout.write(result.text);
      output.stderr.write(`Generated ${result.actualTokens} tokens using ${encoding}\n`);
    });

  program.configureOutput({
    writeOut: (value) => {
      output.stdout.write(value);
    },
    writeErr: (value) => {
      output.stderr.write(value);
    }
  });

  return program;
}

export async function runCli(
  args: string[] = process.argv.slice(2),
  output: CliOutput = defaultOutput
): Promise<number> {
  const program = createTokenfillProgram(output);

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
