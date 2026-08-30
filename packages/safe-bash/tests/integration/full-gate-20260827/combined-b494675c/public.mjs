import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "virtual-bash";
import * as stream from "virtual-bash/commands/stream-inspection";

const packageRoot = realpathSync(join(process.cwd(), "node_modules/virtual-bash"));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")), imports = [];
for (const [name, target] of Object.entries(manifest.exports)) {
  const pattern = typeof target === "string" ? target : target.import;
  const names = name.includes("*") ? readdirSync(join(packageRoot, dirname(pattern))).filter(entry => entry.endsWith(".js")).map(entry => name.replace("*", entry.slice(0, -3))) : [name];
  for (const exposed of names) {
    const specifier = exposed === "." ? "virtual-bash" : "virtual-bash/" + exposed.slice(2);
    const resolved = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
    assert.ok(resolved.startsWith(packageRoot + "/dist/"), `Not packed dist: ${specifier}`);
    const loaded = await import(specifier); imports.push({ specifier, path: relative(packageRoot, resolved), sha256: createHash("sha256").update(readFileSync(resolved)).digest("hex"), exports: Object.keys(loaded).sort() });
  }
}
assert.deepEqual(manifest.dependencies ?? {}, {});
assert.equal(api.createStreamInspectionCommands, stream.createStreamInspectionCommands);
assert.equal(api.streamInspectionCommands, stream.streamInspectionCommands);
assert.deepEqual(stream.createStreamInspectionCommands().map(command => command.name).sort(), ["expand", "fold", "strings", "tac"]);
const names = api.createAgentCommands().map(command => { assert.equal(typeof command.execute, "function"); return command.name; }).sort();
const expected = ["[", "awk", "base32", "base64", "basename", "cat", "chmod", "cksum", "comm", "cp", "cut",
  "date", "diff", "dirname", "echo", "env", "expand", "false", "file", "find", "fold", "grep", "gunzip",
  "gzip", "head", "join", "jq", "ln", "ls", "md5sum", "mkdir", "mktemp", "mv", "nl", "od", "paste",
  "patch", "printenv", "printf", "pwd", "readlink", "realpath", "rev", "rg", "rm", "rmdir", "sed", "seq",
  "sha1sum", "sha256sum", "sleep", "sort", "split", "stat", "strings", "tac", "tail", "tar", "tee", "test",
  "touch", "tr", "tree", "true", "unexpand", "uniq", "wc", "xargs", "xxd", "zcat"];
assert.deepEqual(names, expected); assert.equal(new Set(names).size, 70);
for (const name of ["tac", "expand", "fold", "strings"]) assert.ok(names.includes(name), name);
for (const name of ["curl", "safejs"]) assert.equal(names.includes(name), false, "Optional capability must not silently become default");
const commands = new api.CommandRegistry(); api.agentCommands().setup({ commands, use() { throw new Error("unexpected middleware"); }, registerFileSystem() { throw new Error("unexpected filesystem registration"); } });
assert.deepEqual(commands.list().map(command => command.name).sort(), names);
const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands()), workflows = [];
try {
  for (const [source, expected] of [["printf 'a\\nb\\n' | tac", "b\na\n"], ["printf 'a\\tb\\n' | expand", "a       b\n"], ["printf 'abcdef\\n' | fold -w 3", "abc\ndef\n"], ["printf 'abc\\000de\\000fghi' | strings -n 3", "abc\nfghi\n"]]) {
    const result = await shell.exec(source); assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, expected); assert.equal(result.stderr, ""); workflows.push({ source, ...result });
  }
} finally { await shell.dispose(); }
console.log(JSON.stringify({ names, count: names.length, imports, workflows, runtimeDependencies: manifest.dependencies ?? {}, scope: "Mechanical exports/registry plus four basic public workflows, not broad tool parity" }, null, 2));
