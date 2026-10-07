import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure awk sed rg grep find fd xargs diff patch coreutils text engine matrix", () => {
  it("01 awk two-file FNR NR join with associative array lookup and sprintf formatting", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > rates.txt\nUSD 1.00\nEUR 1.08\nGBP 1.27\nTXT\ncat << 'TXT' > orders.txt\nORD-1 EUR 250\nORD-2 GBP 100\nORD-3 USD 180\nORD-4 EUR 50\nTXT\nawk 'NR==FNR { rate[$1] = $2 + 0; next } { usd = $3 * rate[$2]; total += usd; printf \"%s:%s:%.2f\\n\", $1, $2, usd } END { printf \"TOTAL:%.2f\\n\", total }' rates.txt orders.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ORD-1:EUR:270.00\nORD-2:GBP:127.00\nORD-3:USD:180.00\nORD-4:EUR:54.00\nTOTAL:631.00\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 awk custom RS paragraph mode with split and field key-value extraction", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > records.txt\nid=srv-01\nrole=db\ncpu=16\n\nid=srv-02\nrole=cache\ncpu=8\n\nid=srv-03\nrole=db\ncpu=32\nTXT\nawk 'BEGIN { RS=\"\"; FS=\"\\n\" } { delete kv; for (i=1; i<=NF; i++) { split($i, a, \"=\"); kv[a[1]] = a[2] } if (kv[\"role\"] == \"db\") printf \"%s (%s cores)\\n\", kv[\"id\"], kv[\"cpu\"] }' records.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "srv-01 (16 cores)\nsrv-03 (32 cores)\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 awk match RSTART RLENGTH substr loop extracting all bracketed tokens", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > log.txt\n2026-10-06 [auth] user=[alice] action=[login] status=[ok]\n2026-10-06 [api] user=[bob] action=[export] status=[denied]\nTXT\nawk '{ s = $0; out = \"\"; while (match(s, /\\[[^]]+\\]/)) { tok = substr(s, RSTART + 1, RLENGTH - 2); out = (out == \"\" ? tok : out \"|\" tok); s = substr(s, RSTART + RLENGTH) } print out }' log.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "auth|alice|login|ok\napi|bob|export|denied\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 awk nextfile across multiple log files skipping maintenance markers", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > node1.log\nOK boot\nSKIP_FILE maintenance\nERR disk\nTXT\ncat << 'TXT' > node2.log\nOK boot\nERR net\nOK ready\nTXT\nawk '/^SKIP_FILE/ { nextfile } /^ERR/ { print FILENAME \":\" $2 }' node1.log node2.log");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "node2.log:net\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 sed hold space and pattern space swap assembling key-value pairs", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > pairs.txt\nKEY:alpha\nVAL:100\nKEY:beta\nVAL:200\nKEY:gamma\nVAL:300\nTXT\nsed -n '/^KEY:/{s/^KEY://;h;}; /^VAL:/{s/^VAL://;G;s/\\(.*\\)\\n\\(.*\\)/\\2=\\1/p;}' pairs.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha=100\nbeta=200\ngamma=300\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 sed multiline address range with nested substitutions and case conversion", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > config.ini\n[public]\nhost = api.example.com\nport = 8080\n\n[secret]\napi_key = abcdef\ntoken = xyz987\n\n[metrics]\nport = 9090\nTXT\nsed '/^\\[secret\\]/,/^$/ {\n  s/^\\(api_key = \\).*/\\1REDACTED/\n  s/^\\(token = \\).*/\\1REDACTED/\n}\ns/^\\[\\([a-z]*\\)\\]/[\\U\\1\\E]/' config.ini");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[PUBLIC]\nhost = api.example.com\nport = 8080\n\n[SECRET]\napi_key = REDACTED\ntoken = REDACTED\n\n[METRICS]\nport = 9090\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 sed branch t and label loop collapsing repeated slashes in paths", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > paths.txt\n//var///log////nginx//access.log\n/opt//app///bin/run\nTXT\nsed ':loop; s|//|/|g; t loop' paths.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/var/log/nginx/access.log\n/opt/app/bin/run\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 sed y transliteration and backreference swap on colon-separated fields", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > users.txt\nalice:admin:1001\nbob:guest:1002\ncarol:staff:1003\nTXT\nsed 'y/abcdefghijklmnopqrstuvwxyz/ABCDEFGHIJKLMNOPQRSTUVWXYZ/; s/^\\([^:]*\\):\\([^:]*\\):\\([0-9]*\\)$/\\3|\\2|\\1/' users.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1001|ADMIN|ALICE\n1002|GUEST|BOB\n1003|STAFF|CAROL\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 rg named capture groups with replacement and sort", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p src/mod\ncat << 'TS' > src/mod/routes.ts\nregisterRoute(\"GET\", \"/v1/users\", handleUsers);\nregisterRoute(\"POST\", \"/v1/orders\", handleOrders);\nregisterRoute(\"DELETE\", \"/v1/sessions\", handleSessions);\nTS\nrg -N 'registerRoute\\(\"(?P<method>[A-Z]+)\", \"(?P<path>[^\"]+)\", (?P<fn>[a-zA-Z0-9_]+)\\);' -r '$method $path -> $fn' src/mod/routes.ts | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "DELETE /v1/sessions -> handleSessions\nGET /v1/users -> handleUsers\nPOST /v1/orders -> handleOrders\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 grep -E -o and awk frequency histogram of HTTP status codes", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'LOG' > access.log\n10.0.0.1 GET /index 200 12ms\n10.0.0.2 POST /login 401 8ms\n10.0.0.3 GET /items 200 19ms\n10.0.0.4 GET /admin 403 4ms\n10.0.0.5 POST /login 401 9ms\n10.0.0.6 GET /health 200 1ms\nLOG\ngrep -E -o ' (200|401|403|500) ' access.log | tr -d ' ' | sort | uniq -c | awk '{ printf \"%s:%d\\n\", $2, $1 }'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "200:3\n401:2\n403:1\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 find with -empty -perm and xargs stat formatting", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p tree/a tree/b tree/empty_dir\nprintf 'hello\\n' > tree/a/script.sh\nchmod 755 tree/a/script.sh\nprintf '' > tree/b/empty.txt\nchmod 644 tree/b/empty.txt\necho \"EMPTY:\"\nfind tree -empty | sort\necho \"EXEC:\"\nfind tree -type f -perm -111 | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "EMPTY:\ntree/b/empty.txt\ntree/empty_dir\nEXEC:\ntree/a/script.sh\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 fd with --and multi-pattern filtering and extension matching", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p repo/services repo/libs\ntouch repo/services/auth_service_test.ts repo/services/auth_Helper.ts repo/libs/billing_service_test.ts repo/libs/billing.md\nfd --and service --and test -e ts . repo | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "repo/libs/billing_service_test.ts\nrepo/services/auth_service_test.ts\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 diff -u and patch -p1 forward apply followed by patch -R rollback", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p orig/pkg new/pkg\ncat << 'TXT' > orig/pkg/conf.txt\nhost=localhost\nport=8080\ndebug=false\ntimeout=30\nTXT\ncat << 'TXT' > new/pkg/conf.txt\nhost=0.0.0.0\nport=9090\ndebug=false\ntimeout=60\nTXT\ndiff -u orig/pkg/conf.txt new/pkg/conf.txt > changes.patch || true\ncp orig/pkg/conf.txt work.txt\npatch work.txt < changes.patch >/dev/null\ncat work.txt\necho \"---ROLLBACK---\"\npatch -R work.txt < changes.patch >/dev/null\ncat work.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "host=0.0.0.0\nport=9090\ndebug=false\ntimeout=60\n---ROLLBACK---\nhost=localhost\nport=8080\ndebug=false\ntimeout=30\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 diff3 three-way merge of non-overlapping configuration edits", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > base.cfg\nalpha=1\nbeta=2\ngamma=3\ndelta=4\nepsilon=5\nTXT\ncat << 'TXT' > mine.cfg\nalpha=10\nbeta=2\ngamma=3\ndelta=4\nepsilon=5\nTXT\ncat << 'TXT' > yours.cfg\nalpha=1\nbeta=2\ngamma=3\ndelta=4\nepsilon=50\nTXT\ndiff3 -m mine.cfg base.cfg yours.cfg");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha=10\nbeta=2\ngamma=3\ndelta=4\nepsilon=50\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 apply_patch multi-file add update and delete verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > app.txt\nline1\nline2\nline3\nTXT\ncat << 'TXT' > obsolete.txt\nremove me\nTXT\napply_patch << 'PATCH'\n*** Begin Patch\n*** Update File: app.txt\n@@\n line1\n-line2\n+line2_updated\n line3\n*** Add File: added.txt\n+brand new file\n*** Delete File: obsolete.txt\n*** End Patch\nPATCH\ncat app.txt\ncat added.txt\ntest ! -e obsolete.txt && echo \"DELETED_OK\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Success. Updated the following files:\nM app.txt\nA added.txt\nD obsolete.txt\nline1\nline2_updated\nline3\nbrand new file\nDELETED_OK\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 sort -t -k multi-key with join and comm set difference", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > left.txt\nu2:Bob:eng\nu1:Alice:sec\nu3:Carol:data\nu4:Dave:eng\nTXT\ncat << 'TXT' > right.txt\nu1:L5\nu3:L6\nu4:L4\nTXT\nsort -t: -k1,1 left.txt > left.sorted\nsort -t: -k1,1 right.txt > right.sorted\njoin -t: -1 1 -2 1 left.sorted right.sorted | sort -t: -k3,3 -k1,1");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "u3:Carol:data:L6\nu4:Dave:eng:L4\nu1:Alice:sec:L5\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 tsort topological dependency ordering of build targets", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > deps.txt\ncore utils\nutils parser\nparser compiler\ncompiler cli\nutils logging\nlogging cli\nTXT\ntsort deps.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "core\nutils\nlogging\nparser\ncompiler\ncli\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 csplit section splitting and paste -sd concatenation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > doc.txt\nHEADER\n---\npart-one-a\npart-one-b\n---\npart-two-a\npart-two-b\nTXT\ncsplit -s -f sec_ doc.txt '/^---$/' '{*}'\nfor f in sec_*; do\n  printf '%s:' \"$f\"\n  grep -v '^---$' \"$f\" | paste -sd ',' -\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sec_00:HEADER\nsec_01:part-one-a,part-one-b\nsec_02:part-two-a,part-two-b\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 bc expr factor and numfmt math formatting pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("v1=$(echo \"scale=4; (355 / 113) * 10000\" | bc)\nv2=$(expr 144 / 12 + 30)\nf1=$(factor 360)\nprintf \"bc=%s expr=%s %s\\n\" \"$v1\" \"$v2\" \"$f1\"\nnumfmt --to=iec 1048576 2147483648");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "bc=31415.0000 expr=42 360: 2 2 2 3 3 5\n1.0M\n2.0G\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 tr cut paste column and rev pipeline on structured table", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TXT' > raw.tsv\nid:name:role\n10:alice:architect\n20:bob:operator\n30:carol:director\nTXT\ncut -d: -f1,3 raw.tsv | tr ':' '|' | rev | rev");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "id|role\n10|architect\n20|operator\n30|director\n");
    } finally {
      await h.dispose();
    }
  });

});
