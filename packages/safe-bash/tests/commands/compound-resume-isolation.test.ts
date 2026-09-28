import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

const warmup = "true; ".repeat(40);
const cases: { name: string; script: string; expected: string }[] = [];
for (const wrapper of ["group", "if", "case"]) for (const operator of ["&&", "||"]) {
  const body = `${operator === "&&" ? "true" : "false"} ${operator} { echo before; x=1; ${operator === "&&" ? "false;" : ""} x=(1 2); echo "after:\${x[1]}"; }`;
  const script = wrapper === "group" ? `{ ${body}; }` : wrapper === "if" ? `if true; then ${body}; fi` : `case a in a) ${body};; esac`;
  cases.push({ name: `${wrapper} resumes entered ${operator} RHS`, script: `${warmup}unset x; ${script}`, expected: "before\nafter:2\n" });
}
for (const kind of ["for", "while", "until", "arithmetic-for"]) for (const fallback of ["function", "array"]) {
  const body = `(( count += 1 )); echo "iter:$i"; ${fallback === "function" ? "f" : "x=1; x=(1 2)"};`;
  const loop = kind === "for" ? `for i in 0 1; do ${body} done` : kind === "arithmetic-for" ? `for ((i=0;i<2;i++)); do ${body} done` : `${kind} ((i ${kind === "until" ? ">=" : "<"} 2)); do ${body} ((i+=1)); done`;
  cases.push({ name: `${kind} does not replay ${fallback} fallback`, script: `${warmup}f() { :; }; unset x; i=0; count=0; ${loop}; echo "count=$count"`, expected: "iter:0\niter:1\ncount=2\n" });
}
for (const kind of ["while", "until", "arithmetic-for"]) {
  const loop = kind === "arithmetic-for" ? "for ((i=0;i<4100;i++)); do ((count+=1)); done" : `${kind} ((i ${kind === "until" ? ">=" : "<"} 4100)); do ((count+=1)); ((i+=1)); done`;
  cases.push({ name: `${kind} exceeds synchronous iteration cap once`, script: `i=0; count=0; ${loop}; echo "count=$count"`, expected: "count=4100\n" });
}
for (const compound of ["if true; then echo prefix; [[ -f /dev/null ]]; echo suffix; fi", "case a in a) echo prefix; [[ -f /dev/null ]]; echo suffix;; esac"]) {
  for (const fn of [false, true]) cases.push({ name: `substitution preserves prefix ${fn ? "function" : "direct"} ${compound.slice(0, 4)}`, script: fn ? `f() { ${compound}; }; out=$(f); echo "out=[$out]"` : `out=$(${compound}); echo "out=[$out]"`, expected: "out=[prefix\nsuffix]\n" });
}
for (const kind of ["while", "until"]) cases.push({
  name: `${kind} preserves effects before condition fallback`,
  script: `${warmup}unset x; i=0; count=0; ${kind} echo "condition:$i"; x=1; x=(1 2); ((i ${kind === "until" ? ">=" : "<"} 2)); do ((count+=1)); ((i+=1)); done; echo "count=$count"`,
  expected: "condition:0\ncondition:1\ncondition:2\ncount=2\n",
});
cases.push({
  name: "repeated function substitutions leave no stale compound cursor",
  script: 'arr=(value); k=0; f() { if true; then echo prefix; [[ -v "arr[$k]" ]]; echo suffix; fi; }; echo "$(f)"; echo "$(f)"',
  expected: "prefix\nsuffix\nprefix\nsuffix\n",
});
cases.push(
  { name: "substitution isolates outer local", script: 'outer() { local x=outer_val; local out=$(if true; then local x=subshell_val; echo "$x"; fi); echo "out=$out x=$x"; }; outer', expected: "out=subshell_val x=outer_val\n" },
  { name: "function substitution isolates expanded arithmetic", script: 'a=0; expr="a=99"; f() { local tmp=1; (( $expr )); echo "$a"; }; out=$(f); echo "out=$out a=$a"', expected: "out=99 a=0\n" },
  { name: "if substitution isolates expanded arithmetic", script: 'a=0; expr="a=99"; out=$(if true; then (( $expr )); echo "$a"; fi); echo "out=$out a=$a"', expected: "out=99 a=0\n" },
);
for (const entry of cases) test(entry.name, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(entry.script);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, entry.expected);
  } finally { await shell.dispose(); }
});
