import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baselineNames, functions, semantics, subpath } from "./contract.mjs";

const exact = (actual, stdout, exitCode = 0, stderr = "") => {
  assert.equal(actual.stdout, stdout);
  assert.equal(actual.stderr, stderr);
  assert.equal(actual.exitCode, exitCode);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from(stdout));
};

export async function runPublic(id, api, declaration) {
  const fs = new api.MemoryFileSystem();
  const shell = new api.Shell({ fs });
  const option = limits => ({ [declaration.agentOption]: { limits } });
  const html = await import(subpath);
  try {
    const semantic = semantics.find(value => value.id === id);
    if (semantic) {
      shell.use(html.htmlToMarkdownCommands({ limits: semantic.limits }));
      exact(await shell.exec("html-to-markdown", { stdin: semantic.input }), semantic.output, semantic.exitCode ?? 0, semantic.stderr ?? "");
      return;
    }
    switch (id) {
      case "P01": {
        for (const name of functions) {
          assert.equal(typeof api[name], "function");
          assert.equal(api[name], html[name]);
        }
        const manifest = JSON.parse(readFileSync(new URL("./node_modules/virtual-bash/package.json", import.meta.url)));
        assert.deepEqual(manifest.exports, declaration.packageExports);
        assert.ok(!Object.keys(manifest.exports).some(name => name.startsWith("./commands/") && name.includes("*")));
        await assert.rejects(import("virtual-bash/commands/html-to-markdown/render"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
        await assert.rejects(import("virtual-bash/dist/commands/html-to-markdown/index.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
        break;
      }
      case "P02": {
        const names = api.createAgentCommands().map(command => command.name);
        assert.equal(names.length, 74);
        assert.equal(new Set(names).size, 74);
        assert.deepEqual([...names].sort(), [...baselineNames, "html-to-markdown"].sort());
        assert.equal(names.filter(name => name === "html-to-markdown").length, 1);
        for (const name of ["curl", "safejs", "du", "expr"]) assert.ok(!names.includes(name), name);
        shell.use(api.agentCommands());
        exact(await shell.exec("html-to-markdown", { stdin: "<p>x</p>" }), "x\n");
        assert.deepEqual(shell.commands.list().map(command => command.name).sort(), names.sort());
        break;
      }
      case "P03":
        shell.use(html.htmlToMarkdownCommands());
        exact(await shell.exec("html-to-markdown", { stdin: "<p>x</p>" }), "x\n");
        assert.deepEqual(shell.commands.list().map(command => command.name), ["html-to-markdown"]);
        break;
      case "P04":
      case "P06": {
        const marker = () => ({ exitCode: 17 });
        shell.register({ name: "html-to-markdown", execute: marker });
        const before = shell.commands.list();
        shell.use(api.agentCommands(id === "P06" ? { [declaration.agentOption]: { replace: true } } : {}));
        await assert.rejects(shell.exec("html-to-markdown"), /Command already registered: html-to-markdown/);
        assert.deepEqual(shell.commands.list(), before);
        break;
      }
      case "P05":
        shell.register({ name: "html-to-markdown", execute: () => ({ exitCode: 17 }) });
        shell.use(api.agentCommands({ replace: true, [declaration.agentOption]: { replace: false } }));
        exact(await shell.exec("html-to-markdown", { stdin: "<p>x</p>" }), "x\n");
        assert.equal(shell.commands.list().length, 74);
        break;
      case "P07": {
        shell.use(api.agentCommands(option({ maxTokenBytes: 4 })));
        exact(await shell.exec("html-to-markdown", { stdin: "&amp;" }), "", 1, semantics.at(-1).stderr);
        const factoryShell = new api.Shell({ fs, commands: new api.CommandRegistry(api.createAgentCommands(option({ maxTokenBytes: 4 }))) });
        try { exact(await factoryShell.exec("html-to-markdown", { stdin: "&amp;" }), "", 1, semantics.at(-1).stderr); }
        finally { await factoryShell.dispose(); }
        break;
      }
      case "P08":
        await fs.writeFile("/one", Buffer.from("<p>x</p>"));
        shell.use(api.agentCommands(option({ maxInputBytes: 8 })));
        exact(await shell.exec("html-to-markdown /one; html-to-markdown /one"), "x\nx\n");
        exact(await shell.exec("html-to-markdown /one /one"), "x\n", 1, "html-to-markdown: EFBIG: html-to-markdown input limit exceeded\n");
        break;
      case "P09":
        shell.use(api.agentCommands());
        await assert.rejects(shell.exec("html-to-markdown", { stdin: "<p>x</p>", limits: { maxOutputBytes: 1 } }), error => error instanceof api.ShellLimitError && error.limit === "maxOutputBytes");
        break;
      case "P10": {
        await fs.writeFile("/one", Buffer.from("<p>A</p>"));
        await fs.writeFile("/-dash", Buffer.from("<p>C</p>"));
        const before = await fs.readdir("/");
        shell.use(api.agentCommands());
        exact(await shell.exec("html-to-markdown /one - - -- -dash", { stdin: "<p>B</p>" }), "A\n\nB\n\nC\n");
        assert.deepEqual(await fs.readdir("/"), before);
        assert.deepEqual(Buffer.from(await fs.readFile("/one")), Buffer.from("<p>A</p>"));
        break;
      }
      case "P11": {
        let requests = 0, disposals = 0;
        shell.use(api.agentCommands());
        await shell.exec("");
        assert.equal(shell.commands.has("curl"), false);
        shell.use(api.networkCommands({ authorize: request => request.url === "https://fixture.invalid/html", async transport(request) {
          assert.equal(request.url, "https://fixture.invalid/html");
          requests++;
          return { status: 200, statusText: "OK", headers: [], body: api.toByteSource("<p>x</p>"), async dispose() { disposals++; } };
        } }));
        exact(await shell.exec("curl https://fixture.invalid/html | html-to-markdown"), "x\n");
        assert.equal(requests, 1);
        assert.equal(disposals, 1);
        break;
      }
      case "P12":
        shell.use(api.agentCommands());
        exact(await shell.exec("printf 'abc\\n' | grep -E 'a.c'"), "abc\n");
        break;
      case "P13": {
        const registry = new api.CommandRegistry();
        const host = { commands: registry, use() {}, registerFileSystem() {} };
        html.htmlToMarkdownCommands().setup(host);
        const original = registry.get("html-to-markdown");
        assert.throws(() => html.htmlToMarkdownCommands().setup(host), /Command already registered: html-to-markdown/);
        assert.equal(registry.get("html-to-markdown"), original);
        html.htmlToMarkdownCommands({ replace: true }).setup(host);
        assert.notEqual(registry.get("html-to-markdown"), original);
        assert.equal(registry.list().length, 1);
        break;
      }
      case "P14":
        assert.throws(() => html.createHtmlToMarkdownCommand({ limits: { maxInputBytes: 0 } }), { name: "RangeError", message: "Invalid html-to-markdown limit: maxInputBytes" });
        break;
      default: assert.fail(`unknown public case: ${id}`);
    }
  } finally { await shell.dispose(); }
}
