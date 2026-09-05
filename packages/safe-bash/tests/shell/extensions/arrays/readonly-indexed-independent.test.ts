import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { captureShellExtensions, extensionState, type ShellExtension } from "../../../../src/shell/extensions.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { captureShellSyntax, parseShell, type ShellSyntaxDeclarations } from "../../../../src/shell/parser.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";

function fixture(context: TestContext, extensions: readonly ShellExtension[] = [arraysExtension()]) {
  const filesystem = createMemoryFileSystem();
  const shell = new Shell({ fs: filesystem, extensions, limits: { maxWallClockMs: 2000, maxCommands: 128, maxOutputBytes: 65536 } });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  return { shell, filesystem };
}

for (const append of [false, true]) {
  test(`independent readonly native 5.3: direct compound ${append ? "append" : "replacement"} of readonly array is fatal`, async context => {
    const { shell } = fixture(context);
    const result = await shell.exec(`readonly -a values=(one two); readonly -a values${append ? "+" : ""}=(three); printf after`);
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "shell: line 1: values: readonly variable\n",
    });
  });
}

test("independent readonly native 5.3: quoted compound failure is a nonfatal builtin failure", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("readonly -a values=(one two); readonly -a values='(three)'; printf 'status=%s' \"$?\"");
  assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    status: 0, stdout: "status=1", stderr: "shell: line 1: readonly: values: readonly variable\n",
  });
});

test("independent readonly native 5.3: an already readonly scalar is not promoted to indexed", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec(`readonly value=old; readonly -a value; case "$(readonly -ap)" in *'declare -ar value='*) printf array;; *) printf scalar;; esac`);
  assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    status: 0, stdout: "scalar", stderr: "",
  });
});

test("independent readonly native 5.3: local readonly promotion through eval restores the mutable outer scalar", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec(`value=global; f() { local -a value; value=(local); eval 'readonly -a value+=(tail)'; printf '<%s>' "\${value[@]}"; }; f; value=after; printf '|%s' "$value"`);
  assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    status: 0, stdout: "<local><tail>|after", stderr: "",
  });
});

test("independent readonly native 5.3: rejected local shadow identifies the local builtin and preserves the parent", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec(`readonly -a value=(outer tail); f() { local -a value; printf '<%s>' "\${value[@]}"; }; f; printf '|%s' "\${value[0]}"`);
  assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    status: 0, stdout: "<outer><tail>|outer", stderr: "shell: line 1: local: value: readonly variable\n",
  });
});

test("independent readonly native 5.3: invalid grouped options do not freeze the operand", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec(`values=(old); readonly -aq values; printf 'status=%s;' "$?"; values[0]=after; printf '%s' "\${values[0]}"`);
  assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    status: 0, stdout: "status=2;after",
    stderr: "shell: line 1: readonly: -q: invalid option\nreadonly: usage: readonly [-aAf] [name[=value] ...] or readonly -p\n",
  });
});

test("independent readonly native 5.3: named print flags do not list or discard array operands", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec(`readonly -ap values=(one two); readonly -pa values; printf '<%s>' "\${values[@]}"`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "<one><two>");
  assert.equal(result.stderr, "");
});

test("independent readonly native 5.3: prefix assignments do not suppress declaration grammar", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec(`tag=x readonly -a values=(one two); printf '<%s>' "\${values[@]}"`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "<one><two>");
  assert.equal(result.stderr, "");
});

test("independent readonly native 5.3: substitution-local readonly does not freeze the parent binding", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec(`values=(parent); text=$(readonly -a values=(child); printf '<%s>' "\${values[@]}"); values[0]=after; printf '%s|%s' "$text" "\${values[0]}"`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "<child>|after");
  assert.equal(result.stderr, "");
});

test("independent readonly syntax: inherited declarations and accessor elements cannot opt in", () => {
  let calls = 0;
  const inherited = Object.create({ indexedDeclarations: ["readonly"] }) as ShellSyntaxDeclarations;
  const property = Object.defineProperty({}, "indexedDeclarations", { get() { calls++; return ["readonly"]; } });
  const elements = Object.defineProperty(["readonly"], "0", { get() { calls++; return "readonly"; } });
  for (const syntax of [inherited, property, { indexedDeclarations: elements }]) {
    assert.throws(() => captureShellSyntax(syntax as ShellSyntaxDeclarations), TypeError);
  }
  assert.equal(calls, 0);
});

