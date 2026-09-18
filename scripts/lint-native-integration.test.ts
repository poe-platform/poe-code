import { expect, it, vi } from "vitest";
import { lintRoot, model, root } from "./lint-eslint.fixtures.js";

it("batches guarded native subjects and retains ESLint fallback subjects", async () => {
  const state = model({
    "src/native.ts": "export const value = 1;",
    "src/fallback.js": "debugger;"
  });
  const lint = vi.fn(async (subjects) =>
    subjects.map((subject) => ({
      filePath: subject.filename,
      messages: [],
      errorCount: 0,
      warningCount: 0
    }))
  );
  const nativeBackend = { admit: (subject) => subject.filename.endsWith("native.ts"), lint };
  const result = await lintRoot({
    guard: state.guard,
    config: [...state.config, { files: ["**/*.js"], rules: { "no-debugger": "error" } }],
    receiptBinding: state.binding,
    nativeBackend
  });
  expect(result.complete).toBe(true);
  expect(lint).toHaveBeenCalledTimes(1);
  expect(lint.mock.calls[0][0]).toEqual([
    expect.objectContaining({
      filename: root + "/src/native.ts",
      bytes: Buffer.from("export const value = 1;")
    })
  ]);
  expect(result.errorCount).toBe(1);
});

it("fails closed when a native batch changes subject identity", async () => {
  const state = model({ "src/native.ts": "export {};" });
  const nativeBackend = {
    admit: (subject) => subject.filename.endsWith("native.ts"),
    lint: async () => [{ filePath: "/foreign.ts", messages: [], errorCount: 0, warningCount: 0 }]
  };
  const result = await lintRoot({
    guard: state.guard,
    config: state.config,
    receiptBinding: state.binding,
    nativeBackend
  });
  expect(result.exitCode).toBe(2);
  expect(result.complete).toBe(false);
});
