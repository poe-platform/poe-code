import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/index.js";

for (const [source, stdout, exitCode] of [
  ["shopt -s nullglob; args missing*.txt", "[]", 0],
  ["shopt -s nullglob globstar; args **/missing*.txt", "[]", 0],
  ["shopt -s nullglob; args 'missing*.txt' plain", '["missing*.txt","plain"]', 0],
  ["shopt -s nullglob; shopt -u nullglob; args missing*.txt", '["missing*.txt"]', 0],
  ["shopt -s nocaseglob; args ALPHA*.TXT", '["alpha.txt"]', 0],
  ["shopt -s nocaseglob; args [A-Z]*.TXT", '["alpha.txt"]', 0],
  ["shopt -s nocaseglob; args DIR/*.TXT", '["dir/beta.txt"]', 0],
  ["shopt -s nocasematch; case HELLO in hello) printf matched;; esac", "matched", 0],
  ["shopt -s nocasematch; [[ HELLO == 'hello' ]]", "", 0],
  ["shopt -s nocasematch; [[ HELLO != h* ]]", "", 1],
  ["shopt -s nocasematch; [[ HELLO =~ ^(hello)$ ]]; printf '%s' \"${BASH_REMATCH[1]}\"", "HELLO", 0],
  ["shopt -s nocasematch; shopt -u nocasematch; [[ HELLO == hello ]]", "", 1],
  ["shopt -s nocasematch; args ALPHA*.TXT", '["ALPHA*.TXT"]', 0],
  ["shopt -s nocasematch; value=HELLO; printf '%s' \"${value/hello/matched}\"", "matched", 0],
  ["shopt -s nocasematch; value=HELLO; printf '%s' \"${value#hello}\"", "HELLO", 0],
  ["shopt -s nocaseglob globstar; args DIR/**/*.TXT", '["dir/beta.txt"]', 0],
  ["shopt -u extglob; shopt -q extglob; printf 'STATUS:%s' \"$?\"", "STATUS:1", 0],
  ["shopt -p extglob", "shopt -u extglob\n", 1],
  ["shopt -o -q errexit; printf 'STATUS:%s' \"$?\"", "STATUS:1", 0],
  ["shopt -os noglob; args *.txt; shopt -ou noglob; args *.txt", '["*.txt"]["alpha.txt"]', 0],
  ["shopt -op braceexpand", "set -o braceexpand\n", 0],
  ["shopt -s nullglob nocaseglob nocasematch; (shopt -u nullglob nocaseglob nocasematch); shopt -q nullglob nocaseglob nocasematch", "", 0],
] as const) {
  test(source, async () => {
    const { shell, fs } = setup();
    shell.use(standardCommands());
    await fs.mkdir("/dir");
    await fs.writeFile("/alpha.txt", new Uint8Array());
    await fs.writeFile("/dir/beta.txt", new Uint8Array());
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout);
      assert.equal(result.exitCode, exitCode);
    } finally { await shell.dispose(); }
  });
}
