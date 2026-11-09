import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const declaration of ["local x=1; local x", "local x=1 x", "local x; local x=1; local x"]) {
  test(`function locals preserve redeclarations: ${declaration}`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    const result = await shell.exec(`x=outer; fn() { ${declaration}; echo "<$x>"; }; for i in 1 2; do fn; done; echo "$x"`);
    assert.equal(result.stdout, "<1>\n<1>\nouter\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("local arguments expand before each declaration command applies bindings", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  const result = await shell.exec('a=outer; fn() { local a=1 b="$a"; local c="$a"; echo "<$a:$b:$c>"; }; for i in 1 2; do fn; done; echo "$a"');
  assert.equal(result.stdout, "<1:outer:1>\n<1:outer:1>\nouter\n");
  assert.equal(result.stderr, "");
});

for (const body of [":", "local a=1", "return 3", "say inner", "nested() { :; }; nested inner"]) {
  for (const args of ["", " arg1 arg2"]) {
    for (const loop of [false, true]) {
      test(`function return restores invocation $_: ${body}, args=${args}, loop=${loop}`, async () => {
        const { shell, commands } = setup();
        for (const command of basicCommands()) commands.register(command);
        const call = `fn${args}; echo "s=$? _=$_"`;
        const result = await shell.exec(`fn() { ${body}; }; ${loop ? `for i in 1 2; do ${call}; done` : call}`);
        const expected = `${body === "say inner" ? "inner\n" : ""}s=${body === "return 3" ? 3 : 0} _=${args ? "arg2" : "fn"}\n`;
        assert.equal(result.stdout, expected.repeat(loop ? 2 : 1));
        assert.equal(result.stderr, "");
      });
    }
  }
}

for (const body of ['set -- changed; :', 'return 3']) {
  test(`middleware-dispatched function returns invocation $_: ${body}`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    shell.use(async (_context, next) => next());
    const result = await shell.exec(`fn() { ${body}; }; fn arg1 arg2; echo "s=$? _=$_"`);
    assert.equal(result.stdout, `s=${body === 'return 3' ? 3 : 0} _=arg2\n`);
    assert.equal(result.stderr, "");
  });
}

test("local - is silent and restores nounset on function return", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  const result = await shell.exec('export DEMO_LABEL=public_fixture; strict_helper() { local -; set -u; }; strict_helper; printf \'after=<%s>\\n\' "$missing"');
  assert.equal(result.stdout, "after=<>\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const option of ["errexit", "nounset", "noglob", "noclobber", "allexport", "pipefail", "braceexpand"]) {
  for (const enabled of [false, true]) {
    for (const ending of [":", "return 7"]) {
      test(`local - restores ${option}=${enabled} after ${ending}`, async () => {
        const { shell } = setup();
        const result = await shell.exec(`set ${enabled ? "-" : "+"}o ${option}; f() { local -; set ${enabled ? "+" : "-"}o ${option}; if [[ -o ${option} ]]; then say on; else say off; fi; ${ending}; }; f; if [[ -o ${option} ]]; then say on; else say off; fi`);
        // A nonzero function return with restored errexit exits the caller.
        const exits = option === "errexit" && enabled && ending === "return 7";
        assert.equal(result.stdout, `${enabled ? "off" : "on"}\n${exits ? "" : `${enabled ? "on" : "off"}\n`}`);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, exits ? 7 : 0);
      });
    }
  }
}

test("local - snapshots once per function and nested calls restore independently", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  const result = await shell.exec('set +uf; inner() { local -; set +u -f; }; outer() { local -; set -u; local -; inner; [[ -o nounset ]] && say outer; [[ -o noglob ]] || say glob; }; outer; printf "after=<%s>\\n" "$missing"');
  assert.equal(result.stdout, "outer\nglob\nafter=<>\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("local - accepts variable operands and does not restore shopt options", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  const result = await shell.exec('x=outer; f() { local - x=inner; set -u; shopt -s nullglob; say "$x"; }; f; printf "%s:<%s>\\n" "$x" "$missing"; shopt -q nullglob');
  assert.equal(result.stdout, "inner\nouter:<>\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("set options persist without local -", async () => {
  const { shell } = setup();
  const result = await shell.exec('f() { set -u; }; f; say "$missing"');
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /missing: unbound variable/u);
  assert.equal(result.exitCode, 1);
});

for (const body of ["set -n", 'set -u; say "$missing"', "set -u; exit 3"]) {
  test(`local - restores options while unwinding ${body}`, async () => {
    const { shell } = setup();
    let restored = false;
    await shell.exec(`f() { local -; ${body}; }; f`, {
      onState: state => {
        assert.equal(state.options?.nounset, false);
        assert.equal(state.options?.noexec, false);
        restored = true;
      },
    });
    assert.equal(restored, true);
  });
}

test("local - restores extension set options", async () => {
  const { shell } = setup();
  const result = await shell.exec('f() { local -; set -ET; [[ -o errtrace && -o functrace ]] && say inside; }; f; [[ -o errtrace || -o functrace ]] || say restored');
  assert.equal(result.stdout, "inside\nrestored\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});
