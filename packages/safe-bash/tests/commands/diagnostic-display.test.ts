import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import type { CommandDefinition } from "../../src/contracts/index.js";
import { createYqCommand } from "../../src/commands/yq/index.js";
import { createXanCommand } from "../../src/commands/xan/index.js";
import { contractRuntime, execute as runSafeJs, operation } from "./safejs/helpers.js";
import { run as runCurl } from "./network/helpers.js";
import { CurlError } from "../../src/commands/network/types.js";
import { createNodeCommand, NODE_PROFILE } from "../../src/commands/node/index.js";
import { RegexSession } from "../../src/commands/regex-execution/client.js";
import { validateExprReply, type ExprMatchDescriptor } from "../../src/commands/regex-execution/protocol.js";
import { run as runExpr } from "./expr/helpers.js";
import { yqCaps } from "../../src/commands/yq/accounting.js";

const marker = "bad\u001b[31m";
const escaped = "bad\\033[31m";
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

async function run(source: string, stdin?: string, additional?: CommandDefinition) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/names");
  await fs.writeFile(`/names/${marker}`, Buffer.from("payload"));
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(agentCommands());
  if (additional) shell.register(additional);
  try { return await shell.exec(source, stdin === undefined ? {} : { stdin }); }
  finally { await shell.dispose(); }
}

for (const command of ["ls", "cat", "stat", "find", "column", "split", "html-to-markdown", "diff"] as const) {
  test(`${command} generated file diagnostics escape the operand`, async () => {
    const tail = command === "diff" ? " /another-missing" : "";
    const actual = await run(`${command} ${quote(`/missing-${marker}`)}${tail}`);
    assert.notEqual(actual.exitCode, 0);
    assert.equal(actual.stderr.includes(marker), false);
    assert.equal(actual.stderr.includes(escaped), true, JSON.stringify(actual.stderr));
  });
}

for (const command of ["sed", "awk", "rg", "sleep", "patch", "jq"] as const) {
  test(`${command} generated option diagnostics escape the operand`, async () => {
    const actual = await run(`${command} ${quote(`--${marker}`)}`);
    assert.notEqual(actual.exitCode, 0);
    assert.equal(actual.stderr.includes(marker), false);
    assert.equal(actual.stderr.includes(escaped), true, JSON.stringify(actual.stderr));
  });
}

for (const [name, source] of [
  ["command lookup", quote(marker)],
  ["source-bearing syntax", `echo ${quote(marker)}; echo "$(;)"`],
  ["redirection", `cat < ${quote(`/missing-${marker}`)}`],
  ["builtin operand", `export ${quote(`invalid-${marker}`)}`],
  ["printf conversion", `printf '%d' ${quote(marker)}`],
  ["which option", `which ${quote("-\u001b")}`],
] as const) {
  test(`shell ${name} diagnostics escape controls`, async () => {
    const actual = await run(source);
    assert.notEqual(actual.exitCode, 0);
    assert.equal(actual.stderr.includes("\u001b"), false);
    assert.equal(actual.stderr.includes("\\033"), true, JSON.stringify(actual.stderr));
  });
}

for (const source of ["ls /names", "find /names -type f", "find /names -type f -print"]) {
  test(`${source} escapes default display like tree`, async () => {
    const actual = await run(source);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stdout, `${source.startsWith("find") ? "/names/" : ""}${escaped}\n`);
  });
}

test("tree's existing display is unchanged", async () => {
  const actual = await run("tree --charset=ASCII --noreport /names");
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout, `/names\n\`-- ${escaped}\n`);
});

test("ls escapes recursive headers and symlink targets without changing lookup paths", async () => {
  const actual = await run(`mkdir ${quote(`/dir-${marker}`)}; ln -s ${quote(`/names/${marker}`)} /link; ls -l /link; ls -R ${quote(`/dir-${marker}`)}`);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout.includes("\u001b"), false);
  assert.equal(actual.stdout.includes(` -> /names/${escaped}\n`), true);
  assert.equal(actual.stdout.includes(`/dir-${escaped}:\n`), true);
});

