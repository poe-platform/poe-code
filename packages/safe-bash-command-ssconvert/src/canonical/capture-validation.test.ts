import { expect, it } from "vitest";
import { Volume } from "memfs";
import { compareCapture, type Capture } from "./gates.js";

function original(): Capture {
  const fs = Volume.fromJSON({ "/tiny.csv": "a\n" });
  const namespace = [{ path: "/tiny.csv", kind: "file" as const, mode: 33188,
    bytes: [...fs.readFileSync("/tiny.csv") as Uint8Array] }];
  return { sourceHash: "a".repeat(64), profileHash: "b".repeat(64), inputHash: "c".repeat(64),
    argv: [], stdin: [], env: [["LC_ALL", "C"]], cwd: "/", status: 0,
    stdout: [], stderr: [], before: namespace, after: namespace };
}
it("rejects impossible equal environment captures instead of certifying parity", () => {
  for (const env of [ [["LC_ALL", "C"], ["LC_ALL", "en_US"]], [["", "C"]],
    [["A=B", "C"]], [["A\0", "C"]], [["A", "C\0"]] ] as Capture["env"][]) {
    const invalid = { ...original(), env };
    expect(compareCapture(invalid, invalid)).toContain("env");
  }
  expect(compareCapture(original(), original())).toEqual([]);
});
it("rejects duplicate paths and invalid namespace modes in equal captures", () => {
  const book = original();
  for (const after of [[...book.after, ...book.after], [{ ...book.after[0]!, mode: -1 }]]) {
    const invalid = { ...book, after };
    expect(compareCapture(invalid, invalid)).toContain("after");
  }
  const ordered = { ...book, after: [...book.after, { path: "/empty", kind: "directory" as const, mode: 16877 }] };
  expect(compareCapture(ordered, { ...ordered, after: [...ordered.after].reverse() })).toContain("after");
});
