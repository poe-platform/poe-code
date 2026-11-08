const printArgs = 'printf "<%s>|<%s>|<%s>\\n" "$0" "$#" "$1"\n';
const phase = 'printf before > effect\nfalse\nprintf after > effect\n';
const marker = 'printf "<%s>\\n" "$MARK"\n';
const good = (stdout = '', effect = 'seed', status = 0) => ({ status, stdout, stderr: '', effect });
const bad = (status, diagnostic) => ({ status, stdout: '', diagnostic, effect: 'seed' });
const script = (id, category, suffix, body, expected, extra = {}) => ({ id, category, kind: 'shebang', header: `/usr/bin/env ${suffix}`, body, expected, args: [], ...extra });
const direct = (id, category, argv, body, expected) => ({ id, category, kind: 'direct-env', argv, body, expected, args: [] });

export const rows = [
  script('s01', 'plain VFS Bash dispatch and positional binding', 'bash', printArgs, good('<./script>|<1>|<a b>\n'), { args: ['a b'] }),
  script('s02', 'unknown non-env interpreter refuses body', 'bash', 'printf unsafe > effect\n', bad(126, 'unsupported interpreter: /no-such-review-interpreter'), { header: '/no-such-review-interpreter', native: 'kernel-only-not-env-reference' }),
  script('s03', 'Linux non-S entire optional argument stays literal', 'bash -e', phase, bad(127, 'bash -e: command not found')),
  script('s04', 'split Bash errexit stops effects', '-S bash -e', phase, good('', 'before', 1)),
  script('s05', 'split Bash plus-e permits following effects', '-S bash +e', phase, good('', 'after')),
  script('s06', 'long split sh flag and positional binding', '--split-string=sh -e', printArgs, good('<./script>|<2>|<a b>\n'), { args: ['a b', 'tail'] }),
  script('s07', 'quote fragments and empty assignment', '-S MARK=pre"two words"\'end\' EMPTY="" bash', marker + 'printf "<%s>\\n" "$EMPTY"\n', good('<pretwo wordsend>\n<>\n')),
  script('s08', 'escaped tab underscore and hash', '-S MARK="left\\_right\\t\\#" bash', marker, good('<left right\t#>\n')),
  script('s09', 'split expands exports but not local variables', '-S MARK="${TOKEN}" OTHER="${LOCAL}" bash', marker + 'printf "<%s>\\n" "$OTHER"\n', good('<two words>\n<>\n'), { prelude: 'LOCAL=private; ' }),
  script('s10', 'ignore environment then explicit assignment', '-S -i PATH=@BIN@ MARK=clean bash', marker + 'printf "<%s>\\n" "${DROP-unset}"\n', good('<clean>\n<unset>\n')),
  script('s11', 'unset and repeated assignment order', '-S -u DROP MARK=first MARK=last bash', marker + 'printf "<%s>\\n" "${DROP-unset}"\n', good('<last>\n<unset>\n')),
  script('s12', 'chdir absolute script and child pwd', '-S -C sub bash', 'pwd\nprintf moved > effect\n', good('@ROOT@/sub\n'), { absolute: true, subEffect: 'moved' }),
  script('s13', 'option terminator and literal trailing argv', '-S -- bash --', printArgs, good('<./script>|<2>|<-e>\n'), { args: ['-e', ''] }),
  script('s14', 'Bash command-string arg0 and exit status', '-S bash -c \'printf "<%s>|<%s>\\n" "$0" "$1"; exit 7\'', 'printf unsafe > effect\n', good('<./script>|<tail>\n', 'seed', 7), { args: ['tail'] }),
  script('s15', 'sh standard-input flag does not execute file body', '-S sh -s', 'printf unsafe > effect\n', good('<sh>|<2>|<./script>\n'), { args: ['tail'], stdin: 'printf "<%s>|<%s>|<%s>\\n" "$0" "$#" "$1"\n' }),
  script('s16', 'malformed split quote rejects before dispatch', '-S MARK="unterminated bash', 'printf unsafe > effect\n', bad(125, 'env: .*quote')),
  script('s17', 'invalid interpreter flag preserves status two', '-S bash -Z', 'printf unsafe > effect\n', bad(2, 'bash: -Z: unsupported option')),
  script('s18', 'unknown env target literal lookup failure', '-S review-missing-interpreter', 'printf unsafe > effect\n', bad(127, 'review-missing-interpreter: command not found')),
  script('s19', 'literal metacharacter assignment cannot inject', '-S MARK=\'$(printf bad > injected); | & *\' bash', marker, good('<$(printf bad > injected); | & *>\n')),
  script('s20', 'env dispatches a second executable VFS script', '-S ./delegate', 'printf unsafe > effect\n', good('delegate:<./script>|<tail>\n'), { args: ['tail'], delegate: '#!/usr/bin/env bash\nprintf "delegate:<%s>|<%s>\\n" "$1" "$2"\n' }),
  direct('d01', 'accepted direct split quote control', ['-S', 'MARK="two words" bash', './script', 'tail'], marker + printArgs, good('<two words>\n<./script>|<1>|<tail>\n')),
  direct('d02', 'accepted direct non-S literal control', ['bash -e', './script'], phase, bad(127, 'bash -e: command not found')),
  direct('d03', 'accepted direct expansion before clear control', ['-S', '-i PATH=@BIN@ MARK=${TOKEN} bash', './script'], marker + 'printf "<%s>\\n" "${DROP-unset}"\n', good('<two words>\n<unset>\n')),
  direct('d04', 'accepted direct cwd control', ['-S', '-C sub bash', '@ROOT@/script'], 'pwd\n', good('@ROOT@/sub\n')),
];

export const hosts = [
  { id: 'h01', category: 'nested shebang shared command admission budget', assertion: 'maxCommands=2 rejects with ShellLimitError(maxCommands), before effect changes' },
  { id: 'h02', category: 'recursive shebang bounded depth', assertion: 'maxSubstitutionDepth=4 rejects with ShellLimitError(maxSubstitutionDepth)' },
  { id: 'h03', category: 'in-flight abort and registered cooperative cleanup', assertion: 'target entered, original abort reason returned, cleanup exactly once before settlement, no later effect' },
  { id: 'h04', category: 'live pipeline through env shebang', assertion: 'producer waits for downstream first byte before second; exact ab output; middleware sees env and cat; no buffering deadlock' },
  { id: 'h05', category: 'literal invoke exact replacement and input provenance', assertion: 'real registry invoke uses async ByteSource; probe receives exact KEEP map, literal script argv, abc bytes and explicit-input provenance; parent env unchanged' },
  { id: 'h06', category: 'nested script shared output budget', assertion: 'maxOutputBytes=2 rejects ShellLimitError(maxOutputBytes) on nested three-byte output; no silent budget reset' },
];

export function materialize(row, root, bin) {
  const replace = value => typeof value === 'string' ? value.replaceAll('@ROOT@', root).replaceAll('@BIN@', bin) : value;
  const result = JSON.parse(JSON.stringify(row));
  result.expected.stdout = replace(result.expected.stdout);
  result.header = replace(result.header);
  result.argv = result.argv?.map(replace);
  result.scriptPath = result.absolute ? `${root}/script` : './script';
  result.files = {
    script: { text: (result.kind === 'shebang' ? `#!${result.header}\n` : '') + result.body, mode: 0o755 },
    effect: { text: 'seed', mode: 0o644 },
    'sub/effect': { text: 'seed', mode: 0o644 },
    ...(result.delegate ? { delegate: { text: result.delegate, mode: 0o755 } } : {}),
  };
  return result;
}
