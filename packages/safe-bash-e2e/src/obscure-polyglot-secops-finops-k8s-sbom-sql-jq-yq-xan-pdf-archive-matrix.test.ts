import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure polyglot secops finops k8s sbom sql jq yq xan pdf archive matrix", () => {
  it("01 k8s pod manifest yq extraction to sqlite3 resource quota compliance audit", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'YAML' > pods.yaml\nitems:\n  - metadata:\n      name: api-01\n      namespace: prod\n    spec:\n      cpu_m: 1500\n      mem_mi: 2048\n  - metadata:\n      name: api-02\n      namespace: prod\n    spec:\n      cpu_m: 2000\n      mem_mi: 4096\n  - metadata:\n      name: worker-01\n      namespace: batch\n    spec:\n      cpu_m: 4000\n      mem_mi: 8192\nYAML\nyq -o=json '.items' pods.yaml | jq -r '.[] | [.metadata.name, .metadata.namespace, .spec.cpu_m, .spec.mem_mi] | @csv' > pods.csv\nsqlite3 k8s.db << 'SQL'\nCREATE TABLE pods (name TEXT, ns TEXT, cpu_m INT, mem_mi INT);\n.mode csv\n.import pods.csv pods\n.mode list\nSELECT ns, COUNT(*) AS pod_cnt, SUM(cpu_m) AS total_cpu_m, SUM(mem_mi) AS total_mem_mi FROM pods GROUP BY ns ORDER BY ns;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "batch|1|4000|8192\nprod|2|3500|6144\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 cyclonedx sbom jq component extraction joined with cve advisory csv via xan", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > sbom.json\n{\n  \"bomFormat\": \"CycloneDX\",\n  \"components\": [\n    {\"name\": \"openssl\", \"version\": \"3.0.1\", \"purl\": \"pkg:deb/openssl@3.0.1\"},\n    {\"name\": \"zlib\", \"version\": \"1.2.13\", \"purl\": \"pkg:deb/zlib@1.2.13\"},\n    {\"name\": \"curl\", \"version\": \"8.4.0\", \"purl\": \"pkg:deb/curl@8.4.0\"}\n  ]\n}\nJSON\ncat << 'CSV' > cves.csv\npkg_name,cve_id,cvss\nopenssl,CVE-2026-1001,9.1\ncurl,CVE-2026-2044,8.4\nlibxml2,CVE-2026-3099,7.5\nCSV\n{\n  echo \"pkg_name,version,purl\"\n  jq -r '.components[] | [.name, .version, .purl] | @csv' sbom.json\n} > sbom_pkgs.csv\nxan join pkg_name sbom_pkgs.csv pkg_name cves.csv | xan sort -s cvss -N -R | xan select pkg_name,version,cve_id,cvss");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "pkg_name,version,cve_id,cvss\nopenssl,3.0.1,CVE-2026-1001,9.1\ncurl,8.4.0,CVE-2026-2044,8.4\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 finops cloud billing multi-currency normalization with awk bc and csvsql", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' >aws_spend.csv\naccount,service,currency,cost\nacct-prod,ec2,USD,1200\nacct-prod,rds,EUR,500\nacct-ml,sagemaker,USD,2400\nacct-ml,s3,GBP,400\nCSV\nawk -F, 'NR==1 { print \"account,service,usd_cost\"; next }\n{\n  rate = ($3 == \"EUR\" ? 1.10 : ($3 == \"GBP\" ? 1.25 : 1.00));\n  printf \"%s,%s,%d\\n\", $1, $2, $4 * rate\n}' aws_spend.csv > normalized_spend.csv\ncsvsql --query \"SELECT account, COUNT(*) AS services, CAST(SUM(usd_cost) AS INT) AS total_usd FROM normalized_spend GROUP BY account ORDER BY total_usd DESC\" normalized_spend.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "account,services,total_usd\nacct-ml,2,2900\nacct-prod,2,1750\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 access log forensics with rg awk sed and jq incident summary JSON", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'LOG' > edge.log\n2026-10-06T10:00:01Z ip=198.51.100.7 path=/admin status=403 ua=\"scanner/1.0\"\n2026-10-06T10:00:02Z ip=203.0.113.5 path=/v1/items status=200 ua=\"app/2.1\"\n2026-10-06T10:00:03Z ip=198.51.100.7 path=/wp-login.php status=401 ua=\"scanner/1.0\"\n2026-10-06T10:00:04Z ip=198.51.100.7 path=/etc/passwd status=403 ua=\"scanner/1.0\"\n2026-10-06T10:00:05Z ip=192.0.2.99 path=/admin status=403 ua=\"bot/0.9\"\nLOG\nrg -N 'status=(401|403)' edge.log | sed -E 's/.*ip=([^ ]+) path=([^ ]+) status=([0-9]+).*/\\1|\\2|\\3/' | awk -F'|' '{ cnt[$1]++; last_path[$1]=$2 } END { for (ip in cnt) printf \"%s\\t%d\\t%s\\n\", ip, cnt[ip], last_path[ip] }' | sort -k2,2nr | jq -R -s 'split(\"\\n\") | map(select(length > 0) | split(\"\\t\") | {ip: .[0], blocked_hits: (.[1] | tonumber), last_target: .[2]})' | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"ip\":\"198.51.100.7\",\"blocked_hits\":3,\"last_target\":\"/etc/passwd\"},{\"ip\":\"192.0.2.99\",\"blocked_hits\":1,\"last_target\":\"/admin\"}]\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 xml junit test report xmllint + xq analysis piped to sqlite3 failure rate", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'XML' > junit.xml\n<testsuites>\n  <testsuite name=\"auth-suite\" tests=\"10\" failures=\"2\" time=\"4.5\"/>\n  <testsuite name=\"billing-suite\" tests=\"20\" failures=\"0\" time=\"8.1\"/>\n  <testsuite name=\"search-suite\" tests=\"15\" failures=\"3\" time=\"6.2\"/>\n</testsuites>\nXML\nxq -c '.testsuites.testsuite[] | {suite: .[\"@name\"], tests: (.[\"@tests\"] | tonumber), failures: (.[\"@failures\"] | tonumber)}' junit.xml | jq -s '.' | in2csv -f json > suites.csv\nsqlite3 qa.db << 'SQL'\n.mode csv\n.import suites.csv suites\n.mode list\nSELECT suite, tests, failures, ROUND(100.0 * failures / tests, 1) AS fail_pct FROM suites WHERE CAST(failures AS INT) > 0 ORDER BY fail_pct DESC;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "auth-suite|10|2|20.0\nsearch-suite|15|3|20.0\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 html status dashboard scraping with htmlq to markdown and yq config export", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > dash.html\n<html><body>\n  <h1>Edge Status Report</h1>\n  <div class=\"region\" data-id=\"us-east\"><span class=\"state\">healthy</span></div>\n  <div class=\"region\" data-id=\"eu-west\"><span class=\"state\">degraded</span></div>\n  <div class=\"region\" data-id=\"ap-south\"><span class=\"state\">healthy</span></div>\n</body></html>\nHTML\ntitle=$(htmlq --text \"h1\" < dash.html)\n{\n  printf \"report_title: %s\\nregions:\\n\" \"$title\"\n  for id in us-east eu-west ap-south; do\n    st=$(htmlq --text \"div.region[data-id=\\\"$id\\\"] span.state\" < dash.html)\n    printf \"  %s: %s\\n\" \"$id\" \"$st\"\n  done\n} | yq -o=json '.' | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"report_title\":\"Edge Status Report\",\"regions\":{\"us-east\":\"healthy\",\"eu-west\":\"degraded\",\"ap-south\":\"healthy\"}}\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 monorepo build graph scheduling with jq tsort and awk stage assignment", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > repo_deps.json\n{\n  \"packages\": [\n    {\"name\": \"cli\", \"deps\": [\"sdk\", \"ui\"]},\n    {\"name\": \"sdk\", \"deps\": [\"core\", \"http\"]},\n    {\"name\": \"ui\", \"deps\": [\"core\"]},\n    {\"name\": \"http\", \"deps\": [\"core\"]},\n    {\"name\": \"core\", \"deps\": []}\n  ]\n}\nJSON\njq -r '.packages[] | .name as $pkg | .deps[] | \"\\(.) \\($pkg)\"' repo_deps.json | tsort | nl -w 1 -s ':'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1:core\n2:http\n3:ui\n4:sdk\n5:cli\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 config drift detection with jq -S normalization diff -u and patch remediation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > desired.json\n{\"replicas\": 4, \"tls\": true, \"region\": \"us-east-1\", \"timeout_ms\": 2500}\nJSON\ncat << 'JSON' > live.json\n{\"region\": \"us-east-1\", \"replicas\": 2, \"timeout_ms\": 5000, \"tls\": true}\nJSON\njq -S '.' desired.json > desired.norm.json\njq -S '.' live.json > live.norm.json\ndiff -u live.norm.json desired.norm.json > drift.patch || true\npatch live.norm.json < drift.patch >/dev/null\njq -c '.' live.norm.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"region\":\"us-east-1\",\"replicas\":4,\"timeout_ms\":2500,\"tls\":true}\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 executive compliance PDF report generation from sqlite3 and wkhtmltopdf", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 audit.db << 'SQL'\nCREATE TABLE controls (id TEXT, status TEXT);\nINSERT INTO controls VALUES ('SOC2-CC1', 'PASS'), ('SOC2-CC2', 'PASS'), ('SOC2-CC3', 'WARN');\nSQL\nrows=$(sqlite3 audit.db \"SELECT '<p>' || id || ': ' || status || '</p>' FROM controls ORDER BY id;\")\ncat << HTML > report.html\n<html><head><title>SOC2 Audit Summary</title></head><body><h1>SOC2 Audit Summary</h1>$rows</body></html>\nHTML\nwkhtmltopdf --title \"SOC2 Audit Summary\" report.html report.pdf\nqpdf --linearize report.pdf report_final.pdf\npdfinfo report_final.pdf | grep -E '^(Title|Pages|Optimized):' | awk '{$1=$1; print}'\npdftotext report_final.pdf - | tr -d '\\f' | tr -s ' \\n' ' '\necho \"\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Title: SOC2 Audit Summary\nPages: 1\nOptimized: yes\nSOC2 Audit Summary SOC2-CC1: PASS SOC2-CC2: PASS SOC2-CC3: WARN \n");
    } finally {
      await h.dispose();
    }
  });

  it("10 architecture diagram mmdc rendering embedded into release bundle with sha256sum", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'MMD' > arch.mmd\ngraph TD\n  Client --> Gateway\n  Gateway --> Auth\n  Gateway --> Billing\nMMD\nmmdc -i arch.mmd -o arch.svg\nmmdc -i arch.mmd -o arch.png\nidentify -format \"%m\\n\" arch.png\nsha256sum arch.svg arch.png > arch.sha256\nsha256sum -c arch.sha256");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG\narch.svg: OK\narch.png: OK\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 sqlite3 window analytics with DENSE_RANK and cumulative SUM exported to xan", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 sales_win.db << 'SQL'\nCREATE TABLE deals (rep TEXT, quarter TEXT, arr INT);\nINSERT INTO deals VALUES\n  ('alice', 'Q1', 120),\n  ('alice', 'Q2', 180),\n  ('bob', 'Q1', 90),\n  ('bob', 'Q2', 160);\n\nSQL\nsqlite3 -header -csv sales_win.db \"SELECT rep, quarter, arr, SUM(arr) OVER (PARTITION BY rep ORDER BY quarter) AS running_arr, DENSE_RANK() OVER (ORDER BY arr DESC) AS deal_rank FROM deals ORDER BY rep, quarter;\" | tr -d \"\\r\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rep,quarter,arr,running_arr,deal_rank\nalice,Q1,120,120,3\nalice,Q2,180,300,1\nbob,Q1,90,90,4\nbob,Q2,160,250,2\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 multi-file code refactoring with fd rg apply_patch and git-style diff check", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p pkg/api pkg/worker\ncat << 'TS' > pkg/api/client.ts\nexport const API_VERSION = \"v1\";\nexport function endpoint(path: string) { return `/${API_VERSION}${path}`; }\nTS\ncat << 'TS' > pkg/worker/sync.ts\nimport { API_VERSION } from \"../api/client\";\nexport const WORKER_TAG = `worker-${API_VERSION}`;\nTS\napply_patch << 'PATCH'\n*** Begin Patch\n*** Update File: pkg/api/client.ts\n@@\n-export const API_VERSION = \"v1\";\n+export const API_VERSION = \"v2\";\n export function endpoint(path: string) { return `/${API_VERSION}${path}`; }\n*** End Patch\nPATCH\nrg -N 'API_VERSION' pkg/ | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Success. Updated the following files:\nM pkg/api/client.ts\npkg/api/client.ts:export const API_VERSION = \"v2\";\npkg/api/client.ts:export function endpoint(path: string) { return `/${API_VERSION}${path}`; }\npkg/worker/sync.ts:export const WORKER_TAG = `worker-${API_VERSION}`;\npkg/worker/sync.ts:import { API_VERSION } from \"../api/client\";\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 xan multi-step ETL: from json -> map -> filter -> groupby -> sort -> to json", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > telemetry.json\n[\n  {\"host\": \" db-01 \", \"az\": \"use1-a\", \"iops\": 1200, \"err\": 0},\n  {\"host\": \"db-02\", \"az\": \"use1-a\", \"iops\": 1800, \"err\": 2},\n  {\"host\": \"db-03\", \"az\": \"use1-b\", \"iops\": 900, \"err\": 0},\n  {\"host\": \"db-04\", \"az\": \"use1-b\", \"iops\": 2100, \"err\": 1}\n]\nJSON\nxan from -f json telemetry.json | xan map 'trim(host) as clean_host, iops * 2 as peak_iops' | xan filter 'peak_iops >= 2000' | xan groupby az 'count() as nodes, sum(peak_iops) as total_peak' | xan sort -s az");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "az,nodes,total_peak\nuse1-a,2,6000\nuse1-b,1,4200\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 sed and awk stateful INI-to-JSON configuration compiler", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'INI' > server.ini\n[database]\nhost=db.prod.internal\nport=5432\n\n[cache]\nhost=redis.prod.internal\nport=6379\nINI\nawk -F= '\n  /^\\[.*\\]$/ {\n    sec = substr($0, 2, length($0) - 2);\n    next\n  }\n  NF == 2 {\n    printf \"%s\\t%s\\t%s\\n\", sec, $1, $2\n  }\n' server.ini | jq -R -s '\n  split(\"\\n\")\n  | map(select(length > 0) | split(\"\\t\"))\n  | reduce .[] as $row ({}; .[$row[0]][$row[1]] = (try ($row[2] | tonumber) catch $row[2]))\n' | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"database\":{\"host\":\"db.prod.internal\",\"port\":5432},\"cache\":{\"host\":\"redis.prod.internal\",\"port\":6379}}\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 archive forensics: tar + gzip + base64 transport + sha256sum + unzip/tar verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p bundle/conf bundle/bin\nprintf 'port=8080\\n' > bundle/conf/app.conf\nprintf '#!/bin/sh\\necho ok\\n' > bundle/bin/run.sh\nchmod 755 bundle/bin/run.sh\ntar -czf - bundle | base64 -w 0 > bundle.tgz.b64\nmkdir -p unpack\nbase64 -d bundle.tgz.b64 | tar -xzf - -C unpack\ncat unpack/bundle/conf/app.conf\nstat -c '%a' unpack/bundle/bin/run.sh");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "port=8080\n755\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 sqlite3 FTS5 full-text search combined with jq post-processing", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 ':memory:' << 'SQL' | jq -c '.'\nCREATE VIRTUAL TABLE kb USING fts5(doc_id, title, body);\nINSERT INTO kb VALUES\n  ('KB-101', 'Zero Trust Auth', 'Configure mutual TLS certificates and JWT rotation'),\n  ('KB-102', 'Database Failover', 'Promote standby replica during primary outage'),\n  ('KB-103', 'API Gateway TLS', 'Enable TLS 1.3 cipher suites and mutual authentication');\n.mode json\nSELECT doc_id, title FROM kb WHERE kb MATCH 'TLS' ORDER BY doc_id;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"doc_id\":\"KB-101\",\"title\":\"Zero Trust Auth\"},{\"doc_id\":\"KB-103\",\"title\":\"API Gateway TLS\"}]\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 csvkit pipeline: in2csv + csvcut + csvgrep + csvsort + csvjson", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > alerts.json\n[\n  {\"id\": \"AL-1\", \"service\": \"payments\", \"severity\": \"critical\", \"mttr_min\": 18},\n  {\"id\": \"AL-2\", \"service\": \"search\", \"severity\": \"warning\", \"mttr_min\": 5},\n  {\"id\": \"AL-3\", \"service\": \"auth\", \"severity\": \"critical\", \"mttr_min\": 9},\n  {\"id\": \"AL-4\", \"service\": \"billing\", \"severity\": \"critical\", \"mttr_min\": 27}\n]\nJSON\nin2csv alerts.json | csvgrep -c severity -m critical | csvsort -c mttr_min -r | csvcut -c id,service,mttr_min | csvjson | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"id\":\"AL-4\",\"service\":\"billing\",\"mttr_min\":27.0},{\"id\":\"AL-1\",\"service\":\"payments\",\"mttr_min\":18.0},{\"id\":\"AL-3\",\"service\":\"auth\",\"mttr_min\":9.0}]\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 media asset pipeline: magick + exiftool + ffmpeg + zip package", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("magick -size 64x64 xc:navy cover.jpg\nexiftool -overwrite_original -Artist=\"Release Team\" cover.jpg >/dev/null\nffmpeg -f lavfi -i sine=frequency=880:sample_rate=8000 -t 1 -y chime.wav 2>/dev/null\nzip -q media_pack.zip cover.jpg chime.wav\nunzip -l media_pack.zip | grep -E '(cover\\.jpg|chime\\.wav)' | awk '{print $NF}' | sort\nprintf \"artist=%s\\n\" \"$(exiftool -s3 -Artist cover.jpg)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "chime.wav\ncover.jpg\nartist=Release Team\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 jq reduce foreach and tonumber error recovery over heterogeneous stream", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > stream.json\n[\n  {\"k\": \"a\", \"v\": \"10\"},\n  {\"k\": \"b\", \"v\": \"invalid\"},\n  {\"k\": \"a\", \"v\": \"25\"},\n  {\"k\": \"c\", \"v\": 15},\n  {\"k\": \"b\", \"v\": \"40\"}\n]\nJSON\njq -c 'reduce .[] as $item ({}; .[$item.k] = ((.[$item.k] // 0) + (try ($item.v | tonumber) catch 0)))' stream.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"a\":35,\"b\":40,\"c\":15}\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 full-stack release gate verification combining sql jq yq xan tar and checksums", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'YAML' > release.yaml\nversion: 4.2.0\nartifacts:\n  - name: core.wasm\n    size_kb: 512\n    ready: true\n  - name: cli.js\n    size_kb: 128\n    ready: true\n  - name: experimental.wasm\n    size_kb: 256\n    ready: false\nYAML\nyq -o=json '.' release.yaml | jq -r '.artifacts[] | select(.ready == true) | [.name, .size_kb] | @csv' > ready.csv\nsqlite3 gate.db << 'SQL'\nCREATE TABLE ready_arts (name TEXT, size_kb INT);\n.mode csv\n.import ready.csv ready_arts\n.mode list\nSELECT COUNT(*) || ' artifacts (' || SUM(size_kb) || ' KB)' FROM ready_arts;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "2 artifacts (640 KB)\n");
    } finally {
      await h.dispose();
    }
  });

});
