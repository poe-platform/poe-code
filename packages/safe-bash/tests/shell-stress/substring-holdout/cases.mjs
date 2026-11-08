const specimen = (id, script, files = {}) => ({ id, script, files, stdin: '', args: [] });

export const nativeCases = [
  specimen('positive-slice-grid', 'VALUE=abcdefghij; printf "<%s>|<%s>|<%s>" "${VALUE:0:1}" "${VALUE:2:3}" "${VALUE:8:6}"'),
  specimen('omitted-empty-zero-length', 'VALUE=abcdefghij; printf "<%s>|<%s>|<%s>" "${VALUE:3}" "${VALUE:3:}" "${VALUE:3:0}"'),
  specimen('negative-offset-spelling', 'VALUE=abcdefghij; printf "<%s>|<%s>|<%s>" "${VALUE:0:2}" "${VALUE: -3:2}" "${VALUE:(-3):2}"'),
  specimen('beyond-either-bound', 'VALUE=abcdefghij; printf "<%s>|<%s>|<%s>" "${VALUE:99:2}" "${VALUE: -99:2}" "${VALUE:10:3}"'),
  specimen('negative-length-endpoint', 'VALUE=abcdefghij; printf "before|"; printf "<%s>|after" "${VALUE:2:-2}"'),
  specimen('negative-length-inverted', 'VALUE=abcdefghij; printf before > phase; printf "<%s>" "${VALUE:8:-4}"; printf after > phase', { phase: 'seed' }),
  specimen('arithmetic-names', 'VALUE=abcdefghij; START=1; WIDTH=2; printf "<%s>" "${VALUE:START+1:WIDTH*2}"'),
  specimen('arithmetic-increment-order', 'VALUE=abcdefghij; START=1; WIDTH=2; printf "<%s>" "${VALUE:START++:++WIDTH}"; printf "|%s:%s" "$START" "$WIDTH"'),
  specimen('ternary-short-circuit', 'VALUE=abcdefghij; FLAG=0; LEFT=0; RIGHT=1; printf "<%s>" "${VALUE:(FLAG?++LEFT:++RIGHT):2}"; printf "|%s:%s" "$LEFT" "$RIGHT"'),
  specimen('unparenthesized-ternary-colons', 'VALUE=abcdefghij; FLAG=1; printf "<%s>" "${VALUE:FLAG ? 2 : 4:2}"'),
  specimen('default-versus-negative-offset', 'VALUE=abcdefghij; EMPTY=; printf "<%s>|<%s>|<%s>|<%s>" "${VALUE:-3}" "${VALUE: -3}" "${EMPTY:-3}" "${MISSING:-3}"'),
  specimen('empty-unset-arithmetic-effects', 'EMPTY=; INDEX=1; printf "<%s>|<%s>" "${EMPTY:INDEX++:2}" "${MISSING:INDEX++:2}"; printf "|%s" "$INDEX"'),
  specimen('nested-default-arithmetic-words', 'VALUE=abcdefghij; printf "<%s>" "${VALUE:${START:-2}:${WIDTH:-3}}"'),
  specimen('offset-length-command-effects', 'VALUE=abcdefghij; printf "<%s>" "${VALUE:$(printf 2; printf offset > offset):$(printf 3; printf length > length)}"; printf "|after"', { offset: 'seed-offset', length: 'seed-length' }),
  specimen('quoted-and-split-fields', 'VALUE=" aa bb cc "; IFS=" "; set -- ${VALUE:1:5}; printf "[%s][%s][%s]|<%s>" "$#" "$1" "$2" "${VALUE:1:5}"'),
  specimen('nonwhite-ifs-boundary', 'VALUE=":ab:cd:"; IFS=:; set -- ${VALUE:0:6}; printf "[%s][%s][%s][%s]" "$#" "$1" "$2" "$3"'),
  specimen('empty-quoted-concatenation', 'VALUE=abc; set -- "L${VALUE:99:2}R" "${VALUE:1:0}" ${VALUE:1:0}; printf "[%s][%s][%s]" "$#" "$1" "$2"'),
  specimen('scalar-positional-parameters', 'set -- 012345 uvwxyz; printf "<%s>|<%s>" "${1:2:3}" "${2: -2}"'),
  specimen('division-error-before-after-effects', 'printf before > phase; VALUE=abc; printf "<%s>" "${VALUE:1/0:2}"; printf after > phase', { phase: 'seed' }),
  specimen('late-malformed-expansion-same-line', 'printf before > phase; VALUE=abc; printf "%s" "${VALUE:1:2"; printf after > phase', { phase: 'seed' }),
  specimen('invalid-octal-offset', 'printf before > phase; VALUE=abcdefghij; printf "<%s>" "${VALUE:08:2}"; printf after > phase', { phase: 'seed' }),
  specimen('unicode-single-boundaries', 'VALUE="Aé猫🙂Z"; printf "<%s>|<%s>" "${VALUE:1:1}" "${VALUE:3:1}"'),
  specimen('unicode-negative-and-tail', 'VALUE="Aé猫🙂Z"; printf "<%s>|<%s>" "${VALUE: -2:1}" "${VALUE:2:99}"'),
  specimen('combining-codepoints-not-graphemes', 'VALUE="éx"; printf "%s|<%s>|<%s>" "${#VALUE}" "${VALUE:1:1}" "${VALUE:1:2}"'),
];

export const hostCases = [
  { id: 'substring-expansion-budget', script: 'printf "%s" "${SUBSTRING_PAYLOAD:0:4096}"; mark after', environment: { SUBSTRING_PAYLOAD: 'x'.repeat(8192) }, limits: { maxExpansionBytes: 64, maxOutputBytes: 16384 }, expected: 'typed maxExpansionBytes rejection, zero output and zero mark calls' },
  { id: 'cancel-offset-host-late-rejection', script: 'printf "%s" "${VALUE:$(offset):2}"; mark after', environment: { VALUE: 'abcdef' }, expected: 'offset entered; caller abort identity retained; late rejection observed; zero output/mark calls' },
];

export const policy = {
  primary: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash',
  primarySha256: '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c',
  historical: '/bin/bash',
  locales: ['C', 'en_US.UTF-8'],
  argv0: 'bash',
  shellName: 'shell',
  environment: { PATH: '/nonexistent', HOME: '/nonexistent', TZ: 'UTC' },
  deadlineMs: 3000,
  compare: ['stdout', 'stderr', 'status', 'entries'],
  normalization: 'none; preserve raw bytes and relative file effects, including modes',
};
