import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure coreutils sort join comm column csplit tsort numfmt bc matrix", () => {
  it("1. sort -V version sort, -h human-numeric sort, and -M month sort", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'v1.10.0\\nv1.2.0\\nv1.9.5\\nv2.0.0\\n' | sort -V | paste -sd, -\nprintf '512K\\n2G\\n128M\\n4K\\n' | sort -h | paste -sd, -\nprintf 'DEC\\nJAN\\nAUG\\nMAR\\n' | sort -M | paste -sd, -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "v1.2.0,v1.9.5,v1.10.0,v2.0.0\n4K,512K,128M,2G\nJAN,MAR,AUG,DEC");
    });
  });

  it("2. sort multi-key -t: -k1,1 -k2,2nr with -s stable tie-breaking and -c check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'eu:10:b\\nus:50:a\\neu:30:a\\nus:50:b\\n' | sort -t: -k1,1 -k2,2nr -s > /tmp/sorted.txt\nsort -t: -k1,1 -k2,2nr -c /tmp/sorted.txt && echo SORT_OK\ncat /tmp/sorted.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "SORT_OK\neu:30:a\neu:10:b\nus:50:a\nus:50:b");
    });
  });

  it("3. join -t, -1 -2 with -a1 -a2 full outer join, -e NULL placeholder, and -o format", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '1,alice\\n2,bob\\n3,carol\\n' > /tmp/jl.csv\nprintf '1,95\\n3,88\\n4,72\\n' > /tmp/jr.csv\njoin -t, -a1 -a2 -e MISSING -o 0,1.2,2.2 /tmp/jl.csv /tmp/jr.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1,alice,95\n2,bob,MISSING\n3,carol,88\n4,MISSING,72");
    });
  });

  it("4. join -v1 and -v2 anti-join for unmatched left and right keys", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a:1\\nb:2\\nc:3\\n' > /tmp/jv1.txt\nprintf 'b:20\\nd:40\\n' > /tmp/jv2.txt\njoin -t: -v1 /tmp/jv1.txt /tmp/jv2.txt\njoin -t: -v2 /tmp/jv1.txt /tmp/jv2.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a:1\nc:3\nd:40");
    });
  });

  it("5. comm -12 intersection, -23 left-only, and -13 right-only set operations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'alpha\\nbeta\\ngamma\\n' > /tmp/s_a.txt\nprintf 'beta\\ndelta\\ngamma\\n' > /tmp/s_b.txt\ncomm -12 /tmp/s_a.txt /tmp/s_b.txt | paste -sd, -\ncomm -23 /tmp/s_a.txt /tmp/s_b.txt | paste -sd, -\ncomm -13 /tmp/s_a.txt /tmp/s_b.txt | paste -sd, -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "beta,gamma\nalpha\ndelta");
    });
  });

  it("6. column -t -s: -o\" | \" aligned table and column -J JSON table serialization", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id:name:role\\n1:alice:admin\\n20:bob:dev\\n' | column -t -s: -o ' | '\nprintf '1:alice\\n2:bob\\n' | column -J -n users -N id,name -s: | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id | name  | role\n1  | alice | admin\n20 | bob   | dev\n{\"users\":[{\"id\":\"1\",\"name\":\"alice\"},{\"id\":\"2\",\"name\":\"bob\"}]}");
    });
  });

  it("7. csplit regex section splitting with custom prefix (-f), digits (-n), and -z elide-empty", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/cs_dir\nprintf 'sec1_a\\nsec1_b\\n---\\nsec2_a\\n---\\nsec3_a\\n' > /tmp/cs_dir/input.txt\ncsplit -s -z -f /tmp/cs_dir/part_ -n 2 /tmp/cs_dir/input.txt '/^---$/' '{*}'\nls /tmp/cs_dir/part_* | sort\nhead -n 1 /tmp/cs_dir/part_00 /tmp/cs_dir/part_01 /tmp/cs_dir/part_02");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/cs_dir/part_00\n/tmp/cs_dir/part_01\n/tmp/cs_dir/part_02\n==> /tmp/cs_dir/part_00 <==\nsec1_a\n\n==> /tmp/cs_dir/part_01 <==\n---\n\n==> /tmp/cs_dir/part_02 <==\n---");
    });
  });

  it("8. tsort topological ordering of multi-stage build dependency graph", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | tsort | paste -sd'>' -\nparse ast\nast typecheck\ntypecheck ir\nir codegen\ncodegen link\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "parse>ast>typecheck>ir>codegen>link");
    });
  });

  it("9. numfmt --from=iec --to=si and --to=iec-i with --field, --header, and --suffix", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'node size\\nweb1 1024\\nweb2 1048576\\n' | numfmt --header=1 --field=2 --to=iec-i --suffix=B");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "node size\nweb1 1.0KiB\nweb2  1.0MiB");
    });
  });

  it("10. bc recursive function definition, while loop, and base conversion (ibase/obase)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | bc\ndefine fact(n) {\n  if (n <= 1) return (1);\n  return (n * fact(n - 1));\n}\nfact(7)\nobase=16; ibase=10; 255\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "5040\nFF");
    });
  });

  it("11. bc -l math library: scale precision, sqrt(), and natural log l(e(1))", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'scale=4; sqrt(2); scale=2; l(e(3))\\n' | bc -l");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1.4142\n2.99");
    });
  });

  it("12. factor prime factorization and expr regex/arithmetic evaluation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("factor 360 1024\nexpr 14 \\* 3 + 8\nexpr 'release-v24' : 'release-v\\([0-9]*\\)'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "360: 2 2 2 3 3 5\n1024: 2 2 2 2 2 2 2 2 2 2\n50\n24");
    });
  });

  it("13. nl -ba -w 3 -s \": \" line numbering with tac and rev", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'first\\n\\nthird\\n' | nl -ba -w 3 -s ': '\nprintf 'abc\\ndef\\n' | tac | rev");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1: first\n  2: \n  3: third\nfed\ncba");
    });
  });

  it("14. expand -t 4 and unexpand -a -t 4 tab/space conversion roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a\\tb\\tc\\n' | expand -t 4 | cat -A\nprintf '    indented\\n' | unexpand -a -t 4 | cat -T");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a   b   c$\n^Iindented");
    });
  });

  it("15. fold -w -s word-boundary wrapping and fmt -w paragraph reflow", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'The quick brown fox jumps over the lazy dog\\n' | fold -s -w 16");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "The quick brown \nfox jumps over \nthe lazy dog");
    });
  });

  it("16. split -l line chunking with -d numeric suffixes and --additional-suffix", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/sp_dir\nseq 1 5 > /tmp/sp_dir/five.txt\nsplit -l 2 -d --additional-suffix=.chunk /tmp/sp_dir/five.txt /tmp/sp_dir/out_\nls /tmp/sp_dir/out_* | sort\nwc -l /tmp/sp_dir/out_00.chunk /tmp/sp_dir/out_01.chunk /tmp/sp_dir/out_02.chunk | awk '{print $1, $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/sp_dir/out_00.chunk\n/tmp/sp_dir/out_01.chunk\n/tmp/sp_dir/out_02.chunk\n2 /tmp/sp_dir/out_00.chunk\n2 /tmp/sp_dir/out_01.chunk\n1 /tmp/sp_dir/out_02.chunk\n5 total");
    });
  });

  it("17. dd bs/skip/seek/count byte slicing and conv=ucase,swab transformation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '0123hello_world999' > /tmp/dd_in.bin\ndd if=/tmp/dd_in.bin of=/tmp/dd_out.bin bs=1 skip=4 count=11 conv=ucase status=none\ncat /tmp/dd_out.bin; echo\nprintf 'badc' | dd conv=swab status=none; echo");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "HELLO_WORLD\nabcd");
    });
  });

  it("18. envsubst selective $VAR template expansion leaving unspecified variables intact", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("export HOST=api.internal PORT=8443 SECRET=keep_me\nprintf 'url=https://${HOST}:${PORT}/v1 token=${SECRET}\\n' | envsubst '$HOST $PORT'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "url=https://api.internal:8443/v1 token=${SECRET}");
    });
  });

  it("19. getopt short and long option canonicalization anddos2unix/unix2dos CRLF conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("getopt -o ab: --long alpha,beta: -- -a --beta val1 pos1\nprintf 'line1\\nline2\\n' | unix2dos | od -t x1 -An | tr -s ' '\nprintf 'line1\\r\\nline2\\r\\n' | dos2unix");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "-a --beta 'val1' -- 'pos1'\n 6c 69 6e 65 31 0d 0a 6c 69 6e 65 32 0d 0a\nline1\nline2");
    });
  });

  it("20. uniq -c -d -u duplicate analysis with cut --output-delimiter and paste -sd", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'err\\nok\\nerr\\nwarn\\nerr\\nok\\n' | sort | uniq -c | awk '{print $1 \":\" $2}' | cut -d: -f1,2 --output-delimiter='=' | paste -sd, -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3=err,2=ok,1=warn");
    });
  });

});
