import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem, toByteSource } from "../../src/index.js";
import { setup } from "./helpers.js";

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

test("explicit interpreters ignore env headers without relaxing other interpreter guards", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/program", encode("#!/usr/bin/env -S -i bash -e\nfalse; say body"), { mode: 0o755 });
  assert.equal((await shell.exec("bash +e /program")).stdout, "body\n");
  assert.equal((await shell.exec("bash -e /program")).exitCode, 1);
  assert.equal((await shell.exec("/program")).exitCode, 1);
  await fs.writeFile("/program", encode("#!/unknown\nsay BAD"));
  const refused = await shell.exec("bash /program");
  assert.equal(refused.exitCode, 126);
  assert.match(refused.stderr, /unsupported interpreter: \/unknown/u);
  await shell.dispose();
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

test("registry, function and PATH names cannot hijack the reserved interpreter", async () => {
  const { shell, fs, commands } = setup();
  let hijacks = 0;
  for (const name of ["env", "alien"]) commands.register({ name, execute() { hijacks++; return { exitCode: 37 }; } });
  await fs.writeFile("/program", encode("#!/usr/bin/env -S bash\nsay body"), { mode: 0o755 });
  assert.equal((await shell.exec('bash() { say BAD; }; env() { say BAD; }; PATH=/missing /program')).stdout, "body\n");
  commands.register({ name: "bash", execute() { hijacks++; return { exitCode: 37 }; } });
  const overridden = await shell.exec("/program");
  assert.equal(overridden.exitCode, 126);
  assert.match(overridden.stderr, /unsupported interpreter override: bash/u);
  await fs.writeFile("/program", encode("#!/usr/bin/env -S alien\nsay BAD"));
  assert.equal((await shell.exec("/program")).exitCode, 127);
  assert.equal(hijacks, 0);
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
    ["bash\r", 127, /env: bash\r: command not found\n/u],
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
