import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { diagnosticCommandName } from "../../../../src/shell/diagnostic-name.js";
import { diagnosticPrintableRanges } from "../../../../src/shell/diagnostic-name-ranges.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { ValueArena } from "../../../../src/shell/value-state.js";

const referenceBytes = readFileSync(new URL("./command-name-runtime-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(referenceBytes).digest("hex"), "0b9fd7ec556334fb9665632ded78add315942f158c7cb390aa64ec0422d229e7");
const reference = JSON.parse(referenceBytes.toString()) as {
  profile: string; locale: string; oracle: { sha256: string };
  records: { name: string; source: string; status: number; stdoutHex: string; stderrHex: string }[];
  localeBoundaryCapture: { oracleSha256: string };
  localeBoundaries: { name: string; locale: string; source: string; environment: Record<string, string>; expected: { status: number; stdoutHex: string; stderrHex: string } }[];
};
assert.equal(reference.profile, "primary-5.3");
assert.equal(reference.locale, "C");
assert.equal(reference.oracle.sha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(reference.records.length, 11);
assert.equal(reference.localeBoundaryCapture.oracleSha256, reference.oracle.sha256);
assert.equal(reference.localeBoundaries.length, 12);

function setup() {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const fixture of reference.records) test(`raw command-name primary C: ${fixture.name}`, async context => {
  const shell = setup(); context.after(() => shell.dispose());
  const result = await shell.exec(fixture.source);
  assert.equal(result.exitCode, fixture.status);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(fixture.stdoutHex, "hex"));
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(fixture.stderrHex, "hex"));
});

for (const fixture of reference.localeBoundaries) test(`native active diagnostic locale: ${fixture.locale} ${fixture.name}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: fixture.environment });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const result = await shell.exec(fixture.source);
  assert.equal(result.exitCode, fixture.expected.status);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(fixture.expected.stdoutHex, "hex"));
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(fixture.expected.stderrHex, "hex"));
});

test("direct temporary locale classification preserves raw ambient variable restoration", async context => {
  const shell = setup(); context.after(() => shell.dispose());
  const result = await shell.exec("LC_ALL=$'raw\\377'; LC_ALL=C $'é\\377中'; printf '%s' \"$LC_ALL\"");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from([114, 97, 119, 255]));
  assert.equal(result.stderr, "shell: line 1: $'é\\377中': command not found\n");
});

for (const locale of ["C", "C.UTF-8"]) test(`middleware locale replacement stays active for direct missing command: ${locale}`, async context => {
  const shell = setup(); context.after(() => shell.dispose());
  shell.use((invocation, next) => {
    invocation.env.LC_ALL = locale;
    return next();
  });
  const result = await shell.exec("LC_ALL=POSIX $'é\\377中'");
  assert.equal(result.exitCode, 127);
  const name = locale === "C" ? "$'\\303\\251\\377\\344\\270\\255'" : "$'é\\377中'";
  assert.equal(result.stderr, `shell: line 1: ${name}: command not found\n`);
});

for (const reason of [false, 0, "", null]) test(`temporary locale keeps command environment and falsey cancellation: ${String(reason)}`, async context => {
  const shell = setup(); context.after(() => shell.dispose());
  const controller = new AbortController();
  let cleanups = 0;
  let rendered: Uint8Array | undefined;
  shell.use((invocation, next) => {
    assert.equal(invocation.env.LC_ALL, "C");
    invocation.registerCleanup!(() => { cleanups++; assert.equal(invocation.env.LC_ALL, "C"); });
    return next();
  });
  await assert.rejects(shell.exec("LC_ALL=$'raw\\377'; LC_ALL=C $'é\\377中'", {
    signal: controller.signal,
    stderr: { async write(chunk) { rendered = Uint8Array.from(chunk); controller.abort(reason); } },
  }), error => Object.is(error, reason));
  assert.equal(cleanups, 1);
  assert.ok(rendered);
  assert.deepEqual(Buffer.from(rendered), Buffer.from("shell: line 1: $'é\\377中': command not found\n"));
});

for (const mode of ["assign", "define"] as const) {
  for (const replacement of ["replacement_missing", "�"]) test(`middleware ${mode} command replacement discards raw provenance: ${replacement}`, async context => {
    const shell = setup(); context.after(() => shell.dispose());
    shell.use((invocation, next) => {
      if (mode === "assign") Object.assign(invocation, { command: replacement });
      else Object.defineProperty(invocation, "command", { value: replacement });
      return next();
    });
    const result = await shell.exec("$'\\377'");
    assert.equal(result.exitCode, 127);
    const rendered = replacement === "�" ? "$'\\357\\277\\275'" : replacement;
    assert.equal(result.stderr, `shell: line 1: ${rendered}: command not found\n`);
  });
}

test("raw command transport preserves existing string registry resolution", async context => {
  const shell = setup(); context.after(() => shell.dispose());
  shell.register({ name: "�", async execute(invocation) {
    assert.equal(invocation.command, "�");
    await invocation.stdout.write(Buffer.from("matched"));
    return { exitCode: 7 };
  } });
  const result = await shell.exec("$'\\377'");
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, "matched");
  assert.equal(result.stderr, "");
});

test("formatted command errors use one awaited stderr chunk", { timeout: 2000 }, async context => {
  const shell = setup(); context.after(() => shell.dispose());
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const chunks: Buffer[] = [];
  let completed = false;
  const pending = shell.exec("$'\\377'", { stderr: { async write(chunk) {
    chunks.push(Buffer.from(chunk)); enter(); await gate;
  } } }).then(result => { completed = true; return result; });
  try {
    await entered;
    assert.equal(completed, false);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.toString(), "shell: line 1: $'\\377': command not found\n");
  } finally { release(); await pending; }
});

for (const short of [false, true]) test(`stdout and formatted command error share output budget: short=${short}`, async context => {
  const shell = setup(); context.after(() => shell.dispose());
  const stderr = "shell: line 1: $'\\377': command not found\n";
  let writes = 0;
  const pending = shell.exec("printf x; $'\\377'", {
    limits: { maxOutputBytes: Buffer.byteLength(stderr) + 1 - Number(short) },
    stderr: { async write() { writes++; } },
  });
  if (short) {
    await assert.rejects(pending, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(writes, 0);
  } else {
    const result = await pending;
    assert.equal(result.stdout, "x"); assert.equal(result.stderr, stderr);
    assert.equal(writes, 1);
  }
});

for (const reason of [false, 0, "", null]) test(`raw command diagnostic preserves falsey root cancellation: ${String(reason)}`, async context => {
  const shell = setup(); context.after(() => shell.dispose());
  const controller = new AbortController();
  let cleanups = 0;
  let rendered: Uint8Array | undefined;
  shell.use((invocation, next) => {
    invocation.registerCleanup!(async () => { await Promise.resolve(); cleanups++; });
    return next();
  });
  await assert.rejects(shell.exec("$'\\377'", {
    signal: controller.signal,
    stderr: { async write(chunk) { rendered = chunk.slice(); controller.abort(reason); } },
  }), error => Object.is(error, reason));
  assert.equal(cleanups, 1);
  assert.ok(rendered);
  assert.deepEqual(Buffer.from(rendered), Buffer.from("shell: line 1: $'\\377': command not found\n"));
});

test("C formatter reserves exact output before materialization and releases owned temporary storage", () => {
  const arena = new ValueArena(65536, 256, () => {});
  const scope = arena.scope();
  const reservations: number[] = [];
  const allocation = {
    assertOpen: () => scope.assertOpen(),
    reserve(bytes: number, slots: number) { reservations.push(bytes); return scope.reserve(bytes, slots); },
  };
  const input = shellValueFromBytes(Uint8Array.of(1, 255, 10));
  try {
    const result = diagnosticCommandName(input, true, allocation);
    assert.deepEqual(Buffer.from(shellValueBytes(result)), Buffer.from("$'\\001\\377\\n'"));
    assert.equal(reservations[0], 67);
    assert.equal(reservations[1], 13);
    assert.ok(arena.usage.bytes > 0);
  } finally { scope.close(); arena.close(); }
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("formatter refuses expansion allocation before copying an oversized byte name", () => {
  const arena = new ValueArena(128, 16, () => {});
  const scope = arena.scope();
  const input = shellValueFromBytes(new Uint8Array(256).fill(255));
  try {
    assert.throws(() => diagnosticCommandName(input, true, scope), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  } finally { scope.close(); arena.close(); }
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

for (const reason of [false, 0, "", null]) test(`cooperative diagnostic teardown drains before falsey cancellation: ${String(reason)}`, { timeout: 2000 }, async context => {
  const shell = setup(); context.after(() => shell.dispose());
  const controller = new AbortController();
  let enter!: () => void;
  let startCleanup!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const cleaning = new Promise<void>(resolve => { startCleanup = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = [];
  let retained: Uint8Array | undefined;
  let settled = false;
  shell.use((invocation, next) => {
    invocation.registerCleanup!(async () => {
      events.push("cleanup-start"); startCleanup(); await gate; events.push("cleanup-end");
    });
    return next();
  });
  const pending = shell.exec("$'\\377'", { signal: controller.signal, stderr: { async write(chunk) {
    retained = chunk; events.push("write-start"); enter(); await gate; events.push("write-end");
  } } });
  const observed = assert.rejects(pending, error => Object.is(error, reason)).then(() => { settled = true; });
  try {
    await entered;
    controller.abort(reason);
    await cleaning;
    assert.equal(settled, false);
    assert.ok(retained);
    assert.deepEqual(Buffer.from(retained), Buffer.from("shell: line 1: $'\\377': command not found\n"));
  } finally { release(); await observed; }
  assert.deepEqual(events, ["write-start", "cleanup-start", "write-end", "cleanup-end"]);
});

for (const reason of [undefined, null, false, 0, ""]) test(`raw and string command errors preserve the same sink-failure outcome: ${String(reason)}`, async context => {
  const outcomes: unknown[] = [];
  for (const source of ["missing_command", "$'\\377'"]) {
    const shell = setup(); context.after(() => shell.dispose());
    let writes = 0;
    try {
      const result = await shell.exec(source, { stderr: { async write() { writes++; throw reason; } } });
      outcomes.push({ status: result.exitCode, writes });
    } catch (error) { outcomes.push({ error, writes }); }
  }
  assert.deepEqual(outcomes[1], outcomes[0]);
});

test("UTF-8 printability business data matches the fully enumerated native profile", () => {
  assert.equal(createHash("sha256").update(JSON.stringify(diagnosticPrintableRanges) + "\n").digest("hex"), "001ae9f3918036157e35f01be10c9f6af964b6af57aee254071019c5373fcf64");
  assert.equal(diagnosticPrintableRanges.length, 713);
  assert.equal(Object.isFrozen(diagnosticPrintableRanges), true);
  let previous = -2;
  let count = 0;
  for (const range of diagnosticPrintableRanges) {
    const [first, last] = range;
    assert.equal(Object.isFrozen(range), true);
    assert.ok(Number.isSafeInteger(first) && Number.isSafeInteger(last));
    assert.ok(first > previous + 1 && last >= first && last <= 0x10ffff);
    assert.ok(last < 0xd800 || first > 0xdfff);
    previous = last;
    count += last - first + 1;
  }
  assert.equal(count, 286484);
});

test("UTF-8 formatter preserves every printable range endpoint and quotes adjacent nonprinting scalars", () => {
  const arena = new ValueArena(65536, 256, () => {});
  try {
    for (const [first, last] of diagnosticPrintableRanges) {
      for (const scalar of [first - 1, first, last, last + 1]) {
        if (scalar < 0 || scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) continue;
        const scope = arena.scope();
        try {
          const input = Buffer.from(String.fromCodePoint(scalar));
          const printable = scalar >= first && scalar <= last;
          const expected = printable ? input : Buffer.from("$'" + [...input].map(byte => "\\" + byte.toString(8).padStart(3, "0")).join("") + "'");
          const actual = diagnosticCommandName(shellValueFromBytes(input), false, scope);
          assert.deepEqual(Buffer.from(shellValueBytes(actual)), expected, `U+${scalar.toString(16)}`);
        } finally { scope.close(); }
      }
    }
  } finally { arena.close(); }
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

const invalidUtf8Cases = [
  ["c0af", "\\300\\257"], ["c180", "\\301\\200"],
  ["e08080", "\\340\\200\\200"], ["eda080", "\\355\\240\\200"],
  ["edbfbf", "\\355\\277\\277"], ["f0808080", "\\360\\200\\200\\200"],
  ["f4908080", "\\364\\220\\200\\200"], ["f5808080", "\\365\\200\\200\\200"],
  ["ff", "\\377"], ["80bf", "\\200\\277"],
  ["c2", "\\302"], ["e282", "\\342\\202"], ["f09080", "\\360\\220\\200"],
  ["e228a1", "\\342(\\241"], ["c2c3a9", "\\302é"],
  ["c280", "\\302\\200"], ["c2ad", "\\302\\255"],
  ["efb790", "\\357\\267\\220"], ["f48fbfbf", "\\364\\217\\277\\277"],
] as const;
for (const [hex, rendered] of invalidUtf8Cases) test(`UTF-8 decoder retains printable neighbors around nonprinting or invalid bytes: ${hex}`, () => {
  const arena = new ValueArena(65536, 256, () => {});
  const scope = arena.scope();
  try {
    const input = Buffer.concat([Buffer.from("é"), Buffer.from(hex, "hex"), Buffer.from("中𐀀")]);
    const result = diagnosticCommandName(shellValueFromBytes(input), false, scope);
    assert.deepEqual(Buffer.from(shellValueBytes(result)), Buffer.from("$'é" + rendered + "中𐀀'"));
  } finally { scope.close(); arena.close(); }
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("UTF-8 mixed quotation uses native control mnemonics without escaping printable Unicode", () => {
  const arena = new ValueArena(65536, 256, () => {});
  const scope = arena.scope();
  try {
    const value = "é'\\\x07\b\t\n\v\f\r\x1b中";
    assert.deepEqual(Buffer.from(shellValueBytes(diagnosticCommandName(value, false, scope))), Buffer.from("$'é\\'\\\\\\a\\b\\t\\n\\v\\f\\r\\E中'"));
  } finally { scope.close(); arena.close(); }
});

for (const [name, env, byte] of [
  ["C", { LC_ALL: "C" }, true],
  ["POSIX", { LC_ALL: "POSIX" }, true],
  ["C.UTF-8", { LC_ALL: "C.UTF-8" }, false],
  ["en_US.UTF-8", { LC_ALL: "en_US.UTF-8" }, false],
  ["absent virtual fallback", {}, false],
  ["unknown virtual fallback", { LC_ALL: "not-a-native-locale" }, false],
  ["LC_CTYPE precedence", { LC_CTYPE: "C", LANG: "C.UTF-8" }, true],
  ["LC_ALL precedence", { LC_ALL: "C.UTF-8", LC_CTYPE: "C" }, false],
  ["LANG fallback", { LANG: "POSIX" }, true],
] as const) test(`command diagnostic retains existing locale routing: ${name}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env });
  context.after(() => shell.dispose());
  const result = await shell.exec("$'é\\n'");
  assert.equal(result.exitCode, 127);
  const nameBytes = byte ? "\\303\\251\\n" : "é\\n";
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(`shell: line 1: $'${nameBytes}': command not found\n`));
});
