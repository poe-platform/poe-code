import { expect, it, vi } from "vitest";
import { createFormatInspectionCommand, inspectFormats } from "./index.js";
it("lists built-in and supplied directions, labels combined lists, and derives extension signs", () => {
  const reader = {
    format: "docx",
    read: async () => ({ blocks: [], metadata: {}, resources: [] })
  };
  expect(inspectFormats(["--list-input-formats", "--list-output-formats"], { reader })).toBe(
    "Input formats:\ncommonmark\ndocx\ngfm\nhtml\njson\nOutput formats:\njson\n"
  );
  expect(inspectFormats(["--list-extensions=gfm-task_lists"])).toBe(
    "+autolink_bare_uris\n+pipe_tables\n+raw_html\n+strikeout\n-task_lists\n"
  );
  expect(inspectFormats(["--list-extensions", "gfm"])).toContain("+task_lists\n");
  for (const args of [
    [],
    ["--list-extensions"],
    ["--list-input-formats", "input.md"],
    ["--list-extensions=gfm", "--list-output-formats"]
  ])
    expect(() => inspectFormats(args)).toThrowError(expect.objectContaining({ code: "E_OPTION" }));
});
it("thin safe-bash adapter awaits byte output and separates diagnostics", async () => {
  const stdout = { write: vi.fn(async (_bytes: Uint8Array) => {}) };
  const stderr = { write: vi.fn(async (_bytes: Uint8Array) => {}) };
  const command = createFormatInspectionCommand();
  const context = {
    args: ["--list-extensions=gfm"],
    stdout,
    stderr,
    signal: new AbortController().signal
  };
  expect(await command.execute(context)).toEqual({ exitCode: 0 });
  expect(new TextDecoder().decode(stdout.write.mock.calls[0]![0])).toContain("+pipe_tables");
  expect(stderr.write).not.toHaveBeenCalled();
  stdout.write.mockClear();
  expect(await command.execute({ ...context, args: ["--list-extensions=markdown"] })).toEqual({
    exitCode: 2
  });
  expect(stdout.write).not.toHaveBeenCalled();
  expect(new TextDecoder().decode(stderr.write.mock.calls[0]![0])).toContain("E_FORMAT:");
});
