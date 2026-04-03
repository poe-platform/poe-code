import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./index.js";
import { renderTerminalPng } from "./index.js";
import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";
import { renderPng } from "./png-renderer.js";
import { writeFile } from "node:fs/promises";

vi.mock("./ansi-parser.js", () => ({
  parseAnsi: vi.fn()
}));

vi.mock("./svg-renderer.js", () => ({
  renderSvg: vi.fn()
}));

vi.mock("./png-renderer.js", () => ({
  renderPng: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn()
}));

const parseAnsiMock = vi.mocked(parseAnsi);
const renderSvgMock = vi.mocked(renderSvg);
const renderPngMock = vi.mocked(renderPng);
const writeFileMock = vi.mocked(writeFile);

describe("renderTerminalPng", () => {
  beforeEach(() => {
    parseAnsiMock.mockReset();
    renderSvgMock.mockReset();
    renderPngMock.mockReset();
    writeFileMock.mockReset();

    parseAnsiMock.mockReturnValue([
      {
        text: "hello",
        fg: null,
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        dim: false
      }
    ]);
    renderSvgMock.mockReturnValue("<svg />");
    renderPngMock.mockReturnValue(Buffer.from("png"));
  });

  it("renders ANSI text to PNG using the three layers", async () => {
    const png = await renderTerminalPng("hello", {
      padding: 12,
      window: false
    });

    expect(parseAnsiMock).toHaveBeenCalledWith("hello");
    expect(renderSvgMock).toHaveBeenCalledWith(parseAnsiMock.mock.results[0]?.value, {
      padding: 12,
      window: false
    });
    expect(renderPngMock).toHaveBeenCalledWith("<svg />");
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(png).toEqual(Buffer.from("png"));
  });

  it("writes the rendered PNG when an output path is provided", async () => {
    const png = await renderTerminalPng("hello", {
      output: "/tmp/example.png"
    });

    expect(writeFileMock).toHaveBeenCalledWith("/tmp/example.png", Buffer.from("png"));
    expect(png).toEqual(Buffer.from("png"));
  });

  it("keeps the lower-level helpers available from the public barrel", () => {
    expect(api.renderTerminalPng).toBe(renderTerminalPng);
    expect(api.parseAnsi).toBe(parseAnsi);
    expect(api.renderSvg).toBe(renderSvg);
    expect(api.renderPng).toBe(renderPng);
  });
});
