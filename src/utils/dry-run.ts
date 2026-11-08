import { Buffer } from "node:buffer";
import { basename } from "node:path";
import { createTwoFilesPatch } from "diff";
import chalk from "chalk";
import { isNotFound, pathExists } from "@poe-code/config-mutations";
import type { FileSystem } from "./file-system.js";

const REDACTED_PLACEHOLDER = "<redacted>";
const SENSITIVE_KEYS = [
  "apiKey",
  "api_key",
  "apiKeyHelper",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CUSTOM_POE_API_KEY",
  "POE_API_KEY",
  "experimental_bearer_token",
  "bearer_token",
  "access_token",
  "refresh_token",
  "secret",
  "token",
  "password"
];
const AUTH_FILE_SENSITIVE_KEYS = ["key"];
const SECRET_VALUE_PREFIXES = ["sk-poe-", "sk-ant-", "cfut_", "Bearer "];

export type DryRunOperation =
  | {
      type: "writeFile";
      path: string;
      nextContent: string;
      previousContent: string | null;
    }
  | {
      type: "mkdir";
      path: string;
      options?: { recursive?: boolean };
      existing?: boolean;
    }
  | {
      type: "unlink";
      path: string;
    }
  | {
      type: "rm";
      path: string;
      options?: { recursive?: boolean; force?: boolean };
    }
  | {
      type: "copyFile";
      from: string;
      to: string;
    }
  | {
      type: "chmod";
      path: string;
      mode: number;
    }
  | {
      type: "symlink";
      target: string;
      path: string;
    }
  | {
      type: "rename";
      from: string;
      to: string;
    };

export class DryRunRecorder {
  private operations: DryRunOperation[] = [];

  record(operation: DryRunOperation): void {
    this.operations.push(operation);
  }

  // Atomic writers stage content in a temp file and rename it over the target.
  // Pulling the staged write back out lets the rename re-record it against the
  // real target, so the preview diffs the delta instead of the whole file.
  takeStagedWrite(path: string): Extract<DryRunOperation, { type: "writeFile" }> | null {
    for (let index = this.operations.length - 1; index >= 0; index -= 1) {
      const operation = this.operations[index];
      if (operation.type === "writeFile" && operation.path === path) {
        this.operations.splice(index, 1);
        return operation;
      }
    }
    return null;
  }

  drain(): DryRunOperation[] {
    const snapshot = this.operations;
    this.operations = [];
    return snapshot;
  }
}

export function createDryRunFileSystem(
  base: FileSystem,
  recorder: DryRunRecorder
): FileSystem {
  const proxy: Partial<FileSystem> = {
    async readFile(path: string, encoding?: BufferEncoding): Promise<any> {
      if (encoding) {
        return base.readFile(path, encoding);
      }
      return base.readFile(path);
    },
    async writeFile(
      path: string,
      data: string | NodeJS.ArrayBufferView,
      options?: { encoding?: BufferEncoding }
    ): Promise<void> {
      const previousContent = await tryReadText(base, path);
      const nextContent = formatData(data, options?.encoding);
      recorder.record({
        type: "writeFile",
        path,
        nextContent,
        previousContent
      });
    },
    async symlink(target: string, path: string): Promise<void> {
      recorder.record({ type: "symlink", target, path });
    },
    async readlink(path: string): Promise<string> {
      return base.readlink(path);
    },
    async realpath(path: string): Promise<string> {
      return base.realpath(path);
    },
    async mkdir(
      path: string,
      options?: { recursive?: boolean }
    ): Promise<void> {
      recorder.record({
        type: "mkdir",
        path,
        options,
        // Matches how the mutation layer itself decides the mkdir is a no-op.
        existing: await pathExists(base, path)
      });
    },
    async stat(path: string) {
      return base.stat(path);
    },
    async lstat(path: string) {
      return base.lstat(path);
    },
    async rename(from: string, to: string): Promise<void> {
      const staged = recorder.takeStagedWrite(from);
      if (staged) {
        recorder.record({
          type: "writeFile",
          path: to,
          nextContent: staged.nextContent,
          previousContent: await tryReadText(base, to)
        });
        return;
      }
      recorder.record({ type: "rename", from, to });
    },
    async unlink(path: string): Promise<void> {
      recorder.record({ type: "unlink", path });
    },
    async readdir(path: string): Promise<string[]> {
      return base.readdir(path);
    }
  };

  if (typeof base.rm === "function") {
    proxy.rm = async (
      path: string,
      options?: { recursive?: boolean; force?: boolean }
    ): Promise<void> => {
      recorder.record({ type: "rm", path, options });
    };
  }

  if (typeof base.copyFile === "function") {
    proxy.copyFile = async (from: string, to: string) => {
      recorder.record({ type: "copyFile", from, to });
    };
  }

  if (typeof base.chmod === "function") {
    proxy.chmod = async (target: string, mode: number) => {
      recorder.record({ type: "chmod", path: target, mode });
    };
  }

  return proxy as FileSystem;
}

