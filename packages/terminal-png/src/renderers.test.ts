import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnsi, type StyledRun } from "./ansi-parser.js";
import {
  FONT_FACE_CSS,
  JETBRAINS_MONO_BASE64,
  JETBRAINS_MONO_FONT_FILES,
  JETBRAINS_MONO_TTF_PATH
} from "./font.js";
import { renderPng } from "./png-renderer.js";
import { renderSvg } from "./svg-renderer.js";

describe("parseAnsi", () => {
  function createRun(text: string, overrides: Partial<StyledRun> = {}): StyledRun {
    return {
      text,
      fg: null,
      bg: null,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      dim: false,
      inverse: false,
      conceal: false,
      ...overrides
    };
  }

  it("returns a single run for plain text", () => {
    expect(parseAnsi("hello")).toEqual([createRun("hello")]);
  });

  it("parses bold text", () => {
    expect(parseAnsi("\u001b[1mhello")).toEqual([createRun("hello", { bold: true })]);
  });

  it("parses ansi4 foreground colors", () => {
    expect(parseAnsi("\u001b[31mhello")).toEqual([
      createRun("hello", { fg: { type: "ansi4", index: 1 } })
    ]);
  });

  it("parses ansi8 foreground colors", () => {
    expect(parseAnsi("\u001b[38;5;201mhello")).toEqual([
      createRun("hello", { fg: { type: "ansi8", index: 201 } })
    ]);
  });

  it("parses rgb foreground colors", () => {
    expect(parseAnsi("\u001b[38;2;12;34;56mhello")).toEqual([
      createRun("hello", { fg: { type: "rgb", r: 12, g: 34, b: 56 } })
    ]);
  });

  it("parses background colors", () => {
    expect(parseAnsi("\u001b[48;5;42mhello")).toEqual([
      createRun("hello", { bg: { type: "ansi8", index: 42 } })
    ]);
  });

  it("handles nested style changes and reset", () => {
    expect(parseAnsi("a\u001b[1mb\u001b[31mc\u001b[0md")).toEqual([
      createRun("a"),
      createRun("b", { bold: true }),
      createRun("c", { fg: { type: "ansi4", index: 1 }, bold: true }),
      createRun("d")
    ]);
  });

  it("represents newlines as styled runs", () => {
    expect(parseAnsi("a\n\u001b[1mb\nc")).toEqual([
      createRun("a"),
      createRun("\n"),
      createRun("b", { bold: true }),
      createRun("\n", { bold: true }),
      createRun("c", { bold: true })
    ]);
  });

  it("resets individual styles and colors without a full sgr reset", () => {
    expect(parseAnsi("\u001b[35m\u001b[1mhead\u001b[39m\u001b[22m body")).toEqual([
      createRun("head", { fg: { type: "ansi4", index: 5 }, bold: true }),
      createRun(" body")
    ]);
  });

  it("parses strikethrough and clears it with sgr 29", () => {
    expect(parseAnsi("a\u001b[9mb\u001b[29mc")).toEqual([
      createRun("a"),
      createRun("b", { strikethrough: true }),
      createRun("c")
    ]);
  });

  it("parses inverse and conceal style toggles", () => {
    expect(parseAnsi("\u001b[7mselected\u001b[27m \u001b[8msecret\u001b[28mshown")).toEqual([
      createRun("selected", { inverse: true }),
      createRun(" "),
      createRun("secret", { conceal: true }),
      createRun("shown")
    ]);
  });

  it("parses colon-delimited rgb colors", () => {
    expect(parseAnsi("\u001b[38:2::12:34:56mhello")).toEqual([
      createRun("hello", { fg: { type: "rgb", r: 12, g: 34, b: 56 } })
    ]);
  });

  it("treats empty sgr parameters as reset", () => {
    expect(parseAnsi("\u001b[31mred\u001b[;m plain")).toEqual([
      createRun("red", { fg: { type: "ansi4", index: 1 } }),
      createRun(" plain")
    ]);
  });

  it("ignores incomplete rgb parameters instead of applying channel styles", () => {
    expect(parseAnsi("\u001b[38;2;1;2mX")).toEqual([createRun("X")]);
  });

  it("applies horizontal cursor repositioning before later output", () => {
    expect(parseAnsi("ready\u001b[1GFAIL")).toEqual([createRun("FAILy")]);
  });

  it("overwrites a previous cell after backspace", () => {
    expect(parseAnsi("PASS\bF")).toEqual([createRun("PASF")]);
  });

  it("recognizes C1 CSI styling controls", () => {
    expect(parseAnsi("\u009b31mRED\u009b0m")).toEqual([
      createRun("RED", { fg: { type: "ansi4", index: 1 } })
    ]);
  });

  it("renders carriage return updates as overwritten terminal cells", () => {
    expect(parseAnsi("loading 0%\rloading 100%\n")).toEqual([
      createRun("loading 100%"),
      createRun("\n")
    ]);
  });

  it("consumes OSC hyperlink metadata while retaining the label", () => {
    expect(parseAnsi("\u001b]8;;https://secret.example/token\u0007click\u001b]8;;\u0007")).toEqual([
      createRun("click")
    ]);
  });

  it("moves vertically for a vertical tab without rendering its control byte", () => {
    expect(parseAnsi("A\vB")).toEqual([createRun("A"), createRun("\n"), createRun(" B")]);
  });

  it("handles cursor next and previous line controls", () => {
    expect(
      parseAnsi("top\u001b[1Ebottom")
        .map((run) => run.text)
        .join("")
    ).toBe("top\nbottom");
    expect(
      parseAnsi("one\ntwo\u001b[1Ftop")
        .map((run) => run.text)
        .join("")
    ).toBe("top\ntwo");
  });

  it("clears stale line cells for erase-in-line controls", () => {
    expect(
      parseAnsi("loading\r\u001b[2Kdone")
        .map((run) => run.text)
        .join("")
    ).toBe("done");
    expect(
      parseAnsi("loading\r\u001b[Kdone")
        .map((run) => run.text)
        .join("")
    ).toBe("done");
  });

  it("clears stale display cells for erase-in-display controls", () => {
    expect(
      parseAnsi("old line\nsecond\u001b[2J\u001b[Hnew")
        .map((run) => run.text)
        .join("")
    ).toBe("new");
  });

  it("handles save and restore cursor controls", () => {
    expect(
      parseAnsi("\u001b[shello\u001b[uX")
        .map((run) => run.text)
        .join("")
    ).toBe("Xello");
    expect(
      parseAnsi("\u001b7hello\u001b8X")
        .map((run) => run.text)
        .join("")
    ).toBe("Xello");
  });

  it("expands tabs to terminal cells before later cursor positioning", () => {
    expect(
      parseAnsi("A\tB")
        .map((run) => run.text)
        .join("")
    ).toBe("A       B");
    expect(
      parseAnsi("A\tB\u001b[9GC")
        .map((run) => run.text)
        .join("")
    ).toBe("A       C");
  });

  it("tracks wide characters as two terminal cells", () => {
    expect(
      parseAnsi("测\u001b[3GZ")
        .map((run) => run.text)
        .join("")
    ).toBe("测Z");
    expect(
      parseAnsi("测X\u001b[4GZ")
        .map((run) => run.text)
        .join("")
    ).toBe("测XZ");
    expect(
      parseAnsi("Ａ\u001b[3GZ")
        .map((run) => run.text)
        .join("")
    ).toBe("ＡZ");
  });

  it("bounds large cursor movement before materializing blank lines", () => {
    const rendered = parseAnsi("top\u001b[100000Bbottom");
    expect(rendered.filter((run) => run.text === "\n")).toHaveLength(999);
  });
});

