import assert from "node:assert/strict";
import test from "node:test";
import { withE2EHarness } from "./harness.js";

test("eval executes dynamically constructed pipelines, indirect assignments, and preserves exit codes", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "set_indirect() { eval \"$1=\\$2\"; }",
      "set_indirect TARGET_VAR 'hello;world $not_expanded'",
      "printf 'indirect=<%s>\\n' \"$TARGET_VAR\"",
      "stage1=\"printf 'c\\na\\nb\\n'\"",
      "stage2='sort'",
      "stage3=\"paste -sd ',' -\"",
      "eval \"$stage1 | $stage2 | $stage3\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "indirect=<hello;world $not_expanded>",
        "a,b,c",
        "",
      ].join("\n"),
    );
  });
});

test("source (.) loads scripts with positional arguments, searches PATH, and handles return N without exiting caller", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/bin/lib_helper.sh": [
          "LOADED_FROM_PATH='yes'",
          "LIB_ARGS=\"$1:${2:-none}\"",
          "if [ \"$1\" = 'early' ]; then return 7; fi",
          "AFTER_RETURN='reached'",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "export PATH=\"/workspace/bin:$PATH\"",
        "set -- caller1 caller2",
        ". lib_helper.sh early extra || rc=$?",
        "printf 'rc=%d loaded=%s args=%s after=%s caller=%s,%s\\n' \"$rc\" \"$LOADED_FROM_PATH\" \"$LIB_ARGS\" \"${AFTER_RETURN:-skipped}\" \"$1\" \"$2\"",
      ].join("\n");

      await h.expectOk(
        script,
        "rc=7 loaded=yes args=early:extra after=skipped caller=caller1,caller2\n",
      );
    },
  );
});

test("compound block file descriptors (3..9) support writing (>&3), reading (read -u 3 / <&3), and closing (3>&-)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "{",
      "  echo 'event-1' >&3",
      "  echo 'event-2' >&3",
      "} 3>/workspace/audit.log",
      "{",
      "  read -r -u 3 first_line",
      "  read -r -u 3 second_line",
      "  printf 'fd3:%s,%s\\n' \"$first_line\" \"$second_line\"",
      "} 3</workspace/audit.log",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "fd3:event-1,event-2",
        "",
      ].join("\n"),
    );
  });
});

test("command, builtin, type, and which resolve shadowing between functions, builtins, and external commands", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "echo() { builtin printf '[wrapped:%s]\\n' \"$*\"; }",
      "echo 'hello'",
      "builtin echo 'raw-builtin'",
      "command echo 'via-command'",
      "type -t echo",
      "command -v jq",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "[wrapped:hello]",
        "raw-builtin",
        "via-command",
        "function",
        "jq",
        "",
      ].join("\n"),
    );
  });
});

test("getopts parses clustered short flags, required arguments, silent error mode (:), and resets via OPTIND=1", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "parse_cli() {",
      "  local OPTIND=1 opt out=''",
      "  while getopts ':ab:c:' opt \"$@\"; do",
      "    case \"$opt\" in",
      "      a) out=\"${out}A;\" ;;",
      "      b) out=\"${out}B=${OPTARG};\" ;;",
      "      c) out=\"${out}C=${OPTARG};\" ;;",
      "      :) out=\"${out}MISSING=${OPTARG};\" ;;",
      "      \\?) out=\"${out}UNKNOWN=${OPTARG};\" ;;",
      "    esac",
      "  done",
      "  shift $((OPTIND - 1))",
      "  printf '%srest=%s\\n' \"$out\" \"$*\"",
      "}",
      "parse_cli -abval1 -c val2 pos1 pos2",
      "parse_cli -x -b",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "A;B=val1;C=val2;rest=pos1 pos2",
        "UNKNOWN=x;MISSING=b;rest=",
        "",
      ].join("\n"),
    );
  });
});

test("printf supports format reuse, width/precision, hex/float, %b escapes, %q shell quoting, and -v assignment", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf -v formatted '[%-6.4s|%04d|%#x|%.2f]' 'abcdef' 42 255 3.14159",
      "printf '%s\\n' \"$formatted\"",
      "printf '(%s:%d)' x 1 y 2 z 3",
      "echo ''",
      "raw=$'hello world\\n$danger `cmd` \"quote\"'",
      "printf -v quoted '%q' \"$raw\"",
      "eval \"restored=$quoted\"",
      "[ \"$restored\" = \"$raw\" ] && echo 'roundtrip:ok'",
      "printf '%b' 'before\\x21\\cafter_ignored'",
      "echo ''",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "[abcd  |0042|0xff|3.14]",
        "(x:1)(y:2)(z:3)",
        "roundtrip:ok",
        "before!",
        "",
      ].join("\n"),
    );
  });
});

