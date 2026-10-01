import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem, Shell, agentCommands } from "../../../src/index.js";

test("rg supports shorthand classes (\\d, \\D, \\w, \\W, \\s, \\S) standalone and in brackets", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const res1 = await shell.exec("rg -o 'function\\s+\\w+\\(\\d+\\)' -", {
      stdin: "const x = 1;\nfunction foo_1(42) { return 0; }\n",
    });
    assert.equal(res1.exitCode, 0, res1.stderr);
    assert.equal(res1.stdout, "function foo_1(42)\n");

    const res2 = await shell.exec("rg -o '[\\d\\s]+' -", {
      stdin: "abc 123 456 def\n",
    });
    assert.equal(res2.exitCode, 0, res2.stderr);
    assert.equal(res2.stdout, " 123 456 \n");

    const res3 = await shell.exec("rg -o '\\D+\\W+\\S+' -", {
      stdin: "abc::123\n",
    });
    assert.equal(res3.exitCode, 0, res3.stderr);
    assert.equal(res3.stdout, "abc::123\n");
  } finally {
    await shell.dispose();
  }
});

test("rg supports non-capturing groups (?:...) and word boundaries (\\b, \\B, \\<, \\>)", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const res1 = await shell.exec("rg -o '(?:foo|bar)_\\d+' -", {
      stdin: "foo_12 baz_34 bar_56\n",
    });
    assert.equal(res1.exitCode, 0, res1.stderr);
    assert.equal(res1.stdout, "foo_12\nbar_56\n");

    const res2 = await shell.exec("rg -o '\\bcat\\b' -", {
      stdin: "cat scatter bobcat cat!\n",
    });
    assert.equal(res2.exitCode, 0, res2.stderr);
    assert.equal(res2.stdout, "cat\ncat\n");

    const res3 = await shell.exec("rg -o '\\Bcat\\B' -", {
      stdin: "cat scatter bobcat\n",
    });
    assert.equal(res3.exitCode, 0, res3.stderr);
    assert.equal(res3.stdout, "cat\n");
  } finally {
    await shell.dispose();
  }
});

test("rg supports lazy quantifiers (*?, +?, ??, {m,n}?)", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const res1 = await shell.exec("rg -o 'a+?' -", { stdin: "aaaa\n" });
    assert.equal(res1.exitCode, 0, res1.stderr);
    assert.equal(res1.stdout, "a\na\na\na\n");

    const res2 = await shell.exec("rg -o '<tag>.*?</tag>' -", {
      stdin: "<tag>first</tag><tag>second</tag>\n",
    });
    assert.equal(res2.exitCode, 0, res2.stderr);
    assert.equal(res2.stdout, "<tag>first</tag>\n<tag>second</tag>\n");

    const res3 = await shell.exec("rg -o 'a{2,4}?' -", { stdin: "aaaa\n" });
    assert.equal(res3.exitCode, 0, res3.stderr);
    assert.equal(res3.stdout, "aa\naa\n");
  } finally {
    await shell.dispose();
  }
});

test("rg supports cross-line multiline matching (-U / --multiline and --multiline-dotall)", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile(
    "/sample.txt",
    new TextEncoder().encode("line1\nalpha\nbeta\ngamma\nstart\n  middle\nend\n"),
  );
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const res1 = await shell.exec("rg -U -n 'alpha\\nbeta' /sample.txt");
    assert.equal(res1.exitCode, 0, res1.stderr);
    assert.equal(res1.stdout, "2:alpha\n3:beta\n");

    const res2 = await shell.exec("rg -U -o 'start[\\s\\S]*?end' /sample.txt");
    assert.equal(res2.exitCode, 0, res2.stderr);
    assert.equal(res2.stdout, "start\n  middle\nend\n");

    const res3 = await shell.exec("rg -U --multiline-dotall -o 'alpha.*?gamma' /sample.txt");
    assert.equal(res3.exitCode, 0, res3.stderr);
    assert.equal(res3.stdout, "alpha\nbeta\ngamma\n");
  } finally {
    await shell.dispose();
  }
});

test("grep supports BRE escapes (\\|, \\+, \\?, \\(, \\), \\{m,n\\}) and shorthand classes", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const res1 = await shell.exec("grep 'foo\\|bar\\+'", {
      stdin: "foo\nbarrr\nbaz\n",
    });
    assert.equal(res1.exitCode, 0, res1.stderr);
    assert.equal(res1.stdout, "foo\nbarrr\n");

    const res2 = await shell.exec("grep -o '\\(ab\\)\\{2\\}\\d\\+'", {
      stdin: "xxabab99yy\n",
    });
    assert.equal(res2.exitCode, 0, res2.stderr);
    assert.equal(res2.stdout, "abab99\n");

    const res3 = await shell.exec("grep -E -o '\\b(?:cat|dog)_\\w+\\b'", {
      stdin: "my cat_1 and dog_two and bird_3\n",
    });
    assert.equal(res3.exitCode, 0, res3.stderr);
    assert.equal(res3.stdout, "cat_1\ndog_two\n");
  } finally {
    await shell.dispose();
  }
});

