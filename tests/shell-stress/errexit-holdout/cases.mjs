const file = text => ({ text, mode: 0o644 });
const specimen = (id, script, extra = {}) => ({ id, script, launch: 'c', args: [], stdin: '', ...extra, files: { trace: file(''), ...extra.files } });

export const cases = [
  specimen('E01', "set -e; printf 'before\\n'; printf 'before\\n' >> trace; false; printf 'after\\n' >> trace; printf 'after\\n'"),
  specimen('E02', "set -e; set +e; false; printf 'disabled\\n' >> trace; set -e; false; printf 'after\\n' >> trace"),
  specimen('E03', "set -o errexit; set +o errexit; false; printf 'disabled\\n'; set -o errexit; false; printf 'after\\n'"),
  specimen('E04', "set -e; case $- in *e*) printf 'enabled\\n';; *) printf 'absent\\n';; esac; set +e; case $- in *e*) printf 'still-enabled\\n';; *) printf 'disabled\\n';; esac; false; printf 'survived\\n'"),
  specimen('E05', "set -e; false && printf 'skipped\\n' >> trace; printf 'continued\\n'; true && printf 'right\\n' >> trace"),
  specimen('E06', "set -e; true && false; printf 'after\\n' >> trace"),
  specimen('E07', "set -e; false || printf 'recovered\\n'; false || false; printf 'after\\n' >> trace"),
  specimen('E08', "set -e; probe() { false; printf 'body\\n' >> trace; false; }; ! probe; printf 'negated=%s\\n' \"$?\""),
  specimen('E09', "set -e; if false; printf 'condition\\n' >> trace; false; then printf 'then\\n'; else printf 'else\\n'; fi; printf 'after\\n' >> trace"),
  specimen('E10', "set -e; count=0; probe() { false; count=$((count+1)); printf '%s\\n' \"$count\" >> trace; [ \"$count\" -lt 2 ]; }; while probe; do printf 'body=%s\\n' \"$count\"; done; printf 'done=%s\\n' \"$count\""),
  specimen('E11', "set -e; count=0; probe() { false; count=$((count+1)); printf '%s\\n' \"$count\" >> trace; [ \"$count\" -ge 2 ]; }; until probe; do printf 'body=%s\\n' \"$count\"; done; printf 'done=%s\\n' \"$count\""),
  specimen('E12', "set -e; count=0; while [ \"$count\" -lt 2 ]; do count=$((count+1)); printf '%s\\n' \"$count\" >> trace; false; printf 'body-after\\n'; done; printf 'after\\n'"),
  specimen('E13', "set -e; count=0; until [ \"$count\" -ge 2 ]; do count=$((count+1)); printf '%s\\n' \"$count\" >> trace; false; printf 'body-after\\n'; done; printf 'after\\n'"),
  specimen('E14', "set -e; probe() { printf 'entered\\n' >> trace; false; printf 'body-after\\n'; }; probe; printf 'after\\n'"),
  specimen('E15', "set +e; probe() { set -e; false; printf 'ignored\\n' >> trace; }; if probe; then printf 'then\\n'; fi; false; printf 'after\\n'"),
  specimen('E16', "set +e; probe() { set -e; false; printf 'ignored\\n' >> trace; }; probe && false; printf 'after\\n'"),
  specimen('E17', "set +e; probe() { set -e; false; printf 'ignored\\n' >> trace; return 7; }; probe || printf 'fallback=%s\\n' \"$?\"; false; printf 'after\\n'"),
  specimen('E18', "set -e; probe() { printf 'entered\\n' >> trace; false; printf 'body-after\\n'; }; true && probe; printf 'after\\n'"),
  specimen('E19', "set -e; probe() { printf 'entered\\n' >> trace; false; printf 'body-after\\n'; }; false || probe; printf 'after\\n'"),
  specimen('E20', "set +e; inner() { set -e; false; printf 'inner\\n' >> trace; }; outer() { inner; false; printf 'outer\\n' >> trace; }; if outer; then printf 'then\\n'; fi; false; printf 'after\\n'"),
  specimen('E21', "set -e; probe() { set +e; false; printf 'body\\n' >> trace; }; probe; false; printf 'parent-survived\\n'"),
  specimen('E22', "set -e; probe() { printf 'entered\\n' >> trace; false && printf 'skipped\\n'; }; probe; printf 'after\\n'"),
  specimen('E23', "set -e; probe() { printf 'entered\\n' >> trace; return 7; printf 'body-after\\n'; }; probe; printf 'after\\n'"),
  specimen('E24', "set -e; probe() { false; printf 'ignored\\n' >> trace; return 7; printf 'body-after\\n'; }; if probe; then printf 'then\\n'; else printf 'returned=%s\\n' \"$?\"; fi; printf 'after\\n' >> trace"),
  specimen('E25', "set -e; source ./piece; printf 'after\\n'", { files: { piece: file("printf 'source\\n' >> trace; false; printf 'source-after\\n'\n") } }),
  specimen('E26', "set +e; if . ./piece; then printf 'then\\n'; fi; false; printf 'after\\n'", { files: { piece: file("set -e; false; printf 'dot-ignored\\n' >> trace\n") } }),
  specimen('E27', "set -e; . ./piece; false; printf 'parent-survived\\n'", { files: { piece: file("set +e; false; printf 'dot-disabled\\n' >> trace\n") } }),
  specimen('E28', "set -e; eval 'printf \"eval\\n\" >> trace; false; printf \"eval-after\\n\"'; printf 'after\\n'"),
  specimen('E29', "set +e; if eval 'set -e; false; printf \"eval-ignored\\n\" >> trace'; then printf 'then\\n'; fi; false; printf 'after\\n'"),
  specimen('E30', "set -e; . ./piece || printf 'returned=%s\\n' \"$?\"; printf 'after\\n' >> trace", { files: { piece: file("false; printf 'source-ignored\\n' >> trace; return 6; printf 'source-after\\n'\n") } }),
  specimen('E31', "set -e; ( printf 'subshell\\n' >> trace; false; printf 'child-after\\n' ); printf 'parent-after\\n'"),
  specimen('E32', "set -e; ! ( false; printf 'ignored\\n' >> trace; false ); printf 'negated=%s\\n' \"$?\""),
  specimen('E33', "set -e; probe() { false; printf 'function\\n' >> trace; }; if ( probe; false; printf 'subshell\\n' >> trace ); then printf 'then\\n'; fi; printf 'after\\n'"),
  specimen('E34', "set -e; value=$(printf 'child\\n' >> trace; false; printf 'value'); printf 'value=<%s>\\n' \"$value\"; printf 'parent\\n' >> trace"),
  specimen('E35', "set -e; printf 'argument=<%s>\\n' \"$(printf 'child\\n' >> trace; false; printf 'value')\"; printf 'parent\\n' >> trace"),
  specimen('E36', "set +e; printf 'argument=<%s>\\n' \"$(set -e; printf 'child\\n' >> trace; false; printf 'value')\"; printf 'parent\\n' >> trace"),
  specimen('E37', "set -e; first=$(false) second=$(printf 'second'); printf '<%s><%s>\\n' \"$first\" \"$second\"; first=$(printf 'first') second=$(false); printf 'after\\n' >> trace"),
  specimen('E38', "set -e; value=$(inner=$(false; printf 'inner'); printf 'outer:<%s>' \"$inner\"); printf 'value=<%s>\\n' \"$value\"; printf 'parent\\n' >> trace"),
  specimen('E39', "set -e; false | true; printf 'pipeline=%s\\n' \"$?\"; printf 'after\\n' >> trace"),
  specimen('E40', "set -e; set -o pipefail; false | true; printf 'after\\n' >> trace"),
  specimen('E41', "set -e; true | false; printf 'after\\n' >> trace"),
  specimen('E42', "set -e; set -o pipefail; left() { false; printf 'left\\n' >> left; return 3; }; right() { false; printf 'right\\n' >> right; return 4; }; if left | right; then printf 'then\\n'; else printf 'pipeline=%s\\n' \"$?\"; fi; printf 'after\\n' >> trace", { files: { left: file(''), right: file('') } }),
  specimen('E43', "set -e; probe() { printf 'entered\\n' >> trace; false; printf 'body-after\\n'; }; true | probe; printf 'after\\n'"),
  specimen('E44', "set -e; probe() { set -e; false; printf 'left\\n' >> trace; printf 'payload\\n'; }; probe | cat; printf 'pipeline=%s\\n' \"$?\"; printf 'after\\n' >> trace"),
  specimen('E45', "set -e; ( false; printf 'subshell\\n' >> trace; printf 'payload\\n' ) | cat; printf 'pipeline=%s\\n' \"$?\"; printf 'after\\n' >> trace"),
  specimen('E46', "set -e; probe() { cat; printf 'drained\\n' >> trace; false; printf 'body-after\\n'; }; printf 'payload\\n' | probe; printf 'after\\n'"),
  specimen('E47', "set -e; probe() { false; printf 'ignored\\n' >> trace; exit 9; }; if probe; then printf 'then\\n'; fi; printf 'after\\n'"),
  specimen('E48', "set -e; bash -c 'false; printf \"child-survived\\n\" >> trace; printf \"child\\n\"' child; printf 'parent\\n' >> trace"),
  specimen('E49', "set +e; sh -ec 'printf \"child\\n\" >> trace; false; printf \"child-after\\n\"' child; printf 'child-status=%s\\n' \"$?\"; printf 'parent\\n' >> trace"),
  specimen('E50', "printf 'name=%s arg=%s\\n' \"$0\" \"$1\"; false; printf 'after\\n' >> trace", { launch: 'ec', args: ['literal; false'] }),
  specimen('E51', "false || printf 'recovered\\n'; printf 'name=%s arg=%s\\n' \"$0\" \"$1\"; false; printf 'after\\n' >> trace", { launch: 'e-c', args: ['two words'] }),
  specimen('E52', "printf 'name=%s arg=%s\\n' \"$0\" \"$1\"; false; printf 'after\\n' >> trace\n", { launch: 'es', args: ['stdin-argument'] }),
  specimen('E53', "printf 'name=%s arg=%s\\n' \"$0\" \"$1\"; false; printf 'after\\n' >> trace\n", { launch: 'file', args: ['file-argument'] }),
  specimen('E54', "set -e; eval 'set +e; false; printf \"eval-disabled\\n\" >> trace'; ( set -e; false; printf 'child-after\\n' ); printf 'child-status=%s\\n' \"$?\"; false; printf 'parent-survived\\n'"),
];

