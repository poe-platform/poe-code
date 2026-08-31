import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { createCommandArguments, getCommandArguments } from "../../src/contracts/command.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

function fixture(options: Parameters<typeof setup>[0] = {}) {
  const result = setup(options);
  for (const command of basicCommands()) if (command.name === "printf" || command.name === "echo") result.commands.register(command);
  return result;
}

test("direct printf preserves ff0041 without substitution", async () => {
  const { shell, fs } = fixture();
  const result = await shell.exec("printf '\\377\\000A' > bytes");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/bytes"), Uint8Array.of(255, 0, 65));
});

for (const [name, script, expected] of [
  ["scalar substitution", "value=$(printf '\\377'); printf '%s' \"$value\" > bytes", [255]],
  ["scalar copy", "value=$(printf '\\377'); copy=$value; printf '%s' \"$copy\" > bytes", [255]],
  ["mixed concatenation", "value=$(printf '\\377'); copy=A${value}B; printf '%s' \"$copy\" > bytes", [65, 255, 66]],
  ["multiple substitutions", "value=$(printf '\\303')$(printf '\\251'); printf '%s' \"$value\" > bytes", [195, 169]],
  ["append assignment", "value=$(printf '\\377'); value+=A; printf '%s' \"$value\" > bytes", [255, 65]],
  ["same-text overwrite", "value=$(printf '\\377'); value='�'; printf '%s' \"$value\" > bytes", [239, 191, 189]],
  ["alias survives overwrite", "value=$(printf '\\377'); copy=$value; value='�'; printf '%s%s' \"$copy\" \"$value\" > bytes", [255, 239, 191, 189]],
  ["readonly declaration", "readonly value=$(printf '\\377'); printf '%s' \"$value\" > bytes", [255]],
  ["export declaration", "export value=$(printf '\\377'); printf '%s' \"$value\" > bytes", [255]],
  ["local restoration", "value=$(printf '\\377'); f() { local value=A; printf '%s' \"$value\"; }; f > bytes; printf '%s' \"$value\" >> bytes", [65, 255]],
  ["local byte initializer", "f() { local value=$(printf '\\377'); printf '%s' \"$value\"; }; f > bytes", [255]],
  ["function positional", "value=$(printf '\\377'); f() { printf '%s' \"$1\"; }; f \"$value\" > bytes", [255]],
  ["quoted positional forwarding", "value=$(printf '\\377'); f() { printf '%s' \"$@\"; }; f A \"$value\" B > bytes", [65, 255, 66]],
  ["set and shift", "value=$(printf '\\377'); set -- A \"$value\"; shift; printf '%s' \"$1\" > bytes", [255]],
  ["subshell clone", "value=$(printf '\\377'); (printf '%s' \"$value\" > bytes)", [255]],
  ["temporary assignment restore", "value=$(printf '\\377'); value=A true; printf '%s' \"$value\" > bytes", [255]],
  ["NUL removal before trailing LF trim", "value=$(printf '\\377\\000A\\n\\000\\n'); printf '%s' \"$value\" > bytes", [255, 65]],
  ["for-loop scalar assignment", "value=$(printf '\\377'); for copy in \"$value\"; do printf '%s' \"$copy\"; done > bytes", [255]],
  ["default assignment", "printf '%s' \"${value:=$(printf '\\377')}\" \"$value\" > bytes", [255, 255]],
  ["command forwarding", "value=$(printf '\\377'); command -- printf '%s' \"$value\" > bytes", [255]],
  ["ASCII IFS splitting", "value=$(printf 'A \\377 B'); printf '%s' $value > bytes", [65, 255, 66]],
] as const) {
  test(`lossless shell values: ${name}`, async () => {
    const { shell, fs } = fixture();
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/bytes"), Uint8Array.from(expected));
  });
}

test("ordinary Unicode text keeps its text semantics", async () => {
  const { shell, fs } = fixture();
  const result = await shell.exec("value='é🙂�'; printf '%s' \"$value\" > bytes");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/bytes"), new TextEncoder().encode("é🙂�"));
});

