import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const cases = [
  'HOME=/home/user; p=/home/user/bin; printf "%s|%s|%s|%s\\n" "${p#~/}" "${p##~/}" "${p/~/X}" "${p/#~/X}"',
  'HOME=/home/user; p=/home/user/bin; f() { printf "%s|%s\\n" "${p#~/}" "${p/~/X}"; }; f; f',
  'HOME=/home/user; p="~/bin"; printf "%s|%s\\n" "${p#"~/"}" "${p/"~"/X}"',
  'HOME=/home/user; p=X; printf "%s|%s|%s|%s\\n" ${p/X/~} ${p/X/"~"} ${p/#X/~/bin} ${p/%X/~/bin}',
  ...['#', '##', '%', '%%', '/', '//', '/#', '/%'].map(operator =>
    `HOME=/home/user; p=/home/user; a=(/home/user /home/user); printf '%s|%s\\n' "\${p${operator}~${operator.startsWith('/') ? '/X' : ''}}" "\${a[*]${operator}~${operator.startsWith('/') ? '/X' : ''}}"`,
  ),
  ...['-', '!', '^', ':'].flatMap(character => {
    const pattern = character === '-' ? '[a"$c"z]' : character === ':' ? '[["$c"alpha:]]' : '["$c"a]';
    return [
      `c='${character}'; [[ b == ${pattern} ]] && echo MATCH || echo NOMATCH`,
      `c='${character}'; [[ b != ${pattern} ]] && echo NOMATCH || echo MATCH`,
      `c='${character}'; f() { case b in ${pattern}) echo MATCH ;; *) echo NOMATCH ;; esac; }; f; f`,
      `[[ b == ${pattern.replace('$c', character)} ]] && echo MATCH || echo NOMATCH`,
      `c='${character}'; [[ "$c" == ${pattern} ]] && echo MATCH || echo NOMATCH`,
    ];
  }),
  ...['é', '😀'].flatMap(text => [
    `printf '[%4s][%-4s]\\n' '${text}' '${text}'`,
    `printf -v x '[%4s][%-4s]' '${text}' '${text}'; printf '%s\\n' "$x"`,
    `x=$(printf '[%4s][%-4s]' '${text}' '${text}'); printf '%s\\n' "$x"`,
    `printf '[%4s][%-4s][%.1s][%4.1s]\\n' '${text}' '${text}' '${text}' '${text}'`,
    `printf -v x '[%4s][%-4s][%.1s]' '${text}' '${text}' '${text}'; printf '%s\\n' "$x"`,
    `x=$(printf '[%4s][%-4s][%.1s]' '${text}' '${text}' '${text}'); printf '%s\\n' "$x"`,
  ]),
];
for (const maxExpansionBytes of [undefined, 65536]) for (const source of cases) test(`Bash parity (${maxExpansionBytes ?? 'default'} bytes): ${source}`, async () => {
  const expected = execFileSync('/bin/bash', ['-c', source]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()), limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } });
  try {
    const actual = await shell.exec(source);
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stderr, '');
    assert.deepEqual(Buffer.from(actual.stdoutBytes), expected);
  } finally { await shell.dispose(); }
});
