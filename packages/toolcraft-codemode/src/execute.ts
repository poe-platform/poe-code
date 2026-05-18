import { Budget, lint, run, type Diagnostic } from "@poe-code/agent-script";
import { defineCommand, type Group } from "toolcraft";
import { S } from "toolcraft-schema";

import { buildHostModules } from "./host-modules.js";

export type ExecuteBudgetOptions = {
  maxSteps?: number;
  deadline?: number | Date;
  maxCallDepth?: number;
  stringLength?: number;
  arrayLength?: number;
};

export type ExecuteSink = {
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
};

export type ExecuteCommandOptions = {
  root: Group;
  sdk: Record<string, unknown>;
  budget?: ExecuteBudgetOptions;
  sink?: ExecuteSink;
};

export type ExecuteRuntimeError = {
  message: string;
  code?: string;
  stack?: string;
};

export type ExecuteResult =
  | {
      ok: true;
      returnValue: unknown;
      stats: unknown;
    }
  | {
      ok: false;
      kind: "lint";
      diagnostics: Diagnostic[];
    }
  | {
      ok: false;
      kind: "runtime";
      error: ExecuteRuntimeError;
    };

const executeParams = S.Object({
  source: S.String({ description: "Agent-script source to execute." })
});

function createBudget(options: ExecuteBudgetOptions | undefined): Budget {
  return new Budget({
    maxSteps: options?.maxSteps,
    deadline: options?.deadline,
    maxCallDepth: options?.maxCallDepth,
    stringLength: options?.stringLength,
    arrayLength: options?.arrayLength
  });
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function readStringProperty(error: unknown, name: "message" | "stack"): string | undefined {
  if (typeof error !== "object" || error === null || !(name in error)) {
    return undefined;
  }

  const value = (error as Record<typeof name, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function toRuntimeError(error: unknown): ExecuteRuntimeError {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: readErrorCode(error),
      stack: error.stack
    };
  }

  const message = readStringProperty(error, "message");

  return {
    message: message ?? String(error),
    code: readErrorCode(error),
    stack: readStringProperty(error, "stack")
  };
}

function toResultError(error: {
  message: string;
  code?: string;
  stack?: string;
}): ExecuteRuntimeError {
  return {
    message: error.message,
    code: error.code,
    stack: error.stack
  };
}

export function makeExecuteCommand({ root, sdk, budget, sink }: ExecuteCommandOptions) {
  return defineCommand({
    name: "execute",
    description: "Execute agent-script source against the available host commands.",
    scope: ["mcp", "sdk"],
    params: executeParams,
    handler: async ({ params }): Promise<ExecuteResult> => {
      const { lintModules, modules } = await buildHostModules(root, sdk);
      const diagnostics = lint(params.source, {
        modules: lintModules,
        filename: "<execute>"
      }).filter((diagnostic) => diagnostic.severity === "error");

      if (diagnostics.length > 0) {
        return {
          ok: false,
          kind: "lint",
          diagnostics
        };
      }

      try {
        const result = await run(params.source, {
          modules,
          budget: createBudget(budget),
          ...(sink ? { sink } : {})
        });

        if (result.ok) {
          return {
            ok: true,
            returnValue: result.returnValue,
            stats: result.stats
          };
        }

        return {
          ok: false,
          kind: "runtime",
          error: toResultError(result.error)
        };
      } catch (error) {
        return {
          ok: false,
          kind: "runtime",
          error: toRuntimeError(error)
        };
      }
    }
  });
}