test("execution-local bytes and copies do not become globals across exec", async () => {
  const { shell } = fixture();
  const first = await shell.exec("value=$(printf '\\377'); copy=$value; text='é🙂'; printf '%s' \"$value\" \"$copy\" \"$text\"; value='�'; printf '%s' \"$value\" \"$copy\"; unset value; printf '%s' \"$value\" \"$copy\"");
  assert.equal(first.exitCode, 0, first.stderr);
  const expected = Uint8Array.of(255, 255, ...new TextEncoder().encode("é🙂�"), 255, 255);
  assert.deepEqual(first.stdoutBytes, expected);
  assert.deepEqual((await shell.exec('printf "%s" "$value" "$copy" "$text"')).stdoutBytes, new Uint8Array());
  assert.deepEqual(first.stdoutBytes, expected);
  await shell.dispose();
});

test("configured and per-exec text environments never inherit equal projected raw bytes", async () => {
  const { shell } = fixture({ env: { value: "�" } });
  const first = await shell.exec("value=$(printf '\\377'); printf '%s' \"$value\"");
  assert.deepEqual(first.stdoutBytes, Uint8Array.of(255));
  assert.deepEqual((await shell.exec('printf "%s" "$value"', { env: { value: "é" } })).stdoutBytes, new TextEncoder().encode("é"));
  assert.deepEqual((await shell.exec('printf "%s" "$value"')).stdoutBytes, Uint8Array.of(239, 191, 189));
  assert.deepEqual(first.stdoutBytes, Uint8Array.of(255));
  await shell.dispose();
});

test("readonly values and local restoration retain bytes only within their execution", async () => {
  const { shell } = fixture();
  const denied = await shell.exec("readonly frozen=$(printf '\\377'); frozen='�'");
  assert.notEqual(denied.exitCode, 0);
  const local = await shell.exec("readonly frozen=$(printf '\\377'); value=$(printf '\\376'); f() { local value=A; printf '%s' \"$value\"; }; f; printf '%s' \"$value\" \"$frozen\"");
  assert.deepEqual(local.stdoutBytes, Uint8Array.of(65, 254, 255));
  assert.deepEqual((await shell.exec('printf "%s" "$value" "$frozen"')).stdoutBytes, new Uint8Array());
  const fresh = await shell.exec("frozen='�'; printf '%s' \"$frozen\"");
  assert.equal(fresh.exitCode, 0, fresh.stderr);
  assert.deepEqual(fresh.stdoutBytes, Uint8Array.of(239, 191, 189));
  await shell.dispose();
});

test("cancelled exec cannot change configured values or earlier owned output", async () => {
  const { shell, commands } = fixture({ env: { value: "é" } });
  const controller = new AbortController();
  const reason = Object.freeze({ cancelled: true });
  commands.register({ name: "cancel", execute() { controller.abort(reason); return { exitCode: 0 }; } });
  const first = await shell.exec("value=$(printf '\\377'); printf '%s' \"$value\"");
  await assert.rejects(shell.exec("value=$(printf '\\376'); cancel", { signal: controller.signal }), error => error === reason);
  assert.deepEqual((await shell.exec('printf "%s" "$value"')).stdoutBytes, new TextEncoder().encode("é"));
  assert.deepEqual(first.stdoutBytes, Uint8Array.of(255));
  await shell.dispose();
});

