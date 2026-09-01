import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, MemoryFileSystem, ShellLimitError, standardCommands, createAgentCommands, writeText } from "../../../src/index.js";
import type { ShellOptions, ShellCommandContext, FsOptions } from "../../../src/index.js";

const line = (enabled: boolean, print = false): string => print ? `shopt -${enabled ? "s" : "u"} dotglob\n` : `dotglob             \t${enabled ? "on" : "off"}\n`;
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const diagnostic = (text: string): string => `shell: line 1: shopt: ${text}\n`;
const unsupported = (name: string): string => diagnostic(`${name}: unsupported shell option name (only dotglob is supported)`);

async function fixture(options: Partial<ShellOptions> = {}) {
  const fs = new MemoryFileSystem();
  for (const directory of ["/work", "/work/.inner", "/work/outer", "/scripts", "/next", "/dev"]) await fs.mkdir(directory, { recursive: true });
  for (const path of ["/work/visible", "/work/.hidden", "/work/..keep", "/work/.inner/.deep", "/work/.inner/plain", "/work/outer/.deep", "/work/outer/plain"]) await fs.writeFile(path, new Uint8Array());
  const shell = new Shell({ fs, cwd: "/work", env: { HOME: "/", PATH: "/scripts" }, ...options }).use(standardCommands());
  shell.register({ name: "argv", async execute({ args, stdout }) { await writeText(stdout, `${JSON.stringify(args)}\n`); return { exitCode: 0 }; } });
  return { shell, fs };
}

async function run(source: string, options: Partial<ShellOptions> = {}) {
  const { shell } = await fixture(options);
  try { return await shell.exec(source); }
  finally { await shell.dispose(); }
}

for (const enabled of [false, true]) {
  const prefix = enabled ? "shopt -s dotglob; " : "";
  for (const flags of ["", "--", "-p", "-q", "-pq", "-qp", "-pp -p", "-qq -q", "-s", "-u", "-sp", "-up", "-qs", "-qu", "-spsq -s", "-upqu -u"]) {
    const set = flags.includes("s");
    const unset = flags.includes("u");
    const quiet = flags.includes("q");
    const print = flags.includes("p");
    for (const named of [false, true]) {
      test(`grammar ${enabled ? "on" : "off"} ${flags || "ordinary"} ${named ? "named" : "all"}`, { timeout: 5000 }, async () => {
        const names = named ? " dotglob dotglob" : "";
        const result = await run(`${prefix}shopt ${flags}${names}; printf 'status=%s\\n' "$?"; shopt -p`);
        const selected = (!set || enabled) && (!unset || !enabled);
        const output = quiet || named && (set || unset) || !named && !selected ? "" : line(enabled, print).repeat(named ? 2 : 1);
        const status = named && !set && !unset && !enabled ? 1 : 0;
        assert.equal(result.stdout, `${output}status=${status}\n${line(named && (set || unset) ? set : enabled, true)}`);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      });
    }
  }
  for (const flags of ["-su", "-us", "-s -u", "-u -s", "-ssuuqqpp", "-u -psq"]) {
    for (const names of ["", " dotglob expand_aliases"]) {
      test(`conflict preflight ${enabled} ${flags}${names}`, async () => {
        const result = await run(`${prefix}shopt ${flags}${names}; printf '%s\\n' "$?"; shopt -p`);
        assert.equal(result.stdout, `1\n${line(enabled, true)}`);
        assert.equal(result.stderr, diagnostic("cannot set and unset shell options simultaneously"));
      });
    }
  }
  for (const [flags, token] of [["-z", "-z"], ["-sz", "-z"], ["-suz", "-z"], ["-su -pz", "-z"], ["-o", "-o"], ["-so", "-o"], ["--help", "--help"], ["--version", "--version"], ["--dotglob", "--dotglob"]]) {
    test(`invalid flag before effects ${enabled} ${flags}`, async () => {
      const result = await run(`${prefix}shopt ${flags} dotglob; printf '%s\\n' "$?"; shopt -p`);
      assert.equal(result.stdout, `2\n${line(enabled, true)}`);
      assert.equal(result.stderr, diagnostic(`${token}: unsupported option`) + "shopt: usage: shopt [-pqsu] [--] [dotglob ...]\n");
    });
  }
  for (const name of ["", "-", "+s", "Dotglob", "dot", "dotglob=on", "expand_aliases", "globskipdots", "nullglob", "unrecognized"]) {
    for (const flags of ["", "-s", "-u", "-q", "-upq"]) {
      test(`unknown operand ${enabled} ${flags} ${JSON.stringify(name)}`, async () => {
        const result = await run(`${prefix}shopt ${flags} -- ${quote(name)}; printf '%s\\n' "$?"; shopt -p`);
        assert.equal(result.stdout, `1\n${line(enabled, true)}`);
        assert.equal(result.stderr, unsupported(name));
      });
    }
  }
  for (const flags of ["-s", "-u", "-spq", "-upq", "", "-p", "-q"]) {
    test(`left-to-right valid invalid duplicates ${enabled} ${flags}`, async () => {
      const result = await run(`${prefix}shopt ${flags} dotglob expand_aliases dotglob '' dotglob; printf '%s\\n' "$?"; shopt -p`);
      const mutation = flags.includes("s") || flags.includes("u");
      const output = mutation || flags.includes("q") ? "" : line(enabled, flags.includes("p")).repeat(3);
      assert.equal(result.stdout, `${output}1\n${line(mutation ? flags.includes("s") : enabled, true)}`);
      assert.equal(result.stderr, unsupported("expand_aliases") + unsupported(""));
    });
  }
  test(`leading scan ends at operand ${enabled}`, async () => {
    const result = await run(`${prefix}shopt dotglob -s -- -sz dotglob; printf '%s\\n' "$?"; shopt -p`);
    assert.equal(result.stdout, `${line(enabled).repeat(2)}1\n${line(enabled, true)}`);
    assert.equal(result.stderr, unsupported("-s") + unsupported("--") + unsupported("-sz"));
  });
}

