import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("xargs, env, timeout, date, seq, shuf, split, csplit, and math/utility matrix", () => {
  it("1. xargs -n batching, -I replacement token, and -r no-run-if-empty", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "a b c d e\\n" | xargs -n 2 echo "batch:"
        printf "alpha\\nbeta\\n" | xargs -I {} echo "item=[{}]"
        printf "" | xargs -r echo "SHOULD_NOT_PRINT"
        echo "DONE"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "batch: a b",
          "batch: c d",
          "batch: e",
          "item=[alpha]",
          "item=[beta]",
          "DONE",
          "",
        ].join("\n"),
      );
    });
  });

  it("2. xargs -0 NUL-delimited filenames with spaces and quotes, plus -d custom delimiter", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/dir/file one.txt": "alpha\n",
          "/workspace/dir/file 'two'.txt": "beta\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          find dir -type f -print0 | sort -z | xargs -0 wc -l | awk '{print $1}'
          printf "red:green:blue" | xargs -d : -n 1 echo "color:"
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(
          r.stdout,
          ["1", "1", "2", "color: red", "color: green", "color: blue", ""].join("\n"),
        );
      },
    );
  });

  it("3. xargs -L max-lines, -E EOF marker, and -a arg-file", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/items.txt": "one two\nthree four\nSTOP\nfive six\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          xargs -a items.txt -E STOP -L 1 echo "row:"
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "row: one two\nrow: three four\n");
      },
    );
  });

  it("4. env -i empty environment, -u unset variable, VAR=val overrides, and printenv", async () => {
    await withE2EHarness(
      {
        env: { KEEP_ME: "yes", DROP_ME: "no" },
      },
      async (h) => {
        const r = await h.exec(`
          env -u DROP_ME EXTRA=42 printenv KEEP_ME EXTRA
          env -u DROP_ME printenv DROP_ME && echo "STILL_SET" || echo "UNSET_OK"
          env -i CLEAN_ONLY=true printenv | sort
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "yes\n42\nUNSET_OK\nCLEAN_ONLY=true\n");
      },
    );
  });

  it("5. timeout command completes fast child with exit 0 and terminates slow child with exit 124", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        timeout 2s echo "FAST_OK"
        set +e
        timeout 0.02s sleep 5
        code=$?
        set -e
        echo "TIMEOUT_EXIT:$code"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "FAST_OK\nTIMEOUT_EXIT:124\n");
    });
  });

  it("6. date -u UTC formatting, @epoch parsing, -d ISO date strings, and +%s round-trip", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        date -u -d "@0" "+%Y-%m-%d %H:%M:%S %Z"
        date -u -d "@1700000000" "+%Y-%m-%dT%H:%M:%SZ"
        date -u -d "2025-01-15T12:30:45Z" "+%s"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "1970-01-01 00:00:00 UTC",
          "2023-11-14T22:13:20Z",
          "1736944245",
          "",
        ].join("\n"),
      );
    });
  });

  it("7. seq integer, negative step, -w zero-padded width, -s custom separator, and -f printf format", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        seq -s "," 1 5
        seq -w -s ":" 8 10
        seq -s " " 10 -3 1
        seq -f "v%.1f" -s "|" 1 0.5 2
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "1,2,3,4,5",
          "08:09:10",
          "10 7 4 1",
          "v1.0|v1.5|v2.0",
          "",
        ].join("\n"),
      );
    });
  });

  it("8. shuf permutation invariants (-i range, -e args, -n sample size, --random-source deterministic)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/seed.bin": "deterministic-random-seed-bytes-0123456789abcdef\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          shuf -i 1-10 | sort -n | tr '\\n' ' '
          echo ""
          s1=$(shuf --random-source=seed.bin -e alpha beta gamma delta | tr '\\n' ',')
          s2=$(shuf --random-source=seed.bin -e alpha beta gamma delta | tr '\\n' ',')
          test "$s1" = "$s2" && echo "SEED_DETERMINISTIC"
          shuf -i 100-200 -n 4 | wc -l | tr -d ' '
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "1 2 3 4 5 6 7 8 9 10 \nSEED_DETERMINISTIC\n4\n");
      },
    );
  });

  it("9. split by line count (-l), byte count (-b), numeric suffixes (-d -a), and --additional-suffix", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        seq 1 10 > ten.txt
        split -l 3 -d -a 2 --additional-suffix=.part ten.txt chunk_
        ls chunk_*.part | sort
        wc -l chunk_00.part chunk_01.part chunk_02.part chunk_03.part | awk '{print $1}'
        cat chunk_*.part | cmp -s - ten.txt && echo "REASSEMBLED_EXACT"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "chunk_00.part",
          "chunk_01.part",
          "chunk_02.part",
          "chunk_03.part",
          "3",
          "3",
          "3",
          "1",
          "10",
          "REASSEMBLED_EXACT",
          "",
        ].join("\n"),
      );
    });
  });

  it("10. split -b byte chunks on binary/text data and reassembly verification", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "0123456789abcdefghijklmnopqrstuvwxyz" > raw.bin
        split -b 10 -d raw.bin bpart_
        ls -1 bpart_* | sort | xargs -n 1 wc -c | awk '{print $1, $2}'
        cat bpart_* > joined.bin
        cmp -s raw.bin joined.bin && echo "BYTES_INTACT"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "10 bpart_00",
          "10 bpart_01",
          "10 bpart_02",
          "6 bpart_03",
          "BYTES_INTACT",
          "",
        ].join("\n"),
      );
    });
  });

  it("11. csplit context splitting by regex (/pattern/), repeat count ({*}), custom prefix (-f), and width (-n)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/doc.md": [
            "preamble",
            "## Section 1",
            "body 1a",
            "body 1b",
            "## Section 2",
            "body 2a",
            "## Section 3",
            "body 3a",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(`
          csplit -s -z -f sec_ -n 2 doc.md '/^## Section/' '{*}'
          ls -1 sec_* | sort
          head -n 1 sec_00 sec_01 sec_02 sec_03
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(
          r.stdout,
          [
            "sec_00",
            "sec_01",
            "sec_02",
            "sec_03",
            "==> sec_00 <==",
            "preamble",
            "",
            "==> sec_01 <==",
            "## Section 1",
            "",
            "==> sec_02 <==",
            "## Section 2",
            "",
            "==> sec_03 <==",
            "## Section 3",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("12. yes bounded by head in a pipeline and custom string repetition", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        yes | head -n 4
        yes "ack" | head -n 3
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "y\ny\ny\ny\nack\nack\nack\n");
    });
  });

  it("13. expr arithmetic, comparisons, string length/substr/index, and anchored regex match (:)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        expr 14 + 28 \\* 2
        expr "release-v2.4.9" : 'release-v\\([0-9.]*\\)'
        expr length "safe-bash-rust"
        expr substr "safe-bash-rust" 6 4
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "70\n2.4.9\n14\nbash\n");
    });
  });

  it("14. numfmt human-readable IEC/SI unit conversion (--to=iec, --to=si, --from=iec, --padding)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        numfmt --to=iec 1048576
        numfmt --to=si 1000000
        numfmt --from=iec 64K
        printf "1024\\n1048576\\n" | numfmt --to=iec-i --suffix=B
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1.0M\n1.0M\n65536\n1.0KiB\n1.0MiB\n");
    });
  });

  it("15. envsubst template expansion with selective variable whitelist and -v listing", async () => {
    await withE2EHarness(
      {
        env: {
          SERVICE_NAME: "api-gateway",
          SERVICE_PORT: "8443",
          UNTOUCHED_VAR: "keep_literal",
        },
        files: {
          "/workspace/nginx.conf.tmpl": "server_name ${SERVICE_NAME};\nlisten $SERVICE_PORT;\nraw ${UNTOUCHED_VAR};\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          envsubst '\${SERVICE_NAME} $SERVICE_PORT' < nginx.conf.tmpl
          echo "---"
          envsubst -v '\${SERVICE_NAME} $SERVICE_PORT'
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(
          r.stdout,
          [
            "server_name api-gateway;",
            "listen 8443;",
            "raw ${UNTOUCHED_VAR};",
            "---",
            "SERVICE_NAME",
            "SERVICE_PORT",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("16. bc arbitrary-precision calculator with scale, ibase/obase radix conversion, and user functions", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        bc <<'CALC'
scale=6
22 / 7
define fact(n) {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
fact(10)
obase=16
255
CALC
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "3.142857\n3628800\nFF\n");
    });
  });

  it("17. factor prime factorization and tsort topological ordering of DAG dependencies", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        factor 120 97
        echo "---"
        printf "compile link\\nparse compile\\nlex parse\\nlink package\\n" | tsort
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "120: 2 2 2 3 5",
          "97: 97",
          "---",
          "lex",
          "parse",
          "compile",
          "link",
          "package",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. getopt short and long option canonicalization with operand separation (--)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        getopt -o ab:c --long alpha,beta:,gamma -- -ac -b "hello" pos1 --beta world pos2
      `);
      assert.equal(r.exitCode, 0);
      assert.match(r.stdout.trim(), /^-a -c -b '?hello'? --beta '?world'? -- '?pos1'? '?pos2'?$/);
    });
  });

  it("19. cal calendar rendering for leap-year February 2024 vs non-leap February 2023", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        cal 2 2024 | grep -q '29' && echo "FEB_2024_HAS_29"
        cal 2 2023 | grep -q '29' && echo "FEB_2023_HAS_29" || echo "FEB_2023_NO_29"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "FEB_2024_HAS_29\nFEB_2023_NO_29\n");
    });
  });

  it("20. sponge in-place file filtering pipeline combined with seq, shuf, sort, and awk", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        seq 1 20 > numbers.txt
        awk '$1 % 2 == 0 { print $1 * 10 }' numbers.txt | sort -nr | head -n 5 | sponge numbers.txt
        cat numbers.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "200\n180\n160\n140\n120\n");
    });
  });
});
