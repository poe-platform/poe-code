import { shellValueFromBytes } from "../../../contracts/value.js";
import { createCommandArguments, toByteSource, type ByteSink } from "../../../contracts/index.js";
import { Budget, fail } from "../internal.js";
import { ZipFailure, zipPublicText } from "./options.js";
import type { ZipScope } from "./safety.js";

/** A literal argv grammar: spaces, quotes and backslash escapes, with no shell. */
export function parseZipTestCommand(value: string): readonly string[] {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let active = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if ("\n\r\0;|&<>$`".includes(character)) throw new ZipFailure(16, "Invalid command arguments", "unsupported virtual test-command syntax");
    if (character === "\\" && quote !== "'") {
      const next = value[++index];
      if (next === undefined || "\n\r\0;|&<>$`".includes(next)) throw new ZipFailure(16, "Invalid command arguments", "invalid test-command escape");
      word += next;
      active = true;
    } else if (quote) {
      if (character === quote) quote = ""; else word += character;
    } else if (character === "'" || character === '"') { quote = character; active = true; }
    else if (character === " " || character === "\t") {
      if (active) { words.push(word); word = ""; active = false; }
    } else { word += character; active = true; }
  }
  if (quote) throw new ZipFailure(16, "Invalid command arguments", "unterminated test-command quote");
  if (active) words.push(word);
  if (!words[0] || words[0].includes("{}")) throw new ZipFailure(16, "Invalid command arguments", "invalid virtual test command");
  return words;
}

export async function testZipCommand(scope: ZipScope, command: readonly string[] | undefined, path: string, budget: Budget, archive: string, quiet: boolean, password?: Uint8Array): Promise<void> {
  const { context, limits } = scope;
  let outputBytes = 0;
  const sink: ByteSink = { async write(chunk) {
    context.signal.throwIfAborted();
    if (chunk.length > limits.maxTextBytes - outputBytes) fail("ZIP test-command output limit exceeded");
    outputBytes += chunk.length;
  } };
  try {
    if (!context.invoke) fail("virtual command invocation unavailable");
    const virtualCommand = command ?? ["unzip", "-tqq"];
    const placeholders = virtualCommand.slice(1).some(word => word.includes("{}"));
    let argumentBytes = command === undefined && password !== undefined ? password.length + 4 : 0;
    for (const word of virtualCommand.slice(1)) {
      let placeholders = 0;
      for (let index = 0; index + 1 < word.length; index++) if (word[index] === "{" && word[index + 1] === "}") { placeholders++; index++; }
      const size = Buffer.byteLength(word) + placeholders * (Buffer.byteLength(path) - 2) + 1;
      if (size > limits.maxArgumentBytes - argumentBytes) fail("ZIP test-command argument byte limit exceeded");
      argumentBytes += size;
    }
    if (!placeholders && Buffer.byteLength(path) + 1 > limits.maxArgumentBytes - argumentBytes) fail("ZIP test-command argument byte limit exceeded");
    const args = virtualCommand.slice(1).map(word => word.split("{}").join(path));
    if (!placeholders) args.push(path);
    const values = createCommandArguments(command === undefined && password !== undefined ? ["-P", shellValueFromBytes(password), ...args] : args);
    const result = await scope.operation(() => context.invoke!(virtualCommand[0]!, values.args, {
      argumentValues: values,
      signal: context.signal, stdin: toByteSource(""), stdinIsDefault: true, stdout: sink, stderr: sink,
    }));
    if (result.exitCode !== 0) fail("ZIP virtual test command failed");
  } catch {
    context.signal.throwIfAborted();
    if (!quiet) await budget.output(`test of ${zipPublicText(archive)} FAILED\n`);
    throw new ZipFailure(8, "Zip file invalid, could not spawn unzip, or wrong unzip", "virtual test command failed; original files unmodified");
  }
  if (!quiet) await budget.output(`test of ${zipPublicText(archive)} OK\n`);
}
