import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem, toByteSource } from "../../src/index.js";
import { setup } from "./helpers.js";
import type { CommandContext } from "../../src/index.js";

const encode = (source: string) => Buffer.from(source);

test("env shebang uses the public Shell without registering env", async () => {
  const { shell, fs, commands } = setup();
  assert.equal(commands.has("env"), false);
  await fs.writeFile("/program", encode('#!/usr/bin/env -S bash --\nargs "$0" "$#" "$@"'), { mode: 0o755 });
  const result = await shell.exec("./program '' 'a b' '; say injected' '*'");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '["./program","4","","a b","; say injected","*"]');
  assert.equal(result.stderr, "");
  await shell.dispose();
});

test("single optional argument is not shell-tokenized without S", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/program", encode("#!/usr/bin/env bash -e\nsay BAD"), { mode: 0o755 });
  assert.deepEqual(await shell.exec("./program").then(({ exitCode, stdout, stderr }) => ({ exitCode, stdout, stderr })), {
    exitCode: 127, stdout: "", stderr: "env: bash -e: command not found\n",
  });
  await shell.dispose();
});

test("short, attached, long and nested S preserve quoting and literal arguments", async () => {
  const { shell, fs } = setup();
  for (const header of ["-S bash", "-Sbash", "--split-string=bash", "-S -S 'bash'", "-S bash # ignored", "-S bash\\c ignored"]) {
    await fs.writeFile("/program", encode(`#! /usr/bin/env\t${header}\t \nargs "$@"`), { mode: 0o755 });
    const result = await shell.exec("/program '' 'a b'");
    assert.equal(result.exitCode, 0, `${header}: ${result.stderr}`);
    assert.equal(result.stdout, '["","a b"]', header);
    assert.equal(result.stderr, "");
  }
  await shell.dispose();
});

test("split expansion reads incoming exports before clear, unset and assignments", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/program", encode('#!/usr/bin/env -S -i -u OLD -u KEEP OLD=new COPY=${OLD} EMPTY="" bash\nargs "$OLD" "$COPY" "$EMPTY" "${KEEP-unset}" "${LOCAL-unset}" "$PWD"; envget OLD COPY EMPTY KEEP'), { mode: 0o755 });
  const result = await shell.exec('export OLD="old value" KEEP=keep; LOCAL=private; /program; args "$OLD" "$KEEP" "$LOCAL"; pwd');
  assert.equal(result.stdout, '["new","old value","","unset","unset","/"]new|old value||<unset>["old value","keep","private"]/\n');
  assert.equal(result.stderr, "");
  await shell.dispose();
});

test("C resolves actual selected source and keeps parent cwd and state", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/other");
  await fs.writeFile("/program", encode("#!/usr/bin/env -S -C /other bash\nsay BAD"), { mode: 0o755 });
  await fs.writeFile("/other/program", encode('args "$0" "$PWD" "$@"; export LEAK=yes; cd /'), { mode: 0o644 });
  const result = await shell.exec('set -- parent; ./program literal; args "$PWD" "${LEAK-unset}" "$@"');
  assert.equal(result.stdout, '["./program","/other","literal"]["/","unset","parent"]');
  assert.equal(result.stderr, "");
  await shell.dispose();
});

test("absolute original source survives C and is charged and read only once", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/other");
  const body = '#!/usr/bin/env -S -C /other bash\nargs "$PWD"';
  await fs.writeFile("/program", encode(body), { mode: 0o755 });
  let reads = 0;
  const readFile = fs.readFile.bind(fs);
  fs.readFile = async (...args) => { reads++; return readFile(...args); };
  const result = await shell.exec("/program", { limits: { maxSourceBytes: Buffer.byteLength(body) + 8, maxSubstitutionDepth: 1 } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '["/other"]');
  assert.equal(reads, 1);
  await shell.dispose();
});

