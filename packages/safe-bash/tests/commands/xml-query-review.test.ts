import assert from "node:assert/strict";
import test from "node:test";
import { createXmlCommands, type XmlQueryLimits } from "../../src/commands/xml/index.js";
import { createCommandArguments, toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

async function query(source: string, xml: string, limits: Partial<XmlQueryLimits> = {}, signal = new AbortController().signal, afterInput?: () => void) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const command = createXmlCommands({ limits }).find(candidate => candidate.name === "xq")!;
  const result = await command.execute({
    command: "xq", args: [source], stdin: afterInput ? (async function* () {
      yield Buffer.from(xml);
      afterInput();
    })() : toByteSource(xml),
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal,
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

const nested = '<r><g><g><i id="early"/><i id="other" a=""/></g><i id="late"/></g><g><i id="last" a="x"/></g></r>';
for (const [source, expected] of [
  ["//i[1]", '<i id="early"/>\n<i id="late"/>\n<i id="last" a="x"/>\n'],
  ["//g/i", '<i id="early"/>\n<i id="other" a=""/>\n<i id="late"/>\n<i id="last" a="x"/>\n'],
  ["count(//*//*)", "7\n"],
  ["string(//g/i/@id)", "early\n"],
  ["//i[@a='']", '<i id="other" a=""/>\n'],
] as const) test(`XPath grouping, order and identity: ${source}`, async () => {
  const result = await query(source, nested);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

test("sequential predicates preserve their order within each parent", async () => {
  const xml = '<r><g><i a="skip"/><i a="keep"/></g><g><i a="keep"/><i a="keep"/></g></r>';
  assert.equal((await query("count(//i[1][@a='keep'])", xml)).stdout, "1\n");
  assert.equal((await query("count(//i[@a='keep'][1])", xml)).stdout, "2\n");
});

test("unprefixed names and attributes do not silently acquire a document namespace", async () => {
  const xml = '<r xmlns="urn:r" xmlns:p="urn:p" a="v"><p:i p:a="z"/><i/><i xmlns=""/></r>';
  assert.equal((await query("count(//i)", xml)).stdout, "1\n");
  assert.equal((await query("count(/*/*)", xml)).stdout, "3\n");
  assert.equal((await query("count(/*/@*)", xml)).stdout, "1\n");
  assert.equal((await query("/*/@a", xml)).stdout, ' a="v"\n');
  const prefixed = await query("/*/p:i", xml);
  assert.equal(prefixed.exitCode, 10);
  assert.equal(prefixed.stdout, "");
});

test("mixed content retains descendant order and direct text boundaries", async () => {
  const xml = "<r>one&amp;<b>two<c>three</c>four</b>five</r>";
  assert.equal((await query("string(/r)", xml)).stdout, "one&twothreefourfive\n");
  assert.equal((await query("/r/text()", xml)).stdout, "one&amp;\nfive\n");
  assert.equal((await query("string(/r)", "<r>one<![CDATA[<two>]]><b>three</b>four</r>")).stdout, "one<two>threefour\n");
});

test("element serialization preserves comments and processing instructions in place", async () => {
  const xml = "<r>A<!--note--><?go \u00a0ok?><b>B</b>C</r>";
  const result = await query("/r", xml);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, xml + "\n");
  assert.equal((await query("string(/r)", xml)).stdout, "ABC\n");
});

test("empty node sets differ from successful empty scalar conversions", async () => {
  const missing = await query("/r/missing", "<r/>");
  assert.equal(missing.exitCode, 11);
  assert.equal(missing.stdout, "");
  for (const [source, expected] of [["string(/r/missing)", "\n"], ["count(/r/missing)", "0\n"], ["boolean(/r/missing)", "false\n"]]) {
    const result = await query(source!, "<r/>");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

for (const [name, xml, limits] of [
  ["depth", "<r><a><b><c/></b></a></r>", { maxDepth: 3 }],
  ["nodes", "<r><a/><b/><c/></r>", { maxNodes: 3 }],
  ["aggregate attributes", '<r><a x="1"/><b y="2"/><c z="3"/></r>', { maxAttributes: 2 }],
  ["attributes per element", '<r a="1" b="2" c="3"/>', { maxAttributesPerElement: 2 }],
  ["namespaces", '<r xmlns:a="urn:a" xmlns:b="urn:b"/>', { maxNamespaces: 1 }],
] as const) test(`XML ${name} cap is independent of the input-byte limit`, async () => {
  const baseline = await query("count(//*)", xml);
  assert.equal(baseline.exitCode, 0, baseline.stderr);
  const result = await query("count(//*)", xml, { maxInputBytes: 65536, ...limits });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.length > 0);
  assert.equal((await query("count(//*)", "<r/>" )).stdout, "1\n");
});

for (const reason of [false, Object.freeze({ cancelled: "parser checkpoint" })]) test(`long single-token parsing observes live ${typeof reason} cancellation`, async () => {
  const controller = new AbortController();
  let checkpoints = 0;
  await assert.rejects(query("string(/r)", "<r>" + "x".repeat(65536) + "</r>", {}, controller.signal, () => {
    registerYieldCheckpoint(controller.signal, () => { checkpoints++; controller.abort(reason); });
  }), error => error === reason);
  assert.ok(checkpoints > 0);
  assert.equal((await query("string(/r)", "<r>healthy</r>")).stdout, "healthy\n");
});

test("output backpressure failure retains false identity and stops further writes", async () => {
  let writes = 0;
  const context: CommandContext = {
    command: "xq", args: ["//i"], stdin: toByteSource("<r><i/><i/><i/></r>"),
    stdout: { async write() { writes++; throw false; } },
    stderr: { async write() { assert.fail("sink failure must not become an XML diagnostic"); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
  };
  await assert.rejects(Promise.resolve(createXmlCommands().find(command => command.name === "xq")!.execute(context)), error => error === false);
  assert.equal(writes, 1);
});

for (const operand of ["query", "filename"] as const) test(`invalid UTF-8 ${operand} bytes cannot alias a replacement-character operand`, async () => {
  const fs = createMemoryFileSystem();
  const filename = operand === "filename" ? "/\ufffd.xml" : "/document.xml";
  await fs.writeFile(filename, Buffer.from('<r a="\ufffd">private</r>'));
  const raw = shellValueFromBytes(Buffer.from(operand === "query" ? '/r[@a="\xff"]' : "/\xff.xml", "latin1"));
  const carrier = createCommandArguments(operand === "query" ? [raw, filename] : ["/r", raw]);
  let reads = 0;
  const observed = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      if (property === "readFile" || property === "readStream") reads++;
      return Reflect.apply(value, target, args);
    };
  } });
  const output: Uint8Array[] = [];
  const context: CommandContext = {
    command: "xq", args: carrier.args, argumentValues: carrier, stdin: toByteSource(""),
    stdout: { async write(chunk) { output.push(new Uint8Array(chunk)); } }, stderr: { async write() {} },
    cwd: "/", env: {}, fs: observed, signal: new AbortController().signal,
  };
  const command = createXmlCommands().find(command => command.name === "xq")!;
  const literalReplacementArguments = createCommandArguments(carrier.args);
  assert.equal((await command.execute({ ...context, args: literalReplacementArguments.args, argumentValues: literalReplacementArguments })).exitCode, 0);
  assert.ok(Buffer.concat(output).toString().includes("private"));
  reads = 0;
  output.length = 0;
  const result = await command.execute(context);
  assert.notEqual(result.exitCode, 0);
  assert.equal(reads, 0);
  assert.equal(output.length, 0);
});

for (const declaration of [
  '<?xml version="1.0" encoding="UTF-16"?>',
  '<?xml version="1.0" encoding="ISO-8859-1"?>',
  '<?xml version\u00a0="1.0"?>',
]) test(`UTF-8 XML command refuses incompatible or malformed declaration ${JSON.stringify(declaration)}`, async () => {
  const result = await query("string(/r)", declaration + "<r>visible</r>");
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.length > 0);
});
