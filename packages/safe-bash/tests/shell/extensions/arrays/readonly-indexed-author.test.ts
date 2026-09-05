import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { captureShellExtensions, type ShellExtension } from "../../../../src/shell/extensions.js";
import { captureShellSyntax, type ShellSyntaxDeclarations } from "../../../../src/shell/parser.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";

const profiles: readonly { name: string; extensions: readonly ShellExtension[] }[] = [
  { name: "default shell", extensions: [] },
  { name: "extension name alone", extensions: [{ name: "arrays", create: () => ({ builtins: [] }) }] },
  { name: "array-key syntax alone", extensions: [{ name: "keys-only", syntax: { arrayKeys: true }, create: () => ({ builtins: [] }) }] },
];

test("readonly indexed metadata preserves absent and empty captured shapes", () => {
  const expected = { listTerminators: [], specialParameters: [] };
  assert.deepEqual(captureShellSyntax({}), expected);
  assert.deepEqual(captureShellSyntax({ indexedDeclarations: [] } as ShellSyntaxDeclarations), expected);
  assert.deepEqual(captureShellSyntax({ arrayKeys: true }), { ...expected, arrayKeys: true });
});

test("readonly indexed metadata captures immutable explicit declarations independently", () => {
  const names = ["readonly"];
  const captured = captureShellSyntax({ indexedDeclarations: names } as ShellSyntaxDeclarations);
  names[0] = "local";
  assert.deepEqual(captured, { listTerminators: [], specialParameters: [], indexedDeclarations: ["readonly"] });
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(Object.isFrozen(Reflect.get(captured, "indexedDeclarations")), true);
  const extension = arraysExtension();
  assert.deepEqual(extension.syntax, { arrayKeys: true, indexedDeclarations: ["readonly"] });
  assert.deepEqual(captureShellExtensions([extension, { ...extension, name: "second" }]).syntax, {
    listTerminators: [], specialParameters: [], arrayKeys: true, indexedDeclarations: ["readonly"],
  });
});

for (const [name, declarations] of [
  ["unknown head", ["local"]], ["duplicates", ["readonly", "readonly"]],
  ["hole", new Array(1)], ["non-array", "readonly"],
  ["extra property", Object.assign(["readonly"], { extra: true })],
  ["symbol property", Object.assign(["readonly"], { [Symbol("extra")]: true })],
] as const) {
  test(`readonly indexed metadata rejects ${name}`, () => {
    assert.throws(() => captureShellSyntax({ indexedDeclarations: declarations } as ShellSyntaxDeclarations), TypeError);
  });
}

test("readonly indexed metadata rejects accessors without invoking them", () => {
  let calls = 0;
  const slot = Object.defineProperty(["readonly"], "0", { get: () => { calls++; return "readonly"; } });
  const property = Object.defineProperty({}, "indexedDeclarations", { get: () => { calls++; return ["readonly"]; } });
  assert.throws(() => captureShellSyntax({ indexedDeclarations: slot } as ShellSyntaxDeclarations), TypeError);
  assert.throws(() => captureShellSyntax(property as ShellSyntaxDeclarations), TypeError);
  assert.equal(calls, 0);
});

for (const profile of profiles) {
  test(`readonly indexed opt-in isolation: ${profile.name} retains unsupported -a`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: profile.extensions });
    context.after(() => shell.dispose());
    const result = await shell.exec("readonly -a values");
    assert.equal(result.exitCode, 2);
    assert.deepEqual(result.stdoutBytes, new Uint8Array());
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from("readonly: -a: unsupported option\n"));
  });

  test(`readonly indexed opt-in isolation: ${profile.name} rejects declaration compound grammar`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: profile.extensions });
    context.after(() => shell.dispose());
    const result = await shell.exec("readonly -a values=(one two)");
    assert.equal(result.exitCode, 2);
    assert.deepEqual(result.stdoutBytes, new Uint8Array());
    assert.notEqual(result.stderrBytes.length, 0);
  });
}

