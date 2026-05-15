import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { color, type Color } from "./color.js";

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

  it("wraps chainable styles with chalk-compatible start codes and resets", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    expect(color.red.bold("hi")).toBe("\u001b[31m\u001b[1mhi\u001b[22m\u001b[39m");
  });

  it("keeps chain order left-to-right", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    expect(color.bold.red("hi")).toBe("\u001b[1m\u001b[31mhi\u001b[39m\u001b[22m");
  });

  it("returns raw text when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;

    expect(color.red.bold("hi")).toBe("hi");
    expect(color.red.bold("hi")).not.toContain("\u001b");
  });

  it("lets NO_COLOR disable color when FORCE_COLOR is also set", () => {
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "1";

    expect(color.red.bold("hi")).toBe("hi");
    expect(color.red.bold("hi")).not.toContain("\u001b");
  });

  it("forces color when FORCE_COLOR is set", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    setIsTTY(false);

    expect(color.green("ok")).toBe("\u001b[32mok\u001b[39m");
  });

  it("detects terminal color support from stdout and TERM", () => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm-256color";
    setIsTTY(true);

    expect(color.blue("ok")).toBe("\u001b[34mok\u001b[39m");
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

    expect(color.hex("#ff8800")("hi")).toBe("\u001b[38;2;255;136;0mhi\u001b[39m");
    expect(color.rgb(255, 136, 0)("hi")).toBe("\u001b[38;2;255;136;0mhi\u001b[39m");
    expect(color.bgHex("#0000ff").white("hi")).toBe(
      "\u001b[48;2;0;0;255m\u001b[37mhi\u001b[39m\u001b[49m"
    );
  });

  it("reopens styles around nested reset codes", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    expect(color.red(`a\u001b[39mb`)).toBe("\u001b[31ma\u001b[39m\u001b[31mb\u001b[39m");
  });

  it("does not reopen styles around generated closes that share a reset code", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    expect(color.bold.dim("hi")).toBe("\u001b[1m\u001b[2mhi\u001b[22m\u001b[22m");
  });

  it("exports a callable color type", () => {
    expectTypeOf(color).toMatchTypeOf<Color>();
    expectTypeOf(color.red.bold).toMatchTypeOf<Color>();
    expect(color("plain")).toBe("plain");
  });
});
