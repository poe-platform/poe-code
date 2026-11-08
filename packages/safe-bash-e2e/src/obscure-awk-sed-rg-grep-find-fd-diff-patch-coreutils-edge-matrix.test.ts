import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure awk sed rg grep find fd diff patch coreutils edge matrix", () => {
  it("01 awk ENVIRON custom RS and OFS reconstruction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("export AWK_TAG=\"prod\"\nprintf 'a b;c d;' | awk 'BEGIN { RS=\";\"; OFS=\"|\" } { $1=$1; print ENVIRON[\"AWK_TAG\"] \":\" $0 }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "prod:a|b\nprod:c|d");
    });
  });

  it("02 awk multi-branch if else if else and sprintf precision", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'alice 95\\nbob 75\\ncarol 50\\n' | awk '{\n  if ($2 >= 90) tier = \"GOLD\";\n  else if ($2 >= 70) tier = \"SILVER\";\n  else tier = \"BRONZE\";\n  printf \"%.3s:%+05d:%s\\n\", $1, $2 - 75, tier;\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ali:+0020:GOLD\nbob:+0000:SILVER\ncar:-0025:BRONZE");
    });
  });

  it("03 sed BRE backreferences case conversion and pipe alternation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'foo-123|bar-456\\n' | sed -e 's/\\([a-z]*\\)-\\([0-9]*\\)/\\U\\1\\E:\\2/g' -e 's/|/ :: /'\nprintf 'cat\\ndog\\nbird\\n' | sed 's/cat\\|dog/PET/'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "FOO:123 :: BAR:456\nPET\nPET\nbird");
    });
  });

  it("04 sed n next line command and semicolon in regex address", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf ';comment\\nkeep1\\nskip_after_keep1\\nkeep2\\nskip_after_keep2\\n' | sed -e '/^;/d' -e 'n;d'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "keep1\nkeep2");
    });
  });

  it("05 grep E o F v i and count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'ERR-101: disk full\\nwarn-202: high cpu\\nERR-303: timeout\\n' > sys.log\ngrep -E -o 'ERR-[0-9]+' sys.log\ngrep -F -v -i 'err-' sys.log\ngrep -c 'ERR-' sys.log");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ERR-101\nERR-303\nwarn-202: high cpu\n2");
    });
  });

  it("06 rg named capture groups replacement", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'dep: serde-1.0.9\\ndep: tokio-1.35.0\\n' > deps.txt\nrg --no-heading -o '(?P<pkg>[a-z]+)-(?P<ver>[0-9.]+)' -r '$pkg@$ver' deps.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "serde@1.0.9\ntokio@1.35.0");
    });
  });

  it("07 fd --and multi-pattern and --no-ignore-parent", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p parent_ig/sub\nprintf '*.log\\n' > parent_ig/.gitignore\ntouch parent_ig/sub/auth_service.log parent_ig/sub/auth_helper.ts parent_ig/sub/db_service.ts\nfd auth --and service parent_ig/sub\nfd --no-ignore-parent auth --and service parent_ig/sub");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "parent_ig/sub/auth_service.log");
    });
  });

  it("08 find empty type maxdepth and stat format", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p st_dir\nprintf '12345\\n' > st_dir/nonempty.txt\ntouch st_dir/empty.txt\nchmod 640 st_dir/nonempty.txt\nfind st_dir -maxdepth 1 -type f -empty\nstat -c '%a %s %F %n' st_dir/nonempty.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "st_dir/empty.txt\n640 6 regular file st_dir/nonempty.txt");
    });
  });

  it("09 xargs batching -n 2 and placeholder -I", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a b c d\\n' | xargs -n 2 echo \"pair:\"\nprintf 'one\\ntwo\\n' | xargs -I {} echo \"item=[{}]\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "pair: a b\npair: c d\nitem=[one]\nitem=[two]");
    });
  });

  it("10 install directory and mode with tree", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("install -d inst_root/bin inst_root/etc\nprintf '#!/bin/sh\\necho ok\\n' > src_bin.sh\ninstall -m 755 src_bin.sh inst_root/bin/tool\nstat -c '%a' inst_root/bin/tool\nfind inst_root -type f");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "755\ninst_root/bin/tool");
    });
  });

  it("11 sort version human-numeric and uniq count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'v1.10\\nv1.2\\nv1.1\\n' | sort -V | paste -sd ',' -\nprintf '2M\\n500\\n10K\\n' | sort -h | paste -sd ',' -\nprintf 'a\\nb\\na\\na\\nb\\n' | sort | uniq -c | awk '{print $1 \":\" $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "v1.1,v1.2,v1.10\n500,10K,2M\n3:a\n2:b");
    });
  });

  it("12 cut output-delimiter paste empty delimiter and tr squeeze", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'u1:alice:admin\\nu2:bob:dev\\n' | cut -d':' -f1,3 --output-delimiter='|'\nprintf 'X\\nY\\nZ\\n' | paste -sd '' -\nprintf 'a   b    c\\n' | tr -s ' ' ':'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "u1|admin\nu2|dev\nXYZ\na:b:c");
    });
  });

  it("13 nl zero-padded numbering rev and tac", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'first\\nsecond\\n' | nl -ba -n rz -w 3 -s ':' | tac | rev");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "dnoces:200\ntsrif:100");
    });
  });

  it("14 column table alignment and fold word wrap", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'k,v\\nshort,1\\nlonger_key,2\\n' | column -t -s ','\nprintf 'alpha beta gamma delta\\n' | fold -w 11 -s");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "k           v\nshort       1\nlonger_key  2\nalpha beta \ngamma delta");
    });
  });

  it("15 expand and unexpand custom tabstop", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a\\tb\\n' | expand -t 4 | wc -c | tr -d ' '\nprintf '    indented\\n' | unexpand -t 4 | od -An -tx1 | tr -s ' ' | sed 's/^ //; s/ $//'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "6\n09 69 6e 64 65 6e 74 65 64 0a");
    });
  });

  it("16 date UTC epoch format specifiers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("date -u -d '@1700000000' '+%Y-%m-%d %H:%M:%S u=%u j=%j'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2023-11-14 22:13:20 u=2 j=318");
    });
  });

  it("17 seq formatted string and pathchk portable", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("seq -f 'node-%03g' 1 2 5\npathchk -p 'valid/file-1.txt' && echo \"path_ok\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "node-001\nnode-003\nnode-005\npath_ok");
    });
  });

  it("18 which command -v and type -t discovery", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("my_fn() { :; }\ntype -t my_fn\ntype -t declare\ntype -t jq\nwhich qpdf ffmpeg sqlite3 | wc -l | tr -d ' '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "function\nbuiltin\nfile\n3");
    });
  });

  it("19 timeout command execution and exit code propagation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("timeout 5 sh -c 'echo \"timed_run_ok\"'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "timed_run_ok");
    });
  });

  it("20 diff rg awk bc and sed churn audit report", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a\\nb\\nc\\nd\\n' > v1.txt\nprintf 'a\\nB1\\nB2\\nc\\n' > v2.txt\ndiff -u v1.txt v2.txt > diff.txt || true\nadds=$(grep -E '^\\+[^+]' diff.txt | wc -l | tr -d ' ')\ndels=$(grep -E '^-[^-]' diff.txt | wc -l | tr -d ' ')\ntotal=$(expr \"$adds\" + \"$dels\")\necho \"adds=$adds|dels=$dels|total=$total\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "adds=2|dels=2|total=4");
    });
  });

});