test("alternate operand, c and s select source rather than original body", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/alternate", encode('args "$0" "$@"'), { mode: 0o644 });
  const cases = [
    { header: "-S bash /alternate fixed", input: "", output: '["/alternate","fixed","/program","user"]' },
    { header: `-S bash -c 'args "$0" "$@"' chosen`, input: "", output: '["chosen","/program","user"]' },
    { header: "-S sh -s fixed", input: 'args "$0" "$@"\n', output: '["sh","fixed","/program","user"]' },
  ];
  for (const fixture of cases) {
    await fs.writeFile("/program", encode(`#!/usr/bin/env ${fixture.header}\nif BAD invalid original body`), { mode: 0o755 });
    const result = await shell.exec("/program user", { stdin: fixture.input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, fixture.output);
    assert.equal(result.stderr, "");
  }
  await shell.dispose();
});

test("explicit interpreters ignore headers while direct interpreter guards remain", async (context) => {
  const { shell, fs } = setup({ env: { HEADER_VALUE: "retained" } });
  context.after(() => shell.dispose());
  let environmentStages = 0;
  const bodyEnvironments: (string | undefined)[] = [];
  shell.use(async (command, next) => {
    if (command.command === "env") environmentStages++;
    if (command.command === "say") bodyEnvironments.push(command.env.HEADER_VALUE);
    return next();
  });
  await fs.writeFile("/program", encode("#!/usr/bin/env -S -i bash -e\nfalse; say body"), { mode: 0o755 });
  const withoutHeaderEffects = await shell.exec("bash +e /program");
  assert.equal(withoutHeaderEffects.exitCode, 0);
  assert.equal(withoutHeaderEffects.stdout, "body\n");
  assert.equal(withoutHeaderEffects.stderr, "");
  assert.equal(environmentStages, 0);
  assert.deepEqual(bodyEnvironments, ["retained"]);
  assert.equal((await shell.exec("bash -e /program")).exitCode, 1);
  assert.equal(environmentStages, 0);
  assert.equal((await shell.exec("/program")).exitCode, 1);
  assert.equal(environmentStages, 1);
  await fs.writeFile("/program", encode("#!/unknown\nsay BAD"));
  const explicit = await shell.exec("bash /program");
  assert.equal(explicit.exitCode, 0);
  assert.equal(explicit.stdout, "BAD\n");
  assert.equal(Buffer.from(explicit.stdoutBytes).toString("hex"), "4241440a");
  assert.equal(explicit.stderr, "");
  assert.deepEqual(bodyEnvironments, ["retained", "retained"]);
  const refused = await shell.exec("/program");
  assert.equal(refused.exitCode, 126);
  assert.equal(refused.stdout, "");
  assert.match(refused.stderr, /unsupported interpreter: \/unknown/u);
  assert.equal(environmentStages, 1);
  assert.deepEqual(bodyEnvironments, ["retained", "retained"]);
});

test("bash/sh flags retain e, +e, --, combinations and invalid flag status", async () => {
  const { shell, fs } = setup();
  for (const [flags, status, stdout] of [["bash -ee", 1, ""], ["sh -e +e --", 0, "body\n"], ["bash -e --", 1, ""], ["bash -", 0, "body\n"], ["bash -ec 'false; say BAD'", 1, ""], ["sh -u", 2, ""], ["bash +c", 2, ""]] as const) {
    await fs.writeFile("/program", encode(`#!/usr/bin/env -S ${flags}\nfalse; say body`), { mode: 0o755 });
    const result = await shell.exec("/program");
    assert.equal(result.exitCode, status, flags);
    assert.equal(result.stdout, stdout, flags);
    if (status === 2) assert.match(result.stderr, /unsupported option; supported flags are/u);
    else assert.equal(result.stderr, "");
  }
  await shell.dispose();
});