for (const head of ["readonly", "command readonly", "builtin readonly"]) {
  test(`readonly indexed captured dispatch: ${head} preserves raw values`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(`a=(OLD TAIL); ${head} -a a=$'\\xff'; printf '<%s>' "\${a[@]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3cff3e3c5441494c3e");
  });
}

for (const head of ["command readonly", "builtin readonly"]) {
  test(`readonly indexed primary 5.3 rejects direct compound after ${head}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    assert.equal((await shell.exec(`${head} -a a=(one two)`)).exitCode, 2);
  });
}

for (const [name, source, output] of [
  ["append preserves tail", `a=(old tail); readonly -a a+=new; printf '<%s>' "\${a[@]}"`, "<oldnew><tail>"],
  ["sparse listing of user bindings", `a=([3]='one two' [9]=''); readonly -a a; readonly -ap`, 'declare -ar a=([3]="one two" [9]="")\n'],
  ["unset indexed declaration is absent from indexed listing", `readonly -a empty; readonly -a`, ""],
  ["unset declaration retains scalar listing", `readonly -a empty; readonly -p`, "declare -r empty\n"],
  ["empty initialized array listing", `readonly -a a=(); readonly -a`, "declare -ar a=()\n"],
  ["explicit p operand declares without printing", `readonly -a a=(one two); readonly -p a`, ""],
  ["quoted compound stops without executing trailing source", `a=(OLD TAIL); readonly -a a='(one); printf INJECTED'; printf 'status=%s;' "$?"; printf '<%s>' "\${a[@]}"`, "status=0;<one>"],
  ["quoted compound accepts terminal input", `a=(OLD TAIL); readonly -a a='('; printf 'status=%s;count=%s' "$?" "\${#a[@]}"`, "status=0;count=0"],
] as const) {
  test(`readonly indexed primary 5.3 user namespace: ${name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(source, { env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, output);
  });
}

test("readonly indexed listing preserves raw byte quoting under C", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  const result = await shell.exec(String.raw`a=($'\xff' $'x\ny' '"' '\\' '$value' 'ü'); readonly -a a; readonly -ap`, { env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, String.raw`declare -ar a=([0]=$'\377' [1]=$'x\ny' [2]="\"" [3]="\\\\" [4]="\$value" [5]=$'\303\274')` + "\n");
});

test("readonly indexed primary 5.3 listing uses native escape spelling", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  const result = await shell.exec(String.raw`readonly -a a=($'\e'); readonly -ap`, { env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "declare -ar a=([0]=$'\\E')\n");
});

for (const route of ["eval", "source", "bash", "sh", "substitution", "subshell"]) {
  test(`readonly indexed syntax survives ${route}`, async context => {
    const fs = createMemoryFileSystem();
    const declaration = String.raw`readonly -a values=($'\xff' '�' ''); printf '<%s>' ` + '"${values[@]}"';
    await fs.writeFile("/script.sh", Buffer.from(declaration));
    const shell = new Shell({ fs, extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const quoted = "'" + declaration.split("'").join("'\\''") + "'";
    const source = route === "eval" ? `eval ${quoted}` : route === "subshell" ? `(${declaration})`
      : route === "substitution" ? `printf '%s' "$(${declaration})"` : `${route} /script.sh`;
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3cff3e3cefbfbd3e3c3e");
  });
}

test("readonly indexed syntax alone does not enable array-key syntax", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "declarations", syntax: { indexedDeclarations: ["readonly"] }, create: () => ({ builtins: [] }) }] });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("readonly -a values=(one two)")).exitCode, 0);
  assert.equal((await shell.exec('echo "${!values[@]}"')).exitCode, 2);
});

test("readonly indexed compound parsing consumes the shared source budget", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  const source = "readonly -a values='(after)'";
  await assert.rejects(shell.exec(source, { limits: { maxSourceBytes: Buffer.byteLength(source) } }), error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
});

test("readonly indexed compound quoted delimiters remain data", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(String.raw`readonly -a a=(')' $'\n' tail); printf '<%s>' ` + '"${a[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3c293e3c0a3e3c7461696c3e");
});

for (const assignment of ["a=changed", "a+=changed", "a[1]=changed", "a=(changed)"]) {
  test(`readonly indexed named assignment rejection: ${assignment}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(`a=(old tail); readonly -a a; (${assignment}); printf 'status=%s;' "$?"; printf '<%s>' "\${a[@]}"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "status=1;<old><tail>");
    assert.equal(result.stderr, "shell: line 1: a: readonly variable\n");
  });
}

test("readonly indexed plain declaration append preserves indexed tail", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec('a=(old tail); readonly a+=new; printf "<%s>" "${a[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<oldnew><tail>");
});

for (const assignment of ["a=new", "a[0]=new", "a=(new)"]) {
  test(`readonly indexed primary 5.3 assignment failure terminates script: ${assignment}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(`a=(old); readonly -a a; ${assignment}; printf after`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "shell: line 1: a: readonly variable\n");
  });
}

