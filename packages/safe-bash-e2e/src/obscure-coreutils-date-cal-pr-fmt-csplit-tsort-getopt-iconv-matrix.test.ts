import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure coreutils date, cal, pr, fmt, fold, csplit, split, tsort, getopt, iconv, dos2unix, binary & formatting matrix", () => {
  it("01: formats UTC timestamps via date -u -d @epoch (+%Y-%m-%d %H:%M:%S %u %j) and parses ISO-8601 to epoch", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        d1=$(date -u -d "@1709164800" "+%Y-%m-%d %H:%M:%S %u %j")
        d2=$(date -u -d "2024-02-29T00:00:00Z" "+%s")
        echo "$d1|$d2"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2024-02-29 00:00:00 4 060|1709164800");
    });
  });

  it("02: renders leap-year February 2024 vs non-leap February 2023 calendars with cal", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        has29_2024=$(cal 2 2024 | grep -c "29" || true)
        has29_2023=$(cal 2 2023 | grep -c "29" || true)
        echo "2024=$has29_2024|2023=$has29_2023"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2024=1|2023=0");
    });
  });

  it("03: formats multi-column text streams with pr -2 -t", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "a\\nb\\nc\\nd\\n" | pr -2 -t | tr -s " \\t" ":"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a:c\nb:d");
    });
  });

  it("04: wraps paragraphs to target width with fmt -w while preserving paragraph breaks", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "The quick brown fox jumps over the lazy dog.\\n\\nSecond short paragraph here.\\n" | fmt -w 20
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "The quick brown\nfox jumps over the\nlazy dog.\n\nSecond short\nparagraph here.",
      );
    });
  });

  it("05: folds long lines at word boundaries using fold -w -s", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "alpha beta gamma delta\\n" | fold -w 11 -s
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha beta \ngamma delta");
    });
  });

  it("06: splits multi-section documents by regex marker with csplit -s -f -b '{*}'", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "sec1\\n---\\nsec2\\n---\\nsec3\\n" > /workspace/doc.txt
        csplit -s -f /workspace/part_ -b "%02d.txt" /workspace/doc.txt "/^---$/" "{*}"
        ls /workspace/part_*.txt | wc -l | tr -d " "
        cat /workspace/part_00.txt
        cat /workspace/part_02.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3\nsec1\n---\nsec3");
    });
  });

  it("07: splits files by line count with numeric suffixes via split -l 2 -d -a 2", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "1\\n2\\n3\\n4\\n5\\n" > /workspace/lines.txt
        split -l 2 -d -a 2 /workspace/lines.txt /workspace/chunk_
        for f in /workspace/chunk_*; do
          echo "$(basename "$f"):$(paste -sd "," "$f")"
        done
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "chunk_00:1,2\nchunk_01:3,4\nchunk_02:5");
    });
  });

  it("08: computes topological ordering of a dependency DAG with tsort", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "compile link\\nparse compile\\nlex parse\\nlink package\\n" | tsort | paste -sd ":" -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "lex:parse:compile:link:package");
    });
  });

  it("09: normalizes short and long CLI options and positional arguments with getopt", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        parsed=$(getopt -o ab: --long alpha,beta: -- -a --beta val1 pos1 --alpha pos2)
        echo "$parsed"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "-a --beta 'val1' --alpha -- 'pos1' 'pos2'");
    });
  });

  it("10: transcodes text between UTF-8 and ISO-8859-1 with iconv and verifies byte sequences", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "café" | iconv -f UTF-8 -t ISO-8859-1 | xxd -p
        printf "café" | iconv -f UTF-8 -t ISO-8859-1 | iconv -f ISO-8859-1 -t UTF-8
        echo ""
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "636166e9\ncafé");
    });
  });

  it("11: converts line endings round-trip via unix2dos and dos2unix with hex verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "line1\\nline2\\n" > /workspace/lf.txt
        unix2dos /workspace/lf.txt
        crlf_hex=$(xxd -p < /workspace/lf.txt | tr -d "\\n")
        dos2unix /workspace/lf.txt
        lf_hex=$(xxd -p < /workspace/lf.txt | tr -d "\\n")
        echo "$crlf_hex|$lf_hex"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "6c696e65310d0a6c696e65320d0a|6c696e65310a6c696e65320a");
    });
  });

  it("12: inspects binary payloads with xxd -r -p, od -An -tx1, and hexdump -C with grep -o", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "48656c6c6f0a" | xxd -r -p > /workspace/bin.dat
        od_hex=$(od -An -tx1 /workspace/bin.dat | tr -s " \\n" " " | sed "s/^ //;s/ $//")
        hd_line=$(hexdump -C /workspace/bin.dat | head -n 1 | grep -o "|Hello.|")
        echo "$od_hex|$hd_line"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "48 65 6c 6c 6f 0a||Hello.|");
    });
  });

  it("13: extracts printable ASCII runs of minimum length from binary blobs via strings -n", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "000041420048656c6c6f576f726c6400585900527573745368656c6c00" | xxd -r -p > /workspace/blob.bin
        strings -n 5 /workspace/blob.bin | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "HelloWorld,RustShell");
    });
  });

  it("14: shrinks and extends files with truncate -s exact and relative sizes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "0123456789" > /workspace/trunc.dat
        s0=$(wc -c < /workspace/trunc.dat | tr -d " ")
        truncate -s 6 /workspace/trunc.dat
        s1=$(wc -c < /workspace/trunc.dat | tr -d " ")
        truncate -s +4 /workspace/trunc.dat
        s2=$(wc -c < /workspace/trunc.dat | tr -d " ")
        echo "$s0->$s1->$s2 content=$(tr -d "\\0" < /workspace/trunc.dat)"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "10->6->10 content=012345");
    });
  });

  it("15: validates portable POSIX paths and rejects non-portable characters via pathchk -p", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        pathchk -p "valid_dir/file-01.txt" && echo "valid=ok"
        if pathchk -p "bad:file*name" 2>/dev/null; then
          echo "invalid=unexpected"
        else
          echo "invalid=rejected"
        fi
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "valid=ok\ninvalid=rejected");
    });
  });

  it("16: converts human-readable numbers across IEC and SI scales with numfmt", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        a=$(numfmt --to=iec 1048576)
        b=$(numfmt --to=si 1000000)
        c=$(numfmt --from=iec 2K)
        echo "$a|$b|$c"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1.0M|1.0M|2048");
    });
  });

  it("17: computes prime factorizations with factor and evaluates string/arithmetic expressions with expr", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        fac=$(factor 360)
        len=$(expr length "safe-bash")
        sub=$(expr substr "safe-bash" 6 4)
        math=$(expr 14 \\* 3 + 2)
        echo "$fac|len=$len|sub=$sub|math=$math"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "360: 2 2 2 3 3 5|len=9|sub=bash|math=44");
    });
  });

  it("18: generates formatted numeric sequences via seq -w, -f, and -s", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        s1=$(seq -w -s ":" 8 10)
        s2=$(seq -f "v%02g" -s "," 1 2 5)
        echo "$s1|$s2"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "08:09:10|v01,v03,v05");
    });
  });

  it("19: substitutes only whitelisted environment variables with envsubst", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        export SERVICE="api-gw" PORT="8443" SECRET="keep-hidden"
        printf 'host=$SERVICE:$PORT token=$SECRET\\n' | envsubst '$SERVICE $PORT'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "host=api-gw:8443 token=$SECRET");
    });
  });

  it("20: updates files in-place at the end of a pipeline without truncation via sponge", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "gamma\\nalpha\\nbeta\\n" > /workspace/items.txt
        sort /workspace/items.txt | tr "a-z" "A-Z" | sponge /workspace/items.txt
        paste -sd "," /workspace/items.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ALPHA,BETA,GAMMA");
    });
  });
});
