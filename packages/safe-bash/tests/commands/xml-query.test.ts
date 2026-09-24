import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../../src/index.js";
import { MockS3Client, S3FileSystem } from "@poe-code/safe-fs";
import { createXmlCommands, xmlCommands, type XmlQueryLimits } from "../../src/commands/xml/index.js";
import { createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";

for (const [name, xml, diagnostic] of [
  ["empty children", "<r>" + "<a/>".repeat(10_000) + "</r>", "resource limit"],
  ["depth", "<a>".repeat(65) + "</a>".repeat(65), "resource limit"],
  ["content", "<r>" + "<!--x-->".repeat(10_000) + "</r>", "content node limit"],
] as const) test(`xmllint --noout bounds default parsed ${name} independently of output`, async () => {
  const shell = new api.Shell({ fs: api.createMemoryFileSystem(), limits: api.cloudflareWorkerLimits })
    .use(xmlCommands({ limits: { maxOutputBytes: 1024 } }));
  try {
    const result = await shell.exec("xmllint --noout", { stdin: Buffer.from(xml) });
    assert.equal(result.exitCode, 5, result.stderr);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(diagnostic), result.stderr);
  } finally { await shell.dispose(); }
});

for (const [command, xml, expected] of [
  ["xq . /input", "<a>text</a>", '{\n  "a": "text"\n}\n'],
  ["xq -r '.root.item[]' /input", "<root><item>one</item><item>two</item></root>", "one\ntwo\n"],
  ["xq -c . /input", '<root id="7"><empty/><value>  hi &amp; bye </value>tail</root>', '{"root":{"@id":"7","empty":null,"value":"hi & bye","#text":"tail"}}\n'],
  ["xq -r --arg key a '.[$key]' /input", "<a>text</a>", "text\n"],
  ["xq -sc . /input /other", "<a>text</a>", '[{"a":"text"},{"b":null}]\n'],
  ["xq -c .", '<r xmlns:p="urn:p"><p:a p:id="1"><![CDATA[ hi ]]><!--ignore--></p:a></r>', '{"r":{"@xmlns:p":"urn:p","p:a":{"@p:id":"1","#text":"hi"}}}\n'],
  ["xq --null-input -c '42'", "<a/>", "42\n"],
  ["xq -cS .", '<r b="2" a="1"><i>3</i><i>4</i></r>', '{"r":{"@a":"1","@b":"2","i":["3","4"]}}\n'],
  ["xq -c .", '<r xmlns="urn:r"><a xmlns="">ok</a><b xmlns="urn:r"/></r>', '{"r":{"@xmlns":"urn:r","a":{"@xmlns":"","#text":"ok"},"b":{"@xmlns":"urn:r"}}}\n'],
  ["xq -c .", '<__proto__ constructor="safe"><__proto__>value</__proto__></__proto__>', '{"__proto__":{"@constructor":"safe","__proto__":"value"}}\n'],
  ["xq -r -f /filter /input", "<a>text</a>", "text\n"],
] as const) test(`xq applies jq filters to converted XML: ${command}`, async () => {
  const fs = api.createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from(xml));
  await fs.writeFile("/other", Buffer.from("<b/>"));
  await fs.writeFile("/filter", Buffer.from(".a"));
  const shell = new api.Shell({ fs }).use(api.agentCommands());
  try {
    const result = await shell.exec(command, { stdin: Buffer.from(xml) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const [command, xml, limits, status, diagnostic] of [
  ["xq .", "<a/>", { maxInputBytes: 3 }, 5, "maxInputBytes"],
  ["xq .", "<a><b/></a>", { maxNodes: 1 }, 5, "resource limit"],
  ["xq -r .a", "<a>long</a>", { maxOutputBytes: 2 }, 5, "maxOutputBytes"],
  ["xq .a", "<a/>", { maxSourceBytes: 1 }, 5, "maxSourceBytes"],
  ["xq '.r.i[]'", "<r><i>1</i><i>2</i></r>", { maxResults: 1 }, 5, "maxResults"],
  ["xq .", "<a><broken></a>", {}, 1, "mismatched"],
  ["xq .", "<!DOCTYPE a><a/>", {}, 1, "DTD"],
  ["xq -e .a", "<a/>", {}, 1, ""],
  ["xq '/a'", "<a/>", {}, 3, ""],
  ["xq --xml-output .", "<a/>", {}, 2, "unsupported option"],
  ["xq --null-input -c '42'", "not XML", {}, 1, "Invalid XML"],
] as const) test(`xq preserves bounded failures and jq statuses: ${command} ${JSON.stringify(limits)}`, async () => {
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands({ limits }));
  try {
    const result = await shell.exec(command, { stdin: Buffer.from(xml) });
    assert.equal(result.exitCode, status, result.stderr);
    if (diagnostic) assert.ok(result.stderr.includes(diagnostic), result.stderr);
  } finally { await shell.dispose(); }
});

test("xq preserves output failure identity instead of reporting an XML parse failure", async () => {
  const command = createXmlCommands().find(command => command.name === "xq")!;
  const failure = new SyntaxError("sink failed");
  await assert.rejects(Promise.resolve(command.execute({
    command: "xq", args: ["."], cwd: "/", env: {}, fs: api.createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource("<a/>"),
    stdout: { async write() { throw failure; } },
    stderr: { async write() { assert.fail("output failure must not become an XML diagnostic"); } },
  })), error => error === failure);
});

test("xq counts original XML bytes across files rather than JSON expansion", async () => {
  const fs = api.createMemoryFileSystem();
  await fs.writeFile("/a", Buffer.from("<a/>"));
  await fs.writeFile("/b", Buffer.from("<b/>"));
  const shell = new api.Shell({ fs }).use(xmlCommands({ limits: { maxInputBytes: 4 } }));
  try {
    const single = await shell.exec("xq -c . /a");
    assert.equal(single.exitCode, 0, single.stderr);
    assert.equal(single.stdout, '{"a":null}\n');
    const multiple = await shell.exec("xq -c . /a /b");
    assert.equal(multiple.exitCode, 5, multiple.stderr);
    assert.ok(multiple.stderr.includes("maxInputBytes"));
  } finally { await shell.dispose(); }
});

for (const operand of ["filter", "filename"] as const) test(`xq rejects lossy UTF-8 ${operand} before input reads`, async () => {
  const raw = shellValueFromBytes(Buffer.from(operand === "filter" ? '.["\xff"]' : "/\xff.xml", "latin1"));
  const carrier = createCommandArguments(operand === "filter" ? [raw] : [".", raw]);
  const command = createXmlCommands().find(command => command.name === "xq")!;
  let reads = 0;
  const result = await command.execute({
    command: "xq", args: carrier.args, argumentValues: carrier,
    cwd: "/", env: {}, fs: api.createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () { reads++; yield Buffer.from("<a/>"); })(),
    stdout: { async write() { assert.fail("invalid arguments must not emit output"); } },
    stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(reads, 0);
});

test("xq observes cancellation and closes its XML input", async () => {
  const controller = new AbortController();
  const reason = Object.freeze({ cancelled: "xq XML input" });
  let closed = false;
  const stdin = (async function* () {
    try { yield Buffer.from("<a>"); controller.abort(reason); yield Buffer.from("text</a>"); }
    finally { closed = true; }
  })();
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands());
  try {
    await assert.rejects(shell.exec("xq .", { stdin, signal: controller.signal }), error => error === reason);
    assert.equal(closed, true);
  } finally { await shell.dispose(); }
});

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
      const filtered = await shell.exec("xq -r .root.value /document.xml");
      assert.equal(filtered.exitCode, 0, filtered.stderr);
      assert.equal(filtered.stdout, "virtual\n");
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
      const result = await shell.exec(`xmllint --xpath '${source}'`, { stdin: new TextEncoder().encode(input) });
      assert.equal(result.exitCode, 5, result.stderr);
      assert.match(result.stderr, new RegExp(axis));
      if (axis === "maxOutputBytes") assert.ok(Buffer.byteLength(result.stdout) <= value);
    } finally { await shell.dispose(); }
  });
}

