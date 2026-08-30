import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FsError, toByteSource, writeText } from "../../src/contracts/index.js";
import type { ByteSource, FileSystem } from "../../src/contracts/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/commands/index.js";
import { metadataCommands } from "../../src/commands/metadata/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

const encoder = new TextEncoder();

async function script(fs: FileSystem, path: string, body: string, mode = 0o755): Promise<void> {
  await fs.writeFile(path, encoder.encode(body), { mode });
}

for (const entry of ["./program", "/program", "bash program", "bash -- ./program", "sh program", "sh -- ./program"]) {
  test(`VFS script entry preserves literal arguments and argv0: ${entry}`, async () => {
    const { shell, fs } = setup();
    await script(fs, "/program", '#!/bin/bash\nargs "$0" "$#" "$@"');
    const result = await shell.exec(`${entry} '' 'two words' '*' '$(bad)' ';' 'é'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), [entry.split(" ").at(-1), "6", "", "two words", "*", "$(bad)", ";", "é"]);
  });
}

for (const interpreter of ["sh", "bash"]) {
  test(`shell-created sh file preserves workflow state, arguments and IO: ${interpreter}`, async (context) => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(standardCommands()).use(metadataCommands());
    context.after(() => shell.dispose());
    const source = `mkdir /other
cat > 'workflow file.sh' <<'SCRIPT'
#!/bin/sh
printf '<%s>' "$0" "$#" "$@" "\${PRIVATE-unset}" "$PUBLIC" "$INLINE"
work() { for item in "$@"; do printf '[%s]' "$item"; done; }
work alpha beta
read -r line
printf '{%s}' "$line"
printf diagnostic >&2
cd /other
PUBLIC=child
set -- child
exit 7
printf unreachable
SCRIPT
PRIVATE=secret; export PUBLIC=parent; set -- parent
INLINE=inline ${interpreter} 'workflow file.sh' '' 'two words' '*' '$(bad)' ';' 'é' >out 2>errors
printf 'parent:%s:%s:%s:%s:%s;' "$?" "$PUBLIC" "\${INLINE-unset}" "$1" "$PWD"
cat out`;
    const result = await shell.exec(source, { stdin: "input line\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "parent:7:parent:unset:parent:/;<workflow file.sh><6><><two words><*><$(bad)><;><é><unset><parent><inline>[alpha][beta]{input line}");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/errors"), encoder.encode("diagnostic"));
    assert.equal((await fs.stat("/workflow file.sh")).mode! & 0o111, 0);
    const direct = await shell.exec("chmod +x 'workflow file.sh'; './workflow file.sh' direct", { stdin: "direct input\n" });
    assert.equal(direct.exitCode, 7, direct.stderr);
    assert.equal(direct.stdout, "<./workflow file.sh><1><direct><unset><><>[alpha][beta]{direct input}");
    assert.equal(direct.stderr, "diagnostic");
  });
}

for (const interpreter of ["sh", "bash"]) {
  for (const header of ["#!/bin/sh", "#!/bin/bash -e", "#!/usr/bin/python", "#!/usr/bin/env -S sh", "#!/bin/bash --not-an-option"]) {
    test(`explicit interpreter treats header as a comment: ${interpreter} ${header}`, async (context) => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs }).use(standardCommands());
      context.after(() => shell.dispose());
      await script(fs, "/literal.sh", `${header}\nunset MARK; MARK=retained :; printf '<%s><%s><%s>' "\${MARK-unset}" "$0" "$#"; printf '[%s]' "$@"; false; printf ':continued'; exit 7\n`, 0o400);
      const result = await shell.exec(`${interpreter} literal.sh '' 'two words' '$(not-run)'`);
      assert.equal(result.exitCode, 7, result.stderr);
      assert.equal(result.stdout, `<${interpreter === "sh" ? "retained" : "unset"}><literal.sh><3>[][two words][$(not-run)]:continued`);
      assert.equal(result.stderr, "");
      const errexit = await shell.exec(`${interpreter} -e literal.sh`);
      assert.equal(errexit.exitCode, 1, errexit.stderr);
      assert.equal(errexit.stdout, `<${interpreter === "sh" ? "retained" : "unset"}><literal.sh><0>[]`);
      assert.equal(errexit.stderr, "");
    });
  }
}

for (const interpreter of ["/bin/sh", "/usr/bin/sh", "/bin/bash", "/usr/bin/bash"]) {
  test(`direct script selects the declared virtual interpreter profile: ${interpreter}`, async (context) => {
    const { shell, fs, commands } = setup();
    context.after(() => shell.dispose());
    let overrides = 0;
    commands.register({ name: interpreter.endsWith("/sh") ? "sh" : "bash", execute() { overrides++; return { exitCode: 91 }; } });
    await script(fs, "/profile.sh", `#!${interpreter}\nMARK=retained :; args "\${MARK-unset}" "$0" "$@"; exit 7`);
    const result = await shell.exec("./profile.sh '' 'two words'");
    assert.equal(result.exitCode, 7, result.stderr);
    assert.equal(result.stdout, JSON.stringify([interpreter.endsWith("/sh") ? "retained" : "unset", "./profile.sh", "", "two words"]));
    assert.equal(result.stderr, "");
    assert.equal(overrides, 0);
  });
}

for (const interpreter of ["sh", "bash"]) {
  for (const flag of ["-e", "+e"]) {
    test(`direct script interpreter option remains effective: ${interpreter} ${flag}`, async (context) => {
      const { shell, fs } = setup();
      context.after(() => shell.dispose());
      await script(fs, "/options.sh", `#!/bin/${interpreter} ${flag}\nfalse; say continued`);
      const result = await shell.exec("set -e; ./options.sh");
      assert.equal(result.exitCode, flag === "-e" ? 1 : 0, result.stderr);
      assert.equal(result.stdout, flag === "-e" ? "" : "continued\n");
      assert.equal(result.stderr, "");
    });
  }
}

test("direct sh profile stays isolated and follows executable VFS PATH search", async (context) => {
  const { shell, fs } = setup({ env: { PATH: "/" } });
  context.after(() => shell.dispose());
  await script(fs, "/child.sh", '#!/bin/sh\nMARK=child :; args "${MARK-unset}" "$0" "$1"; exit 6');
  await script(fs, "/parent.sh", '#!/bin/bash\nset -- parent; child.sh nested; args "$?" "${MARK-unset}" "$0" "$1"; MARK=parent :; args "${MARK-unset}"');
  const result = await shell.exec("./parent.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '["child","/child.sh","nested"]["6","unset","./parent.sh","parent"]["unset"]');
  assert.equal(result.stderr, "");
});

test("new direct sh entry preserves permission, middleware and source-byte admission", async (context) => {
  const { shell, fs } = setup();
  context.after(() => shell.dispose());
  const body = "#!/bin/sh\ntrue";
  await script(fs, "/limits.sh", body);
  const source = "./limits.sh";
  const maxSourceBytes = Buffer.byteLength(source + body);
  assert.equal((await shell.exec(source, { limits: { maxSourceBytes } })).exitCode, 0);
  await assert.rejects(shell.exec(source, { limits: { maxSourceBytes: maxSourceBytes - 1 } }), (error) => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
  await fs.chmod("/limits.sh", 0o644);
  assert.equal((await shell.exec(source)).exitCode, 126);
  assert.equal((await shell.exec("sh limits.sh")).exitCode, 0);
  await fs.chmod("/limits.sh", 0o111);
  assert.equal((await shell.exec("sh limits.sh")).exitCode, 126);
  let reads = 0;
  const readFile = fs.readFile.bind(fs);
  fs.readFile = async (...args) => { reads++; return readFile(...args); };
  shell.use(async (command, next) => command.command === "./limits.sh" ? { exitCode: 73 } : next());
  assert.equal((await shell.exec(source)).exitCode, 73);
  assert.equal(reads, 0);
});

for (const header of ["#!/bin/shx", "#!/bin/sh --", "#!/bin/sh -x", "#!/bin/sh\r"]) {
  test(`direct script still denies unsupported interpreter dispatch: ${JSON.stringify(header)}`, async (context) => {
    const { shell, fs } = setup();
    context.after(() => shell.dispose());
    await script(fs, "/unsupported.sh", `${header}\nsay forbidden >touched`);
    const result = await shell.exec("./unsupported.sh");
    assert.equal(result.exitCode, 126, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsupported interpreter/u);
    await assert.rejects(fs.stat("/touched"), { code: "ENOENT" });
  });
}

test("explicit interpreter accepts readable nonexecutable text and dash filenames after --", async () => {
  const { shell, fs } = setup();
  await script(fs, "/-file", 'args "$0" "$@"', 0o400);
  const result = await shell.exec("bash -- -file ''");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '["-file",""]');
});

test("empty filename is missing, not a cwd directory invocation", async () => {
  const { shell } = setup();
  const result = await shell.exec("bash ''");
  assert.equal(result.exitCode, 127, result.stderr);
  assert.match(result.stderr, /No such file or directory/u);
});

test("script argv0 and empty positional list survive substitutions and subshells", async () => {
  const { shell, fs } = setup();
  await script(fs, "/program", '#!/bin/bash\nargs "$@"; (args "$0"); value=$(args "$0"); args "$value"');
  const result = await shell.exec("./program");
  assert.equal(result.stdout, '[]["./program"]["[\\"./program\\"]"]');
  assert.equal(result.exitCode, 0, result.stderr);
});

test("script invocation never evaluates host-style startup environment variables", async () => {
  const { shell, fs } = setup({ env: { BASH_ENV: "/startup", ENV: "/startup", SHELLOPTS: "pipefail" } });
  await script(fs, "/startup", "say forbidden >touched");
  await script(fs, "/program", "#!/bin/bash\nfalse | true");
  const result = await shell.exec("./program");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  await assert.rejects(fs.stat("/touched"), { code: "ENOENT" });
});

test("script process resets variables, functions, options, status and cwd without leaking", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/other");
  await script(fs, "/program", '#!/bin/bash\nargs "$?" "${PRIVATE-unset}" "$PUBLIC" "$INLINE" "$#"; hidden; args "$?"; false | true; args "$?"; cd /other; export PUBLIC=child; set -- child; exit 9; say unreachable');
  const result = await shell.exec('PRIVATE=secret; export PUBLIC=parent; hidden() { say leaked; }; set -- parent; set -o pipefail; false; INLINE=inline ./program argument; args "$?" "$PUBLIC" "${INLINE-unset}" "$1" "$PWD" "$0"');
  assert.equal(result.stdout, '["0","unset","parent","inline","1"]["127"]["0"]["9","parent","unset","parent","/","virtual-bash"]');
  assert.equal(result.stderr, "./program: line 2: hidden: command not found\n");
  assert.equal(result.exitCode, 0);
});

test("function locals and return scope do not enter scripts", async () => {
  const { shell, fs } = setup();
  await script(fs, "/program", '#!/usr/bin/bash\nargs "${PRIVATE-unset}"; return 8; args "$?"; exit 4');
  const result = await shell.exec('work() { local PRIVATE=secret; ./program; args "$?" "$PRIVATE"; }; work');
  assert.equal(result.stdout, '["unset"]["1"]["4","secret"]');
  assert.match(result.stderr, /return: not in a function/u);
});

test("VFS relative paths, symlinks, cwd and argv0 stay virtual", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/dir");
  await script(fs, "/program", '#!/bin/bash\nargs "$0" "$PWD"; pwd');
  await fs.symlink("../program", "/dir/link");
  const result = await shell.exec("cd /dir; ./link");
  assert.equal(result.stdout, '["./link","/dir"]/dir\n');
  assert.equal(result.exitCode, 0, result.stderr);
});