test("ls and find display LF, TAB, backslashes and Unicode using tree's byte policy", async () => {
  const name = "line\n\té\\end";
  const expected = "line\\n\\t\\303\\251\\\\end";
  const actual = await run(`mkdir /other; touch ${quote(`/other/${name}`)}; ls /other; find /other -type f`);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout, `${expected}\n/other/${expected}\n`);
});

test("listing sorts raw names and escapes operands, headers, suffixes and targets once", async () => {
  const actual = await run(`mkdir /ordered; touch ${quote("/ordered/a\n")} ${quote("/ordered/a\\")}; ls /ordered; ls -d ${quote("/ordered/a\n")}; ln -s ${quote("/ordered/a\\")} ${quote("/link-\u009b")}; ls -lF ${quote("/link-\u009b")}; ls /ordered /names`);
  assert.equal(actual.exitCode, 0, JSON.stringify(actual.stderr));
  assert.equal(actual.stdout.startsWith("a\\n\na\\\\\n/ordered/a\\n\n"), true);
  assert.equal(actual.stdout.includes("/link-\\302\\233@ -> /ordered/a\\\\\n"), true, JSON.stringify(actual.stdout));
  assert.equal(actual.stdout.includes("/names:\n"), true);
  assert.equal(actual.stdout.includes("/ordered:\n"), true);
});

test("find print0 and argv substitution retain raw paths", async () => {
  const listing = await run("find /names -type f -print0");
  assert.equal(listing.stdout, `/names/${marker}\0`);
  const pipeline = await run("find /names -type f -print0 | xargs -0 cat");
  assert.equal(pipeline.exitCode, 0, pipeline.stderr);
  assert.equal(pipeline.stdout, "payload");
  const execute = await run("find /names -type f -exec cat '{}' ';'");
  assert.equal(execute.exitCode, 0, execute.stderr);
  assert.equal(execute.stdout, "payload");
  const batched = await run("find /names -type f -exec cat '{}' +");
  assert.equal(batched.exitCode, 0, JSON.stringify(batched.stderr));
  assert.equal(batched.stdout, "payload");
});

test("script-name and here-document warning fields use diagnostic escaping", async () => {
  const script = `/script-${marker}`;
  const actual = await run(`printf '%s\\n' missing > ${quote(script)}; sh ${quote(script)}`);
  assert.notEqual(actual.exitCode, 0);
  assert.equal(actual.stderr.includes(marker), false);
  assert.equal(actual.stderr.includes(`/script-${escaped}`), true, JSON.stringify(actual.stderr));
  const warning = await run(`cat <<'${marker}'\n`);
  assert.equal(warning.stderr.includes(marker), false);
  assert.equal(warning.stderr.includes(JSON.stringify(marker)), true, JSON.stringify(warning.stderr));
});

test("yq truncates the rendered filename without doubling existing diagnostic quoting", async () => {
  const name = `/missing-${"\u009b".repeat(200)}`;
  const actual = await run(`yq . ${quote(name)}`, undefined, createYqCommand());
  assert.notEqual(actual.exitCode, 0);
  assert.equal(actual.stderr.includes("\u009b"), false);
  const display = actual.stderr.slice(actual.stderr.indexOf('"'), actual.stderr.lastIndexOf('"') + 1);
  assert.equal(display.endsWith('..."'), true, JSON.stringify(actual.stderr));
  assert.ok(Buffer.byteLength(display) <= yqCaps.maxDisplayedFilenameBytes);
  assert.equal(display.includes("\\302\\233"), true);
});

test("program stderr and redirected bytes are not diagnostic display", async () => {
  const actual = await run("printf '\\033\\233\\000' >&2");
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(Buffer.from(actual.stderrBytes).toString("hex"), "1b9b00");
  const captured = await run("printf '\\033\\233\\000' 2>/unused > /data; cat /data");
  assert.equal(Buffer.from(captured.stdoutBytes).toString("hex"), "1b9b00");
});

