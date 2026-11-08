import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure traps extdebug errtrace functrace aliases errexit parity matrix", () => {
  test("1. trap -l lists POSIX and Bash signals and trap -p formats installed traps", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `trap 'echo bye' EXIT
trap 'echo int' INT
trap -p EXIT INT
trap -l | grep -q 'SIGINT' && echo "has_sigint"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "trap -- 'echo bye' EXIT\ntrap -- 'echo int' SIGINT\nhas_sigint\nbye\n",
    );
  });

  test("2. EXIT trap preserves prior script status unless trap explicitly calls exit", async () => {
    const h = await SafeBashE2EHarness.create();
    const r1 = await h.exec(
      `trap 'printf "cleanup:%d\\n" "$?"' EXIT
(exit 9)`,
    );
    assert.equal(r1.exitCode, 9);
    assert.equal(r1.stdout, "cleanup:9\n");

    const r2 = await h.exec(
      `trap 'printf "override:%d\\n" "$?"; exit 3' EXIT
(exit 9)`,
    );
    assert.equal(r2.exitCode, 3);
    assert.equal(r2.stdout, "override:9\n");
  });

  test("3. bare exit inside EXIT trap uses pre-trap exit status", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `trap 'false; exit' EXIT
(exit 17)`,
    );
    assert.equal(r.exitCode, 17);
  });

  test("4. subshell inherits parent traps in trap -p display only and does not fire parent EXIT trap", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `trap 'printf "parent_exit\\n"' EXIT
(
  trap -p EXIT
  printf "sub_done\\n"
)
printf "after_sub\\n"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "trap -- 'printf \"parent_exit\\n\"' EXIT\nsub_done\nafter_sub\nparent_exit\n",
    );
  });

  test("5. subshell can install and run its own EXIT trap without affecting parent EXIT trap", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `trap 'printf "parent_exit\\n"' EXIT
(
  trap 'printf "sub_exit\\n"' EXIT
  printf "in_sub\\n"
)
printf "in_parent\\n"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "in_sub\nsub_exit\nin_parent\nparent_exit\n");
  });

  test("6. pipeline stage runs its own newly installed EXIT trap", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `{ trap 'printf ":stage_exit"' EXIT; printf "body"; } | tr 'a-z' 'A-Z'`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "BODY:STAGE_EXIT");
  });

  test("7. ERR trap fires on unchecked failing command and updates BASH_COMMAND but skips guarded contexts", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `trap 'printf "ERR:%s:%d\\n" "$BASH_COMMAND" "$?"' ERR
if false; then :; fi
false && true
! false
(exit 5)
sh -c 'exit 7'
printf "done\\n"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "ERR:false:5\nERR:sh -c 'exit 7':7\ndone\n");
  });

  test("8. ERR trap inside function is not inherited without set -E (errtrace) and is inherited with set -E", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `trap 'printf "ERR:%s:%d\\n" "$BASH_COMMAND" "$?"' ERR
f() { false; return 0; }
f
set -E
f
set +E
f`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "ERR:false:1\n");
  });

  test("9. RETURN trap fires on function return and source completion only with functrace (set -T) or local installation", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/inc.sh": "printf 'sourced_body\\n'\n(exit 4)\nreturn\n",
      },
    });
    const r = await h.exec(
      `trap 'printf "RET:%d\\n" "$?"' RETURN
f() { (exit 6); return; }
f
set -T
f
. /workspace/inc.sh
printf "after:%d\\n" "$?"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "RET:6\nsourced_body\nRET:4\nafter:4\n");
  });

  test("10. function installing its own RETURN trap fires on return even without set -T", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `f() {
  trap 'printf "local_ret:%d\\n" "$?"' RETURN
  (exit 8)
  return 3
}
f
printf "status:%d\\n" "$?"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "local_ret:8\nstatus:3\n");
  });

  test("11. DEBUG trap fires before simple commands, arithmetic commands, for headers, and case statements", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `log=()
trap 'log+=("$BASH_COMMAND")' DEBUG
x=1
((  x += 2  ))
for i in a; do
  case $i in
    a) y=$x ;;
  esac
done
trap - DEBUG
printf '%s|' "\${log[@]}"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      'x=1|((  x += 2  ))|for i in a|case $i in |y=$x|trap - DEBUG|',
    );
  });

  test("12. shopt -s extdebug enables errtrace/functrace and non-zero DEBUG trap skips command or returns 2 from function", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `shopt -s extdebug
set -o | grep -E '^(errtrace|functrace)' | tr '\\t' ':'
trap 'if [[ $BASH_COMMAND == *skip_me* ]]; then false; elif [[ $BASH_COMMAND == *abort_fn* ]]; then return 2; fi' DEBUG
skip_me() { printf "should_not_run\\n"; }
work() {
  printf "before_skip\\n"
  skip_me
  printf "before_abort\\n"
  abort_fn
  printf "after_abort\\n"
}
work
printf "work_rc:%d\\n" "$?"
trap - DEBUG`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "errtrace:on\nfunctrace:on\nbefore_skip\nbefore_abort\nwork_rc:2\n",
    );
  });

  test("13. child process via bash -c inherits ignored real signals as read-only dispositions", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `trap '' USR1
trap 'echo parent_int' INT
bash -c 'trap -p USR1 INT; trap "echo override" USR1; trap -p USR1'`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "trap -- '' SIGUSR1\ntrap -- '' SIGUSR1\n");
  });

  test("14. shell function named trap shadows trap builtin until invoked via builtin trap", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `trap() { printf "custom_trap:%s\\n" "$*"; }
trap 'echo hi' EXIT
builtin trap 'printf "real_exit\\n"' EXIT
unset -f trap`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "custom_trap:echo hi EXIT\nreal_exit\n");
  });

  test("15. sh -c persists prefix variable assignments on special builtins like trap and export", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `sh -c 'persisted=yes trap : EXIT; printf "sh:%s\\n" "$persisted"'
bash -c 'persisted=yes trap : EXIT; printf "bash:%s\\n" "$persisted"'`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "sh:yes\nbash:\n");
  });

  test("16. parse-time alias expansion does not apply to commands on the same line as alias/shopt", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `shopt -s expand_aliases; alias greet='printf "aliased\\n"'; greet 2>/dev/null || printf "same_line_unexpanded\\n"
greet`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "same_line_unexpanded\naliased\n");
  });

  test("17. function definition binds aliases at parse time and retains expansion after unalias", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `shopt -s expand_aliases
alias say='printf "bound:%s\\n"'
run_say() {
  say "$1"
}
unalias say
run_say hello`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "bound:hello\n");
  });

  test("18. trailing space in alias value triggers alias expansion on the following word and prevents infinite recursion", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `shopt -s expand_aliases
alias run='printf "%s-%s\\n" '
alias first='alpha '
alias second='beta'
alias echo='echo prefixed'
run first second
echo done`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "alpha-beta\nprefixed done\n");
  });

  test("19. aliases can expand to shell keywords like if/then/fi across multiline units", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `shopt -s expand_aliases
alias WHEN='if'
alias DO_THEN='then'
alias END_WHEN='fi'
WHEN true; DO_THEN
  printf "keyword_alias_ok\\n"
END_WHEN`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "keyword_alias_ok\n");
  });

  test("20. errexit ignores failures in compound command called from conditional context even with set -e inside function", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      `set -e
check_fn() {
  false
  printf "still_running_in_cond\\n"
  return 0
}
if check_fn; then
  printf "cond_succeeded\\n"
fi`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "still_running_in_cond\ncond_succeeded\n");
  });
});
