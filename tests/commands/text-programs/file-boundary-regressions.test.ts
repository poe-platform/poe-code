import test from "node:test";
import { compareNative } from "./helpers.js";

test("sed inserts a separator between unterminated input files", () => compareNative("sed", {
  args: ["-n", "=;p", "first", "empty", "last"], files: { first: "one", empty: "", last: "two\n" },
}));

test("sed distinguishes repeated filenames as separate input occurrences", () => compareNative("sed", {
  args: ["-n", "p", "input", "input"], files: { input: "one" },
}));

test("sed preserves the absent final newline when trailing files are empty", () => compareNative("sed", {
  args: ["-n", "p", "first", "empty"], files: { first: "one", empty: "" },
}));

test("sed normalizes a named file boundary before an early quit", () => compareNative("sed", {
  args: ["-n", "1p;1q", "first", "last"], files: { first: "one", last: "two\n" },
}));

test("sed keeps repeated output within an unterminated record byte-exact", () => compareNative("sed", {
  args: ["-n", "p;p"], stdin: "one",
}));
