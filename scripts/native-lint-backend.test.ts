import { createFsFromVolume, Volume } from "memfs";
import { expect, it, vi } from "vitest";
import { createNativeLintBackend } from "./native-lint-backend.mjs";

function fixture() {
  const fileSystem = createFsFromVolume(
    Volume.fromJSON({ "/repo/src/a.ts": "changed disk bytes" })
  );
  const subject = {
    filename: "/repo/src/a.ts",
    bytes: Buffer.from("export const value = 1;"),
    configuration: {
      languageOptions: {
        sourceType: "module",
        parser: { meta: { name: "typescript-eslint/parser" } }
      },
      rules: { "no-debugger": [2] }
    }
  };
  const confirm = vi.fn(async (source) => ({
    filePath: source.filename,
    messages: [],
    errorCount: 0,
    warningCount: 0,
    fatalErrorCount: 0
  }));
  const invoke = vi.fn(async (_args, options) => {
    const source = fileSystem.readFileSync(options.cwd + "/subjects/0/0.ts", "utf8");
    expect(source).toBe(subject.bytes.toString());
    return { status: 0, stdout: JSON.stringify({ number_of_files: 1, diagnostics: [] }) };
  });
  const backend = createNativeLintBackend({
    root: "/repo",
    fileSystem,
    confirm,
    invoke,
    catalogue: [{ scope: "eslint", value: "no-debugger" }]
  });
  return { backend, fileSystem, subject, confirm, invoke };
}
it("lints guarded byte snapshots and removes every disposable artifact", async () => {
  const state = fixture();
  const results = await state.backend.lint([state.subject]);
  expect(results[0]).toMatchObject({ filePath: state.subject.filename, errorCount: 0 });
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.fileSystem.readdirSync("/repo/out")).toEqual([]);
});
it("retains processors, type-aware parsers and unsupported rules on ESLint", () => {
  const state = fixture();
  expect(state.backend.admit(state.subject)).toBe(true);
  expect(
    state.backend.admit({
      ...state.subject,
      configuration: { ...state.subject.configuration, processor: {} }
    })
  ).toBe(false);
  expect(
    state.backend.admit({
      ...state.subject,
      configuration: {
        ...state.subject.configuration,
        languageOptions: {
          ...state.subject.configuration.languageOptions,
          parserOptions: { project: true }
        }
      }
    })
  ).toBe(false);
  expect(
    state.backend.admit({
      ...state.subject,
      configuration: { ...state.subject.configuration, rules: { "custom/rule": [2] } }
    })
  ).toBe(false);
});
it("confirms positive native diagnostics through ESLint with original bytes", async () => {
  const state = fixture();
  state.invoke.mockResolvedValueOnce({
    status: 1,
    stdout: JSON.stringify({
      number_of_files: 1,
      diagnostics: [{ filename: "subjects/0/0.ts", severity: "error" }]
    })
  });
  await state.backend.lint([state.subject]);
  expect(state.confirm).toHaveBeenCalledExactlyOnceWith(state.subject);
});
it.each(["invalid JSON", "wrong count", "foreign diagnostic", "execution failure"])(
  "falls back for the complete batch on %s",
  async (failure) => {
    const state = fixture();
    state.invoke.mockImplementationOnce(async () => {
      if (failure === "execution failure") throw new Error("unavailable");
      if (failure === "invalid JSON") return { status: 0, stdout: "broken" };
      return {
        status: 0,
        stdout: JSON.stringify({
          number_of_files: failure === "wrong count" ? 0 : 1,
          diagnostics: [{ filename: "../../foreign.ts" }]
        })
      };
    });
    await state.backend.lint([state.subject]);
    expect(state.confirm).toHaveBeenCalledExactlyOnceWith(state.subject);
    expect(state.fileSystem.readdirSync("/repo/out")).toEqual([]);
  }
);

it("uses module parser coverage for legacy octal syntax and keeps CommonJS on ESLint", () => {
  const state = fixture();
  const subject = {
    ...state.subject,
    configuration: { ...state.subject.configuration, rules: { "no-octal": [2] } }
  };
  expect(state.backend.admit(subject)).toBe(true);
  expect(state.backend.admit({ ...subject, filename: "/repo/src/a.cts" })).toBe(false);
});

it("keeps TypeScript scripts on ESLint when legacy octal coverage requires strict module parsing", () => {
  const state = fixture();
  const subject = {
    ...state.subject,
    bytes: Buffer.from("const value = 0123; console.log(value);"),
    configuration: { ...state.subject.configuration, rules: { "no-octal": [2] } }
  };
  expect(state.backend.admit(subject)).toBe(false);
});
