import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure rg grep find fd xargs diff patch vfs symlinks perms matrix", () => {
  it("01 chained relative symlinks with readlink -f and realpath resolution", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p vfs/real/sub vfs/links/nested\nprintf 'target_payload\\n' > vfs/real/sub/data.txt\nln -s ../../real/sub/data.txt vfs/links/nested/hop1\nln -s nested/hop1 vfs/links/hop2\nprintf \"hop2_target=%s\\n\" \"$(readlink vfs/links/hop2)\"\nprintf \"canon=%s\\n\" \"$(readlink -f vfs/links/hop2)\"\nprintf \"real=%s\\n\" \"$(realpath vfs/links/hop2)\"\ncat vfs/links/hop2");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "hop2_target=nested/hop1\ncanon=/workspace/vfs/real/sub/data.txt\nreal=/workspace/vfs/real/sub/data.txt\ntarget_payload\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 cp -P no-dereference vs cp -L dereference on symbolic links", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p cp_test\nprintf 'immutable_v1\\n' > cp_test/orig.txt\nln -s orig.txt cp_test/link.txt\ncp -P cp_test/link.txt cp_test/copy_sym.txt\ncp -L cp_test/link.txt cp_test/copy_reg.txt\nstat -c '%n:%F' cp_test/copy_sym.txt cp_test/copy_reg.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "cp_test/copy_sym.txt:symbolic link\ncp_test/copy_reg.txt:regular file\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 install -D -m nested directory creation and permission mode verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf '#!/bin/sh\\necho deployed\\n' > runner.sh\ninstall -D -m 750 runner.sh opt/app/bin/runner.sh\nstat -c '%a %F %n' opt/app/bin/runner.sh\ncat opt/app/bin/runner.sh");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "750 regular file opt/app/bin/runner.sh\n#!/bin/sh\necho deployed\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 chmod symbolic and octal modes with find -perm -mode and /mode filtering", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p perms\ntouch perms/pub.txt perms/exec_all.sh perms/exec_usr.sh\nchmod 644 perms/pub.txt\nchmod 755 perms/exec_all.sh\nchmod 700 perms/exec_usr.sh\necho \"ALL_EXEC:\"\nfind perms -type f -perm -111 | sort\necho \"ANY_EXEC:\"\nfind perms -type f -perm /111 | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ALL_EXEC:\nperms/exec_all.sh\nANY_EXEC:\nperms/exec_all.sh\nperms/exec_usr.sh\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 find compound boolean predicates with parentheses -o -not -size and -empty", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p ftree/src ftree/docs ftree/empty_d\nprintf '12345678901234567890\\n' > ftree/src/big.ts\nprintf 'tiny\\n' > ftree/src/small.ts\nprintf '' > ftree/docs/empty.md\necho \"EMPTY:\"\nfind ftree -empty | sort\necho \"NON_EMPTY_TS:\"\nfind ftree -type f -name '*.ts' -not -empty | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "EMPTY:\nftree/docs/empty.md\nftree/empty_d\nNON_EMPTY_TS:\nftree/src/big.ts\nftree/src/small.ts\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 fd --no-ignore-parent vs parent .gitignore with -H and -t filters", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p parent_repo/sub_pkg\nprintf '*.log\\n' > parent_repo/.gitignore\nprintf 'debug_trace\\n' > parent_repo/sub_pkg/app.log\nprintf 'code\\n' > parent_repo/sub_pkg/main.ts\necho \"DEFAULT_IGNORE:\"\n(cd parent_repo/sub_pkg && fd . | sort)\necho \"NO_IGNORE_PARENT:\"\n(cd parent_repo/sub_pkg && fd --no-ignore-parent . | sort)");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "DEFAULT_IGNORE:\nmain.ts\nNO_IGNORE_PARENT:\napp.log\nmain.ts\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 fd -t x executable and -t e empty filtering with --format template", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p fd_types\nprintf '#!/bin/sh\\n' > fd_types/tool.sh\nchmod 755 fd_types/tool.sh\nprintf '' > fd_types/blank.txt\nprintf 'content\\n' > fd_types/normal.txt\necho \"EXEC:\"\nfd -t x --format '{/}' . fd_types | sort\necho \"EMPTY:\"\nfd -t e --format '{/}' . fd_types | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "EXEC:\ntool.sh\nEMPTY:\nblank.txt\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 rg glob inclusion/exclusion -g and context lines -C", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p rg_ws/src rg_ws/test\ncat << 'TXT' > rg_ws/src/engine.ts\nline1_init\nline2_TARGET_match\nline3_done\nTXT\ncat << 'TXT' > rg_ws/test/engine.test.ts\ntest1\ntest2_TARGET_match\ntest3\nTXT\nrg -N -g '!*.test.ts' -C 1 'TARGET' rg_ws");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rg_ws/src/engine.ts-line1_init\nrg_ws/src/engine.ts:line2_TARGET_match\nrg_ws/src/engine.ts-line3_done\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 rg --files-with-matches and --files-without-match across source tree", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p rg_f\nprintf 'has_token_alpha\\n' > rg_f/a.txt\nprintf 'only_beta\\n' > rg_f/b.txt\nprintf 'has_token_alpha_2\\n' > rg_f/c.txt\necho \"WITH:\"\nrg -l 'alpha' rg_f | sort\necho \"WITHOUT:\"\nrg --files-without-match 'alpha' rg_f | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "WITH:\nrg_f/a.txt\nrg_f/c.txt\nWITHOUT:\nrg_f/b.txt\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 grep -E -o on pipe-delimited patterns and grep -v -w whole-word exclusion", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > table_pipe.txt\n|Header1|Header2|\n|val_a|val_b|\n|skip_row|ignore|\nTXT\ngrep -v -w 'skip_row' table_pipe.txt | grep -o '|[^|]*|'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "|Header1|\n|val_a|\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 find -print0 piped to xargs -0 -I {} batch transformation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p sp_dir\nprintf 'alpha\\n' > \"sp_dir/file one.txt\"\nprintf 'beta\\n' > \"sp_dir/file two.txt\"\nfind sp_dir -type f -print0 | sort -z | xargs -0 -I {} sh -c 'printf \"%s=%s\\n\" \"$1\" \"$(cat \"$1\")\"' _ {}");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sp_dir/file one.txt=alpha\nsp_dir/file two.txt=beta\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 diff -y --suppress-common-lines side-by-side comparison", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > v1.txt\nsame_1\nold_val_2\nsame_3\nold_val_4\nTXT\ncat << 'TXT' > v2.txt\nsame_1\nnew_val_2\nsame_3\nnew_val_4\nTXT\ndiff -y --suppress-common-lines v1.txt v2.txt | awk '{print $1, $2, $3}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "old_val_2 | new_val_2\nold_val_4 | new_val_4\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 multi-hunk patch application with line offset shift", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > base_code.py\ndef alpha():\n    return 1\n\ndef beta():\n    return 2\n\ndef gamma():\n    return 3\nTXT\ncp base_code.py mod_code.py\nsed -i 's/return 1/return 10/; s/return 3/return 30/' mod_code.py\ndiff -u base_code.py mod_code.py > update.patch || true\n{\n  echo \"# Added header comment 1\"\n  echo \"# Added header comment 2\"\n  cat base_code.py\n} > shifted_code.py\npatch shifted_code.py < update.patch >/dev/null\ncat shifted_code.py");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "# Added header comment 1\n# Added header comment 2\ndef alpha():\n    return 10\n\ndef beta():\n    return 2\n\ndef gamma():\n    return 30\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 apply_patch Move to file rename with content edit", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p src/old\ncat << 'TS' > src/old/util.ts\nexport function calc(x: number) {\n  return x + 1;\n}\nTS\napply_patch << 'PATCH'\n*** Begin Patch\n*** Update File: src/old/util.ts\n*** Move to: src/new/math.ts\n@@\n export function calc(x: number) {\n-  return x + 1;\n+  return x * 2;\n }\n*** End Patch\nPATCH\ntest ! -e src/old/util.ts && echo \"OLD_REMOVED\"\ncat src/new/math.ts");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Success. Updated the following files:\nM src/new/math.ts\nOLD_REMOVED\nexport function calc(x: number) {\n  return x * 2;\n}\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 apply_patch path traversal and symlink target rejection with exit code 2", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf 'secret\\n' > outside.txt\nln -s outside.txt sym_target.txt\nset +e\napply_patch << 'PATCH' 2>/dev/null\n*** Begin Patch\n*** Update File: ../escape.txt\n@@\n-a\n+b\n*** End Patch\nPATCH\nrc_trav=$?\napply_patch << 'PATCH' 2>/dev/null\n*** Begin Patch\n*** Update File: sym_target.txt\n@@\n-secret\n+hacked\n*** End Patch\nPATCH\nrc_sym=$?\nprintf \"rc_trav=%d rc_sym=%d outside=%s\\n\" \"$rc_trav\" \"$rc_sym\" \"$(cat outside.txt)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc_trav=2 rc_sym=1 outside=secret\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 tree and du directory hierarchy and size reporting", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p proj/src proj/docs\nprintf '1234567890\\n' > proj/src/app.rs\nprintf 'readme\\n' > proj/docs/README.md\ntree proj | grep -E '(src|docs|app\\.rs|README\\.md)' | wc -l | tr -d ' '");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "4\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 comm -12 intersection and comm -23 difference on sorted manifests", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > m_a.txt\npkg-auth\npkg-core\npkg-db\npkg-ui\nTXT\ncat << 'TXT' > m_b.txt\npkg-core\npkg-metrics\npkg-ui\nTXT\necho \"COMMON:\"\ncomm -12 m_a.txt m_b.txt\necho \"ONLY_A:\"\ncomm -23 m_a.txt m_b.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "COMMON:\npkg-core\npkg-ui\nONLY_A:\npkg-auth\npkg-db\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 cmp byte-level comparison and exit status on identical vs differing files", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf 'hello_world\\n' > f1.bin\nprintf 'hello_world\\n' > f2.bin\nprintf 'hello_earth\\n' > f3.bin\ncmp -s f1.bin f2.bin && echo \"F1_F2_SAME\"\ncmp -s f1.bin f3.bin || echo \"F1_F3_DIFF:$?\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "F1_F2_SAME\nF1_F3_DIFF:1\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 pathchk POSIX portability validation on valid and invalid paths", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("pathchk \"valid/posix_path-1.0/file.txt\" && echo \"VALID_OK\"\nif pathchk \"\" 2>/dev/null; then\n  echo \"EMPTY_UNEXPECTED\"\nelse\n  echo \"EMPTY_REJECTED:$?\"\nfi");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "VALID_OK\nEMPTY_REJECTED:1\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 end-to-end VFS audit: fd + stat + rg + awk + sha256sum manifest", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p release/bin release/conf\nprintf '#!/bin/sh\\necho v1\\n' > release/bin/server\nchmod 755 release/bin/server\nprintf 'env=prod\\n' > release/conf/settings.ini\nchmod 644 release/conf/settings.ini\nfor f in $(fd -t f . release | sort); do\n  perm=$(stat -c '%a' \"$f\")\n  sz=$(stat -c '%s' \"$f\")\n  sum=$(sha256sum \"$f\" | awk '{print substr($1, 1, 12)}')\n  printf \"%s|%s|%s|%s\\n\" \"$f\" \"$perm\" \"$sz\" \"$sum\"\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "release/bin/server|755|18|667f61a069b7\nrelease/conf/settings.ini|644|9|bd7bda28cc12\n");
    } finally {
      await h.dispose();
    }
  });

});
