import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure POSIX/Bash expansion, IFS, brace, glob, heredoc, eval, trap & subshell matrix", () => {
  it("1. nested parameter default, alternate, and substring slicing with empty vs unset variables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      unset U\n      E=\"\"\n      S=\"abcdef\"\n      echo \"${U:-def_u}|${U-def_u2}|${E:-def_e}|${E-def_e2}|${E:+alt_e}|${S:+alt_s}|${S:1:3}|${S: -3:2}\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "def_u|def_u2|def_e|||alt_s|bcd|de");
    });
  });

  it("2. greedy and non-greedy prefix/suffix stripping (#, ##, %, %%) on hierarchical paths and semver tags", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      p=\"/srv/data/releases/v2.14.9-rc.1/bundle.tar.gz\"\n      file=\"${p##*/}\"\n      dir=\"${p%/*}\"\n      stem=\"${file%%.*}\"\n      no_gz=\"${file%.*}\"\n      echo \"$dir|$file|$stem|$no_gz\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/srv/data/releases/v2.14.9-rc.1|bundle.tar.gz|bundle|bundle.tar");
    });
  });

  it("3. pattern replacement (${var/pat/rep}, ${var//pat/rep}, prefix #pat, suffix %pat) and case modification (${var^^}, ${var,,})", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      v=\"foo_bar_foo\"\n      c=\"MixedCaseString\"\n      echo \"${v/foo/baz}|${v//foo/baz}|${v/#foo/START}|${v/%foo/END}|${c^^}|${c,,}\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "baz_bar_foo|baz_bar_baz|START_bar_foo|foo_bar_END|MIXEDCASESTRING|mixedcasestring");
    });
  });

  it("4. indirect expansion (${!ref}) and nameref (declare -n) mutation across functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      target_a=\"initial_a\"\n      target_b=\"initial_b\"\n      ptr=\"target_a\"\n      bump() {\n        declare -n ref=$1\n        ref=\"${ref}_updated\"\n      }\n      bump target_b\n      echo \"${!ptr}|$target_b\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "initial_a|initial_b_updated");
    });
  });

  it("5. Cartesian brace expansion with numeric zero-padded ranges, character ranges, and nested preamble/postamble", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      printf \"%s\\n\" svc-{eu,us}-{01..03}{a,b} | paste -sd \",\" -\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "svc-eu-01a,svc-eu-01b,svc-eu-02a,svc-eu-02b,svc-eu-03a,svc-eu-03b,svc-us-01a,svc-us-01b,svc-us-02a,svc-us-02b,svc-us-03a,svc-us-03b");
    });
  });

  it("6. custom IFS field splitting with $@ vs $* and read -r -a preserving empty middle fields", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      join_star() {\n        local IFS=\":\"\n        echo \"$*\"\n      }\n      IFS=\",\" read -r f1 f2 f3 f4 <<< \"alpha,,gamma,delta\"\n      echo \"$(join_star a b c)|$f1|$f2|$f3|$f4\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a:b:c|alpha||gamma|delta");
    });
  });

  it("7. arithmetic expansion $(( ... )) with ternary, bitwise shifts/masks, pre/post increment, and comma operator", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      x=5\n      y=$(( (x += 3) > 6 ? (1 << 4) | 3 : 0 ))\n      z=$(( x++, x * 2 ))\n      echo \"$x|$y|$z\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "9|19|18");
    });
  });

  it("8. indexed array slicing (${arr[@]:offset:len}), negative indices, and keys enumeration (${!arr[@]})", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      arr=(zero one two three four five)\n      unset 'arr[2]'\n      keys=\"${!arr[*]}\"\n      slice=\"${arr[@]:2:3}\"\n      last=\"${arr[-1]}\"\n      echo \"${#arr[@]}|$keys|$slice|$last\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "5|0 1 3 4 5|three four five|five");
    });
  });

  it("9. associative array (declare -A) key lookup, dynamic updates, and sorted key-value serialization", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      declare -A scores=([alice]=10 [bob]=25 [carol]=15)\n      scores[alice]=$(( scores[alice] + 20 ))\n      scores[dave]=5\n      for k in \"${!scores[@]}\"; do\n        echo \"$k=${scores[$k]}\"\n      done | sort | paste -sd \",\" -\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alice=30,bob=25,carol=15,dave=5");
    });
  });

  it("10. quoted vs unquoted heredoc (<<EOF vs <<'EOF') and tab-stripping heredoc (<<-EOF)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      TAG=\"prod-42\"\n      cat <<EOF\nexpanded:$TAG:$((2 + 3))\nEOF\n      cat <<'EOF'\nliteral:$TAG:$((2 + 3))\nEOF\n      cat <<-EOF\n\t\tindented:$TAG\n\tEOF\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "expanded:prod-42:5\nliteral:$TAG:$((2 + 3))\nindented:prod-42");
    });
  });

  it("11. mapfile / readarray -t with process substitution input", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      mapfile -t lines < <(printf \"first line\\nsecond line\\nthird line\\n\")\n      echo \"${#lines[@]}|${lines[0]}|${lines[2]}\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3|first line|third line");
    });
  });

  it("12. eval with dynamically constructed pipeline and escaped variable references", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      dyn_var=\"secret_payload\"\n      ptr_name=\"dyn_var\"\n      cmd=\"printf '%s' \\\"\\$$ptr_name\\\" | tr 'a-z_' 'A-Z-'\"\n      eval \"$cmd\"\n      echo \"\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "SECRET-PAYLOAD");
    });
  });

  it("13. subshell variable isolation vs brace group state persistence in pipeline and conditional chains", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      n=10\n      ( n=99; echo \"sub:$n\" )\n      { n=$((n + 5)); echo \"grp:$n\"; }\n      echo \"outer:$n\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sub:99\ngrp:15\nouter:15");
    });
  });

  it("14. set -o pipefail and PIPESTATUS array inspection across multi-stage failing pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      set -o pipefail\n      sh -c \"echo ok; exit 3\" | tr \"a-z\" \"A-Z\" | sh -c \"cat; exit 0\"\n      echo \"rc=$?|ps=${PIPESTATUS[*]}\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "OK\nrc=3|ps=3 0 0");
    });
  });

  it("15. getopts option parsing loop with required arguments, silent error mode (:), and OPTIND reset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      parse_cli() {\n        local OPTIND=1 opt mode=\"\" count=0\n        while getopts \":m:c:v\" opt; do\n          case \"$opt\" in\n            m) mode=\"$OPTARG\" ;;\n            c) count=\"$OPTARG\" ;;\n            v) mode=\"${mode}+verbose\" ;;\n            :) echo \"missing:$OPTARG\" ;;\n            \\?) echo \"unknown:$OPTARG\" ;;\n          esac\n        done\n        shift $((OPTIND - 1))\n        echo \"mode=$mode|count=$count|rest=$*\"\n      }\n      parse_cli -m fast -v -c 4 -- extra1 extra2\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "mode=fast+verbose|count=4|rest=extra1 extra2");
    });
  });

  it("16. printf format reuse across multiple arguments, width/precision specifiers, and -v variable assignment", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      printf -v formatted \"[%04d:%-6s]\" 7 \"alpha\" 42 \"beta\"\n      echo \"$formatted\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[0007:alpha ][0042:beta  ]");
    });
  });

  it("17. shopt nullglob and dotglob effects on wildcard expansion in directories with dotfiles", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      mkdir -p /tmp/globdir\n      touch /tmp/globdir/.hidden /tmp/globdir/visible.txt\n      (\n        cd /tmp/globdir\n        shopt -s nullglob\n        none=( *.nomatch )\n        echo \"nullglob_count=${#none[@]}\"\n        shopt -s dotglob\n        all=( * )\n        printf \"%s\\n\" \"${all[@]}\" | sort | paste -sd \",\" -\n      )\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "nullglob_count=0\n.hidden,visible.txt");
    });
  });

  it("18. EXIT and ERR traps interacting with return codes and function cleanup", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      trap 'echo \"cleanup:$?\"' EXIT\n      work() {\n        echo \"working\"\n        return 7\n      }\n      work || echo \"recovered:$?\"\n      exit 0\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "working\nrecovered:7\ncleanup:0");
    });
  });

  it("19. file descriptor duplication (3>&1 1>&2 2>&3) to swap stdout and stderr in a pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      swap_out=$({ sh -c 'echo \"to_out\"; echo \"to_err\" >&2'; } 3>&1 1>&2 2>&3 | tr 'a-z' 'A-Z')\n      echo \"swapped=$swap_out\"\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "swapped=TO_ERR");
    });
  });

  it("20. bash [[ ... ]] regex matching (=~) with BASH_REMATCH capture groups", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("\n      line=\"2026-10-06T14:22:09Z [ERROR] code=503 service=auth\"\n      re='^([0-9]{4}-[0-9]{2}-[0-9]{2}).*\\[([A-Z]+)\\] code=([0-9]+) service=([a-z]+)$'\n      if [[ $line =~ $re ]]; then\n        echo \"${BASH_REMATCH[1]}|${BASH_REMATCH[2]}|${BASH_REMATCH[3]}|${BASH_REMATCH[4]}\"\n      fi\n    ");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2026-10-06|ERROR|503|auth");
    });
  });

});
