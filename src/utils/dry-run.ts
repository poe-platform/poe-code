import { Buffer } from "node:buffer";
import { createTwoFilesPatch } from "diff";
import chalk from "chalk";
import type { FileSystem } from "./file-system.js";

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
    };

export class DryRunRecorder {
  private operations: DryRunOperation[] = [];

  record(operation: DryRunOperation): void {
    this.operations.push(operation);
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
    async mkdir(
      path: string,
      options?: { recursive?: boolean }
    ): Promise<void> {
      recorder.record({ type: "mkdir", path, options });
    },
    async stat(path: string) {
      return base.stat(path);
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
  for (const operation of operations) {
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

function formatOperation(operation: DryRunOperation): string | string[] {
  switch (operation.type) {
    case "mkdir": {
      const recursiveFlag = operation.options?.recursive ? " -p" : "";
      const command = `mkdir${recursiveFlag} ${operation.path}`;
      return renderOperationCommand(command, chalk.cyan, "# ensure");
    }
    case "unlink":
      return renderOperationCommand(`rm ${operation.path}`, chalk.red, "# delete");
    case "rm": {
      const flags: string[] = [];
      if (operation.options?.recursive) {
        flags.push("-r");
      }
      if (operation.options?.force) {
        flags.push("-f");
      }
      const flagSuffix = flags.length > 0 ? ` ${flags.join(" ")}` : "";
      return renderOperationCommand(`rm${flagSuffix} ${operation.path}`, chalk.red, "# delete");
    }
    case "copyFile":
      return renderOperationCommand(
        `cp ${operation.from} ${operation.to}`,
        chalk.cyan,
        "# copy"
      );
    case "chmod": {
      const mode = operation.mode.toString(8);
      return renderOperationCommand(
        `chmod ${mode} ${operation.path}`,
        chalk.cyan,
        "# permissions"
      );
    }
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
  const command = `cat > ${path}`;
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
  const oldLabel = previousContent == null ? "/dev/null" : targetPath;
  const patch = createTwoFilesPatch(
    oldLabel,
    targetPath,
    previousContent ?? "",
    nextContent,
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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
