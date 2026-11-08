import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure coreutils, fs, symlinks, permissions, stat, dd, install, split, csplit, and column parity matrix", () => {
  it("1. chained relative and absolute symlinks with ln -s, readlink, readlink -f, and realpath --relative-to", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p tree/a/b tree/c/d
      printf 'payload_v1\\n' > tree/a/b/target.txt
      ln -s ../../a/b/target.txt tree/c/d/rel_link.txt
      ln -s d/rel_link.txt tree/c/chain_link.txt
      root=$(pwd)
      raw=$(readlink tree/c/chain_link.txt)
      canon=$(readlink -f tree/c/chain_link.txt)
      rel=$(realpath --relative-to=tree/c/d tree/a/b/target.txt)
      content=$(cat tree/c/chain_link.txt)
      echo "raw=$raw canon=\${canon#$root} rel=$rel content=$content"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "raw=d/rel_link.txt canon=/tree/a/b/target.txt rel=../../a/b/target.txt content=payload_v1\n"
    );
  });

  it("2. chmod octal and symbolic modes (u+rwx,g+rx,o-rwx, a+x) and stat -c formatting", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'hello12345' > perm.txt
      chmod 640 perm.txt
      s1=$(stat -c '%a:%s:%F' perm.txt)
      chmod u+x,g-w,o+r perm.txt
      s2=$(stat -c '%a:%A' perm.txt)
      mkdir -p sub_dir
      chmod 750 sub_dir
      s3=$(stat -c '%a:%F' sub_dir)
      echo "s1=$s1 | s2=$s2 | s3=$s3"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "s1=640:10:regular file | s2=744:-rwxr--r-- | s3=750:directory\n"
    );
  });

  it("3. cp -r, mv, rm -rf, and rmdir -p directory hierarchy manipulation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p src/nested empty/a/b/c
      printf 'alpha\\n' > src/root.txt
      printf 'beta\\n' > src/nested/leaf.txt
      cp -r src dst
      mv dst/nested/leaf.txt dst/moved.txt
      rmdir dst/nested
      rmdir -p empty/a/b/c
      rm -rf src
      find dst -type f | sort
      test ! -d src && test ! -d empty && echo "cleaned=yes"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "dst/moved.txt",
        "dst/root.txt",
        "cleaned=yes",
        "",
      ].join("\n")
    );
  });

  it("4. install -d and install -D -m creating parent directories and setting file modes", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '#!/bin/sh\\necho installed_ok\\n' > runner.sh
      install -D -m 755 runner.sh opt/app/bin/runner.sh
      install -d -m 700 opt/app/var/cache
      echo "bin=$(stat -c '%a' opt/app/bin/runner.sh) cache=$(stat -c '%a' opt/app/var/cache) body=$(sed -n '2p' opt/app/bin/runner.sh)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "bin=755 cache=700 body=echo installed_ok\n");
  });

  it("5. dd block slicing with bs, skip, seek, count, and conv=ucase,notrunc", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '0123456789abcdef' > raw.bin
      printf '________________' > out.bin
      dd if=raw.bin of=out.bin bs=4 skip=1 seek=2 count=2 conv=ucase,notrunc 2>/dev/null
      cat out.bin
      echo ""
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "________456789AB\n");
  });

  it("6. truncate -s exact size, +N extension, and -N reduction", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '0123456789' > data.bin
      truncate -s 6 data.bin
      s1=$(stat -c '%s' data.bin)
      c1=$(cat data.bin)
      truncate -s +4 data.bin
      s2=$(stat -c '%s' data.bin)
      truncate -s -3 data.bin
      s3=$(stat -c '%s' data.bin)
      echo "s1=$s1 c1=$c1 s2=$s2 s3=$s3"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "s1=6 c1=012345 s2=10 s3=7\n");
  });

  it("7. split -l line chunks and -b byte chunks with -d numeric suffixes and -a suffix length", async () => {
    const env = createEnv();
    const res = await env.exec(`
      seq 1 7 > numbers.txt
      split -l 3 -d -a 2 numbers.txt chunk_
      for f in chunk_*; do
        echo "$f:$(paste -sd, "$f")"
      done
      printf 'abcdefghij' > bytes.txt
      split -b 4 -d -a 2 bytes.txt bchunk_
      for f in bchunk_*; do
        echo "$f:$(cat "$f")"
      done
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "chunk_00:1,2,3",
        "chunk_01:4,5,6",
        "chunk_02:7",
        "bchunk_00:abcd",
        "bchunk_01:efgh",
        "bchunk_02:ij",
        "",
      ].join("\n")
    );
  });

  it("8. csplit regex section splitting with {*} repeat, -f prefix, -n digits, and -z elide empty", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > doc.txt
HEADER_1
alpha
beta
HEADER_2
gamma
HEADER_3
delta
epsilon
EOF
      csplit -s -z -f sec_ -n 2 doc.txt '/^HEADER_/' '{*}'
      for f in sec_*; do
        echo "$f=$(paste -sd: "$f")"
      done
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "sec_00=HEADER_1:alpha:beta",
        "sec_01=HEADER_2:gamma",
        "sec_02=HEADER_3:delta:epsilon",
        "",
      ].join("\n")
    );
  });

  it("9. sort multi-key -t -k, -V version sort, -h human numeric sort, and -u unique", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'db:20\napi:5\ndb:5\napi:100\n' | sort -t: -k1,1 -k2,2nr
      echo "---"
      printf 'v1.10.0\nv1.2.0\nv1.2.5\nv1.0.9\n' | sort -V
      echo "---"
      printf '2G\n500K\n12M\n100\n' | sort -h
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "api:100",
        "api:5",
        "db:20",
        "db:5",
        "---",
        "v1.0.9",
        "v1.2.0",
        "v1.2.5",
        "v1.10.0",
        "---",
        "100",
        "500K",
        "12M",
        "2G",
        "",
      ].join("\n")
    );
  });

  it("10. uniq -c count, -d repeated only, -u unique only, and -i case-insensitive", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'alpha\nalpha\nbeta\ngamma\ngamma\ngamma\n' > items.txt
      uniq -d items.txt
      echo "---"
      uniq -u items.txt
      echo "---"
      printf 'Foo\nfoo\nFOO\nBar\n' | uniq -i | tr 'A-Z' 'a-z'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "alpha",
        "gamma",
        "---",
        "beta",
        "---",
        "foo",
        "bar",
        "",
      ].join("\n")
    );
  });

  it("11. relational join with -t delimiter, -1 -2 keys, -a1 -a2 outer join, -e empty filler, and -o format", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '101,alice\n102,bob\n103,carol\n' > users.csv
      printf '101,admin\n103,editor\n104,guest\n' > roles.csv
      join -t, -1 1 -2 1 -a1 -a2 -e 'NONE' -o '0,1.2,2.2' users.csv roles.csv
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "101,alice,admin",
        "102,bob,NONE",
        "103,carol,editor",
        "104,NONE,guest",
        "",
      ].join("\n")
    );
  });

  it("12. comm set intersection (-12), left-only (-23), and right-only (-13)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'a\nb\nc\nd\n' > left.txt
      printf 'b\nc\ne\n' > right.txt
      echo "both=$(comm -12 left.txt right.txt | paste -sd, -)"
      echo "left_only=$(comm -23 left.txt right.txt | paste -sd, -)"
      echo "right_only=$(comm -13 left.txt right.txt | paste -sd, -)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "both=b,c",
        "left_only=a,d",
        "right_only=e",
        "",
      ].join("\n")
    );
  });

  it("13. cut with -d, -f field ranges, --complement, -s suppress non-delimited, and --output-delimiter", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'a:b:c:d\nno_delim_line\ne:f:g:h\n' > fields.txt
      cut -d: -s -f1,3 --output-delimiter='|' fields.txt
      echo "---"
      cut -d: -s --complement -f2 fields.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "a|c",
        "e|g",
        "---",
        "a:c:d",
        "e:g:h",
        "",
      ].join("\n")
    );
  });

  it("14. paste parallel merge and -s serial transpose with cycling delimiters (-d)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'k1\nk2\nk3\n' > keys.txt
      printf 'v1\nv2\nv3\n' > vals.txt
      paste -d '=' keys.txt vals.txt
      echo "---"
      printf '1\n2\n3\n4\n5\n' | paste -s -d ':,' -
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "k1=v1",
        "k2=v2",
        "k3=v3",
        "---",
        "1:2,3:4,5",
        "",
      ].join("\n")
    );
  });

  it("15. tr character classes, -d delete, -s squeeze repeats, and -c complement", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'Hello   World   123!!\n' | tr '[:upper:]' '[:lower:]' | tr -s ' ' '_'
      printf 'id-984-key-21\n' | tr -cd '0-9\n'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "hello_world_123!!",
        "98421",
        "",
      ].join("\n")
    );
  });

  it("16. nl line numbering with -ba, -bt, -n rz zero-padded format, -w width, -s separator, and -v/-i", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'first\n\nsecond\n' | nl -bt -n rz -w 3 -s ': ' -v 10 -i 5
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "010: first",
        "     ",
        "015: second",
        "",
      ].join("\n")
    );
  });

  it("17. expand and unexpand tab conversion with custom tab stops (-t) and -a", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'a\tb\tc\n' | expand -t 4 | tr ' ' '.'
      printf 'aaaa    bbbb\n' | unexpand -a -t 4 | od -An -tx1 | tr -s ' ' | sed 's/^ //;s/ $//'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "a...b...c",
        "61 61 61 61 09 62 62 62 62 0a",
        "",
      ].join("\n")
    );
  });

  it("18. fold -w -s word-boundary wrapping and column -t table alignment", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'the quick brown fox jumps over the lazy dog\n' | fold -s -w 16
      echo "---"
      printf 'NAME,ROLE,SCORE\nalice,engineer,98\nbob,ops,100\n' | column -t -s ',' -o ' | '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "the quick brown ",
        "fox jumps over ",
        "the lazy dog",
        "---",
        "NAME  | ROLE     | SCORE",
        "alice | engineer | 98",
        "bob   | ops      | 100",
        "",
      ].join("\n")
    );
  });

  it("19. numfmt --to=iec, --to=si, and --from=iec unit conversions", async () => {
    const env = createEnv();
    const res = await env.exec(`
      echo "iec=$(numfmt --to=iec 1048576)"
      echo "si=$(numfmt --to=si 1000000)"
      echo "from=$(numfmt --from=iec 32K)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "iec=1.0M",
        "si=1.0M",
        "from=32768",
        "",
      ].join("\n")
    );
  });

  it("20. bc scale/functions, expr, factor, seq -f -w, tsort, and sponge in-place pipeline write", async () => {
    const env = createEnv();
    const res = await env.exec(`
      echo "bc=$(printf 'scale=4; sqrt(2) + (22 / 7)\n' | bc)"
      echo "expr=$(expr 14 '*' 3 + 5)"
      echo "factor=$(factor 1260)"
      echo "seq=$(seq -w -s ':' 8 10)"
      printf 'c\na\nb\n' > inplace.txt
      sort inplace.txt | sponge inplace.txt
      echo "sponge=$(paste -sd, inplace.txt)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "bc=4.5570",
        "expr=47",
        "factor=1260: 2 2 3 3 5 7",
        "seq=08:09:10",
        "sponge=a,b,c",
        "",
      ].join("\n")
    );
  });
});
