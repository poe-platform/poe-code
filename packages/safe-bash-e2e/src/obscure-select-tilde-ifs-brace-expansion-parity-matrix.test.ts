import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure select tilde ifs brace expansion parity matrix", () => {
  test("1. select valid choice, invalid choice, and REPLY / PS3 updates", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "PS3='P>'; select x in alpha beta; do printf '%s|%s\\n' \"$x\" \"$REPLY\"; break; done <<< '2'",
        "unset PS3; select y in a b; do printf '%s|%s\\n' \"$y\" \"$REPLY\"; break; done <<< 'oops'",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "beta|2\n|oops\n");
    assert.equal(r.stderr, "1) alpha\n2) beta\nP>1) a\n2) b\n#? ");
  });

  test("2. select blank reply redraws menu and cleared REPLY forces redraw on next iteration", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "PS3='P>'; select x in a b; do printf 'got:%s\\n' \"$x\"; break; done <<< $'\\n1'",
        "PS3='P>'; select y in a b; do PS3='next>'; REPLY=; continue; done <<< $'1\\n2'",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 1);
    assert.equal(r.stdout, "got:a\n\n");
    assert.equal(
      r.stderr,
      "1) a\n2) b\nP>1) a\n2) b\nP>1) a\n2) b\nP>1) a\n2) b\nnext>1) a\n2) b\nnext>",
    );
  });

  test("3. select column-major menu layout with tab-aware padding under COLUMNS", async () => {
    const h = await SafeBashE2EHarness.create({ env: { COLUMNS: "20" } });
    const r = await h.exec(
      "PS3='P>'; select x in a b c d e f; do printf '%s\\n' \"$x\"; break; done <<< '4'",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "d\n");
    assert.equal(r.stderr, "1) a  3) c  5) e\n2) b  4) d  6) f\nP>");
  });

  test("4. select menu width formatting in C vs C.UTF-8 locales with raw high bytes and multibyte UTF-8", async () => {
    const hC = await SafeBashE2EHarness.create({ env: { LC_ALL: "C", COLUMNS: "20" } });
    const rC = await hC.exec(
      "PS3='P>'; select x in $'\\377' $'\\303\\251' $'\\360\\237\\230\\200' a b c; do break; done <<< '1'",
    );
    assert.equal(rC.exitCode, 0);
    assert.equal(
      Buffer.from(rC.stderrBytes).toString("hex"),
      "312920ff0920342920610a322920c3a90920352920620a332920f09f98800920362920630a503e",
    );

    const hUtf8 = await SafeBashE2EHarness.create({ env: { LC_ALL: "C.UTF-8", COLUMNS: "20" } });
    const rUtf8 = await hUtf8.exec(
      "PS3='P>'; select x in $'\\377' $'\\303\\251' $'\\360\\237\\230\\200' a b c; do break; done <<< '1'",
    );
    assert.equal(rUtf8.exitCode, 0);
    assert.equal(
      Buffer.from(rUtf8.stderrBytes).toString("hex"),
      "312920ff20202020342920610a322920c3a9202020352920620a332920f09f98802020362920630a503e",
    );
  });

  test("5. select empty word list, positional default, backslash line continuation, and decimal whitespace", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "select x in; do echo WRONG; done <<< '1'",
        "set -- 'a b' c",
        "select y; do printf '%s|%s\\n' \"$y\" \"$REPLY\"; break; done <<< ' +01 '",
        "printf '\\\\2\\\\\\n\\n' | { select z in a b; do printf '%s|%s\\n' \"$z\" \"$REPLY\"; break; done; }",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "a b| +01 \nb|2\n");
  });

  test("6. select shares unread stdin with loop body, expands list once, and function display retains select syntax", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "value=a",
        "select x in \"$value\" b; do",
        "  read next",
        "  printf '[%s,%s]' \"$x\" \"$next\"",
        "  value=changed",
        "done <<< $'1\\nbody\\n1\\nagain'",
        "f() { select item in a b; do break; done; }",
        "type f",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^\[a,body\]\[a,again\]\nf is a function\n/);
    assert.match(r.stdout, /select item in a b;/);
  });

  test("7. tilde expansion for ~, ~+, ~- and quoted tilde suppression", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/workspace",
      env: { HOME: "/home/alice", OLDPWD: "/var/log" },
    });
    const r = await h.exec(
      [
        "printf '%s|%s|%s|%s|%s|%s\\n' ~ ~/sub ~+ ~+/sub ~- ~-/sub",
        "printf '%s|%s|%s\\n' \\~ ~'user' ~+'x'",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "/home/alice|/home/alice/sub|/workspace|/workspace/sub|/var/log|/var/log/sub\n~|~user|~+x\n",
    );
  });

  test("8. tilde expansion after = and : in scalar assignments and declaration builtins", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/workspace",
      env: { HOME: "/home/alice", OLDPWD: "/var/log" },
    });
    const r = await h.exec(
      [
        "p=~:~/bin:~+:~-/x",
        "export e=~:~/bin",
        "local_fn() {",
        "  local l=~:~/local",
        "  declare d=~+:~-",
        "  readonly ro=~/ro",
        "  printf '%s|%s|%s|%s|%s\\n' \"$p\" \"$e\" \"$l\" \"$d\" \"$ro\"",
        "}",
        "local_fn",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "/home/alice:/home/alice/bin:/workspace:/var/log/x|/home/alice:/home/alice/bin|/home/alice:/home/alice/local|/workspace:/var/log|/home/alice/ro\n",
    );
  });

  test("9. tilde expansion inside parameter default, alternate, assignment, and pattern operands", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/workspace",
      env: { HOME: "/home/alice" },
    });
    const r = await h.exec(
      [
        "unset u",
        "set_var=1",
        "p='/home/alice/docs/file.txt'",
        "printf '%s|%s|%s|%s|%s\\n' ${u:-~/def} \"${u:-~/def}\" ${set_var:+~/alt} ${u:=~/assigned} \"${p#~/}\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "/home/alice/def|~/def|/home/alice/alt|/home/alice/assigned|docs/file.txt\n",
    );
  });

  test("10. tilde expansion protects HOME containing spaces and glob metacharacters while globbing suffix", async () => {
    const h = await SafeBashE2EHarness.create({
      directories: ["/home/a [b]"],
      files: {
        "/home/a [b]/one.txt": "1",
        "/home/a [b]/two.txt": "2",
      },
      env: { HOME: "/home/a [b]" },
    });
    const r = await h.exec(
      "for f in ~/*.txt; do printf '<%s>' \"$f\"; done; printf '\\n'",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "</home/a [b]/one.txt></home/a [b]/two.txt>\n");
  });

  test("11. cross-segment IFS field splitting across adjacent parameter expansions and quoted bridges", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "x='a '; y=' b '; z=' c'",
        "for w in $x$y$z; do printf '[%s]' \"$w\"; done; printf '\\n'",
        "x='a'; z='b'",
        "for w in $x\"\"$z; do printf '[%s]' \"$w\"; done; printf '\\n'",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "[a][b][c]\n[ab]\n");
  });

  test("12. cross-segment IFS splitting with mixed whitespace and non-whitespace delimiters", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "IFS=' :'",
        "v=' :a: :b: '",
        "for w in $v; do printf '<%s>' \"$w\"; done; printf '\\n'",
        "v2=':a::b:'",
        "for w in $v2; do printf '<%s>' \"$w\"; done; printf '\\n'",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "<><a><><b>\n<><a><><b>\n");
  });

  test("13. unquoted parameter default expansion undergoes IFS splitting when default is unquoted vs quoted", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "unset u",
        "for w in ${u:-a b}; do printf '[%s]' \"$w\"; done; printf '\\n'",
        "for w in ${u:-\"a b\"}; do printf '[%s]' \"$w\"; done; printf '\\n'",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "[a][b]\n[a b]\n");
  });

  test("14. IFS splitting with raw non-UTF-8 byte delimiter and globbing on split fields with protected quotes", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/workspace",
      files: {
        "/workspace/a1": "",
        "/workspace/a*": "",
      },
    });
    const r = await h.exec(
      [
        "IFS=$'\\377'",
        "v=$'left\\377right'",
        "for w in $v; do printf '[%s]' \"$w\"; done; printf '\\n'",
        "IFS=' '",
        "p='a*'",
        "for w in $p \"$p\" a\"*\"; do printf '<%s>' \"$w\"; done; printf '\\n'",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "[left][right]\n<a*><a1><a*><a*>\n");
  });

  test("15. brace expansion cartesian products, nested choices, and literal fallbacks", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      "printf '%s ' pre{a,{b,c}}post {single} {} {a,b; printf '\\n'",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "preapost prebpost precpost {single} {} {a,b \n");
  });

  test("16. brace expansion zero-padded, negative, descending, and stepped numeric and alpha ranges", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      "printf '%s|' {01..03} {-02..01..2} {5..1..2} {a..g..3} {e..a..-2} {1..3..0}; printf '\\n'",
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "01|02|03|-02|000|5|3|1|a|d|g|e|c|a|1|2|3|\n");
  });

  test("17. brace expansion alphabetic range crossing backslash and backtick replays shell syntax", async () => {
    const h = await SafeBashE2EHarness.create({ mountDev: true });
    const r = await h.exec(
      [
        "printf '<%s>' {Z..a}; printf '\\n'",
        "value=tail; printf '<%s>' {Y..c..3}$value {Y..c..3}\"post\"; printf '\\n'",
        "(printf '<%s>' pre{Z..a}post) 2>/dev/null; printf 'rc=%s\\n' \"$?\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "<Z><[><><]><^><_><`><a>\n<Ytail><$value><_tail><btail><Ypost><\"post><_post><bpost>\nrc=1\n",
    );
  });

  test("18. brace expansion in declaration builtin arguments and indexed vs associative array literals", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "declare var_{1..2}=val_{a,b}",
        "printf '%s|%s\\n' \"$var_1\" \"$var_2\"",
        "values=([2]={x,y} [5]=last)",
        "printf 'idx:%s|%s|%s\\n' \"${values[0]}\" \"${values[1]}\" \"${values[5]}\"",
        "declare -A assoc=([{a,b}]={c,d})",
        "printf 'assoc:%s|%s|%s\\n' \"${#assoc[@]}\" \"${!assoc[@]}\" \"${assoc[{a,b}]}\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "val_b|val_b\nidx:[2]=x|[2]=y|last\nassoc:1|{a,b}|{c,d}\n",
    );
  });

  test("19. set +B / set -B and set +o braceexpand / set -o braceexpand toggle brace expansion and $- flag", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "case \"$-\" in *B*) echo 'has_B';; esac",
        "set +B",
        "case \"$-\" in *B*) echo 'still_B';; *) echo 'no_B';; esac",
        "printf '%s\\n' {a,b}",
        "set -o braceexpand",
        "printf '%s|%s\\n' {a,b}",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "has_B\nno_B\n{a,b}\na|b\n");
  });

  test("20. brace-expanded multi-word redirect target produces ambiguous redirect error with exit code 1", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec("echo hi > /tmp/out_{1,2}.txt");
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /ambiguous redirect/i);
  });
});
