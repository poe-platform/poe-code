import { test, expect } from "vitest";
import { fixture } from "../engine.test.js";
import { execute, run } from "../engine.js";

test("original regression: default sniffing enables no-inference semicolon conversion", async () => {
  const f = fixture("a;b\nx;y\n", ["-I", "-f", "csv"]);
  expect({ status: await execute("in2csv", f.context), ...f.result() }).toEqual({
    status: 0, stdout: "a,b\nx,y\n", stderr: ""
  });
});
test("SDK and CLI sniff through the same reader with explicit delimiter precedence", async () => {
  const f = fixture("a;b\nx;y\n", []);
  expect(await run({ command: "in2csv", settings: { no_inference: true, filetype: "csv", delimiter: ";" } }, f.context)).toBe(0);
  expect(f.result()).toEqual({ stdout: "a,b\nx,y\n", stderr: "" });
});

test("failed sniffing reports the injected frozen warning and falls back without losing rows", async () => {
  const f = fixture("name\nvalue\n", ["-I", "-f", "csv"], { sniffing: {
    warning: { path: "/reference/agate/table/from_csv.py", line: 83, source: "kwargs['dialect'] = csv.Sniffer().sniff(sample)" }
  } });
  expect({ status: await execute("in2csv", f.context), ...f.result() }).toEqual({ status: 0,
    stdout: "name\nvalue\n", stderr: "/reference/agate/table/from_csv.py:83: RuntimeWarning: Error sniffing CSV dialect: Could not determine delimiter\n  kwargs['dialect'] = csv.Sniffer().sniff(sample)\n" });
});
test("unidentified warning deployment remains an explicit blocker", async () => {
  const f = fixture("name\nvalue\n", ["-I", "-f", "csv"]);
  expect({ status: await execute("in2csv", f.context), ...f.result() }).toEqual({ status: 78,
    stdout: "", stderr: "csvkit: unsupported or unqualified: sniff failure warning deployment identity\n" });
});
test("zero disables inference without reading a peek profile", async () => {
  const f = fixture("a;b\nx;y\n", ["-I", "-f", "csv", "-y", "0"], { sniffing: { stream: {
    name: "must-not-be-called", peekBytes: 1, decode: async () => { throw new Error("unexpected sniffing"); }
  } } });
  expect({ status: await execute("in2csv", f.context), ...f.result() }).toEqual({ status: 0,
    stdout: "a;b\nx;y\n", stderr: "" });
});
test("full sniffing is independently bounded and closes the source on refusal", async () => {
  let closed = 0;
  const f = fixture("", ["-I", "-f", "csv", "-y", "-1"], { sniffing: { maxSampleCharacters: 4 },
    stdin: (async function* () { try { yield new TextEncoder().encode("a;b\nx;y\n"); } finally { closed++; } })()
  });
  expect({ status: await execute("in2csv", f.context), ...f.result() }).toEqual({ status: 78,
    stdout: "", stderr: "csvkit: unsupported or unqualified: sniff sample character budget exceeded\n" });
  expect(closed).toBe(1);
});
test("multibyte threshold distinguishes text-file characters from stdin peek/decode", async () => {
  const input = "é;ö\nx;y\n";
  const warning = { suppressWarnings: true };
  const named = fixture("", ["-I", "-f", "csv", "-y", "5", "input.csv"], {
    sniffing: warning, fs: { readFile: async () => new TextEncoder().encode(input), writeFile: async () => { throw new Error("unexpected write"); } }
  });
  expect({ status: await execute("in2csv", named.context), ...named.result() }).toEqual({ status: 0,
    stdout: "é;ö\nx;y\n", stderr: "" });
  const stdin = fixture(input, ["-I", "-f", "csv", "-y", "5"], { sniffing: { ...warning, stream: {
    name: "six-byte-buffer-utf8-ignore", peekBytes: 6,
    decode: async bytes => new TextDecoder("utf-8").decode(bytes)
  } } });
  expect({ status: await execute("in2csv", stdin.context), ...stdin.result() }).toEqual({ status: 0,
    stdout: "é,ö\nx,y\n", stderr: "" });
});
test("Python default warning filter emits the sniff location once across joined files", async () => {
  const f = fixture("", ["-I", "a.csv", "b.csv"], {
    fs: { readFile: async path => new TextEncoder().encode(path === "/a.csv" ? "a\nx\n" : "b\ny\n"), writeFile: async () => { throw new Error("unexpected write"); } },
    sniffing: { warning: { path: "/reference/agate/table/from_csv.py", line: 83 } }
  });
  expect({ status: await execute("csvjoin", f.context), ...f.result() }).toEqual({ status: 0,
    stdout: "a,b\nx,y\n", stderr: "/reference/agate/table/from_csv.py:83: RuntimeWarning: Error sniffing CSV dialect: Could not determine delimiter\n" });
});
