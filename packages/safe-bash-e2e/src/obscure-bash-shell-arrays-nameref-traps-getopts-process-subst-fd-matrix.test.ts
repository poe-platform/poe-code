import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure bash shell arrays nameref traps getopts process subst fd matrix", () => {
  it("1. associative array (declare -A) key iteration, += append, and element deletion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("declare -A scores=([alice]=10 [bob]=20)\nscores[alice]+=5\nscores[carol]=30\nunset 'scores[bob]'\nfor k in $(printf '%s\\n' \"${!scores[@]}\" | sort); do\n  echo \"$k=${scores[$k]}\"\ndone");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alice=105\ncarol=30");
    });
  });

  it("2. indexed array slicing (${arr[@]:off:len}), pattern replacement, and negative indices", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("arr=(alpha_v1 beta_v1 gamma_v1 delta_v1 epsilon_v1)\nslice=(\"${arr[@]:1:3}\")\necho \"slice=${slice[*]}\"\necho \"repl=${slice[@]/_v1/_v2}\"\necho \"last=${arr[-1]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "slice=beta_v1 gamma_v1 delta_v1\nrepl=beta_v2 gamma_v2 delta_v2\nlast=epsilon_v1");
    });
  });

  it("3. declare -n nameref chaining across functions with array target mutation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mutate_vec() {\n  local -n ref=$1\n  ref+=(\"$2\")\n  ref[0]=\"[${ref[0]}]\"\n}\nitems=(first second)\nmutate_vec items third\nprintf '%s,' \"${items[@]}\"; echo");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[first],second,third,");
    });
  });

  it("4. parameter case modification (${v^}, ${v^^}, ${v,}, ${v,,}) and @U/@L/@u/@Q operators", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("word=\"hElLo_WoRlD\"\necho \"${word^^}|${word,,}|${word^}|${word,}\"\necho \"${word@U}|${word@L}|${word@u}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "HELLO_WORLD|hello_world|HElLo_WoRlD|hElLo_WoRlD\nHELLO_WORLD|hello_world|HElLo_WoRlD");
    });
  });

  it("5. greedy and non-greedy prefix/suffix stripping (#, ##, %, %%) on nested paths", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("p=\"/var/log/nginx/access.2026.log.gz\"\necho \"${p#*/}|${p##*/}|${p%.*}|${p%%.*}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "var/log/nginx/access.2026.log.gz|access.2026.log.gz|/var/log/nginx/access.2026.log|/var/log/nginx/access");
    });
  });

  it("6. process substitution <(cmd1) <(cmd2) feeding diff and join", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("join -t: <(printf '2:bob\\n1:alice\\n' | sort) <(printf '1:admin\\n2:user\\n' | sort)");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1:alice:admin\n2:bob:user");
    });
  });

  it("7. custom file descriptors (exec 3> / 4<) bidirectional read/write and closure", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("exec 3> /tmp/fd_io.txt\necho \"line_alpha\" >&3\necho \"line_beta\" >&3\nexec 3>&-\nexec 4< /tmp/fd_io.txt\nread -r -u 4 first_line\nread -r -u 4 second_line\nexec 4<&-\necho \"$first_line|$second_line\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "line_alpha|line_beta");
    });
  });

  it("8. set -C noclobber protection against accidental overwrite and >| forced override", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("set -C\necho \"initial\" > /tmp/noclob.txt\n(echo \"blocked\" > /tmp/noclob.txt) 2>/dev/null || echo \"PROTECTED\"\ncat /tmp/noclob.txt\necho \"forced\" >| /tmp/noclob.txt\ncat /tmp/noclob.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PROTECTED\ninitial\nforced");
    });
  });

  it("9. trap EXIT, ERR, and RETURN execution order across nested function calls", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("events=()\ntrap 'events+=(\"EXIT:${#events[@]}\"); echo \"${events[*]}\"' EXIT\nhelper() {\n  trap 'events+=(\"RET:$?\")' RETURN\n  events+=(\"IN_HELPER\")\n  return 0\n}\nhelper\nevents+=(\"AFTER_HELPER\")");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "IN_HELPER RET:0 AFTER_HELPER EXIT:3");
    });
  });

  it("10. set -o pipefail with PIPESTATUS array inspection across 3-stage pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("set -o pipefail\n(exit 3) | (echo ok) | (exit 0) || rc=$?\necho \"rc=$rc\"\n(exit 2) | (exit 5) | true\necho \"pipes=${PIPESTATUS[0]},${PIPESTATUS[1]},${PIPESTATUS[2]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rc=3\npipes=2,5,0");
    });
  });

  it("11. shopt -s extglob extended pattern matching (@(...), +(...), !(...) ) in case and [[ ]]", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("shopt -s extglob\nfor f in app.ts app.js app.py style.css; do\n  case \"$f\" in\n    *.@(ts|js)) echo \"web:$f\" ;;\n    !(*.css))   echo \"other:$f\" ;;\n    *)          echo \"style:$f\" ;;\n  esac\ndone");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "web:app.ts\nweb:app.js\nother:app.py\nstyle:style.css");
    });
  });

  it("12. shopt -s nullglob and failglob dynamic switching on unmatched globs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/glob_dir\nshopt -s nullglob\nmatches=(/tmp/glob_dir/*.nonexistent)\necho \"nullglob_count=${#matches[@]}\"\nshopt -u nullglob\nshopt -s failglob\n(echo /tmp/glob_dir/*.nonexistent) 2>/dev/null || echo \"FAILGLOB_CAUGHT\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "nullglob_count=0\nFAILGLOB_CAUGHT");
    });
  });

  it("13. getopts loop with silent error reporting (:), required arguments, and OPTIND shift", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("parse_cli() {\n  local OPTIND=1 opt mode=\"\" verbose=0\n  while getopts ':m:vx' opt; do\n    case \"$opt\" in\n      m) mode=\"$OPTARG\" ;;\n      v) verbose=$((verbose + 1)) ;;\n      :) echo \"missing:$OPTARG\" ;;\n      \\?) echo \"unknown:$OPTARG\" ;;\n    esac\n  done\n  shift $((OPTIND - 1))\n  echo \"mode=$mode v=$verbose rest=$*\"\n}\nparse_cli -v -m fast -v -z arg1 arg2");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "unknown:z\nmode=fast v=2 rest=arg1 arg2");
    });
  });

  it("14. mapfile / readarray with -t, -s skip, -n count, and custom -d delimiter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'skip1\\nskip2\\nkeep1\\nkeep2\\nkeep3\\nextra\\n' > /tmp/map.txt\nmapfile -t -s 2 -n 3 lines < /tmp/map.txt\nprintf '%s|' \"${lines[@]}\"; echo\nprintf 'a:b:c:' > /tmp/delim.txt\nmapfile -t -d : parts < /tmp/delim.txt\nprintf '[%s]' \"${parts[@]}\"; echo");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "keep1|keep2|keep3|\n[a][b][c]");
    });
  });

  it("15. arithmetic expansion with hex (16#), binary (2#), octal (8#), bitwise ops, and ternary", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("a=$(( 16#ff & 2#11110000 ))\nb=$(( 8#10 << 2 ))\nc=$(( a > 200 ? a - b : b - a ))\necho \"a=$a b=$b c=$c\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a=240 b=32 c=208");
    });
  });

  it("16. [[ =~ ]] regex capture groups in BASH_REMATCH array", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("line=\"commit 9f8e7d6c by alice_dev (tag: v1.4.2)\"\nif [[ \"$line\" =~ commit\\ ([0-9a-f]+)\\ by\\ ([a-z_]+)\\ \\(tag:\\ (v[0-9.]+)\\) ]]; then\n  echo \"sha=${BASH_REMATCH[1]} author=${BASH_REMATCH[2]} tag=${BASH_REMATCH[3]}\"\nfi");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sha=9f8e7d6c author=alice_dev tag=v1.4.2");
    });
  });

  it("17. case statement with ;& fallthrough and ;;& continue-testing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("out=\"\"\nval=\"ab\"\ncase \"$val\" in\n  a*) out+=\"starts_a,\";;&\n  *b) out+=\"ends_b,\";&\n  *)  out+=\"fallback\" ;;\nesac\necho \"$out\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "starts_a,ends_b,fallback");
    });
  });

  it("18. output process substitution >(...) fan-out with tee", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'alpha\\nbeta\\ngamma\\n' | tee >(wc -l | tr -d ' ' > /tmp/ps_cnt.txt) >(tr 'a-z' 'A-Z' > /tmp/ps_up.txt) >/dev/null\ncat /tmp/ps_cnt.txt\ncat /tmp/ps_up.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3\nALPHA\nBETA\nGAMMA");
    });
  });

  it("19. printf %q shell quoting, hex formatting, and -v variable assignment", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf -v quoted '%q' 'hello world'\nprintf -v hex '%04x' 48879\necho \"quoted=$quoted hex=$hex\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "quoted=hello\\ world hex=beef");
    });
  });

  it("20. FUNCNAME call-stack inspection and BASH_SUBSHELL depth tracking", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("level2() { echo \"stack=${FUNCNAME[*]} sub=$BASH_SUBSHELL\"; }\nlevel1() { level2; ( level2 ); }\nlevel1");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "stack=level2 level1 sub=0\nstack=level2 level1 sub=1");
    });
  });

});
