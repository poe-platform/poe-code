import assert from "node:assert/strict";
import { test } from "node:test";
import { gnuInformationSync } from "./gnu-information.js";

test("readlink information scanning stops at the first POSIX operand", () => {
 for (const option of ["--help", "--version"]) {
  const information = gnuInformationSync("readlink", [option]);
  assert.ok(information);
  for (const operand of ["link", "-"]) {
   assert.equal(gnuInformationSync("readlink", [operand, option], false, true), undefined);
   assert.equal(gnuInformationSync("readlink", [operand, option]), information);
   assert.equal(gnuInformationSync("readlink", ["--", operand, option]), undefined);
  }
  assert.equal(gnuInformationSync("readlink", ["-f", option, "link"], false, true), information);
 }
});

test("comm information scanning stops at the first POSIX operand", () => {
  for (const option of ["--help", "--version"]) {
    const information = gnuInformationSync("comm", [option]);
    assert.ok(information);
    for (const operand of ["left", "-"]) {
      assert.equal(gnuInformationSync("comm", [operand, option], false, true), undefined);
      assert.equal(gnuInformationSync("comm", [operand, option]), information);
      assert.equal(gnuInformationSync("comm", ["--", operand, option]), undefined);
    }
    assert.equal(gnuInformationSync("comm", ["--output-delimiter", ":", option], false, true), information);
    assert.equal(gnuInformationSync("comm", ["--output-delimiter", option], false, true), undefined);
  }
});

test("paste information prefixes use the synchronous option scan", () => {
  for (const [args, option] of [
    [["--he"], "--help"],
    [["--vers"], "--version"],
    [["--ser", "--version"], "--version"],
    [["--del=:", "--he"], "--help"],
    [["--del", "--help", "--vers"], "--version"],
  ] as const) {
    assert.equal(gnuInformationSync("paste", args), gnuInformationSync("paste", [option]));
  }
  for (const args of [["--", "--he"], ["--del", "--help"], ["--he=yes", "--version"], ["rows", "--vers"]]) {
    assert.equal(gnuInformationSync("paste", args, false, true), undefined);
  }
});

test("other commands retain their information option rules", () => {
  assert.equal(gnuInformationSync("sort", ["--vers"]), undefined);
  assert.equal(gnuInformationSync("cat", ["--help"]), undefined);
  assert.equal(gnuInformationSync("echo", ["--version"]), undefined);
  assert.equal(gnuInformationSync("echo", ["--version"], true), "echo (safe-bash virtual implementation)\n");
  assert.equal(gnuInformationSync("sort", ["--version-sort", "--version"]), "sort (safe-bash virtual implementation)\n");
  assert.equal(gnuInformationSync("sort", ["-o", "--help"]), undefined);
});

for (const name of ["basename", "dirname"]) {
  test(`${name} information prefixes preserve option and operand boundaries`, () => {
    for (const option of ["--help", "--version"]) {
      const information = gnuInformationSync(name, [option]);
      assert.ok(information);
      for (let length = 3; length <= option.length; length++) {
        const prefix = option.slice(0, length);
        for (const posix of [false, true]) {
          assert.equal(gnuInformationSync(name, [prefix], false, posix), information);
          assert.equal(gnuInformationSync(name, ["--ze", prefix], false, posix), information);
          assert.equal(gnuInformationSync(name, ["--", prefix], false, posix), undefined);
          assert.equal(gnuInformationSync(name, ["dir/file", prefix], false, posix),
            name === "dirname" && !posix ? information : undefined);
          assert.equal(gnuInformationSync(name, [`${prefix}=yes`, option], false, posix), undefined);
          assert.equal(gnuInformationSync(name, ["--unknown", prefix], false, posix), undefined);
          if (name === "basename") {
            assert.equal(gnuInformationSync(name, ["--su", prefix, "dir/file"], false, posix), undefined);
            assert.equal(gnuInformationSync(name, ["--su", ".txt", prefix], false, posix), information);
            assert.equal(gnuInformationSync(name, ["--su=.txt", prefix], false, posix), information);
          }
        }
      }
    }
  });
}

test("fold leaves information and operand parsing to its command", () => {
  for (const args of [["--help"], ["--version"], ["-w2", "--help"], ["a", "--help"], ["--", "--help"], ["--width", "--help"]]) {
    for (const posix of [false, true]) {
      assert.equal(gnuInformationSync("fold", args, false, posix), undefined);
    }
  }
});
