import { Budget, lint, run, type Diagnostic } from "@poe-code/safe-js/core";
import { defineCommand, type Group, type Scope, UserError } from "toolcraft";
import { S } from "toolcraft-schema";

import { getOwnErrorCode } from "./error-codes.js";
import { buildHostModules } from "./host-modules.js";
import type { CommandEntryList } from "./tree.js";

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
  root: Group<any>;
  sdk: Record<string, unknown>;
  entries?: CommandEntryList;
  budget?: ExecuteBudgetOptions;
  scope?: Scope[];
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
  source: S.String({
    description: "SafeJS source to execute.",
    minLength: 1,
    pattern: "\\S"
  })
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
  return getOwnErrorCode(error);
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function readStringProperty(error: unknown, name: "message" | "stack"): string | undefined {
  if (typeof error !== "object" || error === null || !hasOwnProperty(error, name)) {
    return undefined;
  }

  const value = error[name];
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

function toLintResult(error: unknown): ExecuteResult | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !hasOwnProperty(error, "kind") ||
    error.kind !== "ParseError" ||
    !hasOwnProperty(error, "message") ||
    typeof error.message !== "string" ||
    !hasOwnProperty(error, "filename") ||
    typeof error.filename !== "string" ||
    !hasOwnProperty(error, "line") ||
    typeof error.line !== "number" ||
    !hasOwnProperty(error, "column") ||
    typeof error.column !== "number" ||
    !hasOwnProperty(error, "span")
  ) {
    return undefined;
  }

  const parseError = error as {
    message: string;
    filename: string;
    line: number;
    column: number;
    span: Diagnostic["span"];
  };

  return {
    ok: false,
    kind: "lint",
    diagnostics: [
      {
        code: "AS001",
        severity: "error",
        message: parseError.message,
        filename: parseError.filename,
        line: parseError.line,
        column: parseError.column,
        span: parseError.span
      }
    ]
  };
}

export function makeExecuteCommand({
  root,
  sdk,
  entries,
  budget,
  scope = ["mcp", "sdk"],
  sink
}: ExecuteCommandOptions) {
  return defineCommand({
    name: "execute",
    description: "Execute SafeJS source against the available host commands.",
    scope,
    params: executeParams,
    handler: async ({ params }): Promise<ExecuteResult> => {
      if (params.source.trim().length === 0) {
        throw new UserError("source must not be empty or whitespace");
      }

      const { lintModules, modules } = await buildHostModules(root, sdk, entries);
      let diagnostics: Diagnostic[];

      try {
        diagnostics = lint(params.source, {
          modules: lintModules,
          filename: "<execute>"
        }).filter((diagnostic) => diagnostic.severity === "error");
      } catch (error) {
        const lintResult = toLintResult(error);
        if (lintResult !== undefined) {
          return lintResult;
        }

        throw error;
      }

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
