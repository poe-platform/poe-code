import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { toByteSource, type ByteSink, type CommandContext } from "../../../src/contracts/index.js";
import { registerYieldCheckpoint } from "../../../src/contracts/yield.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { createYqCommand, createYqCommands, yqCommands } from "../../../src/commands/yq/index.js";
import { createYqQuerySession } from "../../../src/commands/structured/query-core.js";
import { JqLimitError } from "../../../src/commands/structured/limits.js";
import { parseYamlDocuments } from "../../../src/commands/yq/parser.js";
import { YqLedger } from "../../../src/commands/yq/accounting.js";
import { YqError } from "../../../src/commands/yq/errors.js";

function sink(): ByteSink & { readonly bytes: Uint8Array[] } {
  const bytes: Uint8Array[] = [];
  return { bytes, async write(chunk) { bytes.push(new Uint8Array(chunk)); } };
}

function text(output: { readonly bytes: Uint8Array[] }): string {
  return new TextDecoder().decode(Buffer.concat(output.bytes));
}

test("inline continuation preserves quoting, inserted newlines, and comments", async () => {
  for (const [input, value] of [
    ['[\n  "[}]",\n  \'can\'\'t\',\n  {key: "value"}\n]', ["[}]", "can't", { key: "value" }]],
    ['"first\\\nsecond"', "firstsecond"],
    ['"open\\\n"', "open"],
    ["['a''\nb']", ["a' b"]],
    ['[\n  1, # comment\n  2\n]', [1, 2]],
    ['[\n  1, # [\n  2\n]', [1, 2]],
    ['[1] # [ ignored', [1]],
  ] as const) {
    assert.deepEqual(await run(["-o", "json", "-c", "."], input), {
      status: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "",
    });
  }
});

test("inline continuation preserves malformed diagnostic positions", async () => {
  for (const [input, line, column] of [
    ["'first'\n'next'", 2, 1],
    [']"open[\nclose"', 1, 1],
    ['][\nnext', 1, 1],
    ['[\n  1,\n', 1, 1],
  ] as const) {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      await assert.rejects(async () => {
        for await (const unused of parseYamlDocuments(input, session.ownedWork, new YqLedger())) void unused;
      }, error => error instanceof YqError && error.code === "INPUT_YAML_SYNTAX" && error.line === line && error.column === column);
    } finally { await session.close(); }
  }
});

test("inline continuation preserves doubled quotes and escapes across charge boundaries", async () => {
  for (const padding of [252, 253, 254, 255, 256]) {
    const prefix = "a".repeat(padding);
    for (const [input, value] of [
      [`['${prefix}''\nb']`, [`${prefix}' b`]],
      [`[\n"${prefix}\\"[}]\\\nnext"]`, [`${prefix}"[}]next`]],
    ] as const) {
      assert.deepEqual(await run(["-o", "json", "-c", "."], input), {
        status: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "",
      });
    }
  }
});

test("inline balancing gates negative depth on closed quotes and remembers earlier negative depth", async context => {
  for (const [fragments, consumed] of [
    [['][', 'ignored'], 1],
    [[']"open[', 'close"[[', 'ignored'], 2],
    [[']"open[', 'neverclosed'], 2],
  ] as const) {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    const charge = session.ownedWork.charge.bind(session.ownedWork);
    const charges: number[] = [];
    context.mock.method(session.ownedWork, "charge", async (units = 1) => {
      charges.push(units);
      await charge(units);
    });
    try {
      await assert.rejects(async () => {
        for await (const unused of parseYamlDocuments(fragments.join("\n"), session.ownedWork, new YqLedger())) void unused;
      }, error => error instanceof YqError && error.code === "INPUT_YAML_SYNTAX");
      assert.deepEqual(charges.slice(fragments.length), fragments.slice(0, consumed).map((fragment, index) => fragment.length + (index > 0 ? 1 : 0)));
    } finally { await session.close(); }
  }
});

for (const lines of [64, 128, 256, 512]) test(`inline balancing charges linear character work: ${lines} continuations`, async context => {
  const input = ["[", ...Array<string>(lines).fill("x")].join("\n");
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const charge = session.ownedWork.charge.bind(session.ownedWork);
  const charges: number[] = [];
  context.mock.method(session.ownedWork, "charge", async (units = 1) => {
    charges.push(units);
    await charge(units);
  });
  const ledger = new YqLedger();
  try {
    await assert.rejects(async () => {
      for await (const unused of parseYamlDocuments(input, session.ownedWork, ledger)) void unused;
    }, error => error instanceof YqError && error.code === "INPUT_YAML_SYNTAX");
    assert.equal(ledger.documentNodes, 0);
    const balancing = charges.slice(lines + 1);
    assert.equal(balancing.reduce((total, units) => total + units, 0), input.length);
    assert.ok(balancing.length >= lines + 1);
    assert.ok(balancing.every(units => units > 0 && units <= 256));
  } finally { await session.close(); }
});

test("inline balancing uses the existing shared step budget", async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const ledger = new YqLedger();
  try {
    await session.ownedWork.charge(997_000);
    await assert.rejects(async () => {
      for await (const unused of parseYamlDocuments("[" + "x".repeat(1500), session.ownedWork, ledger)) void unused;
    }, error => error instanceof JqLimitError && error.message.includes("maxSteps"));
    assert.equal(ledger.documentNodes, 0);
  } finally { await session.close(); }
});

