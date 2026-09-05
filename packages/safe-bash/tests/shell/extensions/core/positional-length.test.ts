import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

const source = `set -- $'\\xe2\\x82' 'é' a b c d e f g tail; printf '<%s>' "\${#1}" "\${#2}" "\${#10}" "\${#}"`;
for (const [locale, expected] of [["C", "<2><2><4><10>"], ["en_US.UTF-8", "<2><1><4><10>"]] as const) {
  test(`numeric positional length: ${locale}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(source, { env: { LC_ALL: locale } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  });
  test(`pinned Bash numeric positional length: ${locale}`, nativeOptions(), () => {
    const result = runNative(`LC_ALL=${locale}; ${source}`);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stderr.toString(), "");
    assert.equal(result.stdout.toString(), expected);
  });
}

const prefixedSource = `set -- $'\\xff' 'é' a b c d e f g tail; printf '<%s>' "\${01}" "\${#01}" "\${0002}" "\${#0002}" "\${010}" "\${#00010}" "\${011-unset}"`;
for (const [locale, width] of [["C", "2"], ["en_US.UTF-8", "1"]] as const) {
  const expected = Buffer.concat([Buffer.from([60, 255, 62]), Buffer.from(`<1><é><${width}><tail><4><unset>`)]);
  test(`zero-prefixed positional aliases use canonical decimal indices: ${locale}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(prefixedSource, { env: { LC_ALL: locale } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected);
  });
  test(`pinned Bash zero-prefixed decimal positional aliases: ${locale}`, nativeOptions(), () => {
    const result = runNative(`LC_ALL=${locale}; ${prefixedSource}`);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stderr.toString(), "");
    assert.deepEqual(result.stdout, expected);
  });
}
