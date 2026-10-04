import assert from "node:assert/strict";
import test from "node:test";
import { createObservabilityLogsFixture, createRelationalCsvFixture } from "./fixtures.js";
import { withE2EHarness } from "./harness.js";

test("awk multi-file NR==FNR hash join and aggregation across relational CSVs", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "awk -F',' '",
      "  FNR == 1 { next }",
      "  FILENAME ~ /products\\.csv$/ { price[$1] = $4 + 0; next }",
      "  FILENAME ~ /customers\\.csv$/ { cname[$1] = $2; tier[$1] = $3; next }",
      "  FILENAME ~ /orders\\.csv$/ {",
      "    if ($5 == \"completed\") {",
      "      rev[$2] += ($4 + 0) * price[$3]",
      "      orders[$2]++",
      "    }",
      "  }",
      "  END {",
      "    for (c in rev) {",
      "      printf \"%s|%s|%d|%.2f\\n\", c, cname[c], orders[c], rev[c]",
      "    }",
      "  }",
      "' /workspace/data/products.csv /workspace/data/customers.csv /workspace/data/orders.csv | sort",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "c1|Alice Vance|2|1355.00",
        "c2|Bob Tanaka|2|810.00",
        "c3|Clara Oswald|1|600.00",
        "c5|Elena Rostova|1|320.00",
        "",
      ].join("\n"),
    );
  });
});

test("awk user-defined functions, string manipulation (split, gsub, substr, sprintf), and math", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "awk -F'|' '",
      "  function normalize_slug(s,    n, parts, i, out) {",
      "    s = tolower(s)",
      "    gsub(/[^a-z0-9]+/, \"-\", s)",
      "    sub(/^-+/, \"\", s)",
      "    sub(/-+$/, \"\", s)",
      "    n = split(s, parts, \"-\")",
      "    out = \"\"",
      "    for (i = 1; i <= n; i++) {",
      "      out = (i == 1 ? parts[i] : out \"_\" parts[i])",
      "    }",
      "    return out",
      "  }",
      "  function clamp(val, lo, hi) {",
      "    return val < lo ? lo : (val > hi ? hi : val)",
      "  }",
      "  {",
      "    slug = normalize_slug($1)",
      "    score = clamp($2 + 0, 0, 100)",
      "    printf \"%s:%03d:%d\\n\", substr(slug, 1, 12), score, int(sqrt(score))",
      "  }",
      "' <<'EOF'",
      "  --Hello, World!!-- | 144",
      "Foo::Bar::Baz_Qux    | 64",
      "Negative_Entry       | -25",
      "EOF",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "hello_world:100:10",
        "foo_bar_baz_:064:8",
        "negative_ent:000:0",
        "",
      ].join("\n"),
    );
  });
});

test("awk range patterns (/START/,/END/) and custom record/field separators (RS, FS, OFS)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "awk '",
      "  /BEGIN_SECTION/,/END_SECTION/ {",
      "    if ($0 !~ /BEGIN_SECTION|END_SECTION/) print $0",
      "  }",
      "' <<'EOF'",
      "noise_before",
      "BEGIN_SECTION",
      "keep_alpha",
      "keep_beta",
      "END_SECTION",
      "noise_middle",
      "BEGIN_SECTION",
      "keep_gamma",
      "END_SECTION",
      "noise_after",
      "EOF",
    ].join("\n");

    await h.expectOk(
      script,
      ["keep_alpha", "keep_beta", "keep_gamma", ""].join("\n"),
    );
  });
});

test("sed hold-space state machine joining backslash-continued lines and reversing line order", async () => {
  await withE2EHarness(async (h) => {
    const joinScript = [
      "sed -E ':loop; /\\\\$/ { N; s/[[:space:]]*\\\\\\n[[:space:]]*/ /; b loop }' <<'EOF'",
      "SELECT id, \\",
      "  name, \\",
      "  tier",
      "FROM customers",
      "WHERE active = 1 \\",
      "  AND country = 'US';",
      "EOF",
    ].join("\n");

    await h.expectOk(
      joinScript,
      [
        "SELECT id, name, tier",
        "FROM customers",
        "WHERE active = 1 AND country = 'US';",
        "",
      ].join("\n"),
    );

    // Classic sed tac (reverse lines via hold space: 1!G; h; $!d)
    const reverseScript = [
      "sed '1!G;h;$!d' <<'EOF'",
      "first",
      "second",
      "third",
      "fourth",
      "EOF",
    ].join("\n");

    await h.expectOk(
      reverseScript,
      ["fourth", "third", "second", "first", ""].join("\n"),
    );
  });
});

