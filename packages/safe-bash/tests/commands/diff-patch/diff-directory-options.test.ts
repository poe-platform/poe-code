import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";

for (const [pattern, excluded, retained] of [
  ["[[:alpha:]]*.txt", "a.txt", "1.txt"],
  ["[]a]*", "]file", "bfile"],
  ["[!]]*", "afile", "]file"],
] as const) {
  for (const option of ["-x", "--exclude", "-X", "--exclude-from"]) {
    test(`${option} handles ${pattern}`, async () => {
      const fromFile = option === "-X" || option === "--exclude-from";
      const actual = await run("diff", ["-r", option, fromFile ? "patterns" : pattern, "left", "right"], {
        files: { patterns: pattern + "\n", [`left/${excluded}`]: "old\n", [`right/${excluded}`]: "new\n",
          [`left/${retained}`]: "old\n", [`right/${retained}`]: "new\n" },
      });
      assert.equal(actual.exitCode, 1);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout, `diff -r ${option} ${fromFile ? "patterns" : `'${pattern}'`} left/${retained} right/${retained}\n1c1\n< old\n---\n> new\n`);
    });
  }
}

for (const format of ["", "u", "c", "e", "n", "y"]) {
  for (const labels of [[], ["old label"], ["old label", "new label"]]) {
    test(`directory -r${format} quotes paths and uses ${labels.length} explicit labels`, async () => {
      const actual = await run("diff", [`-r${format}`, ...labels.flatMap(label => ["-L", label]), "left dir", "right dir"], {
        files: { "left dir/f": "old\n", "right dir/f": "new\n" },
      });
      const labelOptions = labels.map(label => ` -L '${label}'`).join("");
      assert.equal(actual.exitCode, 1, actual.stderr);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout.split("\n")[0], `diff -r${format}${labelOptions} "${labels[0] ?? "left dir/f"}" "${labels[1] ?? "right dir/f"}"`);
      if (format === "u" || format === "c") {
        assert.deepEqual(actual.stdout.split("\n").slice(1, 3), [
          `${format === "u" ? "---" : "***"} ${labels[0] ?? '"left dir/f"'}`,
          `${format === "u" ? "+++" : "---"} ${labels[1] ?? '"right dir/f"'}`,
        ]);
      }
    });
  }
}

for (const [options, expected] of [
  [["-I", "^#"], "-I '^#'"],
  [["-I", "^# comment"], "-I '^# comment'"],
  [["-x", "skip me"], "-x 'skip me'"],
  [["--exclude=skip me"], "'--exclude=skip me'"],
  [["--exclude=plain"], "'--exclude=plain'"],
  [["-x", ""], "-x ''"],
  [["-x", "a=b"], "-x 'a=b'"],
  [["-x", "#comment"], "-x '#comment'"],
  [["-x", "~user"], "-x '~user'"],
  [["-x", "a^b"], "-x 'a^b'"],
  [["-x", "a'b"], '-x "a\'b"'],
  [["-x", 'a"b'], '-x \'a"b\''],
  [["-x", "a\\b"], "-x 'a\\b'"],
  [["-x", "a'\"b"], "-x 'a'\\''\"b'"],
  [["-x", "a'!b"], "-x 'a'\\''!b'"],
  [["-x", "a' b"], '-x "a\' b"'],
  [["-x", "{"], "-x '{'"],
  [["-x", "}"], "-x '}'"],
  [["-x", "a\vb"], "-x a\vb"],
  [["-x", "a\nb"], "-x 'a\nb'"],
  [["-x", "a#~{}]+:,%@é"], "-x a#~{}]+:,%@é"],
] as const) {
  test(`directory section header quotes option arguments ${JSON.stringify(options)}`, async () => {
    const actual = await run("diff", ["-ry", ...options, "left", "right"], {
      files: { "left/f": "old\n", "right/f": "new\n" },
    });
    assert.equal(actual.exitCode, 1, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdout, `diff -ry ${expected} left/f right/f\nold\t\t\t\t\t\t\t      |\tnew\n`);
  });
}

for (const [name, expected] of [
  ['dir"name', '"dir\\"name/f"'],
  ["dir\\name", '"dir\\\\name/f"'],
  ["dir'name", "dir'name/f"],
  ["dir;name", "dir;name/f"],
  ["dir\vname", '"dir\\vname/f"'],
  ["dir\fname", '"dir\\fname/f"'],
  ["diré", '"dir\\303\\251/f"'],
  ["dir\u007fname", "dir\u007fname/f"],
  ["dir \u007fname", '"dir \u007fname/f"'],
] as const) {
  test(`identical directory side-by-side section quotes ${JSON.stringify(name)}`, async () => {
    const actual = await run("diff", ["-ry", name, "right"], {
      files: { [`${name}/f`]: "same\n", "right/f": "same\n" },
    });
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdout, `diff -ry ${expected} right/f\nsame\t\t\t\t\t\t\t\tsame\n`);
  });
}

