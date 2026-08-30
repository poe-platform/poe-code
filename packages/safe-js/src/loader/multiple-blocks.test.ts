import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { extractBlock } = await import("./extract-block.js");
const { run } = await import("../run.js");
const { runCli } = await import("../cli.js");
const { runExampleFile } = await import("../example-runner.js");
const { runHarness } = await import("../runner/run-harness.js");
const { lint } = await import("../lint/index.js");
const { createSink } = await import("../../test/sinks.js");

describe("multiple executable Markdown blocks", () => {
  beforeEach(() => vol.reset());
  afterEach(() => vi.restoreAllMocks());

  it.each(["\n", "\r\n", "\r"])(
    "preserves offsets and executes every block with %j",
    async (newline) => {
      const markdown = [
        "# Intro 🐈",
        "```js",
        "const values = [1];",
        "```",
        "Prose 🐈 must never become code.",
        "````json",
        "```js",
        "throw Error('nested example');",
        "```",
        "````",
        "~~~javascript",
        "values.push(2);",
        "~~~",
        "```ajs",
        "return values;",
        "```"
      ].join(newline);
      const extracted = extractBlock(markdown);
      expect(extracted.source.indexOf("values.push(2)")).toBe(
        markdown.indexOf("values.push(2)") - extracted.startOffset
      );
      expect(extracted.source).not.toContain("nested example");
      expect(extracted.source).not.toContain("Prose");
      expect(await run(extracted.source)).toMatchObject({ ok: true, returnValue: [1, 2] });
    }
  );

  it("rejects an unclosed later executable fence before running earlier effects", () => {
    const markdown = ["```js", "effect();", "```", "~~~ajs", "return 2;"].join("\n");
    expect(() => extractBlock(markdown)).toThrow("Unclosed ajs fenced block opened at line 4.");
  });

  it.each(["cli", "example", "sdk"])(
    "reports original unclosed-fence lines through %s",
    async (entryPoint) => {
      const filepath = "/repo/unclosed-frontmatter.md";
      vol.fromJSON({
        [filepath]: [
          "---",
          "kind: pipeline",
          "version: 1",
          "---",
          "```js",
          "return 1;",
          "```",
          "~~~ajs",
          "return 2;"
        ].join("\r\n")
      });
      const message = "Unclosed ajs fenced block opened at line 8.";
      if (entryPoint === "sdk") {
        await expect(runHarness(filepath, { modulesFor: () => ({}) })).rejects.toThrow(message);
      } else {
        const stderr = createSink();
        const stdout = createSink();
        const exitCode =
          entryPoint === "cli"
            ? await runCli([filepath], { stderr, stdout })
            : await runExampleFile(filepath, { stderr, stdout });
        expect(exitCode).not.toBe(0);
        expect(stderr.output()).toContain(message);
        expect(stdout.output()).toBe("");
      }
    }
  );

  it.each(["\n", "\r\n", "\r"])("preserves SDK hashbang line offsets with %j", async (newline) => {
    const filepath = "/repo/hashbang.md";
    vol.fromJSON({
      [filepath]: [
        "```js",
        "#!/usr/bin/env node",
        "const value = 1;",
        "```",
        "~~~ajs",
        'eval("value");',
        "~~~"
      ].join(newline)
    });
    await expect(runHarness(filepath, { modulesFor: () => ({}) })).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ filename: filepath, line: 6 })
      ])
    });
  });

  it.each(["cli", "example", "sdk"])(
    "runs all blocks through the %s entry point",
    async (entryPoint) => {
      const filepath = "/repo/multiple.md";
      vol.fromJSON({
        [filepath]: [
          "```js",
          "const value = 40;",
          "```",
          "# Next",
          "~~~ajs",
          "return value + 2;",
          "~~~"
        ].join("\n")
      });
      const stdout = createSink();
      const stderr = createSink();
      if (entryPoint === "sdk") {
        expect(await runHarness(filepath, { modulesFor: () => ({}) })).toMatchObject({
          ok: true,
          returnValue: 42
        });
      } else {
        const exitCode =
          entryPoint === "cli"
            ? await runCli([filepath], { stdout, stderr })
            : await runExampleFile(filepath, { stdout, stderr });
        expect(stderr.output()).toBe("");
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout.output())).toMatchObject({ ok: true, returnValue: 42 });
      }
    }
  );

  it.each(
    ["cli", "example"].flatMap((entryPoint) => ["", "\uFEFF"].map((bom) => ({ entryPoint, bom })))
  )(
    "preserves Markdown and fixes both blocks through $entryPoint with BOM $bom",
    async ({ entryPoint, bom }) => {
      const filepath = "/repo/fix.md";
      const markdown =
        bom +
        [
          "---",
          "kind: pipeline",
          "version: 1",
          "---",
          "# Keep 🐈",
          "```js title=first",
          'const value = `${"before"}`;',
          "```",
          "**Untouched**",
          "~~~ajs",
          "return `${value}`;",
          "~~~",
          "Tail"
        ].join("\r\n");
      vol.fromJSON({ [filepath]: markdown });
      const stdout = createSink();
      const stderr = createSink();
      const exitCode =
        entryPoint === "cli"
          ? await runCli(["--fix", filepath], { stdout, stderr })
          : await runExampleFile(filepath, { fix: true, stdout, stderr });
      expect(stderr.output()).toBe("");
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.output())).toMatchObject({ ok: true, returnValue: "before" });
      expect(vol.readFileSync(filepath, "utf8")).toBe(
        markdown.replace('`${"before"}`', 'String("before")').replace("`${value}`", "String(value)")
      );
    }
  );

  it("returns only applied fixes and leaves excluded source ranges untouched", () => {
    const source = 'const value = `${"before"}`; return `${value}`;';
    const secondStart = source.lastIndexOf("`${");
    const result = lint(source, { fix: true, fixRanges: [[secondStart, source.length]] });
    expect(result.fixed).toBe('const value = `${"before"}`; return String(value);');
    expect(result.fixes).toEqual([
      { range: [secondStart, source.length - 1], replacement: "String(value)" }
    ]);
    expect(lint(source, { fix: true, fixRanges: [] }).fixed).toBe(source);
  });

  it.each([1, 8, 64])(
    "matches native execution across %i mutable and async blocks",
    async (width) => {
      const families = [
        [
          "const values = []; let count = 0;",
          ...Array.from({ length: width }, (_, index) => `values.push(increment(${index}));`),
          "function increment(value) { count += value + 1; return count; } return values;"
        ],
        [
          "const values = [];",
          ...Array.from(
            { length: width },
            (_, index) =>
              `try { const value = await Promise.${index % 3 === 0 ? "reject" : "resolve"}(${index}); values.push(value); } catch (error) { values.push(-error - 1); }`
          ),
          "return values;"
        ]
      ];
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
      for (const blocks of families) {
        const markdown = blocks
          .map(
            (source, index) =>
              `${index % 2 === 0 ? "```js" : "~~~ajs"}\n${source}\n${index % 2 === 0 ? "```" : "~~~"}\n# Prose ${index} 🐈\n`
          )
          .join("\n");
        const expected = await new AsyncFunction(blocks.join("\n"))();
        expect(await run(extractBlock(markdown).source)).toMatchObject({
          ok: true,
          returnValue: expected
        });
      }
    }
  );

  it.each(["cli", "example", "sdk"])(
    "rejects malformed later blocks before effects through %s",
    async (entryPoint) => {
      const filepath = "/repo/unclosed.md";
      vol.fromJSON({
        [filepath]: [
          "```js",
          'console.log("unexpected effect");',
          "```",
          "~~~ajs",
          "return 2;"
        ].join("\n")
      });
      if (entryPoint === "sdk") {
        const modulesFor = vi.fn(() => ({}));
        await expect(runHarness(filepath, { modulesFor })).rejects.toThrow(
          "Unclosed ajs fenced block opened at line 4."
        );
        expect(modulesFor).not.toHaveBeenCalled();
      } else {
        const stdout = createSink();
        const stderr = createSink();
        const exitCode =
          entryPoint === "cli"
            ? await runCli([filepath], { stdout, stderr })
            : await runExampleFile(filepath, { stdout, stderr });
        expect(exitCode).not.toBe(0);
        expect(stderr.output()).toContain("Unclosed ajs fenced block opened at line 4.");
        expect(stdout.output()).toBe("");
      }
    }
  );

  it.each(
    ["cli", "example", "sdk"].flatMap((entryPoint) =>
      ["\n", "\r\n", "\r"].map((newline) => ({ entryPoint, newline }))
    )
  )(
    "maps later diagnostics to original lines through $entryPoint with $newline",
    async ({ entryPoint, newline }) => {
      const filepath = "/repo/diagnostics.md";
      vol.fromJSON({
        [filepath]: [
          "---",
          "kind: pipeline",
          "version: 1",
          "---",
          "# Heading",
          "```js",
          "const value = 1;",
          "```",
          "# Next",
          "~~~ajs",
          'eval("value");',
          "~~~"
        ].join(newline)
      });
      if (entryPoint === "sdk") {
        await expect(runHarness(filepath, { modulesFor: () => ({}) })).rejects.toMatchObject({
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ filename: filepath, line: 11 })
          ])
        });
      } else {
        const stderr = createSink();
        const stdout = createSink();
        const exitCode =
          entryPoint === "cli"
            ? await runCli([filepath], { stderr, stdout })
            : await runExampleFile(filepath, { stderr, stdout });
        expect(exitCode).not.toBe(0);
        expect(stderr.output()).toContain(`${filepath}:11:`);
        expect(stdout.output()).toBe("");
      }
    }
  );

  it.each(["cli", "example"])(
    "does not apply a fix across Markdown prose through %s",
    async (entryPoint) => {
      const filepath = "/repo/crossing.md";
      const markdown = [
        "```js",
        'const value = "value";',
        "return `${",
        "```",
        "# Keep this prose",
        "~~~ajs",
        "value}`;",
        "~~~"
      ].join("\n");
      vol.fromJSON({ [filepath]: markdown });
      const stderr = createSink();
      const stdout = createSink();
      const exitCode =
        entryPoint === "cli"
          ? await runCli(["--fix", filepath], { stderr, stdout })
          : await runExampleFile(filepath, { fix: true, stderr, stdout });
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.output())).toMatchObject({ ok: true, returnValue: "value" });
      expect(vol.readFileSync(filepath, "utf8")).toBe(markdown);
      const extracted = extractBlock(markdown);
      const fixRanges = extracted.ranges.map(([start, end]): readonly [number, number] => [
        start - extracted.startOffset,
        end - extracted.startOffset
      ]);
      const lintResult = lint(extracted.source, { fix: true, fixRanges });
      expect(lintResult.fixes).toEqual([]);
      expect(lintResult.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "AS-NEEDLESS-TEMPLATE" })])
      );
    }
  );
});