for (const reason of [false, null]) {
  for (const longLine of [false, true]) test(`inline balancing cancels ${longLine ? "within long lines" : "between continuations"}: ${reason}`, async context => {
    const fragments = longLine ? ["[", "x".repeat(2048)] : ["[", ...Array<string>(64).fill("x")];
    const input = fragments.join("\n");
    const preliminaryUnits = fragments.reduce((total, fragment) => total + fragment.length, 0);
    const controller = new AbortController();
    const session = createYqQuerySession({ signal: controller.signal });
    const charge = session.ownedWork.charge.bind(session.ownedWork);
    let unitsCharged = 0;
    let balancingCheckpoints = 0;
    context.mock.method(session.ownedWork, "charge", async (units = 1) => {
      await charge(units);
      unitsCharged += units;
      if (unitsCharged > preliminaryUnits) {
        assert.ok(units <= 256);
        if (++balancingCheckpoints === 3) controller.abort(reason);
      }
    });
    const ledger = new YqLedger();
    try {
      await assert.rejects(async () => {
        for await (const unused of parseYamlDocuments(input, session.ownedWork, ledger)) void unused;
      }, error => error === reason);
      assert.equal(balancingCheckpoints, 3);
      assert.ok(unitsCharged > preliminaryUnits && unitsCharged < preliminaryUnits + input.length);
      assert.equal(ledger.documentNodes, 0);
    } finally { await session.close(); }
  });
  for (const longLine of [false, true]) test(`inline balancing reaches real work yields ${longLine ? "within long lines" : "between continuations"}: ${reason}`, async context => {
    const fragments = longLine ? ["[", "x".repeat(4096)] : ["[", ...Array<string>(1024).fill("x")];
    const preliminaryUnits = fragments.reduce((total, fragment) => total + fragment.length, 0);
    const controller = new AbortController();
    const session = createYqQuerySession({ signal: controller.signal });
    const charge = session.ownedWork.charge.bind(session.ownedWork);
    let unitsCharged = 0;
    let balancingYields = 0;
    context.mock.method(session.ownedWork, "charge", async (units = 1) => {
      await charge(units);
      unitsCharged += units;
    });
    registerYieldCheckpoint(controller.signal, () => {
      if (unitsCharged >= preliminaryUnits) {
        balancingYields++;
        controller.abort(reason);
      }
    });
    const ledger = new YqLedger();
    try {
      await assert.rejects(async () => {
        for await (const unused of parseYamlDocuments(fragments.join("\n"), session.ownedWork, ledger)) void unused;
      }, error => error === reason);
      assert.equal(balancingYields, 1);
      assert.ok(unitsCharged > preliminaryUnits);
      assert.equal(ledger.documentNodes, 0);
    } finally { await session.close(); }
  });
}

const depthCases = [
  { name: "flow sequences", input: (depth: number) => "[".repeat(depth) + "null" + "]".repeat(depth) },
  { name: "flow mappings", input: (depth: number) => "{k: ".repeat(depth) + "null" + "}".repeat(depth) },
  { name: "block mappings", input: (depth: number) => Array.from({ length: depth }, (_, index) => " ".repeat(index * 2) + "k:").join("\n") + "\n" + " ".repeat(depth * 2) + "null" },
  { name: "block sequences", input: (depth: number) => Array.from({ length: depth }, (_, index) => " ".repeat(index * 2) + "-").join("\n") + "\n" + " ".repeat(depth * 2) + "null" },
  { name: "mixed block and flow", input: (depth: number) => Array.from({ length: 64 }, (_, index) => " ".repeat(index * 2) + "k:").join("\n") + "\n" + " ".repeat(128) + "[".repeat(depth - 64) + "null" + "]".repeat(depth - 64) },
  { name: "implicit flow pairs", input: (depth: number) => "[k: ".repeat(64) + (depth === 128 ? "null" : "[null]") + "]".repeat(64) },
  { name: "block sequence mappings", input: (depth: number) => Array.from({ length: 64 }, (_, index) => " ".repeat(index * 4) + "- k:").join("\n") + "\n" + " ".repeat(256) + (depth === 128 ? "null" : "[null]") },
  { name: "indentless sequence", input: (depth: number) => "k:\n- " + "[".repeat(depth - 2) + "null" + "]".repeat(depth - 2) },
];

