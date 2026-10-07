import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure awk, sed, diff, patch, diff3, cmp, comm, join, csplit, and text formatting matrix", () => {
  test("1. awk multi-file FNR==NR hash-join with FILENAME tracking and END aggregation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "u1,admin\\nu2,editor\\nu3,viewer\\n" > roles.csv',
          'printf "u1,Alice,10\\nu2,Bob,25\\nu3,Carol,15\\nu4,Dan,5\\n" > users.csv',
          "awk -F, 'FNR==NR { role[$1]=$2; next } { r = ($1 in role) ? role[$1] : \"guest\"; total += $3; printf \"%s:%s:%s\\n\", $2, r, $3 } END { printf \"total=%d\\n\", total }' roles.csv users.csv"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "Alice:admin:10",
          "Bob:editor:25",
          "Carol:viewer:15",
          "Dan:guest:5",
          "total=55",
          ""
        ].join("\n")
      );
    });
  });

  test("2. awk getline next record and getline var < file external lookup with sprintf", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "HEADER_TAG\\n" > tag.txt',
          'printf "k1\\nv1\\nk2\\nv2\\n" > pairs.txt',
          "awk 'BEGIN { getline hdr < \"tag.txt\" } { key = $0; getline val; out = sprintf(\"[%s] %s=%s\", hdr, key, val); print out }' pairs.txt"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[HEADER_TAG] k1=v1\n[HEADER_TAG] k2=v2\n");
    });
  });

  test("3. awk string and math builtins: index, tolower, toupper, substr, length, int, sqrt, and log/exp", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "Hello_World 81\\n" | awk \'{ pos = index($1, "_"); left = tolower(substr($1, 1, pos - 1)); right = toupper(substr($1, pos + 1)); root = sqrt($2); printf "%s-%s len=%d pos=%d root=%d\\n", left, right, length($1), pos, int(root) }\''
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "hello-WORLD len=11 pos=6 root=9\n");
    });
  });

  test("4. awk paragraph mode (RS=\"\", FS=\"\\n\") parsing multi-line stanzas", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "name: alpha\\nport: 8080\\n\\nname: beta\\nport: 9090\\n" > stanzas.txt',
          'awk \'BEGIN { RS=""; FS="\\n" } { sub(/^name: /, "", $1); sub(/^port: /, "", $2); print $1 "@" $2 }\' stanzas.txt'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alpha@8080\nbeta@9090\n");
    });
  });

  test("5. awk field reversal, NF truncation, and custom OFS / ORS", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "a b c d\\n1 2 3 4\\n" | awk \'BEGIN { OFS=":" } { NF = 3; $1 = $1; print $3, $2, $1; print $0 }\''
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "c:b:a\na:b:c\n3:2:1\n1:2:3\n");
    });
  });

  test("6. sed multi-line N;P;D windowing and backslash continuation line joining", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'CONT_EOF' > cont.txt",
          "cmd --flag1 \\",
          "  --flag2 \\",
          "  --flag3",
          "next_cmd",
          "CONT_EOF",
          "sed ':a; /\\\\$/ { N; s/\\\\\\n[ ]*//; ba }' cont.txt"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "cmd --flag1 --flag2 --flag3\nnext_cmd\n");
    });
  });

  test("7. sed hold space exchange (x), append (H), and get (g/G) state transformation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "header1\\nitemA\\nheader2\\nitemB\\n" | sed -n \'/^header/ { h; d }; G; s/\\(.*\\)\\n\\(.*\\)/\\2 -> \\1/p\''
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "header1 -> itemA\nheader2 -> itemB\n");
    });
  });

  test("8. sed line numbering (=), insert (i), append (a), change (c), and file read (r)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "INSERTED_FROM_FILE\\n" > extra.txt',
          'printf "alpha\\nbeta\\ngamma\\n" | sed -e "1i\\TOP" -e "2r extra.txt" -e "2c\\BETA_REPLACED" -e "\\$a\\BOTTOM"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "TOP",
          "alpha",
          "BETA_REPLACED",
          "INSERTED_FROM_FILE",
          "gamma",
          "BOTTOM",
          ""
        ].join("\n")
      );
    });
  });

  test("9. diff -u unified diff generation, patch forward application, and patch -R reverse rollback", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "line1\\nline2\\nline3\\nline4\\n" > orig.txt',
          'printf "line1\\nline2_mod\\nline3\\nline4\\nline5\\n" > updated.txt',
          "cp orig.txt working.txt",
          "diff -u working.txt updated.txt > changes.patch || true",
          "patch -u working.txt < changes.patch >/dev/null",
          "cmp -s working.txt updated.txt && echo 'forward_ok'",
          "patch -R -u working.txt < changes.patch >/dev/null",
          "cmp -s working.txt orig.txt && echo 'reverse_ok'"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "forward_ok\nreverse_ok\n");
    });
  });

  test("10. diff -b -w -i -B whitespace/case/blank-line ignore flags and diff -q brief status", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "Hello   World\\n\\nFoo Bar\\n" > a.txt',
          'printf "hello world\\nfoo   bar\\n" > b.txt',
          "diff -q a.txt b.txt >/dev/null || echo 'raw_differs'",
          "diff -b -w -i -B a.txt b.txt && echo 'normalized_equal'"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "raw_differs\nnormalized_equal\n");
    });
  });

  test("11. diff3 -m three-way merge for clean concurrent edits and conflict detection", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "top\\nmiddle\\nbottom\\n" > base.txt',
          'printf "top_left\\nmiddle\\nbottom\\n" > left.txt',
          'printf "top\\nmiddle\\nbottom_right\\n" > right.txt',
          "diff3 -m left.txt base.txt right.txt"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "top_left\nmiddle\nbottom_right\n");
    });
  });

  test("12. cmp -s silent check, default byte/line difference report, and cmp -l verbose octal listing", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "abcd\\n" > f1.bin',
          'printf "abXd\\n" > f2.bin',
          "cmp -s f1.bin f1.bin && echo 'same_ok'",
          "cmp -s f1.bin f2.bin || echo 'diff_detected'",
          "cmp f1.bin f2.bin || true"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /^same_ok\ndiff_detected\nf1\.bin f2\.bin differ: (?:byte|char) 3, line 1\n$/);
    });
  });

  test("13. comm -12, -13, -23 set intersection and difference with --output-delimiter", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "alpha\\nbeta\\ngamma\\n" > s1.txt',
          'printf "beta\\ndelta\\ngamma\\n" > s2.txt',
          'echo "inter=$(comm -12 s1.txt s2.txt | paste -sd, -)"',
          'echo "only1=$(comm -23 s1.txt s2.txt | paste -sd, -)"',
          'echo "only2=$(comm -13 s1.txt s2.txt | paste -sd, -)"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "inter=beta,gamma\nonly1=alpha\nonly2=delta\n");
    });
  });

  test("14. join on non-first key fields (-1 2 -2 1) with outer join (-a 1 -a 2), -e empty fill, and -o projection", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "emp1,d10\\nemp2,d20\\nemp3,d30\\n" > emps.csv',
          'printf "d10,Engineering\\nd20,Design\\nd40,Legal\\n" > depts.csv',
          "join -t, -1 2 -2 1 -a 1 -a 2 -e NONE -o 0,1.1,2.2 emps.csv depts.csv"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "d10,emp1,Engineering",
          "d20,emp2,Design",
          "d30,emp3,NONE",
          "d40,NONE,Legal",
          ""
        ].join("\n")
      );
    });
  });

  test("15. csplit splitting document on regex pattern with custom prefix (-f) and suffix (-b)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "sec1_a\\nsec1_b\\n---\\nsec2_a\\n---\\nsec3_a\\n" > doc.txt',
          'csplit -s -f part_ -b "%02d.txt" doc.txt "/^---$/" "{*}"',
          "ls part_*.txt | sort",
          "cat part_00.txt",
          "cat part_02.txt"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "part_00.txt",
          "part_01.txt",
          "part_02.txt",
          "sec1_a",
          "sec1_b",
          "---",
          "sec3_a",
          ""
        ].join("\n")
      );
    });
  });

  test("16. column -t -s -o aligned table formatting and expand / unexpand tab conversion", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "id,name,role\\n1,alice,admin\\n22,bob,user\\n" | column -t -s, -o " | "',
          'printf "a\\tb\\n" | expand -t 4 | wc -c | tr -d " "'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "id | name  | role",
          "1  | alice | admin",
          "22 | bob   | user",
          "6",
          ""
        ].join("\n")
      );
    });
  });

  test("17. fold -w -s word-boundary wrapping and fmt -w paragraph reflowing", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "alpha beta gamma delta epsilon\\n" | fold -w 12 -s',
          'printf "short\\nlines\\nhere\\n" | fmt -w 40'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "alpha beta ",
          "gamma delta ",
          "epsilon",
          "short lines here",
          ""
        ].join("\n")
      );
    });
  });

  test("18. tr POSIX character classes ([:upper:], [:lower:], [:digit:], [:space:]), -d, -s, and -c", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "Hello   123   World!\\n" | tr "[:upper:]" "[:lower:]" | tr -s "[:space:]" "_"',
          'printf "id=42;code=99!\\n" | tr -cd "[:digit:],\\n"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "hello_123_world!_4299\n");
    });
  });

  test("19. cut with field ranges, --complement, and --output-delimiter", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "f1:f2:f3:f4:f5\\n" | cut -d: -f1,3-4 --output-delimiter="|"',
          'printf "f1:f2:f3:f4:f5\\n" | cut -d: -f2,4 --complement'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "f1|f3|f4\nf1:f3:f5\n");
    });
  });

  test("20. apply_patch multi-hunk Update, Move, Add, and Delete verified by file contents", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "alpha\\nbeta\\ngamma\\ndelta\\n" > src.txt',
          'printf "obsolete\\n" > old.txt',
          "apply_patch >/dev/null <<'PATCH'",
          "*** Begin Patch",
          "*** Add File: added.txt",
          "+new line 1",
          "+new line 2",
          "*** Update File: src.txt",
          "*** Move to: moved.txt",
          "@@",
          " alpha",
          "-beta",
          "+beta_patched",
          " gamma",
          "-delta",
          "+delta_patched",
          "*** Delete File: old.txt",
          "*** End Patch",
          "PATCH",
          "test ! -e src.txt && test ! -e old.txt && echo 'deleted_and_moved_ok'",
          "cat added.txt",
          "cat moved.txt"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "deleted_and_moved_ok",
          "new line 1",
          "new line 2",
          "alpha",
          "beta_patched",
          "gamma",
          "delta_patched",
          ""
        ].join("\n")
      );
    });
  });
});
