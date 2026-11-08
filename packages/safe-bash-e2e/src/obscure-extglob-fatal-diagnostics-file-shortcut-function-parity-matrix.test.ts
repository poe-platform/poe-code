import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness, type E2EHarnessOptions } from "./harness.js";

const createE2EHarness = (opts: E2EHarnessOptions = {}) => SafeBashE2EHarness.create(opts);

describe("obscure extglob, fatal diagnostics, file shortcut, raw bytes, and function parity matrix", () => {
  it("1. extglob operators (@, ?, *, +, !) span unquoted parameter expansion word parts", async () => {
    const h = await createE2EHarness({
      cwd: "/work",
      files: {
        "/work/foo.txt": "",
        "/work/other.txt": "",
      },
    });
    for (const operator of ["@", "?", "*", "+", "!"]) {
      for (const word of [`${operator}$pat`, "$op$pat"]) {
        const res = await h.exec(
          `shopt -s extglob; op='${operator}'; pat='(foo.txt|bar.txt)'; printf '%s\\n' ${word}`,
        );
        assert.equal(res.exitCode, 0);
        assert.equal(res.stderr, "");
        assert.equal(res.stdout, `${operator === "!" ? "other.txt" : "foo.txt"}\n`);
      }
    }
  });

  it("2. split extglob respects quoting, shopt -u extglob, and set -f noglob", async () => {
    const h = await createE2EHarness({
      cwd: "/work",
      files: {
        "/work/foo.txt": "",
      },
    });
    const cases = [
      ["shopt -s extglob", '@"$pat"', "@(foo.txt|bar.txt)"],
      ["shopt -s extglob", '"@"$pat', "@(foo.txt|bar.txt)"],
      ["shopt -u extglob", "@$pat", "@(foo.txt|bar.txt)"],
      ["shopt -s extglob; set -f", "@$pat", "@(foo.txt|bar.txt)"],
    ] as const;
    for (const [options, word, expected] of cases) {
      const res = await h.exec(`${options}; pat='(foo.txt|bar.txt)'; printf '%s\\n' ${word}`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, `${expected}\n`);
    }
  });

  it("3. shopt -s extglob pathname expansion for @(), +(), *(), ?(), and !()", async () => {
    const h = await createE2EHarness({
      cwd: "/work",
      files: {
        "/work/a.txt": "",
        "/work/b.txt": "",
        "/work/c.txt": "",
        "/work/ab.txt": "",
        "/work/aab.txt": "",
        "/work/.hidden.txt": "",
      },
    });
    const res = await h.exec(`
shopt -s extglob
printf 'at:%s\\n' @(a|b).txt
printf 'plus:%s\\n' +(a)b.txt
printf 'star:%s\\n' *(a)b.txt
printf 'q:%s\\n' ?(a)b.txt
printf 'not:%s\\n' !(a|b|ab|aab).txt
`);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, "");
    assert.equal(
      res.stdout,
      [
        "at:a.txt",
        "at:b.txt",
        "plus:aab.txt",
        "plus:ab.txt",
        "star:aab.txt",
        "star:ab.txt",
        "star:b.txt",
        "q:ab.txt",
        "q:b.txt",
        "not:c.txt",
        "",
      ].join("\n"),
    );
  });

  it("4. extglob case matching, [[ == / != ]] conditional patterns, and parameter trimming/replacement", async () => {
    const h = await createE2EHarness();
    const res = await h.exec(`
shopt -s extglob
for item in foo.ts bar.js README.md; do
  case "$item" in
    @(*.ts|*.tsx)) printf 'ts:%s\\n' "$item" ;;
    !(*.md)) printf 'code:%s\\n' "$item" ;;
    *) printf 'doc:%s\\n' "$item" ;;
  esac
done
[[ "aaab" == +(a)b ]] && [[ "xyz" == !(ab|cd) ]] && [[ "ab" != "@(ab|cd)" ]] && printf 'cond:ok\\n'
v="aaabbbccc"
printf 'trim:%s|%s\\n' "\${v##+(a)}" "\${v//+(b)/B}"
empty=""
printf 'empty:<%s>|<%s>|<%s>|<%s>\\n' "\${empty//o/X}" "\${empty//*(a)/X}" "\${empty//?(a)/X}" "\${empty//!(b)/X}"
`);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, "");
    assert.equal(
      res.stdout,
      "ts:foo.ts\ncode:bar.js\ndoc:README.md\ncond:ok\ntrim:bbbccc|aaaBccc\nempty:<>|<X>|<>|<>\n",
    );
  });

  it("5. shopt -u extglob disables parse-time extglob tokens on subsequent lines", async () => {
    const h = await createE2EHarness();
    const res1 = await h.exec("echo @(a|b)");
    assert.equal(res1.exitCode, 2);
    assert.match(res1.stderr, /syntax error|unexpected/i);

    const res2 = await h.exec("shopt -s extglob\nshopt -u extglob\necho @(a|b)");
    assert.equal(res2.exitCode, 2);
    assert.match(res2.stderr, /syntax error|unexpected/i);
  });

  it("6. GNU 5.3 fatal arithmetic diagnostics: division by zero and missing operand in $(( )) and (( ))", async () => {
    const h = await createE2EHarness();
    const r1 = await h.exec(': "$((1/0))"; echo after');
    assert.equal(r1.exitCode, 1);
    assert.equal(r1.stdout, "");
    assert.equal(r1.stderr, 'shell: line 1: 1/0: division by 0 (error token is "0")\n');

    const r2 = await h.exec(': "$((1+))" || echo recovered; echo after');
    assert.equal(r2.exitCode, 1);
    assert.equal(r2.stdout, "");
    assert.equal(
      r2.stderr,
      'shell: line 1: 1+: arithmetic syntax error: operand expected (error token is "+")\n',
    );

    const r3 = await h.exec('((7/0)) || printf "recovered:%s" "$?"');
    assert.equal(r3.exitCode, 0);
    assert.equal(r3.stdout, "recovered:1");
    assert.equal(r3.stderr, 'shell: line 1: ((: 7/0: division by 0 (error token is "0")\n');

    const r4 = await h.exec(': >before;\n: "$((10 / (2-2)))"; echo after');
    assert.equal(r4.exitCode, 1);
    assert.equal(r4.stdout, "");
    assert.equal(
      r4.stderr,
      'shell: line 2: 10 / (2-2): division by 0 (error token is "(2-2)")\n',
    );
  });

  it("7. GNU 5.3 command substitution and compound block fatal arithmetic diagnostics", async () => {
    const h = await createE2EHarness();
    const r1 = await h.exec('{ : "$((7/0))"; echo wrong; } || echo recovered; echo after');
    assert.equal(r1.exitCode, 1);
    assert.equal(r1.stdout, "");
    assert.equal(r1.stderr, 'shell: line 1: 7/0: division by 0 (error token is "0")\n');

    const r2 = await h.exec('value=$(printf inner; : "$((7/0))"; echo wrong); printf "<%s>:%s" "$value" "$?"');
    assert.equal(r2.exitCode, 0);
    assert.equal(r2.stdout, "<inner>:1");
    assert.equal(r2.stderr, 'shell: line 1: 7/0: division by 0 (error token is "0")\n');

    const r3 = await h.exec('value=$(: "$((1+))"); printf "%s" "$?"');
    assert.equal(r3.exitCode, 0);
    assert.equal(r3.stdout, "1");
    assert.equal(r3.stderr, 'shell: line 1: 1+: arithmetic syntax error: operand expected (error token is "+")\n');
  });

  it("8. GNU 5.3 parameter error ${missing:?stop} aborts shell or subshell with exit code 127", async () => {
    const h = await createE2EHarness();
    const r1 = await h.exec('echo "${missing:?stop}"\necho after');
    assert.equal(r1.exitCode, 127);
    assert.equal(r1.stdout, "");
    assert.equal(r1.stderr, "shell: line 1: missing: stop\n");

    const r2 = await h.exec('( : "${missing:?stop}"; echo wrong ); printf "%s" "$?"');
    assert.equal(r2.exitCode, 0);
    assert.equal(r2.stdout, "1");
    assert.equal(r2.stderr, "shell: line 1: missing: stop\n");

    const r3 = await h.exec('value=$(printf inner; : "${missing:?stop}"; echo wrong); printf "<%s>:%s" "$value" "$?"');
    assert.equal(r3.exitCode, 0);
    assert.equal(r3.stdout, "<inner>:1");
    assert.equal(r3.stderr, "shell: line 1: missing: stop\n");
  });

  it("9. GNU 5.3 ${missing:?stop} inside here-string and heredoc isolates for external commands and subshells but aborts builtins", async () => {
    const h = await createE2EHarness();
    const r1 = await h.exec('cat <<<"${missing:?stop}"\nprintf \'status=%s\\n\' "$?"');
    assert.equal(r1.exitCode, 0);
    assert.equal(r1.stdout, "status=127\n");
    assert.equal(r1.stderr, "shell: line 1: missing: stop\n");

    const r2 = await h.exec('(cat) <<<"${missing:?stop}"\nprintf \'status=%s\\n\' "$?"');
    assert.equal(r2.exitCode, 0);
    assert.equal(r2.stdout, "status=127\n");
    assert.equal(r2.stderr, "shell: line 1: missing: stop\n");

    const r3 = await h.exec('cat <<EOF\n${missing:?stop}\nEOF\nprintf \'status=%s\\n\' "$?"');
    assert.equal(r3.exitCode, 0);
    assert.equal(r3.stdout, "status=127\n");
    assert.equal(r3.stderr, "shell: line 1: missing: stop\n");

    const r4 = await h.exec(': <<<"${missing:?stop}"\necho after');
    assert.equal(r4.exitCode, 127);
    assert.equal(r4.stdout, "");
    assert.equal(r4.stderr, "shell: line 1: missing: stop\n");
  });

  it("10. GNU 5.3 parse-time command substitution syntax error aborts before earlier commands in unit with status 127", async () => {
    const h = await createE2EHarness({ cwd: "/work", directories: ["/work"] });
    const r1 = await h.exec('printf touched > /work/side; printf "%s" "$(true |)"');
    assert.equal(r1.exitCode, 127);
    assert.equal(r1.stdout, "");
    assert.equal(
      r1.stderr,
      'shell: -c: line 1: syntax error near unexpected token `)\'\nshell: -c: line 1: `printf touched > /work/side; printf "%s" "$(true |)"\'\n',
    );
    const check = await h.exec("test ! -e /work/side");
    assert.equal(check.exitCode, 0);
  });

  it("11. GNU 5.3 top-level syntax errors for unexpected token, incomplete &&, and EOF quote", async () => {
    const h = await createE2EHarness();
    const r1 = await h.exec(": >before; never() { value=$(true |); }; : >after");
    assert.equal(r1.exitCode, 127);
    assert.equal(
      r1.stderr,
      "shell: -c: line 1: syntax error near unexpected token `)'\nshell: -c: line 1: `: >before; never() { value=$(true |); }; : >after'\n",
    );

    const r2 = await h.exec(": >before; true &&");
    assert.equal(r2.exitCode, 2);
    assert.equal(r2.stderr, "shell: -c: line 2: syntax error: unexpected end of file\n");

    const r3 = await h.exec(": >before; if true; then :");
    assert.equal(r3.exitCode, 2);
    assert.equal(
      r3.stderr,
      "shell: -c: line 2: syntax error: unexpected end of file from `if' command on line 1\n",
    );
  });

  it("12. file shortcut $(<file) trims NUL bytes before trailing newlines and emits once-per-capture warning", async () => {
    const h = await createE2EHarness({
      cwd: "/work",
      files: {
        "/work/utf8_nul": new TextEncoder().encode("é\0😀\n\0\n"),
        "/work/multi_nul": new TextEncoder().encode("a\0b\0\n"),
      },
    });
    const r1 = await h.exec('printf "<%s>\\n" "$(<utf8_nul)"');
    assert.equal(r1.exitCode, 0);
    assert.equal(r1.stdout, "<é😀>\n");

    const r2 = await h.exec(':\nvalue=$(<multi_nul); printf "<%s>:%d\\n" "$value" "$?"');
    assert.equal(r2.exitCode, 0);
    assert.equal(r2.stdout, "<ab>:0\n");
    assert.equal(
      r2.stderr,
      "shell: line 2: warning: command substitution: ignored null byte in input\n",
    );
  });

  it("13. file shortcut $(<missing) and $(<${missing:?stop}) isolate failure inside substitution", async () => {
    const h = await createE2EHarness({ cwd: "/work", directories: ["/work"] });
    const r1 = await h.exec('value=$(<missing); printf "%d:<%s>\\n" "$?" "$value"; : >after1');
    assert.equal(r1.exitCode, 0);
    assert.equal(r1.stdout, "1:<>\n");
    assert.match(r1.stderr, /missing: No such file or directory/);

    const r2 = await h.exec('value=$(<${missing:?stop}); : >after2');
    assert.equal(r2.exitCode, 0);
    assert.match(r2.stderr, /missing: stop/);

    const check = await h.exec("test -f after1 && test -f after2");
    assert.equal(check.exitCode, 0);
  });

  it("14. GNU 5.3 directory-only $(<folder) returns empty success without altering directory contents", async () => {
    const h = await createE2EHarness({
      cwd: "/work",
      files: {
        "/work/folder/child": "kept",
      },
    });
    const res = await h.exec('value=$(<folder); printf "<%s>:%d\\n" "$value" "$?"; cat folder/child');
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, "");
    assert.equal(res.stdout, "<>:0\nkept");
  });

  it("15. file command substitutions $(cat /raw), $(head -n 1 /raw), $(tail -n 1 /raw) preserve raw bytes", async () => {
    for (const bytes of [
      Uint8Array.of(128, 255),
      Uint8Array.of(239, 187, 191, 97),
      Uint8Array.of(226, 130, 172),
    ]) {
      const h = await createE2EHarness({
        files: {
          "/raw": bytes,
        },
      });
      for (const command of ["cat", "head -n 1", "tail -n 1"]) {
        const res = await h.exec(`printf "%s" "$(${command} /raw)"`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.deepEqual(res.stdoutBytes, bytes);
      }
    }
  });

  it("16. function discovery command substitution uses local positionals without clobbering outer $1", async () => {
    const h = await createE2EHarness();
    for (const outer of ["set -- echo", "set --"]) {
      const res = await h.exec(
        `has_cmd() { command -v "$1"; }; kind_of() { type -t "$1"; }; ${outer}; printf '%s %s\\n' "$(has_cmd printf)" "$(kind_of for)"; printf '<%s>\\n' "$1"`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, `printf keyword\n<${outer === "set -- echo" ? "echo" : ""}>\n`);
    }
  });

  it("17. function local redeclarations preserve prior local value and expand arguments before applying bindings", async () => {
    const h = await createE2EHarness();
    for (const declaration of ["local x=1; local x", "local x=1 x", "local x; local x=1; local x"]) {
      const res = await h.exec(
        `x=outer; fn() { ${declaration}; echo "<$x>"; }; for i in 1 2; do fn; done; echo "$x"`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "<1>\n<1>\nouter\n");
    }

    const res2 = await h.exec(
      'a=outer; fn() { local a=1 b="$a"; local c="$a"; echo "<$a:$b:$c>"; }; for i in 1 2; do fn; done; echo "$a"',
    );
    assert.equal(res2.exitCode, 0);
    assert.equal(res2.stderr, "");
    assert.equal(res2.stdout, "<1:outer:1>\n<1:outer:1>\nouter\n");
  });

  it("18. function return restores invocation $_ across empty args, multiple args, and loops", async () => {
    const h = await createE2EHarness();
    for (const body of [":", "local a=1", "return 3", "printf 'inner\\n'", "nested() { :; }; nested inner"]) {
      for (const args of ["", " arg1 arg2"]) {
        for (const loop of [false, true]) {
          const call = `fn${args}; echo "s=$? _=$_"`;
          const res = await h.exec(
            `fn() { ${body}; }; ${loop ? `for i in 1 2; do ${call}; done` : call}`,
          );
          const expected = `${body === "printf 'inner\\n'" ? "inner\n" : ""}s=${body === "return 3" ? 3 : 0} _=${args ? "arg2" : "fn"}\n`;
          assert.equal(res.exitCode, 0);
          assert.equal(res.stderr, "");
          assert.equal(res.stdout, expected.repeat(loop ? 2 : 1));
        }
      }
    }
  });

  it("19. function definitions preserve PIPESTATUS across fresh shell, pipelines, redirections, and negation", async () => {
    const cases = [
      ['f() { :; }; printf "count=%d\\n" "${#PIPESTATUS[@]}"', "count=0\n"],
      ['false; f() { :; }; printf "status=%d pipestatus=%s\\n" "$?" "${PIPESTATUS[*]}"', "status=0 pipestatus=1\n"],
      ['true | false; f() { :; }; printf "status=%d pipestatus=%s\\n" "$?" "${PIPESTATUS[*]}"', "status=0 pipestatus=0 1\n"],
      ['false; f() { :; } > /dev/null; printf "status=%d pipestatus=%s\\n" "$?" "${PIPESTATUS[*]}"', "status=0 pipestatus=1\n"],
      ['false; ! f() { :; }; printf "status=%d pipestatus=%s\\n" "$?" "${PIPESTATUS[*]}"', "status=1 pipestatus=1\n"],
      ['false; readonly PIPESTATUS; f() { :; }; printf "status=%d pipestatus=%s\\n" "$?" "${PIPESTATUS[*]}"', "status=0 pipestatus=0\n"],
    ] as const;

    for (const [source, expected] of cases) {
      const h = await createE2EHarness();
      const res = await h.exec(source);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, expected);
    }
  });

  it("20. file shortcut $(<input) enforces maxOutputBytes limit", async () => {
    const h = await createE2EHarness({
      cwd: "/work",
      files: {
        "/work/input": "oversize",
      },
      limits: {
        maxOutputBytes: 4,
      },
    });
    await assert.rejects(h.exec("value=$(<input)"), /maxOutputBytes/);
  });
});
