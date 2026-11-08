import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

function createShell() {
  const shell = new Shell({
    fs: createMemoryFileSystem(),
    extensions: [arraysExtension(), readExtension()],
    limits: { maxWallClockMs: 2000, maxOutputBytes: 65536 },
  });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

const qualifiedCounts = [
  {
    "name": "count \" 0x0 \"",
    "source": "values=(OLD KEEP);  read -n ' 0x0 ' -a values; status=$?; printf 's=%s;' \"$status\"; printf 'a=<%s>;' \"${values[@]}\";  IFS= read -r tail; printf 'tail=%s:<%s>' \"$?\" \"$tail\"",
    "inputHex": "616263206465660a5441494c0a",
    "status": 0,
    "stdoutHex": "733d313b613d3c4f4c443e3b613d3c4b4545503e3b7461696c3d303a3c616263206465663e",
    "stderrHex": "7368656c6c3a206c696e6520313a20726561643a2020307830203a20696e76616c6964206e756d6265720a"
  },
  {
    "name": "count \" +0x0 \"",
    "source": "values=(OLD KEEP);  read -n ' +0x0 ' -a values; status=$?; printf 's=%s;' \"$status\"; printf 'a=<%s>;' \"${values[@]}\";  IFS= read -r tail; printf 'tail=%s:<%s>' \"$?\" \"$tail\"",
    "inputHex": "616263206465660a5441494c0a",
    "status": 0,
    "stdoutHex": "733d313b613d3c4f4c443e3b613d3c4b4545503e3b7461696c3d303a3c616263206465663e",
    "stderrHex": "7368656c6c3a206c696e6520313a20726561643a20202b307830203a20696e76616c6964206e756d6265720a"
  },
  {
    "name": "count \"-0x0\"",
    "source": "values=(OLD KEEP);  read -n '-0x0' -a values; status=$?; printf 's=%s;' \"$status\"; printf 'a=<%s>;' \"${values[@]}\";  IFS= read -r tail; printf 'tail=%s:<%s>' \"$?\" \"$tail\"",
    "inputHex": "616263206465660a5441494c0a",
    "status": 0,
    "stdoutHex": "733d313b613d3c4f4c443e3b613d3c4b4545503e3b7461696c3d303a3c616263206465663e",
    "stderrHex": "7368656c6c3a206c696e6520313a20726561643a202d3078303a20696e76616c6964206e756d6265720a"
  },
  {
    "name": "count \"+0X2\"",
    "source": "values=(OLD KEEP);  read -n '+0X2' -a values; status=$?; printf 's=%s;' \"$status\"; printf 'a=<%s>;' \"${values[@]}\";  IFS= read -r tail; printf 'tail=%s:<%s>' \"$?\" \"$tail\"",
    "inputHex": "616263206465660a5441494c0a",
    "status": 0,
    "stdoutHex": "733d313b613d3c4f4c443e3b613d3c4b4545503e3b7461696c3d303a3c616263206465663e",
    "stderrHex": "7368656c6c3a206c696e6520313a20726561643a202b3058323a20696e76616c6964206e756d6265720a"
  },
  {
    "name": "count \"000000000000000000000000002\"",
    "source": "values=(OLD KEEP);  read -n '000000000000000000000000002' -a values; status=$?; printf 's=%s;' \"$status\"; printf 'a=<%s>;' \"${values[@]}\";  IFS= read -r tail; printf 'tail=%s:<%s>' \"$?\" \"$tail\"",
    "inputHex": "616263206465660a5441494c0a",
    "status": 0,
    "stdoutHex": "733d303b613d3c61623e3b7461696c3d303a3c63206465663e",
    "stderrHex": ""
  },
  {
    "name": "count \"-000\"",
    "source": "values=(OLD KEEP);  read -n '-000' -a values; status=$?; printf 's=%s;' \"$status\"; printf 'a=<%s>;' \"${values[@]}\";  IFS= read -r tail; printf 'tail=%s:<%s>' \"$?\" \"$tail\"",
    "inputHex": "616263206465660a5441494c0a",
    "status": 0,
    "stdoutHex": "733d303b613d3c3e3b7461696c3d303a3c616263206465663e",
    "stderrHex": ""
  },
  {
    "name": "count \"+000\"",
    "source": "values=(OLD KEEP);  read -n '+000' -a values; status=$?; printf 's=%s;' \"$status\"; printf 'a=<%s>;' \"${values[@]}\";  IFS= read -r tail; printf 'tail=%s:<%s>' \"$?\" \"$tail\"",
    "inputHex": "616263206465660a5441494c0a",
    "status": 0,
    "stdoutHex": "733d303b613d3c3e3b7461696c3d303a3c616263206465663e",
    "stderrHex": ""
  }
] as const;

for (const entry of qualifiedCounts) {
  test(`read numeric sign primary 5.3: ${entry.name}`, async context => {
    const shell = createShell();
    context.after(() => shell.dispose());
    const result = await shell.exec(entry.source, { stdin: Buffer.from(entry.inputHex, "hex"), env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, entry.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(entry.stdoutHex, "hex"));
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(entry.stderrHex, "hex"));
  });
}

for (const args of ["-N 0x10", "-u -1", "-n -1"]) {
  test(`read numeric sign retained primary diagnostic: ${args}`, async context => {
    const source = `read ${args}`;
    const expected = primaryReference("native.test.ts", source, "one\n");
    const shell = createShell();
    context.after(() => shell.dispose());
    const result = await shell.exec(source, { stdin: "one\n", env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
  });
}
