import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { getCommandArguments, type CommandDefinition } from "../../src/contracts/index.js";

const rawValue: CommandDefinition = { name: "raw", async execute(context) {
  await context.stdout.write(getCommandArguments(context).bytes(0)!);
  return { exitCode: 0 };
} };

for (const [label, source, stdin, stdout, stderr, status] of [
  ["valid choice", 'PS3="P>"; select x in alpha beta; do args "$x" "$REPLY"; break; done', "2\n", '["beta","2"]', "1) alpha\n2) beta\nP>", 0],
  ["invalid choice", 'select x in a b; do args "$x" "$REPLY"; break; done', "oops\n", '["","oops"]', "1) a\n2) b\n#? ", 0],
  ["blank redraw", 'PS3="P>"; select x in a b; do args "$x"; break; done', "\n1\n", '["a"]', "1) a\n2) b\nP>1) a\n2) b\nP>", 0],
  ["empty list", 'select x in; do say WRONG; done', "1\n", "", "", 0],
  ["EOF", 'select x in a b; do say WRONG; done', "", "\n", "1) a\n2) b\n#? ", 1],
  ["unterminated reply", 'select x in a b; do say WRONG; done', "1", "\n", "1) a\n2) b\n#? ", 1],
  ["positionals", 'set -- "a b" c; select x; do args "$x" "$REPLY"; break; done', "1\n", '["a b","1"]', "1) a b\n2) c\n#? ", 0],
  ["decimal whitespace", 'select x in a b; do args "$x" "$REPLY"; break; done', " +02 \n", '["b"," +02 "]', "1) a\n2) b\n#? ", 0],
  ["backslash continuation", 'select x in a b; do args "$x" "$REPLY"; break; done', "\\2\\\n\n", '["b","2"]', "1) a\n2) b\n#? ", 0],
  ["IFS independent", 'IFS=2; select x in a b; do args "$x" "$REPLY"; break; done', "2\n", '["b","2"]', "1) a\n2) b\n#? ", 0],
] as const) test(`GNU select: ${label}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source, { stdin });
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, stderr);
    assert.equal(result.exitCode, status);
  } finally { await shell.dispose(); }
});

test("select counts blank replies against the shared loop budget", async () => {
  const { shell } = setup();
  try {
    await assert.rejects(shell.exec('select x in a; do :; done', { stdin: "\n\n\n", limits: { maxLoopIterations: 2 } }),
      error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
  } finally { await shell.dispose(); }
});

for (const [locale, expected] of [
  ["C", "312920ff0920342920610a322920c3a90920352920620a332920f09f98800920362920630a503e"],
  ["C.UTF-8", "312920ff20202020342920610a322920c3a9202020352920620a332920f09f98802020362920630a503e"],
] as const) test(`select preserves raw menu and choice bytes in ${locale}`, async () => {
  const { shell } = setup({ env: { LC_ALL: locale, COLUMNS: "20" } });
  shell.register(rawValue);
  try {
    const result = await shell.exec("PS3='P>'; select x in $'\\377' $'\\303\\251' $'\\360\\237\\230\\200' a b c; do raw \"$x\"; break; done", { stdin: "1\n" });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
    assert.equal(Buffer.from(result.stderrBytes).toString("hex"), expected);
  } finally { await shell.dispose(); }
});

test("select preserves raw REPLY and discards NUL across chunks", async () => {
  const { shell } = setup();
  shell.register(rawValue);
  const stdin = { async *[Symbol.asyncIterator]() { for (const byte of [0, 255, 10]) yield Uint8Array.of(byte); } };
  try {
    const result = await shell.exec('select x in a; do raw "$REPLY"; break; done', { stdin });
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("select publishes partial EOF REPLY without changing the selected variable", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('x=old; select x in a; do :; done; args "$REPLY" "$x" "$?"', { stdin: "2" });
    assert.equal(result.stdout, '\n["2","old","1"]');
  } finally { await shell.dispose(); }
});

test("select function declaration display retains loop syntax", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('f() { select x in a b; do break; done; }; type f');
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /select x in a b;/u);
  } finally { await shell.dispose(); }
});

test("select menu is column-major with tab-aware padding", async () => {
  const { shell } = setup({ env: { COLUMNS: "20" } });
  try {
    const result = await shell.exec('PS3="P>"; select x in a b c d e f; do break; done', { stdin: "1\n" });
    assert.equal(result.stderr, "1) a  3) c  5) e\n2) b  4) d  6) f\nP>");
  } finally { await shell.dispose(); }
});

test("select shares unread stdin with its body and expands the list only once", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('value=a; select x in "$value" b; do read next; args "$x" "$next"; value=changed; done', { stdin: "1\nbody\n1\nagain\n" });
    assert.equal(result.stdout, '["a","body"]["a","again"]\n');
    assert.equal(result.exitCode, 1);
  } finally { await shell.dispose(); }
});

test("select rereads PS3 and body-cleared REPLY requests a fresh menu", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('PS3="P>"; select x in a b; do PS3="next>"; REPLY=; continue; done', { stdin: "1\n2\n" });
    assert.equal(result.stderr, "1) a\n2) b\nP>1) a\n2) b\nnext>1) a\n2) b\nnext>");
  } finally { await shell.dispose(); }
});

test("select nested break uses the shared loop-depth flow", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('for outer in a b; do select x in one two; do say "$outer:$x"; break 2; done; done; say end', { stdin: "2\n" });
    assert.equal(result.stdout, "a:two\nend\n");
  } finally { await shell.dispose(); }
});

for (const reason of [false, { cancelled: "select input" }]) test(`select cancels held stdin with exact ${typeof reason} reason`, async () => {
  const { shell } = setup();
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let closed = false;
  let bodies = 0;
  shell.register({ name: "effect", execute() { bodies++; return { exitCode: 0 }; } });
  const stdin = { async *[Symbol.asyncIterator]() { try { entered(); await held; yield Uint8Array.of(49, 10); } finally { closed = true; } } };
  const controller = new AbortController();
  try {
    const pending = shell.exec('select x in a; do effect; done', { stdin, signal: controller.signal });
    const rejected = assert.rejects(pending, error => error === reason);
    await ready;
    controller.abort(reason);
    release();
    await rejected;
    assert.equal(bodies, 0);
    assert.equal(closed, true);
    assert.equal((await shell.exec("say recovered")).stdout, "recovered\n");
  } finally { release(); await shell.dispose(); }
});

test("select awaits menu output before acquiring stdin", async () => {
  const { shell } = setup();
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let acquired = 0;
  const stdin = { async *[Symbol.asyncIterator]() { acquired++; yield Uint8Array.of(49, 10); } };
  try {
    const pending = shell.exec('select x in a; do break; done', { stdin, stderr: { async write() { entered(); await held; } } });
    await ready;
    assert.equal(acquired, 0);
    release();
    assert.equal((await pending).exitCode, 0);
    assert.equal(acquired, 1);
  } finally { release(); await shell.dispose(); }
});

for (const [limits, limit] of [
  [{ maxExpansionFields: 1 }, "maxExpansionFields"],
  [{ maxOutputBytes: 3 }, "maxOutputBytes"],
  [{ maxCommands: 1 }, "maxCommands"],
] as const) test(`select preserves ${limit}`, async () => {
  const { shell } = setup();
  try {
    await assert.rejects(shell.exec('select x in a b; do say body; done', { stdin: "1\n", limits }),
      error => error instanceof ShellLimitError && error.limit === limit);
  } finally { await shell.dispose(); }
});