test("env errors retain parser, usage and VFS status and ordering", async () => {
  const { shell, fs } = setup();
  let missingStats = 0;
  const stat = fs.stat.bind(fs);
  fs.stat = async (path, options) => { if (path === "/missing") missingStats++; return stat(path, options); };
  for (const [header, status, diagnostic] of [
    ["-S bash '", 125, /no terminating quote in -S string/u],
    ["--split-string bash", 2, /unrecognized option '--split-string bash'/u],
    ["-S -C /missing --bad bash", 2, /unrecognized option '--bad'/u],
    ["-S -C /missing -0 bash", 2, /cannot specify --null with a command/u],
    ["-S -C /missing bash", 1, /ENOENT/u],
    ["-S missing", 127, /command not found/u],
  ] as const) {
    await fs.writeFile("/program", encode(`#!/usr/bin/env ${header}\nsay BAD`), { mode: 0o755 });
    const result = await shell.exec("/program");
    assert.equal(result.exitCode, status, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, diagnostic);
  }
  assert.equal(missingStats, 1);
  await shell.dispose();
});

test("reserved interpreter resists hijacks while exact registered targets execute", async () => {
  const { shell, fs, commands } = setup();
  let hijacks = 0;
  for (const name of ["env", "alien"]) commands.register({ name, execute() { hijacks++; return { exitCode: 37 }; } });
  await fs.writeFile("/program", encode("#!/usr/bin/env -S bash\nsay body"), { mode: 0o755 });
  assert.equal((await shell.exec('bash() { say BAD; }; env() { say BAD; }; PATH=/missing /program')).stdout, "body\n");
  commands.register({ name: "bash", execute() { hijacks++; return { exitCode: 37 }; } });
  const overridden = await shell.exec("/program");
  assert.equal(overridden.exitCode, 126);
  assert.match(overridden.stderr, /unsupported interpreter override: bash/u);
  assert.equal(hijacks, 0);
  await fs.writeFile("/program", encode("#!/usr/bin/env -S alien\nsay BAD"));
  const registered = await shell.exec("/program");
  assert.equal(registered.exitCode, 37);
  assert.equal(registered.stdout, "");
  assert.equal(registered.stderr, "");
  assert.equal(hijacks, 1);
  await shell.dispose();
});

test("binary stdin, pipelines, unread cursor and inherited descriptors survive", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/program", encode('#!/usr/bin/env -S bash\nread -r first; args "$first"; exit 7'), { mode: 0o755 });
  const binary = Buffer.from([0, 255, 128]);
  const result = await shell.exec('/program; args "$?"; pass', { stdin: Buffer.concat([Buffer.from("line\n"), binary]) });
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.concat([Buffer.from('["line"]["7"]'), binary]));
  await fs.writeFile("/program", encode("#!/usr/bin/env -S bash\npass; say child >&3; : 3>&-"));
  const pipeline = await shell.exec("{ bytes | /program | pass; say parent >&3; } 3>out", { limits: { pipeHighWaterMark: 1 } });
  assert.deepEqual([...pipeline.stdoutBytes], [0, 255, 195, 169, 128, 10]);
  assert.equal(pipeline.stderr, "");
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "child\nparent\n");
  await shell.dispose();
});

test("stdin provenance is forwarded without probing or local promotion", async () => {
  const { shell, fs, commands } = setup();
  const origins: (boolean | undefined)[] = [];
  commands.register({ name: "origin", execute(context) { origins.push(context.stdinIsDefault); return { exitCode: 0 }; } });
  commands.register({ name: "delegate", execute(context) { return context.invoke!("/program", [], { stdin: toByteSource(""), stdinIsDefault: true }); } });
  await fs.writeFile("/program", encode("#!/usr/bin/env -S -i sh\norigin"), { mode: 0o755 });
  await shell.exec("/program; delegate");
  await shell.exec("/program", { stdin: "" });
  await fs.writeFile("/empty", new Uint8Array());
  await shell.exec("/program <empty; /program 0<&-; bytes | /program");
  assert.deepEqual(origins, [true, true, false, false, false, false]);
  await shell.dispose();
});

