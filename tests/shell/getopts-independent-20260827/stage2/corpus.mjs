const emit = `emit() { printf '%s|%s|%s|%s|%s|%s|%s\\n' "$1" "$2" "\${opt-UNSET}" "\${OPTIND-UNSET}" "\${OPTARG+x}" "\${OPTARG-}" "\${OPTERR-UNSET}"; }\n`;
const row = (label, status, option, index, argument = null, opterr = '1') => `${label}|${status}|${option}|${index}|${argument === null ? '' : 'x'}|${argument ?? ''}|${opterr}\n`;
const control = (id, purpose, body, stdout, extra = {}) => ({ id, purpose, productScript: emit + body + '\n', expectation: { stdout, status: 0, stderr: { kind: 'empty' } }, classification: 'Bash5.3 binding-profile expectation; not a candidate result', ...extra });
const attributes = 'declare -p OPTIND OPTERR\nprintf "__PRODUCT__\\n"\n';
const diagnostic = (text) => ({ kind: 'contains', text });

export const scripts = [
  control('N01', 'Fresh defaults, regular builtin discovery, direct/command routing and function shadowing', `printf 'defaults|%s|%s\\n' "$OPTIND" "$OPTERR"
type -t getopts
command -v getopts
type getopts
command -V getopts
getopts abc opt -abc; emit direct "$?"
getopts() { printf 'shadow\\n'; }
getopts
command getopts abc opt -abc; emit command "$?"`,
  'defaults|1|1\nbuiltin\ngetopts\ngetopts is a shell builtin\ngetopts is a shell builtin\n' + row('direct', 0, 'a', 1) + 'shadow\n' + row('command', 0, 'b', 1),
  { nativePrelude: attributes, startupAttributes: { OPTIND: { exported: false }, OPTERR: { exported: false } } }),
  control('N02', 'Inherited exported startup text resets to defaults; explicit argv does not replace positionals', `printf 'defaults|%s|%s\\n' "$OPTIND" "$OPTERR"
set -- -a positional
getopts ab: opt -b '雪🙂'; emit explicit "$?"
printf 'positionals|%s|%s\\n' "$1" "$2"
OPTIND=1
getopts ab: opt; emit positional "$?"`,
  'defaults|1|1\n' + row('explicit', 0, 'b', 3, '雪🙂') + 'positionals|-a|positional\n' + row('positional', 0, 'a', 2),
  { env: { OPTIND: '7', OPTERR: '0' }, nativePrelude: attributes, startupAttributes: { OPTIND: { exported: true }, OPTERR: { exported: true } } }),
  control('N03', 'Assignment origins reset; builtin writes and no-value export do not', `getopts abc opt -abc; emit first "$?"
getopts abc opt -abc; emit continuity "$?"
OPTIND=1; getopts abc opt -abc; emit plain "$?"
OPTIND=$OPTIND; getopts abc opt -abc; emit same "$?"
((OPTIND=1)); getopts abc opt -abc; emit arithmetic "$?"
read OPTIND < ./fixtures/reset-input.data; getopts abc opt -abc; emit read "$?"
for OPTIND in 1; do :; done; getopts abc opt -abc; emit for "$?"
export OPTIND=1; getopts abc opt -abc; emit export-value "$?"
export OPTIND; getopts abc opt -abc; emit export-bare "$?"
unset OPTIND; : "\${OPTIND:=1}"; getopts abc opt -abc; emit parameter "$?"`,
  row('first', 0, 'a', 1) + row('continuity', 0, 'b', 1) + ['plain', 'same', 'arithmetic', 'read', 'for', 'export-value'].map(label => row(label, 0, 'a', 1)).join('') + row('export-bare', 0, 'b', 1) + row('parameter', 0, 'a', 1),
  { fixtures: ['fixtures/reset-input.data'] }),
  control('N04', 'Prefix installation AND restoration reset, unlike local hidden-state restore', `getopts abc opt -abc; emit first "$?"
OPTIND=1 getopts abc opt -abc; emit prefix "$?"
getopts abc opt -abc; emit restored "$?"
getopts abc opt -abc; emit next "$?"`,
  row('first', 0, 'a', 1) + row('prefix', 0, 'a', 1) + row('restored', 0, 'a', 1) + row('next', 0, 'b', 1),
  { historical: 'Bash3.2 is separately observed against the selected 5.3 expectation, not required to agree.' }),
  control('N05', 'Local OPTIND restores FUNCTION ENTRY hidden cursor, not declaration-time cursor', `inner() {
getopts abcd opt -abcd; emit before-local "$?"
local OPTIND=1
getopts abcd opt -abcd; emit local "$?"
local OPTIND
getopts abcd opt -abcd; emit repeated-local "$?"
}
getopts abcd opt -abcd; emit parent "$?"
inner -different
getopts abcd opt -abcd; emit resumed "$?"`,
  row('parent', 0, 'a', 1) + row('before-local', 0, 'b', 1) + row('local', 0, 'a', 1) + row('repeated-local', 0, 'b', 1) + row('resumed', 0, 'b', 1),
  { historical: '5.3 entry snapshot is the selected profile; 3.2 cursor differences are retained.' }),
  control('N06', 'Dynamic OPTARG/OPTERR locals affect callees without independently saving OPTIND', `inner() { getopts ab: opt -b '雪🙂'; emit inner "$?"; }
outer() {
local OPTARG=local OPTERR=0
inner
emit local-after "$?"
OPTIND=1
getopts a opt -z; emit suppressed "$?"
}
OPTARG=global
outer
emit restored "$?"`,
  row('inner', 0, 'b', 3, '雪🙂', '0') + row('local-after', 0, 'b', 3, '雪🙂', '0') + row('suppressed', 0, '?', 2, null, '0') + row('restored', 0, '?', 2, 'global')),
  control('N07', 'Subshell, command substitution and pipeline clone isolation preserve parent cursor', `getopts abc opt -abc; emit parent "$?"
( getopts abc opt -abc; emit subshell "$?" )
captured=$(getopts abc opt -abc; emit substitution "$?")
printf '%s\\n' "$captured"
: | { getopts abc opt -abc; emit pipeline "$?"; }
getopts abc opt -abc; emit resumed "$?"`,
  row('parent', 0, 'a', 1) + ['subshell', 'substitution', 'pipeline', 'resumed'].map(label => row(label, 0, 'b', 1)).join('')),
  control('N08', 'Groups, explicit sourced VFS fixture, and eval share cursor', `getopts abcdef opt -abcdef; emit parent "$?"
{ getopts abcdef opt -abcdef; emit group "$?"; }
source ./fixtures/shared-source.data
eval 'getopts abcdef opt -abcdef; emit eval "$?"'
getopts abcdef opt -abcdef; emit resumed "$?"`,
  ['parent', 'group', 'source', 'eval', 'resumed'].map((label, index) => row(label, 0, 'abcde'[index], 1)).join(''),
  { fixtures: ['fixtures/shared-source.data'] }),
  control('N09', 'Function without local OPTIND shares cursor; set/shift and function positional restoration are not resets', `helper() { getopts abc opt -abc; emit function "$?"; }
set -- unused -abc
shift
getopts abc opt; emit positional "$?"
helper -other
printf 'parent-argv|%s\\n' "$1"
set -- -abc
getopts abc opt; emit set "$?"`,
  row('positional', 0, 'a', 1) + row('function', 0, 'b', 1) + 'parent-argv|-abc\n' + row('set', 0, 'c', 2)),
  control('N10', 'Result aliases do not emit assignment-origin reset; Unicode values bind intact', `getopts abc OPTIND -abc; emit index-alias "$?"
getopts abc opt -abc; emit continued "$?"
OPTIND=1
getopts a: OPTARG -a '雪🙂'; emit argument-alias "$?"
OPTIND=1
getopts a: opt -a '雪🙂'; emit unicode "$?"`,
  row('index-alias', 0, 'UNSET', 0) + row('continued', 0, 'b', 1) + row('argument-alias', 0, 'b', 3, 'a') + row('unicode', 0, 'a', 3, '雪🙂')),
  control('N11', 'Invalid scalar names are late binding failures; missing operands do not scan; safe prototype-like name', `OPTARG=old
getopts abc bad-name -abc; emit invalid "$?"
getopts abc opt -abc; emit next "$?"
getopts abc; emit usage "$?"
getopts abc 'bad[0]' -abc; emit array-name "$?"
getopts abc opt -abc; emit end "$?"
OPTIND=1
getopts abc __proto__ -abc
printf 'prototype-key|%s|%s\\n' "$?" "$__proto__"`,
  row('invalid', 1, 'UNSET', 1) + row('next', 0, 'b', 1) + row('usage', 2, 'b', 1) + row('array-name', 1, 'b', 2) + row('end', 1, '?', 2) + 'prototype-key|0|a\n',
  { stderr: diagnostic(['bad-name', 'not a valid identifier', 'usage:', 'bad[0]']), productPolicy: 'Scalar identifiers only; no array/nameref capability introduced. Diagnostic spelling is not universally byte-equal across hosts.' }),
  control('N12', 'Readonly OPTIND versus readonly destination: native partial writes/status are observations pending root policy', `(
readonly OPTIND
getopts ab opt -ab; emit readonly-index-first "$?"
getopts ab opt -ab; emit readonly-index-next "$?"
getopts ab opt -ab; emit readonly-index-end "$?"
)
(
readonly opt=old
getopts ab opt -ab; emit readonly-name-first "$?"
getopts ab opt -ab; emit readonly-name-next "$?"
getopts ab opt -ab; emit readonly-name-end "$?"
)`,
  row('readonly-index-first', 0, 'a', 1) + row('readonly-index-next', 0, 'b', 1) + row('readonly-index-end', 1, '?', 1) + row('readonly-name-first', 2, 'old', 1) + row('readonly-name-next', 2, 'old', 2) + row('readonly-name-end', 1, 'old', 2),
  { stderr: diagnostic(['OPTIND: readonly variable', 'opt: readonly variable']), productPolicy: 'D01: do not infer product statuses/partial-write order solely from native observations; readonly attributes must survive.' }),
  control('N13', 'Native readonly OPTARG deletion quirk is evidence of an intentional product divergence', `readonly OPTARG=old
getopts a:b opt -a value -b; emit readonly-set "$?"
getopts a:b opt -a value -b; emit no-argument "$?"
getopts a:b opt -a value -b; emit eof "$?"
unset OPTARG; emit ordinary-unset "$?"`,
  row('readonly-set', 0, 'a', 3, 'old') + row('no-argument', 0, 'b', 4) + row('eof', 1, '?', 4) + row('ordinary-unset', 0, '?', 4),
  { stderr: diagnostic(['OPTARG: readonly variable']), productPolicy: 'INTENTIONAL DIVERGENCE: retain OPTARG=old and its readonly attribute through all getopts unset intents; ordinary unset must still refuse. D01 leaves exact failure statuses/other partial effects pending.' }),
  control('N14', 'Failed assignment origins: readonly export/read/local/prefix are not interchangeable reset events', `(
getopts abc opt -abc; readonly OPTIND
export OPTIND=1; emit export-failed "$?"
getopts abc opt -abc; emit after-export "$?"
)
(
getopts abc opt -abc; readonly OPTIND
read OPTIND < ./fixtures/reset-input.data; emit read-failed "$?"
getopts abc opt -abc; emit after-read "$?"
)
(
getopts abc opt -abc; readonly OPTIND
inner() { local OPTIND=1; emit local-failed "$?"; getopts abc opt -abc; emit local-next "$?"; }
inner
getopts abc opt -abc; emit after-local "$?"
)
(
getopts abc opt -abc; readonly OPTIND
OPTIND=1 getopts abc opt -abc; emit prefix-failed "$?"
getopts abc opt -abc; emit after-prefix "$?"
)`,
  row('export-failed', 1, 'a', 1) + row('after-export', 0, 'a', 1) + row('read-failed', 1, 'a', 1) + row('after-read', 0, 'b', 1) + row('local-failed', 1, 'a', 1) + row('local-next', 0, 'b', 1) + row('after-local', 0, 'c', 1) + row('prefix-failed', 0, 'b', 1) + row('after-prefix', 0, 'c', 1),
  { fixtures: ['fixtures/reset-input.data'], stderr: diagnostic(['OPTIND: readonly variable']), productPolicy: 'D01: failed-origin side effects/status need explicit root approval; never treat failed local as a successful hidden-state restore frame.' }),
  control('N15', 'Fresh unvalued local removes integer binding; larger-index local restores caller; bare readonly declaration does not reset', `first() { local OPTIND; OPTIND='1+1'; printf 'local-text|%s\\n' "$OPTIND"; getopts abc opt -abc operand; emit local-unset "$?"; }
second() { local OPTIND=2; getopts abc opt -abc operand; emit local-two "$?"; }
getopts abc opt -abc operand; emit parent "$?"
first
second
getopts abc opt -abc operand; emit resumed "$?"
readonly OPTIND
getopts abc opt -abc operand; emit bare-readonly "$?"`,
  row('parent', 0, 'a', 1) + 'local-text|1+1\n' + row('local-unset', 0, 'a', 1) + row('local-two', 0, 'b', 2) + row('resumed', 0, 'b', 1) + row('bare-readonly', 0, 'c', 1),
  { stderr: diagnostic(['OPTIND: readonly variable']), productPolicy: 'Supported scalar local/readonly declarations only, not declare/typeset flags. Readonly final status is native observation under D01.' }),
  control('N16', 'Diagnostic materialization to stderr, OPTERR suppression, silent mode, and supported leading delimiter', `getopts a opt -z; emit normal "$?"
OPTIND=1; OPTERR=0
getopts a opt -z; emit suppressed "$?"
OPTIND=1; OPTERR=1
getopts :a opt -z; emit silent "$?"
OPTIND=1
getopts -- a opt -a; emit delimiter "$?"`,
  row('normal', 0, '?', 2) + row('suppressed', 0, '?', 2, null, '0') + row('silent', 0, '?', 2, 'z') + row('delimiter', 0, 'a', 2),
  { stderr: { kind: 'contains-count', text: 'illegal option -- z', count: 1 }, productPolicy: 'Only integration diagnostic effects, not a replacement scanner projection matrix. Host sink-failure behavior is I09, not a native shell script.' }),
].map(entry => ({ ...entry, expectation: { ...entry.expectation, stderr: entry.stderr ?? entry.expectation.stderr } }));

export const profiles = [
  { id: 'bash53', binary: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash', sha256: '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c', version: '5.3.0(1)-release', role: 'selected Darwin binding profile' },
  { id: 'bash32', binary: '/bin/bash', sha256: '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3', version: '3.2.57(1)-release', role: 'separate historical Darwin observations; selected-profile mismatches are not candidate failures' },
];
