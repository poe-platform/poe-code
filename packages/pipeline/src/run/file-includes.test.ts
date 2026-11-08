import { describe, expect, it, vi } from "vitest";
import { resolveFileIncludes } from "./runner.js";
import { resolvePipelineVars } from "../vars/resolve.js";

describe("literal pipeline file includes", () => {
  it.each(["$&", "$$", "$`", "$'", "$1", "$<name>", "first\r\n日本語 🚀\r\n", ""])("preserves included contents %j", async (content) => {
    const readFile = vi.fn(async () => content);
    await expect(resolveFileIncludes("Before\n{{file 'source.txt'}}\nAfter", "/repo", readFile))
      .resolves.toBe(`Before\n${content}\nAfter`);
    expect(readFile.mock.calls).toEqual([["/repo/source.txt", "utf8"]]);
  });

  it("does not let inserted directives consume a later original directive", async () => {
    const readFile = vi.fn(async (filePath: string) => filePath === "/repo/first.txt"
      ? "Literal {{file 'second.txt'}}"
      : "Second file: $&");
    await expect(resolveFileIncludes("{{file 'first.txt'}}\n{{file 'second.txt'}}", "/repo", readFile))
      .resolves.toBe("Literal {{file 'second.txt'}}\nSecond file: $&");
    expect(readFile.mock.calls).toEqual([["/repo/first.txt", "utf8"], ["/repo/second.txt", "utf8"]]);
  });

  it("expands repeated original directives without expanding their literal contents", async () => {
    const content = "Literal {{file 'source.txt'}} and $$";
    const readFile = vi.fn(async () => content);
    await expect(resolveFileIncludes("{{file 'source.txt'}} / {{file 'source.txt'}}", "/repo", readFile))
      .resolves.toBe(`${content} / ${content}`);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("leaves non-original directives literal without reading them", async () => {
    const readFile = vi.fn(async () => "{{file 'not-present.txt'}}");
    await expect(resolveFileIncludes('{{file "source.txt"}}', "/repo", readFile))
      .resolves.toBe("{{file 'not-present.txt'}}");
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("keeps surrounding literal text and resolves adjacent directives in order", async () => {
    const readFile = vi.fn().mockResolvedValueOnce("one").mockResolvedValueOnce("two");
    await expect(resolveFileIncludes("$&{{file 'one.txt'}}{{file 'two.txt'}}$$", "/repo", readFile))
      .resolves.toBe("$&onetwo$$");
    expect(readFile.mock.calls).toEqual([["/repo/one.txt", "utf8"], ["/repo/two.txt", "utf8"]]);
  });

  it("can defer variable includes until prompt assembly while keeping the default resolver behavior", async () => {
    const readFile = vi.fn(async (filePath: string) => filePath === "/repo/context.md"
      ? "Source: {{file 'source.txt'}}"
      : "Literal $& and {{file 'other.txt'}}");
    const vars = { context: "{{file 'source.txt'}}", context_doc: "context.md" };
    await expect(resolvePipelineVars(vars, "/repo", readFile, { deferFileIncludes: true })).resolves.toEqual({
      context: "{{file 'source.txt'}}", context_doc: "Source: {{file 'source.txt'}}"
    });
    expect(readFile.mock.calls).toEqual([["/repo/context.md", "utf8"]]);
    await expect(resolvePipelineVars(vars, "/repo", readFile)).resolves.toEqual({
      context: "Literal $& and {{file 'other.txt'}}", context_doc: "Source: Literal $& and {{file 'other.txt'}}"
    });
  });
});
