import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure coreutils, bc/expr/numfmt math, crypto/hex encoding & tabular text formatting matrix", () => {
  it("01: evaluates recursive functions and fixed-scale floating division in bc -l", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'BC' | bc -l",
          "define fact(n) {",
          "  if (n <= 1) return 1;",
          "  return n * fact(n - 1);",
          "}",
          "scale = 4",
          "fact(6)",
          "22 / 7",
          "BC",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "720\n3.1428\n");
    });
  });

  it("02: evaluates hexadecimal input base (ibase=16) and sqrt() under hex radix in bc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec('echo "ibase=16; FF; sqrt(144)" | bc');
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "255\n18\n");
    });
  });

  it("03: converts byte counts to and from IEC human-readable units via numfmt", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        ["numfmt --to=iec 1048576", "numfmt --from=iec 2M"].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1.0M\n2097152\n");
    });
  });

  it("04: formats stepped sequences with seq -f and tallies sorted occurrences with uniq -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'seq -f "%04g" 5 5 20',
          'printf "b\\na\\nb\\nc\\nb\\na\\n" | sort | uniq -c | awk \'{print $1 ":" $2}\'',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0005\n0010\n0015\n0020\n2:a\n3:b\n1:c\n");
    });
  });

  it("05: round-trips payloads through nested base64 + base32 and verifies sha256sum, sha1sum, and md5sum digest lengths", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'raw="safe-bash-crypto-48"',
          'rt=$(printf "%s" "$raw" | base64 | base32 | base32 -d | base64 -d)',
          'h256=$(printf "%s" "$rt" | sha256sum | awk \'{print $1}\')',
          'h1=$(printf "%s" "$rt" | sha1sum | awk \'{print $1}\')',
          'md5=$(printf "%s" "$rt" | md5sum | awk \'{print $1}\')',
          'echo "$rt|${#h256}|${#h1}|${#md5}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "safe-bash-crypto-48|64|40|32\n");
    });
  });

  it("06: encodes and decodes raw hex dumps via xxd -p and xxd -r -p", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "Rust+TS=48" | xxd -p > hex.txt',
          "cat hex.txt",
          "xxd -r -p hex.txt",
          'echo ""',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "527573742b54533d3438\nRust+TS=48\n");
    });
  });

  it("07: formats raw byte streams as hexadecimal octets via od -An -tx1", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'printf "ABCD" | od -An -tx1 | tr -s " " | sed "s/^ //; s/ $//"',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "41 42 43 44\n");
    });
  });

  it("08: chains tr character classes ([:digit:], [:lower:], [:upper:]) with -d and -s", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'printf "  hello   123   world  456 \\n" | tr -d "[:digit:]" | tr "[:lower:]" "[:upper:]" | tr -s " "',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, " HELLO WORLD \n");
    });
  });

  it("09: transforms delimited records through cut --output-delimiter, tac, rev, and paste -s", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'printf "u1:x:100\\nu2:x:200\\nu3:x:300\\n" | cut -d: -f1,3 --output-delimiter="=" | tac | rev | paste -s -d"," -',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "003=3u,002=2u,001=1u\n");
    });
  });

  it("10: performs a left outer join on CSV files with missing-field substitution via join -a 1 -e NONE -o", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "1,Ada\\n2,Bob\\n3,Cyd\\n" > users.txt',
          'printf "1,admin\\n3,ops\\n" > roles.txt',
          "join -t, -1 1 -2 1 -a 1 -e NONE -o 1.1,1.2,2.2 users.txt roles.txt",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1,Ada,admin\n2,Bob,NONE\n3,Cyd,ops\n");
    });
  });

  it("11: computes set intersection and symmetric differences across sorted lists via comm -12, -23, and -13", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "alpha\\nbeta\\ngamma\\n" > a.txt',
          'printf "beta\\ndelta\\ngamma\\n" > b.txt',
          'echo "inter:$(comm -12 a.txt b.txt | paste -s -d, -)"',
          'echo "only_a:$(comm -23 a.txt b.txt | paste -s -d, -)"',
          'echo "only_b:$(comm -13 a.txt b.txt | paste -s -d, -)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "inter:beta,gamma\nonly_a:alpha\nonly_b:delta\n",
      );
    });
  });

  it("12: numbers all lines including blank lines using zero-padded right-aligned format via nl -ba -nrz -w4", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'printf "first\\n\\nthird\\n" | nl -ba -nrz -w4 -s": "',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0001: first\n0002: \n0003: third\n");
    });
  });

  it("13: word-wraps text lines at spaces within a fixed width via fold -w 12 -s", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'printf "alpha beta gamma delta epsilon\\n" | fold -w 12 -s',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alpha beta \ngamma delta \nepsilon\n");
    });
  });

  it("14: aligns delimited input into a formatted table via column -t -s", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'printf "svc,port,state\\napi,80,up\\nworker,8080,ready\\n" | column -t -s"," | awk \'{print $1 "|" $2 "|" $3}\'',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "svc|port|state\napi|80|up\nworker|8080|ready\n");
    });
  });

  it("15: converts tabs to spaces with expand -t 4 and spaces back to tabs with unexpand -t 4", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "a\\tb\\n" | expand -t 4 | wc -c | tr -d " "',
          'printf "    indented\\n" | unexpand -t 4 | od -An -tx1 | tr -s " " | sed "s/^ //; s/ $//"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "6\n09 69 6e 64 65 6e 74 65 64 0a\n");
    });
  });

  it("16: splits a file into fixed-line numeric-suffixed chunks via split -l 2 -d -a 2 and reassembles with cat", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "l1\\nl2\\nl3\\nl4\\nl5\\n" > lines.txt',
          "split -l 2 -d -a 2 lines.txt chunk_",
          'ls chunk_* | sort | tr "\\n" " "',
          'echo ""',
          "cat chunk_*",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "chunk_00 chunk_01 chunk_02 \nl1\nl2\nl3\nl4\nl5\n");
    });
  });

  it("17: formats UTC epoch timestamps into ISO-8601 strings via date -u -d @epoch", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'date -u -d "@1700000000" "+%Y-%m-%dT%H:%M:%SZ"',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "2023-11-14T22:13:20Z\n");
    });
  });

  it("18: evaluates integer arithmetic, string length, and substring extraction via expr", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "expr 14 \\* 3 + 6",
          'expr length "safe-bash"',
          'expr substr "safe-bash" 6 4',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "48\n9\nbash\n");
    });
  });

  it("19: safely overwrites an input file from a pipeline in-place using sponge", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "zeta\\nalpha\\nbeta\\nalpha\\n" > data.txt',
          "sort data.txt | uniq | sponge data.txt",
          "cat data.txt",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alpha\nbeta\nzeta\n");
    });
  });

  it("20: runs commands in an isolated environment via env -i and substitutes placeholders via xargs -I {}", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'env -i CUSTOM_VAR=isolated sh -c \'echo "var=$CUSTOM_VAR:home=${HOME:-unset}"\'',
          'printf "svc-a\\nsvc-b\\n" | xargs -I {} echo "deploy:{}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "var=isolated:home=unset\ndeploy:svc-a\ndeploy:svc-b\n",
      );
    });
  });
});
