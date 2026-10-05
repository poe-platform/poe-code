import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("safe-bash e2e: bc, expr, numfmt, factor, seq, and shuf math pipeline matrix", () => {
  it("01. bc arbitrary-precision integer arithmetic (2^128 and 30! factorial)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "bc <<'EOF'",
        "2 ^ 128",
        "define fact(n) {",
        "  auto r, i;",
        "  r = 1;",
        "  for (i = 2; i <= n; i++) r *= i;",
        "  return r;",
        "}",
        "fact(30)",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "340282366920938463463374607431768211456",
        "265252859812191058636308480000000",
        "",
      ].join("\n"),
    );
  });

  it("02. bc fixed-point scale arithmetic, sqrt(), length(), and scale() builtins", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "bc <<'EOF'",
        "scale = 10",
        "1 / 7",
        "sqrt(2)",
        "x = 12345.67890",
        "length(x)",
        "scale(x)",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        ".1428571428",
        "1.4142135623",
        "10",
        "5",
        "",
      ].join("\n"),
    );
  });

  it("03. bc base conversion across hexadecimal (ibase=16), binary (obase=2), and octal (obase=8)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "bc <<'EOF'",
        "obase = 16",
        "255",
        "4096 + 255",
        "obase = 2",
        "42",
        "obase = 10",
        "ibase = 16",
        "FF",
        "DEAD",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "FF",
        "10FF",
        "101010",
        "255",
        "57005",
        "",
      ].join("\n"),
    );
  });

  it("04. bc -l math library transcendental functions: s(x), c(x), a(x), l(x), e(x), and j(n,x)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "bc -l <<'EOF'",
        "scale = 6",
        "pi = 4 * a(1)",
        "pi / 1",
        "s(0)",
        "c(0)",
        "l(e(1)) / 1",
        "j(0, 0)",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    const lines = res.stdout.trim().split("\n");
    assert.equal(lines.length, 5);
    assert.match(lines[0]!, /^3\.14159/);
    assert.equal(Number(lines[1]!), 0);
    assert.equal(Number(lines[2]!), 1);
    assert.ok(Math.abs(Number(lines[3]!) - 1) < 1e-5);
    assert.equal(Number(lines[4]!), 1);
  });

  it("05. bc recursive functions with auto locals, arrays, while/for loops, break/continue, and print statements", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "bc <<'EOF'",
        "define fib(n) {",
        "  auto a, b;",
        "  if (n <= 1) return n;",
        "  a = fib(n - 1);",
        "  b = fib(n - 2);",
        "  return a + b;",
        "}",
        "for (i = 0; i <= 8; i++) {",
        "  arr[i] = fib(i);",
        "}",
        "sum = 0;",
        "for (i = 0; i <= 8; i++) {",
        "  if (i == 2) continue;",
        "  if (i == 8) break;",
        "  sum += arr[i];",
        "}",
        "print \"fib8=\", arr[8], \" sum=\", sum, \"\\n\"",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "fib8=21 sum=32\n");
  });

  it("06. bc -e inline expressions and multi-file script execution", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/lib.bc": "define sq(x) { return x * x; }\n",
        "/work/main.bc": "sq(12) + sq(5)\n",
      },
    });
    const res = await h.exec(
      [
        "bc -e 'scale=2; 22/7' -e '100 * 3'",
        "bc /work/lib.bc /work/main.bc",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "3.14\n300\n169\n");
  });

  it("07. expr integer arithmetic, precedence, and relational comparisons with exit codes", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "expr 14 + 6 \\* 3 - 8 / 2",
        "expr 29 % 6",
        "expr 10 '<=' 10",
        "expr 10 '>' 20 || echo \"cmp_exit=$?\"",
        "expr '' '|' 'fallback_val'",
        "expr 'primary_val' '&' 'secondary_val'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "28",
        "5",
        "1",
        "0",
        "cmp_exit=1",
        "fallback_val",
        "primary_val",
        "",
      ].join("\n"),
    );
  });

  it("08. expr BRE regex matching (: and match), substr, index, and length operations", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "expr 'release-v2.14.8-rc1' : 'release-v\\([0-9]*\\.[0-9]*\\.[0-9]*\\)'",
        "expr match 'abcdef12345' '[a-z]*'",
        "expr substr 'safe-bash-rust' 6 4",
        "expr index 'hello_world' 'wo'",
        "expr length 'zero-dependency'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "2.14.8",
        "6",
        "bash",
        "5",
        "15",
        "",
      ].join("\n"),
    );
  });

  it("09. numfmt --to=iec, --to=iec-i, --to=si, and --from=iec / --from=si roundtrips", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "numfmt --to=iec 1024 1048576 5368709120",
        "echo '---'",
        "numfmt --to=iec-i 2048 1048576",
        "echo '---'",
        "numfmt --to=si 1000 2500000",
        "echo '---'",
        "numfmt --from=iec 4K 2M 1G",
        "echo '---'",
        "numfmt --from=si 5K 3M",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "1.0K",
        "1.0M",
        "5.0G",
        "---",
        "2.0Ki",
        "1.0Mi",
        "---",
        "1.0k",
        "2.5M",
        "---",
        "4096",
        "2097152",
        "1073741824",
        "---",
        "5000",
        "3000000",
        "",
      ].join("\n"),
    );
  });

  it("10. numfmt table formatting with --header, --field, --delimiter, --padding, --round, and --suffix", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/disks.csv": [
          "mount,bytes,inodes",
          "/,10737418240,50000",
          "/var,2621440,12000",
          "/tmp,524288,1000",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      "numfmt --delimiter=, --header=1 --field=2 --to=iec --suffix=B < /work/disks.csv",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "mount,bytes,inodes",
        "/,10GB,50000",
        "/var,2.5MB,12000",
        "/tmp,512KB,1000",
        "",
      ].join("\n"),
    );
  });

  it("11. factor prime factorization on CLI arguments and stdin streams including large semiprimes", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "factor 1 2 12 360 9973",
        "printf '1024\\n2310\\n999983\\n' | factor",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "1:",
        "2: 2",
        "12: 2 2 3",
        "360: 2 2 2 3 3 5",
        "9973: 9973",
        "1024: 2 2 2 2 2 2 2 2 2 2",
        "2310: 2 3 5 7 11",
        "999983: 999983",
        "",
      ].join("\n"),
    );
  });

  it("12. seq integer, negative step, -w equal-width zero padding, -s custom separator, and -f printf format", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "seq -w 8 12",
        "echo '---'",
        "seq -s ':' 10 -3 1",
        "echo '---'",
        "seq -f 'item_%03g' 1 3",
        "echo '---'",
        "seq 0.5 0.25 1.25",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "08",
        "09",
        "10",
        "11",
        "12",
        "---",
        "10:7:4:1",
        "---",
        "item_001",
        "item_002",
        "item_003",
        "---",
        "0.50",
        "0.75",
        "1.00",
        "1.25",
        "",
      ].join("\n"),
    );
  });

  it("13. shuf permutation invariants (-i range, -e args, -n head count, --random-source determinism)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/seed.bin": new Uint8Array(64).fill(0x5a),
      },
    });
    const res = await h.exec(
      [
        "shuf -i 1-10 | sort -n | paste -sd, -",
        "shuf -e alpha beta gamma delta | sort | paste -sd: -",
        "shuf --random-source=/work/seed.bin -i 1-8 -n 5 | paste -sd, - > /work/run1.txt",
        "shuf --random-source=/work/seed.bin -i 1-8 -n 5 | paste -sd, - > /work/run2.txt",
        "cmp -s /work/run1.txt /work/run2.txt && echo 'DETERMINISTIC_OK'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "1,2,3,4,5,6,7,8,9,10",
        "alpha:beta:delta:gamma",
        "DETERMINISTIC_OK",
        "",
      ].join("\n"),
    );
  });

  it("14. shuf -r replacement sampling and -z NUL-terminated records piped to xargs -0", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "shuf -r -n 6 -e 'only_item' | uniq -c | awk '{ print $1, $2 }'",
        "shuf -z -e 'one item' 'two item' | tr '\\0' '\\n' | sort",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "6 only_item",
        "one item",
        "two item",
        "",
      ].join("\n"),
    );
  });

  it("15. seq -> factor -> awk pipeline classifying prime vs composite numbers and counting prime factors", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "seq 2 30 | factor | awk '{",
        "  n = $1; sub(/:/, \"\", n);",
        "  nf = NF - 1;",
        "  if (nf == 1) primes++; else composites++;",
        "  total_factors += nf;",
        "} END {",
        "  printf \"primes=%d composites=%d total_factors=%d\\n\", primes, composites, total_factors",
        "}'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "primes=10 composites=19 total_factors=59\n");
  });

  it("16. seq -> bc -> numfmt pipeline computing powers of 2 and formatting as IEC human-readable capacities", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "for exp in $(seq 10 10 40); do",
        "  echo \"2 ^ $exp\" | bc",
        "done | numfmt --to=iec-i --suffix=B",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "1.0KiB",
        "1.0MiB",
        "1.0GiB",
        "1.0TiB",
        "",
      ].join("\n"),
    );
  });

  it("17. awk -> bc -> jq pipeline computing high-precision financial compound interest schedules", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/accounts.csv": [
          "acct,principal,rate_pct,years",
          "A100,10000,5,3",
          "A200,25000,4,5",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "awk -F, 'NR > 1 { printf \"scale=10; %s * ((1 + %s / 100) ^ %s)\\n\", $2, $3, $4 }' /work/accounts.csv",
        "| bc",
        "| jq -R -s 'split(\"\\n\") | map(select(length > 0) | tonumber)'",
      ].join(" "),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), [11576.25, 30416.32256]);
  });

  it("18. expr + seq loop validating Collatz stopping times and verifying with bc", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "bc <<'EOF'",
        "define collatz(n) {",
        "  auto steps;",
        "  steps = 0;",
        "  while (n > 1) {",
        "    if (n % 2 == 0) n = n / 2 else n = 3 * n + 1;",
        "    steps += 1;",
        "  }",
        "  return steps;",
        "}",
        "collatz(6)",
        "collatz(19)",
        "collatz(27)",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "8\n20\n111\n");
  });

  it("19. numfmt --round modes (up, down, from-zero, towards-zero, nearest) and --format padding", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "numfmt --to=si --round=up 1001",
        "numfmt --to=si --round=down 1999",
        "numfmt --to=si --round=nearest 1499",
        "numfmt --to=si --round=nearest 1501",
        "numfmt --format='%08.1f' --to=si 2500",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "1.1k",
        "1.9k",
        "1.5k",
        "1.5k",
        "000002.5k",
        "",
      ].join("\n"),
    );
  });

  it("20. factor + bc Euler totient phi(n) verification pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "for n in 12 36 100 210; do",
        "  expr_bc=$(factor $n | awk '{",
        "    num = $1; sub(/:/, \"\", num);",
        "    delete seen;",
        "    out = num;",
        "    for (i = 2; i <= NF; i++) {",
        "      p = $i;",
        "      if (!(p in seen)) {",
        "        seen[p] = 1;",
        "        out = out \" * (\" p \" - 1) / \" p;",
        "      }",
        "    }",
        "    print out",
        "  }')",
        "  phi=$(echo \"$expr_bc\" | bc)",
        "  echo \"phi($n)=$phi\"",
        "done",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "phi(12)=4",
        "phi(36)=12",
        "phi(100)=40",
        "phi(210)=48",
        "",
      ].join("\n"),
    );
  });
});