test("xargs trace escapes its display but not child arguments", async () => {
  const actual = await run("xargs -0 -t printf '%s'", `${marker}\0`);
  assert.equal(actual.exitCode, 0, JSON.stringify(actual.stderr));
  assert.equal(actual.stdout, marker);
  assert.equal(actual.stderr.includes(marker), false);
  assert.equal(actual.stderr.includes(escaped), true);
});

test("apply_patch generated file failure escapes the path", async () => {
  const actual = await run("apply_patch", "*** Begin Patch\n*** Delete File: /missing-bad\u009bfile\n*** End Patch\n");
  assert.notEqual(actual.exitCode, 0);
  assert.equal(actual.stderr.includes("\u009b"), false);
  assert.equal(actual.stderr.includes("bad\\302\\233file"), true, JSON.stringify(actual.stderr));
});

for (const command of ["du", "tar", "yq"] as const) {
  test(`${command} existing diagnostic quoting also handles C1`, async () => {
    const name = "bad\u009bfile";
    const source = command === "tar" ? `tar -tf ${quote(`/missing-${name}`)}`
      : command === "yq" ? `yq . ${quote(`/missing-${name}`)}` : `du ${quote(`/missing-${name}`)}`;
    const actual = await run(source, undefined, command === "yq" ? createYqCommand() : undefined);
    assert.notEqual(actual.exitCode, 0);
    assert.equal(actual.stderr.includes("\u009b"), false);
    assert.equal(actual.stderr.includes("\\302\\233"), true, JSON.stringify(actual.stderr));
  });
}

test("xan generated file errors escape controls", async () => {
  const actual = await run(`xan count ${quote(`/missing-${marker}`)}`, undefined, createXanCommand());
  assert.notEqual(actual.exitCode, 0);
  assert.equal(actual.stderr.includes(marker), false);
  assert.equal(actual.stderr.includes(escaped), true, JSON.stringify(actual.stderr));
});

test("xan diagnostic rendering retains only the admitted output and bounded scratch", async () => {
  const expected = `xan count: unsupported in bounded CSV profile: --${escaped}\n`;
  const size = Buffer.byteLength(expected);
  const actual = await run(`xan count ${quote(`--${marker}`)}`, undefined, createXanCommand({ limits: { maxRetainedBytes: size + 8, maxOutputBytes: size } }));
  assert.equal(actual.exitCode, 1);
  assert.equal(JSON.stringify(actual.stderr), JSON.stringify(expected));
  for (const limits of [{ maxRetainedBytes: size - 1 }, { maxOutputBytes: size - 1 }, { maxWork: 1 }]) {
    const rejected = await run(`xan count ${quote(`--${marker}`)}`, undefined, createXanCommand({ limits }));
    assert.equal(rejected.exitCode, 1);
    assert.equal(rejected.stderr, "");
  }
});

test("curl generated transport errors escape controls with an in-memory transport", async () => {
  const actual = await runCurl(["http://127.0.0.1/"], { options: {
    async transport() { throw new CurlError(56, marker); },
  } });
  assert.notEqual(actual.exitCode, 0);
  assert.equal(actual.stderr.toString().includes(marker), false);
  assert.equal(actual.stderr.toString().includes(escaped), true, JSON.stringify(actual.stderr.toString()));
});

test("safejs generated exceptions are escaped but guest stderr remains raw", async () => {
  const runtime = contractRuntime(async (_source, options) => {
    await operation(options, "stdio", "error")(marker);
    throw new Error(marker);
  });
  const actual = await runSafeJs(["-e", "contract"], { runtime });
  assert.notEqual(actual.exitCode, 0);
  assert.equal(JSON.stringify(actual.stderr), JSON.stringify(`${marker}safejs: ${escaped}\n`));
});