test("independent readonly syntax: a null-prototype own-data declaration is snapshotted and immutable", () => {
  const names = ["readonly"];
  const syntax = Object.assign(Object.create(null), { indexedDeclarations: names }) as ShellSyntaxDeclarations;
  const captured = captureShellSyntax(syntax);
  names.length = 0;
  assert.deepEqual(captured.indexedDeclarations, ["readonly"]);
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(Object.isFrozen(captured.indexedDeclarations), true);
  assert.equal(Reflect.set(captured.indexedDeclarations!, "0", "local"), false);
  assert.equal(captureShellSyntax(captured), captured);
});

test("independent readonly syntax: extension capture deduplicates without retaining mutable arrays", () => {
  const firstNames: "readonly"[] = ["readonly"];
  const secondNames: "readonly"[] = ["readonly"];
  const definitions: ShellExtension[] = [
    { name: "first", syntax: { indexedDeclarations: firstNames }, create: () => ({ builtins: [] }) },
    { name: "second", syntax: { indexedDeclarations: secondNames }, create: () => ({ builtins: [] }) },
  ];
  const captured = captureShellExtensions(definitions);
  firstNames.length = 0;
  secondNames.length = 0;
  assert.deepEqual(captured.syntax.indexedDeclarations, ["readonly"]);
  assert.equal(Object.isFrozen(captured.syntax.indexedDeclarations), true);
  assert.deepEqual(extensionState(captured.definitions)?.syntax.indexedDeclarations, ["readonly"]);
});

for (const profile of ["default", "name-only", "keys-only"] as const) {
  test(`independent readonly syntax: ${profile} remains isolated through eval and substitution`, async context => {
    const extensions: ShellExtension[] = profile === "default" ? [] : [{
      name: profile === "name-only" ? "arrays" : "keys",
      ...(profile === "keys-only" ? { syntax: { arrayKeys: true as const } } : {}),
      create: () => ({ builtins: [] }),
    }];
    const { shell } = fixture(context, extensions);
    const result = await shell.exec(`eval 'readonly -a values=(one)'; printf 'eval=%s;' "$?"; ignored=$(readonly -a inner); printf 'sub=%s' "$?"`);
    assert.equal(result.stdout, "eval=2;sub=2");
    assert.ok(result.stderr.length > 0);
  });
}

test("independent readonly parser: compound syntax requires the literal admitted declaration head", () => {
  const syntax: ShellSyntaxDeclarations = { indexedDeclarations: ["readonly"] };
  assert.doesNotThrow(() => parseShell("readonly -a values=(')' one)", 0, syntax));
  assert.throws(() => parseShell("readonly -a values=(one)", 0, { arrayKeys: true }));
  assert.throws(() => parseShell("echo values=(one)", 0, syntax));
  assert.throws(() => parseShell("'readonly' -a values=(one)", 0, syntax));
  assert.throws(() => parseShell("readonly -a values=(one", 0, syntax));
});

for (const route of ["eval-source", "source-eval", "bash", "sh"] as const) {
  test(`independent readonly raw-byte declaration and printing survive ${route}`, async context => {
    const { shell, filesystem } = fixture(context);
    const program = String.raw`readonly -a values=($'\xff' $'\t' '$x' '` + "`" + String.raw`' ''); readonly -ap; printf '<%s>' ` + '"${values[@]}"';
    await filesystem.writeFile("/declaration.sh", Buffer.from(program));
    await filesystem.writeFile("/eval.sh", Buffer.from("eval " + "'" + program.split("'").join("'\\''") + "'"));
    const source = route === "eval-source" ? "eval 'source /declaration.sh'"
      : route === "source-eval" ? "source /eval.sh" : `${route} /declaration.sh`;
    const result = await shell.exec(source, { env: { LC_ALL: "C" } });
    const listing = "declare -ar values=([0]=$'\\377' [1]=$'\\t' [2]=\"\\$x\" [3]=\"\\`\" [4]=\"\")\n";
    const expected = Buffer.concat([Buffer.from(listing), Buffer.from([60, 255, 62, 60, 9, 62]), Buffer.from("<$x><`><>")]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected);
    assert.equal(result.stderr, "");
  });
}