export function formatDryRunOperations(
  operations: DryRunOperation[]
): string[] {
  if (operations.length === 0) {
    return [chalk.dim("# no filesystem changes")];
  }

  const lines: string[] = [];
  for (const operation of coalesceWrites(operations)) {
    const formatted = formatOperation(operation);
    if (Array.isArray(formatted)) {
      if (formatted.length === 0) {
        continue;
      }
      const [first, ...rest] = formatted;
      const indented = rest.map((line) => `  ${line}`);
      lines.push([first, ...indented].join("\n"));
    } else {
      lines.push(formatted);
    }
  }
  return lines;
}

// A manifest may write the same target several times (e.g. transform then
// merge). Every write is staged against the same untouched baseline, so only
// the last content is the outcome: report one baseline-to-final change per path.
function coalesceWrites(operations: DryRunOperation[]): DryRunOperation[] {
  const result: DryRunOperation[] = [];
  const writeIndexByPath = new Map<string, number>();

  for (const operation of operations) {
    if (operation.type !== "writeFile") {
      result.push(operation);
      continue;
    }
    const existingIndex = writeIndexByPath.get(operation.path);
    if (existingIndex === undefined) {
      writeIndexByPath.set(operation.path, result.length);
      result.push(operation);
      continue;
    }
    const first = result[existingIndex] as Extract<DryRunOperation, { type: "writeFile" }>;
    result[existingIndex] = {
      ...first,
      nextContent: operation.nextContent
    };
  }

  return result;
}

function formatOperation(operation: DryRunOperation): string | string[] {
  switch (operation.type) {
    case "mkdir": {
      const recursiveFlag = operation.options?.recursive ? " -p" : "";
      const command = `mkdir${recursiveFlag} ${quoteShellArgument(operation.path)}`;
      if (operation.existing === true) {
        return renderOperationCommand(command, chalk.dim, "# exists");
      }
      return renderOperationCommand(command, chalk.cyan, "# ensure");
    }
    case "unlink":
      return renderOperationCommand(`rm ${quoteShellArgument(operation.path)}`, chalk.red, "# delete");
    case "rm": {
      const flags: string[] = [];
      if (operation.options?.recursive) {
        flags.push("-r");
      }
      if (operation.options?.force) {
        flags.push("-f");
      }
      const flagSuffix = flags.length > 0 ? ` ${flags.join(" ")}` : "";
      return renderOperationCommand(`rm${flagSuffix} ${quoteShellArgument(operation.path)}`, chalk.red, "# delete");
    }
    case "copyFile":
      return renderOperationCommand(
        `cp ${quoteShellArgument(operation.from)} ${quoteShellArgument(operation.to)}`,
        chalk.cyan,
        "# copy"
      );
    case "chmod": {
      const mode = operation.mode.toString(8);
      return renderOperationCommand(
        `chmod ${mode} ${quoteShellArgument(operation.path)}`,
        chalk.cyan,
        "# permissions"
      );
    }
    case "symlink":
      return renderOperationCommand(
        `ln -s ${quoteShellArgument(operation.target)} ${quoteShellArgument(operation.path)}`,
        chalk.cyan,
        "# symlink"
      );
    case "rename":
      return renderOperationCommand(
        `mv ${quoteShellArgument(operation.from)} ${quoteShellArgument(operation.to)}`,
        chalk.cyan,
        "# rename"
      );
    case "writeFile": {
      return renderWriteOperation(operation);
    }
    default: {
      const neverOp: never = operation;
      return chalk.dim(`# unknown ${(neverOp as any).type}`);
    }
  }
}

