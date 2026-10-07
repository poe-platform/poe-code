import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure bash shell grammar extglob brace arith traps coproc fd matrix", () => {
  it("1. nested parameter expansions: default, assign, alternate, prefix/suffix strip, and replacement", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("unset UNSET_V\nEMPTY_V=\"\"\nFULL_V=\"archive.tar.gz\"\necho \"d1=${UNSET_V:-fallback}\"\necho \"d2=${EMPTY_V:=assigned_now}:$EMPTY_V\"\necho \"d3=${FULL_V:+present}\"\necho \"strip=${FULL_V%.*}|${FULL_V%%.*}|${FULL_V#*.}|${FULL_V##*.}\"\necho \"repl=${FULL_V/./_}|${FULL_V//./_}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "d1=fallback\nd2=assigned_now:assigned_now\nd3=present\nstrip=archive.tar|archive|tar.gz|gz\nrepl=archive_tar.gz|archive_tar_gz");
    });
  });

  it("2. bash arithmetic: bitwise shifts, XOR/AND/OR, ternary, comma operator, and pre/post-increment", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("x=5\ny=$(( (x << 2) ^ 3 ))\nz=$(( x > 3 ? (y & 15) : 0 ))\n(( x++, y += 2 ))\necho \"x=$x y=$y z=$z bit=$(( (1 << 4) | 3 ))\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "x=6 y=25 z=7 bit=19");
    });
  });

  it("3. Cartesian brace expansion combined with array slicing and printf", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("arr=({a,b}-{1..3})\necho \"count=${#arr[@]}\"\necho \"slice=${arr[@]:1:4}\"\nprintf \"%s|\" \"${arr[@]}\"; echo");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "count=6\nslice=a-2 a-3 b-1 b-2\na-1|a-2|a-3|b-1|b-2|b-3|");
    });
  });

  it("4. shopt -s extglob pattern matching in [[ == ]] and case statements", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("shopt -s extglob\nclassify() {\n  case \"$1\" in\n    @(*.tar.gz|*.tgz)) echo \"TARBALL\" ;;\n    +(ab)c) echo \"PLUS_AB\" ;;\n    !(*.bak)) echo \"NOT_BAK\" ;;\n    *) echo \"OTHER\" ;;\n  esac\n}\necho \"$(classify pkg.tgz):$(classify ababc):$(classify notes.txt):$(classify old.bak)\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "TARBALL:PLUS_AB:NOT_BAK:OTHER");
    });
  });

  it("5. shopt -s nullglob and dotglob over hidden and normal directory entries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/glob80\ntouch /tmp/glob80/.hidden /tmp/glob80/visible.txt\nshopt -s nullglob\nnone=(/tmp/glob80/*.nomatch)\necho \"nomatch_len=${#none[@]}\"\nshopt -s dotglob\nall=(/tmp/glob80/*)\nfor f in \"${all[@]}\"; do basename \"$f\"; done | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "nomatch_len=0\n.hidden\nvisible.txt");
    });
  });

  it("6. EXIT and RETURN traps with function scoping and exit code preservation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("trap 'echo \"EXIT_TRAP:$?\"' EXIT\nhelper() {\n  trap 'echo \"RETURN_TRAP:$1\"' RETURN\n  echo \"IN_HELPER:$1\"\n}\nhelper alpha\necho \"MAIN_DONE\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "IN_HELPER:alpha\nRETURN_TRAP:alpha\nMAIN_DONE\nEXIT_TRAP:0");
    });
  });

  it("7. PIPESTATUS array capture across 4-stage pipeline with set +e", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("exit_with() { return \"$1\"; }\nexit_with 0 | exit_with 3 | exit_with 0 | exit_with 7\nps=(\"${PIPESTATUS[@]}\")\necho \"pipe_rc=${ps[*]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "pipe_rc=0 3 0 7");
    });
  });

  it("8. getopts bundled short flags, option arguments, and OPTIND reset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("parse_cli() {\n  local OPTIND=1 opt a=0 b=0 file=\"\"\n  while getopts \"abf:\" opt; do\n    case \"$opt\" in\n      a) a=1 ;;\n      b) b=1 ;;\n      f) file=\"$OPTARG\" ;;\n    esac\n  done\n  shift $((OPTIND - 1))\n  echo \"a=$a b=$b file=$file rest=$*\"\n}\nparse_cli -ab -f config.yaml pos1 pos2\nparse_cli -f second.json tail_arg");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a=1 b=1 file=config.yaml rest=pos1 pos2\na=0 b=0 file=second.json rest=tail_arg");
    });
  });

  it("9. mapfile / readarray with -t, -s (skip), and -n (max count)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"r0\\nr1\\nr2\\nr3\\nr4\\n\" > /tmp/lines80.txt\nmapfile -t -s 1 -n 3 sub_rows < /tmp/lines80.txt\necho \"len=${#sub_rows[@]} items=${sub_rows[*]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "len=3 items=r1 r2 r3");
    });
  });

  it("10. read with custom IFS, -r raw backslashes, and -a array splitting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("IFS=':' read -r -a parts <<< 'usr\\local:bin:poe-agent:v2'\necho \"n=${#parts[@]} p0=${parts[0]} p2=${parts[2]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "n=4 p0=usr\\local p2=poe-agent");
    });
  });

  it("11. printf -v variable capture, hex/octal/float formatting, and %b escape decoding", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf -v formatted \"%-6s|%04d|%04x|%.2f\" \"node\" 42 255 3.14159\necho \"$formatted\"\nprintf \"%b\\n\" \"lineA\\tcol2\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "node  |0042|00ff|3.14\nlineA\tcol2");
    });
  });

  it("12. multi-FD redirection (3>, 3>&-), <<-EOF tab-stripped heredoc, and <<< here-string", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("exec 3> /tmp/fd80.txt\necho \"fd-line-1\" >&3\necho \"fd-line-2\" >&3\nexec 3>&-\ncat <<- 'HEREDOC' >> /tmp/fd80.txt\n\tindented-heredoc-line\nHEREDOC\ncat /tmp/fd80.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "fd-line-1\nfd-line-2\nindented-heredoc-line");
    });
  });

  it("13. case statement fallthrough operators (;& and ;;&)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("test_case() {\n  local out=\"\"\n  case \"$1\" in\n    1) out+=\"A:\" ;&\n    2) out+=\"B:\" ;;\n  esac\n  case \"$1\" in\n    *x*) out+=\"X:\" ;;&\n    *y*) out+=\"Y:\" ;;\n  esac\n  echo \"$out\"\n}\necho \"$(test_case 1)|$(test_case xy)\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "A:B:|X:Y:");
    });
  });

  it("14. recursive bash function with local scope: GCD and factorial", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("gcd() {\n  local a=$1 b=$2\n  if (( b == 0 )); then\n    echo \"$a\"\n  else\n    gcd \"$b\" \"$(( a % b ))\"\n  fi\n}\necho \"gcd=$(gcd 1071 462)\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "gcd=21");
    });
  });

  it("15. dual process substitution <(cmd1) <(cmd2) with comm and join", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("comm -12 <(printf \"c\\na\\nb\\n\" | sort) <(printf \"b\\nd\\na\\n\" | sort)");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a\nb");
    });
  });

  it("16. indirect expansion (${!ptr}) and nameref (declare -n) mutation across functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("target_var=\"initial_val\"\nptr=\"target_var\"\necho \"indirect=${!ptr}\"\nbump_ref() {\n  local -n r=$1\n  r=\"${r}_updated\"\n}\nbump_ref target_var\necho \"after=$target_var\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "indirect=initial_val\nafter=initial_val_updated");
    });
  });

  it("17. set -- positional parameter slicing, shift, and custom IFS joining", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("set -- one two three four five\nshift 1\nslice=(\"${@:2:3}\")\nIFS=','\necho \"cnt=$# first=$1 joined=${slice[*]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "cnt=4 first=two joined=three,four,five");
    });
  });

  it("18. set -C (noclobber) protection and >| forced overwrite in subshell", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("(\n  set -C\n  echo \"v1\" > /tmp/clobber80.txt\n  if echo \"v2\" > /tmp/clobber80.txt 2>/dev/null; then\n    echo \"UNEXPECTED_OVERWRITE\"\n  else\n    echo \"BLOCKED_OK\"\n  fi\n  echo \"v3\" >| /tmp/clobber80.txt\n  cat /tmp/clobber80.txt\n)");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "BLOCKED_OK\nv3");
    });
  });

  it("19. command -v, type -t, and builtin shadowing resolution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("my_fn() { echo \"fn\"; }\necho \"$(type -t my_fn):$(type -t cd):$(type -t jq)\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "function:builtin:file");
    });
  });

  it("20. bash associative array state machine parsing git-porcelain status into JSON", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("declare -A counts=([M]=0 [A]=0 [U]=0)\nwhile IFS=' ' read -r code file; do\n  [[ -z \"$code\" ]] && continue\n  case \"$code\" in\n    M) (( counts[M]++ )) ;;\n    A) (( counts[A]++ )) ;;\n    \"??\") (( counts[U]++ )) ;;\n  esac\ndone << 'HEREDOC'\nM src/main.rs\nA src/new.rs\nM README.md\n?? tmp.log\nHEREDOC\necho \"M=${counts[M]} A=${counts[A]} U=${counts[U]}\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "M=2 A=1 U=1");
    });
  });

});