test("readonly indexed primary 5.3 unset member diagnostic and continuation", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(`readonly -a a=(one two); unset 'a[0]'; printf 'status=%s' "$?"`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "status=1");
  assert.equal(result.stderr, "shell: line 1: unset: a: cannot unset: readonly variable\n");
});

for (const reason of [false, 0, "", null]) {
  test(`readonly indexed listing preserves root cancellation ${JSON.stringify(reason)}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    const controller = new AbortController();
    let observed = false;
    await assert.rejects(shell.exec("readonly -a a=(one two); readonly -ap", {
      signal: controller.signal,
      stdout: { async write() { observed = true; controller.abort(reason); } },
    }), error => Object.is(error, reason));
    assert.equal(observed, true);
  });
}

test("readonly indexed declarations invalidate prepared writers on the canonical binding", async context => {
  let checked = false;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension(), {
    name: "inspect-binding", create: () => ({ builtins: [{ name: "inspect", async execute(command) {
      const transaction = await command.bindings.prepare("values", { kind: "indexed" });
      try {
        await transaction.set(0, "staged");
        assert.equal(await command.evaluate("readonly -a values"), 0);
        assert.deepEqual(command.bindings.describe("values"), { kind: "indexed", readonly: true, exported: false });
        assert.equal(Buffer.from(shellValueBytes(command.bindings.get("values", 0)!)).toString("hex"), "ff");
        await assert.rejects(transaction.commit(), /readonly|changed/u);
        await assert.rejects(command.bindings.assign("values", "overwrite"), /readonly/u);
        checked = true;
      } finally { await transaction.close(); }
      return 0;
    } }] }),
  }] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(String.raw`values=($'\xff' tail); inspect; printf '<%s>' ` + '"${values[@]}"');
  assert.equal(checked, true);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3cff3e3c7461696c3e");
});

test("readonly indexed syntax is captured before factory mutation and retained during evaluation", async context => {
  const declarations: "readonly"[] = ["readonly"];
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{
    name: "captured-declarations", syntax: { indexedDeclarations: declarations },
    create: () => { declarations.length = 0; return { builtins: [] }; },
  }] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(`readonly -a values=(one two); eval 'readonly -a inner=(three)'; printf '<%s>' "\${values[@]}" "\${inner[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<one><two><three>");
});

