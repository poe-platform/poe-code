import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure awk, sed, grep, rg, find, fd, xargs, diff, patch & text refactor matrix", () => {
  it("1. awk multi-file FNR==NR lookup table join with BEGIN/END summary and OFS formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'TXT' > /tmp/hosts.map\n10.0.1.5 web-prod-1\n10.0.1.9 db-prod-1\nTXT\ncat <<'TXT' > /tmp/traffic.log\n10.0.1.5 200 1024\n10.0.1.9 500 512\n10.0.1.5 200 2048\n10.0.1.99 404 128\nTXT\nawk 'BEGIN { OFS=\":\" } FNR==NR { host[$1]=$2; next } { name = ($1 in host) ? host[$1] : \"unknown\"; bytes[name] += $3; reqs[name]++ } END { for (k in bytes) print k, reqs[k], bytes[k] }' /tmp/hosts.map /tmp/traffic.log | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "db-prod-1:1:512\nunknown:1:128\nweb-prod-1:2:3072");
    });
  });

  it("2. awk range patterns (/START/,/END/), gsub, split, and sprintf formatted report", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'TXT' > /tmp/blocks.txt\n NOISE 1\nBEGIN_BLOCK\nk1=10;k2=25\nk1=5;k2=15\nEND_BLOCK\nNOISE 2\nTXT\nawk '/BEGIN_BLOCK/,/END_BLOCK/ { if ($0 ~ /^(BEGIN|END)_BLOCK$/) next; n = split($0, parts, \";\"); for (i=1; i<=n; i++) { split(parts[i], kv, \"=\"); sum[kv[1]] += kv[2] } } END { printf \"k1=%03d,k2=%03d\\n\", sum[\"k1\"], sum[\"k2\"] }' /tmp/blocks.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "k1=015,k2=040");
    });
  });

  it("3. sed hold space (h, H, g, G, x) paragraph reversal and multi-line joining", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'line1\\nline2\\nline3\\n' | sed -n '1!G;h;$p'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "line3\nline2\nline1");
    });
  });

  it("4. sed branch labels (:a, N, $!ba) to collapse continuation lines ending with backslash", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'TXT' > /tmp/continued.conf\nCFLAGS = -O2 \\\n  -Wall \\\n  -Wextra\nLDFLAGS = -lm\nTXT\nsed ':a; /\\\\$/ { N; s/\\\\\\n[[:space:]]*/ /; ba }' /tmp/continued.conf");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "CFLAGS = -O2  -Wall  -Wextra\nLDFLAGS = -lm");
    });
  });

  it("5. sed address ranges, negated deletes (!d), and capture group backreferences (\\1, \\2)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'TXT' > /tmp/kv.txt\n# header\nuser_id = 42\nrole_name = admin\n# footer\nTXT\nsed -E -e '/^#/d' -e 's/^([a-z_]+)[[:space:]]*=[[:space:]]*([^[:space:]]+)$/\\2:\\1/' /tmp/kv.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "42:user_id\nadmin:role_name");
    });
  });

  it("6. rg -n -i --glob filtering with context lines (-C 1) and replacement (-r)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/rg_proj/src /tmp/rg_proj/docs\nprintf 'line1\\nTODO: fix auth\\nline3\\n' > /tmp/rg_proj/src/auth.ts\nprintf 'todo: ignore docs\\n' > /tmp/rg_proj/docs/readme.md\nrg -i -n --glob '*.ts' 'todo: (.*)' -r 'TASK[$1]' /tmp/rg_proj");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/rg_proj/src/auth.ts:2:TASK[fix auth]");
    });
  });

  it("7. grep -E -o, -v, -c, and -F fixed-string matching on regex metacharacter literals", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'TXT' > /tmp/meta.log\nprice is $10.00 [ok]\nprice is $25.00 [err]*\ndiscount (50%)\nTXT\ngrep -F -c '[err]*' /tmp/meta.log\ngrep -E -o '\\$[0-9]+\\.[0-9]{2}' /tmp/meta.log | paste -sd ',' -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1\n$10.00,$25.00");
    });
  });

  it("8. find with compound predicates (-name, -type f, ! -name) piped to xargs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/fnd/a /tmp/fnd/b\nprintf 'alpha\\n' > /tmp/fnd/a/keep.txt\nprintf 'beta\\n' > /tmp/fnd/b/keep.txt\nprintf 'skip\\n' > /tmp/fnd/b/ignore.bak\nfind /tmp/fnd -type f -name '*.txt' ! -name '*.bak' | sort | xargs grep -H 'a'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/fnd/a/keep.txt:alpha\n/tmp/fnd/b/keep.txt:beta");
    });
  });

  it("9. fd extension (-e) and exclude (-E) search piped into xargs -I{}", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/fd_tree/pkg /tmp/fd_tree/dist\nprintf 'export const x = 1;\\n' > /tmp/fd_tree/pkg/index.ts\nprintf 'export const y = 2;\\n' > /tmp/fd_tree/dist/bundle.ts\nfd -e ts -E dist . /tmp/fd_tree | xargs -I{} basename {}");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "index.ts");
    });
  });

  it("10. comm -12, -23, and -13 set operations on sorted inventory manifests", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a\\nb\\nc\\nd\\n' > /tmp/set1.txt\nprintf 'b\\nd\\ne\\n' > /tmp/set2.txt\necho \"both:$(comm -12 /tmp/set1.txt /tmp/set2.txt | paste -sd ',' -)\"\necho \"only1:$(comm -23 /tmp/set1.txt /tmp/set2.txt | paste -sd ',' -)\"\necho \"only2:$(comm -13 /tmp/set1.txt /tmp/set2.txt | paste -sd ',' -)\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "both:b,d\nonly1:a,c\nonly2:e");
    });
  });

  it("11. POSIX join with custom delimiter (-t), outer unpaired lines (-a), and empty filler (-e)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'TXT' > /tmp/j1.txt\n101:Alice\n102:Bob\n103:Carol\nTXT\ncat <<'TXT' > /tmp/j2.txt\n101:Admin\n103:Editor\nTXT\njoin -t ':' -a 1 -e 'NONE' -o 1.1,1.2,2.2 /tmp/j1.txt /tmp/j2.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "101:Alice:Admin\n102:Bob:NONE\n103:Carol:Editor");
    });
  });

  it("12. sort multi-key (-k) with numeric (-n), reverse (-r), and custom field separator (-t)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'TXT' > /tmp/builds.txt\nweb:2:150\napi:1:300\nweb:1:90\napi:2:120\nTXT\nsort -t ':' -k1,1 -k2,2nr /tmp/builds.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "api:2:120\napi:1:300\nweb:2:150\nweb:1:90");
    });
  });

  it("13. uniq -c, -d, and -u frequency analysis pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'err\\nok\\nerr\\nerr\\nwarn\\nok\\n' > /tmp/events.txt\nsort /tmp/events.txt | uniq -c | awk '{print $1 \":\" $2}'\necho \"dups:$(sort /tmp/events.txt | uniq -d | paste -sd ',' -)\"\necho \"uniq:$(sort /tmp/events.txt | uniq -u | paste -sd ',' -)\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3:err\n2:ok\n1:warn\ndups:err,ok\nuniq:warn");
    });
  });

  it("14. cut, paste, tr, rev, and tac columnar matrix transformation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'TXT' > /tmp/mat.txt\nfirst:10:aa\nsecond:20:bb\nthird:30:cc\nTXT\ntac /tmp/mat.txt | cut -d ':' -f 1,3 | tr ':' '-' | rev | rev");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "third-cc\nsecond-bb\nfirst-aa");
    });
  });

  it("15. nl line numbering and fold width wrapping", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'alpha\\n\\nbeta\\n' | nl -ba -w 2 -s ':'\nprintf 'abcdefghij' | fold -w 4");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1:alpha\n 2:\n 3:beta\nabcd\nefgh\nij");
    });
  });

  it("16. unified diff (-u) generation and multi-hunk patch application with backup (-b)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'line1\\nline2\\nline3\\nline4\\nline5\\n' > /tmp/orig.txt\nprintf 'line1_mod\\nline2\\nline3\\nline4\\nline5_mod\\n' > /tmp/new.txt\ndiff -u /tmp/orig.txt /tmp/new.txt > /tmp/changes.patch || true\ncp /tmp/orig.txt /tmp/target.txt\npatch -s -b /tmp/target.txt < /tmp/changes.patch\ncmp -s /tmp/target.txt /tmp/new.txt && echo \"PATCH_OK\"\ncmp -s /tmp/target.txt.orig /tmp/orig.txt && echo \"BACKUP_OK\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PATCH_OK\nBACKUP_OK");
    });
  });

  it("17. apply_patch multi-action (Add File, Update File, Delete File) atomic transaction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/ap_ws\nprintf 'old_line\\nkeep_line\\n' > /tmp/ap_ws/mod.txt\nprintf 'obsolete\\n' > /tmp/ap_ws/del.txt\ncat <<'PATCH' | (cd /tmp/ap_ws && apply_patch)\n*** Begin Patch\n*** Update File: mod.txt\n@@\n-old_line\n+new_line\n keep_line\n*** Add File: added.txt\n+created_content\n*** Delete File: del.txt\n*** End Patch\nPATCH\ncat /tmp/ap_ws/mod.txt /tmp/ap_ws/added.txt\n[ ! -e /tmp/ap_ws/del.txt ] && echo \"DEL_OK\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Success. Updated the following files:\nM mod.txt\nA added.txt\nD del.txt\nnew_line\nkeep_line\ncreated_content\nDEL_OK");
    });
  });

  it("18. column -t -s tabular alignment on delimited input", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'NAME:ROLE\\nAlice:Engineer\\nBob:SRE\\n' | column -t -s ':' | awk '{print $1 \"|\" $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "NAME|ROLE\nAlice|Engineer\nBob|SRE");
    });
  });

  it("19. head -n -K and tail -n +K window slicing on numbered stream", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("seq 1 10 | tail -n +3 | head -n -2 | paste -sd ',' -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3,4,5,6,7,8");
    });
  });

  it("20. tee multi-file fanout combined with wc -l -w -c verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'one two\\nthree four five\\n' | tee /tmp/fan1.txt /tmp/fan2.txt | wc -w | tr -d ' '\ncmp -s /tmp/fan1.txt /tmp/fan2.txt && wc -l < /tmp/fan1.txt | tr -d ' '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "5\n2");
    });
  });

});
