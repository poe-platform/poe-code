import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createTerminalDriver } from "./driver.js";

class Input extends EventEmitter {
  raw: boolean[] = [];
  setRawMode(value: boolean): void { this.raw.push(value); }
  resume(): void {}
  pause(): void {}
}

class Output extends EventEmitter {
  columns = 100;
  rows = 30;
  writes: string[] = [];
  write(value: string): boolean { this.writes.push(value); return true; }
}

describe("createTerminalDriver", () => {
  it("composes input, output, resize, and full restoration", () => {
    vi.useFakeTimers();
    const input = new Input();
    const output = new Output();
    const driver = createTerminalDriver({ input, output });
    const events: unknown[] = [];
    const sizes: unknown[] = [];
    driver.onEvent(event => events.push(event));
    driver.onResize(size => sizes.push(size));
    driver.start();
    input.emit("data", Buffer.from("x\u001b"));
    vi.advanceTimersByTime(50);
    output.columns = 70;
    output.emit("resize");
    driver.writeFrame("frame");
    driver.stop();
    driver.stop();

    expect(events).toEqual([
      { type: "key", ch: "x", name: "x", ctrl: false, alt: false, shift: false },
      { type: "key", name: "escape", ctrl: false, alt: false, shift: false }
    ]);
    expect(sizes).toEqual([{ cols: 70, rows: 30 }]);
    expect(input.raw).toEqual([true, false]);
    expect(output.writes).toContain("\u001b[?2026hframe\u001b[?2026l");
    vi.useRealTimers();
  });
});
