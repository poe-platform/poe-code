import { describe, expect, it } from "vitest";
import { formatDebugStack, trimStack } from "./stack-trim.js";

describe("trimStack", () => {
  it("keeps user frames and summarizes hidden toolcraft frames", () => {
    const stack = [
      "Error: outer",
      "    at userOne (/app/src/command.ts:10:5)",
      "    at userTwo (/app/src/main.ts:20:7)",
      "    at run (/app/node_modules/toolcraft/dist/cli.js:1:1)",
      "    at parse (/app/node_modules/commander/lib/command.js:2:2)",
      "    at schema (/app/node_modules/toolcraft-schema/dist/index.js:3:3)",
      "    at openapi (/app/node_modules/toolcraft-openapi/dist/index.js:4:4)",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)"
    ].join("\n");

    expect(trimStack(stack)).toBe(
      [
        "Error: outer",
        "    at userOne (/app/src/command.ts:10:5)",
        "    at userTwo (/app/src/main.ts:20:7)",
        "    … (5 framework / runtime frames hidden — pass --debug=raw to show)"
      ].join("\n")
    );
  });

  it("trims cause portions while preserving the cause header", () => {
    const stack = [
      "Error: outer",
      "    at outerUser (/app/src/outer.ts:10:5)",
      "    at run (/app/node_modules/toolcraft/dist/cli.js:1:1)",
      "[cause]: Error: inner",
      "    at innerUser (/app/src/inner.ts:20:7)",
      "    at parse (/app/node_modules/commander/lib/command.js:2:2)"
    ].join("\n");

    expect(trimStack(stack)).toBe(
      [
        "Error: outer",
        "    at outerUser (/app/src/outer.ts:10:5)",
        "    … (1 framework / runtime frame hidden — pass --debug=raw to show)",
        "[cause]: Error: inner",
        "    at innerUser (/app/src/inner.ts:20:7)",
        "    … (1 framework / runtime frame hidden — pass --debug=raw to show)"
      ].join("\n")
    );
  });

  it("hides source-mapped local toolcraft frames", () => {
    const stack = [
      "Error: outer",
      "    at userOne (/app/src/command.ts:10:5)",
      "    at runCLI (/app/packages/toolcraft/src/cli.ts:4294:3)"
    ].join("\n");

    expect(trimStack(stack)).toBe(
      [
        "Error: outer",
        "    at userOne (/app/src/command.ts:10:5)",
        "    … (1 framework / runtime frame hidden — pass --debug=raw to show)"
      ].join("\n")
    );
  });

  it("bypasses trimming for raw debug mode", () => {
    const stack = [
      "Error: outer",
      "    at userOne (/app/src/command.ts:10:5)",
      "    at run (/app/node_modules/toolcraft/dist/cli.js:1:1)"
    ].join("\n");

    expect(formatDebugStack(stack, "raw")).toBe(stack);
  });

  it("returns stacks without framework frames unchanged", () => {
    const stack = [
      "Error: outer",
      "    at userOne (/app/src/command.ts:10:5)",
      "    at userTwo (/app/src/main.ts:20:7)"
    ].join("\n");

    expect(trimStack(stack)).toBe(stack);
  });
});
