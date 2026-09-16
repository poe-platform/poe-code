import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";
import { nativeOptions, runNative } from "./oracle.js";

// Five child-shell fixtures explicitly override executable binding for the native oracle;
// these overrides are not byte-identical sources. All other native sources pass through unchanged.
const cases: readonly [name: string, source: string, input?: string | undefined, nativeBindingOverride?: string][] = [
  ["normal EOF", `trap 'printf "exit:%s\\n" "$?"' EXIT; printf 'body\\n'`],
  ["last failure", `trap 'printf "exit:%s\\n" "$?"' EXIT; false`],
  ["explicit exit", `trap 'printf "exit:%s\\n" "$?"' EXIT; exit 7; printf unreachable`],
  ["implicit exit status", `trap 'printf "exit:%s\\n" "$?"' EXIT; false; exit`],
  ["handler failure preserves original", `trap 'false' EXIT; exit 7`],
  ["handler explicit override", `trap 'printf "exit:%s\\n" "$?"; exit 9' EXIT; exit 7`],
  ["handler zero override", `trap 'exit 0' EXIT; exit 7`],
  ["ignore exit", `trap '' EXIT; exit 3`],
  ["remove handler", `trap 'printf bad' EXIT; trap - EXIT; exit 3`],
  ["numeric reset", `trap 'printf bad' EXIT; trap 0; exit 3`],
  ["numeric name", `trap 'printf "exit:%s\\n" "$?"' 0; exit 4`],
  ["replacement", `trap 'printf bad' EXIT; trap 'printf good' EXIT`],
  ["late expansion", `value=before; trap 'printf "%s" "$value"' EXIT; value=after`],
  ["multiple parse units", `trap 'printf exit' EXIT\nprintf body\nfalse`],
  ["function installs shell handler", `f() { trap 'printf exit' EXIT; printf body; }; f; printf after`],
  ["function exit sees locals", `f() { local value=local; trap 'printf "%s:%s:%s" "$value" "$1" "$?"' EXIT; exit 5; }; f argument`],
  ["errexit", `trap 'printf "exit:%s" "$?"' EXIT; set -e; false; printf bad`],
  ["ignored errexit", `trap 'printf "exit:%s" "$?"' EXIT; set -e; false || printf recovered`],
  ["errexit inside handler", `trap 'false; printf bad' EXIT; set -e; exit 0`],
  ["subshell does not run inherited exit", `trap 'printf parent' EXIT; (printf child)`],
  ["subshell replaces handler", `trap 'printf parent' EXIT; (trap 'printf child' EXIT; exit 2); printf after`],
  ["subshell failure", `(trap 'printf "child:%s" "$?"' EXIT; false)`],
  ["substitution excludes inherited exit", `trap 'printf parent' EXIT; value=$(printf child); printf '<%s>' "$value"`],
  ["substitution runs its handler", `value=$(trap 'printf exit' EXIT; printf body; exit 3); printf '<%s>' "$value"`],
  ["pipeline child handler", `{ trap 'printf child' EXIT; printf body; } | { read -r value; printf '<%s>' "$value"; }`],
  ["source shares handler", `. /dev/stdin; printf after`, `trap 'printf "exit:%s" "$?"' EXIT; return 4`],
  ["source exit", `. /dev/stdin; printf bad`, `trap 'printf "exit:%s" "$?"' EXIT; exit 4`],
  ["eval installs handler", `eval 'trap "printf exit" EXIT'; printf body`],
  ["eval exit", `trap 'printf "exit:%s" "$?"' EXIT; eval 'exit 6'; printf bad`],
  ["child command string", `trap 'printf parent' EXIT; bash -c 'trap "printf child" EXIT; exit 3'; printf after`, undefined, `trap 'printf parent' EXIT; "$BASH" -c 'trap "printf child" EXIT; exit 3'; printf after`],
  ["child script file", `trap 'printf parent' EXIT; bash /dev/stdin; printf after`, `trap 'printf child' EXIT; exit 3`, `trap 'printf parent' EXIT; "$BASH" /dev/stdin; printf after`],
  ["child stdin", `trap 'printf parent' EXIT; bash -s; printf after`, `trap 'printf child' EXIT; exit 3`, `trap 'printf parent' EXIT; "$BASH" -s; printf after`],
  ["listing", `trap 'printf "quote'"'"'s"' EXIT; trap -p EXIT; trap - EXIT`],
  ["function shadows builtin", `trap() { printf function; }; trap; builtin trap 'printf exit' EXIT; command -v trap; type -t trap`],
  ["ERR without errexit", `trap 'printf "err:%s;" "$?"' ERR; false; printf after`],
  ["ERR and EXIT", `trap 'printf "err:%s;" "$?"' ERR; trap 'printf "exit:%s;" "$?"' EXIT; set -e; false`],
  ["ERR preserves status", `trap 'true' ERR; false; printf 'status:%s' "$?"`],
  ["ERR explicit exit", `trap 'exit 9' ERR; false; printf bad`],
  ["ERR ignored conditions", `trap 'printf bad' ERR; false || :; if false; then :; fi; ! true; true && false || :`],
  ["ERR function not inherited", `trap 'printf "err:%s;" "$?"' ERR; f() { false; printf body; }; f; printf after`],
  ["ERR function failure", `trap 'printf "err:%s;" "$?"' ERR; f() { false; }; f; printf after`],
  ["ERR errtrace inheritance", `trap 'printf "err:%s;" "$?"' ERR; set -E; f() { false; printf body; }; f; printf after`],
  ["ERR trace disabled", `set -E; trap 'printf bad' ERR; set +E; f() { false; printf body; }; f`],
  ["ERR function own trap", `f() { trap 'printf "err:%s;" "$?"' ERR; false; printf body; }; f`],
  ["ERR pipeline", `trap 'printf "err:%s;" "$?"' ERR; set -o pipefail; false | true; printf after`],
  ["ERR pipeline command retains quoted arguments", `set -o pipefail; trap 'printf "[%s:%s]" "$?" "$BASH_COMMAND"' ERR; false | true 'quoted argument'; trap - ERR`],
  ["ERR pipeline group does not replace parent command", `set -o pipefail; trap 'printf "[%s:%s]" "$?" "$BASH_COMMAND"' ERR; false | { true; }; trap - ERR`],
  ["DEBUG preserves arithmetic whitespace", `trap 'printf "[%s]" "$BASH_COMMAND"' DEBUG; ((value=1)); ((  value +=  1  )); [[ a = a ]]; trap - DEBUG`],
  ["ERR substitution trace", `trap 'printf err' ERR; set -E; value=$(false); printf '<%s>' "$value"`],
  ["DEBUG commands", `trap 'printf debug;' DEBUG; printf body; :; trap - DEBUG; printf after`],
  ["DEBUG status", `trap 'printf "d:%s;" "$?"' DEBUG; false; printf body; trap - DEBUG`],
  ["DEBUG command variable", `trap 'printf "[%s]" "$BASH_COMMAND"' DEBUG; printf body; :; trap - DEBUG`],
  ["DEBUG function not inherited", `trap 'printf d;' DEBUG; f() { printf body; :; }; f; trap - DEBUG`],
  ["DEBUG functrace inheritance", `trap 'printf d;' DEBUG; set -T; f() { printf body; :; }; f; trap - DEBUG`],
  ["DEBUG function own trap", `f() { trap 'printf d;' DEBUG; printf body; :; }; f; printf after; trap - DEBUG`],
  ["RETURN own function", `f() { trap 'printf "return:%s;" "$?"' RETURN; printf body; return 7; }; f; printf 'after:%s' "$?"`],
  ["RETURN inherited off", `trap 'printf r;' RETURN; f() { printf body; }; f; printf after`],
  ["RETURN functrace inheritance", `trap 'printf r;' RETURN; set -T; f() { printf body; }; f; printf after`],
  ["RETURN nested functions", `trap 'printf r;' RETURN; set -T; f() { g() { printf body; }; g; printf f; }; f`],
  ["RETURN source", `trap 'printf "return:%s;" "$?"' RETURN; . /dev/stdin; printf 'after:%s' "$?"`, `printf body; return 7`],
  ["DEBUG source", `trap 'printf d;' DEBUG; . /dev/stdin; trap - DEBUG`, `printf body; :`],
  ["EXIT function errexit unwind", `f() { local value=local; trap 'printf "%s:%s:%s" "$value" "$1" "$?"' EXIT; set -e; false; }; f argument`],
  ["pipeline explicit exit", `{ trap 'printf child' EXIT; printf body; exit 3; } | { read -r value; printf '<%s>' "$value"; }`],
  ["EXIT handler replacement is not reentrant", `trap 'trap "printf bad" EXIT; printf good' EXIT`],
  ["EXIT handler eval exit", `trap 'eval "exit 9"; printf bad' EXIT; exit 4`],
  ["ERR nested condition", `trap 'printf err;' ERR; f() { false; printf body; }; if f; then printf yes; fi`],
  ["ERR loop final status", `trap 'printf err;' ERR; for value in a b; do false; done; printf after`],
  ["ERR function explicit return", `set -E; trap 'printf "err:%s;" "$?"' ERR; f() { return 3; }; f`],
  ["ERR nonrecursive", `trap 'printf err; false; printf done' ERR; false; printf after`],
  ["DEBUG inside ERR", `trap 'printf d;' DEBUG; trap 'printf e;' ERR; false; trap - DEBUG`],
  ["DEBUG inside EXIT", `trap 'printf d;' DEBUG; trap 'printf e;' EXIT; exit 3`],
  ["DEBUG loop and case", `trap 'printf d;' DEBUG; for value in a b; do :; done; case x in x) :;; esac; trap - DEBUG`],
  ["DEBUG function changing inherited trap", `set -T; trap 'printf d;' DEBUG; f() { trap 'printf x;' DEBUG; :; }; f; :; trap - DEBUG`],
  ["DEBUG source with trace", `set -T; trap 'printf d;' DEBUG; . /dev/stdin; :; trap - DEBUG`, `trap 'printf x;' DEBUG; :`],
  ["DEBUG source restores outer handler", `trap 'printf d;' DEBUG; . /dev/stdin; :; trap - DEBUG`, `trap 'printf x;' DEBUG; :`],
  ["RETURN handler preserves failure", `f() { trap 'true' RETURN; false; }; f; printf '%s' "$?"`],
  ["RETURN handler explicit return", `f() { trap 'trap - RETURN; return 8' RETURN; return 7; }; f; printf '%s' "$?"`],
  ["RETURN handler explicit exit", `f() { trap 'exit 8' RETURN; return 7; }; f; printf bad`],
  ["RETURN trace nested declaration", `set -T; trap 'printf outer;' RETURN; f() { trap 'printf inner;' RETURN; }; f; g() { :; }; g`],
  ["source ERR inherited", `trap 'printf err;' ERR; . /dev/stdin; printf after`, `false; printf body`],
  ["substitution listing", `trap ':' EXIT; value=$(trap); printf '%s' "$value"; trap - EXIT`],
  ["substitution listing explicit builtin", `trap ':' EXIT; value=$(builtin trap -p EXIT); printf '%s' "$value"; trap - EXIT`],
  ["subshell trap listing and inactive execution", `trap 'printf bad' EXIT; (trap -p EXIT); trap - EXIT`],
  ["trap signal argument partial error", `trap ':' EXIT INVALID; printf 'status:%s;' "$?"; trap -p EXIT; trap - EXIT`],
  ["inherited ignored signals cannot be reset by child process", `trap '' USR1; bash -c 'trap "printf bad" USR1; trap -p USR1; trap - USR1; trap -p USR1'`, undefined, `trap '' USR1; "$BASH" -c 'trap "printf bad" USR1; trap -p USR1; trap - USR1; trap -p USR1'`],
  ["extdebug skips a failed DEBUG command", `shopt -s extdebug; trap 'trap - DEBUG; false' DEBUG; printf bad; printf 'status:%s' "$?"`],
  ["extdebug returns from function on DEBUG status two", `shopt -s extdebug; f() { trap 'trap - DEBUG; (exit 2)' DEBUG; printf bad; printf worse; }; f; printf 'status:%s' "$?"`],
  ["extdebug enables and disables tracing", `shopt -s extdebug; [[ -o functrace && -o errtrace ]]; printf '%s;' "$?"; shopt -u extdebug; [[ -o functrace || -o errtrace ]]; printf '%s' "$?"`],
  ["extdebug listing", `shopt -p extdebug; shopt -s extdebug; shopt -p extdebug; shopt -q extdebug`],
  ["sh special builtin assignment persists", `sh -c 'value=kept trap : EXIT; printf "%s" "$value"'`, undefined, `"$BASH" --posix -c 'value=kept trap : EXIT; printf "%s" "$value"'`],
  ["RETURN source sees source arguments", `set -- outer; trap 'printf "return:%s;" "$1"' RETURN; . /dev/stdin inner; printf 'after:%s' "$1"`, `return 7`],
  ["EXIT source sees source arguments", `set -- outer; trap 'printf "exit:%s;" "$1"' EXIT; . /dev/stdin inner`, `exit 7`],
];

for (const [name, source, input, nativeBindingOverride] of cases) test(`native EXIT lifecycle: ${name}`, { ...nativeOptions(), timeout: 3000 }, async context => {
  const captured = runNative(nativeBindingOverride ?? source, input);
  const native = { ...captured, stdout: captured.stdout.toString(), stderr: captured.stderr.toString() };
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  const fs = new MemoryFileSystem();
  if (input !== undefined) await fs.writeFile("/source", new TextEncoder().encode(input));
  const shell = new Shell({ fs, extensions: [trapExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(source.replaceAll("/dev/stdin", "/source"), { ...(input === undefined ? {} : { stdin: input }) });
  assert.equal(result.stdout, native.stdout, result.stderr);
  assert.equal(result.exitCode, native.status, result.stderr);
  assert.equal(result.stderr, native.stderr);
});

test("default shell has no trap builtin", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("command -v trap")).exitCode, 1);
  assert.equal((await shell.exec("trap '' EXIT")).exitCode, 127);
});
