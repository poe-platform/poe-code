import assert from "node:assert/strict";
import test from "node:test";
import type {FilterRequest} from "@poe-code/pandoc";
import {Shell} from "../../src/shell/index.js";
import {MemoryFileSystem} from "../../src/fs/memory/index.js";
import {FsError} from "../../src/contracts/index.js";
import {agentCommands} from "../../src/plugins/index.js";
import {createPandocCommand, createPandocCommands, pandocCommands} from "../../src/commands/pandoc/index.js";

import {fixture} from "./pandoc-fixture.js";
test("pandoc forwards explicitly supplied filters through actual Shell execution", async () => {
  const {shell, volume} = fixture();
  const requests: FilterRequest[] = [];
  shell.use(pandocCommands({replace: true, filters: {async apply(document, request, context) {
    requests.push(request);
    assert.equal(context.to, "html");
    return {...document, blocks: [{t: "Para", c: [{t: "Str", c: "FILTERED"}]}]};
  }}}));
  try {
    const result = await shell.exec("pandoc -fcommonmark -thtml -Ffirst.py --lua-filter=second.lua -C b.md -oout");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(requests, [{kind: "json", path: "first.py"}, {kind: "lua", path: "second.lua"}, {kind: "citeproc"}]);
    assert.equal(volume.readFileSync("/work/out", "utf8"), "<p>FILTERED</p>\n");
  } finally {await shell.dispose();}
});