for (const reason of [null, false, 0, ""]) {
  test(`independent readonly listing cancellation preserves ${String(reason)} and prevents later output`, async context => {
    const { shell } = fixture(context);
    const controller = new AbortController();
    const chunks: Uint8Array[] = [];
    await assert.rejects(shell.exec("readonly -a values=(one two); readonly -ap; printf after", {
      signal: controller.signal,
      stdout: { async write(bytes) { chunks.push(bytes.slice()); controller.abort(reason); } },
    }), error => Object.is(error, reason));
    assert.equal(chunks.length, 1);
    assert.equal(Buffer.concat(chunks).toString(), "declare -ar values=(");
  });
}

test("independent readonly compound reparse and listing retain source/output quota enforcement", async context => {
  const { shell } = fixture(context);
  const source = "readonly -a values='(one two)'";
  await assert.rejects(shell.exec(source, { limits: { maxSourceBytes: Buffer.byteLength(source) } }),
    error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
  await assert.rejects(shell.exec("readonly -a values=(one two); readonly -ap", { limits: { maxOutputBytes: 2 } }),
    error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

test("independent readonly repair native 5.3: direct replacement skips its command list but resumes the next input line", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf after");
  assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    status: 0, stdout: "after", stderr: "shell: line 1: values: readonly variable\n",
  });
});

test("independent readonly repair native 5.3: rejected append preserves status and value for the next input line", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec('readonly -a values=(one)\nreadonly -a values+=(two)\nprintf \'status=%s:<%s>\' "$?" "$values"');
  assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    status: 0, stdout: "status=1:<one>", stderr: "shell: line 2: values: readonly variable\n",
  });
});

for (const reason of [null, false, 0, ""]) {
  test(`independent readonly direct expansion cancellation preserves ${String(reason)} before parent output`, async context => {
    const controller = new AbortController();
    let invocations = 0;
    const extension: ShellExtension = {
      name: "cancel-direct-expansion",
      create: () => ({ builtins: [{ name: "cancel_initializer", async execute(command) {
        invocations++;
        await command.stdout.write(Uint8Array.of(255));
        controller.abort(reason);
        return 0;
      } }] }),
    };
    const { shell } = fixture(context, [arraysExtension(), extension]);
    const chunks: Uint8Array[] = [];
    await assert.rejects(shell.exec('readonly -a values=("$(cancel_initializer)"); printf after', {
      signal: controller.signal,
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    }), error => Object.is(error, reason));
    assert.equal(invocations, 1);
    assert.deepEqual(chunks, []);
  });
}

test("independent readonly input units native 5.3: eval-created readonly bindings keep unprefixed diagnostics across successive units", async context => {
  const { shell } = fixture(context);
  const input = 'readonly -a values=(one); readonly -a values=(two); printf skip\nprintf "first:%s;" "$?"\nreadonly -a values+=(three); printf skip\nprintf "second:%s;" "$?"';
  const result = await shell.exec("eval '" + input + "'; printf 'outer:%s' \"$?\"");
  assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    status: 0,
    stdout: "first:1;second:1;outer:0",
    stderr: "shell: line 1: values: readonly variable\nshell: line 3: values: readonly variable\n",
  });
});

test("independent readonly input units native 5.3: nested function declarations retain unprefixed local-binding diagnostics", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec('values=outer; f() { local -a values; values=(local); g() { readonly -a values; readonly -a values=(bad); printf skip; }; g; printf skip; }; f; printf skip\nvalues=after; printf "%s" "$values"');
  assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    status: 0,
    stdout: "after",
    stderr: "shell: line 1: values: readonly variable\n",
  });
});

for (const [transition, identity] of [["[[ yes ]]", "[["], ["((1))", "(("], ["((0))", "(("]] as const) {
  test(`independent readonly diagnostic identity native 5.3: ${transition} replaces function identity`, async context => {
    const { shell } = fixture(context);
    const result = await shell.exec(`readonly -a values=(one); f() { ${transition}; readonly -a values=(two); }; f\nprintf after`);
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "after", stderr: `shell: line 1: ${identity}: values: readonly variable\n`,
    });
  });
}