test("node provider diagnostics escape controls but guest stderr is raw", async () => {
  const command = createNodeCommand({ grants: { stderrWrite: true }, provider: {
    profile: NODE_PROFILE, identity: "diagnostic-contract",
    prepare(_request, services) {
      return {
        async start() {
          const response = await services.request({ sequence: 1, op: "writeOutput", authority: "stderr", path: null, flag: null, text: marker, moduleKey: null });
          assert.equal(response.kind, "void");
          services.delivered(1);
          return { kind: "guestFailure", observation: { state: "captured", fault: true, name: "Error", message: marker, code: null } };
        },
        cancel() {},
        async retire() { return { acquisition: "exited", exitCode: 0 }; },
      };
    },
  } });
  const actual = await run("node -e contract", undefined, command);
  assert.notEqual(actual.exitCode, 0);
  assert.equal(JSON.stringify(actual.stderr), JSON.stringify(`${marker}node: ${escaped}\n`));
});

test("tar archive-self warning escapes C1 in the displayed filename", async () => {
  const name = "/names/archive-\u009b.tar";
  const actual = await run(`touch ${quote(name)}; tar -cf ${quote(name)} /names`);
  assert.equal(actual.exitCode, 0, JSON.stringify(actual.stderr));
  assert.equal(actual.stderr.includes("\u009b"), false);
  assert.equal(actual.stderr.includes("\\302\\233"), true, JSON.stringify(actual.stderr));
});

test("expr already quotes control-bearing unexpected operands", async () => {
  const actual = await run(`expr 1 ${quote(marker)}`);
  assert.notEqual(actual.exitCode, 0);
  assert.equal(actual.stderr.includes(marker), false);
  assert.equal(actual.stderr.includes(escaped), true, JSON.stringify(actual.stderr));
});

test("expr escapes a mocked worker error reply before output-byte admission", async context => {
  context.mock.method(RegexSession.prototype, "matchExpr", async (descriptor: ExprMatchDescriptor, subject: Uint8Array) => {
    return validateExprReply({ id: 1, operation: "expr-match", category: "syntax", error: marker }, 1, descriptor, subject, new AbortController().signal);
  });
  const expected = `expr: ${escaped}\n`;
  const accepted = await runExpr(["a", ":", "a"], { limits: { maxOutputBytes: Buffer.byteLength(expected) } });
  assert.equal(accepted.exitCode, 2);
  assert.equal(JSON.stringify(accepted.stderr), JSON.stringify(expected));
  const rejected = await runExpr(["a", ":", "a"], { limits: { maxOutputBytes: Buffer.byteLength(expected) - 1 } });
  assert.equal(rejected.exitCode, 3);
  assert.equal(rejected.stderr, "expr: output bytes limit exceeded\n");
});

for (const [name, source, expected] of [
  ["copy", `cp -v ${quote(`/names/${marker}`)} /copy; cat /copy`, `'/names/${escaped}' -> '/copy'\npayload`],
  ["mkdir", `mkdir -v ${quote(`/${marker}`)}; test -d ${quote(`/${marker}`)}`, `mkdir: created directory '/${escaped}'\n`],
  ["move", `mv -v ${quote(`/names/${marker}`)} /moved; cat /moved`, `'/names/${escaped}' -> '/moved'\npayload`],
  ["remove", `rm -v ${quote(`/names/${marker}`)}; test ! -e ${quote(`/names/${marker}`)}`, `removed '/names/${escaped}'\n`],
  ["rmdir", `mkdir ${quote(`/${marker}`)}; rmdir -v ${quote(`/${marker}`)}; test ! -d ${quote(`/${marker}`)}`, `rmdir: removing directory '/${escaped}'\n`],
] as const) {
  test(`verbose ${name} escapes filename display without changing operations`, async () => {
    const actual = await run(source);
    assert.equal(actual.exitCode, 0, JSON.stringify(actual.stderr));
    assert.equal(JSON.stringify(actual.stdout), JSON.stringify(expected));
  });
}