test("script exit is bounded to the child and error lines restart per file", async () => {
  const { shell, fs } = setup();
  await script(fs, "/inner", "#!/bin/bash\n\nmissing\nexit 23");
  await script(fs, "/outer", '#!/bin/bash\n./inner\nargs "$?" "$0"\nexit 7');
  const result = await shell.exec('\n\n./outer; args "$?" "$0"');
  assert.equal(result.stdout, '["23","./outer"]["7","virtual-bash"]');
  assert.equal(result.stderr, "./inner: line 3: missing: command not found\n");
});

test("registry and functions keep precedence and middleware can deny before VFS access", async () => {
  const { shell, fs, commands } = setup();
  commands.register({ name: "bash", async execute(context) { await writeText(context.stdout, "registry"); return { exitCode: 3 }; } });
  assert.equal((await shell.exec("bash absent")).stdout, "registry");
  assert.equal((await shell.exec("bash() { say function; }; bash absent")).stdout, "function\n");
  let reads = 0;
  const stat = fs.stat.bind(fs);
  fs.stat = async (...args) => { reads++; return stat(...args); };
  shell.use(async (context, next) => context.command === "/denied" ? { exitCode: 42 } : next());
  assert.equal((await shell.exec("/denied")).exitCode, 42);
  assert.equal(reads, 0);
});

