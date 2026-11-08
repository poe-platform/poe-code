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
  ["absent associative star key", 'declare -A map; map[foo]=bar', "map[*]", 1],
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

for (const source of ["probe", "/probe-script"]) {
  test(`private variable presence survives invocation context copies: ${source}`, async context => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs });
    context.after(() => shell.dispose());
    for (const command of predicateCommands()) shell.commands.register(command);
    shell.commands.register({ name: "probe", async execute(command) {
      assert.deepEqual(Object.getOwnPropertySymbols(command), []);
      return command.invoke!("test", ["-v", "arr[1]"]);
    } });
    await fs.writeFile("/probe-script", new TextEncoder().encode("#!/usr/bin/env probe\n"), { mode: 0o755 });
    const result = await shell.exec(`arr=(a b); ${source}`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const form of ["conditional", "unquoted conditional", "test", "bracket"] as const) {
  for (const key of ["a$b", '"quoted"', "'quoted'", "a\\b", "$(probe)", "`probe`", "a]b", "é", "x".repeat(4097) + "$(probe)"]) {
    test(`${form} -v preserves literal associative key ${JSON.stringify(key.slice(0, 40))}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem() });
      context.after(() => shell.dispose());
      for (const command of predicateCommands()) shell.commands.register(command);
      let executions = 0;
      shell.commands.register({ name: "probe", async execute() {
        executions++;
        return { exitCode: 0 };
      } });
      const operand = form === "unquoted conditional" ? "map[$key]" : '"map[$key]"';
      const predicate = form === "conditional" || form === "unquoted conditional" ? `[[ -v ${operand} ]]`
        : form === "test" ? `test -v ${operand}` : `[ -v ${operand} ]`;
      const quotedKey = "'" + key.split("'").join("'\\''") + "'";
      const result = await shell.exec(`declare -A map; key=${quotedKey}; map["$key"]=""; ${predicate}`);
      assert.equal(executions, 0, "presence checks must not execute syntax inside the key");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      const missing = await shell.exec(`unset map; declare -A map; key=${quotedKey}; ${predicate}`);
      assert.equal(executions, 0);
      assert.equal(missing.stderr, "");
      assert.equal(missing.exitCode, 1);
    });
  }
}

for (const form of ["conditional", "test", "bracket"] as const) {
  for (const selector of ["arr[]", "arr[-5]", "arr[4294967296]"]) {
    test(`${form} -v rejects invalid indexed subscript ${selector} without an internal error`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem() });
      context.after(() => shell.dispose());
      for (const command of predicateCommands()) shell.commands.register(command);
      const predicate = form === "conditional" ? `[[ -v "${selector}" ]]`
        : form === "test" ? `test -v "${selector}"` : `[ -v "${selector}" ]`;
      const result = await shell.exec(`arr=(a b); ${predicate}`);
      assert.match(result.stderr, /indexed array: (bad array subscript|index outside 0[.][.]4294967295)/u);
      assert.doesNotMatch(result.stderr, /internal error/u);
      assert.equal(result.exitCode, 1);
    });
  }
}

for (const form of ["conditional", "test", "bracket"] as const) {
  for (const target of ["map", "map[$key]"]) {
    test(`${form} -v preserves nameref target ${target}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem() });
      context.after(() => shell.dispose());
      for (const command of predicateCommands()) shell.commands.register(command);
      const operand = target === "map" ? '"ref[$key]"' : "ref";
      const predicate = form === "conditional" ? `[[ -v ${operand} ]]`
        : form === "test" ? `test -v ${operand}` : `[ -v ${operand} ]`;
      const result = await shell.exec(`declare -A map; key='a$b'; map["$key"]=value; declare -n ref='${target}'; ${predicate}`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}
