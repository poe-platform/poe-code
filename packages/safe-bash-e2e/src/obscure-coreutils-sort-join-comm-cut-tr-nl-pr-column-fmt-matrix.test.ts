import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("obscure coreutils sort, join, comm, cut, tr, nl, column, fmt, fold, expand, and split matrix", () => {
  it("1. handles sort multi-key sorting with -t, -k1,1, -k2,2nr (reverse numeric), and -k3,3V (version)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' | sort -t ':' -k1,1 -k2,2nr -k3,3V
beta:10:v1.2
alpha:5:v1.10
alpha:20:v1.2
alpha:5:v1.2
beta:10:v1.10
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "alpha:20:v1.2\nalpha:5:v1.2\nalpha:5:v1.10\nbeta:10:v1.2\nbeta:10:v1.10\n"
      );
    });
  });

  it("2. handles sort -h (human-numeric) and sort -M (month sort)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "4M\n512\n2G\n12K\n" | sort -h | paste -sd ',' -
        printf "NOV\nFEB\nJAN\nDEC\n" | sort -M | paste -sd ',' -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "512,12K,4M,2G\nJAN,FEB,NOV,DEC\n");
    });
  });

  it("3. handles sort -c / -C (check sorted) and sort -m (merge pre-sorted files)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "10\n20\n30\n" > a.txt
        printf "15\n25\n35\n" > b.txt
        if sort -n -C a.txt; then echo "A_SORTED"; fi
        printf "20\n10\n" > bad.txt
        if sort -n -C bad.txt 2>/dev/null; then echo "BAD_SORTED"; else echo "BAD_UNSORTED"; fi
        sort -n -m a.txt b.txt | paste -sd ',' -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "A_SORTED\nBAD_UNSORTED\n10,15,20,25,30,35\n");
    });
  });

  it("4. handles uniq with -c (count), -d (duplicates), -u (unique), -i (case-insensitive), and -f/-s", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > items.txt
id1 apple
id2 APPLE
id3 banana
id4 cherry
id5 CHERRY
EOF
        uniq -f 1 -i -d items.txt
        echo "---"
        uniq -f 1 -i -u items.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "id1 apple\nid4 cherry\n---\nid3 banana\n");
    });
  });

  it("5. handles join relational inner, full outer (-a 1 -a 2), and anti-join (-v 1) with -e and -o", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > users.csv
1,alice
2,bob
3,carol
EOF
        cat <<'EOF' > roles.csv
1,admin
3,editor
4,guest
EOF
        join -t ',' -a 1 -a 2 -e 'NONE' -o 0,1.2,2.2 users.csv roles.csv
        echo "---"
        join -t ',' -v 1 users.csv roles.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "1,alice,admin\n2,bob,NONE\n3,carol,editor\n4,NONE,guest\n---\n2,bob\n"
      );
    });
  });

  it("6. handles comm set intersection (-12), left diff (-23), right diff (-13), and --output-delimiter", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "alpha\nbeta\ngamma\n" > s1.txt
        printf "beta\ndelta\ngamma\n" > s2.txt
        comm -12 s1.txt s2.txt | paste -sd ',' -
        comm -23 s1.txt s2.txt
        comm -13 s1.txt s2.txt
        comm --output-delimiter='|' s1.txt s2.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "beta,gamma\nalpha\ndelta\nalpha\n||beta\n|delta\n||gamma\n"
      );
    });
  });

  it("7. handles cut field ranges (-f 1,3-), --complement, --output-delimiter, and -s", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > lines.txt
a:b:c:d
no_delim_line
e:f:g:h
EOF
        cut -d ':' -f 1,3- --output-delimiter='->' -s lines.txt
        echo "---"
        cut -d ':' --complement -f 2 -s lines.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "a->c->d\ne->g->h\n---\na:c:d\ne:g:h\n");
    });
  });

  it("8. handles paste multi-file cyclic delimiters (-d ':,') and serial mode (-s)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "k1\nk2\n" > c1.txt
        printf "v1\nv2\n" > c2.txt
        printf "x1\nx2\n" > c3.txt
        paste -d ':,' c1.txt c2.txt c3.txt
        paste -s -d '-' c1.txt c2.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "k1:v1,x1\nk2:v2,x2\nk1-k2\nv1-v2\n");
    });
  });

  it("9. handles tr POSIX classes, -d delete, -s squeeze repeats, and -c complement", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "Hello   123   World!!!\n" | tr '[:lower:]' '[:upper:]' | tr -s ' !'
        printf "abc-123-xyz-456\n" | tr -cd '[:digit:]-'
        echo ""
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "HELLO 123 WORLD!\n-123--456\n");
    });
  });

  it("10. handles nl line numbering with -ba, -bt, -n rz, -w, -s, -v, and -i", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "first\n\nsecond\n" | nl -bt -n rz -w 3 -s ': ' -v 10 -i 5
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "010: first\n     \n015: second\n");
    });
  });

  it("11. handles fold (-w, -s word wrap) and fmt (-w paragraph reflow)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "alpha beta gamma delta epsilon\n" | fold -s -w 12
        echo "---"
        printf "short\nlines\nhere\n\nnext\npara\n" | fmt -w 20
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "alpha beta \ngamma delta \nepsilon\n---\nshort lines here\n\nnext para\n"
      );
    });
  });

  it("12. handles column -t with input separator -s and output separator -o", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' | column -t -s ',' -o ' | '
name,role,score
alice,engineer,100
bob,qa,95
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "name  | role     | score\nalice | engineer | 100\nbob   | qa       | 95\n"
      );
    });
  });

  it("13. handles expand (-t 4) and unexpand (-a -t 4) tab/space conversion round-trip", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "a\tb\tc\n" | expand -t 4 | tr ' ' '.'
        printf "a   b   c\n" | unexpand -a -t 4 | tr '\t' '>'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "a...b...c\na>b>c\n");
    });
  });

  it("14. handles head and tail negative/positive line and byte offsets (-n -2, -n +3, -c)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        seq 1 5 | head -n -2 | paste -sd ',' -
        seq 1 5 | tail -n +3 | paste -sd ',' -
        printf "abcdefgh" | head -c 4
        echo ""
        printf "abcdefgh" | tail -c 3
        echo ""
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1,2,3\n3,4,5\nabcd\nfgh\n");
    });
  });

  it("15. handles wc line, word, byte, char, and max-line-length (-l, -w, -c, -m, -L)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "hello world\nsupercalifragilistic\nhi\n" > sample.txt
        wc -l < sample.txt | tr -d ' '
        wc -w < sample.txt | tr -d ' '
        wc -L < sample.txt | tr -d ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "3\n4\n20\n");
    });
  });

  it("16. handles rev and tac character and line reversal round-trip", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "first:1\nsecond:2\nthird:3\n" | tac | rev
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "3:driht\n2:dnoces\n1:tsrif\n");
    });
  });

  it("17. handles seq with format (-f), separator (-s), and equal-width (-w)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        seq -f "node-%02g" -s "," 1 3
        seq -w -s ":" 8 2 12
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "node-01,node-02,node-03\n08:10:12\n");
    });
  });

  it("18. handles shuf with range (-i), echo (-e), head count (-n), and set preservation", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        shuf -i 1-5 | sort -n | paste -sd ',' -
        shuf -e red green blue | sort | paste -sd ',' -
        shuf -i 10-99 -n 3 | wc -l | tr -d ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1,2,3,4,5\nblue,green,red\n3\n");
    });
  });

  it("19. handles split (-l, -d, -a, --additional-suffix) and csplit regex section splitting", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        seq 1 5 > nums.txt
        split -l 2 -d -a 2 --additional-suffix=.part nums.txt chunk_
        ls chunk_*.part | sort | paste -sd ',' -
        cat chunk_02.part
        cat <<'EOF' > doc.txt
intro line
===
section one
===
section two
EOF
        csplit -s -f sec_ -n 2 doc.txt '/^===$/' '{*}'
        cat sec_01
        cat sec_02
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "chunk_00.part,chunk_01.part,chunk_02.part\n5\n===\nsection one\n===\nsection two\n"
      );
    });
  });

  it("20. executes an end-to-end log pipeline: cut -> sort -> uniq -c -> awk -> join -> column -t", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > access.log
2026-10-06T10:00:01Z|u1|200
2026-10-06T10:00:02Z|u2|500
2026-10-06T10:00:03Z|u1|200
2026-10-06T10:00:04Z|u3|404
2026-10-06T10:00:05Z|u1|200
2026-10-06T10:00:06Z|u2|200
EOF
        cat <<'EOF' > users.txt
u1:Alice
u2:Bob
u3:Carol
EOF
        cut -d '|' -f 2 access.log | sort | uniq -c | awk '{print $2 ":" $1}' | sort -t ':' -k1,1 > counts.txt
        join -t ':' users.txt counts.txt | column -t -s ':' -o ' | '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "u1 | Alice | 3\nu2 | Bob   | 2\nu3 | Carol | 1\n"
      );
    });
  });
});
