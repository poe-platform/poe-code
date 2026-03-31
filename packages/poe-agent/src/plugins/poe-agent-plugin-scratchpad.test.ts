import { describe, expect, it } from "bun:test";
import type { ToolContext } from "../runtime/types.js";
import scratchpad from "./poe-agent-plugin-scratchpad.js";

const toolContext: ToolContext = {
  fork: async () => ({ output: "unused", messages: [] }),
  spawn: async () => ({ output: "unused", messages: [] }),
  signal: new AbortController().signal,
};

describe("poe-agent-plugin-scratchpad", () => {
  it("roundtrips values between write_note and read_note", async () => {
    const plugin = scratchpad();

    const writeNote = plugin.tools?.find(tool => tool.name === "write_note");
    const readNote = plugin.tools?.find(tool => tool.name === "read_note");

    expect(await writeNote?.call({ key: "todo", value: "ship plugins" }, toolContext)).toBe(
      "Wrote 'todo'",
    );
    expect(await readNote?.call({ key: "todo" }, toolContext)).toBe("ship plugins");
  });

  it("returns default text for missing notes and supports overwriting notes", async () => {
    const plugin = scratchpad();

    const writeNote = plugin.tools?.find(tool => tool.name === "write_note");
    const readNote = plugin.tools?.find(tool => tool.name === "read_note");

    expect(await readNote?.call({ key: "missing" }, toolContext)).toBe("(no note)");

    expect(await writeNote?.call({ key: "todo", value: "draft docs" }, toolContext)).toBe(
      "Wrote 'todo'",
    );
    expect(await writeNote?.call({ key: "todo", value: "publish docs" }, toolContext)).toBe(
      "Wrote 'todo'",
    );
    expect(await readNote?.call({ key: "todo" }, toolContext)).toBe("publish docs");
  });

  it("keeps note state isolated per plugin instance", async () => {
    const first = scratchpad();
    const second = scratchpad();

    const firstWrite = first.tools?.find(tool => tool.name === "write_note");
    const firstRead = first.tools?.find(tool => tool.name === "read_note");
    const secondRead = second.tools?.find(tool => tool.name === "read_note");

    expect(await firstWrite?.call({ key: "project", value: "alpha" }, toolContext)).toBe(
      "Wrote 'project'",
    );
    expect(await firstRead?.call({ key: "project" }, toolContext)).toBe("alpha");
    expect(await secondRead?.call({ key: "project" }, toolContext)).toBe("(no note)");
  });
});
