import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

function stripLinePrefix(stderr: string): string {
  return stderr.replace(/shell: line \d+: /g, "");
}

describe("obscure FD duplication/moves, <> read-write offsets, noclobber, heredocs, here-strings, $(< file), and subshell/arithmetic disambiguation parity matrix", () => {
  it("1) >&file redirects both stdout and stderr when no explicit fd is given, while 1>&file fails with Bad file descriptor", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "(echo out_msg; echo err_msg >&2) >&both.log",
          "rc1=$?",
          "echo x 2>ambig.err 1>&not_a_number",
          "rc2=$?",
          'printf "rc=%d:%d|both=%s|err=%s\\n" "$rc1" "$rc2" "$(tr \'\\n\' \',\' < both.log)" "$(cat ambig.err)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(
        stripLinePrefix(res.stdout),
        "rc=0:1|both=out_msg,err_msg,|err=not_a_number: Bad file descriptor\n",
      );
    });
  });

  it("2) set -o noclobber blocks > and &> on existing regular files and broken symlinks, while allowing >|, >>, /dev/null, and symlinks to /dev/null", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "echo keep > existing.txt",
          "ln -s /nonexistent/path broken_link",
          "ln -s /dev/null null_link",
          "set -o noclobber",
          "echo overwrite > existing.txt 2>err1.txt",
          "rc1=$?",
          "echo overwrite &> existing.txt 2>err2.txt",
          "rc2=$?",
          "echo create > broken_link 2>err3.txt",
          "rc3=$?",
          "echo ok > /dev/null",
          "rc4=$?",
          "echo ok > null_link",
          "rc5=$?",
          "echo forced >| existing.txt",
          "rc6=$?",
          'printf "rc=%d:%d:%d:%d:%d:%d|content=%s\\n" "$rc1" "$rc2" "$rc3" "$rc4" "$rc5" "$rc6" "$(cat existing.txt)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "rc=1:1:1:0:0:0|content=forced\n");
    });
  });

  it("3) directional FD validation rejects >&0 when fd 0 is read-only and <&1 when fd 1 is write-only", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "echo hi 2>e_out.txt >&0",
          "rc1=$?",
          "cat 2>e_in.txt <&1",
          "rc2=$?",
          "exec 3>out_only.txt 4<err_or_in.txt 2>/dev/null || true",
          "echo test > in_only.txt",
          "exec 3>out_only.txt 4<in_only.txt",
          "cat 2>e3.txt <&3",
          "rc3=$?",
          "echo bad 2>e4.txt >&4",
          "rc4=$?",
          "exec 3>&- 4<&-",
          'printf "rc=%d:%d:%d:%d|%s|%s|%s|%s\\n" "$rc1" "$rc2" "$rc3" "$rc4" "$(cat e_out.txt)" "$(cat e_in.txt)" "$(cat e3.txt)" "$(cat e4.txt)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        stripLinePrefix(res.stdout),
        "rc=1:1:1:1|0: Bad file descriptor|1: Bad file descriptor|3: Bad file descriptor|4: Bad file descriptor\n",
      );
    });
  });

  it("4) FD move syntax (<&N- and >&N-) duplicates and closes source FD when literal, but rejects expanded dash as ambiguous redirect", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "exec 3>moved_out.txt",
          "exec 4>&3-",
          "echo fail_on_3 2>closed3.err >&3",
          "rc3=$?",
          "echo ok_on_4 >&4",
          "exec 4>&-",
          'dyn="3-"',
          "exec 3>tmp.txt",
          "echo bad 2>dyn.err >&$dyn",
          "rc_dyn=$?",
          "exec 3>&-",
          'printf "rc=%d:%d|out=%s|e3=%s|edyn=%s\\n" "$rc3" "$rc_dyn" "$(cat moved_out.txt)" "$(cat closed3.err)" "$(cat dyn.err)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        stripLinePrefix(res.stdout),
        "rc=1:1|out=ok_on_4|e3=3: Bad file descriptor|edyn=3-: ambiguous redirect\n",
      );
    });
  });

  it("5) exec N<>file opens read-write file descriptor with shared read/write offset and non-truncating writes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "printf '0123456789\\n' > rw.dat",
          "exec 3<>rw.dat",
          "printf 'ABC' >&3",
          "read -u 3 suffix",
          "exec 3<&-",
          'printf "suffix=%s|full=%s\\n" "$suffix" "$(cat rw.dat)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "suffix=3456789|full=ABC3456789\n");
    });
  });

  it("6) duplicating a <> read-write FD via 4<&3 and closing 3<&- preserves read and write access on FD 4", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "printf 'abcdef\\n' > dup_rw.dat",
          "exec 3<>dup_rw.dat",
          "exec 4<&3",
          "exec 3<&-",
          "printf 'ZZ' >&4",
          "read -u 4 p2",
          "exec 4<&-",
          'printf "p2=%s|file=%s\\n" "$p2" "$(cat dup_rw.dat)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "p2=cdef|file=ZZcdef\n");
    });
  });

  it("7) $(< file) shortcut reads file contents, trims trailing newlines, and returns empty string with status 0 on a directory", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "printf 'alpha\\nbeta\\n\\n' > short.txt",
          "mkdir -p short_dir",
          "val_file=$(< short.txt)",
          "rc_file=$?",
          "val_dir=$(< short_dir)",
          "rc_dir=$?",
          "cat 2>dir_cmd.err < short_dir",
          "rc_cmd_dir=$?",
          'printf "rc=%d:%d:%d|file=%s|dir=%s|err=%s\\n" "$rc_file" "$rc_dir" "$rc_cmd_dir" "$(printf \'%s\' "$val_file" | tr \'\\n\' \'|\')" "$val_dir" "$(cat dir_cmd.err)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        stripLinePrefix(res.stdout),
        "rc=0:0:1|file=alpha|beta|dir=|err=short_dir: Is a directory\n",
      );
    });
  });

  it("8) unquoted heredoc handles backslash-newline line continuation vs escaped double-backslash before newline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "V=world",
          "cat <<EOF",
          "hello $V \\",
          "joined",
          "keep_slash \\\\",
          "next_line",
          "\\$V literal",
          "EOF",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(
        res.stdout,
        "hello world joined\nkeep_slash \\\nnext_line\n$V literal\n",
      );
    });
  });

  it("9) heredoc delimiter quoting supports single, double, ANSI-C $'...', locale $\"...\", backslash, and line-continued delimiters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "X=expanded",
          "cat <<$'E\\x4fF'",
          "$X_1",
          "EOF",
          'cat <<$"END"',
          "$X_2",
          "END",
          "cat <<E\\",
          "OF2",
          "$X",
          "EOF2",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "$X_1\n$X_2\nexpanded\n");
    });
  });

  it("10) <<- strips leading tabs from heredoc body and delimiter line without stripping leading spaces", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat <<-'EOF'",
          "\t\tline_one",
          "\t  spaced_line",
          "\tEOF",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "line_one\n  spaced_line\n");
    });
  });

  it("11) nested heredocs inside $(...) and <(...) process substitution parse and evaluate cleanly", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "out1=$(cat <<EOF",
          "from_cmdsub",
          "EOF",
          ")",
          "out2=$(cat <(cat <<'INNER'",
          "from_procsub",
          "INNER",
          "))",
          'printf "%s|%s\\n" "$out1" "$out2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "from_cmdsub|from_procsub\n");
    });
  });

  it("12) multiple stacked heredocs on a single command consume bodies in declaration order", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "{ read -r a; read -r b <&3; } <<FIRST 3<<SECOND",
          "body_one",
          "FIRST",
          "body_two",
          "SECOND",
          'printf "%s|%s\\n" "$a" "$b"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "body_one|body_two\n");
    });
  });

  it("13) prefix assignments before a command with <<< or << apply inside subshells of the redirect but not direct parameter expansion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "A=outer",
          'hs=$(A=inner cat <<< "$A:$(echo "$A")")',
          "hd=$(A=inner cat <<EOF",
          '$A:$(echo "$A")',
          "EOF",
          ")",
          'printf "hs=%s|hd=%s|after=%s\\n" "$hs" "$hd" "$A"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "hs=outer:inner|hd=outer:inner|after=outer\n");
    });
  });

  it("14) temporary scalar prefix assignment on an array restores array state afterward, while indexed-array command prefixes are rejected", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "arr=(orig0 orig1)",
          "f() { printf 'in:%s:%s|' \"${arr[0]}\" \"${arr[1]}\"; }",
          "arr=temp0 f",
          'printf "after:%s:%s|" "${arr[0]}" "${arr[1]}"',
          "eval 'arr[0]=temp0 f' 2>/dev/null",
          'printf "rc=%d\\n" "$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "in:temp0:|after:orig0:orig1|rc=2\n");
    });
  });

  it("15) command substitutions inside ${...} parameter expansion operands only evaluate when the branch is active", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "set_v=present",
          "unset unset_v",
          'r1="${set_v:-$(echo side1 > side1.txt; echo fallback1)}"',
          'r2="${unset_v:-$(echo side2 > side2.txt; echo fallback2)}"',
          'r3="${set_v:+$(echo alt_val)}"',
          'r4="${unset_v:+$(echo side4 > side4.txt; echo alt_skip)}"',
          "test -f side1.txt && s1=1 || s1=0",
          "test -f side2.txt && s2=1 || s2=0",
          "test -f side4.txt && s4=1 || s4=0",
          'printf "%s|%s|%s|%s|side=%d:%d:%d\\n" "$r1" "$r2" "$r3" "$r4" "$s1" "$s2" "$s4"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "present|fallback2|alt_val||side=0:1:0\n");
    });
  });

  it("16) unquoted ${var:+$(cmd)} splits command substitution result by IFS while preserving quoted parts", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "v=1",
          'printf "<%s>" ${v:+$(printf "one two") "three four"}',
          "printf '\\n'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "<one><two><three four>\n");
    });
  });

  it("17) command substitution strips NUL bytes and emits bash warning to stderr", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "val=$(printf 'ab\\0cd\\n') 2>nul.warn",
          "warn_has_null=$(grep -c 'ignored null byte in input' nul.warn)",
          'printf "val=%s|warn=%s\\n" "$val" "$warn_has_null"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "val=abcd|warn=1\n");
    });
  });

  it("18) ((cmd1); (cmd2)) and $((cmd1); (cmd2)) disambiguate as nested subshells rather than arithmetic expressions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "((echo top1); (echo top2))",
          "val=$((echo sub1); (echo sub2))",
          "arith=$(( (1 + 2) * (3 + 4) ))",
          'printf "val=%s|arith=%s\\n" "$(printf \'%s\' "$val" | tr \'\\n\' \',\')" "$arith"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "top1\ntop2\nval=sub1,sub2|arith=21\n");
    });
  });

  it("19) (( ... )) and $(( ... )) strip double quotes inside arithmetic expressions and route (( 1/0 )) 2>file errors", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'a=$(( "10" + "20" ))',
          '(( b = "5" * "6" ))',
          "(( 1 / 0 )) 2>div.err",
          "rc=$?",
          'printf "a=%s|b=%s|rc=%d|err=%d\\n" "$a" "$b" "$rc" "$(test -s div.err && echo 1 || echo 0)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "a=30|b=30|rc=1|err=1\n");
    });
  });

  it("20) compound command redirections with 2>&1 and 1>&2 route body stdout and stderr to the swapped descriptors", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "{ echo body_out; echo body_err >&2; } >swap.out 2>swap.err",
          "{ echo swapped_err >&2; } >only_out.txt 2>&1",
          'printf "out=%s|err=%s|swapped=%s\\n" "$(cat swap.out)" "$(cat swap.err)" "$(cat only_out.txt)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "out=body_out|err=body_err|swapped=swapped_err\n");
    });
  });
});
