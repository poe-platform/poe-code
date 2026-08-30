import { createHash } from "node:crypto";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { runHarness } = await import("../runner/run-harness.js");
const { runCli } = await import("../cli.js");
const { runExampleFile } = await import("../example-runner.js");
const { dump } = await import("../dump.js");
const { hashSource } = await import("../parse/hash.js");
const runModule = await import("../run.js");
const lintModule = await import("../lint.js");
const { createSink } = await import("../../test/sinks.js");

const originalMarkdown = [
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
].join("\n");

const runtimeMarkdown = [
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
].join("\n");

const encodings = ["\n", "\r\n", "\r"].flatMap((newline) =>
  ["", "\uFEFF"].map((bom) => ({ newline, bom }))
);

function originalSpan(source: string, token: string) {
  const offset = source.indexOf(token);
  expect(offset).toBeGreaterThanOrEqual(0);
  let line = 1;
  let column = 1;
  for (let cursor = 0; cursor < offset; cursor += 1) {
    if (source[cursor] === "\r") {
      if (source[cursor + 1] === "\n") cursor += 1;
      line += 1;
      column = 1;
    } else if (source[cursor] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return {
    start: { offset, line, column },
    end: { offset: offset + token.length, line, column: column + token.length }
  };
}

describe("HI-002 independent original-document validation", () => {
  beforeEach(() => vol.reset());
  afterEach(() => vi.restoreAllMocks());

  it("pins actual audit bytes and manual indices before executing the SDK", async () => {
    expect(createHash("sha256").update(originalMarkdown).digest("hex")).toBe(
      "6c6b218dd29114ec78440368636b46714dc115aafd255182a9028bb417b83f91"
    );
    expect(createHash("sha256").update(runtimeMarkdown).digest("hex")).toBe(
      "a8793a788f6c486e402180c47971da2d65eaefb336e8dd5e3740275f65bcc484"
    );
    expect(originalSpan(originalMarkdown, "missingTotal")).toEqual({
      start: { offset: 214, line: 14, column: 56 },
      end: { offset: 226, line: 14, column: 68 }
    });
    expect(originalSpan(runtimeMarkdown, "throw Error(message)")).toEqual({
      start: { offset: 151, line: 14, column: 20 },
      end: { offset: 171, line: 14, column: 40 }
    });
    vol.fromJSON({ "/repo/original.md": originalMarkdown });
    await expect(runHarness("/repo/original.md", { modulesFor: () => ({}) })).rejects.toMatchObject(
      {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "AS003",
            span: originalSpan(originalMarkdown, "missingTotal")
          })
        ])
      }
    );
  });

  it.each(encodings)(
    "preserves original lint spans through all loaders: %j",
    async ({ newline, bom }) => {
      const source = bom + originalMarkdown.split("\n").join(newline);
      const expected = originalSpan(source, "missingTotal");
      expect(expected.start.offset).toBe(214 + (newline === "\r\n" ? 13 : 0) + bom.length);
      const filepath = "/repo/lint.md";
      vol.fromJSON({ [filepath]: source });
      const lintSpy = vi.spyOn(lintModule, "lint");
      await expect(runHarness(filepath, { modulesFor: () => ({}) })).rejects.toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "AS003", span: expected })
        ])
      });
      for (const entry of ["cli", "example"]) {
        lintSpy.mockClear();
        const stdout = createSink();
        const stderr = createSink();
        const exitCode =
          entry === "cli"
            ? await runCli([filepath], { stdout, stderr, modulesFor: () => ({}) })
            : await runExampleFile(filepath, { stdout, stderr });
        expect(exitCode).toBe(1);
        expect(stdout.output()).toBe("");
        expect(stderr.output()).toContain(`${filepath}:14:56 AS003`);
        expect(lintSpy).toHaveReturnedWith(
          expect.arrayContaining([expect.objectContaining({ code: "AS003", span: expected })])
        );
        expect(lintSpy.mock.calls[0]![0].slice(expected.start.offset, expected.end.offset)).toBe(
          "missingTotal"
        );
      }
      expect(vol.readFileSync(filepath, "utf8")).toBe(source);
    }
  );

  it("reconstructs the legacy projection as a negative control, not a historical checkpoint", () => {
    const firstStart = originalMarkdown.indexOf("const totals");
    const firstEnd = originalMarkdown.indexOf("\n", firstStart) + 1;
    const secondStart = originalMarkdown.indexOf("return totals");
    const secondEnd = originalMarkdown.indexOf("\n", secondStart) + 1;
    const gap = originalMarkdown
      .slice(firstEnd, secondStart)
      .split("")
      .map((unit) => (unit === "\n" ? unit : " "))
      .join("");
    const legacySource =
      "\n".repeat(7) +
      originalMarkdown.slice(firstStart, firstEnd) +
      gap +
      originalMarkdown.slice(secondStart, secondEnd);
    expect(firstStart).toBe(65);
    expect(legacySource.indexOf("missingTotal")).toBe(156);
    expect(lintModule.lint(legacySource)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "AS003",
          span: {
            start: { offset: 156, line: 14, column: 56 },
            end: { offset: 168, line: 14, column: 68 }
          }
        })
      ])
    );
    expect(originalMarkdown.slice(156, 168)).not.toBe("missingTotal");
  });

  it.each(encodings)(
    "preserves SDK and CLI whole-body fallback offsets: %j",
    async ({ newline, bom }) => {
      const source =
        bom + ["---", "kind: validation", "---", "return absentFallback;"].join(newline);
      vol.fromJSON({ "/repo/fallback.md": source });
      const expected = originalSpan(source, "absentFallback");
      await expect(
        runHarness("/repo/fallback.md", { modulesFor: () => ({}) })
      ).rejects.toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "AS003", span: expected })
        ])
      });
      const lintSpy = vi.spyOn(lintModule, "lint");
      expect(
        await runCli(["/repo/fallback.md"], {
          stdout: createSink(),
          stderr: createSink(),
          modulesFor: () => ({})
        })
      ).toBe(1);
      expect(lintSpy).toHaveReturnedWith(
        expect.arrayContaining([expect.objectContaining({ code: "AS003", span: expected })])
      );
    }
  );

  it.each(encodings)(
    "preserves actual runtime spans through all loaders: %j",
    async ({ newline, bom }) => {
      const source = bom + runtimeMarkdown.split("\n").join(newline);
      const expected = originalSpan(source, "throw Error(message)");
      expect(expected.start.offset).toBe(151 + (newline === "\r\n" ? 13 : 0) + bom.length);
      vol.fromJSON({ "/repo/runtime.md": source });
      expect(await runHarness("/repo/runtime.md", { modulesFor: () => ({}) })).toMatchObject({
        ok: false,
        error: { message: "coordinate-stop", span: expected }
      });
      const runSpy = vi.spyOn(runModule, "run");
      for (const entry of ["cli", "example"]) {
        runSpy.mockClear();
        const stdout = createSink();
        const stderr = createSink();
        const exitCode =
          entry === "cli"
            ? await runCli(["/repo/runtime.md"], { stdout, stderr, modulesFor: () => ({}) })
            : await runExampleFile("/repo/runtime.md", { stdout, stderr });
        expect(exitCode).toBe(1);
        expect(stderr.output()).toContain("coordinate-stop");
        if (entry === "cli") expect(stderr.output()).toContain("14:20");
        const invocation = runSpy.mock.results[0]!;
        expect(invocation.type).toBe("return");
        const error = await invocation.value.then(
          (result: { error?: unknown }) => result.error,
          (failure: unknown) => failure
        );
        expect(error).toMatchObject({ message: "coordinate-stop", span: expected });
        expect(runSpy.mock.calls[0]![0].slice(expected.start.offset, expected.end.offset)).toBe(
          "throw Error(message)"
        );
      }
    }
  );

  it.each(encodings)(
    "anchors first, middle and final blocks independently: %j",
    async ({ newline, bom }) => {
      const source =
        bom +
        [
          "# 🧩 Prefix",
          "```js",
          "const first = absentFirst;",
          "```",
          "Between Ω",
          "~~~javascript",
          "const second = absentSecond;",
          "~~~",
          "Between 🧪",
          "```ajs",
          "return absentThird;",
          "```",
          "Trailing é"
        ].join(newline);
      vol.fromJSON({ "/repo/multi.md": source });
      await expect(runHarness("/repo/multi.md", { modulesFor: () => ({}) })).rejects.toMatchObject({
        diagnostics: expect.arrayContaining(
          ["absentFirst", "absentSecond", "absentThird"].map((token) =>
            expect.objectContaining({ code: "AS003", span: originalSpan(source, token) })
          )
        )
      });
    }
  );

  it.each(encodings)(
    "keeps multi-block autofixes local to code spans: %j",
    async ({ newline, bom }) => {
      const source =
        bom +
        [
          "---",
          "kind: validation",
          "---",
          "# 🧩 Prefix",
          "```js",
          'const first = `${"value"}`;',
          "```",
          'Prose `${"value"}` Ω',
          "~~~javascript",
          "return `${first}`;",
          "~~~",
          "Trailing 🧪"
        ].join(newline);
      const expected = source
        .replace('const first = `${"value"}`;', 'const first = String("value");')
        .replace("return `${first}`;", "return String(first);");
      for (const entry of ["cli", "example"]) {
        vol.fromJSON({ "/repo/fix.md": source });
        const stdout = createSink();
        const stderr = createSink();
        const exitCode =
          entry === "cli"
            ? await runCli(["--fix", "/repo/fix.md"], { stdout, stderr, modulesFor: () => ({}) })
            : await runExampleFile("/repo/fix.md", { fix: true, stdout, stderr });
        expect(stderr.output()).toBe("");
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout.output())).toEqual({ ok: true, returnValue: "value" });
        expect(vol.readFileSync("/repo/fix.md", "utf8")).toBe(expected);
      }
    }
  );

  it.each(encodings)(
    "restores a legacy-prefix checkpoint with real replay and hash guards: %j",
    async ({ newline, bom }) => {
      const code =
        ['import { next } from "fixture";', "const saved = next();", "return saved + 1;"].join(
          newline
        ) + newline;
      const source =
        bom +
        ["---", "kind: validation", "---", "# Old 🧩 prefix", "```js", code + "```"].join(newline);
      const legacySource = "\n".repeat(5) + code;
      const firstHost = vi.fn(() => 41);
      const saved = await runModule.run(legacySource, {
        modules: { fixture: { next: firstHost } }
      });
      expect(saved).toMatchObject({ ok: true, returnValue: 42 });
      expect(firstHost).toHaveBeenCalledTimes(1);
      const serialized = await dump(saved);
      const snapshot = JSON.parse(serialized);
      expect(snapshot.sourceHash).toBe(hashSource(legacySource));
      vol.fromJSON({ "/repo/restore.md": source, "/repo/old.json": serialized });
      const nextHost = vi.fn(() => 900);
      const runSpy = vi.spyOn(runModule, "run");
      const stdout = createSink();
      const stderr = createSink();
      expect(
        await runCli(["--restore", "/repo/old.json", "/repo/restore.md"], {
          stdout,
          stderr,
          modulesFor: () => ({ fixture: { next: nextHost } })
        })
      ).toBe(0);
      expect(stderr.output()).toBe("");
      expect(JSON.parse(stdout.output())).toEqual({ ok: true, returnValue: 42 });
      expect(nextHost).not.toHaveBeenCalled();
      const projected = runSpy.mock.calls[0]![0];
      expect(projected).not.toBe(legacySource);
      expect(projected.indexOf("const saved")).toBe(source.indexOf("const saved"));
      expect(hashSource(projected)).toBe(snapshot.sourceHash);
      expect(runSpy.mock.calls[0]![1]?.snapshot?.sourceHash).toBe(snapshot.sourceHash);

      vol.writeFileSync(
        "/repo/restore.md",
        source.replace("# Old 🧩 prefix", "# Changed prose Ω 🧪")
      );
      expect(
        await runCli(["--restore", "/repo/old.json", "/repo/restore.md"], {
          stdout: createSink(),
          stderr: createSink(),
          modulesFor: () => ({ fixture: { next: nextHost } })
        })
      ).toBe(0);
      expect(nextHost).not.toHaveBeenCalled();

      vol.writeFileSync("/repo/restore.md", source.replace("saved + 1", "saved + 2"));
      runSpy.mockClear();
      const mismatch = createSink();
      expect(
        await runCli(["--restore", "/repo/old.json", "/repo/restore.md"], {
          stdout: createSink(),
          stderr: mismatch,
          modulesFor: () => ({ fixture: { next: nextHost } })
        })
      ).not.toBe(0);
      expect(mismatch.output()).toContain("source changed since snapshot was taken");
      expect(runSpy).not.toHaveBeenCalled();
      expect(nextHost).not.toHaveBeenCalled();

      vol.writeFileSync("/repo/restore.md", source);
      const fresh = createSink();
      expect(
        await runCli(["/repo/restore.md"], {
          stdout: fresh,
          stderr: createSink(),
          modulesFor: () => ({ fixture: { next: nextHost } })
        })
      ).toBe(0);
      expect(JSON.parse(fresh.output())).toEqual({ ok: true, returnValue: 901 });
      expect(nextHost).toHaveBeenCalledTimes(1);
    }
  );
});
