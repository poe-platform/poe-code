import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createTerminalDriver, parseKeypress } from "./terminal.js";

class TestStdin extends PassThrough {
  rawModes: boolean[] = [];
  resumeCount = 0;
  pauseCount = 0;

  setRawMode(mode: boolean): void {
    this.rawModes.push(mode);
  }

  override resume(): this {
    this.resumeCount += 1;
    return super.resume();
  }

  override pause(): this {
    this.pauseCount += 1;
    return super.pause();
  }
}

class TestStdout extends PassThrough {
  columns: number | undefined;
  rows: number | undefined;
  output = "";

  constructor(cols = 80, rows = 24) {
    super();
    this.columns = cols;
    this.rows = rows;
  }

  override write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void
  ): boolean {
    this.output += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    return super.write(chunk, encoding as never, callback);
  }
}

describe("parseKeypress", () => {
  it("parses printable characters into ch events", () => {
    expect(parseKeypress(Buffer.from("a"))).toEqual({
      ch: "a",
      ctrl: false,
      meta: false,
      shift: false
    });

    expect(parseKeypress(Buffer.from("A"))).toEqual({
      ch: "A",
      ctrl: false,
      meta: false,
      shift: true
    });
  });

  it("parses special navigation keys", () => {
    expect(parseKeypress(Buffer.from("\u001b[A"))).toEqual({
      name: "up",
      ctrl: false,
      meta: false,
      shift: false
    });

    expect(parseKeypress(Buffer.from("\u001b[5~"))).toEqual({
      name: "pageup",
      ctrl: false,
      meta: false,
      shift: false
    });

    expect(parseKeypress(Buffer.from("\u001b[6~"))).toEqual({
      name: "pagedown",
      ctrl: false,
      meta: false,
      shift: false
    });
  });

  it("parses modifier combinations", () => {
    expect(parseKeypress(Buffer.from("\u0003"))).toEqual({
      name: "c",
      ctrl: true,
      meta: false,
      shift: false
    });

    expect(parseKeypress(Buffer.from("\u001ba"))).toEqual({
      ch: "a",
      ctrl: false,
      meta: true,
      shift: false
    });

    expect(parseKeypress(Buffer.from("\u001bA"))).toEqual({
      ch: "A",
      ctrl: false,
      meta: true,
      shift: true
    });

    expect(parseKeypress(Buffer.from("\u001b[1;5A"))).toEqual({
      name: "up",
      ctrl: true,
      meta: false,
      shift: false
    });
  });

  it("parses a bare escape key", () => {
    expect(parseKeypress(Buffer.from("\u001b"))).toEqual({
      name: "escape",
      ctrl: false,
      meta: false,
      shift: false
    });
  });

  it("parses non-printable named keys", () => {
    expect(parseKeypress(Buffer.from("\r"))).toEqual({
      name: "return",
      ctrl: false,
      meta: false,
      shift: false
    });

    expect(parseKeypress(Buffer.from("\u001b[H"))).toEqual({
      name: "home",
      ctrl: false,
      meta: false,
      shift: false
    });

    expect(parseKeypress(Buffer.from("\u001b[F"))).toEqual({
      name: "end",
      ctrl: false,
      meta: false,
      shift: false
    });
  });
});

describe("createTerminalDriver", () => {
  it("writes escape sequences, flushes cells, and restores terminal state on destroy", () => {
    const stdin = new TestStdin();
    const stdout = new TestStdout(120, 42);
    const driver = createTerminalDriver({ stdin, stdout });

    expect(driver.getSize()).toEqual({ cols: 120, rows: 42 });

    driver.enterRawMode();
    driver.enterRawMode();
    driver.enterAltScreen();
    driver.enterAltScreen();
    driver.disableLineWrap();
    driver.disableLineWrap();
    driver.hideCursor();
    driver.hideCursor();
    driver.moveTo(-2.4, 1.9);
    driver.write("A");
    driver.flush([
      { x: 1, y: 0, cell: { ch: "B", style: {} } },
      { x: 2, y: 2, cell: { ch: "C", style: {} } }
    ]);

    expect(stdin.rawModes).toEqual([true]);
    expect(stdin.resumeCount).toBe(1);
    expect(stdout.output).toBe(
      "\u001b[?1049h\u001b[?7l\u001b[?25l\u001b[2;1HA\u001b[1;2HB\u001b[3;3HC"
    );

    driver.destroy();
    driver.destroy();

    expect(stdin.rawModes).toEqual([true, false]);
    expect(stdin.pauseCount).toBe(1);
    expect(stdout.output).toBe(
      "\u001b[?1049h\u001b[?7l\u001b[?25l\u001b[2;1HA\u001b[1;2HB\u001b[3;3HC\u001b[?7h\u001b[?1049l\u001b[?25h"
    );

    driver.write("ignored");
    driver.enterAltScreen();
    driver.disableLineWrap();
    driver.hideCursor();

    expect(stdout.output).toBe(
      "\u001b[?1049h\u001b[?7l\u001b[?25l\u001b[2;1HA\u001b[1;2HB\u001b[3;3HC\u001b[?7h\u001b[?1049l\u001b[?25h"
    );
  });

  it("treats repeated resize subscriptions for the same handler independently", () => {
    let count = 0;
    const handler = () => {
      count += 1;
    };

    const output = new TestStdout();
    const resizeDriver = createTerminalDriver({
      stdin: new TestStdin(),
      stdout: output
    });
    const offFirst = resizeDriver.onResize(handler);
    const offSecond = resizeDriver.onResize(handler);

    output.emit("resize");
    expect(count).toBe(2);

    offFirst();
    output.emit("resize");
    expect(count).toBe(3);

    offSecond();
    output.emit("resize");
    expect(count).toBe(3);

    resizeDriver.destroy();
  });

  it("treats repeated keypress subscriptions for the same handler independently", () => {
    const stdin = new TestStdin();
    const driver = createTerminalDriver({
      stdin,
      stdout: new TestStdout()
    });
    const received: Array<string | undefined> = [];
    const handler = (event: { ch?: string; name?: string }) => {
      received.push(event.ch ?? event.name);
    };

    const offFirst = driver.onKeypress(handler);
    const offSecond = driver.onKeypress(handler);

    stdin.emit("data", Buffer.from("a"));
    expect(received).toEqual(["a", "a"]);

    stdin.emit("data", Buffer.from("\u001b[B\u001b[Bq"));
    expect(received).toEqual(["a", "a", "down", "down", "q", "down", "down", "q"]);

    offFirst();
    stdin.emit("data", Buffer.from("b"));
    expect(received).toEqual(["a", "a", "down", "down", "q", "down", "down", "q", "b"]);

    offSecond();
    stdin.emit("data", Buffer.from("c"));
    expect(received).toEqual(["a", "a", "down", "down", "q", "down", "down", "q", "b"]);

    driver.destroy();
  });
});
