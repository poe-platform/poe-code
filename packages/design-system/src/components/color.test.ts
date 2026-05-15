import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { color, type Color } from "./color.js";

type ColorStyle = Exclude<keyof Color, "hex" | "rgb" | "bgHex" | "bgRgb">;

const originalForceColor = process.env.FORCE_COLOR;
const originalNoColor = process.env.NO_COLOR;
const originalTerm = process.env.TERM;
const originalIsTTY = process.stdout.isTTY;

function restoreColorEnv(): void {
  if (originalForceColor === undefined) {
    delete process.env.FORCE_COLOR;
  } else {
    process.env.FORCE_COLOR = originalForceColor;
  }
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }
  if (originalTerm === undefined) {
    delete process.env.TERM;
  } else {
    process.env.TERM = originalTerm;
  }
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: originalIsTTY
  });
}

function setIsTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value
  });
}

describe("color", () => {
  afterEach(() => {
    restoreColorEnv();
  });

  it.each([
    ["black", "\x1b[30m"],
    ["red", "\x1b[31m"],
    ["green", "\x1b[32m"],
    ["yellow", "\x1b[33m"],
    ["blue", "\x1b[34m"],
    ["magenta", "\x1b[35m"],
    ["cyan", "\x1b[36m"],
    ["white", "\x1b[37m"],
    ["gray", "\x1b[90m"],
    ["magentaBright", "\x1b[95m"],
    ["cyanBright", "\x1b[96m"]
  ] satisfies Array<[ColorStyle, string]>)(
    "emits the expected foreground sequence for %s",
    (style, open) => {
      process.env.FORCE_COLOR = "1";
      delete process.env.NO_COLOR;

      expect(color[style]("x")).toBe(`${open}x\x1b[0m`);
    }
  );

  it.each([
    ["bgRed", "\x1b[41m"],
    ["bgGreen", "\x1b[42m"],
    ["bgYellow", "\x1b[43m"],
    ["bgBlue", "\x1b[44m"],
    ["bgMagenta", "\x1b[45m"]
  ] satisfies Array<[ColorStyle, string]>)(
    "emits the expected background sequence for %s",
    (style, open) => {
      process.env.FORCE_COLOR = "1";
      delete process.env.NO_COLOR;

      expect(color[style]("x")).toBe(`${open}x\x1b[0m`);
    }
  );

  it.each([
    ["reset", "\x1b[0m"],
    ["bold", "\x1b[1m"],
    ["dim", "\x1b[2m"],
    ["italic", "\x1b[3m"],
    ["underline", "\x1b[4m"],
    ["inverse", "\x1b[7m"],
    ["strikethrough", "\x1b[9m"]
  ] satisfies Array<[ColorStyle, string]>)(
    "emits the expected modifier sequence for %s",
    (style, open) => {
      process.env.FORCE_COLOR = "1";
      delete process.env.NO_COLOR;

      expect(color[style]("x")).toBe(`${open}x\x1b[0m`);
    }
  );

  it("wraps chains with each open code and a single trailing reset", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    expect(color.red.bold.underline("x")).toBe("\x1b[31m\x1b[1m\x1b[4mx\x1b[0m");
  });

  it("returns raw text when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;

    expect(color.red.bold("hi")).toBe("hi");
    expect(color.red.bold("hi")).not.toContain("\u001b");
  });

  it("lets FORCE_COLOR override NO_COLOR", () => {
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "1";

    expect(color.red.bold("hi")).toBe("\x1b[31m\x1b[1mhi\x1b[0m");
  });

  it("forces color when FORCE_COLOR is set", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    setIsTTY(false);

    expect(color.green("ok")).toBe("\x1b[32mok\x1b[0m");
  });

  it("detects terminal color support from stdout and TERM", () => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm-256color";
    setIsTTY(true);

    expect(color.blue("ok")).toBe("\x1b[34mok\x1b[0m");
  });

  it("does not emit color for non-tty output without FORCE_COLOR", () => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm-256color";
    setIsTTY(false);

    expect(color.blue("ok")).toBe("ok");
  });

  it("supports truecolor foreground and background helpers", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    expect(color.hex("#ff8800")("x")).toBe("\x1b[38;2;255;136;0mx\x1b[0m");
    expect(color.rgb(255, 136, 0)("hi")).toBe("\x1b[38;2;255;136;0mhi\x1b[0m");
    expect(color.bgHex("#0000ff").white("hi")).toBe(
      "\x1b[48;2;0;0;255m\x1b[37mhi\x1b[0m"
    );
  });

  it("nests already-colored strings without stripping the inner reset", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    const inner = color.green("x");
    expect(color.red.bold(`a${inner}b`)).toBe(
      "\x1b[31m\x1b[1ma\x1b[32mx\x1b[0m\x1b[31m\x1b[1mb\x1b[0m"
    );
  });

  it("exports a callable color type", () => {
    expectTypeOf(color).toMatchTypeOf<Color>();
    expectTypeOf(color.red.bold).toMatchTypeOf<Color>();
    expect(color("plain")).toBe("plain");
  });
});
