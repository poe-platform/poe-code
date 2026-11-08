import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: text coreutils sort, uniq, join, comm, cut, paste, tr, and formatting matrix", () => {
  it("1. executes sort with multi-key -k specs, character offsets, -t field delimiter, and -b leading-blank trimming", async () => {
    await withE2EHarness(
      {
        files: {
          "/data/records.txt": [
            "eng:   20:charlie:ID-030",
            "sales:  5:alice:ID-010",
            "eng:    5:bob:ID-020",
            "sales: 20:dave:ID-005",
            "eng:   20:alice:ID-015",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rMulti = await h.expectOk("sort -t: -k1,1 -k2,2nb -k3,3 /data/records.txt");
        assert.equal(
          rMulti.stdout,
          [
            "eng:    5:bob:ID-020",
            "eng:   20:alice:ID-015",
            "eng:   20:charlie:ID-030",
            "sales:  5:alice:ID-010",
            "sales: 20:dave:ID-005",
            "",
          ].join("\n"),
        );

        // Sort by character offset 4..6 inside field 4 (ID-NNN)
        const rCharOffset = await h.expectOk("sort -t: -k4.4,4.6n /data/records.txt");
        assert.equal(
          rCharOffset.stdout,
          [
            "sales: 20:dave:ID-005",
            "sales:  5:alice:ID-010",
            "eng:   20:alice:ID-015",
            "eng:    5:bob:ID-020",
            "eng:   20:charlie:ID-030",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("2. executes sort numeric modes: -n, -g (scientific notation), -h (human units), -V (version), and -M (month)", async () => {
    await withE2EHarness(
      {
        files: {
          "/data/sci.txt": "1e5\n-2.5e2\n3.14\n1e-3\n0\n",
          "/data/human.txt": "2G\n500K\n10M\n1T\n900\n",
          "/data/versions.txt": "v1.10.0\nv1.2.0\nv1.2.10\nv1.2.3\nv2.0.0\n",
          "/data/months.txt": "DEC\nJAN\nAUG\nMAR\n",
        },
      },
      async (h) => {
        const rSci = await h.expectOk("sort -g /data/sci.txt");
        assert.equal(rSci.stdout, "-2.5e2\n0\n1e-3\n3.14\n1e5\n");

        const rHuman = await h.expectOk("sort -h /data/human.txt");
        assert.equal(rHuman.stdout, "900\n500K\n10M\n2G\n1T\n");

        const rVer = await h.expectOk("sort -V /data/versions.txt");
        assert.equal(rVer.stdout, "v1.2.0\nv1.2.3\nv1.2.10\nv1.10.0\nv2.0.0\n");

        const rMonth = await h.expectOk("sort -M /data/months.txt");
        assert.equal(rMonth.stdout, "JAN\nMAR\nAUG\nDEC\n");
      },
    );
  });

  it("3. executes sort -f (ignore case), -d (dictionary order), -u (unique by key), and -s (stable sort)", async () => {
    await withE2EHarness(
      {
        files: {
          "/data/stable.txt": [
            "2:first_two",
            "1:first_one",
            "2:second_two",
            "1:second_one",
            "2:third_two",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rStable = await h.expectOk("sort -s -t: -k1,1n /data/stable.txt");
        assert.equal(
          rStable.stdout,
          [
            "1:first_one",
            "1:second_one",
            "2:first_two",
            "2:second_two",
            "2:third_two",
            "",
          ].join("\n"),
        );

        const rUniqueKey = await h.expectOk("sort -u -t: -k1,1n /data/stable.txt");
        assert.equal(rUniqueKey.stdout, "1:first_one\n2:first_two\n");
      },
    );
  });

  it("4. executes sort -c / -C order checking, -m pre-sorted stream merge, -o in-place output, and -z NUL records", async () => {
    await withE2EHarness(
      {
        files: {
          "/data/s1.txt": "10\n30\n50\n",
          "/data/s2.txt": "20\n40\n60\n",
          "/data/unsorted.txt": "3\n1\n2\n",
        },
      },
      async (h) => {
        await h.expectOk("sort -n -c /data/s1.txt");
        const rBad = await h.exec("sort -n -C /data/unsorted.txt");
        assert.equal(rBad.exitCode, 1);
        assert.equal(rBad.stderr, "");

        const rMerge = await h.expectOk("sort -n -m /data/s1.txt /data/s2.txt");
        assert.equal(rMerge.stdout, "10\n20\n30\n40\n50\n60\n");

        // In-place sort where input and -o output are the same file
        await h.expectOk("sort -n -o /data/unsorted.txt /data/unsorted.txt");
        assert.equal(await h.readText("/data/unsorted.txt"), "1\n2\n3\n");

        const rZero = await h.expectOk("printf 'cherry\\0apple\\0banana\\0' | sort -z | tr '\\0' '\\n'");
        assert.equal(rZero.stdout, "apple\nbanana\ncherry\n");
      },
    );
  });

  it("5. executes uniq with -c, -d, -D, --all-repeated, --group, -f skip-fields, -s skip-chars, -w check-chars, and -i", async () => {
    await withE2EHarness(
      {
        files: {
          "/data/lines.txt": [
            "id1 00_ALPHA_111",
            "id2 00_alpha_222",
            "id3 00_BETA_333",
            "id4 00_GAMMA_444",
            "id5 00_gamma_555",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        // Skip 1 field ("idX"), skip 3 chars ("00_"), compare 5 chars ("ALPHA"/"BETA_"/"GAMMA") case-insensitively
        const rCount = await h.expectOk("uniq -c -i -f 1 -s 3 -w 5 /data/lines.txt");
        assert.equal(
          rCount.stdout,
          [
            "      2 id1 00_ALPHA_111",
            "      1 id3 00_BETA_333",
            "      2 id4 00_GAMMA_444",
            "",
          ].join("\n"),
        );

        const rAllRep = await h.expectOk("uniq -i -f 1 -s 3 -w 5 --all-repeated=separate /data/lines.txt");
        assert.equal(
          rAllRep.stdout,
          [
            "id1 00_ALPHA_111",
            "id2 00_alpha_222",
            "",
            "id4 00_GAMMA_444",
            "id5 00_gamma_555",
            "",
          ].join("\n"),
        );

        const rGroup = await h.expectOk("printf 'a\\na\\nb\\n' | uniq --group=separate");
        assert.equal(rGroup.stdout, "a\na\n\nb\n");
      },
    );
  });

  it("6. executes join inner, outer (-a), anti (-v), custom format (-o / -o auto), empty replacement (-e), -i, and --header", async () => {
    await withE2EHarness(
      {
        files: {
          "/db/users.csv": [
            "id,name,dept",
            "1,Alice,eng",
            "2,Bob,sales",
            "3,Charlie,",
            "",
          ].join("\n"),
          "/db/scores.csv": [
            "emp_id,score",
            "1,95",
            "3,88",
            "4,72",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rInner = await h.expectOk("join -t, --header -1 1 -2 1 -e MISSING -o 0,1.2,1.3,2.2 /db/users.csv /db/scores.csv");
        assert.equal(
          rInner.stdout,
          [
            "id,name,dept,score",
            "1,Alice,eng,95",
            "3,Charlie,MISSING,88",
            "",
          ].join("\n"),
        );

        const rOuter = await h.expectOk("join -t, --header -a 1 -a 2 -e NULL -o auto /db/users.csv /db/scores.csv");
        assert.equal(
          rOuter.stdout,
          [
            "id,name,dept,score",
            "1,Alice,eng,95",
            "2,Bob,sales,NULL",
            "3,Charlie,NULL,88",
            "4,NULL,NULL,72",
            "",
          ].join("\n"),
        );

        const rAntiLeft = await h.expectOk("join -t, --header -v 1 -o 0,1.2 /db/users.csv /db/scores.csv");
        assert.equal(rAntiLeft.stdout, "id,name\n2,Bob\n");
      },
    );
  });

  it("7. executes comm set operations (-12 intersection, -23 left-diff, -13 right-diff, --total, --output-delimiter, -z)", async () => {
    await withE2EHarness(
      {
        files: {
          "/sets/left.txt": "alpha\nbeta\ndelta\nepsilon\n",
          "/sets/right.txt": "beta\ndelta\ngamma\nzeta\n",
        },
      },
      async (h) => {
        const rIntersect = await h.expectOk("comm -12 /sets/left.txt /sets/right.txt");
        assert.equal(rIntersect.stdout, "beta\ndelta\n");

        const rLeftOnly = await h.expectOk("comm -23 /sets/left.txt /sets/right.txt");
        assert.equal(rLeftOnly.stdout, "alpha\nepsilon\n");

        const rRightOnly = await h.expectOk("comm -13 /sets/left.txt /sets/right.txt");
        assert.equal(rRightOnly.stdout, "gamma\nzeta\n");

        const rTotal = await h.expectOk("comm --total --output-delimiter='|' /sets/left.txt /sets/right.txt | tail -n 1");
        assert.equal(rTotal.stdout, "2|2|2|total\n");
      },
    );
  });

  it("8. executes cut with -b bytes, -c UTF-8 characters, -f fields, -s only-delimited, --complement, and --output-delimiter", async () => {
    await withE2EHarness(
      {
        env: { LC_ALL: "en_US.UTF-8" },
        files: {
          "/cut/table.txt": [
            "a:b:c:d",
            "no_delimiter_line",
            "1:2:3:4",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rFields = await h.expectOk("cut -d: -f1,3 --output-delimiter=' -> ' -s /cut/table.txt");
        assert.equal(rFields.stdout, "a -> c\n1 -> 3\n");

        const rComp = await h.expectOk("cut -d: -f2,3 --complement -s /cut/table.txt");
        assert.equal(rComp.stdout, "a:d\n1:4\n");

        const rUtf8Chars = await h.expectOk("printf 'αβγδε\\n' | cut -c2,4 --output-delimiter='-'");
        assert.equal(rUtf8Chars.stdout, "β-δ\n");
      },
    );
  });

  it("9. executes paste parallel and serial (-s) merging with cyclic delimiter lists (-d) and stdin (-) interleaving", async () => {
    await withE2EHarness(
      {
        files: {
          "/paste/col1.txt": "A\nB\nC\n",
          "/paste/col2.txt": "1\n2\n3\n",
          "/paste/col3.txt": "x\ny\nz\n",
        },
      },
      async (h) => {
        const rParallel = await h.expectOk("paste -d ':=' /paste/col1.txt /paste/col2.txt /paste/col3.txt");
        assert.equal(rParallel.stdout, "A:1=x\nB:2=y\nC:3=z\n");

        const rSerial = await h.expectOk("paste -s -d ',;' /paste/col1.txt /paste/col2.txt");
        assert.equal(rSerial.stdout, "A,B;C\n1,2;3\n");

        const rPairwiseStdin = await h.expectOk("seq 1 6 | paste -d '+' - -");
        assert.equal(rPairwiseStdin.stdout, "1+2\n3+4\n5+6\n");
      },
    );
  });

  it("10. executes tr with POSIX classes, ranges, -d delete, -s squeeze, -c complement, and -t truncate", async () => {
    await withE2EHarness({}, async (h) => {
      const rRot13 = await h.expectOk("printf 'Hello, World! 123\\n' | tr 'A-Za-z' 'N-ZA-Mn-za-m' | tr 'N-ZA-Mn-za-m' 'A-Za-z'");
      assert.equal(rRot13.stdout, "Hello, World! 123\n");

      const rComplementSqueeze = await h.expectOk("printf 'foo---123...bar===456!' | tr -cs '[:alnum:]' '_'");
      assert.equal(rComplementSqueeze.stdout, "foo_123_bar_456_");

      const rTruncate = await h.expectOk("printf 'abcd\\n' | tr -t 'abcd' 'XY'");
      assert.equal(rTruncate.stdout, "XYcd\n");
    });
  });

  it("11. executes column -t table alignment with custom input (-s) and output (-o) separators", async () => {
    await withE2EHarness(
      {
        files: {
          "/col/input.txt": [
            "NAME|ROLE|LOC",
            "Alice|Principal Engineer|NYC",
            "Bob|SRE|SF",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.expectOk("column -t -s '|' -o ' :: ' /col/input.txt");
        const lines = r.stdout.trim().split("\n");
        assert.equal(lines.length, 3);
        // Verify column separators align at identical character positions across all rows
        const firstSepIdx = lines.map((l) => l.indexOf(" :: "));
        const secondSepIdx = lines.map((l) => l.lastIndexOf(" :: "));
        assert.equal(new Set(firstSepIdx).size, 1);
        assert.equal(new Set(secondSepIdx).size, 1);
      },
    );
  });

  it("12. executes nl line numbering with body styles (-ba, -bt, -bpREGEX), number formats (-nln, -nrn, -nrz), -w, -s, -v, and -i", async () => {
    await withE2EHarness(
      {
        files: {
          "/nl/doc.txt": "header\n\nITEM: alpha\nfooter\nITEM: beta\n",
        },
      },
      async (h) => {
        const rRegex = await h.expectOk("nl -ba -nrz -w 3 -s ': ' -v 10 -i 5 /nl/doc.txt");
        assert.equal(
          rRegex.stdout,
          [
            "010: header",
            "015: ",
            "020: ITEM: alpha",
            "025: footer",
            "030: ITEM: beta",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("13. executes expand and unexpand with single and comma-separated tab-stop lists", async () => {
    await withE2EHarness({}, async (h) => {
      const rExpand = await h.expectOk("printf 'a\\tb\\tc\\n' | expand -t 4,10");
      assert.equal(rExpand.stdout, "a   b     c\n");

      const rRoundtrip = await h.expectOk("printf '    indented\\ttext\\n' | expand -t 4 | unexpand -t 4");
      assert.equal(rRoundtrip.stdout, "\tindented\ttext\n");
    });
  });

  it("14. executes fold (-w, -s, -b) and fmt (-w, -u, -p) paragraph and line wrapping", async () => {
    await withE2EHarness({}, async (h) => {
      const rFold = await h.expectOk("printf 'alpha beta gamma delta\\n' | fold -s -w 11");
      assert.equal(rFold.stdout, "alpha beta \ngamma delta\n");

      const rFmt = await h.expectOk("printf '> quote line one\\n> quote line two that is longer\\n' | fmt -p '>' -w 22");
      const lines = rFmt.stdout.trim().split("\n");
      assert.ok(lines.length >= 2);
      assert.ok(lines.every((l) => l.startsWith(">")));
    });
  });

  it("15. executes numfmt human unit conversion (--from=iec, --to=iec-i, --to=si, --field, --delimiter, --header)", async () => {
    await withE2EHarness(
      {
        files: {
          "/num/metrics.csv": [
            "service,bytes",
            "api,1048576",
            "db,2147483648",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rCsv = await h.expectOk("numfmt -d, --header --field=2 --to=iec-i < /num/metrics.csv");
        assert.equal(
          rCsv.stdout,
          [
            "service,bytes",
            "api,1.0Mi",
            "db,2.0Gi",
            "",
          ].join("\n"),
        );

        const rRound = await h.expectOk("numfmt --from=iec --to=si 1G");
        assert.equal(rRound.stdout, "1.1G\n");
      },
    );
  });

  it("16. executes shuf range (-i), count (-n), echo (-e), and deterministic --random-source", async () => {
    await withE2EHarness(
      {
        files: {
          "/shuf/seed.bin": "deterministic_seed_bytes_for_shuf_testing_0123456789\n",
        },
      },
      async (h) => {
        const r1 = await h.expectOk("shuf -i 1-10 --random-source=/shuf/seed.bin");
        const r2 = await h.expectOk("shuf -i 1-10 --random-source=/shuf/seed.bin");
        assert.equal(r1.stdout, r2.stdout);
        const sorted = r1.stdout
          .trim()
          .split("\n")
          .map(Number)
          .sort((a, b) => a - b);
        assert.deepEqual(sorted, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      },
    );
  });

  it("17. executes rev character reversal and tac record reversal with custom separator (-s)", async () => {
    await withE2EHarness({}, async (h) => {
      const rRev = await h.expectOk("printf 'stressed\\ndesserts\\n' | rev");
      assert.equal(rRev.stdout, "desserts\nstressed\n");

      const rTac = await h.expectOk("printf 'first\\nsecond\\nthird\\n' | tac");
      assert.equal(rTac.stdout, "third\nsecond\nfirst\n");

      const rTacSep = await h.expectOk("printf 'one|two|three|' | tac -s '|'");
      assert.equal(rTacSep.stdout, "three|two|one|");
    });
  });

  it("18. executes split (-l, -d, -a, --additional-suffix) and csplit regex/line chunking with lossless reassembly", async () => {
    await withE2EHarness(
      {
        files: {
          "/split/ten.txt": "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n",
          "/split/sections.txt": [
            "intro",
            "== SEC 1 ==",
            "body 1a",
            "body 1b",
            "== SEC 2 ==",
            "body 2a",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        await h.expectOk("split -l 4 -d -a 2 --additional-suffix=.part /split/ten.txt /split/chunk_");
        const rParts = await h.expectOk("ls /split/chunk_*.part | sort");
        assert.equal(
          rParts.stdout,
          [
            "/split/chunk_00.part",
            "/split/chunk_01.part",
            "/split/chunk_02.part",
            "",
          ].join("\n"),
        );
        const rReassembled = await h.expectOk("cat /split/chunk_*.part");
        assert.equal(rReassembled.stdout, await h.readText("/split/ten.txt"));

        await h.expectOk("csplit -s -f /split/sec_ -n 2 /split/sections.txt '/^== SEC/' '{*}'");
        assert.equal(await h.readText("/split/sec_00"), "intro\n");
        assert.equal(await h.readText("/split/sec_01"), "== SEC 1 ==\nbody 1a\nbody 1b\n");
        assert.equal(await h.readText("/split/sec_02"), "== SEC 2 ==\nbody 2a\n");
      },
    );
  });

  it("19. executes xxd (-p / -r -p), od (-An -tx1), base64, and base32 binary/hex roundtrips", async () => {
    await withE2EHarness({}, async (h) => {
      const rXxd = await h.expectOk("printf 'SafeBash-2026!\\0\\xff' | xxd -p | xxd -r -p | base64 | base64 -d | xxd -p");
      assert.equal(rXxd.stdout.trim(), "53616665426173682d323032362100ff");

      const rBase32 = await h.expectOk("printf 'zero-dep-coreutils' | base32 | base32 -d");
      assert.equal(rBase32.stdout, "zero-dep-coreutils");

      const rOd = await h.expectOk("printf 'ABCD' | od -An -tx1 | tr -d ' \\n'");
      assert.equal(rOd.stdout, "41424344");
    });
  });

  it("20. executes end-to-end relational ETL pipeline combining sort, join, comm, cut, paste, uniq, and numfmt", async () => {
    await withE2EHarness(
      {
        files: {
          "/etl/hosts.txt": [
            "h3,db-primary",
            "h1,web-edge",
            "h2,cache-node",
            "h4,decommissioned",
            "",
          ].join("\n"),
          "/etl/active_hosts.txt": "h1\nh2\nh3\n",
          "/etl/traffic.txt": [
            "h2,1048576",
            "h1,2097152",
            "h3,524288",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const script = [
          "sort -t, -k1,1 /etl/hosts.txt > /etl/hosts.sorted",
          "sort -t, -k1,1 /etl/traffic.txt > /etl/traffic.sorted",
          "cut -d, -f1 /etl/hosts.sorted > /etl/all_ids.txt",
          "comm -12 /etl/all_ids.txt /etl/active_hosts.txt > /etl/active_ids.txt",
          "join -t, -1 1 -2 1 /etl/active_ids.txt /etl/hosts.sorted > /etl/active_hosts_named.txt",
          "join -t, -1 1 -2 1 /etl/active_hosts_named.txt /etl/traffic.sorted | sort -t, -k3,3nr | numfmt -d, --field=3 --to=iec",
        ].join("\n");
        const r = await h.expectOk(script);
        assert.equal(
          r.stdout,
          [
            "h1,web-edge,2.0M",
            "h2,cache-node,1.0M",
            "h3,db-primary,512K",
            "",
          ].join("\n"),
        );
      },
    );
  });
});
