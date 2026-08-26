import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { run } from "./helpers.js";

test("seeded native oracle exercises Cartesian, sorting and update combinations", async context => {
  const version = spawnSync("jq", ["--version"], { encoding: "utf8", timeout: 2000, maxBuffer: 4096 });
  if (version.error || version.status !== 0) { context.skip("native jq unavailable"); return; }
  let seed = 0x5a17c0de;
  const random = (maximum: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
  const rows: { input: string; filter: string }[] = [];
  const operators = ["+", "-", "*", "==", "!=", "<", "<=", ">", ">="];
  for (let index = 0; index < 90; index++) {
    const left = [random(11) - 5, random(11) - 5]; const right = [random(11) - 5, random(11) - 5];
    rows.push({ input: "null", filter: `[(${left.join(",")})${operators[index % operators.length]}(${right.join(",")})]` });
  }
  for (let index = 0; index < 20; index++) {
    const input = JSON.stringify(Array.from({ length: 6 }, () => ({ key: random(3), value: random(5) })));
    for (const filter of ["sort_by(.key,.value)", "group_by(.key)", "unique_by(.key)", "map(select(.value>1)|{key,value})"]) rows.push({ input, filter });
  }
  for (let index = 0; index < 10; index++) {
    const input = JSON.stringify({ left: random(10), right: random(10) });
    for (const filter of ["(.left,.right) += (1,2)", ".left |= (.,1/0)", "(.left,.right)=(.left,.right)", "{a:(.left,.right),b:(1,2)}"]) rows.push({ input, filter });
  }
  for (const fixture of rows) {
    const native = spawnSync("jq", ["-c", fixture.filter], { input: fixture.input, encoding: "utf8", timeout: 2000, maxBuffer: 512 * 1024 });
    assert.ifError(native.error);
    const actual = await run(["-c", fixture.filter], fixture.input);
    assert.equal(actual.exitCode, native.status, `${fixture.filter}: ${native.stderr} / ${actual.stderr}`);
    assert.equal(actual.stdout, native.stdout, `${fixture.filter} on ${fixture.input}`);
  }
  context.diagnostic(`${version.stdout.trim()}; seed 0x5a17c0de; ${rows.length} comparisons; each oracle bounded to 2 seconds / 512 KiB`);
});
