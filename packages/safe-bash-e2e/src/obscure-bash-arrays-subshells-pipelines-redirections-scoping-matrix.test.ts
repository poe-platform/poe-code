import assert from "node:assert/strict";
import { test } from "node:test";
import { withE2EHarness } from "./harness.js";

test("obscure bash matrix 01: sparse indexed arrays, ${!arr[@]}, ${#arr[@]}, += append, and unset element", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      arr=([2]=\"two\" [5]=\"five\" [9]=\"nine\")\n      arr+=(\"ten\")\n      unset 'arr[5]'\n      printf \"keys=%s\\n\" \"${!arr[*]}\"\n      printf \"count=%d\\n\" \"${#arr[@]}\"\n      printf \"vals=%s\\n\" \"${arr[*]}\"\n      printf \"idx10=%s\\n\" \"${arr[10]}\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "keys=2 9 10\ncount=3\nvals=two nine ten\nidx10=ten\n");
  });
});

test("obscure bash matrix 02: associative arrays declare -A with spaced keys, mutation, count, and unset", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      declare -A meta=([env]=\"prod\" [\"service name\"]=\"auth-api\" [port]=\"8080\")\n      meta[region]=\"us-east\"\n      unset 'meta[port]'\n      printf \"count=%d svc=%s reg=%s port=%s\\n\" \"${#meta[@]}\" \"${meta[\"service name\"]}\" \"${meta[region]}\" \"${meta[port]:-unset}\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "count=3 svc=auth-api reg=us-east port=unset\n");
  });
});

test("obscure bash matrix 03: array slicing ${arr[@]:off:len} and element-wise prefix/suffix/pattern substitution", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      items=(\"pre_alpha.txt\" \"pre_beta.txt\" \"pre_gamma.txt\" \"pre_delta.txt\")\n      slice=(\"${items[@]:1:2}\")\n      printf \"slice=%s\\n\" \"${slice[*]}\"\n      stripped=(\"${items[@]#pre_}\")\n      stripped=(\"${stripped[@]%.txt}\")\n      printf \"stems=%s\\n\" \"${stripped[*]}\"\n      replaced=(\"${stripped[@]//a/A}\")\n      printf \"up=%s\\n\" \"${replaced[*]}\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "slice=pre_beta.txt pre_gamma.txt\nstems=alpha beta gamma delta\nup=AlphA betA gAmmA deltA\n"
    );
  });
});

test("obscure bash matrix 04: dynamic scoping of local variables across nested function calls", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      v=\"global_val\"\n      helper() {\n        printf \"helper_sees=%s\\n\" \"$v\"\n        v=\"mutated_by_helper\"\n      }\n      outer() {\n        local v=\"local_init\"\n        helper\n        printf \"outer_after=%s\\n\" \"$v\"\n      }\n      outer\n      printf \"global_after=%s\\n\" \"$v\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "helper_sees=local_init\nouter_after=mutated_by_helper\nglobal_after=global_val\n"
    );
  });
});

test("obscure bash matrix 05: recursive shell function with local accumulators and return status", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      sum_to() {\n        local n=$1\n        if (( n <= 0 )); then\n          echo 0\n          return 0\n        fi\n        local sub\n        sub=$(sum_to $(( n - 1 )))\n        echo $(( n + sub ))\n      }\n      printf \"sum5=%s sum10=%s\\n\" \"$(sum_to 5)\" \"$(sum_to 10)\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "sum5=15 sum10=55\n");
  });
});

test("obscure bash matrix 06: subshell ( ... ) isolating cwd and variables while persisting filesystem writes", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      mkdir -p subdir\n      x=\"parent\"\n      (\n        cd subdir\n        x=\"child\"\n        printf \"from_subshell:%s\\n\" \"$x\" > saved.txt\n      )\n      printf \"x=%s pwd_base=%s file=%s\\n\" \"$x\" \"$(basename \"$PWD\")\" \"$(cat subdir/saved.txt)\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /^x=parent pwd_base=\S+ file=from_subshell:child\n$/);
  });
});