test("closed execution byte quota is not inherited and fresh bytes are admitted before effects", async () => {
  const { shell, commands } = fixture({ limits: { maxExpansionBytes: 4096, maxExpansionFields: 128 } });
  let effects = 0;
  commands.register({ name: "emit", async execute(context) { await context.stdout.write(new Uint8Array(128).fill(255)); return { exitCode: 0 }; } });
  commands.register({ name: "effect", execute() { effects++; return { exitCode: 0 }; } });
  const first = await shell.exec("value=$(emit); printf '%s' \"$value\"");
  assert.deepEqual(first.stdoutBytes, new Uint8Array(128).fill(255));
  assert.equal((await shell.exec("effect", { limits: { maxExpansionBytes: 100 } })).exitCode, 0);
  assert.equal(effects, 1);
  await assert.rejects(shell.exec('effect "$(emit)"', { limits: { maxExpansionBytes: 100 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  assert.equal(effects, 1);
  assert.deepEqual((await shell.exec('printf "%s" "$value"')).stdoutBytes, new Uint8Array());
  assert.deepEqual(first.stdoutBytes, new Uint8Array(128).fill(255));
  await shell.dispose();
});

test("concurrent executions retain independent byte scopes without sharing scalar writes", async () => {
  const { shell, commands } = fixture();
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  commands.register({ name: "pause", async execute() { started(); await wait; return { exitCode: 0 }; } });
  const pending = shell.exec("left=$(printf '\\377'); pause; printf '%s' \"$left\" \"$right\"");
  await entered;
  let left: Awaited<typeof pending>;
  try {
    const right = await shell.exec("right=$(printf '\\376'); printf '%s' \"$left\" \"$right\"");
    assert.equal(right.exitCode, 0, right.stderr);
    assert.deepEqual(right.stdoutBytes, Uint8Array.of(254));
  } finally { release(); left = await pending; }
  assert.equal(left.exitCode, 0, left.stderr);
  assert.deepEqual(left.stdoutBytes, Uint8Array.of(255));
  assert.deepEqual((await shell.exec('printf "%s" "$left" "$right"')).stdoutBytes, new Uint8Array());
  await shell.dispose();
});

test("repeated isolated executions release byte sharing and overwrite reservations", async () => {
  const { shell } = fixture({ limits: { maxExpansionBytes: 2048, maxExpansionFields: 64 } });
  for (let index = 0; index < 30; index++) {
    const result = await shell.exec("value=$(printf '\\377'); copy=$value; value=text; value=$(printf '\\376'); printf '%s' \"$copy\" \"$value\"");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 254));
    assert.deepEqual((await shell.exec('printf "%s" "$value" "$copy"')).stdoutBytes, new Uint8Array());
  }
  await shell.dispose();
});

test("isolated text-only executions retain ordinary low-budget admission", async () => {
  const { shell } = fixture({ env: { value: "é" }, limits: { maxExpansionBytes: 6, maxExpansionFields: 3 } });
  assert.equal((await shell.exec("value=x; printf %s \"$value\"")).stdout, "x");
  const result = await shell.exec('printf %s "$value"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, new TextEncoder().encode("é"));
  await shell.dispose();
});

test("cleanup failure releases execution values without changing configured text", async () => {
  const { shell, commands } = fixture({ env: { value: "�" }, limits: { maxExpansionBytes: 2048, maxExpansionFields: 64 } });
  const reason = Object.freeze({ cleanup: true });
  commands.register({ name: "bad_cleanup", execute(context) { context.registerCleanup!(() => { throw reason; }); return { exitCode: 0 }; } });
  const first = await shell.exec("value=$(printf '\\377'); printf '%s' \"$value\"");
  for (let index = 0; index < 10; index++) {
    await assert.rejects(shell.exec("value=$(printf '\\376'); bad_cleanup"), error => error === reason);
    assert.deepEqual((await shell.exec('printf "%s" "$value"')).stdoutBytes, Uint8Array.of(239, 191, 189));
    assert.deepEqual(first.stdoutBytes, Uint8Array.of(255));
  }
  await shell.dispose();
});

test("disposing another Shell cannot close independent active byte ownership", async () => {
  const first = fixture();
  const second = fixture();
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  second.commands.register({ name: "pause", async execute() { started(); await wait; return { exitCode: 0 }; } });
  const earlier = await first.shell.exec("value=$(printf '\\377'); printf '%s' \"$value\"");
  const pending = second.shell.exec("value=$(printf '\\376'); pause; printf '%s' \"$value\"");
  await entered;
  let result: Awaited<typeof pending>;
  try { await first.shell.dispose(); }
  finally { release(); result = await pending; }
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(254));
  assert.deepEqual(earlier.stdoutBytes, Uint8Array.of(255));
  assert.deepEqual((await second.shell.exec('printf "%s" "$value"')).stdoutBytes, new Uint8Array());
  await assert.rejects(first.shell.exec("true"), /disposed/u);
  await second.shell.dispose();
});

test("ANSI-C byte fragments concatenate before projection while genuine Unicode stays distinct", async () => {
  const { shell } = fixture();
  const result = await shell.exec("printf '%s' A$'\\xff'B $'\\xc3'$'\\xa9' '�' $'\\xfe' $'A\\0B'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(65, 255, 66, 195, 169, 239, 191, 189, 254, 65));
  await shell.dispose();
});

test("ANSI-C raw arguments are admitted before generic command effects", async () => {
  const { shell, commands } = fixture();
  let effects = 0;
  commands.register({ name: "effect", execute() { effects++; return { exitCode: 0 }; } });
  await assert.rejects(shell.exec("effect $'\\xff'", { limits: { maxExpansionBytes: 32 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  assert.equal(effects, 0);
  await shell.dispose();
});

test("builtin forwarding bypasses functions but never admits arbitrary registered commands", async () => {
  const { shell, commands } = fixture();
  let effects = 0;
  commands.register({ name: "custom", execute() { effects++; return { exitCode: 0 }; } });
  const result = await shell.exec("printf() { echo wrong; }; builtin printf '%s' $'\\xff'; command printf '%s' $'\\xfe'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 254));
  const denied = await shell.exec("builtin custom");
  assert.equal(denied.exitCode, 1);
  assert.match(denied.stderr, /not a shell builtin/u);
  assert.equal(effects, 0);
  await shell.dispose();
});

test("generic byte-aware command receives scalar values independently of printf", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "retain", async execute(context) {
    const values = getCommandArguments(context);
    for (let index = 0; index < values.args.length; index++) await context.stdout.write(values.bytes(index)!);
    return { exitCode: 0 };
  } });
  const result = await shell.exec("value=$(printf '\\377'); copy=A${value}; copy+=B; retain \"$copy\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(65, 255, 66));
});

for (const header of ["#!/usr/bin/env capture", "#!/usr/bin/env -S capture fixed"]) {
  test(`env shebang rebinding retains literal and raw arguments: ${header}`, async () => {
    const { shell, fs, commands } = fixture();
    let calls = 0;
    commands.register({ name: "capture", async execute(context) {
      calls++;
      const arguments_ = getCommandArguments(context);
      assert.deepEqual(arguments_.args.slice(0, -2), header.includes("-S") ? ["fixed", "/program"] : ["/program"]);
      await context.stdout.write(arguments_.bytes(arguments_.args.length - 2)!);
      await context.stdout.write(arguments_.bytes(arguments_.args.length - 1)!);
      return { exitCode: 0 };
    } });
    await fs.writeFile("/program", new TextEncoder().encode(`${header}\n`), { mode: 0o755 });
    try {
      const result = await shell.exec("/program $'\\xff' $'\\xfe'");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 254));
      assert.equal(calls, 1);
    } finally { await shell.dispose(); }
  });
}

test("env shebang stages reject stale middleware argv before target effects", async () => {
  const { shell, fs, commands } = fixture();
  let calls = 0;
  commands.register({ name: "capture", execute() { calls++; return { exitCode: 0 }; } });
  shell.use((context, next) => {
    if (context.command === "capture") Object.defineProperty(context, "args", { value: [...context.args] });
    return next();
  });
  await fs.writeFile("/program", new TextEncoder().encode("#!/usr/bin/env capture\n"), { mode: 0o755 });
  try {
    const result = await shell.exec("/program $'\\xff'");
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /identity does not match/u);
    assert.equal(calls, 0);
  } finally { await shell.dispose(); }
});

test("byte-aware invocation preserves explicit owned values and literal argv", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "retain", async execute(context) {
    await context.stdout.write(getCommandArguments(context).bytes(0)!);
    return { exitCode: 0 };
  } });
  commands.register({ name: "forward", async execute(context) {
    const carrier = getCommandArguments(context);
    return context.invoke!("retain", carrier.args, { argumentValues: carrier });
  } });
  const result = await shell.exec("value=$(printf '\\377'); forward \"$value\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
});

test("same-text replacement argv cannot inherit a stale byte carrier", async () => {
  const { shell, commands } = fixture();
  let executed = 0;
  commands.register({ name: "retain", execute() { executed++; return { exitCode: 0 }; } });
  shell.use((context, next) => {
    if (context.command === "retain") Object.defineProperty(context, "args", { value: [...context.args] });
    return next();
  });
  const result = await shell.exec("value=$(printf '\\377'); retain \"$value\"");
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /identity does not match/u);
  assert.equal(executed, 0);
});

