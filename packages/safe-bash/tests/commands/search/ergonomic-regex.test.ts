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