test("sed address ranges, transliteration (y///), insert/append/change, and backreferences", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sed -E \\",
      "  -e 'y/aeiou/AEIOU/' \\",
      "  -e 's/^([a-zA-Z]+)=([0-9]+)$/\\2:\\1/' \\",
      "  -e '2i\\--- inserted_before_2 ---' \\",
      "<<'EOF'",
      "alpha=10",
      "beta=20",
      "gamma=30",
      "EOF",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "10:AlphA",
        "--- inserted_before_2 ---",
        "20:bEtA",
        "30:gAmmA",
        "",
      ].join("\n"),
    );
  });
});

test("join relational operation with outer join (-a), missing fill (-e), and output format (-o)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/users.txt": [
          "u1 Alice",
          "u2 Bob",
          "u3 Carol",
          "u4 Dave",
          "",
        ].join("\n"),
        "/workspace/quotas.txt": [
          "u1 500",
          "u3 1200",
          "u5 900",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "join -a 1 -e 'NONE' -o '0,1.2,2.2' /workspace/users.txt /workspace/quotas.txt",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "u1 Alice 500",
          "u2 Bob NONE",
          "u3 Carol 1200",
          "u4 Dave NONE",
          "",
        ].join("\n"),
      );
    },
  );
});

test("sort multi-key (-k), numeric (-n), version (-V), and human-readable (-h) sorting", async () => {
  await withE2EHarness(async (h) => {
    const versionScript = [
      "printf 'v1.10.0\\nv1.2.0\\nv1.2.10\\nv1.2.3\\nv2.0.0\\n' | sort -V | paste -sd ',' -",
    ].join("\n");
    await h.expectOk(versionScript, "v1.2.0,v1.2.3,v1.2.10,v1.10.0,v2.0.0\n");

    const humanScript = [
      "printf '10G\\n500K\\n2M\\n1T\\n100\\n' | sort -h | paste -sd ',' -",
    ].join("\n");
    await h.expectOk(humanScript, "100,500K,2M,10G,1T\n");

    const multiKeyScript = [
      "sort -t ':' -k2,2nr -k1,1 <<'EOF'",
      "charlie:50",
      "alice:100",
      "bob:50",
      "dave:100",
      "EOF",
    ].join("\n");
    await h.expectOk(
      multiKeyScript,
      ["alice:100", "dave:100", "bob:50", "charlie:50", ""].join("\n"),
    );
  });
});

test("uniq duplicate filtering (-c, -d, -u, -i) on log stream", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "cat <<'EOF' > /workspace/items.txt",
      "apple",
      "Apple",
      "banana",
      "cherry",
      "cherry",
      "date",
      "EOF",
      "dups=$(uniq -i -d /workspace/items.txt | tr 'A-Z' 'a-z' | paste -sd ',' -)",
      "uniq_only=$(uniq -i -u /workspace/items.txt | paste -sd ',' -)",
      'echo "dups=$dups|uniq_only=$uniq_only"',
    ].join("\n");

    await h.expectOk(script, "dups=apple,cherry|uniq_only=banana,date\n");
  });
});

test("cut field/character extraction and paste matrix transposition", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "cat <<'EOF' > /workspace/matrix.csv",
      "id,name,role,dept",
      "1,alice,eng,core",
      "2,bob,pm,growth",
      "3,carol,eng,infra",
      "EOF",
      "cut -d',' -f2,4 /workspace/matrix.csv | paste -sd ';' -",
    ].join("\n");

    await h.expectOk(script, "name,dept;alice,core;bob,growth;carol,infra\n");
  });
});

test("tr character classes, deletion (-d), and squeeze-repeats (-s)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf '  Hello   123   WORLD!!  \\n' \\",
      "  | tr '[:upper:]' '[:lower:]' \\",
      "  | tr -d '[:digit:]!' \\",
      "  | tr -s ' ' \\",
      "  | sed 's/^ //; s/ $//'",
    ].join("\n");

    await h.expectOk(script, "hello world\n");
  });
});

test("column -t table alignment from delimited data", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "column -t -s '|' <<'EOF' | sed 's/  \\+/|/g'",
      "NAME|ROLE|REGION",
      "alice|principal-engineer|us-east-1",
      "bob|sre|eu-west-1",
      "EOF",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "NAME|ROLE|REGION",
        "alice|principal-engineer|us-east-1",
        "bob|sre|eu-west-1",
        "",
      ].join("\n"),
    );
  });
});

