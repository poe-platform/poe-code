import assert from "node:assert/strict";
import test from "node:test";
import { diffPatchCommands } from "../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../src/shell/index.js";
import { filesystem, run } from "./helpers.js";

test("diff rejects a newline-dense exclusion file with a normal limit diagnostic", async () => {
  const fs = await filesystem({ exclude: "a\n".repeat(8), left: "same\n", right: "same\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(diffPatchCommands({ maxExcludePatterns: 4 }));
  const result = await shell.exec("diff -X exclude left right");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "diff: exclusion pattern count limit exceeded\n");
});

test("diff shares the exclusion count across arguments, files and stdin", async () => {
  for (const maxExcludePatterns of [3, 4]) {
    const result = await run("diff", ["-x", "a", "-X", "first", "--exclude-from=second", "-X", "-", "left", "right"], {
      files: { first: "\nb\n\n", second: "c", left: "same", right: "same" }, input: "d\n",
      options: { maxExcludePatterns },
    });
    assert.equal(result.exitCode, maxExcludePatterns === 4 ? 0 : 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, maxExcludePatterns === 4 ? "" : "diff: exclusion pattern count limit exceeded\n");
  }
});

test("diff shares the UTF-8 exclusion byte limit across arguments, files and stdin", async () => {
  for (const maxExcludePatternBytes of [7, 8]) {
    const result = await run("diff", ["--exclude=a", "-X", "first", "--exclude-from=second", "-X", "-", "left", "right"], {
      files: { first: "é\n", second: "😀", left: "same", right: "same" }, input: "*\n",
      options: { maxExcludePatternBytes },
    });
    assert.equal(result.exitCode, maxExcludePatternBytes === 8 ? 0 : 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, maxExcludePatternBytes === 8 ? "" : "diff: exclusion pattern byte limit exceeded\n");
  }
});

test("diff bounds a single exclusion before compiling or comparing files", async () => {
  const backing = await filesystem({ exclude: "a".repeat(33), left: "same", right: "same" });
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "lstat") return async (...args: Parameters<typeof target.lstat>) => {
        assert.notEqual(args[0], "/work/left", "comparison must not start after an exclusion limit failure");
        return target.lstat(...args);
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const result = await run("diff", ["-X", "exclude", "left", "right"], { fs, options: { maxExcludePatternBytes: 32, maxExcludePatterns: 4 } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "diff: exclusion pattern byte limit exceeded\n");
});

for (const line of ["a\n", "\n"]) test(`diff charges work for exclusion lines ${JSON.stringify(line)}`, async () => {
  const result = await run("diff", ["--exclude-from=exclude", "left", "right"], {
    files: { exclude: line.repeat(128), left: "same", right: "same" }, options: { maxWork: 100 },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "diff: work limit exceeded\n");
});

test("diff exclusion ingestion yields for cancellation even for blank lines", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel exclusion ingestion");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const input = (async function* () {
    timer = setTimeout(() => controller.abort(reason), 0);
    yield Buffer.from("\n".repeat(20_000));
  })();
  try {
    await assert.rejects(run("diff", ["-X", "-", "left", "right"], {
      files: { left: "same", right: "same" }, input, signal: controller.signal,
    }), error => error === reason);
  } finally { clearTimeout(timer); }
});

test("diff exclusion files preserve globs, whitespace and unterminated last lines", async () => {
  const result = await run("diff", ["-r", "-X", "exclude", "left", "right"], {
    files: { exclude: "\n*.tmp\n spaced \ncr\r\nlast", "left/keep": "same", "right/keep": "same",
      "left/a.tmp": "excluded", "left/ spaced ": "excluded", "left/cr": "retained", "left/last": "excluded",
      "left/spaced": "retained" },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "Only in left: cr\nOnly in left: spaced\n");
  assert.equal(result.stderr, "");
});

test("diff validates exclusion limits before reading inputs", async () => {
  for (const name of ["maxExcludePatterns", "maxExcludePatternBytes"] as const) {
    for (const value of [0, -1, 0.5, NaN, Infinity]) {
      const result = await run("diff", ["-X", "missing", "left", "right"], { options: { [name]: value } });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr, `diff: ${name} must be a positive safe integer\n`);
    }
  }
});
