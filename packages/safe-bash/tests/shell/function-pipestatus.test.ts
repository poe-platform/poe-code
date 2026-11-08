import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { setup } from "./helpers.js";

const cases = [
  ['false; f() { :; }; say "status=$? pipestatus=${PIPESTATUS[*]}"', "status=0 pipestatus=1\n"],
  ['true | false; f() { :; }; say "status=$? pipestatus=${PIPESTATUS[*]}"', "status=0 pipestatus=0 1\n"],
  ['f() { :; }; say "count=${#PIPESTATUS[@]}"', "count=0\n"],
  ['false; f() { :; } > /dev/null; say "status=$? pipestatus=${PIPESTATUS[*]}"', "status=0 pipestatus=1\n"],
  ['false; ! f() { :; }; say "status=$? pipestatus=${PIPESTATUS[*]}"', "status=1 pipestatus=1\n"],
  ['false; readonly PIPESTATUS; f() { :; }; say "status=$? pipestatus=${PIPESTATUS[*]}"', "status=0 pipestatus=0\n"],
] as const;

for (const limits of [undefined, { maxExpansionBytes: 1048576, maxExpansionFields: 1024 }]) {
  for (const [source, stdout] of cases) {
    test(`function definitions preserve PIPESTATUS (${limits ? "async" : "sync"}): ${source}`, async context => {
      const { shell } = setup(limits ? { limits } : {});
      context.after(() => shell.dispose());
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout);
      const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source.replaceAll("say ", "printf '%s\\n' ")], { env: { LC_ALL: "C" } });
      assert.equal(native.status, 0, native.stderr.toString());
      assert.equal(result.stdout, native.stdout.toString());
    });
  }
}
