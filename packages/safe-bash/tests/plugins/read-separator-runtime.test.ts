import assert from "node:assert/strict";
import { describe, test } from "node:test";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { readExtension(): Extension; arraysExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

const cases = [
  { name: "array fields retain the prior colon separator", prefix: "IFS=:", args: "-r -a values", input: "one:two\n", print: 'printf "<%s>" "${values[@]}"', expected: "<one><two>" },
  { name: "scalar fields retain the prior colon separator", prefix: "IFS=:", args: "-r first last", input: "one:two:three\n", print: 'printf "<%s><%s>" "$first" "$last"', expected: "<one><two:three>" },
  { name: "unset separators retain whitespace splitting", prefix: "unset IFS", args: "-r -a values", input: "one two\n", print: 'printf "<%s>" "${values[@]}"', expected: "<one><two>" },
  { name: "empty separators remain distinct from unset", prefix: "IFS=", args: "-r -a values", input: "one,two\n", print: 'printf "<%s>" "${values[@]}"', expected: "<one,two>" },
  { name: "REPLY preserves its unsplit record", prefix: "IFS=:", args: "-r", input: " one:two \n", print: 'printf "<%s>" "$REPLY"', expected: "< one:two >" },
];

async function setup(replaceDuringRead: boolean, forbidIFS: boolean) {
  const published = await import("poe-code/safe-bash");
  const { createMemoryFileSystem } = await import("poe-code/safe-fs");
  const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
  const definition = optional.readExtension();
  const events: string[] = [];
  const extension: Extension = { ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
      const input = invocation.input;
      const bindings = invocation.bindings;
      return builtin.execute({ ...invocation,
        bindings: { ...bindings, get(name, index) {
          if (name === "IFS") {
            events.push("IFS");
            if (forbidIFS) throw new Error("This read mode must not inspect IFS");
          }
          return bindings.get(name, index);
        } },
        input: { ...input, borrow(descriptor) {
          const borrowed = input.borrow(descriptor);
          return { ...borrowed, async read(...args: Parameters<typeof borrowed.read>) {
            events.push("read");
            if (replaceDuringRead) await bindings.assign("IFS", ",");
            return borrowed.read(...args);
          } };
        } },
      });
    } })) };
  } };
  const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [extension, optional.arraysExtension()] }).use(published.agentCommands());
  return { shell, events };
}

describe("compiled read separator snapshot", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const entry of cases) test(entry.name, async context => {
    const subject = await setup(true, false);
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`${entry.prefix}; read ${entry.args}; ${entry.print}; printf '|IFS=<%s>' "$IFS"`, { stdin: entry.input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${entry.expected}|IFS=<,>`);
    assert.equal(result.stderr, "");
    assert.deepEqual(subject.events, ["IFS", "read"]);
  });

  test("raw separator bytes survive replacement during input acquisition", async context => {
    const subject = await setup(true, false);
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`IFS=$'\\xff'; read -r -a values; printf '%s' "\${values[@]}"`, { stdin: Uint8Array.of(254, 255, 252, 10) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(254, 252));
    assert.equal(result.stderr, "");
    assert.deepEqual(subject.events, ["IFS", "read"]);
  });

  test("exact count bypasses separator lookup", async context => {
    const subject = await setup(true, true);
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`IFS=:; read -N2 -a values; printf '<%s>' "\${values[@]}"`, { stdin: "a:b\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "<a:>");
    assert.equal(result.stderr, "");
    assert.deepEqual(subject.events, ["read"]);
  });

  test("zero timeout bypasses separator lookup and input consumption", async context => {
    const subject = await setup(false, true);
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec('value=OLD; read -t0 value; printf "%s:<%s>" "$?" "$value"', { stdin: "ready\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "0:<OLD>");
    assert.equal(result.stderr, "");
    assert.deepEqual(subject.events, []);
  });
});
