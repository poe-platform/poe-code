import assert from "node:assert/strict";
import test from "node:test";
import { primaryReference } from "./primary-reference.js";

const cases = [
  { name: "default MAPFILE and trailing unterminated record", script: `mapfile; printf 'status=%s,count=%s\\n' "$?" "\${#MAPFILE[@]}"; printf '<%s>' "\${MAPFILE[@]}"`, input: "a\nb\nlast", stdout: "status=0,count=3\n<a\n><b\n><last>" },
  { name: "readarray synonym and trimming", script: `readarray -t a; printf '<%s>' "\${a[@]}"`, input: "a\nb\n", stdout: "<a><b>" },
  { name: "attached options, skip, limit, explicit origin and unread tail", script: `a=(old tail keep); mapfile -tn1 -s1 -O1 a; printf '<%s>' "\${a[@]}"; read -r rest; printf 'rest=<%s>' "$rest"`, input: "skip\none\ntail\n", stdout: "<old><one><keep>rest=<tail>" },
  { name: "NUL delimiter is not retained in shell values", script: `mapfile -d '' a; printf '<%s>' "\${a[@]}"`, input: "one\0two\0tail", stdout: "<one><two><tail>" },
  { name: "embedded NUL truncates value but consumes complete newline record", script: `mapfile a; printf '<%s>' "\${a[@]}"`, input: "a\0b\nc\n", stdout: "<a><c\n>" },
  { name: "only first delimiter byte matters", script: `mapfile -d '::' a; printf '<%s>' "\${a[@]}"`, input: "a:b::tail", stdout: "<a:><b:><:><tail>" },
  { name: "empty input clears old array", script: `a=(old tail); mapfile a; printf 'count=%s' "\${#a[@]}"`, input: "", stdout: "count=0" },
  { name: "explicit zero origin does not clear", script: `a=(old tail); mapfile -O0 a; printf '<%s>' "\${a[@]}"`, input: "", stdout: "<old><tail>" },
  { name: "callback quantum and nonzero status", script: `cb() { printf 'cb:%s:<%s>\\n' "$1" "$2"; false; }; mapfile -t -C cb -c2 a; printf 'status=%s\\n' "$?"; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\nthree\n", stdout: "cb:1:<two>\nstatus=0\n<one><two><three>" },
  { name: "callback sees clear then preceding assignment", script: `a=(old tail); cb() { printf 'before:%s:<%s>:array=<%s>\\n' "$1" "$2" "\${a[*]}"; }; mapfile -t -C cb -c1 a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", stdout: "before:0:<one>:array=<>\nbefore:1:<two>:array=<one>\n<one><two>" },
  { name: "callback sees retained cells with explicit origin", script: `a=(old tail); cb() { printf 'before:%s:<%s>:array=<%s>\\n' "$1" "$2" "\${a[*]}"; }; mapfile -t -O1 -C cb -c1 a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", stdout: "before:1:<one>:array=<old tail>\nbefore:2:<two>:array=<old one>\n<old><one><two>" },
  { name: "admitted target remains writable after callback readonly", script: `a=(old); cb() { if [[ $1 == 1 ]]; then readonly a; fi; }; mapfile -t -C cb -c1 a; printf 'status=%s\\n' "$?"; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", stdout: "status=0\n<one><two>" },
  { name: "callback target replacement affects later visible writes", script: `a=(old); cb() { a=(callback); }; mapfile -t -C cb -c1 a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", stdout: "<callback><two>" },
  { name: "exported scalar can become indexed", script: `export a=old; mapfile -t a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", stdout: "<one><two>" },
  { name: "uint32 array index wraps without allocating a dense range", script: `mapfile -t -O4294967295 -n2 a; printf '<%s>' "\${!a[@]}"`, input: "one\ntwo\n", stdout: "<0><4294967295>" },
  { name: "extra operands ignored", script: "mapfile a extra", input: "one\ntwo\n", stdout: "" },
  { name: "decimal numeric whitespace accepted", script: 'mapfile -n " 2 "', input: "one\ntwo\n", stdout: "" },
  { name: "explicit descriptor shares cursor with inherited stdin", script: `mapfile -t -u3 -n1 a 3<&0; read -r tail; printf '<%s>:<%s>' "\${a[@]}" "$tail"`, input: "one\ntwo\nthree\nfour\n", stdout: "<one>:<two>" },
  { name: "callback reads from the current shared input cursor", script: `cb() { read -r consumed; printf 'cb:%s:%s:%s\\n' "$1" "$2" "$consumed"; }; mapfile -t -C cb -c1 a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\nthree\nfour\n", stdout: "cb:0:one:two\ncb:1:three:four\n<one><three>" },
] as const;

for (const entry of cases) test(`Bash 5.3.0 frozen reference mapfile contract: ${entry.name}`, {}, () => {
  const actual = primaryReference(import.meta.url, entry.script, entry.input);
  assert.equal(actual.status, 0);
  assert.deepEqual(actual.stdout, Buffer.from(entry.stdout));
  assert.deepEqual(actual.stderr, Buffer.alloc(0));
});

const usage = "mapfile: usage: mapfile [-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]\n";
const errors = [
  ["mapfile -n -1", 1, "mapfile: -1: invalid line count\n"],
  ["mapfile -n 4294967296", 1, "mapfile: 4294967296: invalid line count\n"],
  ["mapfile -n 0x10", 1, "mapfile: 0x10: invalid line count\n"],
  ["mapfile -O -1", 1, "mapfile: -1: invalid array origin\n"],
  ["mapfile -s -1", 1, "mapfile: -1: invalid line count\n"],
  ["mapfile -c 0", 1, "mapfile: 0: invalid callback quantum\n"],
  ["mapfile -u -1", 1, "mapfile: -1: invalid file descriptor specification\n"],
  ["mapfile -u 9", 1, "mapfile: 9: invalid file descriptor: Bad file descriptor\n"],
  ["mapfile -u 3 a 3<&-", 1, "mapfile: 3: invalid file descriptor: Bad file descriptor\n"],
  ["mapfile -Q", 2, `mapfile: -Q: invalid option\n${usage}`],
  ["mapfile --bogus", 2, `mapfile: --: invalid option\n${usage}`],
  ["mapfile -n", 2, `mapfile: -n: option requires an argument\n${usage}`],
  ['mapfile ""', 2, "mapfile: empty array variable name\n"],
  ["mapfile a[0]", 1, "mapfile: `a[0]': not a valid identifier\n"],
  ["readonly a; mapfile a", 1, "a: readonly variable\n"],
] as const;

for (const [script, status, diagnostic] of errors) test(`Bash 5.3.0 frozen reference mapfile diagnostic: ${script}`, {}, () => {
  const actual = primaryReference(import.meta.url, script, "one\ntwo\n");
  assert.equal(actual.status, status);
  assert.deepEqual(actual.stdout, Buffer.alloc(0));
  assert.deepEqual(actual.stderr, Buffer.from(`shell: line 1: ${diagnostic}`));
});

test("Bash 5.3.0 frozen reference callback exit terminates mapfile and the parent script", {}, () => {
  const result = primaryReference(import.meta.url, "callback() { exit 7; }; mapfile -C callback -c1 a; printf after", "one\ntwo\n");
  assert.equal(result.status, 7);
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.deepEqual(result.stderr, Buffer.alloc(0));
});
