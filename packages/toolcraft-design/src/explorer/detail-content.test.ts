import { afterEach, describe, expect, it, vi } from "vitest";
import * as markdown from "../terminal-markdown/index.js";
import { prepareDetailContent } from "./detail-content.js";

describe("prepareDetailContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prepares physical wrapped rows from source and body width", () => {
    const words = Array.from({ length: 24 }, (_, index) => `unit${String(index).padStart(2, "0")}-${"x".repeat(43)}`);
    const narrow = prepareDetailContent(words.join(" "), 66);
    const wide = prepareDetailContent(words.join(" "), 113);

    expect(narrow.lines.map((line) => line.map((cell) => cell.ch).join(""))).toEqual(words);
    expect(narrow.text.split("\n")).toHaveLength(24);
    expect(wide.lines).toHaveLength(12);
    expect(wide.lines[0].map((cell) => cell.ch).join("")).toBe(words.slice(0, 2).join(" "));
  });

  it("retains styled grapheme cells while splitting only physical newlines", () => {
    const prepared = prepareDetailContent("**😀e\u0301**\nsecond", 66);

    expect(prepared.lines.map((line) => line.map((cell) => cell.ch).join(""))).toEqual(["😀e\u0301", "second"]);
    expect(prepared.lines[0].map((cell) => cell.width)).toEqual([2, 1]);
    expect(prepared.lines[0].every((cell) => cell.style !== 0)).toBe(true);
  });

  it("counts rendered Markdown structure and trims trailing blank rows", () => {
    const source = [
      ...Array.from({ length: 6 }, (_, index) => `# Prepared heading ${index}`),
      ...Array.from({ length: 11 }, (_, index) => `Prepared line ${index}`)
    ].join("\n") + "\n\n\n";

    const prepared = prepareDetailContent(source, 66);

    expect(prepared.lines).toHaveLength(29);
    expect(prepared.lines.at(-1)?.map((cell) => cell.ch).join("")).toBe("Prepared line 10");
    expect(prepared.text.endsWith("\n")).toBe(false);
  });

  it("reuses the existing content-and-width cache across width revisits", () => {
    const renderMarkdown = vi.spyOn(markdown, "renderMarkdown");
    const first = prepareDetailContent("Shared cache policy source", 20);

    expect(prepareDetailContent("Shared cache policy source", 20)).toBe(first);
    expect(prepareDetailContent("Shared cache policy source", 40)).not.toBe(first);
    expect(prepareDetailContent("Shared cache policy source", 20)).toBe(first);
    expect(prepareDetailContent("Changed cache policy source", 20)).not.toBe(first);
    expect(renderMarkdown).toHaveBeenCalledTimes(3);
  });

  it("preserves the minimum preparation width", () => {
    expect(prepareDetailContent("Minimum width", 0)).toBe(prepareDetailContent("Minimum width", 1));
  });

  it.each(["", " \t\n\n"])("keeps blank source %j callback-free and skips Markdown rendering", (content) => {
    const renderMarkdown = vi.spyOn(markdown, "renderMarkdown");

    expect(prepareDetailContent(content, 66)).toEqual({ text: "", lines: [[]] });
    expect(renderMarkdown).not.toHaveBeenCalled();
  });
});
