import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { mapfileExtension } from "../../src/shell/extensions/mapfile/index.js";
import { bashExecutable, modernBashSkip } from "../helpers/bash-oracle.js";

for (const extension of [false, true]) {
  for (const command of ["mapfile", "readarray"]) {
    for (const name of ["FUNCNAME", "BASH_ARGV", "BASH_ARGC", "BASH_SOURCE", "BASH_LINENO", "GROUPS", "arr", "PIPESTATUS"]) {
      for (const reference of [false, true]) {
        test(`${command} preserves input when ${name} is protected: extension=${extension}, reference=${reference}`, { skip: modernBashSkip }, async t => {
          const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
          t.after(() => shell.dispose());
          for (const definition of basicCommands()) shell.register(definition);
          const source = `f(){ ${reference ? `declare -n ref=${name};` : ""} ${command} -tn1 ${reference ? "ref" : name}; s=$?; read -r next; echo "$s:$next"; }; f <<< $'one two\nnext'`;
          const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { env: { LC_ALL: "C" }, timeout: 2000 });
          assert.ifError(native.error);
          assert.equal(native.status, 0);
          assert.equal(native.stderr.toString(), "");
          assert.equal(native.stdout.toString(), name === "arr" || name === "PIPESTATUS" ? "0:next\n" : "1:one two\n");
          const result = await shell.exec(source, { env: { LC_ALL: "C" } });
          assert.equal(result.exitCode, native.status);
          assert.deepEqual(Buffer.from(result.stdout), native.stdout);
          assert.deepEqual(Buffer.from(result.stderr), native.stderr);
        });
      }
    }
    for (const name of ["FUNCNAME", "BASH_ARGV", "BASH_ARGC", "BASH_SOURCE", "BASH_LINENO", "GROUPS"]) {
      test(`${command} rejects ${name} in optimized loops: extension=${extension}`, { skip: modernBashSkip }, async t => {
        const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        t.after(() => shell.dispose());
        for (const definition of basicCommands()) shell.register(definition);
        const source = `for i in 1 2; do ${command} -t ${name} <<< "X Y"; echo "$?"; done`;
        const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { env: { LC_ALL: "C" }, timeout: 2000 });
        assert.ifError(native.error);
        assert.equal(native.status, 0);
        assert.equal(native.stdout.toString(), "1\n1\n");
        assert.equal(native.stderr.toString(), "");
        const result = await shell.exec(source, { env: { LC_ALL: "C" } });
        assert.equal(result.exitCode, native.status);
        assert.deepEqual(Buffer.from(result.stdout), native.stdout);
        assert.deepEqual(Buffer.from(result.stderr), native.stderr);
      });
    }
    for (const loop of [false, true]) {
      test(`${command} leaves FUNCNAME intact with a here string: extension=${extension}, loop=${loop}`, { skip: modernBashSkip }, async t => {
        const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        t.after(() => shell.dispose());
        for (const definition of basicCommands()) shell.register(definition);
        const body = `${command} -t FUNCNAME <<< "X Y"; echo "$?:\${FUNCNAME[*]}"`;
        const source = `f(){ ${loop ? `for i in 1 2; do ${body}; done` : body}; }; f`;
        const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { env: { LC_ALL: "C" }, timeout: 2000 });
        assert.ifError(native.error);
        assert.equal(native.status, 0);
        assert.equal(native.stderr.toString(), "");
        assert.equal(native.stdout.toString(), "1:f\n".repeat(loop ? 2 : 1));
        const result = await shell.exec(source, { env: { LC_ALL: "C" } });
        assert.equal(result.exitCode, native.status);
        assert.deepEqual(Buffer.from(result.stdout), native.stdout);
        assert.deepEqual(Buffer.from(result.stderr), native.stderr);
      });
    }
  }
}