function renderOperationCommand(
  command: string,
  colorize: (value: string) => string,
  detail: string
): string {
  return `${colorize(command)} ${chalk.dim(detail)}`;
}

function quoteShellArgument(value: string): string {
  if (value.length > 0 && isBareShellArgument(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function isBareShellArgument(value: string): boolean {
  for (const char of value) {
    if (!isBareShellArgumentChar(char)) {
      return false;
    }
  }
  return true;
}

function isBareShellArgumentChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === "/" ||
    char === "." ||
    char === "_" ||
    char === "-" ||
    char === ":" ||
    char === "@" ||
    char === "%" ||
    char === "+" ||
    char === "=" ||
    char === ","
  );
}

function describeWriteChange(
  previous: string | null,
  next: string
): "create" | "update" | "noop" {
  if (previous == null) {
    return "create";
  }
  if (previous === next) {
    return "noop";
  }
  return "update";
}

function renderWriteCommand(
  path: string,
  change: "create" | "update" | "noop"
): string {
  const command = `cat > ${quoteShellArgument(path)}`;
  if (change === "create") {
    return renderOperationCommand(command, chalk.green, "# create");
  }
  if (change === "update") {
    return renderOperationCommand(command, chalk.yellow, "# update");
  }
  return renderOperationCommand(command, chalk.dim, "# no change");
}

function renderWriteOperation(
  operation: Extract<DryRunOperation, { type: "writeFile" }>
): string[] {
  const change = describeWriteChange(
    operation.previousContent,
    operation.nextContent
  );
  const lines: string[] = [renderWriteCommand(operation.path, change)];
  if (change === "noop") {
    return lines;
  }
  lines.push(
    ...renderUnifiedDiff(
      operation.path,
      operation.previousContent,
      operation.nextContent
    )
  );
  return lines;
}

export function renderUnifiedDiff(
  targetPath: string,
  previousContent: string | null,
  nextContent: string
): string[] {
  const sanitizedPrevious =
    previousContent == null
      ? null
      : redactContentForDiff(targetPath, previousContent);
  const sanitizedNext = redactContentForDiff(targetPath, nextContent);
  const oldLabel = previousContent == null ? "/dev/null" : targetPath;
  const patch = createTwoFilesPatch(
    oldLabel,
    targetPath,
    sanitizedPrevious ?? "",
    sanitizedNext,
    "",
    "",
    { context: 3 }
  );
  const diffLines = patch
    .split("\n")
    .filter((line: string) => line.length > 0);
  const lines: string[] = [];
  for (const line of diffLines) {
    if (line.startsWith("Index:") || line.startsWith("====")) {
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) {
      lines.push(chalk.dim(line.trimEnd()));
      continue;
    }
    if (line.startsWith("@@")) {
      lines.push(chalk.cyan(line));
      continue;
    }
    if (line.startsWith("+")) {
      lines.push(chalk.green(line[0] ?? "+") + line.slice(1));
      continue;
    }
    if (line.startsWith("-")) {
      lines.push(chalk.red(line[0] ?? "-") + line.slice(1));
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      lines.push(chalk.dim(line));
      continue;
    }
    lines.push(chalk.dim(line));
  }
  return lines;
}

function redactContentForDiff(targetPath: string, content: string): string {
  const keys = [...SENSITIVE_KEYS];
  if (basename(targetPath).toLowerCase() === "auth.json") {
    keys.push(...AUTH_FILE_SENSITIVE_KEYS);
  }
  return content
    .split("\n")
    .map((line) => redactLine(line, keys))
    .join("\n");
}

function redactLine(line: string, keys: string[]): string {
  let result = line;
  for (const key of keys) {
    result = redactKeyedValue(result, key);
  }
  return redactSecretValueTokens(result);
}

function redactApiKeyHelperValue(value: string): string {
  const echoIndex = value.indexOf("echo ");
  if (echoIndex >= 0) {
    const prefix = value.slice(0, echoIndex + "echo ".length);
    return `${prefix}${REDACTED_PLACEHOLDER}`;
  }
  return REDACTED_PLACEHOLDER;
}

function redactKeyedValue(line: string, key: string): string {
  const keyIndex = findKeyIndex(line, key);
  if (keyIndex === -1) {
    return line;
  }
  const separatorIndex = findSeparatorIndex(line, keyIndex + key.length);
  if (separatorIndex === -1) {
    return line;
  }
  const span = findValueSpan(line, separatorIndex + 1);
  if (span == null) {
    return line;
  }
  const currentValue = line.slice(span.start, span.end);
  const nextValue =
    key === "apiKeyHelper"
      ? redactApiKeyHelperValue(currentValue)
      : REDACTED_PLACEHOLDER;
  return `${line.slice(0, span.start)}${nextValue}${line.slice(span.end)}`;
}

function findKeyIndex(line: string, key: string): number {
  let searchFrom = 0;
  while (searchFrom <= line.length - key.length) {
    const keyIndex = line.indexOf(key, searchFrom);
    if (keyIndex === -1) {
      return -1;
    }
    const before = line.charAt(keyIndex - 1);
    const after = line.charAt(keyIndex + key.length);
    if (!isKeyNameChar(before) && !isKeyNameChar(after)) {
      return keyIndex;
    }
    searchFrom = keyIndex + 1;
  }
  return -1;
}

function isKeyNameChar(char: string): boolean {
  if (char.length === 0) {
    return false;
  }
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === "_" ||
    char === "-"
  );
}