test("obscure bash matrix 07: brace group { ...; } in current shell vs pipeline subshell isolation", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      a=1\n      { a=2; b=3; }\n      echo \"hi\" | { a=99; cat >/dev/null; }\n      printf \"a=%d b=%d\\n\" \"$a\" \"$b\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "a=2 b=3\n");
  });
});

test("obscure bash matrix 08: PIPESTATUS array and set -o pipefail across multi-stage failing pipeline", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      s1() { echo \"stage1\"; return 3; }\n      s2() { cat >/dev/null; echo \"stage2\"; return 0; }\n      s3() { cat >/dev/null; return 7; }\n      s1 | s2 | s3\n      printf \"ps=%s\\n\" \"${PIPESTATUS[*]}\"\n      set -o pipefail\n      s1 | s2 || rc=$?\n      printf \"pipefail_rc=%d\\n\" \"$rc\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "ps=3 0 7\nstage2\npipefail_rc=3\n");
  });
});

test("obscure bash matrix 09: process substitution <(...) feeding while-read in parent shell and comm", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      total=0\n      while read -r num; do\n        (( total += num ))\n      done < <(printf \"10\\n20\\n30\\n\")\n      common=$(comm -12 <(printf \"a\\nb\\nc\\n\") <(printf \"b\\nc\\nd\\n\") | paste -s -d , -)\n      printf \"total=%d common=%s\\n\" \"$total\" \"$common\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "total=60 common=b,c\n");
  });
});

test("obscure bash matrix 10: <<-EOF tab-stripped heredoc, quoted <<'EOF', and <<< here-string", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      v=\"expanded\"\n      cat <<-EOF\n\tline_one:$v\n\t\tline_two\n\tEOF\n      cat <<'EOF'\n$v_literal\nEOF\n      tr 'a-z' 'A-Z' <<< \"hello_${v}\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "line_one:expanded\nline_two\n$v_literal\nHELLO_EXPANDED\n");
  });
});

test("obscure bash matrix 11: file descriptor redirections swapping stdout and stderr (3>&1 1>&2 2>&3)", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      emit_both() {\n        echo \"OUT_MSG\"\n        echo \"ERR_MSG\" >&2\n      }\n      captured=$(emit_both 3>&1 1>&2 2>&3 3>&-)\n      printf \"captured=%s\\n\" \"$captured\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "captured=ERR_MSG\n");
    assert.equal(res.stderr, "OUT_MSG\n");
  });
});

test("obscure bash matrix 12: compound command redirections on while, for, and case blocks", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      printf \"k1:10\\nk2:20\\n\" > pairs.txt\n      while IFS=: read -r k v; do\n        printf \"%s=%d\\n\" \"$k\" $(( v * 2 ))\n      done < pairs.txt > doubled.txt\n      for item in x y; do\n        printf \"[%s]\\n\" \"$item\"\n      done >> doubled.txt\n      cat doubled.txt\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "k1=20\nk2=40\n[x]\n[y]\n");
  });
});

test("obscure bash matrix 13: deeply nested command substitutions $( ... $( ... ) ) preserving inner quotes", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      msg=$(printf \"outer(%s)\" \"$(printf \"mid[%s]\" \"$(echo \"inner space\")\")\")\n      printf \"%s\\n\" \"$msg\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "outer(mid[inner space])\n");
  });
});

test("obscure bash matrix 14: brace expansion with nested alternatives, zero-padded ranges, and step increments", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      printf \"%s \" {a,b}{01..03}\n      printf \"\\n\"\n      printf \"%s \" {10..2..4}\n      printf \"\\n\"\n      printf \"%s \" pkg/{core,ext/{io,net}}.ts\n      printf \"\\n\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "a01 a02 a03 b01 b02 b03 \n10 6 2 \npkg/core.ts pkg/ext/io.ts pkg/ext/net.ts \n"
    );
  });
});