const visible = ["outer", "visible"];
const all = ["..keep", ".hidden", ".inner", "outer", "visible"];
const encode = (...rows: string[][]): string => rows.map(row => JSON.stringify(row) + "\n").join("");
const globs: readonly [string, string[], string[]][] = [
  ["*", visible, all],
  [".*", ["..keep", ".hidden", ".inner"], ["..keep", ".hidden", ".inner"]],
  ["*/*", ["outer/plain"], [".inner/.deep", ".inner/plain", "outer/.deep", "outer/plain"]],
  ["*/.*", ["outer/.deep"], [".inner/.deep", "outer/.deep"]],
  ["[.]hidden", ["[.]hidden"], [".hidden"]],
  ["[.v]*", ["visible"], ["..keep", ".hidden", ".inner", "visible"]],
  [".?*", ["..keep", ".hidden", ".inner"], ["..keep", ".hidden", ".inner"]],
  ["*/", ["outer/"], [".inner/", "outer/"]],
  [".inner/*", [".inner/plain"], [".inner/.deep", ".inner/plain"]],
  ["./*", ["./outer", "./visible"], ["./..keep", "./.hidden", "./.inner", "./outer", "./visible"]],
  ["../work/*", ["../work/outer", "../work/visible"], ["../work/..keep", "../work/.hidden", "../work/.inner", "../work/outer", "../work/visible"]],
  ["/work/*", ["/work/outer", "/work/visible"], ["/work/..keep", "/work/.hidden", "/work/.inner", "/work/outer", "/work/visible"]],
  ["'*' \".*\" \\* . .. missing*", ["*", ".*", "*", ".", "..", "missing*"], ["*", ".*", "*", ".", "..", "missing*"]],
];
for (const [pattern, off, on] of globs) test(`actual glob execution-time off/on/off ${pattern}`, async () => {
  const result = await run(`argv ${pattern}; shopt -s dotglob; argv ${pattern}; shopt -u dotglob; argv ${pattern}`);
  assert.equal(result.stdout, encode(off, on, off));
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("custom provider dot entries never become wildcard candidates; order is retained until final sort", async () => {
  class DottedFileSystem extends MemoryFileSystem {
    readonly probes: string[] = [];
    override async readdir(path: string, options?: FsOptions) {
      this.probes.push(path);
      assert(options?.signal instanceof AbortSignal);
      return [{ name: ".", type: "directory" as const }, { name: "..", type: "directory" as const }, ...(await super.readdir(path, options)).reverse()];
    }
  }
  const fs = new DottedFileSystem();
  for (const path of ["/z", "/a", "/.z", "/.a"]) await fs.mkdir(path);
  const { shell } = await fixture({ fs, cwd: "/" });
  try {
    const result = await shell.exec("argv .*; argv .?; argv *; shopt -s dotglob; argv .*; argv *; argv */*; argv . ..");
    assert.equal(result.stdout, encode([".a", ".z"], [".a", ".z"], ["a", "z"], [".a", ".z"], [".a", ".z", "a", "z"], ["*/*"], [".", ".."]));
    assert.equal(result.stderr, "");
    assert.deepEqual(fs.probes.slice(-5), ["/", "/z", "/a", "/.z", "/.a"]);
  } finally { await shell.dispose(); }
});

for (const statement of ["{ shopt -s dotglob; }", "eval 'shopt -s dotglob'", "enable() { shopt -s dotglob; }; enable", "source /scripts/enable", ". /scripts/enable"]) test(`shared state ${statement}`, async () => {
  const { shell, fs } = await fixture();
  try {
    await fs.writeFile("/scripts/enable", new TextEncoder().encode("shopt -s dotglob\n"));
    const result = await shell.exec(`${statement}; argv *`);
    assert.equal(result.stdout, encode(all));
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const statement of ["(shopt -u dotglob; argv *)", "{ shopt -u dotglob; argv *; } | cat", "printf '%s\\n' \"$(shopt -u dotglob; argv *)\"", "printf 'input' | { shopt -u dotglob; argv *; }"]) test(`cloned state ${statement}`, async () => {
  const result = await run(`shopt -s dotglob; ${statement}; argv *`);
  assert.equal(result.stdout, encode(visible, all));
  assert.equal(result.stderr, "");
});

for (const statement of ["(argv *)", "argv * | cat", "printf '%s\\n' \"$(argv *)\""]) test(`cloned inheritance ${statement}`, async () => {
  const result = await run(`shopt -s dotglob; ${statement}`);
  assert.equal(result.stdout, encode(all));
});

for (const statement of ["bash -c 'argv *'", "sh -c 'argv *'", "printf 'argv *\\n' | bash -s", "bash /scripts/check", "/scripts/check", "/scripts/env-check"]) test(`fresh interpreter ${statement}`, async () => {
  const { shell, fs } = await fixture();
  try {
    await fs.writeFile("/scripts/check", new TextEncoder().encode("#!/bin/bash\nargv *\n"), { mode: 0o755 });
    await fs.writeFile("/scripts/env-check", new TextEncoder().encode("#!/usr/bin/env bash\nargv *\n"), { mode: 0o755 });
    const result = await shell.exec(`shopt -s dotglob; ${statement}; argv *`);
    assert.equal(result.stdout, encode(visible, all));
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("fresh public exec and environment do not enable private option", async () => {
  const { shell } = await fixture({ env: { BASHOPTS: "dotglob", SHELLOPTS: "dotglob" } });
  try {
    assert.equal((await shell.exec("shopt -s dotglob; argv *")).stdout, encode(all));
    assert.equal((await shell.exec("argv *; shopt -p")).stdout, encode(visible) + line(false, true));
  } finally { await shell.dispose(); }
});

test("invoke inherits option, keeps literal argv, isolates mutation and retains middleware", async () => {
  const { shell } = await fixture();
  const visited: string[] = [];
  shell.use(async (context, next) => { visited.push(context.command); return next(); });
  shell.register({ name: "host", async execute(context) {
    const host = context as ShellCommandContext;
    assert.equal((await host.invoke("shopt", ["-q", "dotglob"])).exitCode, 0);
    await host.invoke("argv", ["*", "$(false)"]);
    await host.invoke("inside", []);
    await host.invoke("shopt", ["-u", "dotglob"]);
    assert.equal((await host.invoke("shopt", ["-q", "dotglob"])).exitCode, 0);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("inside() { argv *; shopt -u dotglob; }; shopt -s dotglob; host; argv *");
    assert.equal(result.stdout, encode(["*", "$(false)"], all, all));
    assert.equal(result.stderr, "");
    assert(visited.filter(name => name === "shopt").length >= 5);
  } finally { await shell.dispose(); }
});

test("builtin discovery, function precedence, command bypass, registry unchanged", async () => {
  const { shell } = await fixture();
  try {
    const before = shell.commands.list().map(command => command.name);
    const result = await shell.exec("type -t shopt; command -v shopt; shopt() { printf 'function\\n'; }; shopt; command shopt -s dotglob; argv *");
    assert.equal(result.stdout, "builtin\nshopt\nfunction\n" + encode(all));
    assert.equal(result.stderr, "");
    assert.deepEqual(shell.commands.list().map(command => command.name), before);
    const names = createAgentCommands().map(command => command.name);
    assert.equal(names.length, 79);
    assert.equal(new Set(names).size, 79);
    for (const name of ["which", "timeout", "apply_patch"]) assert.ok(names.includes(name));
    for (const name of ["shopt", "curl", "safejs", "node", "npm", "npx"]) assert.equal(names.includes(name), false);
  } finally { await shell.dispose(); }
});

test("accepted CD LET and directory stack publication survive cloned dotglob state", async () => {
  const result = await run("shopt -s dotglob; let 'count=2+3'; pushd /next; (pushd /work; shopt -u dotglob; dirs -l -p); dirs -l -p; popd; printf '%s\\n' \"$count\"; argv *");
  assert.equal(result.stdout, "/next /work\n/work /next /work\n/work\n/next\n/work\n/next\n/work\n/work\n5\n" + encode(all));
  assert.equal(result.stderr, "");
});

for (const [limit, value, script] of [["maxExpansionFields", 4, "shopt -s dotglob; argv *"], ["maxExpansionBytes", 20, "shopt -s dotglob; argv *"], ["maxOutputBytes", 5, "shopt -p"], ["maxCommands", 2, "shopt -s dotglob; shopt -q dotglob; shopt -p"]] as const) test(`existing shared ${limit}`, async () => {
  const { shell } = await fixture({ limits: { [limit]: value } });
  try { await assert.rejects(shell.exec(script), error => error instanceof ShellLimitError && error.limit === limit); }
  finally { await shell.dispose(); }
});

test("awaited stdout prevents later operands and mutation until released", async () => {
  const { shell } = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let writes = 0;
  let settled = false;
  const execution = shell.exec("shopt dotglob dotglob; shopt -s dotglob", { stdout: { async write() { writes++; entered(); await gate; } } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await started;
    assert.equal(writes, 1);
    assert.equal(settled, false);
    release();
    assert.equal((await execution).exitCode, 0);
    assert.equal(writes, 2);
  } finally { release(); await execution.catch(() => undefined); await shell.dispose(); }
});

test("caller cancellation during listing preserves rejection and settles cleanup", async () => {
  const { shell } = await fixture();
  const controller = new AbortController();
  const reason = new Error("dotglob-author-cancel");
  try {
    await assert.rejects(shell.exec("shopt dotglob dotglob", { signal: controller.signal, stdout: { async write() { controller.abort(reason); } } }), error => error === reason);
  } finally { await shell.dispose(); }
});

test("listing writes preserve operand order across diagnostics", async () => {
  const { shell } = await fixture();
  const events: string[] = [];
  try {
    const result = await shell.exec("shopt dotglob expand_aliases dotglob", {
      stdout: { async write(bytes) { events.push("out:" + new TextDecoder().decode(bytes)); } },
      stderr: { async write(bytes) { events.push("err:" + new TextDecoder().decode(bytes)); } },
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(events, ["out:" + line(false), "err:" + unsupported("expand_aliases"), "out:" + line(false)]);
  } finally { await shell.dispose(); }
});

for (const names of ["dotglob expand_aliases", "expand_aliases dotglob"]) test(`mutation is observable at the invalid operand: ${names}`, async () => {
  const { shell } = await fixture();
  const states: number[] = [];
  shell.use(async (context, next) => {
    if (context.command === "shopt" && context.args.includes("expand_aliases")) {
      Object.assign(context, { stderr: { async write() { states.push((await (context as ShellCommandContext).invoke("shopt", ["-q", "dotglob"])).exitCode); } } });
    }
    return next();
  });
  try {
    const result = await shell.exec(`shopt -s ${names}; shopt -p`);
    assert.deepEqual(states, [names.startsWith("dotglob") ? 0 : 1]);
    assert.equal(result.stdout, line(true, true));
  } finally { await shell.dispose(); }
});

test("diagnostic write failure stops operands under existing mapped status", async () => {
  const { shell } = await fixture();
  const reason = new Error("author-diagnostic-failure");
  let calls = 0;
  try {
    const result = await shell.exec("shopt -s expand_aliases dotglob; printf '%s\\n' \"$?\"; shopt -p", { stderr: { async write() { calls++; throw reason; } } });
    assert.equal(result.stdout, "1\n" + line(false, true));
    assert.equal(result.stderr, unsupported("expand_aliases") + "shell: line 1: author-diagnostic-failure\n");
    assert.equal(calls, 2);
  } finally { await shell.dispose(); }
});

test("named interpreter diagnostics preserve line and usage formatting", async () => {
  const result = await run("bash -c 'true\nshopt -sz dotglob' author-script");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "author-script: line 2: shopt: -z: unsupported option\nshopt: usage: shopt [-pqsu] [--] [dotglob ...]\n");
});

test("env shebang registered target receives cloned private state", async () => {
  const { shell, fs } = await fixture();
  shell.register({ name: "probe", async execute(context) {
    const host = context as ShellCommandContext;
    assert.equal((await host.invoke("shopt", ["-q", "dotglob"])).exitCode, 0);
    await host.invoke("shopt", ["-u", "dotglob"]);
    return { exitCode: 0 };
  } });
  try {
    await fs.writeFile("/scripts/probe", new TextEncoder().encode("#!/usr/bin/env probe\n"), { mode: 0o755 });
    const result = await shell.exec("shopt -s dotglob; /scripts/probe; argv *");
    assert.equal(result.stdout, encode(all));
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("shopt remains an ordinary rather than special builtin", async () => {
  const result = await run("VALUE=old; VALUE=temporary shopt -s dotglob; printf '%s\\n' \"$VALUE\"; argv *");
  assert.equal(result.stdout, "old\n" + encode(all));
  assert.equal(result.stderr, "");
});

test("scriptFile retains whole-input preflight before executing shopt", async () => {
  const { shell, fs } = await fixture();
  try {
    await fs.writeFile("/scripts/broken", new TextEncoder().encode("shopt -s dotglob; argv *\nif\n"));
    const result = await shell.exec("bash /scripts/broken");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /syntax error/);
  } finally { await shell.dispose(); }
});