function findSeparatorIndex(line: string, searchFrom: number): number {
  for (let index = searchFrom; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (char === ":" || char === "=") {
      return index;
    }
    if (char !== " " && char !== "\t" && char !== "\"" && char !== "'") {
      return -1;
    }
  }
  return -1;
}

function findValueSpan(
  line: string,
  searchFrom: number
): { start: number; end: number } | null {
  let start = searchFrom;
  while (start < line.length && isValuePaddingChar(line.charAt(start))) {
    start += 1;
  }
  if (start >= line.length) {
    return null;
  }
  const quote = line.charAt(start);
  if (quote === "\"" || quote === "'") {
    const end = line.indexOf(quote, start + 1);
    if (end === -1) {
      return null;
    }
    return { start: start + 1, end };
  }
  let end = line.length;
  while (end > start && isValuePaddingChar(line.charAt(end - 1))) {
    end -= 1;
  }
  if (end <= start) {
    return null;
  }
  return { start, end };
}

function isValuePaddingChar(char: string): boolean {
  return char === " " || char === "\t" || char === "\r" || char === ",";
}

function redactSecretValueTokens(line: string): string {
  let result = line;
  for (const prefix of SECRET_VALUE_PREFIXES) {
    let searchFrom = 0;
    while (true) {
      const start = result.indexOf(prefix, searchFrom);
      if (start === -1) {
        break;
      }
      let end = start + prefix.length;
      while (end < result.length && isSecretTokenChar(result.charAt(end))) {
        end += 1;
      }
      if (end === start + prefix.length) {
        searchFrom = end;
        continue;
      }
      result = `${result.slice(0, start)}${REDACTED_PLACEHOLDER}${result.slice(end)}`;
      searchFrom = start + REDACTED_PLACEHOLDER.length;
    }
  }
  return result;
}

function isSecretTokenChar(char: string): boolean {
  return isKeyNameChar(char) || char === "." || char === "~" || char === "+" || char === "/";
}

// Whether an operation would actually alter the filesystem, so a preview can
// tell the user that an already-configured agent needs no changes.
export function describesChange(operation: DryRunOperation): boolean {
  if (operation.type === "writeFile") {
    return operation.previousContent !== operation.nextContent;
  }
  if (operation.type === "mkdir") {
    return operation.existing !== true;
  }
  return true;
}

async function tryReadText(
  base: FileSystem,
  path: string
): Promise<string | null> {
  try {
    return await base.readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    return null;
  }
}

function formatData(
  data: string | NodeJS.ArrayBufferView,
  encoding: BufferEncoding = "utf8"
): string {
  if (typeof data === "string") {
    return data;
  }

  try {
    const buffer = bufferFromView(data);
    return buffer.toString(encoding);
  } catch {
    return `<binary data (${data.byteLength} bytes)>`;
  }
}

function bufferFromView(view: NodeJS.ArrayBufferView): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}
