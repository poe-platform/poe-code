import { InvalidTransitionError, type Task } from "@poe-code/task-list";
import type { Command, CommandNode, HandlerContext } from "../index.js";
import { UserError, resolveCommandSecrets } from "../index.js";
import { createEnv, createFs } from "../runtime/io.js";
import { ensureApprovalList } from "./approval-tasks.js";
import { resolveProvider } from "./gate.js";
import type { ApprovalPayload } from "./approval-tasks.js";
import type { HumanInLoopRuntimeOptions } from "./types.js";
import { createRuntimeLogger } from "../runtime-logging.js";

interface SerializedJsonResult {
  ok: true;
  value: unknown;
}

interface UnserializableJsonResult {
  ok: false;
}

const MAX_AVAILABLE_COMMAND_PATHS = 20;

export async function runApproval(
  approvalId: string,
  runtimeOptions: HumanInLoopRuntimeOptions,
  root: CommandNode<any>
): Promise<void> {
  const { tasks } = await ensureApprovalList(runtimeOptions);
  const task = await tasks.get(approvalId);

  if (task.state !== "pending") {
    return;
  }

  const approval = readApprovalPayload(task);
  const provider = resolveProvider(runtimeOptions);

  try {
    await tasks.fire(approvalId, "claim", {
      metadataPatch: {
        pid: process.pid
      }
    });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return;
    }

    throw error;
  }

  try {
    const approvalResult = await provider.requestApproval({
      message: approval.message,
      declineInputPrompt: approval.declineInputPrompt ?? undefined
    });

    if (approvalResult.outcome === "declined") {
      await tasks.fire(approvalId, "decline", {
        metadataPatch: {
          error: {
            reason: approvalResult.reason
          }
        }
      });
      return;
    }
  } catch (error) {
    await tasks.fire(approvalId, "fail", {
      metadataPatch: {
        error: errorMetadataFromUnknown(error)
      }
    });
    return;
  }

  await tasks.fire(approvalId, "start");

  try {
    const command = findCommand(root, approval.commandPath);
    const ctx = createHandlerContext(command, approval.params);
    const result = await command.handler(ctx);
    const serializedResult = serializeJsonResult(result);

    if (!serializedResult.ok) {
      await tasks.fire(approvalId, "fail", {
        metadataPatch: {
          error: {
            message: "result not JSON-serializable"
          }
        }
      });
      return;
    }

    await tasks.fire(approvalId, "succeed", {
      metadataPatch: {
        result: serializedResult.value
      }
    });
  } catch (error) {
    await tasks.fire(approvalId, "fail", {
      metadataPatch: {
        error: errorMetadataFromUnknown(error)
      }
    });
  }
}

function readApprovalPayload(task: Task): ApprovalPayload {
  const metadata = task.metadata;

  if (typeof metadata !== "object" || metadata === null) {
    throw new UserError(`Malformed approval metadata for "${task.qualifiedId}".`);
  }

  if (metadata.schemaVersion !== 1) {
    throw new UserError(`Malformed approval metadata for "${task.qualifiedId}".`);
  }

  if (
    typeof metadata.commandPath !== "string" ||
    typeof metadata.message !== "string" ||
    typeof metadata.params !== "object" ||
    metadata.params === null
  ) {
    throw new UserError(`Malformed approval metadata for "${task.qualifiedId}".`);
  }

  const declineInputPrompt =
    typeof metadata.declineInputPrompt === "string" || metadata.declineInputPrompt === null
      ? metadata.declineInputPrompt
      : undefined;

  return {
    approvalId: typeof metadata.approvalId === "string" ? metadata.approvalId : undefined,
    commandPath: metadata.commandPath,
    params: metadata.params as Record<string, unknown>,
    message: metadata.message,
    declineInputPrompt,
    enqueuedAt: typeof metadata.enqueuedAt === "string" ? metadata.enqueuedAt : undefined,
    pid: typeof metadata.pid === "number" || metadata.pid === null ? metadata.pid : undefined,
    result: metadata.result,
    error: metadata.error
  };
}

function findCommand(root: CommandNode<any>, commandPath: string): Command<any, any, any, any> {
  const pathSegments = commandPath.split(".").filter((segment) => segment.length > 0);
  const unknownCommandPathError = () =>
    new UserError(
      `Unknown approval command path "${commandPath}". ${formatAvailableApprovalCommandPaths(root)}`
    );

  if (pathSegments.length === 0) {
    throw unknownCommandPathError();
  }

  let current: CommandNode<any> = root;

  for (const segment of pathSegments) {
    if (current.kind !== "group") {
      throw unknownCommandPathError();
    }

    const next = current.children.find((child) => child.name === segment);

    if (next === undefined) {
      throw unknownCommandPathError();
    }

    current = next;
  }

  if (current.kind !== "command") {
    throw unknownCommandPathError();
  }

  return current;
}

function formatAvailableApprovalCommandPaths(root: CommandNode<any>): string {
  const paths = enumerateApprovalCommandPaths(root);
  const visiblePaths = paths.slice(0, MAX_AVAILABLE_COMMAND_PATHS);
  const remaining = paths.length - visiblePaths.length;
  const suffix = remaining > 0 ? `, … and ${remaining} more` : "";

  return `Available: ${visiblePaths.join(", ")}${suffix}.`;
}

function enumerateApprovalCommandPaths(root: CommandNode<any>): string[] {
  const paths: string[] = [];

  const visit = (node: CommandNode<any>, path: string[]): void => {
    if (node.kind === "command") {
      paths.push(path.join("."));
      return;
    }

    for (const child of getVisibleCliChildren(node)) {
      visit(child, [...path, child.name]);
    }
  };

  if (root.kind === "command") {
    visit(root, [root.name]);
    return paths.sort();
  }

  for (const child of getVisibleCliChildren(root)) {
    visit(child, [child.name]);
  }

  return paths.sort();
}

function isNodeVisibleInCli(node: CommandNode<any>): boolean {
  if (node.kind === "command") {
    return node.scope.includes("cli");
  }

  return (
    getVisibleCliChildren(node).length > 0 ||
    Boolean(node.default && node.default.scope.includes("cli")) ||
    node.scope === undefined ||
    node.scope.includes("cli")
  );
}

function getVisibleCliChildren(root: CommandNode<any>): CommandNode<any>[] {
  return root.kind === "group" ? root.children.filter(isNodeVisibleInCli) : [];
}

function createHandlerContext(
  command: Command<any, any, any, any>,
  params: Record<string, unknown>
): HandlerContext<any, any, any> {
  const diagnostics = createRuntimeLogger();
  return {
    params,
    secrets: resolveCommandSecrets(command),
    fetch: globalThis.fetch,
    fs: createFs(),
    env: createEnv(),
    diagnostics,
    progress(message: string): void {
      diagnostics.emit({ level: "info", message, category: "progress" });
    }
  };
}

function serializeJsonResult(value: unknown): SerializedJsonResult | UnserializableJsonResult {
  try {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      return {
        ok: false
      };
    }

    return {
      ok: true,
      value: JSON.parse(serialized) as unknown
    };
  } catch {
    return {
      ok: false
    };
  }
}

function errorMetadataFromUnknown(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "Error",
    message: String(error)
  };
}
