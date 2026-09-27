import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

const assignments = [
  ['','arr=(a b)'],
  ['','arr=()'],
  ['arr=();','arr[0]=hello'],
  ['arr=(x);','arr+=(y z)'],
  ['declare -A arr; arr[a]=1;','arr[$(true; echo k)]=val'],
  ['declare -A arr; arr[a]=1;','arr[a]+=val'],
  ['declare -A arr; arr[a]=1;','arr[""]=val'],
] as const;
const wrappers = [
  (body: string) => `{ ${body}; }`,
  (body: string) => `if true; then ${body}; fi`,
  (body: string) => `case x in x) ${body};; esac`,
  (body: string) => `f(){ ${body}; }; f`,
];
for (const [initial, assignment] of assignments) {
  for (const [index, wrap] of wrappers.entries()) {
    test(`array fallback executes once: ${assignment}, wrapper ${index}`, async context => {
      const { shell, commands } = setup();
      context.after(() => shell.dispose());
      for (const command of basicCommands()) commands.register(command);
      const source = `${initial} c=0; ${wrap(`c=$((c+1)); echo "step:$c"; ${assignment}`)}; echo "arr:${'${arr[*]}'} final:$c"`;
      const native = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source]);
      const result = await shell.exec(source);
      if (assignment === 'arr[""]=val') {
        assert.equal(result.stdout, 'step:1\n');
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /bad array subscript/);
      } else if (initial.includes('declare -A')) {
        const values = assignment.includes('true;') ? '1 val' : assignment.includes('+=') ? '1val' : '1';
        assert.equal(result.stdout, `step:1\narr:${values} final:1\n`);
        assert.equal(result.exitCode, 0);
      } else {
        assert.equal(result.stdout, native.stdout.toString());
        assert.equal(result.exitCode, native.status);
      }
    });
  }
}
for (const substitution of ['if true; then echo sub_arg; fi', 'if true; then echo \ufeffsub_arg; fi', 'case x in (x) echo sub_arg;; esac', 'for ((i=0;i<2;i++)); do echo sub_arg; done', 'f(){ if true; then echo sub_arg; fi; }; f']) {
  for (const portable of [false, true]) {
    test(`pure substitution preserves parent last argument, portable=${portable}: ${substitution}`, async context => {
      const { shell, commands } = setup();
      context.after(() => shell.dispose());
      for (const command of basicCommands()) commands.register(command);
      const source = `: parent_arg; echo "$( ${substitution} )" "$_"; echo "$_"`;
      const native = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source]);
      const original = globalThis.Buffer;
      let result;
      try {
        if (portable) Reflect.deleteProperty(globalThis, 'Buffer');
        result = await shell.exec(source);
      } finally {
        globalThis.Buffer = original;
      }
      assert.equal(result.stdout, native.stdout.toString());
      assert.equal(result.exitCode, native.status, result.stderr);
    });
  }
}