test("invoke resolves VFS scripts with literal argv, middleware, environment and cwd", async () => {
  const { shell, fs, commands } = setup();
  await fs.mkdir("/dir");
  await script(fs, "/dir/program", '#!/bin/bash\nargs "$0" "$@" "$PUBLIC" "${PRIVATE-unset}" "$PWD"');
  const seen: string[] = [];
  shell.use(async (context, next) => { seen.push(context.command); return next(); });
  commands.register({ name: "delegate", async execute(context) {
    assert.ok(context.invoke);
    return context.invoke("./program", ["", "$(not-code)"], { cwd: "/dir", env: { PUBLIC: "child" } });
  } });
  const result = await shell.exec("PRIVATE=secret; delegate");
  assert.equal(result.stdout, '["./program","","$(not-code)","child","unset","/dir"]');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(seen, ["delegate", "./program", "args"]);
});

test("invoke stream overrides and descriptors reach scripts without acquiring parent streams", async () => {
  const { shell, fs, commands } = setup();
  const output: number[] = [];
  await script(fs, "/program", "#!/bin/bash\npass <&0 >&1; say inherited >&3");
  commands.register({ name: "delegate", async execute(context) {
    assert.ok(context.invoke);
    return context.invoke("./program", [], { stdin: toByteSource(Uint8Array.of(0, 255)), stdout: { async write(chunk) { output.push(...chunk); } } });
  } });
  const result = await shell.exec("delegate 3>out; pass", { stdin: "parent" });
  assert.deepEqual(output, [0, 255]);
  assert.equal(result.stdout, "parent");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "inherited\n");
});

