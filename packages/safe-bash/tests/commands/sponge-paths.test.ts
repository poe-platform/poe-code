import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { spongeCommands } from "../../src/commands/sponge/index.js";

for (const append of [false, true]) {
  for (const path of ["missing/../f", "f/", "f/.", "f/../f", "./f", "dir/../f"]) {
    for (const source of ["pipeline", "substitution pipeline", "substitution redirect"]) {
      test(`sponge ${append ? "append" : "overwrite"} ${path} via ${source}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.mkdir("/work/dir", { recursive: true });
        await fs.writeFile("/work/f", new TextEncoder().encode("OLD"));
        await fs.writeFile("/work/input", new TextEncoder().encode("abc"));
        const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(spongeCommands());
        const command = `sponge ${append ? "-a " : ""}${path}`;
        const script = source === "pipeline" ? `printf abc | ${command}`
          : source === "substitution pipeline" ? `output=$(printf abc | ${command})`
          : `output=$(${command} < input)`;
        const result = await shell.exec(script);
        const valid = path === "./f" || path === "dir/../f";
        assert.equal(new TextDecoder().decode(await fs.readFile("/work/f")), valid ? (append ? "OLDabc" : "abc") : "OLD");
        assert.equal(result.exitCode, valid ? 0 : 1, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr.length > 0, !valid);
      });
    }
  }
}
