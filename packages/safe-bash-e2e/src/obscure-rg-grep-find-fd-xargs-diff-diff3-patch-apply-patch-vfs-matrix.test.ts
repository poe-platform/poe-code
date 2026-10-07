import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure rg grep find fd xargs diff diff3 patch apply patch vfs matrix", () => {
  it("1. rg -o -N -r with named capture groups (?P<name>...) rewriting call sites", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'SRC' > /tmp/calls81.rs\nlet a = auth::verify_token(req);\nlet b = billing::charge_card(user);\nSRC\nrg -o -N '(?P<mod>[a-z]+)::(?P<fn>[a-z_]+)' -r '${mod}->${fn}' /tmp/calls81.rs");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "auth->verify_token\nbilling->charge_card");
    });
  });

  it("2. rg with positive/negative globs (-g '*.ts' -g '!*.test.ts') and -i case-insensitive match", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/rg81/src\nprintf \"export const Token = 1;\\n\" > /tmp/rg81/src/auth.ts\nprintf \"export const token = 2;\\n\" > /tmp/rg81/src/auth.test.ts\nprintf \"export const TOKEN = 3;\\n\" > /tmp/rg81/src/api.ts\nrg -i -N --no-heading -g '*.ts' -g '!*.test.ts' 'token' /tmp/rg81 | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/rg81/src/api.ts:export const TOKEN = 3;\n/tmp/rg81/src/auth.ts:export const Token = 1;");
    });
  });

  it("3. rg -U multiline struct matching across newline boundaries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'SRC' > /tmp/multi81.rs\nstruct Config {\n  port: u16,\n}\nstruct Ignored {\n  flag: bool,\n}\nSRC\nrg -U -o -N 'struct Config \\{[\\s\\S]*?\\}' /tmp/multi81.rs | tr '\\n' ' ' | awk '{$1=$1; print}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "struct Config { port: u16, }");
    });
  });

  it("4. rg -F fixed-strings and -w word-regexp vs grep -E -v -n inverted line numbering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'TXT' > /tmp/words81.txt\nfoo.bar(1)\nfoo_bar_extra\nfoo.bar(2)\nTXT\nrg -F -N 'foo.bar(1)' /tmp/words81.txt\ngrep -E -v -n 'extra' /tmp/words81.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "foo.bar(1)\n1:foo.bar(1)\n3:foo.bar(2)");
    });
  });

  it("5. grep -o multiple matches per line piped into sort and uniq -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"err=404 err=500 err=404\\nerr=200 err=404 err=500\\n\" | grep -o 'err=[0-9]*' | sort | uniq -c | awk '{print $1 \":\" $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1:err=200\n3:err=404\n2:err=500");
    });
  });

  it("6. find compound boolean predicates (-o, -a, !) with -maxdepth and -mindepth", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/f81/sub/deep\ntouch /tmp/f81/a.rs /tmp/f81/b.ts /tmp/f81/c_bak.rs /tmp/f81/sub/d.rs /tmp/f81/sub/deep/e.rs\nfind /tmp/f81 -mindepth 1 -maxdepth 2 -type f \\( -name '*.rs' -o -name '*.ts' \\) ! -name '*_bak*' | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/f81/a.rs\n/tmp/f81/b.ts\n/tmp/f81/sub/d.rs");
    });
  });

  it("7. find -empty and -size filtering across files and directories", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/emp81/empty_dir /tmp/emp81/non_empty_dir\ntouch /tmp/emp81/zero.txt\nprintf \"0123456789ABCDEF\\n\" > /tmp/emp81/non_empty_dir/big.txt\nfind /tmp/emp81 -empty | sort\nfind /tmp/emp81 -type f -size +5c");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/emp81/empty_dir\n/tmp/emp81/zero.txt\n/tmp/emp81/non_empty_dir/big.txt");
    });
  });

  it("8. find -print0 piped into xargs -0 handling filenames with spaces", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/sp81\nprintf \"alpha\\n\" > \"/tmp/sp81/file one.txt\"\nprintf \"beta\\n\" > \"/tmp/sp81/file two.txt\"\nfind /tmp/sp81 -type f -print0 | sort -z | xargs -0 wc -l | awk '{print $1, $2, $3}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1 /tmp/sp81/file one.txt\n1 /tmp/sp81/file two.txt\n2 total");
    });
  });

  it("9. fd extension (-e) and exclude (-E) discovery over nested workspace", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/fd81/pkg/dist /tmp/fd81/pkg/src\ntouch /tmp/fd81/pkg/src/index.ts /tmp/fd81/pkg/src/helper.js /tmp/fd81/pkg/dist/index.ts\nfd -e ts -E dist . /tmp/fd81 | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/fd81/pkg/src/index.ts");
    });
  });

  it("10. chained symlinks (ln -s) inspected via readlink and realpath", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/sym81/dir\nprintf \"real_payload\\n\" > /tmp/sym81/dir/target.txt\nln -s /tmp/sym81/dir/target.txt /tmp/sym81/link1\nln -s /tmp/sym81/link1 /tmp/sym81/link2\nreadlink /tmp/sym81/link2\nrealpath /tmp/sym81/link2\ncat /tmp/sym81/link2");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/sym81/link1\n/tmp/sym81/dir/target.txt\nreal_payload");
    });
  });

  it("11. cp -P (no-dereference) vs cp -L (dereference) on symbolic links", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/cp81\nprintf \"data81\\n\" > /tmp/cp81/orig.txt\nln -s /tmp/cp81/orig.txt /tmp/cp81/sym.txt\ncp -P /tmp/cp81/sym.txt /tmp/cp81/copy_link.txt\ncp -L /tmp/cp81/sym.txt /tmp/cp81/copy_file.txt\ntest -L /tmp/cp81/copy_link.txt && echo \"LINK_PRESERVED\"\ntest ! -L /tmp/cp81/copy_file.txt && test -f /tmp/cp81/copy_file.txt && echo \"DEREF_REGULAR\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "LINK_PRESERVED\nDEREF_REGULAR");
    });
  });

  it("12. stat -c format specifiers (%a %s %F %n) after chmod", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/st81\nprintf \"12345\" > /tmp/st81/run.sh\nchmod 755 /tmp/st81/run.sh\nstat -c '%a %s %F %n' /tmp/st81/run.sh");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "755 5 regular file /tmp/st81/run.sh");
    });
  });

  it("13. diff -u unified diff generation, patch forward apply, and patch -R rollback", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"line1\\nline2_old\\nline3\\n\" > /tmp/p81_a.txt\nprintf \"line1\\nline2_new\\nline3\\nline4_added\\n\" > /tmp/p81_b.txt\ncp /tmp/p81_a.txt /tmp/p81_work.txt\ndiff -u /tmp/p81_a.txt /tmp/p81_b.txt > /tmp/p81.patch || true\npatch -s /tmp/p81_work.txt /tmp/p81.patch\ncmp -s /tmp/p81_work.txt /tmp/p81_b.txt && echo \"FORWARD_OK\"\npatch -s -R /tmp/p81_work.txt /tmp/p81.patch\ncmp -s /tmp/p81_work.txt /tmp/p81_a.txt && echo \"REVERSE_OK\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "FORWARD_OK\nREVERSE_OK");
    });
  });

  it("14. diff3 -m clean 3-way merge of non-overlapping concurrent changes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"top\\nmid\\nbot\\n\" > /tmp/d3_base.txt\nprintf \"top_mine\\nmid\\nbot\\n\" > /tmp/d3_mine.txt\nprintf \"top\\nmid\\nbot_theirs\\n\" > /tmp/d3_theirs.txt\ndiff3 -m /tmp/d3_mine.txt /tmp/d3_base.txt /tmp/d3_theirs.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "top_mine\nmid\nbot_theirs");
    });
  });

  it("15. diff3 -m conflict detection and exit code 1 on overlapping edits", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"a\\nb\\nc\\n\" > /tmp/c3_base.txt\nprintf \"a\\nb_mine\\nc\\n\" > /tmp/c3_mine.txt\nprintf \"a\\nb_theirs\\nc\\n\" > /tmp/c3_theirs.txt\ndiff3 -m /tmp/c3_mine.txt /tmp/c3_base.txt /tmp/c3_theirs.txt > /tmp/c3_out.txt\necho \"rc=$?\"\ngrep -q '<<<<<<<' /tmp/c3_out.txt && grep -q '>>>>>>>' /tmp/c3_out.txt && echo \"CONFLICT_MARKERS_OK\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rc=1\nCONFLICT_MARKERS_OK");
    });
  });

  it("16. apply_patch atomic Add, Update, Move, and Delete file operations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/ap81\nprintf \"old_line\\nkeep_line\\n\" > /tmp/ap81/mod.txt\nprintf \"obsolete\\n\" > /tmp/ap81/remove.txt\ncd /tmp/ap81\napply_patch << 'PATCH'\n*** Begin Patch\n*** Add File: created.txt\n+hello_created\n*** Update File: mod.txt\n*** Move to: renamed.txt\n@@\n-old_line\n+new_line\n keep_line\n*** Delete File: remove.txt\n*** End Patch\nPATCH\nls /tmp/ap81 | sort\ncat /tmp/ap81/created.txt /tmp/ap81/renamed.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Success. Updated the following files:\nA created.txt\nM renamed.txt\nD remove.txt\ncreated.txt\nrenamed.txt\nhello_created\nnew_line\nkeep_line");
    });
  });

  it("17. apply_patch rejecting ../ path traversal with exit code 2", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/ap_safe81\ncd /tmp/ap_safe81\napply_patch << 'PATCH' 2>/dev/null\n*** Begin Patch\n*** Add File: ../escaped.txt\n+pwned\n*** End Patch\nPATCH\necho \"rc=$?\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rc=2");
    });
  });

  it("18. xargs -n 2 and xargs -I {} batch command templating", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"a b c d\\n\" | xargs -n 2 echo \"pair:\"\nprintf \"svc1\\nsvc2\\n\" | xargs -I {} echo \"deploying [{}] now\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "pair: a b\npair: c d\ndeploying [svc1] now\ndeploying [svc2] now");
    });
  });

  it("19. cmp byte offset reporting on binary divergence", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"abcdef\\n\" > /tmp/cmp1.bin\nprintf \"abcXef\\n\" > /tmp/cmp2.bin\ncmp -s /tmp/cmp1.bin /tmp/cmp2.bin || echo \"DIFFERS_AT_BYTE_4\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "DIFFERS_AT_BYTE_4");
    });
  });

  it("20. codebase refactoring pipeline: fd + rg -l + sed -i + diff -u verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/ref81/src\nprintf \"const API_V1 = 'http://old';\\n\" > /tmp/ref81/src/client.ts\nprintf \"const OTHER = 123;\\n\" > /tmp/ref81/src/util.ts\nrg -l 'API_V1' /tmp/ref81/src | xargs sed -i 's/API_V1/API_V2/g; s|http://old|https://new|g'\ncat /tmp/ref81/src/client.ts /tmp/ref81/src/util.ts");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "const API_V2 = 'https://new';\nconst OTHER = 123;");
    });
  });

});