test("read handles custom IFS, -r raw mode, -d delimiter, -n char limit, and -a array population", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "IFS=':' read -r user uid gid rest <<< 'root:0:0:super:user:\\path'",
      "printf 'u=%s id=%s:%s rest=%s\\n' \"$user\" \"$uid\" \"$gid\" \"$rest\"",
      "IFS=',' read -r -a cols <<< 'c1,c2,c3,c4'",
      "printf 'arr=%d:%s\\n' \"${#cols[@]}\" \"${cols[2]}\"",
      "read -r -d ';' token <<< 'first_segment;second_segment'",
      "printf 'delim=%s\\n' \"$token\"",
      "read -r -n 4 prefix <<< 'abcdefgh'",
      "printf 'n4=%s\\n' \"$prefix\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "u=root id=0:0 rest=super:user:\\path",
        "arr=4:c3",
        "delim=first_segment",
        "n4=abcd",
        "",
      ].join("\n"),
    );
  });
});

test("mapfile / readarray populates indexed arrays with -t, -s skip, -n count, -O origin, and -d delimiter", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'skip0\\nskip1\\nkeep1\\nkeep2\\nkeep3\\nextra\\n' > /workspace/lines.txt",
      "mapfile -t -s 2 -n 3 -O 10 picked < /workspace/lines.txt",
      "printf 'keys=%s vals=%s\\n' \"${!picked[*]}\" \"${picked[*]}\"",
      "printf 'a\\0b\\0c\\0' > /workspace/nul.bin",
      "readarray -t -d '' nul_items < /workspace/nul.bin",
      "printf 'nul=%d:%s,%s,%s\\n' \"${#nul_items[@]}\" \"${nul_items[0]}\" \"${nul_items[1]}\" \"${nul_items[2]}\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "keys=10 11 12 vals=keep1 keep2 keep3",
        "nul=3:a,b,c",
        "",
      ].join("\n"),
    );
  });
});

test("dynamic scoping of local variables across nested function call chains", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "x='global'",
      "inner() { printf 'inner_before=%s\\n' \"$x\"; x='mutated_by_inner'; }",
      "outer() {",
      "  local x='outer_local'",
      "  inner",
      "  printf 'outer_after=%s\\n' \"$x\"",
      "}",
      "outer",
      "printf 'global_after=%s\\n' \"$x\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "inner_before=outer_local",
        "outer_after=mutated_by_inner",
        "global_after=global",
        "",
      ].join("\n"),
    );
  });
});

test("trap EXIT, ERR, and RETURN execute in deterministic order and preserve exit code", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "(",
      "  trap 'printf \"EXIT:%d\\n\" \"$?\"' EXIT",
      "  helper() {",
      "    trap 'echo \"RETURN_TRAP\"' RETURN",
      "    echo 'inside_helper'",
      "  }",
      "  helper",
      "  exit 19",
      ") || rc=$?",
      "printf 'subshell_rc=%d\\n' \"$rc\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "inside_helper",
        "RETURN_TRAP",
        "EXIT:19",
        "subshell_rc=19",
        "",
      ].join("\n"),
    );
  });
});

test("[[ conditional expressions support glob matching, regex =~ with BASH_REMATCH, and no word-splitting", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "tag='release-v2.14.8-rc1'",
      "if [[ $tag =~ ^release-v([0-9]+)\\.([0-9]+)\\.([0-9]+)-([a-z0-9]+)$ ]]; then",
      "  printf 'full=%s maj=%s min=%s pat=%s pre=%s\\n' \"${BASH_REMATCH[0]}\" \"${BASH_REMATCH[1]}\" \"${BASH_REMATCH[2]}\" \"${BASH_REMATCH[3]}\" \"${BASH_REMATCH[4]}\"",
      "fi",
      "spaced='hello   world'",
      "[[ $spaced == 'hello   '* && $spaced != *.txt ]] && echo 'glob:ok'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "full=release-v2.14.8-rc1 maj=2 min=14 pat=8 pre=rc1",
        "glob:ok",
        "",
      ].join("\n"),
    );
  });
});

test("(( ... )) and let evaluate C-style arithmetic, base literals, bitwise ops, and boolean exit codes", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "(( a = 2#1010, b = 16#1f, c = (a << 2) ^ b ))",
      "let 'c += 3' 'd = c > 50 ? 100 : 200'",
      "printf 'a=%d b=%d c=%d d=%d\\n' \"$a\" \"$b\" \"$c\" \"$d\"",
      "(( 0 )) && echo 'nonzero' || echo 'zero_is_false'",
      "(( 42 )) && echo 'nonzero_is_true'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "a=10 b=31 c=58 d=100",
        "zero_is_false",
        "nonzero_is_true",
        "",
      ].join("\n"),
    );
  });
});

test("case statement supports pattern alternation, ;& unconditional fallthrough, and ;;& pattern continuation", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "classify() {",
      "  local out=''",
      "  case \"$1\" in",
      "    *.tar.gz) out=\"${out}targz;\";;&",
      "    *.gz)     out=\"${out}gzip;\" ;&",
      "    *)        out=\"${out}archive\" ;;",
      "  esac",
      "  printf '%s\\n' \"$out\"",
      "}",
      "classify 'bundle.tar.gz'",
      "classify 'single.gz'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "targz;gzip;archive",
        "gzip;archive",
        "",
      ].join("\n"),
    );
  });
});

