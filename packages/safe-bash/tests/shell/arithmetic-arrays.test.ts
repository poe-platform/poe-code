import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const [name, source, expected] of [
  ["expansion reads", 'a=(10 20 30); say "$((a[1]+5))"', "25\n"],
  ["condition reads", 'a=(10 20); i=1; if ((a[i]>0)); then say yes; fi', "yes\n"],
  ["postfix increment", 'a=(10 20 30); say "$((a[1]++)):${a[1]}"', "20:21\n"],
  ["prefix decrement", 'a=(10 20); say "$((--a[1])):${a[1]}"', "19:19\n"],
  ["compound assignment", 'a=(10 20); i=1; ((a[i]+=5)); say "${a[1]}"', "25\n"],
  ["assignment", 'a=(10 20); say "$((a[0]=42)):${a[0]}"', "42:42\n"],
  ["for clauses", 'a=(0 0); for ((a[0]=0;a[0]<3;a[0]++)); do ((a[1]+=a[0])); done; say "${a[@]}"', "3 3\n"],
  ["let", 'a=(10 20); let "a[1]+=5"; say "${a[1]}"', "25\n"],
  ["expanded index", 'a=(10 20); i=1; say "$((a[$i]))"', "20\n"],
  ["quoted index", 'a=(10 20); say "$((a["1"]))"', "20\n"],
  ["command index", 'a=(10 20); say "$((a[$(say 1)]))"', "20\n"],
  ["nested index", 'a=(10 20 30); b=(2); say "$((a[b[0]]))"', "30\n"],
  ["index evaluated once", 'a=(10 20); i=0; ((a[i++]+=5)); say "$i:${a[@]}"', "1:15 20\n"],
  ["assignment rhs before index", 'a=(10 20); i=0; ((a[i++]=i+5)); say "$i:${a[@]}"', "1:5 20\n"],
  ["short circuit", 'a=(10); i=0; ((0 && a[i++]++)); say "$i:${a[0]}"', "0:10\n"],
  ["negative index", 'a=(10 20); ((a[-1]++)); say "${a[-1]}"', "21\n"],
  ["new array", '((a[2]=42)); say "${a[2]}:${#a[@]}"', "42:1\n"],
  ["scalar conversion", 'a=10; ((a[2]=42)); say "${a[@]}"', "10 42\n"],
  ["bare array", 'a=(10 20); ((a+=5)); say "$((a)):${a[@]}"', "15:15 20\n"],
  ["associative key", 'declare -A a; a[key]=10; ((a[key]+=5)); say "$((a[key]))"', "15\n"],
  ["quoted associative key", 'declare -A a; a["some key"]=10; ((a["some key"]++)); say "$((a["some key"]))"', "11\n"],
  ["recursive element value", 'a=("b[1]+2"); b=(0 5); say "$((a[0]))"', "7\n"],
  ["associative index evaluated once", 'declare -A a; a[key]=10; key=key; ((a[${key:=wrong}]+=5)); say "$key:${a[key]}"', "key:15\n"],
  ["associative read does not create", 'declare -A a; say "$((a[missing])):${#a[@]}"', "0:0\n"],
  ["assignment under nounset", 'set -u; ((a[2]=42)); say "${a[2]}"', "42\n"],
  ["different elements are not recursion", 'a=("a[1]" 42); say "$((a[0]))"', "42\n"],
  ["unset element", 'a=(10); say "$((a[9]))"', "0\n"],
] as const) test(`arithmetic arrays: ${name}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const [name, source, diagnostic] of [
  ["readonly", 'a=(10); readonly a; ((a[0]++)); say "${a[0]}"', "readonly"],
  ["nounset", 'set -u; a=(10); say "$((a[9]))"', "unbound variable"],
  ["element recursion", 'a=("a[0]"); say "$((a[0]))"', "recursion"],
  ["subscript recursion", 'i="a[i]"; a=(10); say "$((a[i]))"', "nesting"],
  ["invalid negative index", 'a=(10); say "$((a[-2]))"', "index outside"],
  ["invalid lvalue", 'a=(10); say "$(((a[0]+1)=2))"', "arithmetic syntax error"],
] as const) test(`arithmetic arrays reject ${name}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.ok(result.stderr.includes(diagnostic), result.stderr);
    if (name === "readonly") assert.equal(result.stdout, "10\n");
    else assert.notEqual(result.exitCode, 0);
  } finally { await shell.dispose(); }
});
