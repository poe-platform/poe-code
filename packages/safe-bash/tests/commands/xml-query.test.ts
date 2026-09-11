import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../../src/index.js";
import { MockS3Client, S3FileSystem } from "poe-code/safe-fs";
import { createXmlCommands, xmlCommands, type XmlQueryLimits } from "../../src/commands/xml/index.js";

test("XML querying exposes an explicit command family", () => {
  assert.equal(Object.hasOwn(api, "xmlCommands"), true);
  assert.equal(Object.hasOwn(api, "createXmlCommands"), true);
});

for (const backend of ["memory", "s3"] as const) {
  test(`XML querying reads only the supplied ${backend} filesystem`, async () => {
    const fs = backend === "memory" ? api.createMemoryFileSystem()
      : new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
    await fs.writeFile("/document.xml", new TextEncoder().encode("<root><value>virtual</value></root>"));
    const shell = new api.Shell({ fs }).use(api.agentCommands());
    try {
      const result = await shell.exec("xmllint --xpath 'string(/root/value)' /document.xml");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "virtual\n");
    } finally { await shell.dispose(); }
  });
}

for (const [axis, value, source, input] of [
  ["maxSourceBytes", 3, "/root", "<root/>"],
  ["maxInputBytes", 3, "/r", "<r/>"],
  ["maxOutputBytes", 2, "string(/r)", "<r>long</r>"],
  ["maxResults", 1, "/r/i", "<r><i/><i/></r>"],
  ["maxSteps", 3, "/r", "<r/>"],
] as const) {
  test(`XML independently enforces ${axis}`, async () => {
    const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands({ limits: { [axis]: value } }));
    try {
      const result = await shell.exec(`xq '${source}'`, { stdin: new TextEncoder().encode(input) });
      assert.equal(result.exitCode, 5, result.stderr);
      assert.match(result.stderr, new RegExp(axis));
      if (axis === "maxOutputBytes") assert.ok(Buffer.byteLength(result.stdout) <= value);
    } finally { await shell.dispose(); }
  });
}

test("XML configuration is validated and captured before invocation", async () => {
  for (const value of [0, -1, 0.5, NaN, Infinity]) assert.throws(() => createXmlCommands({ limits: { maxNodes: value } }), RangeError);
  assert.throws(() => createXmlCommands({ limits: { maxDepth: 257 } }), RangeError);
  const limits: Partial<XmlQueryLimits> = { maxOutputBytes: 2 };
  const plugin = xmlCommands({ limits });
  Object.assign(limits, { maxOutputBytes: 1000 });
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(plugin);
  try {
    const result = await shell.exec("xq 'string(/r)'", { stdin: new TextEncoder().encode("<r>long</r>") });
    assert.equal(result.exitCode, 5);
  } finally { await shell.dispose(); }
});

test("XML command replacement preflights the whole family", async () => {
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() });
  shell.commands.register({ name: "xmllint", execute: async () => ({ exitCode: 0 }) });
  assert.throws(() => xmlCommands().setup(shell), /already registered/u);
  assert.equal(shell.commands.has("xq"), false);
  await xmlCommands({ replace: true }).setup(shell);
  assert.equal(shell.commands.has("xq"), true);
  await shell.dispose();
});

test("XML charges empty input chunks before exhausting a finite producer", async () => {
  let reads = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 64; index++) { reads++; yield new Uint8Array(); }
  } };
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands({ limits: { maxSteps: 8 } }));
  try {
    const result = await shell.exec("xq '/r'", { stdin });
    assert.equal(result.exitCode, 5, result.stderr);
    assert.ok(reads < 64, `producer exhausted after ${reads} reads`);
  } finally { await shell.dispose(); }
});

test("XML empty-chunk input yields to timer cancellation", async () => {
  let reads = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 5000; index++) { reads++; yield new Uint8Array(); }
  } };
  const controller = new AbortController();
  const reason = Object.freeze({ cancelled: "empty-chunk input" });
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands());
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(shell.exec("xq '/r'", { stdin, signal: controller.signal }), error => error === reason);
    assert.ok(reads < 5000, `producer exhausted after ${reads} reads`);
  } finally { clearTimeout(timer); await shell.dispose(); }
});

test("XML result limits apply after predicates select the result set", async () => {
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands({ limits: { maxResults: 1 } }));
  try {
    const result = await shell.exec("xq '/r/i[1]'", { stdin: new TextEncoder().encode("<r><i/><i/></r>") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "<i/>\n");
  } finally { await shell.dispose(); }
});

test("XML buffered VFS admission reports the configured input limit", async () => {
  const backing = api.createMemoryFileSystem();
  await backing.writeFile("/d", new TextEncoder().encode("<r/>"));
  const fs = new Proxy(backing, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, streamingRead: false };
    if (key === "capabilitiesFor") return undefined;
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new api.Shell({ fs }).use(xmlCommands({ limits: { maxInputBytes: 3 } }));
  try {
    const result = await shell.exec("xq '/r' /d");
    assert.equal(result.exitCode, 5, result.stderr);
    assert.match(result.stderr, /maxInputBytes/u);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

test("XML retains a leading BOM in a filename as part of its identity", async () => {
  const fs = api.createMemoryFileSystem();
  await fs.writeFile("/\ufeffd", new TextEncoder().encode("<r>bom</r>"));
  await fs.writeFile("/d", new TextEncoder().encode("<r>wrong</r>"));
  const shell = new api.Shell({ fs }).use(xmlCommands());
  try {
    const result = await shell.exec("xq 'string(/r)' '\ufeffd'");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "bom\n");
  } finally { await shell.dispose(); }
});

test("XML serialization escapes decoded carriage returns while string values remain raw", async () => {
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands());
  try {
    for (const [query, expected] of [["/r", "<r>&#13;</r>\n"], ["/r/text()", "&#13;\n"], ["string(/r)", "\r\n"]]) {
      const result = await shell.exec(`xq '${query}'`, { stdin: new TextEncoder().encode("<r>&#13;</r>") });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally { await shell.dispose(); }
});

for (const [command, input, stdout] of [
  ["xq 'count(/root/value)'", "<root><value/><value/></root>", "2\n"],
  ["xmllint --xpath 'boolean(/root/missing)' -", "<root/>", "false\n"],
  ["xq 'string(/root)'", "<root>before<child>inside</child>after</root>", "beforeinsideafter\n"],
  ["xq '/root/value'", '<root><value a="&amp;">hello</value><value/></root>', '<value a="&amp;">hello</value>\n<value/>\n'],
] as const) {
  test(`XML stdin query: ${command}`, async () => {
    const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(api.agentCommands());
    try {
      const result = await shell.exec(command, { stdin: new TextEncoder().encode(input) });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, stdout);
    } finally { await shell.dispose(); }
  });
}

for (const [command, input, status] of [
  ["xq '/root/missing'", "<root/>", 11],
  ["xq '/root'", "<!DOCTYPE root><root/>", 1],
  ["xq '/root'", "<root><broken></root>", 1],
  ["xq '/root'", '<root a="&unknown;"/>', 1],
  ["xq '/root | /other'", "<root/>", 10],
  ["xq '/'", "<root/>", 10],
  ["xmllint '/root'", "<root/>", 2],
  ["xq '/root' /one /two", "<root/>", 2],
] as const) {
  test(`XML refuses unsupported input: ${command}: ${input}`, async () => {
    const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(api.agentCommands());
    try {
      const result = await shell.exec(command, { stdin: new TextEncoder().encode(input) });
      assert.equal(result.exitCode, status, result.stderr);
      assert.equal(result.stdout, "");
      assert.notEqual(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}