test("XML configuration is validated and captured before invocation", async () => {
  for (const value of [0, -1, 0.5, NaN]) assert.throws(() => createXmlCommands({ limits: { maxNodes: value } }), RangeError);
  assert.doesNotThrow(() => createXmlCommands({ limits: { maxDepth: 257 } }));
  assert.doesNotThrow(() => createXmlCommands({ limits: { maxNodes: Infinity } }));
  const limits: Partial<XmlQueryLimits> = { maxOutputBytes: 2 };
  const plugin = xmlCommands({ limits });
  Object.assign(limits, { maxOutputBytes: 1000 });
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(plugin);
  try {
    const result = await shell.exec("xmllint --xpath 'string(/r)'", { stdin: new TextEncoder().encode("<r>long</r>") });
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
    const result = await shell.exec("xmllint --xpath '/r'", { stdin });
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
    await assert.rejects(shell.exec("xmllint --xpath '/r'", { stdin, signal: controller.signal }), error => error === reason);
    assert.ok(reads < 5000, `producer exhausted after ${reads} reads`);
  } finally { clearTimeout(timer); await shell.dispose(); }
});

test("XML result limits apply after predicates select the result set", async () => {
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands({ limits: { maxResults: 1 } }));
  try {
    const result = await shell.exec("xmllint --xpath '/r/i[1]'", { stdin: new TextEncoder().encode("<r><i/><i/></r>") });
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
    const result = await shell.exec("xmllint --xpath '/r' /d");
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
    const result = await shell.exec("xmllint --xpath 'string(/r)' '\ufeffd'");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "bom\n");
  } finally { await shell.dispose(); }
});

