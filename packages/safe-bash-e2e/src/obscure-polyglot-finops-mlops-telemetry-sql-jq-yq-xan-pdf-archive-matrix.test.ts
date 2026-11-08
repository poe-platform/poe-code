import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure polyglot finops mlops telemetry sql jq yq xan pdf archive matrix", () => {
  it("01 finops cloud billing xan yq and sqlite3 variance alert", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > spend.csv\nservice,env,cost,tax\ncompute,prod,400,40\nstorage,prod,100,10\ncompute,dev,80,8\nCSV\ncat << 'YAML' > budgets.yaml\nbudgets:\n  - env: prod\n    cap: 500\n  - env: dev\n    cap: 100\nYAML\nxan map 'cost + tax as total' spend.csv | xan groupby env 'sum(total) as actual' - > actuals.csv\nyq -o=csv '.budgets' budgets.yaml > caps.csv\nxan join env actuals.csv env caps.csv | xan map 'actual - cap as overage' - | xan filter 'overage > 0' - | xan select env,actual,cap,overage -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "env,actual,cap,overage\nprod,550,500,50");
    });
  });

  it("02 mlops experiment tracking jsonl jq and column table", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'JSONL' > runs.jsonl\n{\"model\":\"resnet\",\"loss\":0.24,\"acc\":91.2}\n{\"model\":\"vit\",\"loss\":0.18,\"acc\":94.5}\n{\"model\":\"resnet\",\"loss\":0.21,\"acc\":92.8}\n{\"model\":\"vit\",\"loss\":0.22,\"acc\":93.1}\nJSONL\njq -s -r '\n  group_by(.model)\n  | map({model: .[0].model, best_acc: (map(.acc) | max), min_loss: (map(.loss) | min)})\n  | sort_by(.best_acc) | reverse\n  | ([\"MODEL\",\"BEST_ACC\",\"MIN_LOSS\"], (.[] | [.model, (.best_acc|tostring), (.min_loss|tostring)]))\n  | @tsv\n' runs.jsonl | column -t");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "MODEL   BEST_ACC  MIN_LOSS\nvit     94.5      0.18\nresnet  92.8      0.21");
    });
  });

  it("03 opentelemetry span tree recursive cte critical path", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 traces.db \"\n  CREATE TABLE spans (span_id TEXT, parent_id TEXT, svc TEXT, dur_ms INT);\n  INSERT INTO spans VALUES ('s1', NULL, 'gateway', 15), ('s2', 's1', 'auth', 25), ('s3', 's1', 'checkout', 40), ('s4', 's3', 'db', 60);\n  WITH RECURSIVE chain(id, path, total_ms) AS (\n    SELECT span_id, svc, dur_ms FROM spans WHERE parent_id IS NULL\n    UNION ALL\n    SELECT s.span_id, c.path || '->' || s.svc, c.total_ms + s.dur_ms\n    FROM chain c JOIN spans s ON s.parent_id = c.id\n  )\n  SELECT path, total_ms FROM chain ORDER BY total_ms DESC LIMIT 1;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "gateway->checkout->db|115");
    });
  });

  it("04 helm values yq eval-all deep merge and envsubst", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'replicaCount: 2\\nimage:\\n  tag: v1.0\\n  pullPolicy: IfNotPresent\\n' > values.base.yaml\nprintf 'replicaCount: 5\\nimage:\\n  tag: $RELEASE_TAG\\n' > values.prod.yaml\nexport RELEASE_TAG=\"v2.4.0\"\nenvsubst '$RELEASE_TAG' < values.prod.yaml > values.prod.resolved.yaml\nyq ea -o=json 'select(fileIndex == 0) * select(fileIndex == 1)' values.base.yaml values.prod.resolved.yaml | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"replicaCount\":5,\"image\":{\"tag\":\"v2.4.0\",\"pullPolicy\":\"IfNotPresent\"}}");
    });
  });

  it("05 release patch diff patch rg tar zstd and sha256sum", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p rel_tree\nprintf 'version = \"1.0.0\"\\nchannel = \"stable\"\\n' > rel_tree/Cargo.toml\nprintf 'version = \"1.1.0\"\\nchannel = \"stable\"\\n' > Cargo.toml.new\ndiff -u rel_tree/Cargo.toml Cargo.toml.new > bump.patch\npatch -s rel_tree/Cargo.toml < bump.patch\nrg -o '1\\.1\\.0' rel_tree/Cargo.toml\ntar --zstd -cf release.tar.zst rel_tree\nsha256sum release.tar.zst > release.sha256\nsha256sum -c release.sha256");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1.1.0\nrelease.tar.zst: OK");
    });
  });

  it("06 log anomaly sed strip and awk 5xx error rate ranking", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'LOG' > access.log\n[2026-03-01T10:00:00Z] GET /api/orders 200 12ms\n[2026-03-01T10:00:01Z] POST /api/pay 502 140ms\n[2026-03-01T10:00:02Z] POST /api/pay 500 95ms\n[2026-03-01T10:00:03Z] GET /api/orders 200 11ms\n[2026-03-01T10:00:04Z] GET /api/auth 503 80ms\n[2026-03-01T10:00:05Z] GET /api/auth 200 9ms\nLOG\nsed 's/^\\[[^]]*\\] //' access.log | awk '\n  { total[$2]++; if ($3 >= 500) err[$2]++ }\n  END {\n    for (ep in total) {\n      e = (ep in err) ? err[ep] : 0;\n      printf \"%s %.1f%%\\n\", ep, (e * 100.0) / total[ep];\n    }\n  }\n' | sort -k2,2nr");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/api/pay 100.0%\n/api/auth 50.0%\n/api/orders 0.0%");
    });
  });

  it("07 financial ledger window running balance and reconciliation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 ledger.db \"\n  CREATE TABLE entries (tx_id INT, acct TEXT, delta INT);\n  INSERT INTO entries VALUES (1,'operating',1000),(2,'operating',-250),(3,'operating',400),(4,'reserve',500),(5,'reserve',-100);\n  SELECT acct, tx_id, delta, SUM(delta) OVER (PARTITION BY acct ORDER BY tx_id) AS running_bal\n  FROM entries ORDER BY acct, tx_id;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "operating|1|1000|1000\noperating|2|-250|750\noperating|3|400|1150\nreserve|4|500|500\nreserve|5|-100|400");
    });
  });

  it("08 htmlq scrape metric cards to jq in2csv and csvstat", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' > dash.html\n<div class=\"metrics\">\n  <div class=\"kpi\" data-val=\"120\">us-east</div>\n  <div class=\"kpi\" data-val=\"180\">eu-west</div>\n  <div class=\"kpi\" data-val=\"90\">ap-south</div>\n</div>\nHTML\nhtmlq --attribute data-val '.kpi' < dash.html > vals.txt\nhtmlq --text '.kpi' < dash.html > names.txt\npaste -d ',' names.txt vals.txt | sed '1i\\region,rps' > metrics.csv\ncsvstat --sum -c rps metrics.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "390");
    });
  });

  it("09 multi-format config migration toml yaml props json", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'TOML' > service.toml\n[database]\nhost = \"db.internal\"\nport = 5432\nTOML\nyq -p=toml -o=yaml '.' service.toml | yq -o=props '.' | yq -p=props -o=json '.' | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"database\":{\"host\":\"db.internal\",\"port\":\"5432\"}}");
    });
  });

  it("10 executive pdf briefing xan sqlite3 wkhtmltopdf qpdf exiftool", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'region,rev\\nNA,500\\nEU,420\\nAPAC,310\\n' > kpi.csv\ntop_reg=$(xan sort -R -N -s rev kpi.csv | xan head -l 1 - | xan select region - | tail -n 1)\nprintf \"<h1>Top Region: %s</h1>\\n\" \"$top_reg\" > brief.html\nwkhtmltopdf -q brief.html brief.pdf\nqpdf --linearize brief.pdf brief_lin.pdf\nexiftool -overwrite_original -Author=\"FinOpsBot\" brief_lin.pdf >/dev/null\nexiftool -s3 -Author brief_lin.pdf\npdftotext brief_lin.pdf - | grep -o 'Top Region: NA'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "FinOpsBot\nTop Region: NA");
    });
  });

  it("11 binary packet construction xxd dd od and base64", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '484541445041594c4f414421' | xxd -r -p > pkt.bin\ndd if=pkt.bin of=hdr.bin bs=4 count=1 2>/dev/null\ndd if=pkt.bin of=body.bin bs=4 skip=1 count=2 2>/dev/null\ncat hdr.bin\necho \"\"\ncat body.bin\necho \"\"\nbase64 -w 0 body.bin\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "HEAD\nPAYLOAD!\nUEFZTE9BRCE=");
    });
  });

  it("12 dependency dag jq tsort and nl build schedule", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'JSON' > workspace.json\n{\"edges\":[[\"core\",\"cli\"],[\"utils\",\"core\"],[\"cli\",\"e2e\"]]}\nJSON\njq -r '.edges[] | \"\\(.[0]) \\(.[1])\"' workspace.json | tsort | nl -w 1 -s ':'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1:utils\n2:core\n3:cli\n4:e2e");
    });
  });

  it("13 sqlite3 schema evolution trigger and csv import audit", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,sku,qty\\n10,A1,5\\n20,B2,12\\n' > inv_batch.csv\nsqlite3 wh.db \"\n  CREATE TABLE stock (id INT, item_code TEXT, qty INT);\n  ALTER TABLE stock RENAME COLUMN item_code TO sku;\n  CREATE TABLE events (evt TEXT);\n  CREATE TRIGGER tr_stock AFTER INSERT ON stock BEGIN\n    INSERT INTO events VALUES (NEW.sku || '=' || NEW.qty);\n  END;\n\"\nsqlite3 wh.db \".mode csv\" \".import --skip 1 inv_batch.csv stock\"\nsqlite3 wh.db \"SELECT json_group_array(evt) FROM events;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[\"A1=5\",\"B2=12\"]");
    });
  });

  it("14 media asset pipeline magick sips convert exiftool file", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 160x80 xc:teal master.png\nsips -z 40 80 master.png --out thumb.png >/dev/null\nconvert thumb.png thumb.webp\nconvert thumb.webp thumb.gif\nexiftool -overwrite_original -Copyright=\"2026 MediaOps\" thumb.png >/dev/null\nidentify -format '%m %wx%h' thumb.webp\necho \"\"\nfile --brief --mime-type thumb.gif\nexiftool -s3 -Copyright thumb.png");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "WEBP 80x40\nimage/gif\n2026 MediaOps");
    });
  });

  it("15 broadcast qc ffmpeg mux frame extract and ffprobe csv", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=1:size=96x72:rate=10 -f lavfi -i sine=frequency=880:duration=1 -shortest broadcast.mp4 2>/dev/null\nffmpeg -y -i broadcast.mp4 -frames:v 1 poster.png 2>/dev/null\nffprobe -v error -show_entries stream=codec_type,width,height -of csv=p=0 broadcast.mp4\nidentify -format '%m %wx%h' poster.png\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "video,96,72\naudio\nPNG 96x72");
    });
  });

  it("16 office archival soffice pdftk qpdf encrypt decrypt pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'Section A: Governance\\n' > sec_a.txt\nprintf 'Section B: Controls\\n' > sec_b.txt\nsoffice --headless --convert-to pdf sec_a.txt >/dev/null\nsoffice --headless --convert-to pdf sec_b.txt >/dev/null\npdftk sec_a.pdf sec_b.pdf cat output combined.pdf\nqpdf --encrypt reader_pw owner_pw 256 -- combined.pdf locked.pdf\nqpdf --password=reader_pw --decrypt locked.pdf - | pdftotext - - | grep -Eo 'Section [AB]: [A-Za-z]+'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Section A: Governance\nSection B: Controls");
    });
  });

  it("17 codebase refactoring fd apply_patch and rg verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p repo/src\nprintf 'import { oldHelper } from \"./legacy\";\\nexport const run = () => oldHelper();\\n' > repo/src/index.ts\nprintf 'export const oldHelper = () => \"v1\";\\n' > repo/src/legacy.ts\napply_patch << 'PATCH' >/dev/null\n*** Begin Patch\n*** Update File: repo/src/index.ts\n@@\n-import { oldHelper } from \"./legacy\";\n-export const run = () => oldHelper();\n+import { newHelper } from \"./modern\";\n+export const run = () => newHelper();\n*** Update File: repo/src/legacy.ts\n*** Move to: repo/src/modern.ts\n@@\n-export const oldHelper = () => \"v1\";\n+export const newHelper = () => \"v2\";\n*** End Patch\nPATCH\nfd -e ts . repo/src | sort\nrg -o 'newHelper' repo/src/index.ts");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "repo/src/index.ts\nrepo/src/modern.ts\nnewHelper\nnewHelper");
    });
  });

  it("18 scientific precision bc awk sprintf and join", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '1,1000\\n2,2000\\n' > principal.csv\nfor id in 1 2; do\n  p=$((id * 1000))\n  interest=$(printf \"scale=2; $p * 1.0750\\n\" | bc -l)\n  printf \"%d,%.2f\\n\" \"$id\" \"$interest\"\ndone > projected.csv\njoin -t, -1 1 -2 1 principal.csv projected.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1,1000,1075.00\n2,2000,2150.00");
    });
  });

  it("19 technical docs unrtf html-to-markdown mmdc zip and unzip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\\\\rtf1\\\\ansi\\\\b Runbook v3\\\\b0\\\\par Follow steps carefully.\\\\par}\\n' > rb.rtf\nunrtf --html rb.rtf 2>/dev/null > rb.html\nhtml-to-markdown rb.html > rb.md\nprintf 'graph TD\\n  Start --> Stop\\n' > rb.mmd\nmmdc -i rb.mmd -o rb.svg >/dev/null\nzip -q docs_bundle.zip rb.md rb.svg\nunzip -p docs_bundle.zip rb.md | grep -o 'Runbook v3'\nunzip -p docs_bundle.zip rb.svg | grep -o 'Start' | head -n 1");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Runbook v3\nStart");
    });
  });

  it("20 incident postmortem bundle sqlite3 jq yq wkhtmltopdf tar sha256sum", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 post.db \"CREATE TABLE timeline (ts INT, msg TEXT); INSERT INTO timeline VALUES (1,'alert_fired'),(2,'mitigated');\"\nsqlite3 -json post.db \"SELECT * FROM timeline ORDER BY ts;\" > timeline.json\njq -r '.[] | \"<p>\\(.ts): \\(.msg)</p>\"' timeline.json > post.html\nwkhtmltopdf -q post.html post.pdf\ntar -czf postmortem.tar.gz timeline.json post.pdf\nsha256sum postmortem.tar.gz > postmortem.sha256\nsha256sum -c postmortem.sha256\npdftotext post.pdf - | grep -Eo '(alert_fired|mitigated)'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "postmortem.tar.gz: OK\nalert_fired\nmitigated");
    });
  });

});
