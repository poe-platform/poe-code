export const selectedKeys = ['KEEP', 'DROP', 'PUBLIC', 'SECRET', 'TEXT'];
export const baseEnv = { HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', DROP: 'remove-me', PUBLIC: 'parent-public', TEXT: 'two words;$(printf INJECTED > marker)', EMPTY: '' };
export const recordSource = 'printf "%s\\0" "$#" "$@"\n' + selectedKeys.map(key => `printf "%s\\0" "\${${key}+x}" "\${${key}-}"`).join('\n') + '\n';
export const nativeCases = [
  { id: 'quotes-empty-concatenated', args: ['-S', 'record alpha" beta" \'\' "" \'single "q"\''] },
  { id: 'long-option-preserves-tail', args: ['--split-string=record "front value"', 'tail value', ''] },
  { id: 'escapes-and-comments', args: ['-S', String.raw`record a\_b "c\_d" line\nend tab\tend \#literal before#mid # ignored`] },
  { id: 'variables-are-not-shell-code', args: ['-S', "record \"${TEXT}\" '${TEXT}' \\${TEXT} \"${MISSING}\" '; printf INJECTED > marker' '$(printf INJECTED)' '`printf INJECTED`' '*'"] },
  { id: 'split-before-ignore-environment', args: ['-S', '-i PATH=${PATH} KEEP=${TEXT} record exact'] },
  { id: 'unset-and-repeated-assignment', args: ['-S', '-u DROP KEEP=first KEEP=second record -- -x'] },
  { id: 'unsupported-dollar-stops-before-dispatch', args: ['-S', 'record $TEXT'] },
  { id: 'shebang-split-bash-errexit', header: '-S bash -e', body: 'printf before > phase\nfalse\nprintf forbidden >> phase\n', source: './script "a b"', shellArg0: 'shell' },
  { id: 'shebang-long-split-sh-argv', header: '--split-string=sh -e', body: 'printf "<%s>|<%s>|<%s>\\n" "$0" "$#" "$1"\nprintf kept > phase\n', source: './script "a b"', shellArg0: 'shell' },
  { id: 'non-split-header-one-argument', header: 'bash -e', body: 'printf reached > phase\n', source: './script', shellArg0: 'shell', policyExpected: { status: 126, stdoutHex: '', stderrHex: Buffer.from('shell: line 1: ./script: unsupported interpreter: /usr/bin/env bash -e\n').toString('hex'), effects: { phase: { hex: Buffer.from('seed').toString('hex'), mode: 0o644 } } } },
];
export const hostCases = [
  { id: 'transparent-input-presence', kind: 'input', variants: [{ name: 'default', hex: null, defaultOrigin: true }, { name: 'explicit-empty', hex: '', defaultOrigin: false }, { name: 'binary', hex: '00ffc3a90a', defaultOrigin: false }], command: 'entry | cat', split: '-i KEEP=value forward input', exactEnv: { KEEP: 'value' } },
  { id: 'shared-command-budget', kind: 'budget', command: 'entry', split: 'forward budget', maxCommands: 4, expectedTicks: ['first'], expectedLimit: 'maxCommands' },
  { id: 'typed-cancellation', kind: 'cancel', command: 'entry', split: 'forward cancel', expectedWaiterCalls: 1, reasonCode: 'ENOENT' },
];
export const protocol = {
  native: 'GNU coreutils env9.7 under both whole Bash profiles; never Apple env relabeled GNU. record is a native executable with an explicitly pinned Bash shebang; product record is an injected command through the unchanged public plugin API.',
  output: 'record emits argument count, each literal argument, then presence (x/empty) and value for KEEP,DROP,PUBLIC,SECRET,TEXT, each terminated by NUL. This selected-field protocol is declared before capture; it is not sorted/normalized environment output.',
  roles: 'PATH contains only isolated record,bash,sh role entries. -i case explicitly preserves that PATH via env expansion before clearing. No default-search host rescue. Direct GNU env processes use actual OS argv0 env; shell launch processes use bash, shell $0 shell.',
  mapping: 'Native temporary cwd corresponds to /packed. Native shebang interpreter path is the pinned GNU env binary; product header uses /usr/bin/env. Native script/header bytes and original literal optional-argument text are retained. Only phase/marker and unexpected non-fixture entries are effects; script/record/bin infrastructure hashes are retained separately.',
  shebang: 'Actual Darwin kernel invocation is captured, plus one explicit-single-optional-argument control for EACH shebang row in BOTH profiles. These controls are not replacement oracles. Non-S product126 policy is separately asserted, never called a native parity pass.',
  limits: 'No environment order assertion, native startup-PWD equality, new bash-c parameter-status case, ERR/inherit_errexit, creation-mask or custom-firstread requirement. Host3 contains5 executions; exact-env/input variants3 plus command-budget1 and cancellation1. No output-budget accounting-policy change.',
};
