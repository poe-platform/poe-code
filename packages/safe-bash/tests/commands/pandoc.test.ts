import assert from "node:assert/strict";
import test from "node:test";
import type {FilterRequest} from "@poe-code/pandoc";
import {Shell} from "../../src/shell/index.js";
import {MemoryFileSystem} from "../../src/fs/memory/index.js";
import {FsError, readBytes} from "../../src/contracts/index.js";
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
test("pandoc loads explicit YAML defaults through Shell and honors CLI overrides", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/defaults.yaml", "from: commonmark\nto: plain\ninput-files:\n  - b.md\noutput-file: out\n");
  try {
    for (const defaults of ["--defaults defaults.yaml", "--defaults=defaults.yaml", "-d defaults.yaml", "-ddefaults.yaml"]) {
      const result = await shell.exec(`pandoc ${defaults} --to=html`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(volume.readFileSync("/work/out", "utf8"), "<p>Beta</p>\n");
    }
  } finally {await shell.dispose();}
});
test("pandoc renders an explicit body-only HTML template without a document wrapper", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/body.html", "$body$\n");
  try {
    const result = await shell.exec("pandoc -fcommonmark -thtml --template=body.html b.md");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trimEnd(), "<p>Beta</p>");
  } finally {await shell.dispose();}
});
test("pandoc supplies string and JSON variables to explicit templates", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/variables.html", "$label$|$short$|$audit$|$body$\n");
  try {
    const result = await shell.exec("pandoc -fcommonmark -thtml --template variables.html --variable=label:Audit -Vshort=Pass --variable-json=audit:[1] b.md");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trimEnd(), "Audit|Pass|1|<p>Beta</p>");
  } finally {await shell.dispose();}
});
test("pandoc inserts VFS header and body includes in supplied order", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/head.html", '<meta name="audit" content="verified">');
  volume.writeFileSync("/work/before.html", "<aside>Before</aside>");
  volume.writeFileSync("/work/after.html", "<aside>After</aside>");
  volume.writeFileSync("/work/end.html", "<aside>End</aside>");
  try {
    const result = await shell.exec("pandoc -fcommonmark -thtml -s -Hhead.html -B before.html -Aafter.html --include-after-body=end.html b.md");
    assert.equal(result.exitCode, 0, result.stderr);
    const header = result.stdout.indexOf('<meta name="audit" content="verified">');
    const before = result.stdout.indexOf("<aside>Before</aside>");
    const body = result.stdout.indexOf("<p>Beta</p>");
    const after = result.stdout.indexOf("<aside>After</aside>");
    const end = result.stdout.indexOf("<aside>End</aside>");
    assert.ok(header >= 0 && header < result.stdout.indexOf("</head>"), result.stdout);
    assert.ok(before >= 0 && before < body && body < after && after < end, result.stdout);
  } finally {await shell.dispose();}
});
test("pandoc file-scope controls cross-input references and sandbox accepts explicit VFS files", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/reference.md", "[Cross][target]");
  volume.writeFileSync("/work/definition.md", "[target]: https://example.test/");
  volume.writeFileSync("/work/body.html", "$body$\n");
  try {
    const combined = await shell.exec("pandoc -fcommonmark -thtml reference.md definition.md");
    assert.equal(combined.exitCode, 0, combined.stderr);
    assert.equal(combined.stdout.trimEnd(), '<p><a href="https://example.test/">Cross</a></p>');
    const separate = await shell.exec("pandoc -fcommonmark -thtml --file-scope --sandbox --template body.html reference.md definition.md");
    assert.equal(separate.exitCode, 0, separate.stderr);
    assert.equal(separate.stdout.trimEnd(), "<p>[Cross][target]</p>");
  } finally {await shell.dispose();}
});
test("pandoc refuses output aliases of defaults and all defaults-referenced input files", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/body.html", "$body$\n");
  volume.writeFileSync("/work/head.html", "<meta name=\"audit\" content=\"verified\">");
  volume.writeFileSync("/work/before.html", "<aside>Before</aside>");
  volume.writeFileSync("/work/after.html", "<aside>After</aside>");
  try {
    for (const source of ["defaults.json", "b.md", "body.html", "head.html", "before.html", "after.html"]) {
      for (const hardlink of [false, true]) {
        const output = hardlink ? "alias" : source;
        const defaults = {from: "commonmark", to: "html", "input-files": ["b.md"], template: "body.html", "include-in-header": ["head.html"], "include-before-body": ["before.html"], "include-after-body": ["after.html"], "output-file": output};
        volume.writeFileSync("/work/defaults.json", JSON.stringify(defaults));
        if (hardlink) volume.linkSync(`/work/${source}`, "/work/alias");
        const original = volume.readFileSync(`/work/${source}`, "utf8");
        const result = await shell.exec("pandoc -d defaults.json");
        assert.equal(result.exitCode, 9, `${source}: ${result.stderr}`);
        assert.equal(result.stdout, "");
        assert.equal(volume.readFileSync(`/work/${source}`, "utf8"), original);
        if (hardlink) volume.unlinkSync("/work/alias");
      }
    }
  } finally {await shell.dispose();}
});
test("pandoc missing option files preserve an existing output destination", async () => {
  const {shell, volume} = fixture();
  try {
    for (const option of ["--defaults", "--template", "--include-in-header", "--include-before-body", "--include-after-body"]) {
      const result = await shell.exec(`pandoc -fcommonmark -thtml ${option} missing.html b.md -o out`);
      assert.equal(result.exitCode, 9, `${option}: ${result.stderr}`);
      assert.equal(result.stdout, "");
      assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
    }
  } finally {await shell.dispose();}
});
test("pandoc defaults and includes obey the shared input budget before output publication", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/defaults.yaml", "from: commonmark\nto: html\ninput-files: [b.md]\noutput-file: out\n");
  volume.writeFileSync("/work/before.html", "<aside>" + "A".repeat(100) + "</aside>");
  try {
    for (const command of ["pandoc -d defaults.yaml", "pandoc -fcommonmark -thtml -B before.html b.md -o out"]) {
      const accepted = await shell.exec(command);
      assert.equal(accepted.exitCode, 0, accepted.stderr);
      assert.notEqual(volume.readFileSync("/work/out", "utf8"), "Keep");
      volume.writeFileSync("/work/out", "Keep");
      const result = await shell.exec(command, {limits: {maxInputBytes: 32}}).catch(() => undefined);
      assert.ok(result === undefined || result.exitCode !== 0);
      assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
    }
  } finally {await shell.dispose();}
});
test("pandoc rejects unsupported template loop separators before publishing output", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/loop.html", "$for(audit)$$audit$$sep$,$endfor$\n");
  try {
    const result = await shell.exec("pandoc -fcommonmark -thtml --template loop.html --variable-json=audit:[1] b.md -o out");
    assert.equal(result.exitCode, 5, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
  } finally {await shell.dispose();}
});
test("pandoc merges reader and writer aliases across defaults layers", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/first.yaml", "from: commonmark\nto: html\ninput-files: [b.md]\n");
  volume.writeFileSync("/work/second.yaml", "reader: commonmark\nwriter: plain\n");
  try {
    const result = await shell.exec("pandoc -dfirst.yaml -dsecond.yaml");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "Beta\n");
  } finally {await shell.dispose();}
});
test("pandoc defaults can explicitly consume stdin", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/stdin.yaml", 'from: commonmark\nto: html\ninput-files: ["-"]\n');
  try {
    const result = await shell.exec("printf 'From defaults stdin' | pandoc -dstdin.yaml");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "<p>From defaults stdin</p>\n");
  } finally {await shell.dispose();}
});
test("pandoc resolves table-of-contents aliases before defaults and CLI overrides", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/b.md", "# Heading");
  volume.writeFileSync("/work/toc.yaml", "from: commonmark\nto: html\nstandalone: true\ntable-of-contents: true\ninput-files: [b.md]\n");
  volume.writeFileSync("/work/no-toc.yaml", "toc: false\n");
  try {
    for (const overrides of ["--toc=false", "-d no-toc.yaml"]) {
      const result = await shell.exec(`pandoc -d toc.yaml ${overrides}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.includes("Heading"), result.stdout);
      assert.ok(!result.stdout.includes("<nav"), result.stdout);
    }
  } finally {await shell.dispose();}
});

test("pandoc default plugin profile executes local Lua filters, citeproc flags, and registered interpreter JSON filters", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/sample.md", "Hello\n");
  volume.writeFileSync("/work/uppercase.lua", "function Str(el) el.text = string.upper(el.text); return el end\n");
  volume.writeFileSync("/work/identity.py", "#!/usr/bin/python3\nimport json, sys\njson.dump(json.load(sys.stdin),sys.stdout)\n");
  try {
    for (const cmd of [
      "pandoc -f commonmark -t html --lua-filter=uppercase.lua sample.md",
      "pandoc -f commonmark -t html -L uppercase.lua sample.md"
    ]) {
      const result = await shell.exec(cmd);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "<p>HELLO</p>\n");
    }
    for (const cmd of [
      "pandoc -f commonmark -t html --citeproc sample.md",
      "pandoc -f commonmark -t html -C sample.md"
    ]) {
      const result = await shell.exec(cmd);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "<p>Hello</p>\n");
    }
    shell.commands.register({
      name: "python3",
      async execute(ctx) {
        assert.deepEqual(ctx.args, ["--", "/work/./identity.py", "html"]);
        for await (const chunk of readBytes(ctx.stdin, ctx.signal)) await ctx.stdout.write(chunk);
        return {exitCode: 0};
      }
    });
    for (const cmd of [
      "pandoc -f commonmark -t html --filter=./identity.py sample.md",
      "pandoc -f commonmark -t html -F ./identity.py sample.md"
    ]) {
      const result = await shell.exec(cmd);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "<p>Hello</p>\n");
    }
  } finally {
    await shell.dispose();
  }
});
