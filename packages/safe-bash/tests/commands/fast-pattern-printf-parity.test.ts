import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { predicateCommands } from "../../src/commands/predicates.js";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const cases = [
  'printf "%d|%05d\\n" -0 -0; printf -v out "%d" -0; printf "%s\\n" "$out"',
  'printf "[%6s][%-6s]\\n" café café; printf -v out "[%6s][%-6s]" café café; printf "%s\\n" "$out"',
  'x=0; echo $((++x)) $(echo a; echo b); printf "x=%s\\n" "$x"',
  'x=0; printf -v out "%x" $((++x)); printf "x=%s out=%s\\n" "$x" "$out"',
  'x=0; for i in 1 2; do printf -v out "%x" $((++x)); done; printf "x=%s out=%s\\n" "$x" "$out"',
  'x=0; for i in 1 2; do [ -f $((++x)) ]; done; printf "x=%s\\n" "$x"',
  'x=0; for i in 1 2; do test -f $((++x)); done; printf "x=%s\\n" "$x"',

  ...[
    ["a\\nb", "^a.b$"],
    ["a\\n", "^a$"],
    ["]a", "^[]a]+$"],
    ["xb", "^[^]a]+$"],
    ["]a", "^[^]a]+$"],
  ].flatMap(([subject, pattern]) => [
    `[[ seed =~ (seed) ]]; s=$'${subject}'; [[ "$s" =~ ${pattern} ]]; printf '%s:<%s>:<%s>\\n' "$?" "\${BASH_REMATCH[0]}" "\${BASH_REMATCH[1]}"`,
    `s=$'${subject}'; p='${pattern}'; for i in 1 2; do [[ seed =~ (seed) ]]; [[ "$s" =~ $p ]]; printf '%s:<%s>:<%s>\\n' "$?" "\${BASH_REMATCH[0]}" "\${BASH_REMATCH[1]}"; done`,
  ]),
  'HOME=/home/user; p=/home/user/bin; printf "%s|%s|%s|%s\\n" "${p#~/}" "${p##~/}" "${p/~/X}" "${p/#~/X}"',
  'HOME=/home/user; p=/home/user/bin; f() { printf "%s|%s\\n" "${p#~/}" "${p/~/X}"; }; f; f',
  'HOME=/home/user; p="~/bin"; printf "%s|%s\\n" "${p#"~/"}" "${p/"~"/X}"',
  'HOME=/home/user; p=X; printf "%s|%s|%s|%s\\n" ${p/X/~} ${p/X/"~"} ${p/#X/~/bin} ${p/%X/~/bin}',
  ...['/', '//', '/#', '/%'].flatMap(operator => [
    `HOME=/home/user; p=X; r="~"; printf '<%s>\\n' "\${p${operator}X/$r}"`,
    `HOME=/home/user; p=X; r="~"; printf '<%s>\\n' \${p${operator}X/$r}`,
    `HOME=/home/user; p=X; printf '<%s>\\n' \${p${operator}X/"~"}`,
  ]),
  'HOME=/home/user; p=/home/user/X; r="~"; printf "<%s>\\n" "${p/~/$r}"',
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
// Bash 5.2/5.3 expand raw replacement tildes inside an outer quoted expansion;
// macOS's Bash 3.2 does not. Keep these modern expectations host-independent.
const modernReplacementCases = [
  ...['/', '//', '/#', '/%'].map(operator => ({
    source: `HOME=/home/user; p=X; printf '<%s>\\n' "\${p${operator}X/~}"`,
    stdout: '</home/user>\n',
  })),
  { source: 'HOME=/home/user; p=/home/user/X; printf "<%s>\\n" "${p/~/~}"', stdout: '</home/user/X>\n' },
];
for (const maxExpansionBytes of [undefined, 65536]) for (const { source, stdout } of [
  ...cases.map(source => ({ source, stdout: undefined })), ...modernReplacementCases,
]) test(`${stdout === undefined ? 'Bash parity' : 'Modern Bash replacement'} (${maxExpansionBytes ?? 'default'} bytes): ${source}`, async () => {
  const env = { HOME: '/home/user', LC_ALL: 'C' };
  const expected = stdout === undefined ? execFileSync('/bin/bash', ['-c', source], { env: { ...process.env, ...env } }) : Buffer.from(stdout);
  const shell = new Shell({ fs: new MemoryFileSystem(), env, commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]), limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } });
  try {
    const actual = await shell.exec(source);
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stderr, '');
    assert.deepEqual(Buffer.from(actual.stdoutBytes), expected);
  } finally { await shell.dispose(); }
});

// Invalid/unsupported EREs retain the shell's explicit profile diagnostic,
// while status and prior captures follow the macOS Bash rejection profile.
// GNU libc accepts some stacked repetitions as an extension, so those native
// results are not a portable oracle for this deliberately unsupported syntax.
for (const maxExpansionBytes of [undefined, 65536]) for (const [pattern, diagnostic] of [
  ['^(?:abc)$', 'at 1: extended group syntax'],
  ['^([a-z]+?)[a-z]+$', 'at 8: stacked repetition'],
  ['^([a-z]??)[a-z]+$', 'at 8: stacked repetition'],
]) for (const variable of [false, true]) test(`Rejected ERE (${maxExpansionBytes ?? 'default'} bytes, ${variable ? 'variable' : 'literal'}): ${pattern}`, async () => {
  const env = { LC_ALL: 'C' };
  const source = `p='${pattern}'; for i in 1 2; do [[ seed =~ (seed) ]]; [[ abc =~ ${variable ? '$p' : pattern} ]]; printf '%s:<%s>:<%s>\\n' "$?" "\${BASH_REMATCH[0]}" "\${BASH_REMATCH[1]}"; done`;
  const expected = Buffer.from('2:<seed>:<seed>\n'.repeat(2));
  if (process.platform === 'darwin') assert.deepEqual(execFileSync('/bin/bash', ['-c', source], { env }), expected);
  const shell = new Shell({ fs: new MemoryFileSystem(), env, commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]), limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } });
  try {
    const actual = await shell.exec(source);
    assert.equal(actual.exitCode, 0);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), expected);
    assert.equal(actual.stderr, `shell: line 1: [[ unsupported ERE profile ${diagnostic}\n`.repeat(2));
  } finally { await shell.dispose(); }
});
