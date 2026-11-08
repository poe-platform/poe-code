export interface JobsNativeCase {
  readonly name: string;
  readonly source: string;
  readonly input?: string;
  readonly releaseOn?: string;
  readonly stdout: string;
  readonly stderr?: string;
  readonly stderrHex?: string;
  readonly exitCode?: number;
}

export const jobsNativeProfile = Object.freeze({
  version: "GNU Bash 5.2.37",
  sha256: "f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d",
  invocation: "--noprofile --norc -c SOURCE shell",
  locale: "C",
  jobControl: false,
  timeoutMs: 2000,
  cleanupTimeoutMs: 1000,
  outputBytes: 65536,
  supervision: "A detached Bash owner remains alive on a private pipe until both output streams end. Failed runs signal its owned group once and join close; cleanup deadline failures never count as qualification.",
  scope: "Noninteractive -c native qualification only; no virtual Shell acceptance.",
  waitNextEvidence: "Bash 5.2.37 jobs.c:wait_for_any_job accepts unnotified completed jobs; notify_of_job_status retains normal asynchronous exits for startup_state == 2 and subshell_environment == 0.",
});

export const jobsNativeUnqualified = Object.freeze([
  "Trapped-signal interruption of an already-entered wait: stdout readiness before the builtin is not a race-free wait-entry observation.",
  "Interactive/monitor-mode stopped jobs, process-group control, and wait -f stop-versus-exit behavior.",
  "Indexed/nameref -p destinations and status retention after unrelated notification, PID reuse, or bare-wait consumption.",
]);

const usage = "wait: usage: wait [-fn] [-p var] [id ...]\n";

