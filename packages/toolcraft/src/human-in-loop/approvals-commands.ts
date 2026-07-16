import { TaskNotFoundError, type Task } from "@poe-code/task-list";
import { S } from "toolcraft-schema";
import type { CommandNode, Group, RenderPrimitives } from "../index.js";
import { hasOwnErrorCode } from "../error-codes.js";
import { UserError, defineCommand, defineGroup } from "../index.js";
import { ensureApprovalList } from "./approval-tasks.js";
import { approvalStateMachine, type ApprovalState } from "./state-machine.js";
import { runApproval } from "./runner.js";
import type { HumanInLoopRuntimeInstance } from "./runtime-options.js";

const approvalsGroupSymbol = Symbol("toolcraft.humanInLoop.approvalsBuiltIn");

interface ApprovalBuiltInServices {
  humanInLoop: HumanInLoopRuntimeInstance;
  root: CommandNode<any>;
}

const listScope = ["cli", "mcp", "sdk"] as const;
const runScope = ["cli"] as const;
const approvalStateValues = approvalStateMachine.states as readonly [ApprovalState, ...ApprovalState[]];
const listParams = S.Object({
  state: S.Optional(S.Array(S.Enum(approvalStateValues)))
});
const showParams = S.Object({
  approvalId: S.String()
});
const runParams = S.Object({
  approvalId: S.String()
});

export const approvalsGroup = markApprovalsBuiltIn(
  defineGroup<ApprovalBuiltInServices>({
    name: "approvals",
    description: "Inspect and execute queued approvals.",
    children: [
      defineCommand<
        ApprovalBuiltInServices,
        "list",
        typeof listParams,
        undefined,
        Task[],
        typeof listScope
      >({
        name: "list",
        description: "List queued approvals.",
        scope: listScope as unknown as ["cli", "mcp", "sdk"],
        params: listParams,
        handler: async ({ params, humanInLoop }) => {
          try {
            const { tasks } = await ensureApprovalList(humanInLoop.runtimeOptions, {
              create: false
            });
            return loadApprovals(tasks, params.state);
          } catch (error) {
            if (isMissingStateError(error)) {
              return [];
            }
            throw error;
          }
        },
        render: {
          rich: (result, primitives) => renderApprovalList(result, primitives),
          markdown: (result) => renderApprovalListMarkdown(result),
          json: (result) => result
        }
      }),
      defineCommand<
        ApprovalBuiltInServices,
        "show",
        typeof showParams,
        undefined,
        Task,
        typeof listScope
      >({
        name: "show",
        description: "Show one approval.",
        scope: listScope as unknown as ["cli", "mcp", "sdk"],
        params: showParams,
        handler: async ({ params, humanInLoop }) => {
          return withMissingApprovalError(params.approvalId, async () => {
            const { tasks } = await ensureApprovalList(humanInLoop.runtimeOptions, {
              create: false
            });
            return tasks.get(params.approvalId);
          });
        },
        render: {
          rich: (result, primitives) => renderApprovalDetails(result, primitives),
          markdown: (result) => renderApprovalDetailsMarkdown(result),
          json: (result) => result
        }
      }),
      defineCommand<
        ApprovalBuiltInServices,
        "run",
        typeof runParams,
        undefined,
        Task | void,
        typeof runScope
      >({
        name: "run",
        description: "Run one queued approval.",
        scope: runScope as unknown as ["cli"],
        params: runParams,
        handler: async ({ params, humanInLoop, root }) => {
          return withMissingApprovalError(params.approvalId, async () =>
            runApproval(params.approvalId, humanInLoop.runtimeOptions, root)
          );
        },
        render: {
          rich: (result, primitives) => {
            if (result) renderApprovalDetails(result, primitives);
          },
          markdown: (result) => result ? renderApprovalDetailsMarkdown(result) : "",
          json: (result) => result
        }
      })
    ]
  })
);

