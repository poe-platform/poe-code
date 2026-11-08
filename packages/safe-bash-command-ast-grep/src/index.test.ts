import { it, expect } from "vitest";
import { createAstGrepCommands } from "./index.js";
import { run } from "./test-support.js";

it("registers ast-grep and sg", () =>
  expect(createAstGrepCommands().map((c) => c.name)).toEqual(["ast-grep", "sg"]));
it("searches directories structurally and emits UTF-8 ranges and captures", async () => {
  const result = await run(["-p", "console.log($A)", "--json=compact"], {
    "/a.ts": "// é\nconsole.log(value);",
    "/b.txt": "console.log(no);"
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject([
    {
      file: "a.ts",
      text: "console.log(value)",
      range: { byteOffset: { start: 6, end: 24 } },
      metaVariables: { single: { A: { text: "value" } } }
    }
  ]);
});
it("run rewrites only with update-all and preserves untouched trivia", async () => {
  const args = [
    "run",
    "-p",
    "console.log($$$ARGS)",
    "-r",
    "logger.info($$$ARGS)",
    "-l",
    "ts",
    "a.ts"
  ];
  const files = { "/a.ts": "  console.log(a, /*keep*/ b); // hi\n" };
  const preview = await run(args, files);
  expect(new TextDecoder().decode(await preview.fs.readFile("/a.ts"))).toBe(files["/a.ts"]);
  expect(preview.stdout).toContain("logger.info(a, /*keep*/ b)");
  const updated = await run([...args, "-U"], files);
  expect(updated.exitCode).toBe(0);
  expect(new TextDecoder().decode(await updated.fs.readFile("/a.ts"))).toBe(
    "  logger.info(a, /*keep*/ b); // hi\n"
  );
});
it("scans YAML rules from VFS and inline multi-documents", async () => {
  const yaml =
    "id: log\nlanguage: TypeScript\nrule:\n  pattern: console.log($X)\nfix: logger.info($X)\nmessage: Use logger\nseverity: warning\n";
  for (const args of [
    ["-r", "rule.yml"],
    ["--inline-rules", yaml]
  ]) {
    const result = await run(["scan", ...args, "--json=stream", "-U", "a.ts"], {
      "/rule.yml": yaml,
      "/a.ts": "console.log(a);"
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ruleId: "log",
      message: "Use logger",
      severity: "warning",
      replacement: "logger.info(a)"
    });
    expect(new TextDecoder().decode(await result.fs.readFile("/a.ts"))).toBe("logger.info(a);");
  }
});
it("filters globs and renders headings and context", async () => {
  const result = await run(
    ["-p", "f($X)", "--globs", "*.ts", "--globs", "!skip*", "--heading=always", "-C", "1"],
    { "/a.ts": "// before\nf(a);\n// after\n", "/skip.ts": "f(b);", "/x.js": "f(c);" }
  );
  expect(result.stdout).toBe("a.ts\n1-// before\n2:f(a);\n3-// after\n");
});
it.each([
  ["ts", "f(a)", "f($X)"],
  ["tsx", "<X a={b} />", "<X a={$V} />"],
  ["js", "f(a)", "f($X)"],
  ["jsx", "<X />", "<X />"],
  ["json", '{"x":1}', '{"x":$V}'],
  ["yaml", "a: 1", "a: 1"],
  ["html", "<b>ok</b>", "<b>ok</b>"],
  ["css", "a {color: red;}", "color: $V;"]
])("reads %s stdin", async (lang, source, pattern) => {
  const result = await run(["--stdin", "-l", lang, "-p", pattern, "--json"], {}, source);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).length).toBeGreaterThan(0);
});
it("returns no-match and usage error statuses", async () => {
  expect((await run(["--stdin", "-l", "ts", "-p", "f($X)"], {}, "g(a)")).exitCode).toBe(1);
  for (const args of [
    [],
    ["-p"],
    ["--stdin", "-p", "x"],
    ["scan", "--inline-rules", "rule: {bogus: true}"],
    ["-p", "x", "-C", "no"],
    ["-p", "x", "--wat"]
  ])
    expect((await run(args)).exitCode).toBe(2);
});
it("enforces input, file, match and output quotas", async () => {
  for (const options of [
    { maxInputBytes: 2 },
    { maxMatches: 1 },
    { maxOutputBytes: 2 },
    { maxFiles: 1 }
  ]) {
    const result = await run(
      ["-p", "f($X)", "--json"],
      { "/a.ts": "f(a); f(b);", "/b.ts": "f(c);" },
      "",
      options
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/limit|EFBIG/);
  }
});
it("propagates cancellation without VFS effects", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  await expect(run(["-p", "x"], {}, "", {}, { signal: controller.signal })).rejects.toThrow("stop");
});
it("rewrites relational rule captures without reparsing away ancestors", async () => {
  const rules =
    "id: nested\nlanguage: TypeScript\nrule:\n  all:\n    - pattern: f($X)\n    - inside: {kind: FunctionDeclaration}\nfix: g($X)\n";
  const result = await run(["scan", "--inline-rules", rules, "-U", "a.ts"], {
    "/a.ts": "function x() { f(a); } f(b);"
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(await result.fs.readFile("/a.ts"))).toBe(
    "function x() { g(a); } f(b);"
  );
});
it("compact JSON is a single line and stream emits each match independently", async () => {
  for (const format of ["compact", "pretty", "stream"]) {
    const result = await run(
      ["--stdin", "-l", "ts", "-p", "f($X)", "--json=" + format],
      {},
      "f(a);f(b);"
    );
    expect(result.exitCode).toBe(0);
    if (format === "compact") expect(result.stdout.trim().split("\n")).toHaveLength(1);
    if (format === "stream")
      expect(
        result.stdout
          .trim()
          .split("\n")
          .map((row) => JSON.parse(row).text)
      ).toEqual(["f(a)", "f(b)"]);
    else expect(JSON.parse(result.stdout)).toHaveLength(2);
  }
});
it("preserves UTF-8 when rewriting nested matches and rejects conflicting scan edits", async () => {
  const result = await run(["-p", "f($X)", "-r", "g($X)", "-U", "a.ts"], {
    "/a.ts": "// é\nf(f(a));"
  });
  expect(new TextDecoder().decode(await result.fs.readFile("/a.ts"))).toBe("// é\ng(f(a));");
  const rules =
    'id: one\nlanguage: TS\nrule: {pattern: "f($X)"}\nfix: g($X)\n---\nid: two\nlanguage: TS\nrule: {pattern: "f($X)"}\nfix: h($X)';
  const conflict = await run(["scan", "--inline-rules", rules, "--json", "-U", "a.ts"], {
    "/a.ts": "f(a);"
  });
  expect(conflict.exitCode).toBe(2);
  expect(new TextDecoder().decode(await conflict.fs.readFile("/a.ts"))).toBe("f(a);");
});