test("pandoc filter failure leaves the existing output unchanged", async () => {
  const {shell, volume} = fixture();
  shell.use(pandocCommands({replace: true, filters: {async apply() {throw new Error("Filter failed");}}}));
  try {
    const result = await shell.exec("pandoc -fcommonmark -thtml -Fbroken.py b.md -oout");
    assert.equal(result.exitCode, 9, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
  } finally {await shell.dispose();}
});

test("pandoc accepts native aliases, attached values and bare metadata through Shell", async () => {
  const {shell, volume} = fixture();
  try {
    for (const args of ["-r commonmark -w html", "--read=commonmark --write=html", "-fcommonmark -thtml", "-rcommonmark -whtml"]) {
      const result = await shell.exec(`pandoc ${args} b.md`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "<p>Beta</p>\n");
    }
    const result = await shell.exec("pandoc -fcommonmark -tjson -M draft --metadata=review -Mempty= b.md");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).meta, {draft: {t: "MetaBool", c: true}, review: {t: "MetaBool", c: true}, empty: {t: "MetaString", c: ""}});
    const output = await shell.exec("pandoc -fcommonmark -tplain b.md -oout");
    assert.equal(output.exitCode, 0, output.stderr);
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Beta\n");
    assert.equal((await shell.exec("pandoc -v")).stdout, (await shell.exec("pandoc --version")).stdout);
    const alias = await shell.exec("pandoc -fcommonmark -tplain b.md -ob.md");
    assert.equal(alias.exitCode, 9, alias.stderr);
    assert.equal(volume.readFileSync("/work/b.md", "utf8"), "Beta");
  } finally {await shell.dispose();}
});
test("pandoc opt-in registration preflights collisions and supports replacement", async () => {
  const shell = new Shell({fs: new MemoryFileSystem()}).use(agentCommands());
  try {
    assert.equal(shell.commands.has("pandoc"), false);
    assert.equal(createPandocCommand().name, "pandoc");
    assert.deepEqual(createPandocCommands().map(command => command.name), ["pandoc"]);
    shell.use(pandocCommands());
    await shell.exec("pandoc --version");
    await assert.rejects(async () => pandocCommands().setup(shell), /already registered/);
    shell.use(pandocCommands({replace: true}));
    assert.equal((await shell.exec("pandoc --version")).exitCode, 0);
  } finally {await shell.dispose();}
});
test("pandoc uses literal quoted operands, ordered stdin, -- names, pipes and redirection", async () => {
  const {shell, volume} = fixture();
  try {
    const result = await shell.exec("printf 'Middle' | pandoc -f commonmark -t plain 'a b.md' - b.md");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "Alpha\n\nMiddle\n\nBeta\n");
    const redirected = await shell.exec("pandoc -f commonmark -t plain -- -name.md > rendered");
    assert.equal(redirected.exitCode, 0, redirected.stderr);
    assert.equal(volume.readFileSync("/work/rendered", "utf8"), "Dash\n");
    volume.writeFileSync("/work/--help", "Literal help filename");
    const literal = await shell.exec("pandoc -f commonmark -t plain -- --help");
    assert.equal(literal.exitCode, 0, literal.stderr);
    assert.equal(literal.stdout, "Literal help filename\n");
  } finally {await shell.dispose();}
});
test("pandoc help/version/invalid arguments never acquire input or publish -o", async () => {
  const {shell, volume} = fixture();
  try {
    for (const command of ["pandoc --help", "pandoc --version", "pandoc --list-output-formats", "pandoc --help -o out", "pandoc -f commonmark -t plain - - -o out", "pandoc --pdf-engine tex -o out"])
      await shell.exec(command, {stdin: {async *[Symbol.asyncIterator]() {assert.fail("input acquired"); yield new Uint8Array();}}});
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
  } finally {await shell.dispose();}
});
test("pandoc refuses lexical, hardlink and symlink output aliases", async () => {
  const {shell, volume} = fixture();
  volume.linkSync("/work/b.md", "/work/hard");
  volume.symlinkSync("/work/b.md", "/work/link");
  try {
    for (const output of ["b.md", "../work/b.md", "hard", "link"]) {
      const result = await shell.exec(`pandoc -f commonmark -t plain b.md -o ${output}`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.readFileSync("/work/b.md", "utf8"), "Beta");
    }
  } finally {await shell.dispose();}
});
test("pandoc refuses redirected output aliases after shell redirection has occurred", async () => {
  const {shell, volume} = fixture();
  try {
    const result = await shell.exec("pandoc -f commonmark -t plain b.md > b.md");
    assert.equal(result.exitCode, 9, result.stderr);
    // Shell owns redirection and has already truncated the destination.
    assert.equal(volume.readFileSync("/work/b.md", "utf8"), "");
  } finally {await shell.dispose();}
});
test("pandoc binary EPUB/PDF stdout equals command -o bytes", async () => {
  const {shell, volume} = fixture();
  try {
    for (const format of ["epub", "pdf"]) {
      const args = `pandoc -f commonmark -t ${format} -M title=Book -M lang=en -M identifier=id b.md`;
      const result = await shell.exec(`${args} -o -`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(Buffer.from(result.stdoutBytes).subarray(0, format === "pdf" ? 5 : 2).toString(), format === "pdf" ? "%PDF-" : "PK");
      const file = await shell.exec(`${args} -o 'binary ${format}'`);
      assert.equal(file.exitCode, 0, file.stderr);
      assert.deepEqual(new Uint8Array(volume.readFileSync(`/work/binary ${format}`) as Buffer), result.stdoutBytes);
    }
  } finally {await shell.dispose();}
});
test("pandoc retains RTF bytes for its codepage decoder", async () => {
  const {shell} = fixture();
  try {
    const result = await shell.exec("pandoc -f rtf -t plain", {stdin: Buffer.concat([Buffer.from("{\\rtf1\\ansi\\ansicpg1252 "), Buffer.from([0x80]), Buffer.from("}")])});
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "€\n");
  } finally {await shell.dispose();}
});
test("pandoc media search and extraction use the same memfs VFS", async () => {
  const {shell, volume} = fixture();
  volume.mkdirSync("/work/assets");
  volume.writeFileSync("/work/assets/p.png", new Uint8Array([137, 80, 78, 71]));
  volume.writeFileSync("/work/image.md", "![picture](p.png)");
  try {
    const result = await shell.exec("pandoc -f commonmark -t html --resource-path assets --extract-media media image.md");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /src="\/work\/media\/p.png"/);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/media/p.png") as Buffer), new Uint8Array([137, 80, 78, 71]));
  } finally {await shell.dispose();}
});
test("pandoc resource reads cannot bypass the shared input byte budget", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/image.md", "![picture](p.png)");
  volume.writeFileSync("/work/p.png", new Uint8Array(100));
  try {
    const result = await shell.exec("pandoc -f commonmark -t html --extract-media media image.md", {limits: {maxInputBytes: 64}}).catch(() => undefined);
    assert.ok(result === undefined || result.exitCode !== 0);
    assert.equal(volume.existsSync("/work/media/p.png"), false);
  } finally {await shell.dispose();}
});
test("pandoc preserves broken-pipe status when its stdout consumer closes", async () => {
  const {shell} = fixture();
  const consumer = new AbortController();
  const write = async () => {
    const reason = new FsError("EPIPE");
    consumer.abort(reason);
    throw reason;
  };
  try {
    const result = await shell.exec("pandoc -f commonmark -t plain b.md", {
      stdout: {write, ownedOutput: {consumerClosed: consumer.signal, write}}
    });
    assert.equal(result.exitCode, 141, result.stderr);
  } finally {await shell.dispose();}
});
test("pandoc preserves consumer closure while the SDK acquires input", async () => {
  const {fs, shell: initial} = fixture();
  const consumer = new AbortController();
  const shell = new Shell({cwd: "/work", fs: new Proxy(fs, {get(target, key) {
    if (key === "readFile") return async () => {
      consumer.abort(new FsError("EPIPE"));
      return new TextEncoder().encode("Beta");
    };
    return Reflect.get(target, key);
  }})}).use(pandocCommands());
  const write = async () => {assert.fail("closed consumer received output");};
  try {
    const result = await shell.exec("pandoc -f commonmark -t plain b.md", {
      stdout: {write, ownedOutput: {consumerClosed: consumer.signal, write}}
    });
    assert.equal(result.exitCode, 141, result.stderr);
  } finally {await shell.dispose(); await initial.dispose();}
});

test("pandoc local defaults, templates, variables and includes use the configured filesystem", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/settings.yaml", "from: commonmark\nto: html\ntemplate: page.html\nvariables:\n  label: Audit\ninclude-before-body: [before.html]\ninclude-after-body: [after.html]\n");
  volume.writeFileSync("/work/page.html", "$label$\n$body$");
  volume.writeFileSync("/work/before.html", "<p>Before</p>\n");
  volume.writeFileSync("/work/after.html", "<p>After</p>\n");
  try {
    const result = await shell.exec("pandoc -d settings.yaml b.md");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "Audit\n<p>Before</p>\n<p>Beta</p>\n<p>After</p>\n");
    for (const path of ["settings.yaml", "page.html", "before.html", "after.html"]) {
      const original = volume.readFileSync(`/work/${path}`, "utf8");
      const alias = await shell.exec(`pandoc -d settings.yaml b.md -o ${path}`);
      assert.equal(alias.exitCode, 9, alias.stderr);
      assert.equal(volume.readFileSync(`/work/${path}`, "utf8"), original);
    }
    const output = await shell.exec("pandoc -d settings.yaml b.md -o result.html");
    assert.equal(output.exitCode, 0, output.stderr);
    assert.equal(volume.readFileSync("/work/result.html", "utf8"), result.stdout);
  } finally {await shell.dispose();}
});
