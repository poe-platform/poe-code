import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: coreutils text, table, bytes, encoding, and formatting deep matrix", () => {
  it("1. bc arbitrary-precision arithmetic, base conversion (ibase/obase), user functions, loops, and -l math library", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
bc <<'BC'
scale=6
2^64
define fact(n) {
  if (n <= 1) return (1);
  return (n * fact(n - 1));
}
fact(10)
s = 0
for (i = 1; i <= 10; i++) {
  s += i * i
}
s
obase=16
255
obase=10
ibase=16
FF
BC
bc -l <<< "scale=4; 4*a(1)"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "18446744073709551616",
          "3628800",
          "385",
          "FF",
          "255",
          "3.1412",
        ].join("\n")
      );
    });
  });

  it("2. expr integer arithmetic, comparisons, logical operators, BRE regex capture, substr, index, and length", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
echo "arith=$(expr 14 \* 3 + 8 % 5)"
echo "cmp=$(expr 42 \>= 19)"
echo "or=$(expr '' \| 'fallback')"
echo "and=$(expr 'left' \& 'right')"
echo "regex=$(expr 'release-v2.14.9-rc1' : 'release-v\([0-9.]*\)-rc1')"
echo "substr=$(expr substr 'rust-migration' 6 9)"
echo "index=$(expr index 'abcdef' 'de')"
echo "len=$(expr length 'zero-dependency')"
expr 0 >/dev/null || echo "zero_exit=$?"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "arith=45",
          "cmp=1",
          "or=fallback",
          "and=left",
          "regex=2.14.9",
          "substr=migration",
          "index=4",
          "len=15",
          "zero_exit=1",
        ].join("\n")
      );
    });
  });

  it("3. numfmt human-readable unit scaling (--to=iec, --to=iec-i, --to=si, --from=iec, --field, --delimiter, --header, --round)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
numfmt --to=iec 1048576 2621440
numfmt --to=iec-i --suffix=B 1048576
numfmt --to=si --round=up 1500
numfmt --from=iec 2K 4M
printf "service,bytes\napi,1048576\ndb,536870912\n" | numfmt --delimiter=, --header=1 --field=2 --to=iec
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "1.0M",
          "2.5M",
          "1.0MiB",
          "1.5k",
          "2048",
          "4194304",
          "service,bytes",
          "api,1.0M",
          "db,512M",
        ].join("\n")
      );
    });
  });

  it("4. column table formatting (-t -s -o -N -R -H -O) and JSON table serialization (-J -n)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
cat <<'CSV' > /work/nodes.csv
node-a,us-east,12,online
node-b,eu-west,140,online
node-c,ap-south,8,maintenance
CSV

column -t -s ',' -o ' | ' -N HOST,REGION,LATENCY,STATE -R LATENCY -H STATE /work/nodes.csv
column -J -n cluster -s ',' -N host,region,latency,state /work/nodes.csv | jq -r '.cluster | length, .[0].host, .[1].latency'
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "HOST   | REGION   | LATENCY",
          "node-a | us-east  |  12",
          "node-b | eu-west  | 140",
          "node-c | ap-south |   8",
          "3",
          "node-a",
          "140",
        ].join("\n")
      );
    });
  });

  it("5. comm, join, and paste perform relational joins, set comparisons, and column zipping", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
printf "alpha\nbeta\ndelta\ngamma\n" > /work/set1.txt
printf "beta\ndelta\nepsilon\n" > /work/set2.txt

echo "common=$(comm -12 /work/set1.txt /work/set2.txt | paste -sd ',' -)"
echo "only1=$(comm -23 /work/set1.txt /work/set2.txt | paste -sd ',' -)"
echo "only2=$(comm -13 /work/set1.txt /work/set2.txt | paste -sd ',' -)"

cat <<'USERS' > /work/users.csv
1,alice
2,bob
3,carol
USERS
cat <<'ROLES' > /work/roles.csv
1,admin
3,editor
4,viewer
ROLES

join -t ',' -a 1 -a 2 -e 'NONE' -o 0,1.2,2.2 /work/users.csv /work/roles.csv
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "common=beta,delta",
          "only1=alpha,gamma",
          "only2=epsilon",
          "1,alice,admin",
          "2,bob,NONE",
          "3,carol,editor",
          "4,NONE,viewer",
        ].join("\n")
      );
    });
  });

  it("6. pr multi-column pagination (-t, -2, -a, -s, -n, -m)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
printf "one\ntwo\nthree\nfour\n" | pr -t -2 -a -s':'
echo "---"
printf "left1\nleft2\n" > /work/l.txt
printf "right1\nright2\n" > /work/r.txt
pr -t -m -s'|' /work/l.txt /work/r.txt
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "one:two",
          "three:four",
          "---",
          "left1|right1",
          "left2|right2",
        ].join("\n")
      );
    });
  });

  it("7. fmt and fold text reflowing, prefix preservation (-p), uniform spacing (-u), and space-aware line breaking (-s)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
printf "// This   is a   long comment line that should be wrapped cleanly with its prefix preserved.\n" \
  | fmt -w 36 -p "//" -u
echo "---"
printf "alpha beta gamma delta epsilon\n" | fold -w 14 -s
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const [fmtOut, foldOut] = r.stdout.trim().split("\n---\n");
      for (const line of fmtOut!.split("\n")) {
        assert.ok(line.startsWith("//"), `expected '//' prefix on '${line}'`);
        assert.ok(line.length <= 36, `expected length <= 36 on '${line}'`);
      }
      assert.equal(
        foldOut,
        ["alpha beta ", "gamma delta ", "epsilon"].join("\n")
      );
    });
  });

  it("8. expand and unexpand tab/space conversion with custom tab stops and initial-only mode", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
printf "\talpha\tbeta\n" | expand -t 4 | tr ' ' '.'
printf "\talpha\tbeta\n" | expand -i -t 4 | tr '\t' '^'
printf "    alpha    beta\n" | unexpand -a -t 4 | tr '\t' '>'
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        ["....alpha...beta", "    alpha^beta", ">alpha> beta"].join("\n")
      );
    });
  });

  it("9. nl line numbering, tac record reversal, rev character reversal, and seq formatted sequences", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
printf "first\n\nthird\n" | nl -ba -n rz -w 3 -s ':' -v 10 -i 5
echo "---"
printf "one\ntwo\nthree\n" | tac | rev
echo "---"
seq -f "item-%03g" -s "," 5 5 20
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "010:first",
          "015:",
          "020:third",
          "---",
          "eerht",
          "owt",
          "eno",
          "---",
          "item-005,item-010,item-015,item-020",
        ].join("\n")
      );
    });
  });

  it("10. csplit and split partition files by regex and line/byte counts and reconstruct identically", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work/cs /work/sp
cat <<'DOC' > /work/sections.txt
sec1-a
sec1-b
---
sec2-a
---
sec3-a
sec3-b
DOC

cd /work/cs
csplit -s -f sec_ -n 2 /work/sections.txt '/^---$/' '{*}'
ls sec_* | wc -l | tr -d ' '
cat sec_00 | tr '\n' ':'
echo ""

seq 1 10 > /work/nums.txt
split -l 4 -d -a 2 --additional-suffix=.part /work/nums.txt /work/sp/chunk_
ls /work/sp/chunk_*.part | wc -l | tr -d ' '
cat /work/sp/chunk_*.part > /work/rejoined.txt
cmp -s /work/nums.txt /work/rejoined.txt && echo "rejoined_ok"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        ["3", "sec1-a:sec1-b:", "3", "rejoined_ok"].join("\n")
      );
    });
  });

  it("11. tsort topological dependency order, cycle reporting, and factor prime factorization", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
cat <<'DAG' | tsort | paste -sd ' ' -
contracts parser
parser ast
ast runtime
runtime cli
DAG

factor 1 17 360 9999991
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "contracts parser ast runtime cli",
          "1:",
          "17: 17",
          "360: 2 2 2 3 3 5",
          "9999991: 9999991",
        ].join("\n")
      );
    });
  });

  it("12. getopt parses short and long flags, optional arguments, and quoted operands", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
parsed=$(getopt -o vf:o:: --long verbose,file:,output:: -n testcli -- pos1 -v --file "my doc.txt" --output=bundle pos2)
echo "$parsed"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        "-v --file 'my doc.txt' --output 'bundle' -- 'pos1' 'pos2'"
      );
    });
  });

  it("13. iconv character encoding conversion and dos2unix/unix2dos line ending conversion (-n newfile and in-place)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
printf "Caf\xc3\xa9\n" | iconv -f UTF-8 -t ISO-8859-1 | xxd -p
printf "Caf\xe9\n" | iconv -f ISO-8859-1 -t UTF-8

printf "line1\nline2\n" > /work/lines.txt
unix2dos -q /work/lines.txt
xxd -p /work/lines.txt
dos2unix -q -n /work/lines.txt /work/clean.txt
xxd -p /work/clean.txt
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "436166e90a",
          "Café",
          "6c696e65310d0a6c696e65320d0a",
          "6c696e65310a6c696e65320a",
        ].join("\n")
      );
    });
  });

  it("14. xxd (-p, -r, -i), od (-An -tx1 -tu1), and hexdump (-C) binary inspection and reconstruction", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
printf "\x00\x01\xfe\xffABCD" > /work/bin.dat
xxd -p /work/bin.dat > /work/hex.txt
cat /work/hex.txt
xxd -r -p /work/hex.txt > /work/restored.dat
cmp -s /work/bin.dat /work/restored.dat && echo "xxd_roundtrip_ok"

od -An -tu1 /work/bin.dat | tr -s ' ' | sed 's/^ //;s/ $//'
hexdump -C /work/bin.dat | head -n 1
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "0001feff41424344",
          "xxd_roundtrip_ok",
          "0 1 254 255 65 66 67 68",
          "00000000  00 01 fe ff 41 42 43 44                           |....ABCD|",
        ].join("\n")
      );
    });
  });

  it("15. base64 and base32 encoding and decoding with line wrapping and binary round-trip", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
printf "\x00\x10\x80\xffsafe-bash-rust-2026\x00" > /work/raw.bin

base64 -w 16 /work/raw.bin > /work/b64.txt
wc -l < /work/b64.txt | tr -d ' '
base64 -d /work/b64.txt > /work/from_b64.bin
cmp -s /work/raw.bin /work/from_b64.bin && echo "b64_ok"

base32 -w 0 /work/raw.bin > /work/b32.txt
cat /work/b32.txt
echo ""
base32 -d /work/b32.txt > /work/from_b32.bin
cmp -s /work/raw.bin /work/from_b32.bin && echo "b32_ok"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "2",
          "b64_ok",
          "AAIIB73TMFTGKLLCMFZWQLLSOVZXILJSGAZDMAA=",
          "b32_ok",
        ].join("\n")
      );
    });
  });

  it("16. checksum suite (cksum, md5sum, sha1sum, sha224sum, sha256sum, sha384sum, sha512sum) manifest generation and -c verification", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
cd /work
printf "alpha-payload\n" > a.txt
printf "beta-payload\n" > b.txt

cksum a.txt
md5sum a.txt b.txt > sums.md5
sha1sum a.txt b.txt > sums.sha1
sha256sum a.txt b.txt > sums.sha256
sha384sum a.txt b.txt > sums.sha384
sha512sum a.txt b.txt > sums.sha512

md5sum -c --quiet sums.md5 && echo "md5_ok"
sha1sum -c --quiet sums.sha1 && echo "sha1_ok"
sha256sum -c --quiet sums.sha256 && echo "sha256_ok"
sha384sum -c --quiet sums.sha384 && echo "sha384_ok"
sha512sum -c --quiet sums.sha512 && echo "sha512_ok"

printf "tampered\n" > b.txt
sha256sum -c --status sums.sha256 || echo "tamper_detected=$?"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "2634376724 14 a.txt",
          "md5_ok",
          "sha1_ok",
          "sha256_ok",
          "sha384_ok",
          "sha512_ok",
          "tamper_detected=1",
        ].join("\n")
      );
    });
  });

  it("17. dd block slicing, seek/skip offsets, conv=ucase/lcase/swab/notrunc", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
printf "abcdefghij" > /work/in.txt
dd if=/work/in.txt of=/work/upper.txt bs=2 skip=1 count=3 conv=ucase status=none
cat /work/upper.txt
echo ""

dd if=/work/in.txt of=/work/swab.txt bs=2 count=4 conv=swab status=none
cat /work/swab.txt
echo ""

printf "0123456789" > /work/patch.txt
printf "XXXX" | dd of=/work/patch.txt bs=1 seek=3 conv=notrunc status=none
cat /work/patch.txt
echo ""
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        ["CDEFGH", "badcfehg", "012XXXX789"].join("\n")
      );
    });
  });

  it("18. shuf sampling, sponge in-place pipeline soaking (-a), and truncate file sizing", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
shuf -i 1-5 | sort -n | paste -sd ',' -

printf "charlie\nalpha\nbravo\nalpha\n" > /work/list.txt
sort -u /work/list.txt | sponge /work/list.txt
cat /work/list.txt

printf "delta\n" | sponge -a /work/list.txt
wc -l < /work/list.txt | tr -d ' '

truncate -s 100 /work/sized.bin
wc -c < /work/sized.bin | tr -d ' '
truncate -s -40 /work/sized.bin
wc -c < /work/sized.bin | tr -d ' '
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        ["1,2,3,4,5", "alpha", "bravo", "charlie", "4", "100", "60"].join("\n")
      );
    });
  });

  it("19. install (-d, -D, -m, -b), envsubst (-v and selective format), and pathchk (-p, -P)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
printf "#!/bin/sh\necho v1\n" > /work/run.sh
install -D -m 0755 /work/run.sh /work/deploy/bin/run.sh
printf "#!/bin/sh\necho v2\n" > /work/run.sh
install -b -m 0755 /work/run.sh /work/deploy/bin/run.sh
cat /work/deploy/bin/run.sh~ | tail -n 1
cat /work/deploy/bin/run.sh | tail -n 1

export APP_HOST="api.example.com" APP_PORT="8443" SECRET="do-not-touch"
envsubst -v 'https://$APP_HOST:$APP_PORT/$SECRET'
printf 'url=https://$APP_HOST:$APP_PORT/$SECRET\n' | envsubst '$APP_HOST $APP_PORT'

pathchk -p "valid_dir/file-01.txt" && echo "pathchk_ok"
pathchk -P "" 2>/dev/null || echo "pathchk_empty=$?"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "echo v1",
          "echo v2",
          "APP_HOST",
          "APP_PORT",
          "SECRET",
          "url=https://api.example.com:8443/$SECRET",
          "pathchk_ok",
          "pathchk_empty=1",
        ].join("\n")
      );
    });
  });

  it("20. strings binary extraction with offsets and cal leap-year and Julian calendar formatting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
printf "\x00\x00\x00build_id=rust_2026\x00\xff\xfeab\x00target_arch=wasm32\x00" > /work/blob.bin
strings -n 6 /work/blob.bin

cal 2 2024 | grep -F "29" >/dev/null && echo "leap_2024_ok"
cal 2 2023 | grep -F "29" >/dev/null || echo "nonleap_2023_ok"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "build_id=rust_2026",
          "target_arch=wasm32",
          "leap_2024_ok",
          "nonleap_2023_ok",
        ].join("\n")
      );
    });
  });
});
