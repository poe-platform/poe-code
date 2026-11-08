import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";

const capturedSource = String.raw`printf 'one\n' > /input; { IFS= read -r -u3 value; printf '%s:<%s>\n' "$?" "$value"; IFS= read -r -u3 value; printf '%s:<%s>\n' "$?" "$value"; printf 'two\n' >> /input; IFS= read -r -u3 value; printf '%s:<%s>\n' "$?" "$value"; } 3</input`;

test("retained file EOF: actual Shell matches the recorded GNU Bash 5.2.37 file witness", { timeout: 1500 }, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [readExtension()], limits: { maxWallClockMs: 1000 } });
  for (const command of basicCommands()) shell.register(command);
  try {
    const result = await shell.exec(capturedSource);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.alloc(0));
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "303a3c6f6e653e0a313a3c3e0a303a3c74776f3e0a");
  } finally { await shell.dispose(); }
});

test("retained file EOF: actual read -t0 succeeds without consuming or assigning before append recovery", { timeout: 1500 }, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [readExtension()], limits: { maxWallClockMs: 1000 } });
  for (const command of basicCommands()) shell.register(command);
  try {
    const result = await shell.exec(String.raw`printf 'one\n' > /input; { IFS= read -r -u3 value; IFS= read -r -u3 value; value=sentinel; read -t0 -u3 value; printf '%s:<%s>\n' "$?" "$value"; printf 'two\n' >> /input; IFS= read -r -u3 value; printf '%s:<%s>\n' "$?" "$value"; } 3</input`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "0:<sentinel>\n0:<two>\n");
  } finally { await shell.dispose(); }
});
