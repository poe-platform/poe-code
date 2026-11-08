import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure bash shell expansion nameref arrays traps getopts subshell matrix", () => {
  it("01 nameref scalar and array read write and !ref", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("target=\"init\"\ndeclare -n ref=target\nref=\"updated\"\narr=(10 20 30)\ndeclare -n aref=arr\naref[1]=99\necho \"${!ref}|$target|${arr[1]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "target|updated|99");
    });
  });

  it("02 associative array declare keys unset count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("declare -A m=([alpha]=\"1\" [beta]=\"2\" [gamma]=\"3\")\nunset 'm[beta]'\nm[delta]=\"4\"\nfor k in \"${!m[@]}\"; do\n  echo \"$k=${m[$k]}\"\ndone | sort | paste -sd ',' -\necho \"count=${#m[@]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha=1,delta=4,gamma=3\ncount=3");
    });
  });

  it("03 sparse indexed array indices slice append", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("arr=()\narr[2]=\"two\"\narr[5]=\"five\"\narr[9]=\"nine\"\narr+=(\"ten\")\necho \"keys:${!arr[*]}|slice:${arr[@]:1:2}|len:${#arr[@]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "keys:2 5 9 10|slice:two five|len:4");
    });
  });

  it("04 parameter case conversion operators", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("w=\"hELLo_wORLd\"\na=(\"foo\" \"Bar\")\necho \"${w^}|${w^^}|${w,}|${w,,}|${a[*]^^}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "HELLo_wORLd|HELLO_WORLD|hELLo_wORLd|hello_world|FOO BAR");
    });
  });

  it("05 parameter substring and pattern strip replace", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("p=\"/var/log/app/error.log\"\ns=\"pre_foo_mid_foo_suf\"\necho \"${p:5:3}|${p: -9:5}|${p#*/}|${p##*/}|${p%/*}|${p%%/*}|${s/foo/BAR}|${s//foo/BAR}|${s/#pre/START}|${s/%suf/END}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "log|error|var/log/app/error.log|error.log|/var/log/app||pre_BAR_mid_foo_suf|pre_BAR_mid_BAR_suf|START_foo_mid_foo_suf|pre_foo_mid_foo_END");
    });
  });

  it("06 default assign alternate and error expansions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("u=\"\"\nunset z\necho \"${u:-def1}|${u-def2}|${z:=assigned}|$z|${z:+alt}\"\n( : \"${missing_var:?custom_boom}\" ) 2>err.txt || echo \"err_exit=$?\"\ngrep -o \"custom_boom\" err.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "def1||assigned|assigned|alt\nerr_exit=1\ncustom_boom");
    });
  });

  it("07 IFS read remainder and array join", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("IFS=: read -r f1 f2 rest <<< \"a:b:c:d:e\"\nitems=(\"x\" \"y\" \"z\")\nIFS=-\njoined_dash=\"${items[*]}\"\nIFS=\"\"\njoined_empty=\"${items[*]}\"\nunset IFS\necho \"$f1|$f2|$rest|$joined_dash|$joined_empty\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a|b|c:d:e|x-y-z|xyz");
    });
  });

  it("08 mapfile slice skip and count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'line0\\nline1\\nline2\\nline3\\nline4\\n' > lines.txt\nmapfile -t -s 1 -n 2 picked < lines.txt\necho \"${#picked[@]}|${picked[0]}|${picked[1]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2|line1|line2");
    });
  });

  it("09 getopts inside function with local OPTIND", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("parse_args() {\n  local OPTIND=1 opt a_val=\"\" b_flag=0\n  while getopts \":a:b\" opt; do\n    case \"$opt\" in\n      a) a_val=\"$OPTARG\" ;;\n      b) b_flag=1 ;;\n      :) echo \"missing:$OPTARG\"; return 1 ;;\n      \\?) echo \"unknown:$OPTARG\"; return 1 ;;\n    esac\n  done\n  shift $((OPTIND - 1))\n  echo \"a=$a_val|b=$b_flag|rest=$*\"\n}\nparse_args -b -a hello world\nparse_args -a 2>&1 || true\nparse_args -z 2>&1 || true");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a=hello|b=1|rest=world\nmissing:a\nunknown:z");
    });
  });

  it("10 traps EXIT ERR and RETURN", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("fn_ret() {\n  trap 'echo \"ret_trap:$?\"' RETURN\n  (exit 7)\n}\nfn_ret || echo \"fn_status:$?\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ret_trap:7\nfn_status:7");
    });
  });

  it("11 errexit and pipefail with subshell recovery", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("(\n  set -eo pipefail\n  false | true\n  echo \"unreachable\"\n)\necho \"pipefail_caught:$?\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "pipefail_caught:1");
    });
  });

  it("12 nounset unbound variable check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("(\n  set -u\n  echo \"${defined_or_default:-safe}\"\n  echo \"$totally_unbound_var\"\n) 2>/dev/null || echo \"nounset_caught\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "safe\nnounset_caught");
    });
  });

  it("13 noclobber prevent overwrite and force clobber", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("set -C\necho \"v1\" > guarded.txt\n( echo \"v2\" > guarded.txt ) 2>/dev/null || echo \"blocked\"\necho \"v3\" >| guarded.txt\necho \"v4\" >> guarded.txt\ncat guarded.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "blocked\nv3\nv4");
    });
  });

  it("14 extglob nullglob and failglob", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p gdir && cd gdir\ntouch a.ts b.rs c.py d.bak\nshopt -s extglob\necho !(*.bak)\nshopt -s nullglob\nempty=(*.nonexistent)\necho \"nullglob_count:${#empty[@]}\"\nshopt -u nullglob\nshopt -s failglob\n( echo *.nonexistent ) 2>/dev/null || echo \"failglob_caught\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a.ts b.rs c.py\nnullglob_count:0\nfailglob_caught");
    });
  });

  it("15 brace expansion sequences and combinations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("echo {a,b}{1..3}\necho {10..2..4}");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a1 a2 a3 b1 b2 b3\n10 6 2");
    });
  });

  it("16 arithmetic bitwise bases ternary and comma", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("x=5\nr=$(( (x += 3, x << 1) ^ 0x0f ))\nb=$(( 2#101101 + 010 + (r > 20 ? 100 : 200) ))\necho \"x=$x|r=$r|b=$b\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "x=8|r=31|b=153");
    });
  });

  it("17 conditional regex BASH_REMATCH and extglob", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("shopt -s extglob\ntag=\"release-2026\"\nif [[ $tag =~ ^([a-z]+)-([0-9]+)$ ]] && [[ \"main.rs\" == *.@(ts|rs) ]]; then\n  echo \"${BASH_REMATCH[0]}|${BASH_REMATCH[1]}|${BASH_REMATCH[2]}\"\nfi");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "release-2026|release|2026");
    });
  });

  it("18 process substitution with comm and paste", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("comm -12 <(printf 'c\\na\\nb\\n' | sort) <(printf 'b\\nd\\na\\n' | sort)\npaste -d ':' <(printf '1\\n2\\n') <(printf 'x\\ny\\n')");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a\nb\n1:x\n2:y");
    });
  });

  it("19 file descriptor swap 3>&1 1>/dev/null 2>&3", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("out=$( { echo \"to_stdout\"; echo \"to_stderr\" >&2; } 3>&1 1>/dev/null 2>&3 )\necho \"swapped:$out\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "swapped:to_stderr");
    });
  });

  it("20 recursive function FUNCNAME and BASH_SUBSHELL", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("fact() {\n  local n=$1\n  if (( n <= 1 )); then\n    echo \"stack:${FUNCNAME[*]}|sub:$BASH_SUBSHELL\" >&2\n    echo 1\n  else\n    local prev\n    prev=$(fact $((n - 1)))\n    echo $(( n * prev ))\n  fi\n}\nres=$(fact 4 2>stack.txt)\necho \"res=$res|$(cat stack.txt)\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "res=24|stack:fact fact fact fact|sub:4");
    });
  });

});
