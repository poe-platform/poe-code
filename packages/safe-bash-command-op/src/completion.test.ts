import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createCompletionCallbackHandler, createCompletionHandler } from "./completion.js";
import { createOp } from "./index.js";
import type { OpCommandContext } from "./cli.js";

function context(args: readonly string[] = []) {
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const invocation: OpCommandContext = {
    args, env: {}, signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { return { async next() { throw new Error("completion must not read stdin"); } }; } },
    stdout: { async write(chunk) { output.push(chunk); } },
    stderr: { async write(chunk) { errors.push(chunk); } },
  };
  return { invocation, output, errors };
}

async function generate(shell: string, channel: "stable" | "beta" = "stable") {
  const run = context();
  await createCompletionHandler(channel)({ resource: "completion", action: "", args: [shell], flags: {} }, run.invocation);
  return Buffer.concat(run.output).toString();
}

test("four thin adapters use metadata callbacks rather than literal path tables or eval", async () => {
  for (const shell of ["bash", "zsh", "fish", "powershell"]) {
    const script = await generate(shell);
    assert.ok(script.includes("__complete"));
    assert.equal(script.includes("__fish_seen_subcommand_from"), false);
    assert.equal(script.includes("switch ($path)"), false);
    assert.equal(script.includes("eval "), false);
    assert.equal(script.includes("Invoke-Expression"), false);
    assert.ok(script.includes({ bash: "complete -", zsh: "compdef", fish: "complete -c", powershell: "Register-ArgumentCompleter" }[shell]!));
  }
});

test("rejects unsupported shells and extra arguments", async () => {
  for (const args of [[], ["unknown"], ["bash", "extra"]]) {
    await assert.rejects(createCompletionHandler()({ resource: "completion", action: "", args, flags: {} }, context().invocation));
  }
});

test("script generation rejects untyped channel input rather than embedding shell syntax", () => {
  assert.throws(() => createCompletionHandler("$(unsafe)" as "stable"));
});

test("hidden callbacks emit native line/tab/directive framing with optional descriptions", async () => {
  for (const resource of ["__complete", "__completeNoDesc"]) {
    const run = context();
    await createCompletionCallbackHandler()({ resource, action: "", args: ["item", "g"], flags: {} }, run.invocation);
    const text = Buffer.concat(run.output).toString();
    assert.equal(text.endsWith("\n:4\n"), true);
    assert.equal(text.startsWith(resource === "__complete" ? "get\t" : "get\n"), true);
  }
});

test("public callbacks bypass only execution, not policy for actual operations", async () => {
  const effects: string[] = [];
  const command = createOp({
    backend: { async execute() { effects.push("backend"); throw new Error("must not execute"); } },
    authorize() { effects.push("authorize"); return "deny"; },
    handlers: { __complete: async () => { effects.push("override"); return { exitCode: 99 }; } },
  });
  for (const callback of ["__complete", "__completeNoDesc"]) {
    const run = context([callback, "item", "delete", "private-operand", "--vault", "private-value", "--"]);
    assert.deepEqual(await command.execute(run.invocation), { exitCode: 0 });
    const output = Buffer.concat(run.output).toString();
    assert.ok(output.includes("--archive"));
    assert.equal(output.includes("private"), false);
    assert.deepEqual(effects, []);
  }
  const denied = context(["item", "delete", "__complete"]);
  denied.invocation.stdin = (async function* () {})();
  assert.equal((await command.execute(denied.invocation)).exitCode, 1);
  assert.deepEqual(effects, ["authorize"]);
  const help = context(["--help"]);
  await command.execute(help.invocation);
  assert.equal(Buffer.concat(help.output).toString().includes("__complete"), false);
});

test("callback channel and cancellation are preserved without backend discovery", async () => {
  for (const channel of ["stable", "beta"] as const) {
    const command = createOp({ channel, backend: { async execute() { assert.fail("backend"); } } });
    const run = context(["__completeNoDesc", "environment", ""]);
    assert.equal((await command.execute(run.invocation)).exitCode, 0);
    assert.equal(Buffer.concat(run.output).toString().includes("read\n"), channel === "beta");
    run.invocation.signal = AbortSignal.abort();
    run.output.length = 0;
    assert.equal((await command.execute(run.invocation)).exitCode, 130);
    assert.equal(run.output.length, 0);
  }
});

const quote = (value: string) => `'${value.split("'").join("'\\''")}'`;

