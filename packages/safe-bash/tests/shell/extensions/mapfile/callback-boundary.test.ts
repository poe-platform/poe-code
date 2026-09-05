import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { mapfileExtension } from "../../../../src/shell/extensions/mapfile/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

const origins = [2147483647, 2147483648, 3294967296, 3294967297];
const prefixes = [
  { name: "ASCII", argument: "'cb prefix'", bytes: Buffer.from("cb prefix") },
  { name: "UTF-8", argument: "'cb pré😀'", bytes: Buffer.from("cb pré😀") },
  { name: "raw byte", argument: "$'cb \\xff'", bytes: Buffer.from([99, 98, 32, 255]) },
];
const input = "clé'😀\nfin\ntail\n";

for (const origin of origins) for (const prefix of prefixes) {
  const script = `calls=0; cb() { calls=$((calls + 1)); printf 'cb=<%s><%s><%s>;' "$1" "$2" "$3"; }; mapfile -tn2 -O${origin} -c1 -C ${prefix.argument} a; printf 'status=%s;calls=%s;cells=<%s><%s>;' "$?" "$calls" "\${a[${origin}]}" "\${a[${origin + 1}]}"; read -r tail; printf 'tail=<%s>' "$tail"`;

  test(`mapfile callback capacity ${origin} ${prefix.name}: exact native effects`, {}, async context => {
    const native = primaryReference(import.meta.url, script, input);
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [mapfileExtension()] });
    for (const command of basicCommands()) shell.register(command);
    context.after(() => shell.dispose());
    const actual = await shell.exec(script, { stdin: Buffer.from(input) });
    assert.equal(actual.exitCode, native.status);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
    assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
  });

  test(`mapfile callback capacity ${origin} ${prefix.name}: admitted source bytes`, async context => {
    const extension = mapfileExtension();
    const create = extension.create;
    const sources: Buffer[] = [];
    extension.create = () => {
      const instance = create();
      const builtin = instance.builtins[0]!;
      const execute = builtin.execute;
      builtin.execute = command => execute({
        ...command,
        async evaluate(source) { sources.push(Buffer.from(shellValueBytes(source))); return 2; },
      });
      return instance;
    };
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension] });
    for (const command of basicCommands()) shell.register(command);
    context.after(() => shell.dispose());
    const actual = await shell.exec(script, { stdin: Buffer.from(input) });
    assert.equal(actual.exitCode, 0);
    assert.deepEqual(Buffer.from(actual.stderrBytes), Buffer.alloc(0));
    assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from("status=0;calls=0;cells=<clé'😀><fin>;tail=<tail>"));
    const quotedLines = [Buffer.from("'clé'\\''😀'"), Buffer.from("'fin'")];
    assert.deepEqual(sources, quotedLines.map((line, offset) => {
      const complete = Buffer.concat([prefix.bytes, Buffer.from(` ${(origin + offset) | 0} `), line]);
      const capacity = prefix.bytes.length + line.length + 10 + 3;
      return complete.subarray(0, capacity - 1);
    }));
  });
}
