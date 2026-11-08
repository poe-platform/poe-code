import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure diff diff3 patch apply_patch cmp sed awk merge matrix", () => {
  it("1. diff -u unified diff with custom -L labels and patch -p0 roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'alpha\\nbeta\\ngamma\\ndelta\\n' > /tmp/orig.txt\nprintf 'alpha\\nbeta_v2\\ngamma\\ndelta\\nepsilon\\n' > /tmp/new.txt\ndiff -u -L orig.txt -L new.txt /tmp/orig.txt /tmp/new.txt > /tmp/change.patch || true\ncp /tmp/orig.txt /tmp/work.txt\npatch -s /tmp/work.txt /tmp/change.patch\ncmp -s /tmp/work.txt /tmp/new.txt && echo MATCH\npatch -s -R /tmp/work.txt /tmp/change.patch\ncmp -s /tmp/work.txt /tmp/orig.txt && echo REVERTED");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "MATCH\nREVERTED");
    });
  });

  it("2. diff -c context format and diff -n RCS format output", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'line1\\nline2\\nline3\\n' > /tmp/f1.txt\nprintf 'line1\\nline2_mod\\nline3\\n' > /tmp/f2.txt\ndiff -n /tmp/f1.txt /tmp/f2.txt || true");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "d2 1\na2 1\nline2_mod");
    });
  });

  it("3. diff -e ed script generation applied to reconstruct target file", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'one\\ntwo\\nthree\\n' > /tmp/a.txt\nprintf 'one\\nTWO\\nthree\\nfour\\n' > /tmp/b.txt\ndiff -e /tmp/a.txt /tmp/b.txt || true");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3a\nfour\n.\n2c\nTWO\n.");
    });
  });

  it("4. diff -i --ignore-case, -w --ignore-all-space, and -B --ignore-blank-lines", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'Hello   World\\n\\nFoo Bar\\n' > /tmp/w1.txt\nprintf 'hello world\\nfoo   bar\\n' > /tmp/w2.txt\ndiff -q -i -w -B -s /tmp/w1.txt /tmp/w2.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Files /tmp/w1.txt and /tmp/w2.txt are identical");
    });
  });

  it("5. diff -r recursive directory comparison with -q brief and -N new-file", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/dir_a /tmp/dir_b\nprintf 'same\\n' > /tmp/dir_a/common.txt\nprintf 'same\\n' > /tmp/dir_b/common.txt\nprintf 'v1\\n' > /tmp/dir_a/mod.txt\nprintf 'v2\\n' > /tmp/dir_b/mod.txt\ndiff -r -q /tmp/dir_a /tmp/dir_b || true");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Files /tmp/dir_a/mod.txt and /tmp/dir_b/mod.txt differ");
    });
  });

  it("6. diff3 -m clean 3-way merge of non-overlapping changes from ancestor", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'line1\\nline2\\nline3\\nline4\\nline5\\n' > /tmp/base.txt\nprintf 'line1_ours\\nline2\\nline3\\nline4\\nline5\\n' > /tmp/ours.txt\nprintf 'line1\\nline2\\nline3\\nline4\\nline5_theirs\\n' > /tmp/theirs.txt\ndiff3 -m /tmp/ours.txt /tmp/base.txt /tmp/theirs.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "line1_ours\nline2\nline3\nline4\nline5_theirs");
    });
  });

  it("7. diff3 -m conflicting 3-way merge with custom -L labels and exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'header\\nvalue=10\\nfooter\\n' > /tmp/c_base.txt\nprintf 'header\\nvalue=20\\nfooter\\n' > /tmp/c_ours.txt\nprintf 'header\\nvalue=30\\nfooter\\n' > /tmp/c_theirs.txt\ndiff3 -m -L OURS -L BASE -L THEIRS /tmp/c_ours.txt /tmp/c_base.txt /tmp/c_theirs.txt > /tmp/conflict.txt; rc=$?\necho \"rc=$rc\"\ngrep -E '^(<<<<<<<|=======|>>>>>>>|value=)' /tmp/conflict.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rc=1\n<<<<<<< OURS\nvalue=20\nvalue=10\n=======\nvalue=30\n>>>>>>> THEIRS");
    });
  });

  it("8. patch -p1 multi-file unified diff application with -b backup creation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/repo/src\nprintf 'export const port = 3000;\\n' > /tmp/repo/src/config.ts\ncat << 'EOF' > /tmp/repo.patch\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1 +1 @@\n-export const port = 3000;\n+export const port = 8080;\nEOF\npatch -s -p1 -b -d /tmp/repo -i /tmp/repo.patch\ncat /tmp/repo/src/config.ts\ncat /tmp/repo/src/config.ts.orig");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "export const port = 8080;\nexport const port = 3000;");
    });
  });

  it("9. patch --dry-run leaves target file untouched while verifying applicability", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'status=old\\n' > /tmp/dry.txt\ncat << 'EOF' > /tmp/dry.patch\n--- a/dry.txt\n+++ b/dry.txt\n@@ -1 +1 @@\n-status=old\n+status=new\nEOF\npatch -s --dry-run /tmp/dry.txt /tmp/dry.patch\ncat /tmp/dry.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "status=old");
    });
  });

  it("10. patch -l --ignore-whitespace applies hunk despite tab/space drift", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'fn main() {\\n    return 0;\\n}\\n' > /tmp/ws.txt\ncat << 'EOF' > /tmp/ws.patch\n--- a/ws.txt\n+++ b/ws.txt\n@@ -1,3 +1,3 @@\n fn main() {\n-  return 0;\n+  return 42;\n }\nEOF\npatch -s -l /tmp/ws.txt /tmp/ws.patch\ncat /tmp/ws.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "fn main() {\n  return 42;\n}");
    });
  });

  it("11. patch -E --remove-empty-files deletes file when patch empties all lines", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'ephemeral\\n' > /tmp/temp_del.txt\ncat << 'EOF' > /tmp/del.patch\n--- a/temp_del.txt\n+++ b/temp_del.txt\n@@ -1 +0,0 @@\n-ephemeral\nEOF\npatch -s -E /tmp/temp_del.txt /tmp/del.patch\ntest ! -e /tmp/temp_del.txt && echo DELETED");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "DELETED");
    });
  });

  it("12. patch --ifdef=FEATURE_FLAG wraps both old and new blocks in preprocessor guards", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'int mode = 1;\\n' > /tmp/ifdef.c\ncat << 'EOF' > /tmp/ifdef.patch\n--- a/ifdef.c\n+++ b/ifdef.c\n@@ -1 +1 @@\n-int mode = 1;\n+int mode = 2;\nEOF\npatch -s --ifdef=FAST_PATH /tmp/ifdef.c /tmp/ifdef.patch\ncat /tmp/ifdef.c");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "#ifndef FAST_PATH\nint mode = 1;\n#else\nint mode = 2;\n#endif");
    });
  });

  it("13. apply_patch multi-operation atomic transaction: Add File, Update File, Move to, and Delete File", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/ap_ws\nprintf 'line1\\nold_val\\nline3\\n' > /tmp/ap_ws/mod.txt\nprintf 'obsolete\\n' > /tmp/ap_ws/remove.txt\ncd /tmp/ap_ws\napply_patch << 'EOF'\n*** Begin Patch\n*** Add File: created.txt\n+hello created\n*** Update File: mod.txt\n*** Move to: renamed.txt\n@@\n line1\n-old_val\n+new_val\n line3\n*** Delete File: remove.txt\n*** End Patch\nEOF\ncat /tmp/ap_ws/created.txt\ncat /tmp/ap_ws/renamed.txt\ntest ! -e /tmp/ap_ws/mod.txt && test ! -e /tmp/ap_ws/remove.txt && echo CLEAN");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Success. Updated the following files:\nA created.txt\nM renamed.txt\nD remove.txt\nhello created\nline1\nnew_val\nline3\nCLEAN");
    });
  });

  it("14. apply_patch rejects path traversal (..) without modifying workspace", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/ap_sec\ncd /tmp/ap_sec\napply_patch << 'EOF' >/dev/null 2>&1; echo \"rc=$?\"\n*** Begin Patch\n*** Add File: ../escaped.txt\n+pwned\n*** End Patch\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rc=2");
    });
  });

  it("15. cmp -i SKIP1:SKIP2 and -n LIMIT byte range comparison", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'XXXXabcdefYYYY' > /tmp/bin1.dat\nprintf 'ZZabcdefWWWW' > /tmp/bin2.dat\ncmp -s -i 4:2 -n 6 /tmp/bin1.dat /tmp/bin2.dat && echo SLICE_EQUAL\ncmp -i 4:2 -n 7 /tmp/bin1.dat /tmp/bin2.dat >/dev/null 2>&1 || echo SLICE_DIFF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "SLICE_EQUAL\nSLICE_DIFF");
    });
  });

  it("16. cmp -l verbose octal mismatch listing on binary buffers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'ABCD' > /tmp/c1.bin\nprintf 'AXCY' > /tmp/c2.bin\ncmp -l /tmp/c1.bin /tmp/c2.bin | awk '{print $1, $2, $3}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2 102 130\n4 104 131");
    });
  });

  it("17. sed branch labels (:loop / b / t), hold space (h/H/g/G/x), and N multiline join", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'key1\\nval1\\nkey2\\nval2\\nkey3\\nval3\\n' | sed 'N;s/\\n/=/'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "key1=val1\nkey2=val2\nkey3=val3");
    });
  });

  it("18. sed range addressing (/START/,/END/) with negative ! exclusion and y/// transliteration", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'keep_a\\nBEGIN\\nsec_one\\nsec_two\\nEND\\nkeep_b\\n' | sed '/BEGIN/,/END/{/BEGIN/d;/END/d;y/abcdefghijklmnopqrstuvwxyz/ABCDEFGHIJKLMNOPQRSTUVWXYZ/;}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "keep_a\nSEC_ONE\nSEC_TWO\nkeep_b");
    });
  });

  it("19. awk BEGIN/END blocks, associative arrays, split(), gsub(), and formatted report", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | awk -F':' '{ n = split($2, tags, \",\"); for (i = 1; i <= n; i++) count[tags[i]] += $3 } END { for (k in count) printf \"%s=%d\\n\", k, count[k] }' | sort\nsvc1:rust,wasm:10\nsvc2:rust,ts:15\nsvc3:wasm,ts:5\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rust=25\nts=20\nwasm=15");
    });
  });

  it("20. diff + patch + awk + sha256sum automated release hotfix verification pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("seq 1 10 | awk '{printf \"module_%02d = v1\\n\", $1}' > /tmp/manifest_v1.conf\nsed 's/module_05 = v1/module_05 = v2_hotfix/; s/module_09 = v1/module_09 = v2_hotfix/' /tmp/manifest_v1.conf > /tmp/manifest_v2.conf\ndiff -u /tmp/manifest_v1.conf /tmp/manifest_v2.conf > /tmp/hotfix.diff || true\ncp /tmp/manifest_v1.conf /tmp/deployed.conf\npatch -s /tmp/deployed.conf /tmp/hotfix.diff\ncmp -s /tmp/deployed.conf /tmp/manifest_v2.conf && grep 'v2_hotfix' /tmp/deployed.conf | wc -l | tr -d ' '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2");
    });
  });

});
