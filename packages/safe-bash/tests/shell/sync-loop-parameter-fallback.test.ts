import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

const expansions = [
  ["${s#c}", "afé🙂"], ["${s##c*}", ""],
  ["${s%🙂}", "café"], ["${s%%é*}", "caf"],
  ["${s/é/É}", "cafÉ🙂"], ["${s//é/É}", "cafÉ🙂"],
  ["${s/#c/C}", "Café🙂"], ["${s/%🙂/!}", "café!"],
  ["${s^}", "Café🙂"], ["${s^^}", "CAFÉ🙂"],
  ["${s,}", "café🙂"], ["${s,,}", "café🙂"],
  ["${s:3:2}", "é🙂"],
] as const;

for (const [expansion, value] of expansions) {
  for (const [header, assignment] of [
    ['for i in 1 2', 's="café🙂";'],
    ['for s in "café🙂" "café🙂"', ''],
    ['for ((i=0;i<2;i++))', 's="café🙂";'],
    ['i=0; while ((i<2))', '((i++)); s="café🙂";'],
  ]) {
    test(`loop expansion ${expansion}: ${header}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem() });
      for (const command of basicCommands()) shell.commands.register(command);
      try {
        const result = await shell.exec(`${header}; do ${assignment} echo "before"; x="${expansion}"; echo "$x"; done; echo "after:$x"`);
        assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: 0, stdout: `before\n${value}\nbefore\n${value}\nafter:${value}\n`, stderr: "" });
      } finally { await shell.dispose(); }
    });
  }
}

for (const [expansion, value] of [
  ["${s#é}", "cafe"], ["${s##é*}", "cafe"],
  ["${s%é}", "cafe"], ["${s%%*é}", "cafe"],
  ["${s/e/é}", "café"], ["${s//e/🙂}", "caf🙂"],
  ["${s/#c/é}", "éafe"], ["${s/%e/é}", "café"],
]) {
  test(`non-ASCII pattern or replacement ${expansion}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    try {
      const result = await shell.exec(`s=cafe; for i in 1 2; do echo "${expansion}"; done`);
      assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: 0, stdout: `${value}\n${value}\n`, stderr: "" });
    } finally { await shell.dispose(); }
  });
}

test("loop assignment keeps a valid variable binding", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec('for i in 1 2; do s="café"; x="${s#c}"; done; declare -p x');
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: 0, stdout: 'declare -- x="afé"\n', stderr: "" });
  } finally { await shell.dispose(); }
});

for (const length of ["-2", "$n"]) {
  test(`invalid substring length ${length} reports an error without replay`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    try {
      const result = await shell.exec(`s=ab; n=-2; for i in 1 2; do echo before; x="${'${s:1:' + length + '}'}"; done; echo after`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "before\n");
      assert.match(result.stderr, /substring expression < 0/);
    } finally { await shell.dispose(); }
  });
}

for (const [source, stdout] of [
  ['arr=("café🙂"); for i in 1 2; do echo "${arr[0]#c}" "${arr[0]:3:2}"; done', 'afé🙂 é🙂\nafé🙂 é🙂\n'],
  ['s=cafe; for i in 1 2; do p=é; r=🙂; echo "${s#$p}" "${s/e/$r}"; done', 'cafe caf🙂\ncafe caf🙂\n'],
  ['f() { echo "${s#c}"; }; for i in 1 2; do s="café"; f; done', 'afé\nafé\n'],
  ['for i in 1 2; do s="CAFÉ"; echo "${s,}" "${s,,}"; done', 'cAFÉ café\ncAFÉ café\n'],
  ['s=abcdef; for i in 1 2; do echo "${s:1:-2}"; done', 'bcd\nbcd\n'],
] as const) {
  test(`parameter fallback preserves dynamic state: ${source}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}
