import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("diff, patch, diff3, apply_patch, and cmp version-control workflow matrix", () => {
  it("1. diff -u generates unified diff and patch applies and reverses (-R) cleanly", async () => {
    await withE2EHarness({}, async (h) => {
      const orig = ["alpha", "beta", "gamma", "delta", "epsilon"].join("\n") + "\n";
      const next = ["alpha", "beta-updated", "gamma", "delta", "epsilon", "zeta"].join("\n") + "\n";
      await h.writeText("/work/v1.txt", orig);
      await h.writeText("/work/v2.txt", next);
      await h.writeText("/work/target.txt", orig);

      const diffRes = await h.exec("diff -u /work/v1.txt /work/v2.txt > /work/change.patch");
      assert.equal(diffRes.exitCode, 1);

      const applyRes = await h.exec("patch /work/target.txt < /work/change.patch");
      assert.equal(applyRes.exitCode, 0, applyRes.stderr);
      assert.equal(await h.readText("/work/target.txt"), next);

      const revRes = await h.exec("patch -R /work/target.txt < /work/change.patch");
      assert.equal(revRes.exitCode, 0, revRes.stderr);
      assert.equal(await h.readText("/work/target.txt"), orig);
    });
  });

  it("2. diff -c context format and normal format round-trip through patch", async () => {
    await withE2EHarness({}, async (h) => {
      const v1 = ["line1", "line2", "line3", "line4"].join("\n") + "\n";
      const v2 = ["line1", "line2-mod", "line3", "line4", "line5"].join("\n") + "\n";
      await h.writeText("/ctx/a.txt", v1);
      await h.writeText("/ctx/b.txt", v2);
      await h.writeText("/ctx/work.txt", v1);

      await h.exec("diff -c /ctx/a.txt /ctx/b.txt > /ctx/ctx.patch");
      const r1 = await h.exec("patch /ctx/work.txt < /ctx/ctx.patch");
      assert.equal(r1.exitCode, 0, r1.stderr);
      assert.equal(await h.readText("/ctx/work.txt"), v2);

      await h.writeText("/ctx/work2.txt", v1);
      await h.exec("diff /ctx/a.txt /ctx/b.txt > /ctx/normal.patch");
      const r2 = await h.exec("patch /ctx/work2.txt < /ctx/normal.patch");
      assert.equal(r2.exitCode, 0, r2.stderr);
      assert.equal(await h.readText("/ctx/work2.txt"), v2);
    });
  });

  it("3. diff -r -u recursive directory diff and patch -p1 multi-file tree synchronization", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/tree/old/src/app.ts", "export const v = 1;\n");
      await h.writeText("/tree/old/src/util.ts", "export const u = 'a';\n");
      await h.writeText("/tree/new/src/app.ts", "export const v = 2;\n");
      await h.writeText("/tree/new/src/util.ts", "export const u = 'b';\n");

      await h.writeText("/tree/live/src/app.ts", "export const v = 1;\n");
      await h.writeText("/tree/live/src/util.ts", "export const u = 'a';\n");

      await h.exec("cd /tree && diff -ru old new > tree.patch");
      const pRes = await h.exec("cd /tree/live && patch -p1 < /tree/tree.patch");
      assert.equal(pRes.exitCode, 0, pRes.stderr);
      assert.equal(await h.readText("/tree/live/src/app.ts"), "export const v = 2;\n");
      assert.equal(await h.readText("/tree/live/src/util.ts"), "export const u = 'b';\n");
    });
  });

  it("4. diff -q (--brief) and -s (--report-identical-files) summarize tree differences", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/cmpdir/d1/same.txt", "identical\n");
      await h.writeText("/cmpdir/d2/same.txt", "identical\n");
      await h.writeText("/cmpdir/d1/changed.txt", "before\n");
      await h.writeText("/cmpdir/d2/changed.txt", "after\n");

      const res = await h.exec("diff -r -q -s /cmpdir/d1 /cmpdir/d2");
      assert.equal(res.exitCode, 1);
      assert.match(res.stdout, /changed\.txt differ/);
      assert.match(res.stdout, /same\.txt are identical/);
    });
  });

  it("5. diff whitespace/case flags (-i, -b, -w, -B) suppress formatting-only noise", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/ws/a.txt", "Hello   World\n\nSecond Line\n");
      await h.writeText("/ws/b.txt", "hello world\nSecond   Line\n");

      const strict = await h.exec("diff -u /ws/a.txt /ws/b.txt");
      assert.equal(strict.exitCode, 1);

      const relaxed = await h.exec("diff -u -i -w -B /ws/a.txt /ws/b.txt");
      assert.equal(relaxed.exitCode, 0, relaxed.stderr);
      assert.equal(relaxed.stdout, "");
    });
  });

  it("6. patch --dry-run validates hunk applicability without mutating target files", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/dry/a.txt", "one\ntwo\nthree\n");
      await h.writeText("/dry/b.txt", "one\nTWO\nthree\n");
      await h.exec("diff -u /dry/a.txt /dry/b.txt > /dry/change.patch");

      const dry = await h.exec("patch --dry-run /dry/a.txt < /dry/change.patch");
      assert.equal(dry.exitCode, 0, dry.stderr);
      assert.equal(await h.readText("/dry/a.txt"), "one\ntwo\nthree\n");
    });
  });

  it("7. patch -o writes patched result to a separate output file while leaving input untouched", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/out/src.txt", "a\nb\nc\n");
      await h.writeText("/out/dst.txt", "a\nB\nc\n");
      await h.exec("diff -u /out/src.txt /out/dst.txt > /out/u.patch");

      const res = await h.exec("patch -o /out/merged.txt /out/src.txt < /out/u.patch");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(await h.readText("/out/src.txt"), "a\nb\nc\n");
      assert.equal(await h.readText("/out/merged.txt"), "a\nB\nc\n");
    });
  });

  it("8. patch -b creates backup file and patch -r writes rejected hunks on conflict", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/bak/base.txt", "l1\nl2\nl3\n");
      await h.writeText("/bak/mod.txt", "l1\nl2-changed\nl3\n");
      await h.exec("diff -u /bak/base.txt /bak/mod.txt > /bak/mod.patch");

      const okRes = await h.exec("patch -b /bak/base.txt < /bak/mod.patch");
      assert.equal(okRes.exitCode, 0, okRes.stderr);
      assert.equal(await h.readText("/bak/base.txt.orig"), "l1\nl2\nl3\n");

      await h.writeText("/bak/diverged.txt", "completely\ndifferent\ncontent\n");
      const failRes = await h.exec("patch -r /bak/custom.rej /bak/diverged.txt < /bak/mod.patch");
      assert.notEqual(failRes.exitCode, 0);
      const rej = await h.readText("/bak/custom.rej");
      assert.match(rej, /l2-changed/);
    });
  });

  it("9. patch applies hunks with line offsets when lines are inserted above the hunk", async () => {
    await withE2EHarness({}, async (h) => {
      const base = ["header", "ctx1", "ctx2", "target=old", "ctx3", "ctx4"].join("\n") + "\n";
      const mod = ["header", "ctx1", "ctx2", "target=new", "ctx3", "ctx4"].join("\n") + "\n";
      const shifted = [
        "banner-1",
        "banner-2",
        "banner-3",
        "header",
        "ctx1",
        "ctx2",
        "target=old",
        "ctx3",
        "ctx4",
      ].join("\n") + "\n";

      await h.writeText("/off/base.txt", base);
      await h.writeText("/off/mod.txt", mod);
      await h.writeText("/off/shifted.txt", shifted);
      await h.exec("diff -u /off/base.txt /off/mod.txt > /off/change.patch");

      const res = await h.exec("patch /off/shifted.txt < /off/change.patch");
      assert.equal(res.exitCode, 0, res.stderr);
      const result = await h.readText("/off/shifted.txt");
      assert.ok(result.includes("banner-1\nbanner-2\nbanner-3\n"));
      assert.ok(result.includes("target=new\n"));
    });
  });

  it("10. diff3 -m performs clean 3-way merge when non-overlapping regions change in ours and theirs", async () => {
    await withE2EHarness({}, async (h) => {
      const base = ["line1", "line2", "line3", "line4", "line5", "line6", "line7"].join("\n") + "\n";
      const ours = ["line1-ours", "line2", "line3", "line4", "line5", "line6", "line7"].join("\n") + "\n";
      const theirs = ["line1", "line2", "line3", "line4", "line5", "line6", "line7-theirs"].join("\n") + "\n";

      await h.writeText("/m3/base.txt", base);
      await h.writeText("/m3/ours.txt", ours);
      await h.writeText("/m3/theirs.txt", theirs);

      const res = await h.exec("diff3 -m /m3/ours.txt /m3/base.txt /m3/theirs.txt");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["line1-ours", "line2", "line3", "line4", "line5", "line6", "line7-theirs"].join("\n") + "\n"
      );
    });
  });

  it("11. diff3 -m emits conflict markers and exits 1 on overlapping edits, supporting custom -L labels", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/m3/base.txt", "a\nshared\nc\n");
      await h.writeText("/m3/ours.txt", "a\nours-change\nc\n");
      await h.writeText("/m3/theirs.txt", "a\ntheirs-change\nc\n");

      const res = await h.exec(
        "diff3 -m -L HEAD -L BASE -L FEATURE /m3/ours.txt /m3/base.txt /m3/theirs.txt"
      );
      assert.equal(res.exitCode, 1);
      assert.match(res.stdout, /<<<<<<< HEAD/);
      assert.match(res.stdout, /ours-change/);
      assert.match(res.stdout, />>>>>>> FEATURE/);
    });
  });

  it("12. diff3 -e / -E / -x / -3 generates ed scripts for 3-way integration", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/ed3/base.txt", "one\ntwo\nthree\n");
      await h.writeText("/ed3/ours.txt", "ONE\ntwo\nthree\n");
      await h.writeText("/ed3/theirs.txt", "one\ntwo\nTHREE\n");

      const res = await h.exec("diff3 -e /ed3/ours.txt /ed3/base.txt /ed3/theirs.txt");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /THREE/);
    });
  });

  it("13. apply_patch adds, updates, and deletes files atomically in a single envelope", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/repo/keep.txt", "alpha\nbeta\ngamma\n");
      await h.writeText("/repo/obsolete.txt", "remove me\n");

      const patchEnvelope = [
        "*** Begin Patch",
        "*** Add File: /repo/added.txt",
        "+new line 1",
        "+new line 2",
        "*** Update File: /repo/keep.txt",
        "@@",
        " alpha",
        "-beta",
        "+beta-v2",
        " gamma",
        "*** Delete File: /repo/obsolete.txt",
        "*** End Patch",
      ].join("\n");
      await h.writeText("/tmp/env.patch", patchEnvelope + "\n");

      const res = await h.exec("apply_patch < /tmp/env.patch");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(await h.readText("/repo/added.txt"), "new line 1\nnew line 2\n");
      assert.equal(await h.readText("/repo/keep.txt"), "alpha\nbeta-v2\ngamma\n");
      assert.equal(await h.exists("/repo/obsolete.txt"), false);
    });
  });

  it("14. apply_patch supports *** Move to: with simultaneous content updates", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/repo/src/old-name.ts",
        ["export function greet() {", '  return "hi";', "}"].join("\n") + "\n"
      );

      const patchEnvelope = [
        "*** Begin Patch",
        "*** Update File: /repo/src/old-name.ts",
        "*** Move to: /repo/src/new-name.ts",
        "@@",
        " export function greet() {",
        '-  return "hi";',
        '+  return "hello world";',
        " }",
        "*** End Patch",
      ].join("\n");
      await h.writeText("/tmp/move.patch", patchEnvelope + "\n");

      const res = await h.exec("apply_patch < /tmp/move.patch");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(await h.exists("/repo/src/old-name.ts"), false);
      assert.equal(
        await h.readText("/repo/src/new-name.ts"),
        ["export function greet() {", '  return "hello world";', "}"].join("\n") + "\n"
      );
    });
  });

  it("15. apply_patch disambiguates identical blocks using @@ context anchors and *** End of File", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/repo/module.ts",
        [
          "class Alpha {",
          "  run() {",
          "    return 1;",
          "  }",
          "}",
          "class Beta {",
          "  run() {",
          "    return 1;",
          "  }",
          "}",
        ].join("\n") + "\n"
      );

      const patchEnvelope = [
        "*** Begin Patch",
        "*** Update File: /repo/module.ts",
        "@@ class Beta {",
        "   run() {",
        "-    return 1;",
        "+    return 2;",
        "   }",
        " }",
        "*** End of File",
        "*** End Patch",
      ].join("\n");
      await h.writeText("/tmp/anchor.patch", patchEnvelope + "\n");

      const res = await h.exec("apply_patch < /tmp/anchor.patch");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        await h.readText("/repo/module.ts"),
        [
          "class Alpha {",
          "  run() {",
          "    return 1;",
          "  }",
          "}",
          "class Beta {",
          "  run() {",
          "    return 2;",
          "  }",
          "}",
        ].join("\n") + "\n"
      );
    });
  });

  it("16. apply_patch preserves CRLF line endings when updating a CRLF-terminated file", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/repo/win.txt", "line1\r\nline2\r\nline3\r\n");

      const patchEnvelope = [
        "*** Begin Patch",
        "*** Update File: /repo/win.txt",
        "@@",
        " line1",
        "-line2",
        "+line2-crlf",
        " line3",
        "*** End Patch",
      ].join("\n");
      await h.writeText("/tmp/crlf.patch", patchEnvelope + "\n");

      const res = await h.exec("apply_patch < /tmp/crlf.patch");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(await h.readText("/repo/win.txt"), "line1\r\nline2-crlf\r\nline3\r\n");
    });
  });

  it("17. apply_patch rejects invalid envelopes and leaves existing files untouched on failure", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/repo/safe.txt", "keep-1\nkeep-2\n");

      const badPatch = [
        "*** Begin Patch",
        "*** Update File: /repo/safe.txt",
        "@@",
        "-nonexistent-line",
        "+replacement",
        "*** End Patch",
      ].join("\n");
      await h.writeText("/tmp/bad.patch", badPatch + "\n");

      const res = await h.exec("apply_patch < /tmp/bad.patch");
      assert.notEqual(res.exitCode, 0);
      assert.equal(await h.readText("/repo/safe.txt"), "keep-1\nkeep-2\n");
    });
  });

  it("18. cmp compares binary and text files with -s (silent), -l (byte offsets), and -n (byte limit)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeBytes("/bin/a.bin", new Uint8Array([0x10, 0x20, 0x30, 0x40]));
      await h.writeBytes("/bin/b.bin", new Uint8Array([0x10, 0x20, 0x99, 0x40]));

      const limitOk = await h.exec("cmp -s -n 2 /bin/a.bin /bin/b.bin");
      assert.equal(limitOk.exitCode, 0);

      const fullDiff = await h.exec("cmp -l /bin/a.bin /bin/b.bin");
      assert.equal(fullDiff.exitCode, 1);
      assert.match(fullDiff.stdout, /3\s+60\s+231/);
    });
  });

  it("19. end-to-end 3-way branch divergence, diff3 merge, diff verification, and tar release bundle", async () => {
    await withE2EHarness({}, async (h) => {
      const base = ["version=1.0.0", "port=8080", "workers=4", "tls=false"].join("\n") + "\n";
      const branchA = ["version=1.1.0", "port=8080", "workers=4", "tls=false"].join("\n") + "\n";
      const branchB = ["version=1.0.0", "port=8080", "workers=4", "tls=true"].join("\n") + "\n";

      await h.writeText("/branches/base/app.conf", base);
      await h.writeText("/branches/a/app.conf", branchA);
      await h.writeText("/branches/b/app.conf", branchB);

      const res = await h.exec(
        [
          "mkdir -p /branches/merged",
          "diff3 -m /branches/a/app.conf /branches/base/app.conf /branches/b/app.conf > /branches/merged/app.conf",
          "diff -u /branches/base/app.conf /branches/merged/app.conf > /branches/release.patch",
          "cat /branches/merged/app.conf",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["version=1.1.0", "port=8080", "workers=4", "tls=true"].join("\n") + "\n"
      );
    });
  });

  it("20. automated codemod pipeline generates apply_patch envelope via awk and applies across multiple files", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/codemod/a.ts", "const API = 'v1';\nexport default API;\n");
      await h.writeText("/codemod/b.ts", "const API = 'v1';\nconsole.log(API);\n");

      const res = await h.exec(
        [
          "{",
          "  echo '*** Begin Patch'",
          "  for f in /codemod/a.ts /codemod/b.ts; do",
          "    echo \"*** Update File: $f\"",
          "    echo '@@'",
          "    echo \"-const API = 'v1';\"",
          "    echo \"+const API = 'v2';\"",
          "  done",
          "  echo '*** End Patch'",
          "} | apply_patch",
          "grep -H API /codemod/a.ts /codemod/b.ts",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /\/codemod\/a\.ts:const API = 'v2';/);
      assert.match(res.stdout, /\/codemod\/b\.ts:const API = 'v2';/);
    });
  });
});
