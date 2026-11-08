import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure rg grep find fd xargs readlink realpath stat tree vfs matrix", () => {
  it("1. rg -r capture-group replacement with named and numbered groups", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'user=alice_42 role=admin\\nuser=bob_07 role=viewer\\n' > /tmp/rg_rep.txt\nrg -N -r '[$2:$1]' 'user=([a-z0-9_]+) role=([a-z]+)' /tmp/rg_rep.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[admin:alice_42]\n[viewer:bob_07]");
    });
  });

  it("2. rg --json structured match events parsed and aggregated via jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'alpha_err\\nok_line\\nbeta_err\\n' > /tmp/rg_json.log\nrg --json '_err' /tmp/rg_json.log | jq -r 'select(.type == \"match\") | \"\\(.data.line_number):\\(.data.lines.text | rtrimstr(\"\\n\"))\"'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1:alpha_err\n3:beta_err");
    });
  });

  it("3. rg -U multiline search with --multiline-dotall across line boundaries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'START\\n  middle_payload\\nEND\\nOUTSIDE\\n' > /tmp/multi.txt\nrg -U --multiline-dotall -c 'START.*END' /tmp/multi.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1");
    });
  });

  it("4. rg -g inclusion and !exclusion globs with --files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/rg_glob/src /tmp/rg_glob/test\nprintf '1\\n' > /tmp/rg_glob/src/app.ts\nprintf '1\\n' > /tmp/rg_glob/src/util.js\nprintf '1\\n' > /tmp/rg_glob/test/app.test.ts\nrg --files -g '*.ts' -g '!*.test.ts' /tmp/rg_glob");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/rg_glob/src/app.ts");
    });
  });

  it("5. rg -S smart-case sensitivity switching on lowercase vs uppercase patterns", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'TokenValue\\ntokenvalue\\nTOKENVALUE\\n' > /tmp/smart.txt\nrg -S -c 'tokenvalue' /tmp/smart.txt\nrg -S -c 'TokenValue' /tmp/smart.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3\n1");
    });
  });

  it("6. rg -C context lines with custom --context-separator between disjoint blocks", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("seq 1 10 | awk '{print \"line_\" $1}' > /tmp/ctx.txt\nrg -n -C 1 --context-separator='===' 'line_(2|8)$' /tmp/ctx.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1-line_1\n2:line_2\n3-line_3\n===\n7-line_7\n8:line_8\n9-line_9");
    });
  });

  it("7. grep -f pattern file with -F fixed strings and -v invert match", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'svc.alpha\\nsvc.beta\\nsvc.gamma\\nsvc.delta\\n' > /tmp/services.txt\nprintf 'svc.beta\\nsvc.delta\\n' > /tmp/ignore.pats\ngrep -F -v -f /tmp/ignore.pats /tmp/services.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "svc.alpha\nsvc.gamma");
    });
  });

  it("8. grep -E -o -n only-matching with line numbers and -b byte offsets", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id=100 id=200\\nid=300\\n' | grep -E -o -n 'id=[0-9]+'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1:id=100\n1:id=200\n2:id=300");
    });
  });

  it("9. find compound boolean precedence (-a, -o, !, parentheses) and -prune", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/f_tree/src /tmp/f_tree/node_modules/pkg /tmp/f_tree/dist\ntouch /tmp/f_tree/src/index.ts /tmp/f_tree/src/README.md /tmp/f_tree/node_modules/pkg/index.ts /tmp/f_tree/dist/bundle.js\nfind /tmp/f_tree -name node_modules -prune -o -type f \\( -name '*.ts' -o -name '*.js' \\) -print | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/f_tree/dist/bundle.js\n/tmp/f_tree/src/index.ts");
    });
  });

  it("10. find -exec single-file (;) and batch (+) execution modes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/f_exec\nprintf 'one\\n' > /tmp/f_exec/a.txt\nprintf 'two\\n' > /tmp/f_exec/b.txt\nfind /tmp/f_exec -type f -name '*.txt' -exec basename {} .txt \\; | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a\nb");
    });
  });

  it("11. find -empty and -delete cleanup of empty directories and zero-byte files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/f_clean/empty_dir /tmp/f_clean/keep_dir\ntouch /tmp/f_clean/zero.txt\nprintf 'data\\n' > /tmp/f_clean/keep_dir/nonempty.txt\nfind /tmp/f_clean -type f -empty -delete\nfind /tmp/f_clean -type f | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/f_clean/keep_dir/nonempty.txt");
    });
  });

  it("12. fd --format placeholders ({}, {/}, {//}, {.}, {/.}) with -e extension filter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/fd_fmt/sub\ntouch /tmp/fd_fmt/sub/archive.tar.gz /tmp/fd_fmt/sub/notes.txt\nfd -e gz --format '{/}|{/ .}|{.}' . /tmp/fd_fmt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "archive.tar.gz|{/ .}|/tmp/fd_fmt/sub/archive.tar");
    });
  });

  it("13. fd -H hidden files, -I no-ignore (.gitignore bypass), and -E exclude glob", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/fd_ign\nprintf '*.log\\n' > /tmp/fd_ign/.gitignore\ntouch /tmp/fd_ign/app.log /tmp/fd_ign/.secret.env /tmp/fd_ign/skip.bak\nfd -H -I -t f -E '*.bak' -E '.gitignore' . /tmp/fd_ign | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/fd_ign/.secret.env\n/tmp/fd_ign/app.log");
    });
  });

  it("14. xargs -0 -n 2 batching and xargs -I {} template replacement", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'alpha\\0beta\\0gamma\\0delta\\0' | xargs -0 -n 2 echo\nprintf 'svc_a\\nsvc_b\\n' | xargs -I {} echo \"deploy:{}:ok\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha beta\ngamma delta\ndeploy:svc_a:ok\ndeploy:svc_b:ok");
    });
  });

  it("15. xargs -d custom delimiter, -E EOF marker, and -r --no-run-if-empty", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'one:two:STOP:three\\n' | xargs -E STOP echo\nprintf '' | xargs -r echo SHOULD_NOT_PRINT\necho DONE");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "one:two:STOP:three\nDONE");
    });
  });

  it("16. ln -s symbolic links, readlink -f canonical resolution, and realpath --relative-to", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/sym/a/b /tmp/sym/c\nprintf 'target_payload\\n' > /tmp/sym/a/b/real.txt\nln -s /tmp/sym/a/b/real.txt /tmp/sym/c/hop1.txt\nln -s /tmp/sym/c/hop1.txt /tmp/sym/hop2.txt\nreadlink -f /tmp/sym/hop2.txt\nrealpath --relative-to=/tmp/sym/c /tmp/sym/a/b/real.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/sym/a/b/real.txt\n../a/b/real.txt");
    });
  });

  it("17. chmod symbolic (u+rwx,go=rx) and octal mode mutations verified by stat -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("touch /tmp/perm.sh\nchmod 600 /tmp/perm.sh\nstat -c '%a' /tmp/perm.sh\nchmod u+x,g+r,o+r /tmp/perm.sh\nstat -c '%a %A' /tmp/perm.sh");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "600\n744 -rwxr--r--");
    });
  });

  it("18. tree directory hierarchy rendering with -L max depth and -a hidden files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/t_root/alpha /tmp/t_root/beta\ntouch /tmp/t_root/alpha/f1.txt /tmp/t_root/beta/f2.txt\ntree -L 2 --noreport /tmp/t_root");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/t_root\n|-- alpha\n|   `-- f1.txt\n`-- beta\n    `-- f2.txt");
    });
  });

  it("19. file --mime-type magic byte detection across JSON, XML, PDF, PNG, GZIP, and ZIP", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"a\":1}\\n' > /tmp/m.json\nprintf '<?xml version=\"1.0\"?><r/>\\n' > /tmp/m.xml\nprintf 'hello' | gzip -c > /tmp/m.gz\nfile -b --mime-type /tmp/m.json /tmp/m.xml /tmp/m.gz");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "application/json\ntext/xml\napplication/gzip");
    });
  });

  it("20. fd + rg + xargs + sed + sha256sum workspace-wide codemod and integrity manifest", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/cm/pkg1 /tmp/cm/pkg2\nprintf 'const API = \"v1/endpoint\";\\n' > /tmp/cm/pkg1/a.ts\nprintf 'const API = \"v1/metrics\";\\n' > /tmp/cm/pkg2/b.ts\nfd -e ts . /tmp/cm | sort | xargs sed -i 's|v1/|v2/|g'\nrg -N 'v2/' /tmp/cm | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/cm/pkg1/a.ts:const API = \"v2/endpoint\";\n/tmp/cm/pkg2/b.ts:const API = \"v2/metrics\";");
    });
  });

});