describe("font", () => {
  const require = createRequire(import.meta.url);
  const fontPackageRoot = dirname(require.resolve("jetbrains-mono/package.json"));
  const shippedFontPath = join(fontPackageRoot, "fonts/webfonts/JetBrainsMono-Regular.woff2");
  const shippedBoldFontPath = join(fontPackageRoot, "fonts/webfonts/JetBrainsMono-Bold.woff2");
  const shippedItalicFontPath = join(fontPackageRoot, "fonts/webfonts/JetBrainsMono-Italic.woff2");
  const shippedBoldItalicFontPath = join(
    fontPackageRoot,
    "fonts/webfonts/JetBrainsMono-BoldItalic.woff2"
  );

  it("embeds the full JetBrains Mono font family for svg rendering", () => {
    expect(Buffer.from(JETBRAINS_MONO_BASE64, "base64")).toEqual(readFileSync(shippedFontPath));
    expect(FONT_FACE_CSS).toContain("font-family: 'JetBrains Mono'");
    expect(FONT_FACE_CSS).toContain(`data:font/woff2;base64,${JETBRAINS_MONO_BASE64}`);
    expect(FONT_FACE_CSS).toContain("format('woff2')");
    expect(FONT_FACE_CSS).toContain(readFileSync(shippedBoldFontPath).toString("base64"));
    expect(FONT_FACE_CSS).toContain(readFileSync(shippedItalicFontPath).toString("base64"));
    expect(FONT_FACE_CSS).toContain(readFileSync(shippedBoldItalicFontPath).toString("base64"));
    expect(FONT_FACE_CSS).toContain("font-style: normal;\n  font-weight: 400;");
    expect(FONT_FACE_CSS).toContain("font-style: normal;\n  font-weight: 700;");
    expect(FONT_FACE_CSS).toContain("font-style: italic;\n  font-weight: 400;");
    expect(FONT_FACE_CSS).toContain("font-style: italic;\n  font-weight: 700;");
  });

  it("ships all JetBrains Mono faces for resvg font loading", () => {
    expect(JETBRAINS_MONO_FONT_FILES).toHaveLength(4);
    expect(JETBRAINS_MONO_TTF_PATH).toMatch(/jetbrains-mono-400-normal\.ttf$/);
    expect(readFileSync(JETBRAINS_MONO_TTF_PATH).byteLength).toBeGreaterThan(0);
    expect(JETBRAINS_MONO_FONT_FILES[1]).toMatch(/jetbrains-mono-700-normal\.ttf$/);
    expect(JETBRAINS_MONO_FONT_FILES[2]).toMatch(/jetbrains-mono-400-italic\.ttf$/);
    expect(JETBRAINS_MONO_FONT_FILES[3]).toMatch(/jetbrains-mono-700-italic\.ttf$/);
    expect(
      JETBRAINS_MONO_FONT_FILES.every((fontPath) => readFileSync(fontPath).byteLength > 0)
    ).toBe(true);
  });
});