export const jobsNativeCases: readonly JobsNativeCase[] = Object.freeze([
  { name: "whole AND/OR asynchronous launch", source: 'false && printf wrong || (exit 7) & token=$!; printf "launch:%s\\n" "$?"; wait "$token"; printf "wait:%s\\n" "$?"', stdout: "launch:0\nwait:7\n" },
  { name: "asynchronous pipeline status", source: 'set -o pipefail; (exit 7) | (exit 3) & token=$!; printf "launch:%s\\n" "$?"; wait "$token"; printf "wait:%s\\n" "$?"', stdout: "launch:0\nwait:3\n" },
  { name: "failed child lookup does not fail launch", source: '__jobs_missing_command__ & token=$!; printf "launch:%s\\n" "$?"; wait "$token"; printf "wait:%s\\n" "$?"', stdout: "launch:0\nwait:127\n", stderr: "shell: line 1: __jobs_missing_command__: command not found\n" },
  { name: "empty last-child parameter and empty wait", source: 'printf "before:<%s>\\n" "$!"; wait; printf "wait:%s\\n" "$?"', stdout: "before:<>\nwait:0\n" },
  { name: "specific repeated wait retains status and last identity", source: '(exit 7) & token=$!; wait "$token"; printf "first:%s\\n" "$?"; wait "$token"; printf "again:%s\\n" "$?"; [[ $! == "$token" ]]; printf "same:%s\\n" "$?"; wait; printf "all:%s\\n" "$?"', stdout: "first:7\nagain:7\nsame:0\nall:0\n" },
  { name: "operand order determines last waited status", source: '(exit 7) & first=$!; (exit 3) & second=$!; wait "$first" "$second"; printf "forward:%s\\n" "$?"; wait "$second" "$first"; printf "reverse:%s\\n" "$?"', stdout: "forward:3\nreverse:7\n" },
  { name: "bare wait does not adopt a failed child status", source: '(exit 7) & token=$!; wait; printf "all:%s\\n" "$?"', stdout: "all:0\n" },
  { name: "numeric non-child", source: 'wait 0; printf "status:%s\\n" "$?"', stdout: "status:127\n", stderr: "shell: line 1: wait: pid 0 is not a child of this shell\n" },
  { name: "invalid textual operand", source: 'wait missing; printf "status:%s\\n" "$?"', stdout: "status:1\n", stderr: "shell: line 1: wait: `missing': not a pid or valid job spec\n" },
  { name: "invalid numeric operand", source: 'wait 12x; printf "status:%s\\n" "$?"', stdout: "status:1\n", stderr: "shell: line 1: wait: `12x': not a pid or valid job spec\n" },
  { name: "option terminator preserves negative operand", source: 'wait -- -1; printf "status:%s\\n" "$?"', stdout: "status:1\n", stderr: "shell: line 1: wait: `-1': not a pid or valid job spec\n" },
  { name: "unknown job specification", source: 'wait %404; printf "status:%s\\n" "$?"', stdout: "status:127\n", stderr: "shell: line 1: wait: %404: no such job\n" },
  { name: "unknown short option", source: 'wait -Z; printf "status:%s\\n" "$?"', stdout: "status:2\n", stderr: `shell: line 1: wait: -Z: invalid option\n${usage}` },
  { name: "unknown long option", source: 'wait --unknown; printf "status:%s\\n" "$?"', stdout: "status:2\n", stderr: `shell: line 1: wait: --: invalid option\n${usage}` },
  { name: "missing p argument", source: 'wait -p; printf "status:%s\\n" "$?"', stdout: "status:2\n", stderr: `shell: line 1: wait: -p: option requires an argument\n${usage}` },
  { name: "invalid p destination precedes operand diagnosis", source: 'wait -n -p bad-name 0; printf "status:%s\\n" "$?"', stdout: "status:1\n", stderr: "shell: line 1: wait: `bad-name': not a valid identifier\n" },
  { name: "readonly p destination precedes operand diagnosis", source: 'readonly chosen=old; wait -n -p chosen 0; printf "status:%s chosen:%s\\n" "$?" "$chosen"', stdout: "status:1 chosen:old\n", stderr: "shell: line 1: wait: chosen: cannot unset: readonly variable\n" },
  { name: "last p option wins before identifier validation", source: 'bad=old; chosen=old; wait -p bad-name -p chosen; printf "status:%s chosen:<%s> bad:%s\\n" "$?" "${chosen-unset}" "$bad"', stdout: "status:0 chosen:<unset> bad:old\n" },
  { name: "p without operands unsets destination", source: 'chosen=old; wait -p chosen; printf "status:%s chosen:<%s>\\n" "$?" "${chosen-unset}"', stdout: "status:0 chosen:<unset>\n" },
  { name: "p assigns specific child without n", source: '(exit 7) & token=$!; chosen=old; wait -p chosen "$token"; status=$?; [[ $chosen == "$token" ]]; printf "status:%s identity:%s\\n" "$status" "$?"', stdout: "status:7 identity:0\n" },
  { name: "n with no jobs unsets destination", source: 'chosen=old; wait -n -p chosen; printf "status:%s chosen:<%s>\\n" "$?" "${chosen-unset}"', stdout: "status:127 chosen:<unset>\n" },
  { name: "n returns the sole child and its identity", source: '(exit 7) & token=$!; wait -n -p chosen; status=$?; [[ $chosen == "$token" ]]; printf "status:%s identity:%s\\n" "$status" "$?"', stdout: "status:7 identity:0\n" },
  { name: "n restricts its eligible set", source: '(exit 7) & first=$!; (exit 3) & second=$!; wait -n -p chosen "$first"; status=$?; [[ $chosen == "$first" ]]; printf "first:%s identity:%s\\n" "$status" "$?"; wait "$second"; printf "second:%s\\n" "$?"', stdout: "first:7 identity:0\nsecond:3\n" },
  { name: "n diagnoses all unknown operands", source: 'chosen=old; wait -n -p chosen 0 missing; printf "status:%s chosen:<%s>\\n" "$?" "${chosen-unset}"', stdout: "status:127 chosen:<unset>\n", stderr: "shell: line 1: wait: 0: no such job\nshell: line 1: wait: missing: no such job\n" },
  { name: "n reports unknown operand but still waits for eligible child", source: '(exit 7) & token=$!; wait -n -p chosen 0 "$token"; status=$?; [[ $chosen == "$token" ]]; printf "status:%s identity:%s\\n" "$status" "$?"', stdout: "status:7 identity:0\n", stderr: "shell: line 1: wait: 0: no such job\n" },
  { name: "option parsing stops at first operand", source: 'wait 0 -n; printf "status:%s\\n" "$?"', stdout: "status:1\n", stderr: "shell: line 1: wait: pid 0 is not a child of this shell\nshell: line 1: wait: `-n': not a pid or valid job spec\n" },
  { name: "invalid operand diagnostic retains raw byte", source: 'wait $\'\\xff\'; printf "status:%s\\n" "$?"', stdout: "status:1\n", stderrHex: "7368656c6c3a206c696e6520313a20776169743a2060ff273a206e6f74206120706964206f722076616c6964206a6f6220737065630a" },
  { name: "default asynchronous stdin does not consume parent input", source: 'read -r value & token=$!; wait "$token"; printf "child:%s\\n" "$?"; read -r value; printf "parent:%s\\n" "$value"', input: "parent-input\n", stdout: "child:1\nparent:parent-input\n" },
  { name: "explicit asynchronous stdin shares remaining cursor", source: '{ read -r value; printf "child:%s\\n" "$value"; } <&0 & token=$!; wait "$token"; read -r value; printf "parent:%s\\n" "$value"', input: "first\nsecond\n", stdout: "child:first\nparent:second\n" },
  { name: "live job identities and child shell identity relationships", source: 'parent=$BASHPID; { read -r gate; [[ $BASHPID != "$parent" && $$ == "$parent" ]]; printf "child:%s\\n" "$?"; } <&0 & first=$!; (exit 0) & second=$!; ((first > 0 && second > 0 && first != second)); identity=$?; [[ $! == "$second" ]] || identity=1; printf "ids:%s\\nrelease\\n" "$identity"; wait "$first"; wait "$second"; [[ $BASHPID == "$parent" ]]; printf "parent:%s\\n" "$?"', input: "go\n", releaseOn: "release\n", stdout: "ids:0\nrelease\nchild:0\nparent:0\n" },
  { name: "child snapshots variables exports positionals and functions before parent resumes", source: 'value=old; export visible=before; set -- before; fn() { printf "function:old\\n"; }; { read -r gate; printf "child:%s:%s:%s\\n" "$value" "$visible" "$1"; fn; value=child; } <&0 & token=$!; value=new; visible=after; set -- after; fn() { printf "function:new\\n"; }; printf "release\\n"; wait "$token"; printf "parent:%s:%s:%s\\n" "$value" "$visible" "$1"', input: "go\n", releaseOn: "release\n", stdout: "release\nchild:old:before:before\nfunction:old\nparent:new:after:after\n" },
  { name: "descriptor table snapshot survives parent rebind and child close", source: 'exec 4>&1; { read -r gate; printf "child\\n" >&4; exec 4>&-; } <&0 & token=$!; exec 4>&2; printf "release\\n"; wait "$token"; printf "parent\\n" >&4; exec 4>&-', input: "go\n", releaseOn: "release\n", stdout: "release\nchild\n", stderr: "parent\n" },
  { name: "natural EXIT precedes later child completion without replacing exit status", source: 'trap \'printf "exit:%s\\n" "$?"\' EXIT; { read -r gate; printf "child:%s\\n" "$gate"; } <&0 & exit 3', input: "go\n", releaseOn: "exit:3\n", stdout: "exit:3\nchild:go\n", exitCode: 3 },
].map(entry => Object.freeze(entry)));