for (const { name, input } of depthCases) {
  test(`parse depth admits the scalar boundary: ${name}`, async () => {
    const result = await run(["-o", "json", "-c", "."], input(128));
    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(result.stdout.length, 0);
  });
  test(`parse depth rejects before the over-depth child: ${name}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    let leafAdmissions = 0;
    const ledger = new class extends YqLedger {
      override admitScalar(bytes: number): void {
        if (bytes === 4) leafAdmissions++;
        super.admitScalar(bytes);
      }
    }();
    try {
      await assert.rejects(async () => {
        for await (const unused of parseYamlDocuments(input(129), session.ownedWork, ledger)) void unused;
      }, error => error instanceof YqError && error.code === "LIMIT_MAX_DEPTH");
      assert.equal(leafAdmissions, 0);
    } finally { await session.close(); }
  });
}

test("parse depth admits empty collections at the exact boundary", async () => {
  for (const leaf of ["[]", "{}"]) {
    const input = "[".repeat(127) + leaf + "]".repeat(127);
    assert.deepEqual(await run(["-o", "json", "-c", "."], input), { status: 0, stdout: `${input}\n`, stderr: "" });
  }
});

test("parse depth admits only 128 collection nodes and wins before deep malformed syntax", async () => {
  for (const leaf of ["", "!unsupported x"]) {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    const ledger = new YqLedger();
    try {
      await assert.rejects(async () => {
        for await (const unused of parseYamlDocuments("[".repeat(256) + leaf + "]".repeat(256), session.ownedWork, ledger)) void unused;
      }, error => error instanceof YqError && error.code === "LIMIT_MAX_DEPTH");
      assert.equal(ledger.documentNodes, 128);
    } finally { await session.close(); }
  }
});

test("parse depth releases sibling collections and resets between documents", async () => {
  const branch = "[".repeat(127) + "null" + "]".repeat(127);
  const document = `[${branch},${branch}]`;
  const result = await run(["-o", "json", "-c", "."], `${document}\n---\n${document}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${document}\n${document}\n`);
});

for (const reason of [false, null, 0]) test(`parse depth keeps caller cancellation primary: ${reason}`, async () => {
  const controller = new AbortController();
  const session = createYqQuerySession({ signal: controller.signal });
  const ledger = new class extends YqLedger {
    override admitNode(): void {
      super.admitNode();
      if (this.documentNodes === 128) controller.abort(reason);
    }
  }();
  try {
    await assert.rejects(async () => {
      for await (const unused of parseYamlDocuments("[".repeat(129) + "]".repeat(129), session.ownedWork, ledger)) void unused;
    }, error => Object.is(error, reason));
  } finally { await session.close(); }
});

test("parse depth retains final measurement of alias-expanded collection depth", async () => {
  for (const wrappers of [126, 127]) {
    const input = "a: &a []\nb: " + "[".repeat(wrappers) + "*a" + "]".repeat(wrappers);
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      let documents = 0;
      for await (const value of parseYamlDocuments(input, session.ownedWork, new YqLedger())) {
        documents++;
        if (wrappers === 126) await session.ownedWork.measure(value);
        else await assert.rejects(session.ownedWork.measure(value), error => error instanceof JqLimitError && error.message.includes("maxDepth"));
      }
      assert.equal(documents, 1);
    } finally { await session.close(); }
    const result = await run(["-o", "json", "-c", "."], input);
    assert.equal(result.status, wrappers === 126 ? 0 : 5, result.stderr);
    if (wrappers === 127) assert.match(result.stderr, /LIMIT_MAX_DEPTH/u);
  }
});

async function run(args: readonly string[], input = ""): Promise<{ status: number; stdout: string; stderr: string }> {
  const stdout = sink();
  const stderr = sink();
  const context: CommandContext = {
    command: "yq",
    args,
    stdin: toByteSource(input),
    stdout,
    stderr,
    cwd: "/",
    env: {},
    fs: createMemoryFileSystem(),
    signal: new AbortController().signal,
  };
  const result = await createYqCommand().execute(context);
  return { status: result.exitCode, stdout: text(stdout), stderr: text(stderr) };
}

async function executeWith(overrides: Partial<CommandContext>): Promise<{ readonly result: { exitCode: number }; readonly stdout: string; readonly stderr: string }> {
  const stdout = sink();
  const stderr = sink();
  const context: CommandContext = {
    command: "yq",
    args: [],
    stdin: toByteSource(""),
    stdout,
    stderr,
    cwd: "/",
    env: {},
    fs: createMemoryFileSystem(),
    signal: new AbortController().signal,
    ...overrides,
  };
  const result = await createYqCommand().execute(context);
  return { result, stdout: text(stdout), stderr: text(stderr) };
}

test("factories are frozen and reject unknown options", () => {
  const command = createYqCommand();
  const commands = createYqCommands();
  assert.equal(command.name, "yq");
  assert(Object.isFrozen(command));
  assert(Object.isFrozen(commands));
  assert.throws(() => yqCommands({ extra: true } as never), /unsupported yq option/u);
});

test("exact information forms avoid input", async () => {
  const version = await run(["--version"], "[");
  assert.deepEqual(version, { status: 0, stdout: "virtual-bash restricted YAML/TOML profile\n", stderr: "" });
  const help = await run(["e", "--help"], "[");
  assert.equal(help.status, 0);
  assert.equal(Buffer.byteLength(help.stdout), 613);
  assert.equal(createHash("sha256").update(help.stdout).digest("hex"), "4ef0b3fc3ef45fe9b87703dcc4d0a1161f8dc95383ce5ab50cf66890c9c3528d");
});

test("CLI admission and refusals use finite diagnostics", async () => {
  assert.match((await run(["--slurp", "."], "1\n")).stderr, /CLI_UNSUPPORTED_OPTION/u);
  assert.match((await run(["-c", "."], "1\n")).stderr, /CLI_INCOMPATIBLE_OPTIONS/u);
  assert.match((await run(["--", "--help"], "1\n")).stderr, /CLI_INFO_COMBINATION/u);
});

test("block and flow collections compose and encode", async () => {
  const block = await run([], "a: 1\nitems:\n  - red\n  - {ok: true}\n");
  assert.equal(block.status, 0, block.stderr);
  assert.equal(block.stdout, '"a": 1\n"items":\n  - "red"\n  - "ok": true\n');
  const flow = await run(["-o", "json", "-c", "."], "[one, {two: [3, null]},]\n");
  assert.deepEqual(flow, { status: 0, stdout: '["one",{"two":[3,null]}]\n', stderr: "" });
});

test("quoted and block scalar families", async () => {
  assert.equal((await run(["-o", "json", "-c", "."], "'can''t'\n")).stdout, '"can\'t"\n');
  assert.equal((await run(["-o", "json", "-c", "."], '"a\\n\\t\\x41\\u0042\\uD83D\\uDE42"\n')).stdout, '"a\\n\\tAB🙂"\n');
  assert.equal((await run(["-o", "json", "-c", "."], "|-\n  pine\n  oak\n")).stdout, '"pine\\noak"\n');
  assert.equal((await run(["-o", "json", "-c", "."], ">-\n  pine\n  oak\n")).stdout, '"pine oak"\n');
});

for (const quote of ["'", '"']) {
  for (const lineBreak of ["\n", "\r\n", "\r"]) {
    for (const [name, content, expected] of [
      ["paragraph", "first\n  second\n\n  paragraph", "first second\nparagraph"],
      ["multiple empty lines", "first\n\n\n  last", "first\n\nlast"],
      ["whitespace-only lines", "first \t\n \t\n   \n  last", "first\n\nlast"],
      ["more indentation", "first \t\n      second\n  last", "first second last"],
      ["literal inline whitespace", "  first \t second  ", "  first \t second  "],
      ["opening and closing breaks", "\n  first\n\n  last\n  ", " first\nlast "],
      ["only one break", "  \n \t", " "],
      ["only empty lines", "  \n \t\n\n  ", "\n\n"],
      ["only whitespace", " \t ", " \t "],
      ["non-ASCII content", "é😀\n  中\n\n  𠀀", "é😀 中\n𠀀"],
      ["non-YAML whitespace", "first\u00a0\n  \u00a0second\u2028\n  \u2029last", "first\u00a0 \u00a0second\u2028 \u2029last"],
    ] as const) {
      test(`quoted folding ${quote} ${JSON.stringify(lineBreak)}: ${name}`, async () => {
        const input = `text: ${quote}${content.split("\n").join(lineBreak)}${quote}${lineBreak}`;
        assert.deepEqual(await run(["-o", "json", "-c", "."], input), {
          status: 0, stdout: `${JSON.stringify({ text: expected })}\n`, stderr: "",
        });
      });
    }
  }
}

for (const lineBreak of ["\n", "\r\n", "\r"]) {
  for (const [name, content, expected] of [
    ["escaped continuation", "first\\\n  second", "firstsecond"],
    ["escaped continuation whitespace", "first \t\\\n  second", "first \tsecond"],
    ["escaped continuation empty line", "first\\\n \t\n  second", "first\nsecond"],
    ["escaped continuation empty lines", "first\\\n\n\n  second", "first\n\nsecond"],
    ["escaped continuation at close", "first\\\n \t\n  ", "first\n"],
    ["escaped whitespace next to folding", "first\\ \\t \t\n  \\ second", "first \t  second"],
    ["escaped content is not folded", "first\\n\\r\\t\n  second", "first\n\r\t second"],
    ["escaped slash before folding", "first\\\\\n\n  second", "first\\\nsecond"],
  ] as const) {
    test(`quoted folding double ${JSON.stringify(lineBreak)}: ${name}`, async () => {
      assert.deepEqual(await run(["-o", "json", "-c", "."], `"${content.split("\n").join(lineBreak)}"`), {
        status: 0, stdout: `${JSON.stringify(expected)}\n`, stderr: "",
      });
    });
  }
}

test("quoted folding preserves doubled single quotes and literal backslashes", async () => {
  assert.deepEqual(await run(["-o", "json", "-c", "."], "'can''t\\\n\n  stop''now'"), {
    status: 0, stdout: `${JSON.stringify("can't\\\nstop'now")}\n`, stderr: "",
  });
});

test("quoted folding preserves paragraphs through a VFS shell invocation", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input.yaml", new TextEncoder().encode('text: "first\n  second\n\n  paragraph"\n'));
  const shell = new Shell({ fs, cwd: "/work" }).use(yqCommands());
  try {
    const result = await shell.exec("yq -o json -c '.' input.yaml");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '{"text":"first second\\nparagraph"}\n');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("quoted folding projections match decoded UTF-8 bytes within each flow token", async context => {
  const input = '["first  \n  second\n\n  😀", \'can\'\'t\n\n  中\', "a \\\n\n  b", "\\n\\t\\ \n  z", " \n\n  ", "tail"]';
  const expected = ["first second\n😀", "can't\n中", "a \nb", "\n\t  z", "\n", "tail"];
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const ledger = new YqLedger();
  const admitScalar = ledger.admitScalar.bind(ledger);
  const projections: number[] = [];
  context.mock.method(ledger, "admitScalar", (bytes: number) => {
    projections.push(bytes);
    admitScalar(bytes);
  });
  try {
    const values = [];
    for await (const value of parseYamlDocuments(input, session.ownedWork, ledger)) values.push(value);
    assert.deepEqual(values, [expected]);
    assert.deepEqual(projections, expected.map(value => Buffer.byteLength(value)));
    assert.equal(ledger.documentNodes, expected.length + 1);
    assert.equal(ledger.documentValueBytes, Buffer.byteLength(JSON.stringify(expected)));
  } finally { await session.close(); }
});

for (const quote of ["'", '"']) test(`quoted folding ${quote} admission precedes decoded scalar construction`, async context => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const ledger = new YqLedger();
  const failure = new YqError("limit", "LIMIT_MAX_SCALAR_BYTES", 5);
  const admission = context.mock.method(ledger, "admitScalar", (bytes: number) => {
    assert.equal(bytes, Buffer.byteLength("😀\n中"));
    throw failure;
  });
  try {
    await assert.rejects(async () => {
      for await (const unused of parseYamlDocuments(`${quote}😀 \n\n  中${quote}`, session.ownedWork, ledger)) void unused;
    }, error => error === failure);
    assert.equal(admission.mock.callCount(), 1);
    assert.equal(ledger.documentNodes, 0);
    assert.equal(ledger.documentValueBytes, 0);
  } finally { await session.close(); }
});

test("directives and documents remain independent", async () => {
  const result = await run(["-o", "json", "-c", "."], "%YAML 1.2\n---\nready\n...\n---\n");
  assert.deepEqual(result, { status: 0, stdout: '"ready"\nnull\n', stderr: "" });
});

test("numeric normalization and tag family decisions", async () => {
  assert.equal((await run(["-o", "json", "-c", "."], "10e-1147483647\n")).stdout, "1E-1147483646\n");
  assert.equal((await run([], "!!float 7\n")).stdout, "7\n");
  assert.match((await run([], "!!int 7.0\n")).stderr, /SCHEMA_TAG_LEXEME_MISMATCH/u);
  assert.match((await run([], "0e1000000000\n")).stderr, /SCHEMA_DECIMAL_RANGE/u);
});

test("decoded keys and merge-like presentation rules", async () => {
  assert.match((await run([], "a: 1\n\"\\u0061\": 2\n")).stderr, /SCHEMA_DUPLICATE_KEY/u);
  assert.match((await run([], "<<: one\n")).stderr, /SCHEMA_PLAIN_MERGE_KEY/u);
  assert.equal((await run(["-o", "json", "-c", "."], "'<<': one\n")).stdout, '{"<<":"one"}\n');
});

test("anchor reuse uses active records and deep copies", async () => {
  const reuse = await run(["-o", "json", "-c", "."], "[&a old, *a, &a new, *a]\n");
  assert.equal(reuse.stdout, '["old","old","new","new"]\n', reuse.stderr);
  assert.match((await run([], "[&a old, &a [*a]]\n")).stderr, /ALIAS_CURRENT_NODE/u);
});

test("query compiles once and each document yields independently", async () => {
  const result = await run(["eval", "-o", "json", "-c", ".[]"], "[1,2]\n---\n[3]\n");
  assert.deepEqual(result, { status: 0, stdout: "1\n2\n3\n", stderr: "" });
  assert.match((await run(["$missing"], "poison")).stderr, /QUERY_COMPILE_FAILED/u);
});

test("production-specific implicit key grammar accepts only the flow witness", async () => {
  const accepted = await run(["-o", "json", "-c", "."], "{\"red\n  blue\": 1}\n");
  assert.equal(accepted.stdout, '{"red blue":1}\n', accepted.stderr);
  assert.match((await run([], "\"red\n  blue\": 1\n")).stderr, /INPUT_YAML_SYNTAX/u);
  assert.match((await run([], "[\"red\n  blue\": 1]\n")).stderr, /INPUT_YAML_SYNTAX/u);
});

test("quoted nb-json breadth and escape scalar validity stay distinct", async () => {
  const breadth = await run(["-o", "json", "-c", "."], `'\u007f\u0080\u009f\ufffe\uffff'\n`);
  assert.equal(breadth.status, 0, breadth.stderr);
  assert.equal(breadth.stdout, `"\u007f\u0080\u009f\ufffe\uffff"\n`);
  assert.equal((await run([], '"\\uD83D\\uDE80"\n')).stdout, '"🚀"\n');
  for (const invalid of ['"\\uD800"\n', '"\\uDC00"\n', '"\\uDE80\\uD83D"\n', '"\\U00110000"\n']) {
    assert.match((await run([], invalid)).stderr, /INPUT_YAML_SYNTAX/u);
  }
  const malformed = await executeWith({ stdin: toByteSource(Uint8Array.from([0x22, 0xed, 0xa0, 0x80, 0x22, 0x0a])) });
  assert.equal(malformed.result.exitCode, 5);
  assert.match(malformed.stderr, /INPUT_INVALID_UTF8/u);
});

for (const quote of ["", "'", '"']) test(`supplementary Unicode mapping values preserve ${quote || "plain"} scalars`, async () => {
  const value = "😀";
  assert.deepEqual(await run(["-o", "json", "-c", "."], `label: ${quote}${value}${quote}\n`), {
    status: 0, stdout: '{"label":"😀"}\n', stderr: "",
  });
});

test("supplementary Unicode in a VFS file survives shell yq invocation", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input.yaml", new TextEncoder().encode("label: 😀\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use(yqCommands());
  try {
    const result = await shell.exec("yq -o json -c '.' input.yaml");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '{"label":"😀"}\n');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("supplementary Unicode survives supported scalar and collection positions", async () => {
  for (const value of ["\u{10000}", "😀", "\u{20000}", "\u{10ffff}", "a😀é中𠀀z"]) {
    for (const [input, expected] of [
      [value, value],
      [`${value}: ok`, { [value]: "ok" }],
      [`- ${value}\n- next`, [value, "next"]],
      [`{${value}: ${value}, next: [${value}]}`, { [value]: value, next: [value] }],
      [`[${value}, '${value}', "${value}"]`, [value, value, value]],
      [`label: !!str ${value}`, { label: value }],
      [`label: |-\n  ${value}`, { label: value }],
      [`label: >-\n  ${value}`, { label: value }],
    ] as const) {
      assert.deepEqual(await run(["-o", "json", "-c", "."], input), {
        status: 0, stdout: `${JSON.stringify(expected)}\n`, stderr: "",
      }, input);
    }
  }
});

test("supplementary implicit keys retain the decoded code-point limit and duplicate detection", async () => {
  for (const quote of ["", "'", '"']) {
    const key = "😀".repeat(1024);
    assert.deepEqual(await run(["-o", "json", "-c", "."], `${quote}${key}${quote}: ok`), {
      status: 0, stdout: `${JSON.stringify({ [key]: "ok" })}\n`, stderr: "",
    });
    const rejected = await run(["-o", "json", "-c", "."], `${quote}${key}😀${quote}: ok`);
    assert.equal(rejected.status, 5);
    assert.equal(rejected.stdout, "");
    assert.ok(rejected.stderr.includes("INPUT_YAML_SYNTAX"), rejected.stderr);
  }
  const duplicate = await run(["-o", "json", "-c", "."], '😀: one\n"\\U0001f600": two');
  assert.equal(duplicate.status, 5);
  assert.equal(duplicate.stdout, "");
  assert.ok(duplicate.stderr.includes("SCHEMA_DUPLICATE_KEY"), duplicate.stderr);
});

test("supplementary Unicode does not hide invalid plain or quoted control characters", async () => {
  for (const quote of ["", "'", '"']) {
    const invalid = quote === "" ? [0, 1, 8, 11, 12, 31, 0x7f, 0x80, 0x9f, 0xfffe, 0xffff] : [0, 1, 8, 11, 12, 31];
    for (const point of invalid) {
      const input = `label: ${quote}😀${String.fromCodePoint(point)}z${quote}\n`;
      const result = await run(["-o", "json", "-c", "."], input);
      assert.deepEqual(result, {
        status: 5, stdout: "", stderr: `yq: input: INPUT_YAML_SYNTAX at <stdin>:1:${quote === "" ? 10 : 11}\n`,
      }, JSON.stringify(input));
    }
  }
});

test("lone surrogate input fails before document or scalar admission", async () => {
  for (const invalid of ["\ud800", "\udfff", "\udc00\ud800", "\ud800x", "x\udc00"]) {
    for (const quote of ["", "'", '"']) {
      const session = createYqQuerySession({ signal: new AbortController().signal });
      const ledger = new YqLedger();
      try {
        await assert.rejects(async () => {
          for await (const unused of parseYamlDocuments(`label: ${quote}${invalid}${quote}`, session.ownedWork, ledger)) void unused;
        }, { code: "INPUT_INVALID_UTF8", status: 5 });
        assert.equal(ledger.documents, 0);
        assert.equal(ledger.documentNodes, 0);
        assert.equal(ledger.documentValueBytes, 0);
      } finally { await session.close(); }
    }
  }
});

test("supplementary scalar projections admit exact decoded UTF-8 bytes in bounded flow tokens", async context => {
  const input = '[😀, "a😀", \'𠀀\', "\\uD83D\\uDE00", "\\U0010ffff", "😀\\n", \'😀\'\'z\']';
  const expected = ["😀", "a😀", "𠀀", "😀", "\u{10ffff}", "😀\n", "😀'z"];
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const ledger = new YqLedger();
  const admitScalar = ledger.admitScalar.bind(ledger);
  const projections: number[] = [];
  context.mock.method(ledger, "admitScalar", (bytes: number) => {
    projections.push(bytes);
    admitScalar(bytes);
  });
  try {
    const values = [];
    for await (const value of parseYamlDocuments(input, session.ownedWork, ledger)) values.push(value);
    assert.deepEqual(values, [expected]);
    assert.deepEqual(projections, expected.map(value => Buffer.byteLength(value)));
    assert.equal(ledger.documentNodes, expected.length + 1);
    assert.equal(ledger.documentValueBytes, Buffer.byteLength(JSON.stringify(expected)));
  } finally { await session.close(); }
});

for (const quote of ["", "'", '"']) test(`supplementary scalar admission failure precedes node composition: ${quote || "plain"}`, async context => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const ledger = new YqLedger();
  const failure = new YqError("limit", "LIMIT_MAX_SCALAR_BYTES", 5);
  const admission = context.mock.method(ledger, "admitScalar", (bytes: number) => {
    assert.equal(bytes, 4);
    throw failure;
  });
  try {
    await assert.rejects(async () => {
      for await (const unused of parseYamlDocuments(`${quote}😀${quote}`, session.ownedWork, ledger)) void unused;
    }, error => error === failure);
    assert.equal(admission.mock.callCount(), 1);
    assert.equal(ledger.documentNodes, 0);
    assert.equal(ledger.documentValueBytes, 0);
  } finally { await session.close(); }
});

for (const quote of ["", "'", '"']) test(`supplementary Unicode charges code points and retains bounded scanning: ${quote || "plain"}`, async context => {
  const scalar = "😀".repeat(257);
  const input = `${quote}${scalar}${quote}`;
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const charge = session.ownedWork.charge.bind(session.ownedWork);
  const charges: number[] = [];
  context.mock.method(session.ownedWork, "charge", async (units = 1) => {
    charges.push(units);
    await charge(units);
  });
  try {
    const values = [];
    for await (const value of parseYamlDocuments(input, session.ownedWork, new YqLedger())) values.push(value);
    assert.deepEqual(values, [scalar]);
    assert.deepEqual(charges, [256, 1 + quote.length * 2, 256, 256, 2 + quote.length * 2, 1, 256, 1, 2]);
  } finally { await session.close(); }
});

test("supplementary Unicode uses the shared step ceiling including checkpoint overhead", async () => {
  for (const available of [10, 9]) {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    const ledger = new YqLedger();
    try {
      await session.ownedWork.charge(999_024 - available);
      const parse = async () => {
        const values = [];
        for await (const value of parseYamlDocuments("😀😀", session.ownedWork, ledger)) values.push(value);
        return values;
      };
      if (available === 10) assert.deepEqual(await parse(), ["😀😀"]);
      else await assert.rejects(parse, error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
    } finally { await session.close(); }
  }
});

for (const quote of ["", "'", '"']) test(`supplementary validation cancellation stops before scalar admission: ${quote || "plain"}`, async context => {
  const controller = new AbortController();
  const session = createYqQuerySession({ signal: controller.signal });
  const charge = session.ownedWork.charge.bind(session.ownedWork);
  const charges: number[] = [];
  const ledger = new YqLedger();
  context.mock.method(session.ownedWork, "charge", async (units = 1) => {
    charges.push(units);
    await charge(units);
    controller.abort(false);
  });
  const admission = context.mock.method(ledger, "admitScalar");
  try {
    await assert.rejects(async () => {
      for await (const unused of parseYamlDocuments(`${quote}${"😀".repeat(257)}${quote}`, session.ownedWork, ledger)) void unused;
    }, error => error === false);
    assert.deepEqual(charges, [256]);
    assert.equal(admission.mock.callCount(), 0);
    assert.equal(ledger.documentNodes, 0);
    assert.equal(ledger.documentValueBytes, 0);
  } finally { await session.close(); }
});

test("document-prefix BOM, markers, and exact NUL encoding", async () => {
  const result = await run([], "\ufeff---\n\"x\ufeffy\"\n...\n\ufeff---\n\"\\0\"\n");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '"x﻿y"\n---\n"\\u0000"\n');
  assert.equal(Buffer.from((await run([], '"\\0"\n')).stdout).toString("hex"), "225c7530303030220a");
  assert.match((await run([], "[1,\ufeff2]\n")).stderr, /INPUT_DOCUMENT_STRUCTURE/u);
});

test("Core numeric spellings retain the restricted signed-base rule", async () => {
  const values = await run(["-o", "json", "-c", "."], "[+12, 012, 0o12, 0xA, +0xA, -0o7]\n");
  assert.equal(values.stdout, '[12,12,10,10,"+0xA","-0o7"]\n', values.stderr);
  assert.match((await run([], "9007199254740992\n")).stderr, /SCHEMA_UNSAFE_INTEGER/u);
  assert.match((await run([], "9007199254740991.9\n")).stderr, /SCHEMA_UNSAFE_INTEGER/u);
  assert.equal((await run([], "0e999999999\n")).stdout, "0E+999999999\n");
});

test("explicit tag allow-list and kind checks", async () => {
  assert.equal((await run(["-o", "json", "-c", "."], "!!str <<: one\n")).stdout, '{"<<":"one"}\n');
  assert.match((await run([], "!!merge '<<': one\n")).stderr, /SCHEMA_UNSUPPORTED_TAG/u);
  assert.match((await run([], "!!seq {}\n")).stderr, /SCHEMA_TAG_KIND_MISMATCH/u);
  assert.match((await run([], "!!bool yes\n")).stderr, /SCHEMA_TAG_LEXEME_MISMATCH/u);
});

test("anchor copies retain earlier values and namespaces reset per document", async () => {
  const copies = await run(["-o", "json", "-c", "."], "[&a [1], *a, &a [2], *a]\n");
  assert.equal(copies.stdout, '[[1],[1],[2],[2]]\n', copies.stderr);
  const crossDocument = await run([], "&a 1\n---\n*a\n");
  assert.equal(crossDocument.stdout, "1\n");
  assert.match(crossDocument.stderr, /ALIAS_UNDEFINED/u);
  assert.match((await run([], "[*later, &later 1]\n")).stderr, /ALIAS_FORWARD/u);
});

test("private query session rejects retry, overlap, and post-close use", async () => {
  const failed = createYqQuerySession({ signal: new AbortController().signal });
  assert.throws(() => failed.compileOnce("["));
  assert.throws(() => failed.compileOnce("."), /already attempted/u);
  await failed.close();
  const session = createYqQuerySession({ signal: new AbortController().signal });
  session.compileOnce(".");
  const first = session.run(null);
  assert.deepEqual(await first.next(), { value: null, done: false });
  const overlapping = session.run(null);
  await assert.rejects(overlapping.next(), /overlapping/u);
  const close = session.close();
  assert.equal(session.close(), close);
  await close;
  await assert.rejects(session.run(null).next(), /closed/u);
});

test("checkpoint await preserves falsy caller reason", async () => {
  for (const reason of [false, null] as const) {
    const controller = new AbortController();
    const session = createYqQuerySession({ signal: controller.signal });
    await session.ownedWork.charge(1023);
    queueMicrotask(() => controller.abort(reason));
    await assert.rejects(session.ownedWork.charge(1), failure => failure === reason);
    await session.close();
  }
});

test("prepaid reservation consumes threshold credit once and close expires idle credit", async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  await session.ownedWork.charge(1022);
  const first = session.ownedWork.reserve(1);
  await first.beforeUnit();
  first.finish();
  const second = session.ownedWork.reserve(1);
  await second.beforeUnit();
  second.finish();
  const idle = session.ownedWork.reserve(1);
  void idle;
  await session.close();
});

test("carried owned work reaches the exact one-Budget ceiling", async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  await session.ownedWork.charge(1023);
  await session.ownedWork.charge(998001);
  await assert.rejects(session.ownedWork.charge(1), /maxSteps/u);
  await session.close();
});

test("sink failures escape by identity even when shaped like a query limit", async () => {
  const failure = new JqLimitError("maxOutputBytes");
  const stdout: ByteSink = { async write() { throw failure; } };
  await assert.rejects(executeWith({ stdin: toByteSource("1\n"), stdout }), caught => caught === failure);
});

test("literal VFS order and repetitions use the configured filesystem", async () => {
  const filesystem = createMemoryFileSystem();
  await filesystem.mkdir("/v", { recursive: true });
  await filesystem.writeFile("/v/a", Buffer.from("1\n"));
  await filesystem.writeFile("/v/b", Buffer.from("2\n"));
  const result = await executeWith({
    args: ["-o", "json", "-c", ".", "/v/b", "-", "/v/a", "/v/b"],
    stdin: toByteSource("3\n"),
    fs: filesystem,
  });
  assert.deepEqual({ status: result.result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "2\n3\n1\n2\n", stderr: "" });
});

test("block chomping, indentation indicators, and folded indentation", async () => {
  const values = await run(["-o", "json", "-c", "."], "strip: |-\n  z\n\nclip: |\n  z\n\nkeep: |+\n  z\n\n");
  assert.equal(values.stdout, '{"strip":"z","clip":"z\\n","keep":"z\\n\\n"}\n', values.stderr);
  assert.equal((await run(["-o", "json", "-c", "."], "|\n  z")).stdout, '"z"\n');
  const folded = await run(["-o", "json", "-c", "."], ">-\n  red\n  blue\n\n  green\n    inset\n  gold\n");
  assert.equal(folded.stdout, '"red blue\\ngreen\\n  inset\\ngold"\n', folded.stderr);
  assert.equal((await run(["-o", "json", "-c", "."], "first: |2-\n  z\nsecond: |-2\n  z\n")).stdout, '{"first":"z","second":"z"}\n');
  assert.match((await run([], "|0\n  z\n")).stderr, /INPUT_YAML_SYNTAX/u);
});

test("indentless sequences and flow pairs follow their YAML productions", async () => {
  const indentless = await run(["-o", "json", "-c", "."], "items:\n- label: red\n  parts: [one, {two: three},]\n");
  assert.equal(indentless.stdout, '{"items":[{"label":"red","parts":["one",{"two":"three"}]}]}\n', indentless.stderr);
  const flow = await run(["-o", "json", "-c", "."], "[https://a/#b, red#blue, red: blue, {\"k\":v}]\n");
  assert.equal(flow.stdout, '["https://a/#b","red#blue",{"red":"blue"},{"k":"v"}]\n', flow.stderr);
});

test("empty tagged keys, duplicate properties, and anchor-name breadth", async () => {
  assert.equal((await run(["-o", "json", "-c", "."], "? !!str\n: red\n")).stdout, '{"":"red"}\n');
  assert.match((await run([], "&item &item red\n")).stderr, /INPUT_YAML_SYNTAX/u);
  assert.equal((await run(["-o", "json", "-c", "."], "[&a:b#c red, *a:b#c]\n")).stdout, '["red","red"]\n');
  assert.equal((await run(["-o", "json", "-c", "."], "{store: &text '<<', *text : 1}\n")).stdout, '{"store":"<<","<<":1}\n');
});

test("stream end markers permit empty and subsequent bare documents", async () => {
  assert.deepEqual(await run(["-o", "json", "-c", "."], "...\n...\n"), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(await run(["-o", "json", "-c", "."], "red\n...\nblue\n"), { status: 0, stdout: '"red"\n"blue"\n', stderr: "" });
});