test("sed and awk support ergonomic shorthand classes (\\d, \\w, \\s) and non-capturing groups (?:...)", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const sedRes = await shell.exec("sed -E 's/(?:item|sku)_(\\w+):\\s*(\\d+)/\\1=\\2/g'", {
      stdin: "item_alpha: 42 and sku_beta:  99\n",
    });
    assert.equal(sedRes.exitCode, 0, sedRes.stderr);
    assert.equal(sedRes.stdout, "alpha=42 and beta=99\n");

    const awkRes = await shell.exec("awk '/^(?:ERR|WARN)\\s+\\d+\\s+\\w+/ { print $2, $3 }'", {
      stdin: "INFO 100 ok\nERR 503 timeout\nWARN  429 throttled\n",
    });
    assert.equal(awkRes.exitCode, 0, awkRes.stderr);
    assert.equal(awkRes.stdout, "503 timeout\n429 throttled\n");

    const sedWordBoundary = await shell.exec("sed -E 's/\\bfoo\\b/BAR/g; s/\\<cat\\>/DOG/g'", {
      stdin: "foo foobar barfoo cat catfish\n",
    });
    assert.equal(sedWordBoundary.exitCode, 0, sedWordBoundary.stderr);
    assert.equal(sedWordBoundary.stdout, "BAR foobar barfoo DOG catfish\n");

    // AWK uses \y for word boundaries; \b remains a literal backspace.
    const awkWordBoundary = await shell.exec("awk '/\\ytarget\\y/ { print $1 }'", {
      stdin: "hit target now\nskip target_2 now\n",
    });
    assert.equal(awkWordBoundary.exitCode, 0, awkWordBoundary.stderr);
    assert.equal(awkWordBoundary.stdout, "hit\n");

    const awkBackspace = await shell.exec("awk '/\\btarget\\b/ { print $1 }'", {
      stdin: "skip target now\nskip target_2 now\nhit \btarget\b now\n",
    });
    assert.equal(awkBackspace.exitCode, 0, awkBackspace.stderr);
    assert.equal(awkBackspace.stdout, "hit\n");
  } finally {
    await shell.dispose();
  }
});

test("shared regex syntax works through sed, awk, jq, rg, and fd", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/README.md", new TextEncoder().encode("FOObar\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    for (const [command, stdin, stdout] of [
      [String.raw`sed -E 's/[\d]+/NUM/g'`, "foo 123\n", "foo NUM\n"],
      [String.raw`sed -E 's/[\w]+/W/g'`, "foo 123\n", "W W\n"],
      [String.raw`sed 's/\(?:foo\)/X/g'`, "foo foobar\n", "X Xbar\n"],
      [String.raw`awk '{ gsub(/[\d]+/, "NUM"); print }'`, "foo 123\n", "foo NUM\n"],
      [String.raw`awk '{ gsub(/[\s]+/, "|"); print }'`, "foo 123\n", "foo|123\n"],
      [String.raw`jq -r 'gsub("[\\d]+"; "NUM")'`, '"foo 123"\n', "foo NUM\n"],
      [String.raw`rg -o '^(?i)foobar' /README.md`, "", "FOObar\n"],
      [String.raw`rg -o '(?i:foo)bar' /README.md`, "", "FOObar\n"],
      [String.raw`fd '^(?i)readme' /`, "", "/README.md\n"],
      [String.raw`fd '(?i:readme)\.md' /`, "", "/README.md\n"],
    ]) {
      const result = await shell.exec(command!, { stdin: stdin! });
      assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
      assert.equal(result.stderr, "", command);
      assert.equal(result.stdout, stdout, command);
    }
  } finally { await shell.dispose(); }
});

test("rg applies inline dot-all and scoped anchor flags across multiline input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    for (const [pattern, expected, status] of [
      ["(?s)foo.bar", "foo\nbar\n", 0],
      ["(?m)^bar", "bar\n", 0],
      ["(?-m)^bar", "", 1],
      ["(?m:^bar)(?-m:$)", "", 1],
    ] as const) {
      const result = await shell.exec(`rg -U -o '${pattern}' -`, { stdin: "foo\nbar\nbaz\n" });
      assert.equal(result.stderr, "", pattern);
      assert.equal(result.exitCode, status, pattern);
      assert.equal(result.stdout, expected, pattern);
    }
  } finally { await shell.dispose(); }
});
