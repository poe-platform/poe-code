import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/core.js";

for (const [description, source, stdout] of [
  ["removes the reference itself with -n", 'target=hello; declare -n ref=target; unset -n ref; echo "code=$? target=$target ref=$ref"; [[ ! -R ref ]]', "code=0 target=hello ref=\n"],
  ["removes an indexed array target", 'arr=(a b c); declare -n ref=arr; unset ref; echo "count=${#arr[@]} vals=${arr[*]}"; [[ -R ref ]]', "count=0 vals=\n"],
  ["removes a referenced indexed element", 'arr=(a b c); declare -n ref=arr; unset \'ref[1]\'; echo "count=${#arr[@]} vals=${arr[*]}"', "count=2 vals=a c\n"],
  ["removes an associative array target", 'declare -A arr; arr[one]=a; arr[two]=b; declare -n ref=arr; unset ref; echo "count=${#arr[@]}"', "count=0\n"],
  ["removes a referenced associative element", 'declare -A long_array; long_array[one]=a; long_array[two]=b; declare -n r=long_array; unset \'r[one]\'; echo "count=${#long_array[@]} two=${long_array[two]} one=${long_array[one]}"', "count=1 two=b one=\n"],
  ["preserves raw bytes in referenced associative keys", 'declare -A long_array; key=$(printf "\\377"); long_array[$key]=a; long_array[keep]=b; declare -n r=long_array; unset "r[$key]"; echo "count=${#long_array[@]} keep=${long_array[keep]}"', "count=1 keep=b\n"],
  ["follows chained references", 'arr=(a b); declare -n first=arr second=first; unset \'second[0]\'; echo "${arr[*]}"; unset second; echo "${#arr[@]}"', "b\n0\n"],
  ["preserves a local reference target with -n", 'target=hello; f() { local -n ref=target; unset -n ref; echo "$target:$ref"; }; f; echo "$target"', "hello:\nhello\n"],
  ["leaves ordinary variables intact with -n", 'value=hello; unset -n value; echo "$?:$value"', "0:hello\n"],
  ["keeps -n scoped to the first reference in a chain", 'target=hello; declare -n first=target second=first; unset -n second; echo "$target:$first:$second"; [[ -R first && ! -R second ]]', "hello:hello:\n"],
  ["preserves readonly targets when removing references", 'readonly target=hello; declare -n ref=target; unset -n ref; echo "$target:$ref"', "hello:\n"],
  ["removes every referenced indexed member", 'arr=(a b c); declare -n ref=arr; unset \'ref[@]\'; echo "${#arr[@]}"; [[ -R ref ]]', "0\n"],
] as const) {
  test(`unset nameref ${description}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    shell.use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, stdout);
  });
}

for (const operand of ["ref", "ref[1]"]) {
  test(`unset nameref refuses readonly array target ${operand}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    shell.use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`arr=(a b c); readonly arr; declare -n ref=arr; unset '${operand}'; echo "$?:\${arr[*]}"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1:a b c\n");
    assert.match(result.stderr, /readonly/u);
  });
}