test("readonly indexed listing obeys the shared output budget", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("readonly -a values=(one two); readonly -ap", { limits: { maxOutputBytes: 2 } }),
    error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

for (const [name, source, output] of [
  ["repeated direct targets expand before attributes freeze", `readonly -a values=(first) values=(second); printf '%s' "$values"`, "second"],
  ["later operands observe earlier direct assignments", `readonly -a values=(first) tail="$values"; printf '%s|%s' "$values" "$tail"`, "first|first"],
] as const) {
  test(`readonly indexed primary 5.3 expansion phase: ${name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, output);
  });
}

const readonlyDiscardBoundaries = [
  {
    "name": "top-list",
    "source": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "61667465723d313a6f6e65",
    "stderrHex": "7368656c6c3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "group",
    "source": "readonly -a values=(one); { readonly -a values=(two); printf skipped\nprintf inner; }; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "61667465723d313a6f6e65",
    "stderrHex": "7368656c6c3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "function",
    "source": "readonly -a values=(one); f() { readonly -a values=(two); printf skipped\nprintf inner; }; f; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "61667465723d313a6f6e65",
    "stderrHex": "7368656c6c3a206c696e6520313a20663a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "if",
    "source": "readonly -a values=(one); if true; then readonly -a values=(two); printf skipped\nprintf inner; fi; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "61667465723d313a6f6e65",
    "stderrHex": "7368656c6c3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "subshell",
    "source": "readonly -a values=(one); (readonly -a values=(two); printf skipped\nprintf inner); printf \"outer=%s;\" \"$?\"\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "6f757465723d313b61667465723d303a6f6e65",
    "stderrHex": "7368656c6c3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "substitution",
    "source": "readonly -a values=(one); text=$(readonly -a values=(two); printf skipped\nprintf inner); printf \"outer=%s:<%s>;\" \"$?\" \"$text\"\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "6f757465723d313a3c3e3b61667465723d303a6f6e65",
    "stderrHex": "7368656c6c3a206c696e6520323a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "eval",
    "source": "readonly -a values=(one); eval 'readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"'; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "696e6e65723d313a6f6e653b6f7574657261667465723d303a6f6e65",
    "stderrHex": "7368656c6c3a206c696e6520313a206576616c3a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "source",
    "source": "source /dev/stdin; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "input": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "696e6e65723d313a6f6e653b6f7574657261667465723d303a6f6e65",
    "stderrHex": "2f6465762f737464696e3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "script",
    "source": "bash /dev/stdin; printf \"outer=%s;\" \"$?\"\nprintf after",
    "input": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "696e6e65723d313a6f6e653b6f757465723d303b6166746572",
    "stderrHex": "2f6465762f737464696e3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "and-or",
    "source": "readonly -a values=(one); readonly -a values=(two) || printf recovered; printf skipped\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "61667465723d313a6f6e65",
    "stderrHex": "7368656c6c3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "pipeline",
    "source": "readonly -a values=(one); { readonly -a values=(two); printf skipped\nprintf inner; } | while IFS= read -r line; do printf \"%s\" \"$line\"; done; printf \"outer=%s;\" \"$?\"\nprintf after",
    "status": 0,
    "stdoutHex": "6f757465723d303b6166746572",
    "stderrHex": "7368656c6c3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  }
] as const;

for (const entry of readonlyDiscardBoundaries) {
  test(`readonly indexed primary 5.3 discard boundary: ${entry.name}`, async context => {
    const fs = createMemoryFileSystem();
    if ("input" in entry) {
      await fs.mkdir("/dev");
      await fs.writeFile("/dev/stdin", Buffer.from(entry.input));
    }
    const extensions: ShellExtension[] = [arraysExtension()];
    if (entry.name === "pipeline") {
      const { readExtension } = await import("../../../../src/shell/extensions/read/index.js");
      extensions.push(readExtension());
    }
    const shell = new Shell({ fs, extensions });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(entry.source, { env: { LC_ALL: "C" } });
    assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") },
      { status: entry.status, stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex });
  });
}

const readonlyNestedDiscardBoundaries = [
  {
    "name": "errexit",
    "source": "set -e; readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"after=%s\" \"$?\"",
    "status": 0,
    "stdoutHex": "61667465723d31",
    "stderrHex": "7368656c6c3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "exit-trap",
    "source": "trap 'printf \"<exit:%s>\" \"$?\"' EXIT; readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf after",
    "status": 0,
    "stdoutHex": "61667465723c657869743a303e",
    "stderrHex": "7368656c6c3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "function-locals",
    "source": "values=outer; f() { local -a values; readonly -a values=(one); readonly -a values=(two); printf skipped; }; f; printf skipped\nvalues=restored; printf \"%s:%s\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "303a726573746f726564",
    "stderrHex": "7368656c6c3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "function-source",
    "source": "f() { source /dev/stdin; printf outer; }; f; printf after",
    "input": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "696e6e65723d313a6f6e653b6f757465726166746572",
    "stderrHex": "2f6465762f737464696e3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "eval-source",
    "source": "eval 'source /dev/stdin; printf outer'; printf after",
    "input": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "696e6e65723d313a6f6e653b6f757465726166746572",
    "stderrHex": "2f6465762f737464696e3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "function-script",
    "source": "f() { bash /dev/stdin; printf outer; }; f; printf after",
    "input": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "696e6e65723d313a6f6e653b6f757465726166746572",
    "stderrHex": "2f6465762f737464696e3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "sh-script",
    "source": "sh /dev/stdin; printf \"outer=%s;\" \"$?\"\nprintf after",
    "nativeSource": "sh() { \"$BASH\" --posix \"$@\"; }; sh /dev/stdin; printf \"outer=%s;\" \"$?\"\nprintf after",
    "input": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "696e6e65723d313a6f6e653b6f757465723d303b6166746572",
    "stderrHex": "2f6465762f737464696e3a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "standard-input-script",
    "source": "bash -s; printf \"outer=%s;\" \"$?\"\nprintf after",
    "input": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "status": 0,
    "stdoutHex": "696e6e65723d313a6f6e653b6f757465723d303b6166746572",
    "stderrHex": "626173683a206c696e6520313a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  }
] as const;

for (const entry of readonlyNestedDiscardBoundaries) {
  test(`readonly indexed primary 5.3 nested discard boundary: ${entry.name}`, async context => {
    const fs = createMemoryFileSystem();
    if ("input" in entry && entry.name !== "standard-input-script") {
      await fs.mkdir("/dev");
      await fs.writeFile("/dev/stdin", Buffer.from(entry.input));
    }
    const extensions: ShellExtension[] = [arraysExtension()];
    if (entry.name === "exit-trap") {
      const { trapExtension } = await import("../../../../src/shell/extensions/trap/index.js");
      extensions.push(trapExtension());
    }
    const shell = new Shell({ fs, extensions });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(entry.source, { env: { LC_ALL: "C" }, ...(entry.name === "standard-input-script" ? { stdin: entry.input } : {}) });
    assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") },
      { status: entry.status, stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex });
  });
}

const readonlyDiscardOrigins = [
  {
    "name": "eval-local",
    "source": "f() { local -a values; readonly -a values=(one); eval 'readonly -a values=(two)'; printf after; }; f",
    "status": 0,
    "stdoutHex": "6166746572",
    "stderrHex": "7368656c6c3a206c696e6520313a206576616c3a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "eval-global",
    "source": "readonly -a values=(one); f() { eval 'readonly -a values=(two)'; printf after; }; f",
    "status": 0,
    "stdoutHex": "6166746572",
    "stderrHex": "7368656c6c3a206c696e6520313a206576616c3a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  },
  {
    "name": "caller-local",
    "source": "g() { readonly -a values=(two); }; f() { local -a values; readonly -a values=(one); g; printf skipped; }; f\nprintf after",
    "status": 0,
    "stdoutHex": "6166746572",
    "stderrHex": "7368656c6c3a206c696e6520313a20673a2076616c7565733a20726561646f6e6c79207661726961626c650a"
  }
] as const;

for (const entry of readonlyDiscardOrigins) {
  test(`readonly indexed primary 5.3 discard origin: ${entry.name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(entry.source, { env: { LC_ALL: "C" } });
    assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") },
      { status: entry.status, stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex });
  });
}

