import assert from "node:assert/strict";
import test from "node:test";
import { Shell, CommandRegistry, createStandardCommands, MemoryFileSystem } from "../../src/index.js";
import { createYqCommands } from "safe-bash-command-yq/query";
import { formatSyncYqYamlLines } from "../../src/commands/yq/index.js";

for (const [name, input, args, expected] of [
  ["scalar string", "name: safe-bash\n", ".name", '"safe-bash"\n'],
  ["multiple scalars", "app:\n  name: safe-bash\n  port: 8080\n", ".app[]", '"safe-bash"\n---\n8080\n'],
  ["multiple arrays", "items:\n  -\n    - safe-bash\n    - 8080\n  -\n    - true\n", ".items[]", '- "safe-bash"\n- 8080\n---\n- true\n'],
  ["mapping", "name: safe-bash\nport: 8080\n", ".", '"name": "safe-bash"\n"port": 8080\n'],
  ["empty stream", "name: safe-bash\n", "empty", ""],
  ["YAML double quoted hash", 'msg: "hello # world" # comment\n', ".msg", '"hello # world"\n'],
  ["YAML single quoted hash", "msg: 'hello # world' # comment\n", ".msg", '"hello # world"\n'],
  ["TOML embedded hash", 'msg = "hello # world" # comment\n', "-p toml .msg", '"hello # world"\n'],
  ["TOML double quoted hash", 'color = "#ff0000" # comment\n', "-p toml .color", '"#ff0000"\n'],
  ["TOML single quoted hash", "color = '#ff0000' # comment\n", "-p toml .color", '"#ff0000"\n'],
] as const) {
  test(`yq preserves ${name} in direct commands, substitutions and pipelines`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", new TextEncoder().encode(input));
    const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createYqCommands()]) });
    try {
      for (const command of [`yq ${args} /input`, `cat /input | yq ${args}`]) {
        const direct = await shell.exec(command);
        assert.equal(direct.exitCode, 0, direct.stderr);
        assert.equal(direct.stdout, expected);
        const substitution = await shell.exec(`x="$(${command})"; printf '%s' "$x"`);
        assert.equal(substitution.exitCode, 0, substitution.stderr);
        assert.equal(substitution.stdout, expected.trimEnd());
      }
    } finally { await shell.dispose(); }
  });
}

test("YAML separators divide documents, including empty collections", () => {
  assert.equal(formatSyncYqYamlLines(['[]', '{}', 'null']), "[]\n---\n{}\n---\nnull\n");
});