test("obscure bash matrix 15: shopt extglob and nullglob with !(pat), @(a|b), +(digit) filename matching", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      shopt -s extglob nullglob\n      mkdir -p gdir\n      touch gdir/app.ts gdir/app.test.ts gdir/util.js gdir/readme.md gdir/v123.log\n      cd gdir\n      echo \"non_md:\" !(*readme.md)\n      echo \"ts_or_js:\" @(*.ts|*.js)\n      echo \"digits:\" v+([0-9]).log\n      echo \"nomatch:\" *.nonexistent\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "non_md: app.test.ts app.ts util.js v123.log\nts_or_js: app.test.ts app.ts util.js\ndigits: v123.log\nnomatch:\n"
    );
  });
});

test("obscure bash matrix 16: [[ ... ]] regex =~ capturing BASH_REMATCH and quoted vs unquoted == globs", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      tag=\"rel-2025.04-rc2\"\n      if [[ $tag =~ ^rel-([0-9]{4})\\.([0-9]{2})-(rc[0-9]+)$ ]]; then\n        printf \"full=%s yr=%s mo=%s rc=%s\\n\" \"${BASH_REMATCH[0]}\" \"${BASH_REMATCH[1]}\" \"${BASH_REMATCH[2]}\" \"${BASH_REMATCH[3]}\"\n      fi\n      val=\"a*b\"\n      [[ $val == a* ]] && echo \"glob_matched\"\n      [[ $val == \"a*b\" ]] && echo \"literal_matched\"\n      [[ \"abc\" == \"a*c\" ]] || echo \"quoted_star_did_not_glob\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "full=rel-2025.04-rc2 yr=2025 mo=04 rc=rc2\nglob_matched\nliteral_matched\nquoted_star_did_not_glob\n"
    );
  });
});

test("obscure bash matrix 17: C-style for ((...)) and ((...)) arithmetic with ternary, bitwise, and radix literals", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      acc=0\n      for (( i = 1, j = 10; i <= 4; i++, j -= 2 )); do\n        (( acc += (i % 2 ? i * j : j) ))\n      done\n      (( hex_bin = 0x10 + 2#101 + 8#10 ))\n      (( 0 )) || zero_rc=$?\n      printf \"acc=%d radix=%d zero_rc=%d\\n\" \"$acc\" \"$hex_bin\" \"$zero_rc\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "acc=40 radix=29 zero_rc=1\n");
  });
});

test("obscure bash matrix 18: nested for loops with multi-level break 2 and continue 2", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      out=\"\"\n      for a in 1 2 3; do\n        for b in x y z; do\n          if [[ \"$a$b\" == \"1y\" ]]; then\n            continue 2\n          fi\n          if [[ \"$a$b\" == \"3y\" ]]; then\n            break 2\n          fi\n          out+=\"$a$b \"\n        done\n      done\n      printf \"%s\\n\" \"$out\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1x 2x 2y 2z 3x \n");
  });
});

test("obscure bash matrix 19: positional parameters set --, $* with custom IFS vs $@ preserving empty args", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      set -- \"first arg\" \"\" \"third\" \"fourth\"\n      IFS=\"|\"\n      printf \"star=%s\\n\" \"$*\"\n      IFS=\" \"\n      printf \"count=%d\\n\" \"$#\"\n      for arg in \"$@\"; do\n        printf \"<%s>\" \"$arg\"\n      done\n      printf \"\\n\"\n      shift 2\n      printf \"after_shift=%s\\n\" \"${*:1:2}\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "star=first arg||third|fourth\ncount=4\n<first arg><><third><fourth>\nafter_shift=third fourth\n"
    );
  });
});

test("obscure bash matrix 20: trap EXIT and ERR handlers with subshell and function return cleanup", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec("\n      trap 'printf \"ON_EXIT\\n\"' EXIT\n      trap 'printf \"ON_ERR:%d\\n\" \"$?\"' ERR\n      false\n      printf \"BODY_DONE\\n\"\n    ");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "ON_ERR:1\nBODY_DONE\nON_EXIT\n");
  });
});