export const hostCases = [
  { id: 'H01', script: 'set -e; bridge "literal; false"; mark after', limits: { maxCommands: 30 }, contract: 'Literal nested interpreter invocation preserves arguments and stops both child and calling shell on failure.' },
  { id: 'H02', script: 'set -e; bridge; mark after', limits: { maxCommands: 6 }, contract: 'Nested interpreter and caller share maxCommands; no post-limit command runs.' },
  { id: 'H03', script: 'set -e; bridge; mark after', limits: { maxCommands: 30 }, contract: 'Caller cancellation reaches nested work with reason identity; late rejection is observed without later commands.' },
  { id: 'H04', script: 'set -e; set -o pipefail; burst | cat; mark after', limits: { maxCommands: 30, maxOutputBytes: 4096 }, contract: 'Nonzero pipeline drains awaited byte output before errexit returns; no trailing command runs.' },
];

export const binaryProfiles = [
  { id: 'gnu53', path: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash', sha256: '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c', versionPrefix: '5.3.' },
  { id: 'apple32', path: '/bin/bash', sha256: '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3', versionPrefix: '3.2.' },
];

export function invocation(specimen, role) {
  const prefix = ['--noprofile', '--norc'];
  if (specimen.launch === 'es') return { argv0: role, args: [...prefix, '-es', ...specimen.args], stdin: specimen.script, commandName: role };
  if (specimen.launch === 'file') return { argv0: role, args: [...prefix, '-e', 'program', ...specimen.args], stdin: specimen.stdin, commandName: 'program' };
  const flags = specimen.launch === 'ec' ? ['-ec'] : specimen.launch === 'e-c' ? ['-e', '-c'] : ['-c'];
  return { argv0: role, args: [...prefix, ...flags, specimen.script, 'shell', ...specimen.args], stdin: specimen.stdin, commandName: 'shell' };
}

export function initialFiles(specimen) {
  return specimen.launch === 'file' ? { ...specimen.files, program: file(specimen.script) } : specimen.files;
}
