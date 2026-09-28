import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

for (const declaration of ["-a arr=(leaked1 leaked2)", "-A arr=([key]=leaked)"]) {
  for (const ending of ["true | true", "return 0", "(true)"]) {
    test(`async local restoration removes ${declaration} after ${ending}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`f() { local ${declaration}; local -x x=1; ${ending}; }; f; say "global_arr=\${arr[*]} count=\${#arr[@]}"; arr[1]=new; say "keys=\${!arr[*]} vals=\${arr[*]}"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "global_arr= count=0\nkeys=1 vals=new\n");
    });
  }
}

test("async local restoration retains the outer array", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec('arr=(outer tail); f() { local -a arr=(inner); local -x x=1; true | true; }; f; say "${arr[*]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "outer tail\n");
});
