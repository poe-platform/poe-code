import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure shell declare -F, read -n/-N, readonly builtins/arithmetic/loops, control-flow validation, and set -o/+o parity matrix", () => {
  it("1. declare -F with no operands lists all defined function names in sorted order", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("z_func() { echo z; }; a_func() { echo a; }; m_func() { echo m; }; declare -F");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a_func\nm_func\nz_func\n");
      assert.equal(r.stderr, "");
    });
  });

  it("2. declare -F with operands prints matching functions and exits 1 when any function is missing", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("f1() { :; }; f2() { :; }; declare -F f1 missing_fn f2; echo rc:$?");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "f1\nf2\nrc:1\n");
    });
  });

  it("3. read -n stops at delimiter before character limit while read -N ignores delimiter and IFS splitting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        'printf "a\\nb\\n" | { read -n 3 v1; printf "n=<%s> rc=%d\\n" "$v1" "$?"; }; ' +
          'printf "a b\\nc\\n" | { read -N 4 x y; printf "N_x=<%s> N_y=<%s> rc=%d\\n" "$x" "$y" "$?"; }'
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "n=<a> rc=0\nN_x=<a b\n> N_y=<> rc=0\n");
    });
  });

  it("4. read into readonly single variable exits 1 while readonly default REPLY exits 2", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "readonly RO=init; echo hello | { read RO; echo rc1:$?:$RO; }; " +
          "readonly REPLY=rep; echo world | { read; echo rc2:$?:$REPLY; }"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc1:1:init\nrc2:2:rep\n");
      assert.match(r.stderr, /RO: readonly variable/);
      assert.match(r.stderr, /REPLY: readonly variable/);
    });
  });

  it("5. read into multiple variables where a non-final variable is readonly exits 2 without assigning later vars", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        'readonly RO=keep; LATER=orig; echo "first second" | { read RO LATER; echo "rc:$? RO=$RO LATER=$LATER"; }'
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc:2 RO=keep LATER=orig\n");
      assert.match(r.stderr, /RO: readonly variable/);
    });
  });

  it("6. read -a and mapfile/readarray into a readonly array fail with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        'readonly -a RARR=(one two); echo "x y" | { read -a RARR; echo "read_rc:$? len=${#RARR[@]}"; }; ' +
          'printf "m1\\nm2\\n" | { mapfile -t RARR; echo "map_rc:$? len=${#RARR[@]}"; }'
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "read_rc:1 len=2\nmap_rc:1 len=2\n");
      assert.match(r.stderr, /RARR: readonly variable/);
    });
  });

  it("7. printf -v into a readonly variable fails with exit code 1 and printf diagnostic", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec('readonly R_PRINTF=orig; printf -v R_PRINTF "%s-%d" new 42; echo "rc:$? val=$R_PRINTF"');
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc:1 val=orig\n");
      assert.equal(r.stderr, "printf: R_PRINTF: readonly variable\n");
    });
  });

  it("8. getopts with a readonly option variable updates OPTIND and fails with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec('readonly R_OPT=z; set -- -a -b; getopts "ab" R_OPT; echo "rc:$? OPTIND=$OPTIND R_OPT=$R_OPT"');
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc:1 OPTIND=2 R_OPT=z\n");
      assert.match(r.stderr, /R_OPT: readonly variable/);
    });
  });

  it("9. let and (( )) assignment or increment on a readonly variable fail with exit code 1 without aborting script", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        'readonly R_NUM=10; let "R_NUM = 20"; echo "let_rc:$? val=$R_NUM"; ' +
          '(( R_NUM += 5 )); echo "arith_rc:$? val=$R_NUM"'
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "let_rc:1 val=10\narith_rc:1 val=10\n");
      assert.match(r.stderr, /let: R_NUM: readonly variable/);
      assert.match(r.stderr, /\(\(: R_NUM: readonly variable/);
    });
  });

  it("10. arithmetic expansion $(( RO = 5 )) on a readonly variable aborts command and script with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("readonly RO=1; echo $(( RO = 5 )); echo after:$?");
      assert.equal(r.exitCode, 1);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /RO: readonly variable/);
    });
  });

  it("11. for loop with a readonly loop variable fails with exit code 1 and continues after the loop", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("readonly R_LOOP=init; for R_LOOP in a b c; do echo body:$R_LOOP; done; echo after:$?:$R_LOOP");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "after:1:init\n");
      assert.match(r.stderr, /R_LOOP: readonly variable/);
    });
  });

  it("12. parameter default assignment ${RO:=default} on a readonly variable fails the command with exit code 1 and continues script", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("readonly RO_EMPTY=; echo ${RO_EMPTY:=fallback}; echo after:$?");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "after:1\n");
      assert.match(r.stderr, /RO_EMPTY: readonly variable/);
    });
  });

  it("13. prefix assignment on a readonly variable before a regular command emits diagnostic and runs the command", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("readonly RO_PRE=1; RO_PRE=2 echo ran:$RO_PRE; echo rc:$?");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ran:1\nrc:0\n");
      assert.match(r.stderr, /RO_PRE: readonly variable/);
    });
  });

  it("14. exit with non-numeric argument or too many arguments emits diagnostic and continues execution", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("exit not_a_num; echo after_bad:$?; exit 1 2; echo after_many:$?");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "after_bad:2\nafter_many:1\n");
      assert.equal(r.stderr, "exit: not_a_num: numeric argument required\nexit: too many arguments\n");
    });
  });

  it("15. return outside function/source returns 2, return with too many args stays in function, and return with non-numeric arg returns 2", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "return 1; echo top:$?; " +
          "f_many() { return 1 2; echo in_many:$?; }; f_many; echo after_many:$?; " +
          "f_bad() { return xyz; echo unreachable; }; f_bad; echo after_bad:$?"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "top:2\nin_many:1\nafter_many:0\nafter_bad:2\n");
      assert.equal(
        r.stderr,
        "return: can only `return' from a function or sourced script\n" +
          "return: too many arguments\n" +
          "return: xyz: numeric argument required\n"
      );
    });
  });

  it("16. break and continue outside loops warn and return 0, while invalid loop count breaks with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "break; echo b_out:$?; continue; echo c_out:$?; " +
          "for i in 1 2; do break 0; echo unreachable; done; echo b_zero:$?"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "b_out:0\nc_out:0\nb_zero:1\n");
      assert.equal(
        r.stderr,
        "break: only meaningful in a loop\ncontinue: only meaningful in a loop\nbreak: invalid loop count\n"
      );
    });
  });

  it("17. break with non-numeric argument inside a loop aborts script with exit code 2", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("for i in 1 2; do break bogus; echo loop; done; echo after");
      assert.equal(r.exitCode, 2);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr, "break: bogus: numeric argument required\n");
    });
  });

  it("18. shift validates non-numeric, negative, out-of-range, and extra arguments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        'set -- a b c; shift bad; echo "bad:$?:$*"; shift -1; echo "neg:$?:$*"; ' +
          'shift 5; echo "over:$?:$*"; shift 1 2; echo "many:$?:$*"; shift -- 2; echo "ok:$?:$*"'
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "bad:2:a b c\nneg:1:a b c\nover:1:a b c\nmany:1:a b c\nok:0:c\n");
      assert.equal(r.stderr, "shift: bad: numeric argument required\n");
    });
  });

  it("19. set -o and set +o list all shell options in tabular and re-inputtable formats", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("set -e -o pipefail; set -o; echo '---'; set +o");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "allexport\toff\n" +
          "braceexpand\ton\n" +
          "errexit\ton\n" +
          "noclobber\toff\n" +
          "noexec\toff\n" +
          "noglob\toff\n" +
          "nounset\toff\n" +
          "pipefail\ton\n" +
          "errtrace\toff\n" +
          "functrace\toff\n" +
          "---\n" +
          "set +o allexport\n" +
          "set -o braceexpand\n" +
          "set -o errexit\n" +
          "set +o noclobber\n" +
          "set +o noexec\n" +
          "set +o noglob\n" +
          "set +o nounset\n" +
          "set -o pipefail\n" +
          "set +o errtrace\n" +
          "set +o functrace\n"
      );
    });
  });

  it("20. set validates invalid option names (exit 2), unsupported options (exit 1), and - vs -- positional replacement", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        'set -o unknown_opt; echo "unk:$?"; set -o posix; echo "posix:$?"; set -z; echo "z:$?"; ' +
          'set -- x y; set -; echo "dash:$*"; set --; echo "ddash:$*"'
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "unk:2\nposix:1\nz:1\ndash:x y\nddash:\n");
      assert.match(r.stderr, /set: unknown_opt: invalid option name/);
      assert.match(r.stderr, /set: posix: unsupported shell option/);
      assert.match(r.stderr, /set: unsupported shell option/);
    });
  });
});