for (const reason of [false, 0, "", null]) {
  test(`readonly indexed discard cleanup preserves root cancellation ${JSON.stringify(reason)}`, async context => {
    const memory = createMemoryFileSystem();
    const controller = new AbortController();
    let opens = 0;
    let closes = 0;
    const fs = new Proxy(memory, { get(target, key, receiver) {
      if (key !== "open") return Reflect.get(target, key, receiver);
      return async (...args: Parameters<NonNullable<typeof memory.open>>) => {
        opens++;
        const descriptor = await memory.open!(...args);
        const close = async () => { closes++; await descriptor.close(); controller.abort(reason); };
        return new Proxy(descriptor, { get(target, key, receiver) {
          if (key === "close") return close;
          const value: unknown = Reflect.get(target, key, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      };
    } });
    const shell = new Shell({ fs, extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const chunks: Uint8Array[] = [];
    await assert.rejects(shell.exec('readonly -a values=(one); { printf retained; readonly -a values=(two); printf skipped; } >/out\nprintf after', {
      signal: controller.signal, stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    }), error => Object.is(error, reason));
    assert.equal(opens, 1);
    assert.equal(closes, 1);
    assert.deepEqual(chunks, []);
    assert.equal(Buffer.from(await memory.readFile("/out")).toString(), "retained");
  });
}

const readonlyCommandIdentity = [
  {
    "name": "eval-first",
    "source": "readonly -a values=(one); eval 'readonly -a values=(two)'; printf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: eval: values: readonly variable\n"
  },
  {
    "name": "eval-after-colon",
    "source": "readonly -a values=(one); eval ':; readonly -a values=(two)'; printf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "function-first",
    "source": "readonly -a values=(one); f() { readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "function-after-colon",
    "source": "readonly -a values=(one); f() { :; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "eval-repeat-failure",
    "source": "readonly -a values=(one); eval 'readonly -a values=(two)\nreadonly -a values=(three)'; printf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: eval: values: readonly variable\nshell: line 2: eval: values: readonly variable\n"
  },
  {
    "name": "function-assignment",
    "source": "readonly -a values=(one); f() { unrelated=yes; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "function-completed-child",
    "source": "readonly -a values=(one); g() { :; }; f() { g; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "function-nonzero",
    "source": "readonly -a values=(one); f() { false; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "function-definition",
    "source": "readonly -a values=(one); f() { g() { :; }; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "function-subshell",
    "source": "readonly -a values=(one); f() { (:); readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  }
] as const;

for (const entry of readonlyCommandIdentity) {
  test(`readonly indexed primary 5.3 command identity lifetime: ${entry.name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const actual = await shell.exec(entry.source, { env: { LC_ALL: "C" } });
    assert.deepEqual({ status: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { status: entry.status, stdout: entry.stdout, stderr: entry.stderr });
  });
}

const readonlyAstIdentity = [
  {
    "name": "conditional-true",
    "source": "readonly -a values=(one); f() { [[ yes ]]; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "conditional-false",
    "source": "readonly -a values=(one); f() { [[ '' ]]; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "arithmetic-true",
    "source": "readonly -a values=(one); f() { ((1)); readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "arithmetic-false",
    "source": "readonly -a values=(one); f() { ((0)); readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "conditional-then-simple",
    "source": "readonly -a values=(one); f() { [[ yes ]]; :; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "arithmetic-then-simple",
    "source": "readonly -a values=(one); f() { ((1)); false; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "arithmetic-then-conditional",
    "source": "readonly -a values=(one); f() { ((1)); [[ yes ]]; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "group-conditional",
    "source": "readonly -a values=(one); f() { { [[ yes ]]; }; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "group-simple",
    "source": "readonly -a values=(one); f() { { :; }; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "if-no-body",
    "source": "readonly -a values=(one); f() { if [[ '' ]]; then :; fi; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "if-true-empty-effect",
    "source": "readonly -a values=(one); f() { if [[ yes ]]; then child() { :; }; fi; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "case-unmatched",
    "source": "readonly -a values=(one); f() { case no in yes) :;; esac; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "case-definition",
    "source": "readonly -a values=(one); f() { case yes in yes) child() { :; };; esac; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "case-conditional",
    "source": "readonly -a values=(one); f() { case yes in yes) [[ yes ]];; esac; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "for-empty",
    "source": "readonly -a values=(one); f() { for item in; do :; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "for-definition",
    "source": "readonly -a values=(one); f() { for item in one; do child() { :; }; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "for-arithmetic",
    "source": "readonly -a values=(one); f() { for item in one; do ((1)); done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "while-no-body",
    "source": "readonly -a values=(one); f() { while [[ '' ]]; do :; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "until-no-body",
    "source": "readonly -a values=(one); f() { until ((1)); do :; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "while-body",
    "source": "readonly -a values=(one); f() { while [[ yes ]]; do break; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "until-body",
    "source": "readonly -a values=(one); f() { until ((0)); do break; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "function-definition",
    "source": "readonly -a values=(one); f() { child() { :; }; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "subshell-conditional",
    "source": "readonly -a values=(one); f() { ([[ yes ]]); readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "arithmetic-parenthesized",
    "source": "readonly -a values=(one); f() { (((1))); readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "pipeline-conditional",
    "source": "readonly -a values=(one); f() { [[ yes ]] | :; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "pipeline-arithmetic",
    "source": "readonly -a values=(one); f() { ((1)) | ((0)); readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "assignment-substitution",
    "source": "readonly -a values=(one); f() { unused=\"$( [[ yes ]] )\"; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "function-child",
    "source": "readonly -a values=(one); f() { child() { [[ yes ]]; }; child; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "eval-child",
    "source": "readonly -a values=(one); f() { eval '[[ yes ]]'; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "negated-conditional",
    "source": "readonly -a values=(one); f() { ! [[ yes ]]; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "short-circuit-skipped",
    "source": "readonly -a values=(one); f() { [[ '' ]] && :; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "for-after-conditional-empty",
    "source": "readonly -a values=(one); f() { [[ yes ]]; for item in; do :; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "for-after-conditional-definition",
    "source": "readonly -a values=(one); f() { [[ yes ]]; for item in one; do child() { :; }; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "arithmetic-failure",
    "source": "readonly -a values=(one); f() { ((1/0)); readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: 1/0: division by 0 (error token is \"0\")\nshell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "top-conditional-true",
    "source": "readonly -a values=(one); [[ yes ]]; readonly -a values=(two)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "eval-conditional-true",
    "source": "readonly -a values=(one); eval '[[ yes ]]; readonly -a values=(two)'; printf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "top-next-unit-conditional-true",
    "source": "readonly -a values=(one); [[ yes ]]\nreadonly -a values=(two)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 2: [[: values: readonly variable\n"
  },
  {
    "name": "top-conditional-false",
    "source": "readonly -a values=(one); [[ '' ]]; readonly -a values=(two)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "eval-conditional-false",
    "source": "readonly -a values=(one); eval '[[ '\\'''\\'' ]]; readonly -a values=(two)'; printf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "top-next-unit-conditional-false",
    "source": "readonly -a values=(one); [[ '' ]]\nreadonly -a values=(two)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 2: [[: values: readonly variable\n"
  },
  {
    "name": "top-arithmetic-true",
    "source": "readonly -a values=(one); ((1)); readonly -a values=(two)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "eval-arithmetic-true",
    "source": "readonly -a values=(one); eval '((1)); readonly -a values=(two)'; printf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "top-next-unit-arithmetic-true",
    "source": "readonly -a values=(one); ((1))\nreadonly -a values=(two)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 2: ((: values: readonly variable\n"
  },
  {
    "name": "top-arithmetic-false",
    "source": "readonly -a values=(one); ((0)); readonly -a values=(two)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "eval-arithmetic-false",
    "source": "readonly -a values=(one); eval '((0)); readonly -a values=(two)'; printf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: ((: values: readonly variable\n"
  },
  {
    "name": "top-next-unit-arithmetic-false",
    "source": "readonly -a values=(one); ((0))\nreadonly -a values=(two)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 2: ((: values: readonly variable\n"
  }
] as const;

for (const entry of readonlyAstIdentity) {
  test(`readonly indexed primary 5.3 AST identity transition: ${entry.name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const actual = await shell.exec(entry.source, { env: { LC_ALL: "C" } });
    assert.deepEqual({ status: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { status: entry.status, stdout: entry.stdout, stderr: entry.stderr });
  });
}

for (const transition of ["[[ yes ]]", "((1))"]) for (const reason of [false, 0, "", null]) {
  test(`readonly indexed AST identity diagnostic cancellation: ${transition} ${JSON.stringify(reason)}`, async context => {
    const controller = new AbortController();
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    let writes = 0;
    const chunks: Uint8Array[] = [];
    await assert.rejects(shell.exec(`readonly -a values=(one); f() { ${transition}; readonly -a values=(two); }; f\nprintf after`, {
      signal: controller.signal, stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write() { writes++; controller.abort(reason); throw new Error("secondary diagnostic failure"); } },
    }), error => Object.is(error, reason));
    assert.equal(writes, 1);
    assert.deepEqual(chunks, []);
  });
}

const readonlyAstBoundaries = [
  {
    "name": "subshell-spaced-arithmetic",
    "source": "readonly -a values=(one); f() { ( ((1)) ); readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\n"
  },
  {
    "name": "function-failure-next-unit",
    "source": "readonly -a values=(one); f() { readonly -a values=(two); }; f\nreadonly -a values=(three)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: f: values: readonly variable\nshell: line 2: values: readonly variable\n"
  },
  {
    "name": "function-condition-failure-next-unit",
    "source": "readonly -a values=(one); f() { [[ yes ]]; readonly -a values=(two); }; f\nreadonly -a values=(three)\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\nshell: line 2: values: readonly variable\n"
  },
  {
    "name": "eval-condition-failure-next-unit",
    "source": "readonly -a values=(one); eval '[[ yes ]]; readonly -a values=(two)\nreadonly -a values=(three)'; printf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\nshell: line 2: [[: values: readonly variable\n"
  },
  {
    "name": "conditional-substitution",
    "source": "readonly -a values=(one); f() { [[ \"$( : )\" == '' ]]; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: [[: values: readonly variable\n"
  },
  {
    "name": "loop-break",
    "source": "readonly -a values=(one); f() { for item in one; do ((1)); break; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "loop-continue",
    "source": "readonly -a values=(one); f() { for item in one; do [[ yes ]]; continue; done; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  },
  {
    "name": "function-return",
    "source": "readonly -a values=(one); f() { g() { [[ yes ]]; return; }; g; readonly -a values=(two); }; f\nprintf after",
    "status": 0,
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n"
  }
] as const;

for (const entry of readonlyAstBoundaries) {
  test(`readonly indexed primary 5.3 AST identity boundary: ${entry.name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const actual = await shell.exec(entry.source, { env: { LC_ALL: "C" } });
    assert.deepEqual({ status: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { status: entry.status, stdout: entry.stdout, stderr: entry.stderr });
  });
}

const unsupportedConditionalOperandReference = {
  "name": "conditional-failure",
  "source": "readonly -a values=(one); f() { [[ 1 -eq 1/0 ]]; readonly -a values=(two); }; f\nprintf after",
  "status": 0,
  "stdout": "after",
  "stderr": "shell: line 1: [[: 1/0: division by 0 (error token is \"0\")\nshell: line 1: [[: values: readonly variable\n"
} as const;

test("readonly indexed unsupported-operand boundary control: first diagnostic remains unmatched; downstream identity matches native", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const expected = unsupportedConditionalOperandReference;
  const actual = await shell.exec(expected.source, { env: { LC_ALL: "C" } });
  const nativeFirst = Buffer.from('shell: line 1: [[: 1/0: division by 0 (error token is "0")\n');
  const virtualFirst = Buffer.from("shell: line 1: [[ numeric expression or literal: unsupported conditional profile\n");
  const downstream = Buffer.from("shell: line 1: [[: values: readonly variable\n");
  const nativeBytes = Buffer.from(expected.stderr);
  const virtualBytes = Buffer.from(actual.stderrBytes);
  assert.equal(actual.exitCode, expected.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from(expected.stdout));
  assert.deepEqual(nativeBytes, Buffer.concat([nativeFirst, downstream]));
  assert.deepEqual(virtualBytes, Buffer.concat([virtualFirst, downstream]));
  assert.deepEqual(virtualBytes.subarray(virtualFirst.length), nativeBytes.subarray(nativeFirst.length));
  assert.notDeepEqual(virtualBytes.subarray(0, virtualFirst.length), nativeFirst);
});
