import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";

for (const [name, second, expectedHex] of [
  ["distinct invalid byte", "\\377", "ff0a"],
  ["valid Unicode replacement character", "\\357\\277\\275", "efbfbd0a"],
] as const) {
  test(`raw eval heredoc delimiter does not match ${name}`, async () => {
    const script = `first=$'\\200'; second=$'${second}'; eval "cat <<'$first'\n$second\n$first\n"\n`;
    const fs = new MemoryFileSystem();
    await fs.writeFile("/review.sh", Buffer.from(script));
    const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(agentCommands());
    try {
      const result = await shell.exec("sh /review.sh");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), expectedHex);
      assert.equal(result.stderrBytes.length, 0);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["review.sh"]);
      assert.equal(Buffer.from(await fs.readFile("/review.sh")).toString(), script);
    } finally { await shell.dispose(); }
  });
}