test("middleware cwd/environment govern the script entrypoint", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/dir");
  await script(fs, "/dir/program", '#!/bin/bash\nargs "$PUBLIC" "$PWD"');
  shell.use(async (context, next) => {
    if (context.command !== "./program") return next();
    context.cwd = "/dir";
    context.env = { PUBLIC: "middleware" };
    return next();
  });
  const result = await shell.exec("./program; pwd");
  assert.equal(result.stdout, '["middleware","/dir"]/\n');
  assert.equal(result.exitCode, 0, result.stderr);
});

for (const [name, contents] of [
  ["plain", "say bad"],
  ["env", "#!/usr/bin/env bash\nsay bad"],
] as const) {
  test(`direct script native-backed executable fallback preserves bytes and files: ${name}`, async () => {
    const { shell, fs } = setup();
    await script(fs, `/${name}`, contents, 0o755);
    const result = await shell.exec(`./${name}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "bad\n");
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "6261640a");
    assert.equal(result.stderr, "");
    assert.equal(result.stderrBytes.length, 0);
    assert.deepEqual(await fs.readFile(`/${name}`), encoder.encode(contents));
    assert.equal(((await fs.stat(`/${name}`)).mode ?? 0) & 0o777, 0o755);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), [name]);
  });
}

test("direct script native-backed errexit shebang preserves bytes, mode and namespace: options", async () => {
  const { shell, fs } = setup();
  const contents = "#!/bin/bash -e\nsay bad";
  await script(fs, "/options", contents, 0o755);
  const modeBefore = (await fs.stat("/options")).mode;
  const result = await shell.exec("./options");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "bad\n");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "6261640a");
  assert.equal(result.stderr, "");
  assert.equal(result.stderrBytes.length, 0);
  assert.deepEqual(await fs.readFile("/options"), encoder.encode(contents));
  assert.equal((await fs.stat("/options")).mode, modeBefore);
  assert.equal((modeBefore ?? 0) & 0o777, 0o755);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["options"]);
});

for (const [name, contents, mode, diagnostic] of [
  ["noexec", "#!/bin/bash\nsay bad", 0o644, "Permission denied"],
  ["noread", "#!/bin/bash\nsay bad", 0o111, "Permission denied"],
  ["python", "#!/usr/bin/python\nsay bad", 0o755, "unsupported interpreter"],
  ["nul", "#!/bin/bash\nsay bad\0", 0o755, "binary"],
] as const) {
  test(`direct script rejection has status 126 and no body effects: ${name}`, async () => {
    const { shell, fs } = setup();
    await script(fs, `/${name}`, contents, mode);
    const result = await shell.exec(`./${name}`);
    assert.equal(result.exitCode, 126, result.stderr);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(diagnostic), result.stderr);
  });
}

test("missing, dangling, directory and host-looking paths never fall through", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/dir");
  await fs.symlink("absent", "/dangling");
  for (const path of ["./absent", "./dangling", "/bin/ls", "/etc/passwd"]) {
    const result = await shell.exec(path);
    assert.equal(result.exitCode, 127, result.stderr);
    assert.match(result.stderr, /No such file or directory/u);
  }
  for (const command of ["./dir", "bash dir"]) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 126, result.stderr);
    assert.match(result.stderr, /Is a directory/u);
  }
});

test("bare commands now PATH-search executable VFS scripts", async () => {
  const { shell, fs } = setup({ env: { PATH: "/" } });
  await script(fs, "/program", "#!/bin/bash\nsay bad");
  const result = await shell.exec("program");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "bad\n");
});

test("unknown execution permission capability is rejected without reading script bytes", async () => {
  const { fs, commands } = setup();
  await script(fs, "/program", "#!/bin/bash\nsay allowed");
  let reads = 0;
  const readFile = fs.readFile.bind(fs);
  fs.readFile = async (...args) => { reads++; return readFile(...args); };
  const backend = new Proxy(fs, { get(target, property) {
    if (property === "capabilities") return { ...target.capabilities, permissions: false };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new Shell({ fs: backend, commands });
  const direct = await shell.exec("./program");
  assert.equal(direct.exitCode, 126, direct.stderr);
  assert.match(direct.stderr, /execution permissions.*not supported/u);
  assert.equal(reads, 0);
  assert.equal((await shell.exec("bash program")).stdout, "allowed\n");
});

test("backend permission errors, signals and byte ceilings remain authoritative", async () => {
  const { shell, fs } = setup();
  await script(fs, "/program", "#!/bin/bash\nsay bad");
  const accesses: number[] = [];
  fs.access = async (path, mode, options) => {
    assert.equal(path, "/program");
    assert.ok(options?.signal);
    accesses.push(mode!);
    throw new FsError("EACCES", { path, message: "denied" });
  };
  assert.equal((await shell.exec("./program")).exitCode, 126);
  assert.equal((await shell.exec("bash program")).exitCode, 126);
  assert.deepEqual(accesses, [5, 4]);
});

test("new interpreter modes are valid while binary bytes remain rejected", async () => {
  const { shell, fs } = setup();
  for (const command of ["bash", "bash -c 'say bad'", "bash -s", "bash -", "bash --"]) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, command === "bash -c 'say bad'" ? "bad\n" : "");
  }
  for (const bytes of [Uint8Array.of(0, 255), Uint8Array.of(255), Uint8Array.of(127, 69, 76, 70)]) {
    await fs.writeFile("/program", bytes);
    const result = await shell.exec("bash program");
    assert.equal(result.exitCode, 126, result.stderr);
    assert.equal(result.stdout, "");
  }
});

test("whole script is parsed before body effects while parent continues", async () => {
  const { shell, fs } = setup();
  await script(fs, "/program", "#!/bin/bash\nsay bad >touched\nif true; then\n");
  const result = await shell.exec('./program 2>errors; args "$?"; say parent');
  assert.equal(result.stdout, '["2"]parent\n');
  assert.equal(result.stderr, "");
  await assert.rejects(fs.stat("/touched"), { code: "ENOENT" });
  assert.match(new TextDecoder().decode(await fs.readFile("/errors")), /\.\/program: line .*syntax/u);
});

test("script stdin is streaming, byte-transparent, distinct from source and shared after exit", async () => {
  const { shell, fs } = setup();
  await script(fs, "/program", "#!/bin/bash\nread -r first; args \"$first\"; exit 5");
  let pulls = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    pulls++; yield encoder.encode("line\n");
    pulls++; yield Uint8Array.of(0, 255, 128);
  } };
  const result = await shell.exec('./program; args "$?"; pass', { stdin });
  assert.deepEqual([...result.stdoutBytes], [...Buffer.concat([Buffer.from('["line"]["5"]'), Buffer.from([0, 255, 128])])]);
  assert.equal(pulls, 2);
});

test("script pipelines and inherited descriptors preserve exact bytes and parent ownership", async () => {
  const { shell, fs } = setup();
  await script(fs, "/program", "#!/bin/bash\npass; say fd >&3; : 3>&-");
  const result = await shell.exec("{ bytes | ./program | pass; say parent >&3; } 3>out");
  assert.deepEqual([...result.stdoutBytes], [0, 255, 195, 169, 128, 10]);
  assert.equal(result.stderr, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "fd\nparent\n");
});

test("stdin provenance crosses direct, interpreter and invoke entrypoints without probing", async () => {
  const { shell, fs, commands } = setup();
  const seen: (boolean | undefined)[] = [];
  commands.register({ name: "origin", execute(context) { seen.push(context.stdinIsDefault); return { exitCode: 0 }; } });
  commands.register({ name: "delegate", execute(context) {
    assert.ok(context.invoke);
    return context.invoke("./program", [], { stdin: toByteSource(""), stdinIsDefault: true });
  } });
  await script(fs, "/program", "#!/bin/bash\norigin");
  await shell.exec("./program; bash program; delegate");
  await shell.exec("./program", { stdin: "" });
  await fs.writeFile("/empty", new Uint8Array());
  await shell.exec("./program <empty; ./program 0<&-; bytes | ./program", { stdin: "" });
  await shell.exec("./program <<<''");
  assert.deepEqual(seen, [true, true, true, false, false, false, false, false]);
});

test("nested scripts share initial source, command, output and loop budgets", async () => {
  const { shell, fs } = setup();
  const body = "#!/bin/bash\nsay x";
  await script(fs, "/program", body);
  const source = "./program; ./program";
  for (const [limits, expected] of [
    [{ maxSourceBytes: Buffer.byteLength(source) + Buffer.byteLength(body) }, "maxSourceBytes"],
    [{ maxCommands: 3 }, "maxCommands"],
    [{ maxOutputBytes: 3 }, "maxOutputBytes"],
  ] as const) {
    await assert.rejects(shell.exec(source, { limits }), (error) => error instanceof ShellLimitError && error.limit === expected);
  }
  await script(fs, "/program", "#!/bin/bash\nfor entry in a b; do true; done");
  await assert.rejects(shell.exec(source, { limits: { maxLoopIterations: 3 } }), (error) => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
});

test("exact source limit boundary admits one script and never reads oversized source", async () => {
  const { shell, fs } = setup();
  const body = "#!/bin/bash\ntrue";
  await script(fs, "/program", body);
  const maxSourceBytes = Buffer.byteLength("./program") + Buffer.byteLength(body);
  assert.equal((await shell.exec("./program", { limits: { maxSourceBytes } })).exitCode, 0);
  let reads = 0;
  const readFile = fs.readFile.bind(fs);
  fs.readFile = async (...args) => { reads++; return readFile(...args); };
  await assert.rejects(shell.exec("./program", { limits: { maxSourceBytes: maxSourceBytes - 1 } }), (error) => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
  assert.equal(reads, 0);
});

for (const scenario of ["recursion", "cancel-stat", "cancel-read", "cancel-command", "late-rejection", "output-limit", "source-limit"]) {
  test(`hard-bounded script regression: ${scenario}`, () => {
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./script-entrypoint-probe.ts", import.meta.url)), scenario], {
      encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed/u);
  });
}