describe("renderSvg", () => {
  function createRun(overrides: Partial<StyledRun> = {}): StyledRun {
    return {
      text: "hello",
      fg: null,
      bg: null,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      dim: false,
      inverse: false,
      conceal: false,
      ...overrides
    };
  }

  it("renders plain text inside a tspan", () => {
    const svg = renderSvg([createRun()]);

    expect(svg).toContain("<tspan");
    expect(svg).toContain(">hello</tspan>");
  });

  it("adds font-weight for bold runs", () => {
    const svg = renderSvg([createRun({ bold: true })], { window: false });

    expect(svg).toContain('font-weight="bold"');
  });

  it("adds line-through decoration for strikethrough runs", () => {
    const svg = renderSvg([createRun({ strikethrough: true })], { window: false });

    expect(svg).toContain('text-decoration="line-through"');
  });

  it("applies foreground color as fill", () => {
    const svg = renderSvg([createRun({ fg: { type: "ansi4", index: 1 } })], { window: false });

    expect(svg).toContain('fill="#D74E6F"');
  });

  it("renders background colors behind text runs", () => {
    const svg = renderSvg([createRun({ text: "ERROR", bg: { type: "ansi4", index: 1 } })], {
      window: false
    });

    expect(svg).toContain('fill="#D74E6F"');
    expect(svg).toContain("<rect");
  });

  it("renders inverse text with swapped default colors and conceals hidden text", () => {
    const svg = renderSvg(
      [
        createRun({ text: "selected", inverse: true }),
        createRun({ text: "secret", conceal: true })
      ],
      { window: false }
    );

    expect(svg).toContain('fill="#c4c4c4"');
    expect(svg).toContain('fill="#171717"');
    expect(svg).not.toContain("secret");
  });

  it("maps ansi8 low palette indexes to the standard 8-color palette", () => {
    const svg = renderSvg([createRun({ fg: { type: "ansi8", index: 1 } })], { window: false });

    expect(svg).toContain('fill="#D74E6F"');
  });

  it("skips the title bar when window is false", () => {
    const svg = renderSvg([createRun()], { window: false });

    expect(svg).not.toContain("#FF5A54");
    expect(svg).not.toContain("<circle");
  });

  it("includes macOS traffic lights when window is true", () => {
    const svg = renderSvg([createRun()], { window: true });

    expect(svg).toContain('<circle cx="13.5" cy="12" r="5.5" fill="#FF5A54" />');
    expect(svg).toContain('<circle cx="32.5" cy="12" r="5.5" fill="#E6BF29" />');
    expect(svg).toContain('<circle cx="51.5" cy="12" r="5.5" fill="#52C12B" />');
  });

  it("reflects custom padding in the dimensions and viewBox", () => {
    const svg = renderSvg([createRun({ text: "hi" })], { window: false, padding: 10 });

    expect(svg).toContain('width="36.83"');
    expect(svg).toContain('height="48.40"');
    expect(svg).toContain('viewBox="0 0 36.83 48.40"');
  });

  it("renders separate text nodes for each line", () => {
    const svg = renderSvg(
      [createRun({ text: "a" }), createRun({ text: "\n" }), createRun({ text: "b" })],
      { window: false }
    );

    expect(svg).toContain('<text x="20.00" y="36.80" xml:space="preserve">');
    expect(svg).toContain('<text x="20.00" y="53.60" xml:space="preserve">');
  });

  it("escapes xml text content", () => {
    const svg = renderSvg([createRun({ text: `<a & "b">` })], { window: false });

    expect(svg).toContain('&lt;a &amp; "b"&gt;');
  });

  it("uses #c4c4c4 as the default foreground color", () => {
    const svg = renderSvg([createRun()], { window: false });

    expect(svg).toContain('fill="#c4c4c4"');
  });

  it("measures CJK characters as 2 cells wide", () => {
    const svg = renderSvg([createRun({ text: "测" })], { window: false });

    // 2 cells * 8.412666... + 20 (left pad) + 40 (right pad) = 76.83
    expect(svg).toContain('width="76.83"');
  });

  it("measures emoji as 2 cells wide", () => {
    const svg = renderSvg([createRun({ text: "🎉" })], { window: false });

    expect(svg).toContain('width="76.83"');
  });

  it("measures fullwidth latin characters as 2 cells wide", () => {
    // Fullwidth A (U+FF21) is in the fullwidth block
    const svg = renderSvg([createRun({ text: "\uFF21" })], { window: false });

    expect(svg).toContain('width="76.83"');
  });

  it("advances horizontal tabs to eight-column tab stops", () => {
    const svg = renderSvg([createRun({ text: "A\tB" })], { window: false, padding: 0 });

    expect(svg).toContain('width="75.71"');
  });

  it("does not allocate cells to standalone combining marks", () => {
    const svg = renderSvg([createRun({ text: "\u0301" })], { window: false, padding: 0 });

    expect(svg).toContain('width="0.00"');
  });

  it("measures regional indicator flags as two terminal cells", () => {
    const svg = renderSvg([createRun({ text: "🇺🇸" })], { window: false, padding: 0 });

    expect(svg).toContain('width="16.83"');
  });
});

describe("renderPng", () => {
  function createRun(overrides: Partial<StyledRun> = {}): StyledRun {
    return {
      text: "hello",
      fg: null,
      bg: null,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      dim: false,
      inverse: false,
      conceal: false,
      ...overrides
    };
  }

  it("renders SVG output as a PNG buffer", () => {
    const svg = renderSvg([createRun()], { window: false });

    const png = renderPng(svg);

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(png.length).toBeGreaterThan(8);
  });
});