test("Bash uses bash-completion word reconstruction for equals and colon word breaks", async () => {
  const script = await generate("bash");
  const input = `
_get_comp_words_by_ref() {
  [[ "$*" == '-n =: -w op_words -i op_cword -c current' ]] || return 1
  op_words=(op --account=work item '')
  op_cword=3
  current=''
}
op() { printf '%s\\0' "$@" >&3; printf 'get\\n:4\\n'; }
${script}
COMP_WORDS=(op --account = work item '')
COMP_CWORD=5
_op
printf '%s\\n' "\${COMPREPLY[@]}"
`;
  const result = spawnSync("/bin/bash", ["--noprofile", "--norc"], { input, encoding: "utf8", env: { PATH: "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "pipe", "pipe"], timeout: 2000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(String(result.output[3]).split("\0").slice(0, -1), ["__completeNoDesc", "--account=work", "item", ""]);
  assert.equal(result.stdout, "get\n");
});

for (const shell of ["bash", "zsh"] as const) {
  test(`${shell} generated channel applies only to its callback process`, async () => {
    const script = await generate(shell, "beta");
    const setup = 'op() { printf "%s" "$OP_COMPATIBILITY_CHANNEL" >&3; printf ":4\\n"; }; compdef() { :; };\n';
    const invoke = shell === "bash" ? 'COMP_WORDS=(op ""); COMP_CWORD=1; _op' : 'words=(op ""); CURRENT=2; _op';
    const result = spawnSync(`/bin/${shell}`, shell === "bash" ? ["--noprofile", "--norc"] : ["-f"], { input: setup + script + '\nOP_COMPATIBILITY_CHANNEL=stable; ' + invoke + '; printf "%s" "$OP_COMPATIBILITY_CHANNEL"', encoding: "utf8", env: { PATH: "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "pipe", "pipe"], timeout: 2000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output[3], "beta");
    assert.equal(result.stdout, "stable");
  });

  test(`${shell} executes catalog completion and forwards literal words without disk fixtures`, async () => {
    const script = await generate(shell);
    const cases = [
      ["item", ""], ["--account", "work", "item", ""], ["item", "--account=work", ""],
      ["item", "get", "example", "--"], ["item", "--account", "get", ""],
      ["item", "get", "--vault", ""], ["run", "--", "item", ""],
      ["item", "rm", "--"], ["read", "-ooutput", "--"], ["read", "-hn", ""],
      ["item", "get", "$(printf unsafe);' value", "--"],
    ];
    for (const args of cases) {
      const reply = context();
      const resource = shell === "bash" ? "__completeNoDesc" : "__complete";
      await createCompletionCallbackHandler()({ resource, action: "", args, flags: {} }, reply.invocation);
      const response = Buffer.concat(reply.output).toString();
      const common = `op() { printf '%s\\0' "$@" >&3; printf '%s' ${quote(response)}; };\n`;
      const setup = shell === "bash" ? "compgen() { printf '%s\\n' fallback.txt; };\n" : "compdef() { :; }; _files() { printf '%s\\n' fallback.txt; }; compadd() { while (( $# )) && [[ $1 != -- ]]; do shift; done; shift; printf '%s\\n' \"$@\"; };\n";
      const invoke = shell === "bash" ? `COMP_WORDS=(${["op", ...args].map(quote).join(" ")}); COMP_CWORD=${args.length}; choice=unchanged; _op; [[ $choice == unchanged ]] || exit 9; printf '%s\\n' "\${COMPREPLY[@]}"` : `words=(${["op", ...args].map(quote).join(" ")}); CURRENT=${args.length + 1}; _op`;
      const result = spawnSync(`/bin/${shell}`, shell === "bash" ? ["--noprofile", "--norc"] : ["-f"], { input: common + setup + script + "\n" + invoke, encoding: "utf8", env: { PATH: "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "pipe", "pipe"], timeout: 2000 });
      assert.equal(result.status, 0, `${shell} ${args.join(" ")}: ${result.stderr}`);
      assert.deepEqual(String(result.output[3]).split("\0").slice(0, -1), [resource, ...args]);
      const expected = response.endsWith(":0\n") ? ["fallback.txt"] : response.trimEnd().split("\n").slice(0, -1).map(line => line.split("\t")[0]!);
      assert.deepEqual(result.stdout.trimEnd().split("\n").filter(Boolean), expected, `${shell} ${args.join(" ")}`);
    }
  });
}
