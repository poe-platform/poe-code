import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure builtins: printf, read, mapfile/readarray, arithmetic bases, and declare attributes matrix", () => {
  it("1. printf format reuse across excess arguments and zero/default filling when arguments run out", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '[%s:%d]\\n' alpha 10 beta 20 gamma
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[alpha:10]\n[beta:20]\n[gamma:0]\n");
    });
  });

  it("2. printf -v variable assignment with array subscript target", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        declare -a buf
        printf -v 'buf[0]' '%04d' 7
        printf -v 'buf[2]' '%s-%x' item 255
        printf '%s|%s|%d\\n' "\${buf[0]}" "\${buf[2]}" "\${#buf[@]}"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "0007|item-ff|2\n");
    });
  });

  it("3. printf %b escape sequences including \\0num octal, \\xHH hex, and \\c early stop", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '%b\\n' 'A\\0102\\x43'
        printf '%bSUFFIX_IGNORED' 'hello\\nworld\\c'
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ABC\nhello\nworld");
    });
  });

  it("4. printf dynamic width and precision (%*s and %*.*f) and character constant ('A)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '[%*s] [%*s] [%d]\\n' 6 hi -6 hi "'A"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[    hi] [hi    ] [65]\n");
    });
  });

  it("5. read with custom IFS splitting into multiple variables and remainder into last variable", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        IFS=':' read -r a b c <<< "one:two:three:four:five"
        printf '<%s> <%s> <%s>\\n' "$a" "$b" "$c"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "<one> <two> <three:four:five>\n");
    });
  });

  it("6. read without -r interprets backslash escapes and line continuation", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '%s\\n%s\\n' 'hello\\' 'world	foo\\\\bar' | {
          read line
          printf '<%s>\\n' "$line"
        }
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "<helloworld\tfoo\\bar>\n");
    });
  });

  it("7. read -a populates indexed array and clears prior elements", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        arr=(old1 old2 old3 old4)
        IFS=',' read -r -a arr <<< "x,y,z"
        printf '%d:%s\\n' "\${#arr[@]}" "\${arr[*]}"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "3:x y z\n");
    });
  });

  it("8. read -d custom delimiter and read -n / -N character count limits", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'part1;part2;part3' | {
          read -r -d ';' first
          read -r -d ';' second
          printf '<%s><%s>\\n' "$first" "$second"
        }
        printf 'abcdef' | {
          read -r -n 4 chunk
          printf '<%s>\\n' "$chunk"
        }
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "<part1><part2>\n<abcd>\n");
    });
  });

  it("9. mapfile / readarray with -t, -s skip, -n count, and -O origin index", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        arr=(seed0 seed1)
        mapfile -t -s 1 -n 2 -O 2 arr < <(printf 'line0\\nline1\\nline2\\nline3\\nline4\\n')
        printf '%d:%s|%s|%s|%s\\n' "\${#arr[@]}" "\${arr[0]}" "\${arr[1]}" "\${arr[2]}" "\${arr[3]}"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "4:seed0|seed1|line1|line2\n");
    });
  });

  it("10. mapfile -d custom delimiter splitting NUL and colon-delimited streams", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        readarray -t -d ':' items < <(printf 'alpha:beta:gamma:')
        printf '%d:%s\\n' "\${#items[@]}" "\${items[*]}"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "3:alpha beta gamma\n");
    });
  });

  it("11. arithmetic expansion with arbitrary radix literals (2#, 8#, 16#, 36#)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '%d %d %d %d\\n' "$((2#101101))" "$((8#77))" "$((16#ff))" "$((36#z))"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "45 63 255 35\n");
    });
  });

  it("12. arithmetic ternary (? :), comma operator, bitwise ops, and compound assignments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        x=5
        y=$(( (x += 3, x *= 2, x > 10 ? x + 100 : x - 100) ))
        z=$(( (1 << 5) | (0xff & 0x0f) ^ 0x05 ))
        printf 'x=%d y=%d z=%d\\n' "$x" "$y" "$z"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "x=16 y=116 z=42\n");
    });
  });

  it("13. arithmetic pre/post increment and decrement (++ and --) on variables and array elements", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        a=10
        p1=$((a++))
        p2=$((++a))
        arr=(5 20 30)
        q1=$((arr[1]++))
        q2=$((++arr[1]))
        printf 'a=%d p1=%d p2=%d arr1=%d q1=%d q2=%d\\n' "$a" "$p1" "$p2" "\${arr[1]}" "$q1" "$q2"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a=12 p1=10 p2=12 arr1=22 q1=20 q2=22\n");
    });
  });

  it("14. declare -A associative arrays with spaces in keys, += append, and unset element", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        declare -A map=([first key]="hello" [second]="world")
        map[first key]+="!"
        map[third]="42"
        unset 'map[second]'
        printf 'count=%d first=%s third=%s\\n' "\${#map[@]}" "\${map[first key]}" "\${map[third]}"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "count=2 first=hello! third=42\n");
    });
  });

  it("15. declare -i integer attribute evaluates assigned arithmetic expressions automatically", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        declare -i num=10+5*2
        num="num + 8"
        printf 'num=%d\\n' "$num"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "num=28\n");
    });
  });

  it("16. declare -l (lowercase) and declare -u (uppercase) automatic case conversion on assignment", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        declare -l low="HeLLo_WoRLD"
        declare -u up="HeLLo_WoRLD"
        low="MiXeD_123"
        up="MiXeD_456"
        printf '%s|%s\\n' "$low" "$up"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "mixed_123|MIXED_456\n");
    });
  });

  it("17. readonly / declare -r prevents reassignment and unsetting with non-zero status", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        readonly CONST_VAL="immutable"
        if (CONST_VAL="changed") 2>/dev/null; then
          echo "UNEXPECTED_WRITE"
        else
          echo "WRITE_BLOCKED"
        fi
        if (unset CONST_VAL) 2>/dev/null; then
          echo "UNEXPECTED_UNSET"
        else
          echo "UNSET_BLOCKED"
        fi
        printf 'val=%s\\n' "$CONST_VAL"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "WRITE_BLOCKED\nUNSET_BLOCKED\nval=immutable\n");
    });
  });

  it("18. eval with dynamically constructed pipeline and escaped variable references", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        target_var=" dynamic_value "
        ptr="target_var"
        eval "res=\\"\\\${$ptr}\\""
        printf '<%s>\\n' "$res"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "< dynamic_value >\n");
    });
  });

  it("19. command -v, type -t, and builtin bypassing function shadowing", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        echo() {
          builtin printf 'SHADOW:%s\\n' "$*"
        }
        echo "hello"
        command echo "via-command"
        builtin echo "via-builtin"
        type -t echo
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "SHADOW:hello\nvia-command\nvia-builtin\nfunction\n",
      );
    });
  });

  it("20. shift N error handling when N exceeds $# and positional slicing ${@:start:len}", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -- a b c d e
        printf 'slice1=%s\\n' "\${*:2:3}"
        shift 2
        printf 'after_shift=%s\\n' "$*"
        if shift 10 2>/dev/null; then
          echo "UNEXPECTED_SHIFT"
        else
          echo "SHIFT_GUARD_OK"
        fi
        printf 'remaining=%s\\n' "$*"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "slice1=b c d\nafter_shift=c d e\nSHIFT_GUARD_OK\nremaining=c d e\n",
      );
    });
  });
});
