import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createFrameWriter } from "./output.js";

class Output extends EventEmitter {
  writes: string[] = [];
  write(value: string): boolean {
    this.writes.push(value);
    return true;
  }
}

describe("createFrameWriter", () => {
  it("can leave mouse reporting disabled so terminal text remains selectable", () => {
    const writes: string[] = [];
    const writer = createFrameWriter(
      {
        write: (value) => {
          writes.push(value);
          return true;
        }
      },
      { mouse: false }
    );

    writer.open();
    writer.close();

    expect(writes.join("")).not.toContain("\u001b[?1000h");
    expect(writes.join("")).not.toContain("\u001b[?1006h");
    expect(writes.join("")).toContain("\u001b[?1000l");
    expect(writes.join("")).toContain("\u001b[?1006l");
  });
  it("opens and restores every terminal mode idempotently", () => {
    const output = new Output();
    const writer = createFrameWriter(output);
    writer.open();
    writer.open();
    writer.close();
    writer.close();
    expect(output.writes).toEqual([
      "\u001b[?1049h\u001b[?25l\u001b[?2004h\u001b[?1000h\u001b[?1006h\u001b[?7l",
      "\u001b[0m\u001b[?7h\u001b[?1006l\u001b[?1000l\u001b[?2004l\u001b[?25h\u001b[?1049l"
    ]);
  });

  it("writes each frame atomically inside a synchronized update", () => {
    const output = new Output();
    const writer = createFrameWriter(output);
    writer.open();
    writer.writeFrame("frame");
    expect(output.writes.at(-1)).toBe("\u001b[?2026hframe\u001b[?2026l");
    writer.close();
  });
});