test("legacy text-only middleware can replace argv without acquiring byte provenance", async () => {
  const { shell, commands } = fixture();
  let executed = 0;
  commands.register({ name: "observe", async execute(context) {
    executed++;
    assert.deepEqual(context.args, ["�", "é"]);
    const arguments_ = getCommandArguments(context);
    await context.stdout.write(arguments_.bytes(0)!);
    await context.stdout.write(arguments_.bytes(1)!);
    return { exitCode: 0 };
  } });
  shell.use((context, next) => {
    if (context.command === "observe") {
      assert.equal(context.argumentValues, undefined);
      Object.assign(context, { args: ["�", "é"] });
    }
    return next();
  });
  try {
    const result = await shell.exec("observe plain");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new TextEncoder().encode("�é"));
    assert.equal(executed, 1);
  } finally { await shell.dispose(); }
});

for (const reason of [false, 0, null]) {
  test(`text-only argv replacement reaches cancellation and retains ${String(reason)}`, async () => {
    const { shell, commands } = fixture();
    const controller = new AbortController();
    let executed = 0;
    commands.register({ name: "cancel", execute(context) {
      executed++;
      assert.deepEqual(context.args, ["replacement"]);
      controller.abort(reason);
      return { exitCode: 0 };
    } });
    shell.use((context, next) => {
      if (context.command === "cancel") Object.assign(context, { args: ["replacement"] });
      return next();
    });
    try {
      await assert.rejects(shell.exec("cancel original", { signal: controller.signal }), error => error === reason);
      assert.equal(executed, 1);
    } finally { await shell.dispose(); }
  });
}

