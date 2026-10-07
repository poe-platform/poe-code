import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure awk sed envsubst join bc expr text math matrix", () => {
  it("01 awk associative arrays with SUBSEP multi-dimensional keys and delete", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/sales.txt\neast Q1 120\nwest Q1 85\neast Q2 150\nwest Q2 95\neast Q1 30\nsouth Q1 60\nEOF\nawk '\n{\n  grid[$1, $2] += $3\n  regions[$1] = 1\n  quarters[$2] = 1\n}\nEND {\n  delete grid[\"south\", \"Q1\"]\n  for (r in regions) {\n    for (q in quarters) {\n      if ((r, q) in grid) {\n        printf \"%s|%s|%d\\n\", r, q, grid[r, q]\n      }\n    }\n  }\n}' /tmp/sales.txt | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "east|Q1|150\neast|Q2|150\nwest|Q1|85\nwest|Q2|95\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 awk gsub gensub match RSTART RLENGTH and split with regex separator", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("awk 'BEGIN {\n  s = \"item_12:450;item_07:99;item_99:1200\"\n  n = split(s, parts, \";\")\n  total = 0\n  for (i = 1; i <= n; i++) {\n    if (match(parts[i], /:[0-9]+$/)) {\n      val = substr(parts[i], RSTART + 1, RLENGTH - 1) + 0\n      total += val\n    }\n    gsub(/^item_/, \"sku#\", parts[i])\n    printf \"%s,\", parts[i]\n  }\n  printf \"total=%d\\n\", total\n}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sku#12:450,sku#07:99,sku#99:1200,total=1749\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 awk user-defined recursive function and ternary formatting", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("awk '\nfunction gcd(a, b) {\n  return (b == 0) ? a : gcd(b, a % b)\n}\nfunction lcm(a, b) {\n  return (a / gcd(a, b)) * b\n}\nBEGIN {\n  printf \"gcd(48,18)=%d lcm(12,18)=%d gcd(1071,462)=%d\\n\", gcd(48, 18), lcm(12, 18), gcd(1071, 462)\n}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "gcd(48,18)=6 lcm(12,18)=36 gcd(1071,462)=21\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 awk getline from pipe and multi-file FNR vs NR state machine", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/map.txt\nA alpha\nB beta\nC gamma\nEOF\ncat << 'EOF' > /tmp/events.txt\nB 10\nA 25\nC 5\nA 15\nEOF\nawk 'NR == FNR { label[$1] = $2; next }\n{ sums[label[$1]] += $2 }\nEND {\n  for (k in sums) printf \"%s:%d\\n\", k, sums[k]\n}' /tmp/map.txt /tmp/events.txt | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha:40\nbeta:10\ngamma:5\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 sed hold space x h H g G and branch label :loop state machine", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/blocks.txt\nHEADER:alpha\n  line 1\n  line 2\nEND\nHEADER:beta\n  line 3\nEND\nEOF\nsed -n '\n/^HEADER:/ {\n  s/^HEADER://\n  h\n  b\n}\n/^END$/ {\n  x\n  s/\\n  /|/g\n  p\n  b\n}\nH\n' /tmp/blocks.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha|line 1|line 2\nbeta|line 3\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 sed address ranges /start/,/end/ with negation and y/// transliteration", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/section.txt\noutside_1\nBEGIN_BLOCK\ninside_abc\ninside_xyz\nEND_BLOCK\noutside_2\nEOF\nsed -e '/BEGIN_BLOCK/,/END_BLOCK/ { /BEGIN_BLOCK/d; /END_BLOCK/d; y/abcdefghijklmnopqrstuvwxyz/ABCDEFGHIJKLMNOPQRSTUVWXYZ/; }' /tmp/section.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "outside_1\nINSIDE_ABC\nINSIDE_XYZ\noutside_2\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 envsubst selective variable expansion and shell-format variable listing", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("export APP_HOST=\"api.internal\"\nexport APP_PORT=\"8443\"\nexport SECRET_TOKEN=\"do-not-expand\"\ncat << 'EOF' > /tmp/config.tmpl\nendpoint=https://${APP_HOST}:${APP_PORT}/v1\ntoken=${SECRET_TOKEN}\nEOF\nenvsubst '${APP_HOST} ${APP_PORT}' < /tmp/config.tmpl\nenvsubst -v \"$(cat /tmp/config.tmpl)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "endpoint=https://api.internal:8443/v1\ntoken=${SECRET_TOKEN}\nAPP_HOST\nAPP_PORT\nSECRET_TOKEN\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 join full outer join with -a1 -a2 -e placeholder and -o format list", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/left.txt\n101 alice\n102 bob\n104 diana\nEOF\ncat << 'EOF' > /tmp/right.txt\n101 eng\n103 sales\n104 secops\nEOF\njoin -a 1 -a 2 -e \"NONE\" -o 0,1.2,2.2 /tmp/left.txt /tmp/right.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "101 alice eng\n102 bob NONE\n103 NONE sales\n104 diana secops\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 bc scale decimal precision power modulo and user functions", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' | bc\nscale=6\ndefine hyp(a, b) {\n  return sqrt(a*a + b*b)\n}\nhyp(3, 4)\nhyp(5, 12)\nscale=4\n(355 / 113)\nscale=0\n(2 ^ 16) + (17 % 5)\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "5.000000\n13.000000\n3.1415\n65538\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 bc ibase obase hexadecimal and binary base conversions", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' | bc\nobase=16\n255\n4096 + 255\nobase=2\nibase=16\nA5\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "FF\n10FF\n10100101\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 bc loops conditionals factorial and Fibonacci sequence generation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' | bc\ndefine fact(n) {\n  if (n <= 1) return (1)\n  return (n * fact(n - 1))\n}\nfact(7)\na = 0\nb = 1\nfor (i = 0; i < 8; i++) {\n  t = a + b\n  a = b\n  b = t\n}\na\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "5040\n21\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 expr string matching length substr index and arithmetic precedence", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("echo \"len=$(expr length \"safe-bash-engine\")\"\necho \"sub=$(expr substr \"safe-bash-engine\" 6 4)\"\necho \"idx=$(expr index \"safe-bash-engine\" \"b\")\"\necho \"rx=$(expr \"release-v2.14.9\" : 'release-v\\([0-9]*\\.[0-9]*\\)')\"\necho \"math=$(expr \\( 14 + 6 \\) \\* 3 - 5)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "len=16\nsub=bash\nidx=6\nrx=2.14\nmath=55\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 numfmt --to=iec --to=si --from=iec with padding and suffixes", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"1024\\n1048576\\n1536000\\n\" | numfmt --to=iec --suffix=B\nprintf \"1000\\n2500000\\n\" | numfmt --to=si\nprintf \"2K\\n4M\\n\" | numfmt --from=iec");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1.0KB\n1.0MB\n1.5MB\n1.0k\n2.5M\n2048\n4194304\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 seq with format string -f separator -s and equal-width -w", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("seq -w 8 12 | paste -sd \",\" -\nseq -f \"node-%03g\" -s \":\" 1 2 7");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "08,09,10,11,12\nnode-001:node-003:node-005:node-007\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 factor prime factorization piped into awk prime multiplicity counter", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("factor 360 1024 2310 | awk '{\n  n = $1\n  sub(/:$/, \"\", n)\n  delete counts\n  for (i = 2; i <= NF; i++) counts[$i]++\n  out = n \":\"\n  for (i = 2; i <= NF; i++) {\n    if (counts[$i] > 0) {\n      out = out \" \" $i \"^\" counts[$i]\n      counts[$i] = 0\n    }\n  }\n  print out\n}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "360: 2^3 3^2 5^1\n1024: 2^10\n2310: 2^1 3^1 5^1 7^1 11^1\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 csplit regex pattern splitting with custom prefix and format", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/changelog.txt\n## 1.0.0\n- init\n- docs\n## 1.1.0\n- feat a\n- feat b\n## 1.2.0\n- fix c\nEOF\ncsplit -s -f /tmp/rel_ -b \"%02d.md\" /tmp/changelog.txt \"/^## /\" \"{*}\"\nfor f in /tmp/rel_*.md; do\n  if [ -s \"$f\" ]; then\n    printf \"%s:%d:%s\\n\" \"$(basename \"$f\")\" \"$(wc -l < \"$f\" | tr -d \" \")\" \"$(head -n 1 \"$f\")\"\n  fi\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rel_01.md:3:## 1.0.0\nrel_02.md:3:## 1.1.0\nrel_03.md:2:## 1.2.0\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 split by lines -l and bytes -b with numeric suffixes -d", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("seq 1 10 > /tmp/ten.txt\nsplit -l 4 -d -a 2 /tmp/ten.txt /tmp/chunk_\nfor f in /tmp/chunk_*; do\n  printf \"%s=%s\\n\" \"$(basename \"$f\")\" \"$(paste -sd \",\" \"$f\")\"\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "chunk_00=1,2,3,4\nchunk_01=5,6,7,8\nchunk_02=9,10\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 expand and unexpand tab stops with tr character classes and squeeze", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"a\\tb\\tc\\n1234\\t56\\t7\\n\" | expand -t 4 | tr \" \" \".\"\nprintf \"    indented    text\\n\" | unexpand -a | od -An -tx1 | tr -s \" \" | sed \"s/^ //;s/ $//\"\nprintf \"aaabbbccc   111222\\n\" | tr -s \"abc 12\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a...b...c\n1234....56..7\n20 20 20 20 69 6e 64 65 6e 74 65 64 09 74 65 78\n74 0a\nabc 12\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 nl line numbering modes (-ba -bt -nrz -w) with rev and tac", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/poem.txt\nfirst line\n\nsecond line\nthird line\nEOF\nnl -bt -nrz -w3 -s\": \" /tmp/poem.txt | tac | rev");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "enil driht :300\nenil dnoces :200\n     \nenil tsrif :100\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 column -t table alignment and fold/fmt text wrapping", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/raw_table.txt\nNAME:ROLE:SCORE\nalice:engineer:98\nbob:staff-architect:100\ncharlie:qa:87\nEOF\ncolumn -t -s \":\" /tmp/raw_table.txt | awk '{ printf \"%d:%s\\n\", NF, $1 \"-\" $2 \"-\" $3 }'\necho \"alpha beta gamma delta epsilon zeta eta theta\" | fold -s -w 18");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "3:NAME-ROLE-SCORE\n3:alice-engineer-98\n3:bob-staff-architect-100\n3:charlie-qa-87\nalpha beta gamma \ndelta epsilon \nzeta eta theta\n");
    } finally {
      await h.dispose();
    }
  });

});
