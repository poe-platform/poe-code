import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { runHarness } = await import("../runner/run-harness.js");
const { Budget } = await import("../interp/budget.js");
const { run } = await import("../run.js");
const { dump } = await import("../dump.js");
const { runCli } = await import("../cli.js");
const { runExampleFile } = await import("../example-runner.js");
const lintModule = await import("../lint.js");
const { createSink } = await import("../../test/sinks.js");

describe("HI-002 original Markdown offsets", () => {
  beforeEach(() => vol.reset());
  afterEach(() => vi.restoreAllMocks());

  const lintLines = [
    "---",
    "kind: functional-audit",
    "version: 1",
    "---",
    "# Projection 🧩",
    "",
    "```js",
    "const totals = [2, 3].map((value) => value * 2);",
    "```",
    "",
    "The two code blocks share scope.",
    "",
    "```js",
    "return totals.reduce((sum, value) => sum + value, 0) + missingTotal;",
    "```",
    ""
  ];
  const encodings = ["\n", "\r\n", "\r"].flatMap((newline) =>
    ["", "\uFEFF"].map((bom) => ({ newline, bom }))
  );

  it("reproduces the original audit anchor at offset 214, not 156", async () => {
    const filepath = "/repo/original-offset.md";
    const markdown = lintLines.join("\n");
    expect(markdown.indexOf("missingTotal")).toBe(214);
    vol.fromJSON({ [filepath]: markdown });

    await expect(runHarness(filepath, { modulesFor: () => ({}) })).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "AS003",
          line: 14,
          column: 56,
          span: {
            start: { offset: 214, line: 14, column: 56 },
            end: { offset: 226, line: 14, column: 68 }
          }
        })
      ])
    });
  });

  it.each(encodings)(
    "preserves SDK lint offsets with newline $newline and BOM $bom",
    async ({ newline, bom }) => {
      const filepath = "/repo/lint-offset.md";
      const markdown = bom + lintLines.join(newline);
      const offset = markdown.indexOf("missingTotal");
      vol.fromJSON({ [filepath]: markdown });

      await expect(runHarness(filepath, { modulesFor: () => ({}) })).rejects.toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "AS003",
            span: {
              start: { offset, line: 14, column: 56 },
              end: { offset: offset + "missingTotal".length, line: 14, column: 68 }
            }
          })
        ])
      });
    }
  );

  it.each(encodings)(
    "preserves runtime offsets and astral columns with newline $newline and BOM $bom",
    async ({ newline, bom }) => {
      const filepath = "/repo/runtime-offset.md";
      const markdown =
        bom +
        [
          "---",
          "kind: functional-audit",
          "version: 1",
          "---",
          "# Coordinates 🧩 é",
          "",
          "```js",
          'const message = "coordinate-stop";',
          "```",
          "",
          "Between fences Ω",
          "",
          "```js",
          'const icon = "🧪"; throw Error(message);',
          "```",
          ""
        ].join(newline);
      const offset = markdown.indexOf("throw Error(message)");
      expect(offset).toBe((newline === "\r\n" ? 164 : 151) + bom.length);
      vol.fromJSON({ [filepath]: markdown });

      expect(
        await runHarness(filepath, {
          budget: new Budget({ maxSteps: 1000 }),
          modulesFor: () => ({})
        })
      ).toMatchObject({
        ok: false,
        error: {
          message: "coordinate-stop",
          span: {
            start: { offset, line: 14, column: 20 },
            end: { offset: offset + "throw Error(message)".length, line: 14, column: 40 }
          }
        }
      });
    }
  );

  it("anchors diagnostics in the first, second, and third executable blocks", async () => {
    const filepath = "/repo/three-blocks.md";
    const markdown = [
      "# Prefix 🧩",
      "```js",
      "const first = missingFirst;",
      "```",
      "Between Ω",
      "~~~javascript",
      "const second = missingSecond;",
      "~~~",
      "Between 🧪",
      "```ajs",
      "return missingThird;",
      "```"
    ].join("\r\n");
    vol.fromJSON({ [filepath]: markdown });

    await expect(runHarness(filepath, { modulesFor: () => ({}) })).rejects.toMatchObject({
      diagnostics: expect.arrayContaining(
        (
          [
            ["missingFirst", 3, 15],
            ["missingSecond", 7, 16],
            ["missingThird", 11, 8]
          ] as const
        ).map(([name, line, column]) =>
          expect.objectContaining({
            code: "AS003",
            span: {
              start: { offset: markdown.indexOf(name), line, column },
              end: {
                offset: markdown.indexOf(name) + name.length,
                line,
                column: column + name.length
              }
            }
          })
        )
      )
    });
  });

  it("preserves frontmatter offsets in the whole-body fallback", async () => {
    const filepath = "/repo/fallback.md";
    const markdown = "---\r\nkind: demo\r\n---\r\nreturn missingTotal;";
    vol.fromJSON({ [filepath]: markdown });

    await expect(runHarness(filepath, { modulesFor: () => ({}) })).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "AS003",
          span: {
            start: { offset: markdown.indexOf("missingTotal"), line: 4, column: 8 },
            end: { offset: markdown.indexOf(";"), line: 4, column: 20 }
          }
        })
      ])
    });
  });

  it("restores a CLI snapshot created with the old newline-only prefix", async () => {
    const filepath = "/repo/resume-offset.md";
    const markdown = ["---", "kind: demo", "---", "# Prefix 🧩", "```js", "return 42;", "```"].join(
      "\n"
    );
    const snapshot = await dump(await run("\n\n\n\n\nreturn 42;\n"));
    const checkpoint = "/repo/old-prefix.json";
    vol.fromJSON({ [filepath]: markdown, [checkpoint]: snapshot });
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["--restore", checkpoint, filepath], {
      modulesFor: () => ({}),
      stdout,
      stderr
    });

    expect(stderr.output()).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({ ok: true, returnValue: 42 });
  });

  it.each(["cli", "example"])(
    "uses original diagnostic offsets through the actual %s loader",
    async (entryPoint) => {
      const filepath = "/repo/entry-offset.md";
      const markdown = "\uFEFF" + lintLines.join("\r\n");
      vol.fromJSON({ [filepath]: markdown });
      const lintSpy = vi.spyOn(lintModule, "lint");
      const stdout = createSink();
      const stderr = createSink();

      const exitCode =
        entryPoint === "cli"
          ? await runCli([filepath], { stdout, stderr, modulesFor: () => ({}) })
          : await runExampleFile(filepath, { stdout, stderr });

      expect(exitCode).not.toBe(0);
      expect(stdout.output()).toBe("");
      expect(stderr.output()).toContain(`${filepath}:14:56 AS003`);
      expect(lintSpy).toHaveReturnedWith(
        expect.arrayContaining([
          expect.objectContaining({
            code: "AS003",
            span: {
              start: { offset: markdown.indexOf("missingTotal"), line: 14, column: 56 },
              end: { offset: markdown.indexOf("missingTotal") + 12, line: 14, column: 68 }
            }
          })
        ])
      );
    }
  );

  it.each(
    ["cli", "example"].flatMap((entryPoint) =>
      encodings.map((encoding) => ({ entryPoint, ...encoding }))
    )
  )(
    "preserves actual autofix edits through $entryPoint with newline $newline and BOM $bom",
    async ({ entryPoint, newline, bom }) => {
      const filepath = "/repo/fix-offset.md";
      const markdown =
        bom +
        [
          "---",
          "kind: demo",
          "---",
          "# Preserve 🧩",
          "```js",
          'const value = `${"before"}`;',
          "```",
          "Prose Ω",
          "~~~javascript",
          "return `${value}`;",
          "~~~",
          "Trailing 🧪"
        ].join(newline);
      vol.fromJSON({ [filepath]: markdown });
      const stdout = createSink();
      const stderr = createSink();

      const exitCode =
        entryPoint === "cli"
          ? await runCli(["--fix", filepath], { stdout, stderr, modulesFor: () => ({}) })
          : await runExampleFile(filepath, { fix: true, stdout, stderr });

      expect(stderr.output()).toBe("");
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.output())).toMatchObject({ ok: true, returnValue: "before" });
      expect(vol.readFileSync(filepath, "utf8")).toBe(
        markdown.replace('`${"before"}`', 'String("before")').replace("`${value}`", "String(value)")
      );
    }
  );
});
