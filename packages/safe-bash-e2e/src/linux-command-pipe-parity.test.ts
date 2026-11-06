import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryFileSystem, Shell, pandocCommands } from "@poe-platform/safe-bash";
import { RustWasmBash } from "@poe-code/safe-bash-rust";

// Optional native comparison: PANDOC_BIN must point to Pandoc 3.11.
// Fixtures were generated with -f gfm -t json, then -f json -t html --wrap=none.
const fixtures = new URL("./fixtures/", import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, fixtures), "utf8");

test("Pandoc JSON tables survive TypeScript and bridged Wasm pipes", async () => {
  const input = fixture("pandoc-table.json");
  const createCompanion = () => {
    const fs = new MemoryFileSystem();
    return { fs, shell: new Shell({ fs, cwd: "/" }).use(pandocCommands()) };
  };
  const ts = createCompanion().shell;
  const rust = new RustWasmBash({ forceNative: false, cwd: "/", companionFactory: createCompanion });
  const expected = [
    '<p>Before</p>', '<table>',
    '<colgroup><col><col style="text-align:right"></colgroup>',
    '<thead>', '<tr><th scope="col">A</th><th scope="col" style="text-align:right">B</th></tr>',
    '</thead>', '<tbody>', '<tr><td><strong>x</strong></td><td style="text-align:right">2</td></tr>',
    '</tbody>', '</table>', '<p>After</p>', ''
  ].join("\n");
  try {
    for (const shell of [ts, rust]) {
      const json = await shell.exec("pandoc -f json -t json", { stdin: input });
      assert.equal(json.exitCode, 0, json.stderr);
      assert.deepEqual(JSON.parse(json.stdout), JSON.parse(input));
      const rendered = await shell.exec("pandoc -f json -t html --wrap=none", { stdin: json.stdout });
      assert.equal(rendered.exitCode, 0, rendered.stderr);
      assert.equal(rendered.stdout, expected);
    }
  } finally {
    rust.dispose();
  }
});

test("forceNative Wasm explicitly rejects Pandoc JSON input without losing an existing output file", async () => {
  const rust = new RustWasmBash({ forceNative: true, cwd: "/" });
  try {
    for (const format of ["json", "html"]) {
      for (const output of ["", " -o /result"]) {
        await rust.fs.writeFile("/result", "existing output");
        const result = await rust.exec(`pandoc -f json -t ${format} --wrap=none${output}`, { stdin: fixture("pandoc-table.json") });
        assert.notEqual(result.exitCode, 0);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /requires the TypeScript safe-bash bridge/);
        assert.equal(new TextDecoder().decode(await rust.fs.readFile("/result")), "existing output");
      }
    }
  } finally {
    rust.dispose();
  }
});

test("Pandoc table fixtures match native 3.11", { skip: !process.env.PANDOC_BIN }, () => {
  const native = (args: string[], input: string) => execFileSync(process.env.PANDOC_BIN!, args, { input, encoding: "utf8" });
  assert.match(native(["--version"], ""), /^pandoc 3\.11\n/);
  const generated = native(["-f", "gfm", "-t", "json"], "Before\n\n| A | B |\n| --- | ---: |\n| **x** | 2 |\n\nAfter\n");
  assert.deepEqual(JSON.parse(generated), JSON.parse(fixture("pandoc-table.json")));
  assert.deepEqual(JSON.parse(native(["-f", "json", "-t", "json"], generated)), JSON.parse(generated));
  assert.equal(native(["-f", "json", "-t", "html", "--wrap=none"], generated), fixture("pandoc-table.html"));
});

const plainWrapCases = [
  { name: "sample", input: "one two three four five\n", wrapped: "one two\nthree\nfour\nfive\n" },
  { name: "exact fit", input: "one four five\n", wrapped: "one four\nfive\n" },
  { name: "long word", input: "extraordinary word\n", wrapped: "extraordinary\nword\n" },
  { name: "sustained paragraphs", input: "one two three four five\n\n".repeat(100), wrapped: "one two\nthree\nfour\nfive\n\n".repeat(100).trimEnd() + "\n" },
];

test("Pandoc plain wrapping parity and sustained paragraph timings", async (t) => {
  const createCompanion = () => {
    const fs = new MemoryFileSystem();
    return { fs, shell: new Shell({ fs, cwd: "/" }).use(pandocCommands()) };
  };
  const ts = createCompanion().shell;
  const rust = new RustWasmBash({ forceNative: false, cwd: "/", companionFactory: createCompanion });
  try {
    for (const sample of plainWrapCases) {
      for (const columns of [["--columns=8"], ["--columns", "8"]]) {
        for (const wrap of ["auto", "none"]) {
          const args = ["-f", "gfm", "-t", "plain", ...columns, `--wrap=${wrap}`];
          const expected = wrap === "auto" ? sample.wrapped : sample.input.trimEnd() + "\n";
          if (process.env.PANDOC_BIN) {
            const start = performance.now();
            assert.equal(execFileSync(process.env.PANDOC_BIN, args, { input: sample.input, encoding: "utf8" }), expected);
            if (sample.name === "sustained paragraphs") t.diagnostic(`native ${args.join(" ")}: ${(performance.now() - start).toFixed(1)}ms`);
          }
          for (const [name, shell] of [["TypeScript", ts], ["bridged Rust/Wasm", rust]] as const) {
            const start = performance.now();
            const result = await shell.exec(`pandoc ${args.join(" ")}`, { stdin: sample.input });
            assert.equal(result.exitCode, 0, result.stderr);
            assert.equal(result.stdout, expected, `${name}: ${sample.name} ${args.join(" ")}`);
            if (sample.name === "sustained paragraphs") t.diagnostic(`${name} ${args.join(" ")}: ${(performance.now() - start).toFixed(1)}ms`);
          }
        }
      }
    }
  } finally {
    rust.dispose();
  }
});

test("forceNative rejects plain Pandoc wrapping before writing output", async () => {
  const rust = new RustWasmBash({ forceNative: true, cwd: "/" });
  try {
    for (const columns of ["--columns=8", "--columns 8"]) {
      for (const wrap of ["auto", "none"]) {
        await rust.fs.writeFile("/result", "existing output");
        const result = await rust.exec(`pandoc -f gfm -t plain ${columns} --wrap=${wrap} -o /result`, {
          stdin: plainWrapCases[0].input,
        });
        assert.notEqual(result.exitCode, 0);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /requires the TypeScript safe-bash bridge/);
        assert.equal(new TextDecoder().decode(await rust.fs.readFile("/result")), "existing output");
      }
    }
  } finally {
    rust.dispose();
  }
});

test("Pandoc wrapped plain output retains the converter output budget", async () => {
  const createCompanion = () => {
    const fs = new MemoryFileSystem();
    return { fs, shell: new Shell({ fs, cwd: "/" }).use(pandocCommands({ limits: { outputBytes: 128 } })) };
  };
  const rust = new RustWasmBash({ forceNative: false, companionFactory: createCompanion });
  try {
    for (const shell of [createCompanion().shell, rust]) {
      const result = await shell.exec("pandoc -f gfm -t plain --wrap=auto --columns=8", {
        stdin: "one two three four five ".repeat(20),
      });
      assert.equal(result.exitCode, 7);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /E_LIMIT.*outputBytes/);
    }
  } finally {
    rust.dispose();
  }
});
