import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("obscure bc, expr, numfmt, factor, seq, envsubst, sponge, pathchk, cal, and system utilities matrix", () => {
  it("1. bc evaluates arbitrary-precision arithmetic, scale=, power (^), and modulo (%)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        bc <<'EOF'
scale=6
22 / 7
2 ^ 32
scale=0
(2 ^ 32) % 97
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "3.142857\n4294967296\n35\n");
    });
  });

  it("2. bc converts between radices using ibase and obase (hex, binary, decimal)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        bc <<'EOF'
obase=16
255
obase=2
ibase=16
FF
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "FF\n11111111\n");
    });
  });

  it("3. bc executes user-defined recursive and iterative functions with define, for, while, and if", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        bc <<'EOF'
define fact(n) {
  if (n <= 1) return (1);
  return (n * fact(n - 1));
}
define sumsq(k) {
  auto i, s;
  s = 0;
  for (i = 1; i <= k; i++) {
    s += i * i;
  }
  return (s);
}
fact(7)
sumsq(5)
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "5040\n55\n");
    });
  });

  it("4. bc -l evaluates math library functions sqrt(), length(), scale(), s(), c(), a(), l(), and e()", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        bc -l <<'EOF'
scale=4
sqrt(2)
length(123456)
scale(3.1415)
s(0)
c(0)
e(0)
l(1)
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1.4142\n6\n4\n0\n1.0000\n1.0000\n0\n");
    });
  });

  it("5. expr evaluates arithmetic, comparisons, boolean | and &, and exit statuses", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        expr 14 + 8 \* 3
        expr 100 / 7
        expr 100 % 7
        expr "" \| "fallback"
        expr "first" \& "second"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "38\n14\n2\nfallback\nfirst\n");
    });
  });

  it("6. expr evaluates string operations: regex : match length and capture group, substr, index, and length", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        expr "release-v2.14.9" : 'release-v\([0-9]*\.[0-9]*\)'
        expr "abcdef" : 'abc'
        expr substr "safe-bash-rust" 6 4
        expr index "hello_world" "w"
        expr length "WebAssembly"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "2.14\n3\nbash\n7\n11\n");
    });
  });

  it("7. numfmt converts numbers to and from SI, IEC, and IEC-i scales with --format and --suffix", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        numfmt --to=iec 1048576
        numfmt --to=iec-i --suffix=B 2097152
        numfmt --to=si 1500000
        numfmt --from=iec 4K
        numfmt --from=si 2M
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1.0M\n2.0MiB\n1.5M\n4096\n2000000\n");
    });
  });

  it("8. numfmt formats specific fields (--field) with custom delimiters (-d), headers (--header), and padding", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'service:bytes
api:1048576
worker:2048
' | numfmt -d ':' --header=1 --field=2 --to=iec
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "service:bytes\napi:1.0M\nworker:2.0K\n");
    });
  });

  it("9. factor computes prime factorizations from command-line arguments and standard input", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        factor 1 2 12 360 997
        printf '42
1024
' | factor
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "1:\n2: 2\n12: 2 2 3\n360: 2 2 2 3 3 5\n997: 997\n42: 2 3 7\n1024: 2 2 2 2 2 2 2 2 2 2\n"
      );
    });
  });

  it("10. seq generates sequences with custom separator (-s), equal-width zero padding (-w), and printf format (-f)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        seq -w 8 10
        seq -s ':' 10 -3 1
        seq -f 'node-%03g' 1 3
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "08\n09\n10\n10:7:4:1\nnode-001\nnode-002\nnode-003\n");
    });
  });

  it("11. seq handles fractional steps and decimal precision preservation", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        seq -s ',' 0.5 0.25 1.25
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "0.50,0.75,1.00,1.25\n");
    });
  });

  it("12. envsubst substitutes all exported variables or only a restricted SHELL-FORMAT whitelist", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec([
        "export APP_HOST=\"api.example.com\" APP_PORT=\"8443\" SECRET_TOKEN=\"keep_literal\"",
        "printf 'url=https://$APP_HOST:${APP_PORT}/v1 token=$SECRET_TOKEN\\n' | envsubst '$APP_HOST ${APP_PORT}'",
      ].join("\n"));
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "url=https://api.example.com:8443/v1 token=$SECRET_TOKEN\n");
    });
  });

  it("13. sponge soaks standard input before writing in-place and supports append mode (-a)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'gamma
alpha
beta
' > data.txt
        sort data.txt | sponge data.txt
        printf 'delta
' | sponge -a data.txt
        cat data.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "alpha\nbeta\ngamma\ndelta\n");
    });
  });

  it("14. pathchk validates POSIX portable paths (-p) and leading-dash / empty components (-P)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        pathchk -pP "valid_dir/file-01.txt" && echo "VALID_OK"
        if pathchk -P "dir/-bad_flag.txt" 2>/dev/null; then
          echo "DASH_MISSED"
        else
          echo "DASH_CAUGHT"
        fi
        if pathchk -p "dir/this_component_is_way_too_long_for_posix14" 2>/dev/null; then
          echo "LEN_MISSED"
        else
          echo "LEN_CAUGHT"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "VALID_OK\nDASH_CAUGHT\nLEN_CAUGHT\n");
    });
  });

  it("15. cal renders monthly calendars including leap-year February 2024", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cal 2 2024 | grep -E 'February 2024|29'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /February 2024/);
      assert.match(res.stdout, /29/);
    });
  });

  it("16. getconf and locale report POSIX system limits and locale environment settings", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        getconf PAGE_SIZE
        getconf NAME_MAX
        LC_ALL=en_US.UTF-8 locale charmap
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "4096\n255\nUTF-8\n");
    });
  });

  it("17. timeout runs commands within duration limits and propagates exit codes", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        timeout 5s printf 'completed_in_time
'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "completed_in_time\n");
    });
  });

  it("18. shuf -i range generation and -n sampling produces bounded unique integers", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        shuf -i 1-5 | sort -n | paste -sd ',' -
        shuf -i 10-20 -n 4 | wc -l | tr -d ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1,2,3,4,5\n4\n");
    });
  });

  it("19. xargs -n batching, -I replacement, and -0 NUL-delimited execution", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'a b c d e' | xargs -n 2 echo
        printf 'x\0y\0z\0' | xargs -0 -I {} printf '[%s]' {}
        printf '\n'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "a b\nc d\ne\n[x][y][z]\n");
    });
  });

  it("20. end-to-end math & formatting pipeline: seq -> bc -> numfmt -> sponge", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        seq 1 4 | while read n; do
          val=$(echo "$n * 1048576" | bc)
          echo "chunk_$n:$val"
        done > sizes.txt
        numfmt -d ':' --field=2 --to=iec < sizes.txt | sponge sizes.txt
        cat sizes.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "chunk_1:1.0M\nchunk_2:2.0M\nchunk_3:3.0M\nchunk_4:4.0M\n");
    });
  });
});