test("replacement byte carriers are budget-admitted before their command runs", async () => {
  const { shell, commands } = fixture();
  const replacement = createCommandArguments([shellValueFromBytes(new Uint8Array(512).fill(255))]);
  let executed = 0;
  commands.register({ name: "retain", execute() { executed++; return { exitCode: 0 }; } });
  shell.use((context, next) => {
    Object.defineProperties(context, { args: { value: replacement.args }, argumentValues: { value: replacement } });
    return next();
  });
  await assert.rejects(shell.exec("retain", { limits: { maxExpansionBytes: 256 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  assert.equal(executed, 0);
});

test("repeated overwrites and closed command scopes release retained byte quota", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "retain", async execute(context) {
    await context.stdout.write(getCommandArguments(context).bytes(0)!);
    return { exitCode: 0 };
  } });
  const source = `${"value=$(printf '\\377'); value=text; ".repeat(100)}value=$(printf '\\377'); retain "$value"`;
  const result = await shell.exec(source, { limits: { maxExpansionBytes: 1024, maxExpansionFields: 64 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
});

test("pipeline and subshell snapshots release byte references after completion", async () => {
  const { shell } = fixture();
  const source = `value=$(printf '\\377'); ${"(true); true | true; ".repeat(30)}printf '%s' "$value"`;
  const result = await shell.exec(source, { limits: { maxExpansionBytes: 2048, maxExpansionFields: 64 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
});

test("ordinary text argv and valid UTF8 substitutions do not consume byte-retention quota", async () => {
  const { shell } = fixture();
  const result = await shell.exec('value=$(pass); printf "%s" "$value"', { stdin: "é", limits: { maxExpansionBytes: 6, maxExpansionFields: 3 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "é");
});

for (const [id, source, stdoutHex] of [
  ["15-substitution-trailing-lf", "one=$(printf 'A\\n'); many=$(printf 'B\\n\\n\\n'); empty=$(printf '\\n\\n'); embedded=$(printf 'C\\nD\\n'); printf '<%s>|<%s>|<%s>|<%s>\\n' \"$one\" \"$many\" \"$empty\" \"$embedded\"", "3c413e7c3c423e7c3c3e7c3c430a443e0a"],
  ["16-substitution-nul-warning", "value=$(printf '\\xff\\0\\xfe\\0Z\\n\\n'); printf '<%s>\\n' \"$value\"", "3cfffe5a3e0a"],
  ["22-printf-missing-conversions", "printf '<%s>|<%b>|<%d>|<%.2s>\\n'", "3c3e7c3c3e7c3c303e7c3c3e0a"],
  ["23-printf-byte-precision", "printf '<%.1s><%.2s><%.3s>\\n' '�' '�' '�'", "3cef3e3cefbf3e3cefbfbd3e0a"],
  ["27-echo-escapes-no-newline", "echo -ne '\\xff\\0\\376'; printf '|end\\n'", "ff005c3337367c656e640a"],
  ["32-nul-scalar-versus-output", "value=$'A\\0B'; printf '<%s>|' \"$value\"; printf 'A\\0B\\n'", "3c413e7c4100420a"],
] as const) {
  test(`captured Bash 5.3.15 C-locale golden ${id}`, async () => {
    const { shell } = fixture();
    const result = await shell.exec(source, { env: { LC_ALL: "C", LANG: "C" } });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), stdoutHex);
    assert.equal(result.stderr, id === "16-substitution-nul-warning" ? "shell: line 1: warning: command substitution: ignored null byte in input\n" : "");
  });
}
