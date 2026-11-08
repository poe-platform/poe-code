import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

const cases = [
  ['arr=(old0 old1 old2); unset arr; arr[1]=new1; say "keys=${!arr[*]} vals=${arr[*]}"', "keys=1 vals=new1\n"],
  ['arr=(old0 old1); unset arr; arr[0]+=suffix; say "vals=${arr[*]}"', "vals=suffix\n"],
  ['arr=(old0 old1); unset arr; arr+=(new); say "keys=${!arr[*]} vals=${arr[*]}"', "keys=0 vals=new\n"],
  ['f() { local -a arr=(old0 old1 old2); }; f; arr[1]=new1; say "keys=${!arr[*]} vals=${arr[*]}"', "keys=1 vals=new1\n"],
  ['f() { local -a arr=(old0 old1); }; f; arr[0]+=suffix; say "vals=${arr[*]}"', "vals=suffix\n"],
  ['declare -a ZZfresh; ZZrecycled=(1 2); unset ZZrecycled; declare -a ZZrecycled; say "vars=${!ZZ*}"', "vars=\n"],
  ['ZZrecycled=(); unset ZZrecycled; declare -a ZZrecycled; say "vars=${!ZZ*}"', "vars=\n"],
  ['f() { local -a ZZrecycled=(1 2); }; f; f() { local -a ZZrecycled; say "vars=${!ZZ*}"; }; f', "vars=\n"],
] as const;

for (const [source, stdout] of cases) {
  test(`recycled arrays start fresh: ${source}`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, stdout);
  });
}

for (const clear of ["a=()", "unset a"]) {
  test(`indexed dense refill replaces mutated recycled slots after ${clear}`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`f() { ${clear}; for ((i=0;i<4;i++)); do a[i]=$((i*2)); last=\${a[i]}; done; }; f; f; a[2]=999; f; say "\${a[*]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "0 2 4 6\n");
  });

  test(`associative dense refill replaces mutated recycled slots after ${clear}`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const reset = clear === "unset a" ? "unset a; declare -gA a" : clear;
    const result = await shell.exec(`declare -A a; f() { ${reset}; sum=0; for ((i=0;i<4;i++)); do a[k$i]=$i; ((sum+=a[k$i])); done; }; f; f; a[k2]=999; f; say "\${a[k2]} $sum"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "2 6\n");
  });

  test(`mapfile refill replaces mutated recycled slots after ${clear}`, async context => {
    const { shell, fs } = setup();
    context.after(() => shell.dispose());
    await fs.writeFile("/lines", new TextEncoder().encode("alpha\nbeta\n"));
    const result = await shell.exec(`for ((i=0;i<2;i++)); do mapfile -t a < /lines; done; a[1]=changed; ${clear}; for ((i=0;i<2;i++)); do mapfile -t a < /lines; done; say "\${a[*]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "alpha beta\n");
  });
}