test("multi-level break N and continue N control nested for/while loops accurately", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "out=''",
      "for i in 1 2 3; do",
      "  for j in a b c; do",
      "    if [ \"$i$j\" = '1b' ]; then continue 2; fi",
      "    if [ \"$i$j\" = '3b' ]; then break 2; fi",
      "    out=\"${out}${i}${j},\"",
      "  done",
      "done",
      "printf '%s\\n' \"$out\"",
    ].join("\n");

    await h.expectOk(script, "1a,2a,2b,2c,3a,\n");
  });
});

test("cd -L / -P and pwd -L / -P distinguish logical symlink paths from physical realpaths", async () => {
  await withE2EHarness(
    {
      directories: ["/workspace/real/target_dir", "/workspace/links"],
      symlinks: { "/workspace/links/shortcut": "/workspace/real/target_dir" },
    },
    async (h) => {
      const script = [
        "cd -L /workspace/links/shortcut",
        "pwd -L",
        "pwd -P",
        "cd -P /workspace/links/shortcut",
        "pwd -L",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "/workspace/links/shortcut",
          "/workspace/real/target_dir",
          "/workspace/real/target_dir",
          "",
        ].join("\n"),
      );
    },
  );
});

test("positional parameters: set --, shift, \"$@\" vs \"$*\" with custom IFS, and slice expansion ${@:start:len}", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "set -- 'one 1' 'two 2' 'three 3' 'four 4'",
      "shift 1",
      "IFS='|'",
      "printf 'star=<%s>\\n' \"$*\"",
      "printf 'at=<%s>\\n' \"$@\"",
      "printf 'slice=<%s>\\n' \"${@:2:2}\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "star=<two 2|three 3|four 4>",
        "at=<two 2>",
        "at=<three 3>",
        "at=<four 4>",
        "slice=<three 3>",
        "slice=<four 4>",
        "",
      ].join("\n"),
    );
  });
});

test("background jobs (&), $!, jobs, and wait propagate individual background process exit statuses", async () => {
  await withE2EHarness({ backgroundJobs: true }, async (h) => {
    const script = [
      "(echo 'bg1' > /workspace/bg1.txt; exit 0) &",
      "p1=$!",
      "(echo 'bg2' > /workspace/bg2.txt; exit 23) &",
      "p2=$!",
      "wait \"$p1\"; rc1=$?",
      "wait \"$p2\" || rc2=$?",
      "printf 'rc1=%d rc2=%d bg1=%s bg2=%s\\n' \"$rc1\" \"$rc2\" \"$(cat /workspace/bg1.txt)\" \"$(cat /workspace/bg2.txt)\"",
    ].join("\n");

    await h.expectOk(script, "rc1=0 rc2=23 bg1=bg1 bg2=bg2\n");
  });
});

test("test / [ file predicates (-f, -d, -L, -s, -r, -w, -x, -nt, -ot, -ef) evaluate VFS metadata", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/old.txt": { content: "non-empty", mode: 0o755, mtime: new Date("2025-01-01T00:00:00Z") },
        "/workspace/new.txt": { content: "", mode: 0o644, mtime: new Date("2026-01-01T00:00:00Z") },
      },
      symlinks: {
        "/workspace/link.txt": "/workspace/old.txt",
      },
    },
    async (h) => {
      const script = [
        "[ -f /workspace/old.txt ] && [ -s /workspace/old.txt ] && [ -x /workspace/old.txt ] && echo 'old:ok'",
        "[ -f /workspace/new.txt ] && [ ! -s /workspace/new.txt ] && [ ! -x /workspace/new.txt ] && echo 'new:ok'",
        "[ -L /workspace/link.txt ] && [ /workspace/link.txt -ef /workspace/old.txt ] && echo 'link:ok'",
        "[ /workspace/new.txt -nt /workspace/old.txt ] && [ /workspace/old.txt -ot /workspace/new.txt ] && echo 'time:ok'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "old:ok",
          "new:ok",
          "link:ok",
          "time:ok",
          "",
        ].join("\n"),
      );
    },
  );
});

test("colon (:) null utility evaluates parameter default assignments (:=) in current shell scope", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "unset PORT HOST",
      ": \"${HOST:=127.0.0.1}\" \"${PORT:=8080}\"",
      ": \"${PORT:=9999}\"",
      "printf '%s:%s\\n' \"$HOST\" \"$PORT\"",
    ].join("\n");

    await h.expectOk(script, "127.0.0.1:8080\n");
  });
});

test("prefix variable assignments on functions vs external commands follow shell scoping rules", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "TEMP_VAR='original'",
      "TEMP_VAR='for_env_only' printenv TEMP_VAR",
      "printf 'after_ext=%s\\n' \"$TEMP_VAR\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "for_env_only",
        "after_ext=original",
        "",
      ].join("\n"),
    );
  });
});