for (const format of ["u", "c", "e", "n"]) {
  test(`directory -r${format} emits a command header`, async () => {
    const actual = await run("diff", [`-r${format}`, "left", "right"], {
      files: { "left/f": "old\n", "right/f": "new\n", "left/same": "same\n", "right/same": "same\n" },
    });
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.stderr, "");
    assert.ok(actual.stdout.startsWith(`diff -r${format} left/f right/f\n`));
    assert.ok(!actual.stdout.includes("diff -r" + format + " left/same"));
  });
}

for (const fixture of [
  { flags: [], old: "same\n", next: "same\n", body: "same\t\t\t\t\t\t\t\tsame\n" },
  { flags: [], old: "", next: "", body: "" },
  { flags: ["-i"], old: "A\n", next: "a\n", body: "A\t\t\t\t\t\t\t\ta\n" },
  { flags: ["-B"], old: "a\n", next: "a\n\n", body: "a\t\t\t\t\t\t\t\ta\n\t\t\t\t\t\t\t      )\n" },
]) for (const reportSame of [false, true]) for (const suppressCommon of [false, true]) {
  test(`GNU directory side-by-side equal files: ${JSON.stringify({ fixture, reportSame, suppressCommon })}`, async () => {
    const flags = ["-ry", ...fixture.flags, ...(reportSame ? ["-s"] : []), ...(suppressCommon ? ["--suppress-common-lines"] : [])];
    const actual = await run("diff", [...flags, "left", "right"], { files: { "left/f": fixture.old, "right/f": fixture.next } });
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdout, (suppressCommon ? "" : `diff ${flags.join(" ")} left/f right/f\n${fixture.body}`)
      + (reportSame ? "Files left/f and right/f are identical\n" : ""));
  });
}

test("directory side-by-side labels both different and identical file sections", async () => {
  const actual = await run("diff", ["-ry", "left", "right"], {
    files: { "left/f": "old\n", "right/f": "new\n", "left/same": "same\n", "right/same": "same\n" },
  });
  assert.equal(actual.exitCode, 1);
  assert.equal(actual.stderr, "");
  assert.equal(actual.stdout, "diff -ry left/f right/f\nold\t\t\t\t\t\t\t      |\tnew\n"
    + "diff -ry left/same right/same\nsame\t\t\t\t\t\t\t\tsame\n");
});

for (const option of ["-D", "--ifdef"]) {
  for (const operands of [["left", "right"], ["left", "right/f"], ["left/f", "right"]]) {
    test(`${option} rejects directory operands ${operands.join(" ")}`, async () => {
      const actual = await run("diff", [option, "SYM", ...operands], { files: { "left/f": "old\n", "right/f": "new\n" } });
      assert.equal(actual.exitCode, 2);
      assert.equal(actual.stdout, "");
      assert.equal(actual.stderr, "diff: -D option not supported with directories\n");
    });
  }
}

test("diff -P (--unidirectional-new-file), --strip-trailing-cr, and identical non-UTF-8 files", async () => {
  const unidirectional = await run("diff", ["-P", "d1", "d2"], {
    files: { "d1/only1": "one\n", "d2/only2": "two\n" },
  });
  assert.equal(unidirectional.exitCode, 1, unidirectional.stderr);
  assert.equal(unidirectional.stdout, "Only in d1: only1\ndiff -P d1/only2 d2/only2\n0a1\n> two\n");

  const cr = await run("diff", ["--strip-trailing-cr", "a", "b"], {
    files: { a: "hello\r\n", b: "hello\n" },
  });
  assert.equal(cr.exitCode, 0, cr.stderr);
  assert.equal(cr.stdout, "");

  const identicalNonUtf8 = await run("diff", ["-s", "a", "b"], {
    files: { a: Buffer.from([0xff, 0x0a]), b: Buffer.from([0xff, 0x0a]) },
  });
  assert.equal(identicalNonUtf8.exitCode, 0, identicalNonUtf8.stderr);
  assert.equal(identicalNonUtf8.stdout, "Files a and b are identical\n");
});

for (const option of ["-P", "--unidirectional-new-file"]) test(`${option} adds only missing left files recursively`, async () => {
  const result = await run("diff", ["-r", option, "left", "right"], {
    files: { "left/only": "old\n", "right/sub/added": "new\n" },
  });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, `Only in left: only\ndiff -r ${option} left/sub/added right/sub/added\n0a1\n> new\n`);
});

test("strip-trailing-cr strips CRLF but preserves a CR at EOF", async () => {
  const result = await run("diff", ["--strip-trailing-cr", "left", "right"], { files: { left: "hello\r", right: "hello" } });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "1c1\n< hello\r\n\\ No newline at end of file\n---\n> hello\n\\ No newline at end of file\n");
});