test("initial and alternate file permission, binary and syntax refusals retain effects", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/program", encode("#!/usr/bin/env -S bash\nsay BAD"), { mode: 0o644 });
  assert.equal((await shell.exec("/program")).exitCode, 126);
  await fs.chmod("/program", 0o755);
  await fs.writeFile("/program", encode("#!/usr/bin/env -S bash /alternate\nsay BAD"));
  await fs.writeFile("/alternate", Uint8Array.of(255));
  assert.equal((await shell.exec("/program")).exitCode, 126);
  await fs.writeFile("/alternate", encode("say BAD >touched; if true; then"));
  assert.equal((await shell.exec("/program")).exitCode, 2);
  await assert.rejects(fs.stat("/touched"), { code: "ENOENT" });
  await fs.chmod("/alternate", 0);
  assert.equal((await shell.exec("/program")).exitCode, 126);
  await shell.dispose();
});

test("shared source, command, output, depth, loop and generated argv limits", async () => {
  const { shell, fs } = setup();
  const body = "#!/usr/bin/env -S bash\nsay body";
  await fs.writeFile("/program", encode(body), { mode: 0o755 });
  for (const [limits, expected] of [
    [{ maxSourceBytes: Buffer.byteLength(body) + 7 }, "maxSourceBytes"],
    [{ maxCommands: 2 }, "maxCommands"],
    [{ maxOutputBytes: 3 }, "maxOutputBytes"],
    [{ maxSubstitutionDepth: 0 }, "maxSubstitutionDepth"],
  ] as const) await assert.rejects(shell.exec("/program", { limits }), error => error instanceof ShellLimitError && error.limit === expected);
  await fs.writeFile("/program", encode("#!/usr/bin/env -S bash\nfor item in a b; do true; done"));
  await assert.rejects(shell.exec("/program", { limits: { maxLoopIterations: 1 } }), error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
  await fs.writeFile("/program", encode("#!/usr/bin/env -S bash -c 'true' zero a b c\ntrue"));
  await assert.rejects(shell.exec("/program", { limits: { maxExpansionFields: 4 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionFields");
  await fs.writeFile("/program", encode("#!/usr/bin/env -S bash -c 'true' ${LONG}\ntrue"));
  await assert.rejects(shell.exec("/program", { env: { LONG: "x".repeat(64) }, limits: { maxExpansionBytes: 32 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  await shell.dispose();
});

test("aggregate plugin direct env behavior remains literal and separate", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  await fs.writeFile("/program", encode('#!/usr/bin/env -S -i VALUE=ok bash\nprintf "%s" "$VALUE"'), { mode: 0o755 });
  assert.equal((await shell.exec("/program")).stdout, "ok");
  assert.equal((await shell.exec("env -S 'printf %s direct'")).stdout, "direct");
  await shell.dispose();
});

test("selected file, c string and s input each charge their actual source", async () => {
  const { shell, fs } = setup();
  const alternate = "true";
  await fs.writeFile("/alternate", encode(alternate));
  for (const [flags, input] of [["bash /alternate", ""], ["bash -c true", ""], ["bash -s", "true\n"]] as const) {
    const body = `#!/usr/bin/env -S ${flags}\nsay BAD`;
    await fs.writeFile("/program", encode(body), { mode: 0o755 });
    const maxSourceBytes = 8 + Buffer.byteLength(body) + Buffer.byteLength(input || alternate);
    assert.equal((await shell.exec("/program", { stdin: input, limits: { maxSourceBytes } })).exitCode, 0);
    await assert.rejects(shell.exec("/program", { stdin: input, limits: { maxSourceBytes: maxSourceBytes - 1 } }), error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
  }
  await shell.dispose();
});

test("env parser caps and carriage-return command bytes survive the bridge", async () => {
  const { shell, fs } = setup();
  for (const [header, status, diagnostic] of [
    [`-S bash ${"x".repeat(131072)}`, 125, /split-string byte limit exceeded/u],
    [`-S bash ${"x ".repeat(10001)}`, 125, /split-string argument limit exceeded/u],
    ["bash\r", 127, /env: bash\\r: command not found\n/u],
    ["-S bash -c 'true' ${MISSING}", 0, /^$/u],
  ] as const) {
    await fs.writeFile("/program", encode(`#!/usr/bin/env ${header}\ntrue`), { mode: 0o755 });
    const result = await shell.exec("/program");
    assert.equal(result.exitCode, status, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, diagnostic);
  }
  await shell.dispose();
});

test("guarded completion: executable VFS delegates retain literal argv and normal body resolution", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/other");
  await fs.mkdir("/tools");
  await fs.writeFile("/tools/body-tool", encode("say normal-path"), { mode: 0o755 });
  await fs.writeFile("/other/delegate", encode('args "$0" "$@"; body-tool'), { mode: 0o755 });
  await fs.writeFile("/program", encode("#!/usr/bin/env -S -C /other ./delegate fixed\nsay BAD"), { mode: 0o755 });
  try {
    const result = await shell.exec("/program '' 'a b' '; say BAD'", { env: { PATH: "/tools" } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '["./delegate","fixed","/program","","a b","; say BAD"]normal-path\n');
    assert.equal(result.stderr, "");
    assert.equal((await shell.exec("pwd")).stdout, "/\n");
  } finally { await shell.dispose(); }
});

test("guarded completion: slash targets never normalize basenames or bypass VFS checks", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/bin");
  await fs.mkdir("/directory");
  await fs.writeFile("/bin/bash", encode("say actual-vfs"), { mode: 0o755 });
  await fs.writeFile("/denied", encode("say BAD"), { mode: 0o644 });
  await fs.writeFile("/binary", Uint8Array.of(255), { mode: 0o755 });
  await fs.writeFile("/unknown", encode("#!/unknown\nsay BAD"), { mode: 0o755 });
  try {
    for (const [target, status, output] of [["/bin/bash", 0, "actual-vfs\n"], ["/missing", 127, ""], ["/directory", 126, ""], ["/denied", 126, ""], ["/binary", 126, ""], ["/unknown", 126, ""]] as const) {
      await fs.writeFile("/program", encode(`#!/usr/bin/env -S ${target}\nsay BAD`), { mode: 0o755 });
      const result = await shell.exec("/program");
      assert.equal(result.exitCode, status, `${target}: ${result.stderr}`);
      assert.equal(result.stdout, output, target);
      if (status) assert.notEqual(result.stderr, "");
    }
    await fs.writeFile("/program", encode("#!/usr/bin/env -S ./program\nsay BAD"));
    shell.use(async (context, next) => {
      if (context.command === "env") await fs.chmod("/program", 0o644);
      return next();
    });
    assert.equal((await shell.exec("/program")).exitCode, 126);
  } finally { await shell.dispose(); }
});

test("guarded completion: exact registered definitions beat functions and builtins and stay pinned", async () => {
  const { shell, fs, commands } = setup();
  let hijacks = 0;
  commands.register({ name: "env", execute() { hijacks++; return { exitCode: 99 }; } });
  for (const name of ["chosen", "true"]) commands.register({ name, async execute(context) {
    await context.stdout.write(encode(JSON.stringify([name, ...context.args])));
    return { exitCode: 23 };
  } });
  shell.use(async (context, next) => {
    if (context.command === "chosen" || context.command === "true") commands.register({ name: context.command, execute() { hijacks++; return { exitCode: 98 }; } }, { replace: true });
    return next();
  });
  try {
    for (const name of ["chosen", "true"]) {
      await fs.writeFile("/program", encode(`#!/usr/bin/env -S ${name} fixed\nsay BAD`), { mode: 0o755 });
      const result = await shell.exec(`${name}() { say BAD; }; /program tail`);
      assert.equal(result.exitCode, 23, result.stderr);
      assert.equal(result.stdout, JSON.stringify([name, "fixed", "/program", "tail"]));
    }
    assert.equal(hijacks, 0);
  } finally { await shell.dispose(); }
});

test("guarded completion: missing bare names refuse PATH, files, functions and builtins", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/tools");
  for (const path of ["/unregistered", "/tools/unregistered"]) await fs.writeFile(path, encode("say BAD"), { mode: 0o755 });
  let lookups = 0;
  const stat = fs.stat.bind(fs);
  fs.stat = async (path, options) => { if (path.endsWith("unregistered")) lookups++; return stat(path, options); };
  try {
    for (const name of ["unregistered", "true", "pwd", "host-only-never-registered"]) {
      await fs.writeFile("/program", encode(`#!/usr/bin/env -S ${name}\nsay BAD`), { mode: 0o755 });
      const result = await shell.exec("unregistered() { say BAD; }; PATH=/tools /program");
      assert.equal(result.exitCode, 127, name);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `env: ${name}: command not found\n`);
    }
    assert.equal(lookups, 0);
  } finally { await shell.dispose(); }
});

test("guarded completion: env and target middleware observe exact exports, cwd, argv and provenance", async () => {
  const { shell, fs, commands } = setup({ env: { OLD: "parent" } });
  await fs.mkdir("/other");
  const stages: { command: string; args: readonly string[]; env: Record<string, string>; cwd: string; origin: boolean | undefined }[] = [];
  const record = (context: CommandContext) => stages.push({ command: context.command, args: [...context.args], env: { ...context.env }, cwd: context.cwd, origin: context.stdinIsDefault });
  const suffix = "-S -i VALUE=${OLD} probe fixed";
  shell.use(async (context, next) => {
    if (context.command === "env" || context.command === "probe") record(context);
    if (context.command === "env") { context.env.OLD = "middleware"; context.cwd = "/other"; }
    return next();
  });
  commands.register({ name: "probe", async execute(context) {
    record(context);
    for await (const chunk of context.stdin) await context.stdout.write(chunk);
    return { exitCode: 0 };
  } });
  await fs.writeFile("/program", encode(`#!/usr/bin/env ${suffix}\nsay BAD`), { mode: 0o755 });
  try {
    const result = await shell.exec("PRIVATE=local; /program ''; envget OLD PRIVATE; pwd", { stdin: Uint8Array.of(255, 0) });
    assert.deepEqual([...result.stdoutBytes], [...Uint8Array.of(255, 0), ...encode("parent|<unset>/\n")]);
    assert.deepEqual(stages[0], { command: "env", args: [suffix, "/program", ""], env: { OLD: "parent", PWD: "/" }, cwd: "/", origin: false });
    const expected = { command: "probe", args: ["fixed", "/program", ""], env: { VALUE: "middleware" }, cwd: "/other", origin: false };
    assert.deepEqual(stages.slice(1), [expected, expected]);
    stages.length = 0;
    await shell.exec("/program");
    assert.deepEqual(stages.map(stage => stage.origin), [true, true, true]);
  } finally { await shell.dispose(); }
});

test("guarded completion: env pipeline middleware is transparent and adds no command or depth charge", async () => {
  const { shell, fs } = setup();
  const observed: string[] = [];
  shell.use(async (context, next) => { observed.push(context.command); return next(); });
  await fs.writeFile("/program", encode("#!/usr/bin/env -S bash\npass"), { mode: 0o755 });
  try {
    const result = await shell.exec("bytes | /program | pass", { limits: { pipeHighWaterMark: 1, maxCommands: 5, maxSubstitutionDepth: 1 } });
    assert.deepEqual([...result.stdoutBytes], [0, 255, 195, 169, 128, 10]);
    assert.equal(result.exitCode, 0);
    assert.equal(observed.filter(command => command === "env").length, 1);
    assert.equal(observed.filter(command => command === "bash").length, 1);
  } finally { await shell.dispose(); }
});

test("guarded completion: env middleware short circuits, wraps and observes original target errors", async () => {
  for (const scenario of ["short", "wrap", "throw", "target-error", "bad-env", "bad-cwd", "bad-status", "bad-target-status"] as const) {
    const { shell, fs, commands } = setup();
    const failure = new Error("original target or middleware failure");
    let entered = 0;
    let observed: unknown;
    let cleaned = 0;
    commands.register({ name: "probe", execute() {
      entered++;
      if (scenario === "target-error") throw failure;
      return { exitCode: scenario === "bad-target-status" ? 999 : 7 };
    } });
    shell.use(async (context, next) => {
      if (context.command !== "env") return next();
      context.registerCleanup!(() => { cleaned++; });
      if (scenario === "short") return { exitCode: 19 };
      if (scenario === "throw") throw failure;
      if (scenario === "bad-env") context.env["bad=key"] = "value";
      if (scenario === "bad-cwd") context.cwd = "/bad\0cwd";
      if (scenario === "bad-status") return { exitCode: -1 };
      try { const result = await next(); return scenario === "wrap" ? { exitCode: result.exitCode + 1 } : result; }
      catch (error) { observed = error; throw error; }
    });
    await fs.writeFile("/program", encode("#!/usr/bin/env -S -i probe\nsay BAD"), { mode: 0o755 });
    try {
      if (scenario === "short" || scenario === "wrap") assert.equal((await shell.exec("/program")).exitCode, scenario === "short" ? 19 : 8);
      else {
        const result = await shell.exec("/program");
        assert.equal(result.exitCode, 1);
        if (scenario === "bad-cwd") assert.match(result.stderr, /paths must be strings without NUL/u);
        else if (scenario === "bad-env") assert.match(result.stderr, /Invalid middleware environment value/u);
        else if (scenario === "throw" || scenario === "target-error") assert.match(result.stderr, /original target or middleware failure/u);
        else assert.equal(result.stderr, "shell: line 1: Exit status must be an integer between 0 and 255\n");
      }
      if (scenario === "target-error") assert.equal(observed, failure);
      assert.equal(entered, ["wrap", "target-error", "bad-target-status"].includes(scenario) ? 1 : 0);
      assert.equal(cleaned, 1);
    } finally { await shell.dispose(); }
  }
});

test("guarded completion: registered nested invoke stays ordinary and replacement streams share budgets", async () => {
  const { shell, fs, commands } = setup();
  const captures: number[] = [];
  const origins: (boolean | undefined)[] = [];
  let returned = 0;
  commands.register({ name: "probe", async execute(context) {
    await context.invoke!("normal_function", []);
    return context.invoke!("consume", [], { replaceEnv: true, stdin: {
      [Symbol.asyncIterator]() { return { async next() { return { done: false, value: Uint8Array.of(255, 0, 1) }; }, async return() { returned++; return { done: true, value: undefined }; } }; },
    }, stdout: { async write(chunk) { captures.push(...chunk); } } });
  } });
  commands.register({ name: "consume", async execute(context) {
    assert.deepEqual(Object.keys(context.env), []);
    origins.push(context.stdinIsDefault);
    const value = await context.stdin[Symbol.asyncIterator]().next();
    if (!value.done) await context.stdout.write(value.value);
    return { exitCode: 0 };
  } });
  await fs.writeFile("/program", encode("#!/usr/bin/env -S -i probe\nsay BAD"), { mode: 0o755 });
  try {
    const source = "normal_function() { true; }; /program";
    assert.equal((await shell.exec(source)).exitCode, 0);
    assert.deepEqual(captures, [255, 0, 1]);
    assert.deepEqual(origins, [false]);
    assert.equal(returned, 1);
    await assert.rejects(shell.exec(source, { limits: { maxOutputBytes: 2 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(returned, 2);
  } finally { await shell.dispose(); }
});

test("guarded completion: direct delegate cycles and registered cycles use shared limits", { timeout: 3000 }, async () => {
  const { shell, fs, commands } = setup();
  commands.register({ name: "cycle", execute(context) { return context.invoke!("/program", []); } });
  try {
    for (const target of ["./program", "cycle"]) {
      const body = `#!/usr/bin/env -S ${target}\nsay BAD`;
      await fs.writeFile("/program", encode(body), { mode: 0o755 });
      for (const [limits, limit] of [[{ maxSubstitutionDepth: 4 }, "maxSubstitutionDepth"], [{ maxCommands: 4 }, "maxCommands"], [{ maxSourceBytes: Buffer.byteLength(body) + 8 }, "maxSourceBytes"]] as const) {
        await assert.rejects(shell.exec("/program", { limits }), error => error instanceof ShellLimitError && error.limit === limit);
      }
    }
    await fs.writeFile("/program", encode("#!/usr/bin/env\nsay BAD"));
    await assert.rejects(shell.exec("/program", { limits: { maxSubstitutionDepth: 4 } }), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
  } finally { await shell.dispose(); }
});

test("guarded completion: env scoped invoker owns replacement streams without inherited exports", async () => {
  const { shell, fs, commands } = setup({ env: { KEEP: "parent" } });
  const output: number[] = [];
  const origins: (boolean | undefined)[] = [];
  let returned = 0;
  let retained: (() => Promise<unknown>) | undefined;
  shell.use(async (context, next) => {
    if (context.command !== "env") return next();
    retained = () => context.invoke!("probe", []);
    return context.invoke!("probe", ["literal; no-eval"], {
      replaceEnv: true,
      stdinIsDefault: true,
      stdin: { [Symbol.asyncIterator]() { return {
        async next() { return { done: false, value: Uint8Array.of(255, 0) }; },
        async return() { returned++; return { done: true, value: undefined }; },
      }; } },
      stdout: { async write(chunk) { output.push(...chunk); } },
    });
  });
  commands.register({ name: "probe", async execute(context) {
    assert.deepEqual(Object.keys(context.env), []);
    assert.equal(context.cwd, "/");
    assert.deepEqual(context.args, ["literal; no-eval"]);
    origins.push(context.stdinIsDefault);
    const chunk = await context.stdin[Symbol.asyncIterator]().next();
    if (!chunk.done) await context.stdout.write(chunk.value);
    return { exitCode: 0 };
  } });
  await fs.writeFile("/program", encode("#!/usr/bin/env -S ignored\nsay BAD"), { mode: 0o755 });
  try {
    assert.equal((await shell.exec("/program")).exitCode, 0);
    assert.deepEqual(output, [255, 0]);
    assert.deepEqual(origins, [true]);
    assert.equal(returned, 1);
    await assert.rejects(retained!(), /Invocation is closed/u);
    await assert.rejects(shell.exec("/program", { limits: { maxOutputBytes: 1 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(returned, 2);
    assert.deepEqual(output, [255, 0]);
  } finally { await shell.dispose(); }
});

test("guarded completion: target middleware can change scoped state or short circuit without fallback", async () => {
  for (const short of [false, true]) {
    const { shell, fs, commands } = setup();
    let calls = 0;
    commands.register({ name: "probe", execute(context) {
      calls++;
      assert.deepEqual(context.env, { VALUE: "target" });
      assert.equal(context.cwd, "/other");
      return { exitCode: 31 };
    } });
    shell.use(async (context, next) => {
      if (context.command !== "probe") return next();
      context.env = { VALUE: "target" };
      context.cwd = "/other";
      return short ? { exitCode: 42 } : next();
    });
    await fs.mkdir("/other");
    await fs.writeFile("/program", encode("#!/usr/bin/env -S -i probe\nsay BAD"), { mode: 0o755 });
    try {
      const result = await shell.exec("/program");
      assert.equal(result.exitCode, short ? 42 : 31);
      assert.equal(result.stdout, "");
      assert.equal(calls, short ? 0 : 1);
    } finally { await shell.dispose(); }
  }
});
