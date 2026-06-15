import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./index.js";
import { renderTerminalPng } from "./index.js";
import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";
import { renderPng } from "./png-renderer.js";
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

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
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn()
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "temp-id")
}));

const parseAnsiMock = vi.mocked(parseAnsi);
const renderSvgMock = vi.mocked(renderSvg);
const renderPngMock = vi.mocked(renderPng);
const randomUUIDMock = vi.mocked(randomUUID);
const renameMock = vi.mocked(rename);
const rmMock = vi.mocked(rm);
const writeFileMock = vi.mocked(writeFile);

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("renderTerminalPng", () => {
  beforeEach(() => {
    parseAnsiMock.mockReset();
    renderSvgMock.mockReset();
    renderPngMock.mockReset();
    randomUUIDMock.mockClear();
    renameMock.mockReset();
    rmMock.mockReset();
    writeFileMock.mockReset();

    parseAnsiMock.mockReturnValue([
      {
        text: "hello",
        fg: null,
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        dim: false
      }
    ]);
    renderSvgMock.mockReturnValue("<svg />");
    renderPngMock.mockReturnValue(Buffer.from("png"));
    renameMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
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

    expect(writeFileMock).toHaveBeenCalledWith("/tmp/example.png.temp-id.tmp", Buffer.from("png"), {
      flag: "wx"
    });
    expect(renameMock).toHaveBeenCalledWith("/tmp/example.png.temp-id.tmp", "/tmp/example.png");
    expect(png).toEqual(Buffer.from("png"));
  });

  it("rejects an empty SDK output path before rendering", async () => {
    await expect(renderTerminalPng("hello", { output: "" })).rejects.toThrow(
      "Output path must not be empty."
    );

    expect(parseAnsiMock).not.toHaveBeenCalled();
  });

  it("does not remove a colliding temporary path it did not create", async () => {
    writeFileMock.mockRejectedValueOnce(
      Object.assign(new Error("temporary path exists"), { code: "EEXIST" })
    );

    await expect(renderTerminalPng("hello", { output: "/tmp/example.png" })).rejects.toMatchObject({
      code: "EEXIST"
    });

    expect(renameMock).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
  });

  it("removes a partial temporary path when writing fails", async () => {
    writeFileMock.mockRejectedValueOnce(new Error("disk full"));

    await expect(renderTerminalPng("hello", { output: "/tmp/example.png" })).rejects.toThrow(
      "disk full"
    );

    expect(renameMock).not.toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledWith("/tmp/example.png.temp-id.tmp", { force: true });
  });

  it("removes partial temporary paths when write errors only inherit existing-path codes", async () => {
    writeFileMock.mockRejectedValueOnce(new Error("temporary write denied"));

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(renderTerminalPng("hello", { output: "/tmp/example.png" })).rejects.toThrow(
        "temporary write denied"
      );
    });

    expect(renameMock).not.toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledWith("/tmp/example.png.temp-id.tmp", { force: true });
  });

  it("does not hide publication failure when temporary cleanup also fails", async () => {
    renameMock.mockRejectedValueOnce(new Error("publish failed"));
    rmMock.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(renderTerminalPng("hello", { output: "/tmp/example.png" })).rejects.toThrow(
      "publish failed"
    );
    expect(rmMock).toHaveBeenCalledWith("/tmp/example.png.temp-id.tmp", { force: true });
  });

  it("rejects negative SDK padding before rendering", async () => {
    await expect(renderTerminalPng("hello", { padding: -1 })).rejects.toThrow(
      "Padding must be a non-negative integer."
    );

    expect(parseAnsiMock).not.toHaveBeenCalled();
  });

  it("keeps the lower-level helpers available from the public barrel", () => {
    expect(api.renderTerminalPng).toBe(renderTerminalPng);
    expect(api.parseAnsi).toBe(parseAnsi);
    expect(api.renderSvg).toBe(renderSvg);
    expect(api.renderPng).toBe(renderPng);
  });
});
