import assert from "node:assert/strict";
import { test } from "node:test";
import { gnuInformationSync } from "./gnu-information.js";

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
