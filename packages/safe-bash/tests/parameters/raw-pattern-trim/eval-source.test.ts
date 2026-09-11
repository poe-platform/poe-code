import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";

export const evalCases = [
  ["nested substitution", 'raw=$\'\\200\\377\'; eval "value=\\$(printf \'%s\' \'$raw\'); printf \'%s\' \\"\\$value\\""\n'],
  ["nested backticks", 'raw=$\'\\200\\377\'; eval "value=\\`printf \'%s\' \'$raw\'\\`; printf \'%s\' \\"\\$value\\""\n'],
  ["single quoted document", 'raw=$\'\\200\\377\'; eval "cat <<\'END\'\n$raw\nEND"\n'],
  ["expanded document", 'raw=$\'\\200\\377\'; eval "cat <<END\n$raw\nEND"\n'],
  ["ANSI quoted literal", 'raw=$\'\\200\\377\'; eval "printf \'%s\' \\$\'$raw\'"\n'],
  ["escaped raw literal", 'raw=$\'\\200\'; eval "printf \'%s\' \\\\$raw"\n'],
] as const;

for (const [name, script] of evalCases) test(`owned eval source ${name}`, async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/eval.sh", new TextEncoder().encode(script));
  const shell = new Shell({ fs: filesystem, env: { LC_ALL: "C.UTF-8" } }).use(agentCommands());
  try {
    const result = await shell.exec("sh /eval.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), name.includes("document") ? "80ff0a" : name === "escaped raw literal" ? "80" : "80ff");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("saved interpreter arguments preserve bytes before eval", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/echo.sh", new TextEncoder().encode('printf "%s" "$1"\n'));
  const shell = new Shell({ fs: filesystem }).use(agentCommands());
  try {
    const result = await shell.exec('raw=$\'\\200\\377\'; sh /echo.sh "$raw"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "80ff");
  } finally { await shell.dispose(); }
});
