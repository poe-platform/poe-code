import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { predicateCommands } from "../../src/commands/predicates.js";

const cases = [
  ["numeric associative key", 'declare -A map; map[1]=bar', "map[1]", 0],
  ["absent associative zero", 'declare -A map; map[foo]=bar', "map[0]", 1],
  ["string associative key", 'declare -A map; map[foo]=bar', "map[foo]", 0],
  ["empty associative value", 'declare -A map; map[foo]=""', "map[foo]", 0],
  ["missing associative key", 'declare -A map; map[foo]=bar', "map[missing]", 1],
  ["Unicode associative key", 'declare -A map; map[é]=bar', "map[é]", 0],
  ["literal associative at key", 'declare -A map; map[foo]=bar; map[@]=""', "map[@]", 0],
  ["absent associative at key", 'declare -A map; map[foo]=bar', "map[@]", 1],
  ["literal associative star key", 'declare -A map; map[*]=""', "map[*]", 0],
  ["bare associative binding", 'declare -A map; map[foo]=bar', "map", 1],
  ["associative zero key", 'declare -A map; map[foo]=bar; map[0]=""', "map", 0],
  ["indexed zero", "arr=(a b)", "arr[0]", 0],
  ["indexed one", "arr=(a b)", "arr[1]", 0],
  ["indexed hole", "arr[2]=a", "arr[1]", 1],
  ["indexed arithmetic", "arr=(a b); index=1", "arr[index]", 0],
  ["indexed last element", "arr=(a b)", "arr[-1]", 0],
  ["bare indexed hole", "arr[2]=a", "arr", 1],
  ["indexed aggregate at", "arr[2]=a", "arr[@]", 0],
  ["indexed aggregate star", "arr[2]=a", "arr[*]", 0],
  ["empty indexed aggregate", "declare -a arr", "arr[@]", 1],
  ["scalar empty value", 'value=""', "value", 0],
  ["scalar zero", 'value=""', "value[0]", 0],
  ["scalar nonzero", 'value=""', "value[1]", 1],
  ["missing variable", ":", "missing", 1],
] as const;

for (const form of ["conditional", "test", "bracket"] as const) {
  for (const [label, setup, selector, expected] of cases) {
    test(`${form} -v: ${label}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem() });
      context.after(() => shell.dispose());
      for (const command of predicateCommands()) shell.commands.register(command);
      const predicate = form === "conditional" ? `[[ -v ${selector} ]]`
        : form === "test" ? `test -v '${selector}'` : `[ -v '${selector}' ]`;
      const result = await shell.exec(`${setup}; ${predicate}`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, expected);
    });
  }
}
