import type { Fixture } from "./harness.js";

export const regressions: readonly Fixture[] = [
  { id: "index-cartesian-order", input: "null", argv: ["-c", "[([10,20],[30,40])[(0,1)]]"], stdout: "[10,30,20,40]\n", status: 0 },
  { id: "chained-index-order", input: "[[10,11],[20,21]]", argv: ["-c", "[.[(0,1)][(0,1)]]"], stdout: "[10,20,11,21]\n", status: 0 },
  { id: "index-error-before-empty-base", input: "null", argv: ["-c", "(empty)[1/0]"], stdout: "", status: 5 },
  { id: "slice-cartesian-order", input: "null", argv: ["-c", "[([0,1,2],[3,4,5])[(0,1):(2,3)]]"], stdout: "[[0,1],[3,4],[0,1,2],[3,4,5],[1],[4],[1,2],[4,5]]\n", status: 0 },
  { id: "slice-first-lazy-start", input: "[0,1,2]", argv: ["-c", "first(.[(0,1/0):1])"], stdout: "[0]\n", status: 0 },
  { id: "slice-first-lazy-end", input: "[0,1,2]", argv: ["-c", "first(.[0:(1,1/0)])"], stdout: "[0]\n", status: 0 },
  { id: "slice-error-before-empty-base", input: "null", argv: ["-c", "(empty)[(1/0):1]"], stdout: "", status: 5 },
  { id: "delete-null-nested-path", input: "null", argv: ["-c", ".foo.bar |= empty"], stdout: "null\n", status: 0 },
  { id: "delete-absent-object-path", input: "{}", argv: ["-c", ".foo.bar |= empty"], stdout: "{}\n", status: 0 },
  { id: "delete-absent-array-path", input: "[0,1,2]", argv: ["-c", ".[3].x |= empty"], stdout: "[0,1,2]\n", status: 0 },
  { id: "delete-negative-outside-array", input: "[0,1,2]", argv: ["-c", ".[-9] |= empty"], stdout: "[0,1,2]\n", status: 0 },
  { id: "delete-negative-null", input: "null", argv: ["-c", ".[-1] |= empty"], stdout: "null\n", status: 0 },
  { id: "delete-overlapping-null-paths", input: "null", argv: ["-c", "(.a,.a.b) |= empty"], stdout: "null\n", status: 0 },
  { id: "delete-root-emits-null", input: '{"a":1}', argv: ["-ce", ". |= empty"], stdout: "null\n", status: 1 },
  { id: "delete-root-null-emits-null", input: "null", argv: ["-c", ". |= empty"], stdout: "null\n", status: 0 },
  { id: "entry-null-key-fallback", input: '[{"key":null,"Key":"x","value":1}]', argv: ["-c", "from_entries"], stdout: '{"x":1}\n', status: 0 },
  { id: "entry-false-key-fallback", input: '[{"key":false,"Key":null,"name":"x","value":false,"Value":1}]', argv: ["-c", "from_entries"], stdout: '{"x":false}\n', status: 0 },
  { id: "args-insertion-order", input: "null", argv: ["-c", "--arg", "__proto__", "x", "--argjson", "constructor", '{"v":1}', "$ARGS"], stdout: '{"positional":[],"named":{"__proto__":"x","constructor":{"v":1}}}\n', status: 0 },
];
