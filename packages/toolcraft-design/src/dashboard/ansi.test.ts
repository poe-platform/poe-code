import { describe, expect, it } from "vitest";
import { hasAnsi, parseAnsi } from "./ansi.js";

describe("parseAnsi", () => {
  it("returns a single empty line for an empty string", () => {
    expect(parseAnsi("")).toEqual([{ segments: [] }]);
  });

  it("returns a plain segment with base style when there are no escape codes", () => {
    expect(parseAnsi("hello", { fg: "magenta" })).toEqual([
      { segments: [{ text: "hello", style: { fg: "magenta" } }] }
    ]);
  });

  it("splits input on newlines into separate lines", () => {
    expect(parseAnsi("alpha\nbeta")).toEqual([
      { segments: [{ text: "alpha", style: {} }] },
      { segments: [{ text: "beta", style: {} }] }
    ]);
  });

  it("drops carriage returns", () => {
    expect(parseAnsi("alpha\r\nbeta")).toEqual([
      { segments: [{ text: "alpha", style: {} }] },
      { segments: [{ text: "beta", style: {} }] }
    ]);
  });

  it("overwrites visible text after a carriage return", () => {
    expect(parseAnsi("\u001b[32mloading 0%\rloading 100%\u001b[0m")).toEqual([
      { segments: [{ text: "loading 100%", style: { fg: "green" } }] }
    ]);
  });

  it("applies basic 16-color SGR codes", () => {
    const result = parseAnsi("\u001b[31mred\u001b[0m plain");
    expect(result).toEqual([
      {
        segments: [
          { text: "red", style: { fg: "red" } },
          { text: " plain", style: {} }
        ]
      }
    ]);
  });

  it("resets style to the base style on SGR 0", () => {
    const result = parseAnsi("\u001b[31mred\u001b[0mbase", { fg: "magenta" });
    expect(result).toEqual([
      {
        segments: [
          { text: "red", style: { fg: "red" } },
          { text: "base", style: { fg: "magenta" } }
        ]
      }
    ]);
  });

  it("handles bold and dim toggles", () => {
    const result = parseAnsi("\u001b[1mbold\u001b[22mplain\u001b[2mdim");
    expect(result).toEqual([
      {
        segments: [
          { text: "bold", style: { bold: true } },
          { text: "plain", style: {} },
          { text: "dim", style: { dim: true } }
        ]
      }
    ]);
  });

  it("conceals text until SGR conceal is reset", () => {
    const result = parseAnsi("\u001b[8mtoken=secret\u001b[28m shown");
    expect(result).toEqual([
      { segments: [{ text: "             shown", style: {} }] }
    ]);
  });

  it("preserves reverse video until SGR inverse is reset", () => {
    const result = parseAnsi("\u001b[7mSELECTED\u001b[27m plain");
    expect(result).toEqual([
      {
        segments: [
          { text: "SELECTED", style: { inverse: true } },
          { text: " plain", style: {} }
        ]
      }
    ]);
  });

  it("handles bright foreground colors via 90-97", () => {
    const result = parseAnsi("\u001b[93mbright");
    expect(result).toEqual([
      { segments: [{ text: "bright", style: { fg: "yellowBright" } }] }
    ]);
  });

  it("handles 24-bit truecolor via 38;2;R;G;B", () => {
    const result = parseAnsi("\u001b[38;2;255;128;0morange");
    expect(result).toEqual([
      { segments: [{ text: "orange", style: { fg: "#ff8000" } }] }
    ]);
  });

  it("handles 24-bit truecolor via colon-separated SGR parameters", () => {
    const result = parseAnsi("\u001b[38:2::255:0:0mred");
    expect(result).toEqual([
      { segments: [{ text: "red", style: { fg: "#ff0000" } }] }
    ]);
  });

  it("handles 256-color palette indexes in the cube range", () => {
    const result = parseAnsi("\u001b[38;5;196mred");
    expect(result).toEqual([
      { segments: [{ text: "red", style: { fg: "#ff0000" } }] }
    ]);
  });

  it("maps 256-color indexes 0-7 to named ANSI colors", () => {
    const result = parseAnsi("\u001b[38;5;2mgreen");
    expect(result).toEqual([
      { segments: [{ text: "green", style: { fg: "green" } }] }
    ]);
  });

  it("handles 256-color grayscale ramp", () => {
    const result = parseAnsi("\u001b[38;5;240mgray");
    expect(result[0]!.segments[0]!.style.fg).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("applies background colors", () => {
    const result = parseAnsi("\u001b[41;97mwarn");
    expect(result).toEqual([
      { segments: [{ text: "warn", style: { fg: "whiteBright", bg: "red" } }] }
    ]);
  });

  it("restores base fg on SGR 39", () => {
    const result = parseAnsi("\u001b[31mred\u001b[39mbase", { fg: "magenta" });
    expect(result).toEqual([
      {
        segments: [
          { text: "red", style: { fg: "red" } },
          { text: "base", style: { fg: "magenta" } }
        ]
      }
    ]);
  });

  it("removes fg on SGR 39 when there is no base fg", () => {
    const result = parseAnsi("\u001b[31mred\u001b[39mplain");
    expect(result).toEqual([
      {
        segments: [
          { text: "red", style: { fg: "red" } },
          { text: "plain", style: {} }
        ]
      }
    ]);
  });

  it("erases the current line for CSI 2 K", () => {
    const result = parseAnsi("before\u001b[2Kafter");
    expect(result).toEqual([
      { segments: [{ text: "      after", style: {} }] }
    ]);
  });

  it("applies backspace overstrikes to visible text", () => {
    expect(parseAnsi("ok\bX")).toEqual([
      { segments: [{ text: "oX", style: {} }] }
    ]);
  });

  it("discards OSC sequences terminated by BEL", () => {
    const result = parseAnsi("start\u001b]0;title\u0007end");
    expect(result).toEqual([
      { segments: [{ text: "startend", style: {} }] }
    ]);
  });

  it("discards non-rendering controls while applying backspace", () => {
    const result = parseAnsi("a\u0000b\u0008c\td");
    expect(result).toEqual([
      { segments: [{ text: "ac\td", style: {} }] }
    ]);
  });

  it("preserves style across line breaks", () => {
    const result = parseAnsi("\u001b[32mgreen\nstill green");
    expect(result).toEqual([
      { segments: [{ text: "green", style: { fg: "green" } }] },
      { segments: [{ text: "still green", style: { fg: "green" } }] }
    ]);
  });

  it("ignores unsupported SGR codes without dropping surrounding style", () => {
    const result = parseAnsi("\u001b[31;4munderlined\u001b[0mplain");
    expect(result).toEqual([
      {
        segments: [
          { text: "underlined", style: { fg: "red" } },
          { text: "plain", style: {} }
        ]
      }
    ]);
  });

  it("handles empty SGR params as a reset", () => {
    const result = parseAnsi("\u001b[31mred\u001b[mbase", { fg: "magenta" });
    expect(result).toEqual([
      {
        segments: [
          { text: "red", style: { fg: "red" } },
          { text: "base", style: { fg: "magenta" } }
        ]
      }
    ]);
  });
});

describe("hasAnsi", () => {
  it("returns true for strings containing escape codes", () => {
    expect(hasAnsi("\u001b[31mred")).toBe(true);
  });

  it("returns false for plain strings", () => {
    expect(hasAnsi("hello world")).toBe(false);
  });
});
