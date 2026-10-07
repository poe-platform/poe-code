import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure bash shell expansion nameref arrays traps getopts process subst edge matrix", () => {
  it("01 parameter expansion prefix suffix stripping and quote removal inside double quotes", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("path=\"/srv/releases/v2.4.1/app-bundle.tar.gz\"\ndir=\"${path%/*}\"\nbase=\"${path##*/}\"\nstem=\"${base%%.*}\"\next=\"${base#*.}\"\nraw='val=\"hello_world\"'\nclean=\"${raw//\\\"/}\"\nprintf \"dir=%s base=%s stem=%s ext=%s clean=%s\\n\" \"$dir\" \"$base\" \"$stem\" \"$ext\" \"$clean\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "dir=/srv/releases/v2.4.1 base=app-bundle.tar.gz stem=app-bundle ext=tar.gz clean=val=hello_world\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 parameter case modification and substring slicing with negative offsets", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("word=\"fRoNtEnD_sErViCe\"\nlower=\"${word,,}\"\nupper=\"${word^^}\"\ncap=\"${lower^}\"\ntail6=\"${upper: -7}\"\nmid=\"${lower:0:8}\"\nprintf \"%s|%s|%s|%s|%s\\n\" \"$lower\" \"$upper\" \"$cap\" \"$mid\" \"$tail6\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "frontend_service|FRONTEND_SERVICE|Frontend_service|frontend|SERVICE\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 associative array key iteration value aggregation and unset element", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("declare -A quotas=([api]=120 [worker]=80 [auth]=50 [cron]=30)\nunset 'quotas[cron]'\nquotas[api]=$(( quotas[api] + 30 ))\nkeys=$(for k in \"${!quotas[@]}\"; do echo \"$k\"; done | sort)\ntotal=0\nfor k in $keys; do\n  total=$(( total + quotas[$k] ))\n  printf \"%s=%s\\n\" \"$k\" \"${quotas[$k]}\"\ndone\necho \"total=$total count=${#quotas[@]}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "api=150\nauth=50\nworker=80\ntotal=280 count=3\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 indexed array slicing appending and custom IFS star join", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("arr=(alpha beta gamma delta epsilon)\narr+=(zeta)\nslice=(\"${arr[@]:1:4}\")\nIFS=':'\njoined=\"${slice[*]}\"\nunset IFS\nprintf \"len=%d joined=%s last=%s\\n\" \"${#arr[@]}\" \"$joined\" \"${arr[-1]}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "len=6 joined=beta:gamma:delta:epsilon last=zeta\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 declare -n nameref mutating caller associative array and scalar target", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(" bump_metric() {\n  local -n map_ref=\"$1\"\n  local -n sum_ref=\"$2\"\n  local key=\"$3\"\n  local delta=\"$4\"\n  map_ref[$key]=$(( ${map_ref[$key]:-0} + delta ))\n  sum_ref=$(( sum_ref + delta ))\n}\ndeclare -A counters=([hits]=10 [misses]=2)\ngrand_total=12\nbump_metric counters grand_total hits 5\nbump_metric counters grand_total errors 3\nprintf \"hits=%s misses=%s errors=%s total=%s\\n\" \"${counters[hits]}\" \"${counters[misses]}\" \"${counters[errors]}\" \"$grand_total\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "hits=15 misses=2 errors=3 total=20\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 arithmetic bases bitwise shifts ternary and comma operator", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("res=$(( (16#ff & 16#0f) << 4 | (2#1010 ^ 2#0110) ))\ntern=$(( res > 200 ? res + 8#10 : res - 8#10 ))\na=3\nb=4\ncomma=$(( a += 2, b *= a, a + b ))\nprintf \"res=%d tern=%d a=%d b=%d comma=%d\\n\" \"$res\" \"$tern\" \"$a\" \"$b\" \"$comma\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "res=252 tern=260 a=5 b=20 comma=25\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 case fallthrough with ;& and ;;& pattern matching", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("classify() {\n  local x=\"$1\"\n  local out=\"\"\n  case \"$x\" in\n    prod-*)\n      out=\"${out}PROD:\" ;&\n    *-db-*)\n      out=\"${out}TIER_MATCH:\" ;;&\n    *-db-primary)\n      out=\"${out}PRIMARY\" ;;\n    *)\n      out=\"${out}OTHER\" ;;\n  esac\n  echo \"$out\"\n}\nclassify \"prod-db-primary\"\nclassify \"staging-db-primary\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PROD:TIER_MATCH:PRIMARY\nTIER_MATCH:PRIMARY\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 getopts option parsing with required arguments and OPTIND reset", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("parse_cli() {\n  local OPTIND=1 opt env=\"dev\" retries=1 verbose=0\n  while getopts \":e:r:v\" opt; do\n    case \"$opt\" in\n      e) env=\"$OPTARG\" ;;\n      r) retries=\"$OPTARG\" ;;\n      v) verbose=1 ;;\n      :) echo \"missing:$OPTARG\"; return 1 ;;\n      \\?) echo \"invalid:$OPTARG\"; return 1 ;;\n    esac\n  done\n  shift $(( OPTIND - 1 ))\n  printf \"env=%s retries=%s verbose=%s rest=%s\\n\" \"$env\" \"$retries\" \"$verbose\" \"$*\"\n}\nparse_cli -v -e prod -r 5 deploy.sh --force\nparse_cli -e staging migrate.sh");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "env=prod retries=5 verbose=1 rest=deploy.sh --force\nenv=staging retries=1 verbose=0 rest=migrate.sh\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 trap RETURN and EXIT with explicit return status preservation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("run_step() {\n  trap 'printf \"RETURN_TRAP:rc=%d\\n\" \"$?\"' RETURN\n  echo \"running:$1\"\n  if [[ \"$1\" == \"fail\" ]]; then\n    (exit 7)\n    return 9\n  fi\n  return 0\n}\nrun_step ok\nrc1=$?\nrun_step fail || rc2=$?\nprintf \"rc1=%d rc2=%d\\n\" \"$rc1\" \"${rc2:-0}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "running:ok\nRETURN_TRAP:rc=0\nrunning:fail\nRETURN_TRAP:rc=7\nrc1=0 rc2=9\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 pipefail and PIPESTATUS array capture across multi-stage pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("set +e\nproduce() {\n  printf \"line1\\nline2\\n\"\n  return 3\n}\ntransform() {\n  tr 'a-z' 'A-Z'\n  return 0\n}\nproduce | transform | wc -l | tr -d ' '\nps=(\"${PIPESTATUS[@]}\")\nprintf \"pipestatus=%s:%s:%s:%s\\n\" \"${ps[0]}\" \"${ps[1]}\" \"${ps[2]}\" \"${ps[3]}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "2\npipestatus=3:0:0:0\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 shopt extglob pattern matching and substitution", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("shopt -s extglob\nclean_ext() {\n  local s=\"$1\"\n  echo \"${s//+([[:space:]])/-}\"\n}\nclean_ext \"hello    world   from   bash\"\nfor f in app.ts app.test.ts app.spec.ts app.js; do\n  if [[ \"$f\" == *.@(test|spec).ts ]]; then\n    echo \"TEST:$f\"\n  fi\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "hello-world-from-bash\nTEST:app.test.ts\nTEST:app.spec.ts\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 shopt nullglob and dotglob directory globbing", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p glob_dir\ntouch glob_dir/.env glob_dir/a.txt glob_dir/b.txt\nshopt -s nullglob\nnone=(glob_dir/*.nomatch)\necho \"nomatch_len=${#none[@]}\"\nshopt -s dotglob\nall=(glob_dir/*)\nIFS=,\necho \"dotglob=${all[*]}\"\nunset IFS");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "nomatch_len=0\ndotglob=glob_dir/.env,glob_dir/a.txt,glob_dir/b.txt\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 shopt failglob error handling on unmatched pattern", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("shopt -s failglob\nif ( echo no_such_file_*.xyz ) 2>err.txt; then\n  echo \"UNEXPECTED_OK\"\nelse\n  echo \"FAILGLOB_RC=$?\"\nfi\ngrep -q \"no match\" err.txt && echo \"ERR_MSG_OK\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "FAILGLOB_RC=1\nERR_MSG_OK\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 read -r -a with custom IFS and printf -v formatted buffer", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("line=\"svc-auth|10.20.1.5|8443|healthy\"\nIFS='|' read -r -a fields <<< \"$line\"\nprintf -v summary \"[%s] %s:%s (%s)\" \"${fields[0]}\" \"${fields[1]}\" \"${fields[2]}\" \"${fields[3]}\"\necho \"$summary\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[svc-auth] 10.20.1.5:8443 (healthy)\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 mapfile / readarray with -t and callback or index inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > items.txt\nfirst item\nsecond item\nthird item\nTXT\nmapfile -t lines < items.txt\nprintf \"count=%d second=%s\\n\" \"${#lines[@]}\" \"${lines[1]}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "count=3 second=second item\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 file descriptor swapping 3>&1 1>&2 2>&3 capturing stderr while discarding stdout", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("emit_both() {\n  echo \"stdout_payload\"\n  echo \"stderr_payload\" >&2\n}\ncaptured_err=$(emit_both 3>&1 1>&2 2>&3 >/dev/null)\necho \"captured=$captured_err\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "captured=stderr_payload\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 [[ =~ ]] regex matching with BASH_REMATCH capture groups and escaped parens", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("line=\"release(core): v3.14.2\"\nif [[ \"$line\" =~ ^([a-z]+)\\(([a-z]+)\\):[[:space:]]v([0-9]+\\.[0-9]+\\.[0-9]+)$ ]]; then\n  printf \"type=%s scope=%s ver=%s\\n\" \"${BASH_REMATCH[1]}\" \"${BASH_REMATCH[2]}\" \"${BASH_REMATCH[3]}\"\nfi");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "type=release scope=core ver=3.14.2\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 FUNCNAME call stack inspection and BASH_SUBSHELL depth tracking", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("level2() {\n  printf \"L2:sub=%s stack=%s>%s\\n\" \"$BASH_SUBSHELL\" \"${FUNCNAME[0]}\" \"${FUNCNAME[1]}\"\n}\nlevel1() {\n  level2\n  ( level2 )\n}\nlevel1");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "L2:sub=0 stack=level2>level1\nL2:sub=1 stack=level2>level1\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 brace expansion cartesian product with zero-padded numeric ranges", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"%s\\n\" env-{prod,stage}-node-{01..03}");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "env-prod-node-01\nenv-prod-node-02\nenv-prod-node-03\nenv-stage-node-01\nenv-stage-node-02\nenv-stage-node-03\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 heredoc variable expansion vs quoted heredoc literal preservation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("VAR=\"expanded_val\"\ncat << HEREDOC\nunquoted:$VAR:$(( 6 * 7 ))\nHEREDOC\ncat << 'HEREDOC'\nquoted:$VAR:$(( 6 * 7 ))\nHEREDOC");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "unquoted:expanded_val:42\nquoted:$VAR:$(( 6 * 7 ))\n");
    } finally {
      await h.dispose();
    }
  });

});