test("XML serialization escapes decoded carriage returns while string values remain raw", async () => {
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands());
  try {
    for (const [query, expected] of [["/r", "<r>&#13;</r>\n"], ["/r/text()", "&#13;\n"], ["string(/r)", "\r\n"]]) {
      const result = await shell.exec(`xmllint --xpath '${query}'`, { stdin: new TextEncoder().encode("<r>&#13;</r>") });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally { await shell.dispose(); }
});

for (const [command, input, stdout] of [
  ["xmllint --xpath 'count(/root/value)'", "<root><value/><value/></root>", "2\n"],
  ["xmllint --xpath 'boolean(/root/missing)' -", "<root/>", "false\n"],
  ["xmllint --xpath 'string(/root)'", "<root>before<child>inside</child>after</root>", "beforeinsideafter\n"],
  ["xmllint --xpath '/root/value'", '<root><value a="&amp;">hello</value><value/></root>', '<value a="&amp;">hello</value>\n<value/>\n'],
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
  ["xmllint --xpath '/root/missing'", "<root/>", 11],
  ["xmllint --xpath '/root'", "<!DOCTYPE root><root/>", 1],
  ["xmllint --xpath '/root'", "<root><broken></root>", 1],
  ["xmllint --xpath '/root'", '<root a="&unknown;"/>', 1],
  ["xmllint --xpath '/'", "<root/>", 10],
  ["xmllint '/root'", "<root/>", 1],
  ["xmllint --xpath '/root' /one /two", "<root/>", 2],
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


for (const [flags, input, stdout] of [
  ["--noout", "<a/>", ""],
  ["--format", '<a x="é😀">é😀</a>', '<?xml version="1.0"?>\n<a x="&#xE9;&#x1F600;">&#xE9;&#x1F600;</a>\n'],
  ["--format", '<?xml version="1.0" encoding="utf-8"?><a>é</a>', '<?xml version="1.0" encoding="utf-8"?>\n<a>é</a>\n'],
  ["--format", '<a> <b/>after</a>', '<?xml version="1.0"?>\n<a><b/>after</a>\n'],
  ["--format", "<a><b/></a>", '<?xml version="1.0"?>\n<a>\n  <b/>\n</a>\n'],
  ["--c14n", "<a><b/></a>", "<a><b></b></a>"],
  ["--format --noout", "<a><b/></a>", ""],
  ["--format", "<a> </a>", '<?xml version="1.0"?>\n<a> </a>\n'],
  ["--format", '<a xml:space="preserve"><b/><c/></a>', '<?xml version="1.0"?>\n<a xml:space="preserve">\n  <b/>\n  <c/>\n</a>\n'],
  ["--format", '<a xml:space="preserve"> <b/> </a>', '<?xml version="1.0"?>\n<a xml:space="preserve"> <b/> </a>\n'],
  ["--format", '<a xmlns:z="urn:z" x="1" xmlns="urn:a" y="2"/>', '<?xml version="1.0"?>\n<a xmlns:z="urn:z" xmlns="urn:a" x="1" y="2"/>\n'],
  ["--format", "<a> \n <b/> \n</a>", '<?xml version="1.0"?>\n<a>\n  <b/>\n</a>\n'],
  ["--format", "<a>x<b/> </a>", '<?xml version="1.0"?>\n<a>x<b/> </a>\n'],
  ["--format --c14n", "<a> <b/> </a>", "<a><b></b></a>"],
  ["--c14n --format", "<a> <b/> </a>", "<a><b></b></a>"],
  ["--format", "<a>hi<b/>bye</a>", '<?xml version="1.0"?>\n<a>hi<b/>bye</a>\n'],
  ["--format", "<a><![CDATA[x]]><b/></a>", '<?xml version="1.0"?>\n<a><![CDATA[x]]><b/></a>\n'],
  ["--c14n", '<a z="&#9;&#10;&#13;&quot;" a="&amp;">&lt;&gt;&#13;<![CDATA[&]]></a>', '<a a="&amp;" z="&#x9;&#xA;&#xD;&quot;">&lt;&gt;&#xD;&amp;</a>'],
  ["--c14n", '<a xmlns="urn:a" xmlns:p="urn:p"><b xmlns="urn:a" xmlns:p="urn:p"/><c xmlns=""/></a>', '<a xmlns="urn:a" xmlns:p="urn:p"><b></b><c xmlns=""></c></a>'],
  ["--c14n", '<a xmlns:z="urn:z" xmlns:b="urn:b" z:a="1" b:z="2" c="3" b:a="4"/>', '<a xmlns:b="urn:b" xmlns:z="urn:z" c="3" b:a="4" b:z="2" z:a="1"></a>'],
  ["--c14n", '<a> \n <b/> \n</a>', '<a> \n <b></b> \n</a>'],
  ["--c14n", '<a xmlns=""/>', '<a></a>'],
  ["--c14n", '<?xml version="1.0"?><!--pre--><?go x?><a><!--inside--></a><!--post--><?after y?>', '<!--pre-->\n<?go x?>\n<a><!--inside--></a>\n<!--post-->\n<?after y?>'],
  ["--format", '<!--pre--><a><!--inside--><?go x?><b/></a><!--post-->', '<?xml version="1.0"?>\n<!--pre-->\n<a>\n  <!--inside-->\n  <?go x?>\n  <b/>\n</a>\n<!--post-->\n'],
] as const) {
  for (const file of [false, true]) test(`xmllint document mode ${flags} from ${file ? "VFS" : "stdin"}: ${input}`, async () => {
    const fs = api.createMemoryFileSystem();
    await fs.writeFile("/input", new TextEncoder().encode(input));
    const shell = new api.Shell({ fs }).use(api.agentCommands());
    try {
      const result = await shell.exec(`xmllint ${flags} ${file ? "/input" : "-"}`, { stdin: new TextEncoder().encode(input) });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

for (const mode of ["--noout", "--format", "--c14n"]) {
  test(`xmllint ${mode} preserves XML refusals and resource limits`, async () => {
    const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands({ limits: { maxDepth: 2, maxOutputBytes: 4 } }));
    try {
      for (const input of ["<a><b></a>", "<!DOCTYPE a><a/>", "<a>&external;</a>"]) {
        const result = await shell.exec(`xmllint ${mode} -`, { stdin: new TextEncoder().encode(input) });
        assert.equal(result.exitCode, 1, result.stderr);
        assert.equal(result.stdout, "");
      }
      const depth = await shell.exec(`xmllint ${mode} -`, { stdin: new TextEncoder().encode("<a><b><c/></b></a>") });
      assert.equal(depth.exitCode, 5, depth.stderr);
      const output = await shell.exec(`xmllint ${mode} -`, { stdin: new TextEncoder().encode("<a/>") });
      assert.equal(output.exitCode, mode === "--noout" ? 0 : 5, output.stderr);
      assert.ok(Buffer.byteLength(output.stdout) <= 4);
    } finally { await shell.dispose(); }
  });
}

test("xmllint canonicalization rejects relative namespace URIs", async () => {
  const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands());
  try {
    for (const input of ['<a xmlns:p="relative"/>', '<!--pre--><a><b xmlns:p="relative"/></a>']) {
      const result = await shell.exec("xmllint --c14n -", { stdin: new TextEncoder().encode(input) });
      assert.equal(result.exitCode, 6, result.stderr);
      assert.equal(result.stdout, "");
    }
  } finally { await shell.dispose(); }
});


for (const mode of ["--noout", "--format", "--c14n"]) {
  test(`xmllint ${mode} yields to cancellation and closes input`, async () => {
    let closed = false;
    const stdin = { async *[Symbol.asyncIterator]() {
      try { while (true) yield new Uint8Array(); }
      finally { closed = true; }
    } };
    const controller = new AbortController();
    const reason = Object.freeze({ cancelled: mode });
    const shell = new api.Shell({ fs: api.createMemoryFileSystem() }).use(xmlCommands());
    const timer = setTimeout(() => controller.abort(reason), 0);
    try {
      await assert.rejects(shell.exec(`xmllint ${mode} -`, { stdin, signal: controller.signal }), error => error === reason);
      assert.equal(closed, true);
    } finally { clearTimeout(timer); await shell.dispose(); }
  });
}

test("xmllint document arguments fail before consuming input and admit literal filenames", async () => {
  let reads = 0;
  const stdin = { async *[Symbol.asyncIterator]() { reads++; yield new TextEncoder().encode("<a/>"); } };
  const fs = api.createMemoryFileSystem();
  await fs.writeFile("/--input", new TextEncoder().encode("<a/>"));
  const shell = new api.Shell({ fs }).use(xmlCommands());
  try {
    for (const command of ["xmllint --format --huge -", "xmllint --noout /one /two", "xmllint --c14n --schema /schema -"]) {
      const result = await shell.exec(command, { stdin });
      assert.equal(result.exitCode, 2, result.stderr);
    }
    assert.equal(reads, 0);
    const result = await shell.exec("xmllint --noout -- --input");
    assert.equal(result.exitCode, 0, result.stderr);
  } finally { await shell.dispose(); }
});