test("nl line numbering with formatting (-ba, -nrz, -w, -s), tac, and rev", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'ab\\n\\ncd\\n' | nl -ba -nrz -w3 -s':'",
      "printf 'one\\ntwo\\nthree\\n' | tac | rev | paste -sd ',' -",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "001:ab",
        "002:",
        "003:cd",
        "eerht,owt,eno",
        "",
      ].join("\n"),
    );
  });
});

test("fold (-w -s) and fmt (-w) paragraph wrapping and reflowing", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'the quick brown fox jumps over the lazy dog\\n' | fold -s -w 16",
      "echo '---'",
      "printf 'short\\nlines\\nhere\\nand\\nthere\\n' | fmt -w 20",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "the quick brown ",
        "fox jumps over ",
        "the lazy dog",
        "---",
        "short lines here",
        "and there",
        "",
      ].join("\n"),
    );
  });
});

test("expand and unexpand tab/space conversion round-trip", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'a\\tb\\tc\\n' | expand -t 4 > /workspace/expanded.txt",
      "cat /workspace/expanded.txt | tr ' ' '.'",
      "unexpand -a -t 4 /workspace/expanded.txt | od -An -tx1 | tr -s ' ' | sed 's/^ //; s/ $//'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "a...b...c",
        "61 09 62 09 63 0a",
        "",
      ].join("\n"),
    );
  });
});

test("split and csplit file chunking and reassembly with sha256 verification", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "seq 1 25 > /workspace/seq25.txt",
      "mkdir -p /workspace/chunks",
      "split -l 10 /workspace/seq25.txt /workspace/chunks/part_",
      "ls /workspace/chunks | sort | paste -sd ',' -",
      "cat /workspace/chunks/part_* > /workspace/reassembled.txt",
      "cmp -s /workspace/seq25.txt /workspace/reassembled.txt && echo 'split_reassembled:ok'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "part_aa,part_ab,part_ac",
        "split_reassembled:ok",
        "",
      ].join("\n"),
    );
  });
});

test("csplit splits multi-section markdown document by heading regex", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/doc.md": [
          "preamble line",
          "## Section One",
          "body 1a",
          "body 1b",
          "## Section Two",
          "body 2a",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "cd /workspace",
        "csplit -s -f sec_ doc.md '/^## /' '{*}'",
        "ls sec_* | sort | paste -sd ',' -",
        "head -n 1 sec_01 sec_02",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "sec_00,sec_01,sec_02",
          "==> sec_01 <==",
          "## Section One",
          "",
          "==> sec_02 <==",
          "## Section Two",
          "",
        ].join("\n"),
      );
    },
  );
});

test("tsort topological ordering of DAG edges", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "tsort <<'EOF'",
      "compile_core compile_api",
      "compile_api compile_cli",
      "compile_cli package_release",
      "lint compile_core",
      "EOF",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "lint",
        "compile_core",
        "compile_api",
        "compile_cli",
        "package_release",
        "",
      ].join("\n"),
    );
  });
});

test("shuf permutation preserves exact multiset of elements and respects -n", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "seq 1 20 | shuf | sort -n | paste -sd ',' -",
      "seq 1 100 | shuf -n 5 | wc -l | tr -d ' '",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20",
        "5",
        "",
      ].join("\n"),
    );
  });
});

test("pr paginates and formats multi-column text with custom header (-h) and omit-pagination (-T)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "seq 1 6 | pr -2 -T -s':'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "1:4",
        "2:5",
        "3:6",
        "",
      ].join("\n"),
    );
  });
});

test("combined access.log analytics pipeline with awk, sort, uniq, and sed", async () => {
  await withE2EHarness({ files: createObservabilityLogsFixture() }, async (h) => {
    const script = [
      "awk '{",
      "  status = $9",
      "  latency = $11 + 0",
      "  count[status]++",
      "  total_lat[status] += latency",
      "} END {",
      "  for (s in count) {",
      "    printf \"%s count=%d avg_ms=%.1f\\n\", s, count[s], total_lat[s] / count[s]",
      "  }",
      "}' /workspace/logs/access.log | sort",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "200 count=4 avg_ms=12.0",
        "201 count=2 avg_ms=43.5",
        "401 count=1 avg_ms=6.0",
        "500 count=2 avg_ms=360.0",
        "503 count=1 avg_ms=520.0",
        "",
      ].join("\n"),
    );
  });
});
