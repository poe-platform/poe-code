import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure bash arithmetic, bitwise, base-N literals, arrays, printf, read, mapfile, getopts & builtins matrix", () => {
  it("1. base-N arithmetic literals (16#ff, 8#77, 2#1010, 36#z) and exponentiation (**)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        s=$(( 16#ff + 8#77 + 2#1010 + 36#z ))
        p=$(( 2 ** 10 + 3 ** 4 ))
        echo "$s:$p"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "363:1105");
    });
  });

  it("2. bitwise shifts, masks, XOR, complement (~), and logical short-circuit side effects", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        a=$(( (1 << 8) | (0x0f << 4) | (0xff & 0x0a) ))
        b=$(( a ^ 0x1aa ))
        c=$(( (~0) & 0xff ))
        x=3
        y=0
        d=$(( (x == 3) || (y = 99) ))
        e=$(( (x == 0) && (y = 88) ))
        echo "$a:$b:$c:$d:$e:$y"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "506:80:255:1:0:0");
    });
  });

  it("3. nested ternary (? :) and comma operator (,) sequence evaluation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        x=5
        y=$(( x += 3, x > 7 ? (x == 8 ? 100 : 200) : 300 ))
        echo "x=$x y=$y"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "x=8 y=100");
    });
  });

  it("4. pre/post increment/decrement and compound arithmetic assignments (+=, -=, *=, /=, %=)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        a=10
        b=$(( a++ * 2 ))
        c=$(( ++a * 2 ))
        (( a -= 4, a *= 3, a /= 2, a %= 7 ))
        echo "a=$a b=$b c=$c"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "a=5 b=20 c=24");
    });
  });

  it("5. let builtin with multiple expressions and zero/non-zero exit status", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        let "a = 5 + 3" "b = a * 2" "c = b - 16"
        rc1=$?
        let "d = a + b"
        rc2=$?
        echo "a=$a b=$b c=$c d=$d rc1=$rc1 rc2=$rc2"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "a=8 b=16 c=0 d=24 rc1=1 rc2=0");
    });
  });

  it("6. declare -i / local -i automatic arithmetic evaluation on assignment and +=", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        declare -i num=10
        num="num + 5 * 3"
        local_fn() {
          local -i k="2 + 3 * 4"
          k+="6"
          echo "k=$k"
        }
        echo "num=$num $(local_fn)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "num=25 k=20");
    });
  });

  it("7. declare -l and declare -u automatic case conversion on assignment and append", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        declare -l low="HeLLo_WoRLd"
        declare -u up="HeLLo_WoRLd"
        low+="_AGAIN"
        up+="_again"
        echo "$low|$up"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "hello_world_again|HELLO_WORLD_AGAIN");
    });
  });

  it("8. printf -v variable capture, dynamic width/precision (*), hex/octal, and character constants ('A)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf -v formatted "%-8s|%+06d|%.3f|%b" "item" 42 3.14159 "x\\x41y"
        printf -v extra "%*s|%.*f|%x|%X|%o|%d" 6 "hi" 2 3.14159 255 255 64 "'A"
        echo "[$formatted]"
        echo "[$extra]"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["[item    |+00042|3.142|xAy]", "[    hi|3.14|ff|FF|100|65]"].join("\n"),
      );
    });
  });

  it("9. printf format recycling across excess arguments", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "(%s:%02d)\\n" a 1 b 2 c 3
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["(a:01)", "(b:02)", "(c:03)"].join("\n"));
    });
  });

  it("10. read -d custom delimiter, read -n character count, and backslash line continuation vs -r", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        {
          read -r -d ":" first
          read -r -d ":" second
          read -r -n 4 third
        } <<< "alpha:beta:gamma_delta"
        read a b <<'EOF'
hello\\
world next\\titem
EOF
        read -r c d <<'EOF'
hello\\
world next
EOF
        echo "$first|$second|$third|$a|$b|$c"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "alpha|beta|gamm|helloworld|nexttitem|hello\\");
    });
  });

  it("11. mapfile / readarray with -t, -s skip, -n count, -O origin, and -d delimiter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        arr=("pre0" "pre1")
        mapfile -t -s 1 -n 3 -O 2 arr <<'EOF'
line0
line1
line2
line3
line4
EOF
        printf "%s," "\${arr[@]}"
        echo ""
        mapfile -d ";" -t items <<< "one;two;three;"
        echo "n=\${#items[@]}:\${items[0]}:\${items[1]}:\${items[2]}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["pre0,pre1,line1,line2,line3,", "n=4:one:two:three"].join("\n"),
      );
    });
  });

  it("12. getopts with leading colon silent mode, missing option arguments (:), and invalid options (?)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        parse_args() {
          local OPTIND=1 opt out=""
          while getopts ":a:bc:" opt "$@"; do
            case "$opt" in
              a) out+="A($OPTARG);" ;;
              b) out+="B;" ;;
              c) out+="C($OPTARG);" ;;
              :) out+="MISS($OPTARG);" ;;
              \\?) out+="BAD($OPTARG);" ;;
            esac
          done
          shift $((OPTIND - 1))
          out+="REST($*)"
          echo "$out"
        }
        parse_args -a foo -b -z -c -- pos1 pos2
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "A(foo);B;BAD(z);C(--);REST(pos1 pos2)");
    });
  });

  it("13. associative array key iteration, mutation, and single-key unset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        declare -A map=([red]="#ff0000" [green]="#00ff00" [blue]="#0000ff" [temp]="drop")
        unset 'map[temp]'
        map[green]="#00cc00"
        for k in $(printf "%s\\n" "\${!map[@]}" | sort); do
          echo "$k=\${map[$k]}"
        done
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["blue=#0000ff", "green=#00cc00", "red=#ff0000"].join("\n"),
      );
    });
  });

  it("14. sparse indexed array append, index discovery, slicing, and element pattern operations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        arr=()
        arr[2]="two_val"
        arr[5]="five_val"
        arr[9]="nine_val"
        arr+=("ten_val")
        stripped=("\${arr[@]%_val}")
        echo "len=\${#arr[@]} idx=\${!arr[*]} slice=\${arr[@]:1:2} stripped=\${stripped[*]}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        "len=4 idx=2 5 9 10 slice=two_val five_val stripped=two five nine ten",
      );
    });
  });

  it("15. parameter substring slicing with negative offsets/lengths and positional parameter slicing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        s="0123456789abcdef"
        set -- "one" "two" "three" "four" "five"
        echo "\${#s}:\${s:4:6}:\${s: -6:4}:\${s:2: -2}"
        echo "n=$# slice=\${*:2:3} neg=\${*: -2:2}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["16:456789:abcd:23456789abcd", "n=5 slice=two three four neg=four five"].join("\n"),
      );
    });
  });

  it("16. parameter default/assign/alternate operators (:-, -, :=, :+, +) across unset and empty vars", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        unset u
        e=""
        s="set"
        echo "\${u:-def1}|\${e:-def2}|\${e-def3}|\${s:+alt1}|\${e:+alt2}"
        : "\${u:=assigned}"
        echo "u=$u"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "def1|def2||alt1|\nu=assigned");
    });
  });

  it("17. shopt -s nocasematch with [[ =~ ]] regex capture groups in BASH_REMATCH", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        shopt -s nocasematch
        val="Release-v2.14.0-RC3"
        if [[ "$val" =~ ^release-v([0-9]+)\\.([0-9]+)\\.([0-9]+)-(rc[0-9]+)$ ]]; then
          echo "\${BASH_REMATCH[1]}|\${BASH_REMATCH[2]}|\${BASH_REMATCH[3]}|\${BASH_REMATCH[4]}"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "2|14|0|RC3");
    });
  });

  it("18. case fallthrough terminators (;& unconditional and ;;& re-testing)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        classify() {
          local out=""
          case "$1" in
            a*) out+="starts-a;" ;&
            *1) out+="step2;" ;;
          esac
          case "$1" in
            ab*) out+="ab;" ;;&
            *b*) out+="has-b;" ;;&
            *x*) out+="has-x;" ;;
          esac
          echo "$out"
        }
        echo "$(classify a9)|$(classify ab1)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "starts-a;step2;|starts-a;step2;ab;has-b;");
    });
  });

  it("19. eval dynamic function generation, builtin/command override bypass, and unset -f", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        for op in "add:+" "mul:*" "sub:-"; do
          name="\${op%%:*}"
          sym="\${op#*:}"
          eval "fn_\${name}() { echo \\\$(( \\\$1 \${sym} \\\$2 )); }"
        done
        echo "$(fn_add 6 7):$(fn_mul 6 7):$(fn_sub 20 8)"
        echo() { printf "custom:%s\\n" "$*"; }
        echo "hello"
        builtin echo "raw"
        command echo "via-command"
        unset -f echo
        echo "restored"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["13:42:12", "custom:hello", "raw", "via-command", "restored"].join("\n"),
      );
    });
  });

  it("20. readonly variable mutation protection and multi-stage PIPESTATUS array capture", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        readonly LOCKED="immutable"
        (LOCKED="changed") 2>/dev/null
        rc=$?
        sh -c "exit 3" | sh -c "exit 0" | sh -c "exit 7"
        ps="\${PIPESTATUS[0]}:\${PIPESTATUS[1]}:\${PIPESTATUS[2]}"
        echo "rc=$rc val=$LOCKED ps=$ps"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "rc=1 val=immutable ps=3:0:7");
    });
  });
});