test("filename case folding pairs real spellings and preserves colliding names", async () => {
  const files = { "left/Foo": "old\n", "left/foo": "same\n", "right/FOO": "new\n", "right/foo": "same\n" };
  const result = await run("diff", ["--ignore-file-name-case", "left", "right"], { files });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "diff --ignore-file-name-case left/Foo right/FOO\n1c1\n< old\n---\n> new\n");
  const exact = await run("diff", ["--ignore-file-name-case", "--no-ignore-file-name-case", "left", "right"], { files });
  assert.equal(exact.exitCode, 1, exact.stderr);
  assert.equal(exact.stdout, "Only in right: FOO\nOnly in left: Foo\n");
});

for (const option of ["--from-file", "--to-file"]) for (const attached of [false, true]) for (const count of [1, 2, 3]) {
  test(`${option} compares every operand in order: attached=${attached}, count=${count}`, async () => {
    const args = [...(attached ? [`${option}=base`] : [option, "base"]), ...["a", "b", "c"].slice(0, count)];
    const result = await run("diff", args, { files: { base: "base\n", a: "A\n", b: "B\n", c: "C\n" } });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, ["A", "B", "C"].slice(0, count).map(value => option === "--from-file"
      ? `1c1\n< base\n---\n> ${value}\n` : `1c1\n< ${value}\n---\n> base\n`).join(""));
  });
}

test("filename folding keeps exact matches first and does not reuse their paths", async () => {
  for (const reverse of [false, true]) {
    const result = await run("diff", ["--ignore-file-name-case", ...(reverse ? ["right", "left"] : ["left", "right"])], {
      files: { "left/foo": "same\n", "right/Foo": "extra\n", "right/foo": "same\n" },
    });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, "Only in right: Foo\n");
  }
});

test("folded comparisons emit paired files in left spelling order before unmatched entries", async () => {
  const result = await run("diff", ["-q", "--ignore-file-name-case", "left", "right"], {
    files: { "left/FOO": "old\n", "left/foo": "old\n", "right/Foo": "new\n", "right/foo": "new\n" },
  });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "Files left/FOO and right/Foo differ\nFiles left/foo and right/foo differ\n");
});

for (const fromFile of [false, true]) test(`exclusions capture filename case mode when parsed: file=${fromFile}`, async () => {
  const exclusion = fromFile ? ["-X", "patterns"] : ["-x", "foo"];
  const files = { patterns: "foo\n", "left/Foo": "old\n", "right/Foo": "new\n" };
  const folded = await run("diff", ["--ignore-file-name-case", ...exclusion, "--no-ignore-file-name-case", "left", "right"], { files });
  assert.equal(folded.exitCode, 0, folded.stderr);
  assert.equal(folded.stdout, "");
  const exact = await run("diff", [...exclusion, "--ignore-file-name-case", "left", "right"], { files });
  assert.equal(exact.exitCode, 1, exact.stderr);
  assert.match(exact.stdout, /< old\n---\n> new\n/u);
});

for (const option of ["--from-file", "--to-file"]) test(`${option} continues across missing operands`, async () => {
  const result = await run("diff", [option, "base", "a", "missing", "b"], { files: { base: "base\n", a: "A\n", b: "B\n" } });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /missing/u);
  assert.equal(result.stdout, ["A", "B"].map(value => option === "--from-file"
    ? `1c1\n< base\n---\n> ${value}\n` : `1c1\n< ${value}\n---\n> base\n`).join(""));
});

for (const [pattern, expectedNames] of [["[A-Z]", ["É", "é"]], ["[[:upper:]]", ["a", "É", "é"]], ["É", ["A", "a", "é"]]] as const) {
  test(`case-insensitive exclusions preserve C-locale classes: ${pattern}`, async () => {
    const files = Object.fromEntries(["A", "a", "É", "é"].flatMap(name => [[`left/${name}`, "old\n"], [`right/${name}`, "new\n"]]));
    const result = await run("diff", ["-q", "--ignore-file-name-case", "-x", pattern, "left", "right"], { files });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, expectedNames.map(name => `Files left/${name} and right/${name} differ\n`).join(""));
  });
}

for (const [pattern, retained] of [["[A-]", ["_", "Z", "z"]], ["[a-]", ["_", "Z", "z"]], ["[A-a]", ["-", "_", "Z", "z"]], ["[Z-a]", ["-", "_", "A", "a", "Z", "z"]]] as const) {
  test(`folded glob preserves range endpoints and literal hyphens: ${pattern}`, async () => {
    const files = Object.fromEntries(["-", "_", "A", "a", "Z", "z"].flatMap(name => [[`left/${name}`, "old\n"], [`right/${name}`, "new\n"]]));
    const result = await run("diff", ["-q", "--ignore-file-name-case", "-x", pattern, "left", "right"], { files });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, retained.map(name => `Files left/${name} and right/${name} differ\n`).join(""));
  });
}
