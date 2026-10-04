import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createXqCommand } from "./index.js";

test("xq stops source reads when the XML parser rejects a node", async () => {
  let closed = false, diagnostics = "";
  const result = await createXqCommand({ limits: { maxNodes: 1 } }).execute({ command: "xq",
    ...createCommandArguments(["."]), cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { try {
      yield new TextEncoder().encode("<r><x/>");
      assert.fail("xq must enforce XML limits before requesting more input");
    } finally { closed = true; } } },
    stdout: { async write() { assert.fail("invalid XML must not emit a value"); } },
    stderr: { async write(bytes) { diagnostics += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 5, diagnostics);
  assert.equal(closed, true);
});