export function mergeApprovalsGroup<TServices extends object>(
  root: Group<TServices>
): Group<TServices> {
  const existing = root.children.find((child) => child.name === approvalsGroup.name);

  if (existing !== undefined) {
    if (isApprovalsBuiltIn(existing)) {
      return root;
    }

    throw new UserError("'approvals' is reserved for human-in-loop built-ins");
  }

  return {
    ...root,
    children: [...root.children, approvalsGroup as unknown as CommandNode<TServices>]
  };
}

function markApprovalsBuiltIn<TGroup extends Group<any>>(group: TGroup): TGroup {
  Object.defineProperty(group, approvalsGroupSymbol, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });

  return group;
}

function isApprovalsBuiltIn(node: CommandNode<any>): boolean {
  return (
    node.kind === "group" &&
    (node as Group<any> & { [approvalsGroupSymbol]?: true })[approvalsGroupSymbol] === true
  );
}

async function loadApprovals(
  tasks: Awaited<ReturnType<typeof ensureApprovalList>>["tasks"],
  states: readonly ApprovalState[] = []
): Promise<Task[]> {
  if (states.length === 0) {
    return tasks.all();
  }

  const seenIds = new Set<string>();
  const approvals: Task[] = [];

  for (const state of states) {
    const matching = await tasks.all({
      state
    });

    for (const task of matching) {
      if (seenIds.has(task.qualifiedId)) {
        continue;
      }

      seenIds.add(task.qualifiedId);
      approvals.push(task);
    }
  }

  return approvals;
}

function renderApprovalList(
  result: Task[],
  { logger, renderTable, getTheme }: RenderPrimitives
): void {
  if (result.length === 0) {
    logger.message("No approvals found.");
    return;
  }

  logger.message(
    renderTable({
      theme: getTheme(),
      columns: [
        { name: "id", title: "ID", alignment: "left", maxLen: 24 },
        { name: "state", title: "State", alignment: "left", maxLen: 18 },
        { name: "name", title: "Name", alignment: "left", maxLen: 60 }
      ],
      rows: result.map((task) => ({
        id: task.id,
        state: task.state,
        name: task.name
      }))
    })
  );
}

function renderApprovalListMarkdown(result: Task[]): string {
  if (result.length === 0) {
    return "No approvals found.";
  }

  const lines = ["| ID | State | Name |", "| :--- | :--- | :--- |"];

  for (const task of result) {
    lines.push(
      `| ${escapeMarkdownCell(task.id)} | ${escapeMarkdownCell(task.state)} | ${escapeMarkdownCell(task.name)} |`
    );
  }

  return lines.join("\n");
}

function renderApprovalDetails(
  result: Task,
  { logger, renderTable, getTheme }: RenderPrimitives
): void {
  logger.message(
    renderTable({
      theme: getTheme(),
      columns: [
        { name: "key", title: "Key", alignment: "left", maxLen: 18 },
        { name: "value", title: "Value", alignment: "left", maxLen: 80 }
      ],
      rows: Object.entries(taskToRecord(result)).map(([key, value]) => ({
        key,
        value: stringifyValue(value)
      }))
    })
  );
}

function renderApprovalDetailsMarkdown(result: Task): string {
  return Object.entries(taskToRecord(result))
    .map(([key, value]) => `- ${key}: ${stringifyValue(value)}`)
    .join("\n");
}

function taskToRecord(task: Task): Record<string, unknown> {
  return {
    list: task.list,
    id: task.id,
    qualifiedId: task.qualifiedId,
    name: task.name,
    state: task.state,
    description: task.description,
    metadata: task.metadata
  };
}

function stringifyValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|");
}

async function withMissingApprovalError<T>(approvalId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TaskNotFoundError || isMissingStateError(error)) {
      throw new UserError(
        `Approval "${approvalId}" not found. Run approvals list to see queued approvals.`
      );
    }

    throw error;
  }
}

function isMissingStateError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "ENOENT");
}
