import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure polyglot etl log forensics sql jq yq xan archive matrix", () => {
  it("1. rg --json + jq + sqlite3 + xan: structured log extraction into SQL aggregation and CSV stats", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/access.log\n2026-10-06T10:00:01Z svc=auth status=200 ms=12\n2026-10-06T10:00:02Z svc=pay status=500 ms=140\n2026-10-06T10:00:03Z svc=auth status=200 ms=18\n2026-10-06T10:00:04Z svc=pay status=200 ms=60\nEOF\nrg -o -N 'svc=([a-z]+) status=([0-9]+) ms=([0-9]+)' -r '$1,$2,$3' /tmp/access.log > /tmp/raw_logs.csv\nprintf 'svc,status,ms\\n' | cat - /tmp/raw_logs.csv > /tmp/logs.csv\nxan groupby svc 'count() as reqs, sum(ms) as total_ms, max(ms) as max_ms' /tmp/logs.csv | xan sort -s svc -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "svc,reqs,total_ms,max_ms\nauth,2,30,18\npay,2,200,140");
    });
  });

  it("2. yq + envsubst + jq + sha256sum: multi-env deployment manifest generation and digest", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/base_k8s.yaml\napiVersion: v1\nkind: Service\nmetadata:\n  name: ${SVC_NAME}\nspec:\n  port: 80\nEOF\nexport SVC_NAME=edge-router\nenvsubst '$SVC_NAME' < /tmp/base_k8s.yaml | yq -o=json '.spec.port = 8443 | .metadata.env = \"prod\"' | jq -S -c . > /tmp/final_k8s.json\ncat /tmp/final_k8s.json\nsha256sum /tmp/final_k8s.json | awk '{print $1}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"apiVersion\":\"v1\",\"kind\":\"Service\",\"metadata\":{\"env\":\"prod\",\"name\":\"edge-router\"},\"spec\":{\"port\":8443}}\ndc1b28f87ccc15cbb86d647a1378b18066eff46570d8425b2f6befd7837ef6bc");
    });
  });

  it("3. xmllint + xq + sqlite3: XML invoice extraction, SQLite tax computation, and CSV export", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/invoices.xml\n<invoices>\n  <inv id=\"101\" client=\"Acme\"><amount>200</amount></inv>\n  <inv id=\"102\" client=\"Globex\"><amount>350</amount></inv>\n</invoices>\nEOF\nxmllint --xpath 'sum(//inv/amount)' /tmp/invoices.xml\nxq -r '.invoices.inv[] | [\"\\(.[\"@id\"])\", \"\\(.[\"@client\"])\", \"\\(.amount)\"] | @csv' /tmp/invoices.xml > /tmp/inv.csv\nsqlite3 /tmp/inv.db \"CREATE TABLE inv(id INT, client TEXT, amount INT);\" \".mode csv\" \".import /tmp/inv.csv inv\"\nsqlite3 /tmp/inv.db \"SELECT client, amount, (amount * 110) / 100 AS with_tax FROM inv ORDER BY id;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "550\nAcme|200|220\nGlobex|350|385");
    });
  });

  it("4. htmlq + html-to-markdown + wkhtmltopdf + pdftotext: HTML article to PDF and text roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/kb.html\n<html><body><nav>Skip</nav><article id=\"kb\"><h1>Runbook Alpha</h1><p>Restart <code>worker-01</code> immediately.</p></article></body></html>\nEOF\nhtmlq -f /tmp/kb.html 'article#kb' > /tmp/article_only.html\nhtml-to-markdown /tmp/article_only.html\nwkhtmltopdf -q /tmp/article_only.html /tmp/kb.pdf\npdfinfo /tmp/kb.pdf | grep -E '^Pages:' | awk '{print $1, $2}'\npdftotext /tmp/kb.pdf - | grep -o 'Runbook Alpha'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "# Runbook Alpha\n\nRestart `worker-01` immediately.\nPages: 1\nRunbook Alpha");
    });
  });

  it("5. unrtf + mmdc + tar --zstd + b2sum: rich document and diagram bundle integrity", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/bundle_src /tmp/bundle_out\nprintf '{\\\\rtf1\\\\ansi{\\\\b Release v3.0}\\\\par All checks green.\\\\par}' > /tmp/bundle_src/notes.rtf\nunrtf --text --quiet /tmp/bundle_src/notes.rtf > /tmp/bundle_src/notes.txt\nprintf 'graph LR\\n  Build --> Test\\n' > /tmp/bundle_src/pipe.mmd\nmmdc -i /tmp/bundle_src/pipe.mmd -o /tmp/bundle_src/pipe.svg\ntar --zstd -cf /tmp/release.tar.zst -C /tmp/bundle_src notes.txt pipe.svg\ntar --zstd -xf /tmp/release.tar.zst -C /tmp/bundle_out\ncat /tmp/bundle_out/notes.txt\nxmllint --noout /tmp/bundle_out/pipe.svg && echo SVG_OK");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Release v3.0\nAll checks green.\nSVG_OK");
    });
  });

  it("6. csvstack + csvjoin + csvsql: multi-region sales join and SQL ranking", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'sku,qty\\nA1,10\\nB2,5\\n' > /tmp/s_us.csv\nprintf 'sku,qty\\nA1,15\\nB2,20\\n' > /tmp/s_eu.csv\nprintf 'sku,unit_price\\nA1,100\\nB2,50\\n' > /tmp/prices.csv\ncsvstack -g us,eu -n region /tmp/s_us.csv /tmp/s_eu.csv > /tmp/all_sales.csv\ncsvjoin -c sku /tmp/all_sales.csv /tmp/prices.csv > /tmp/enriched.csv\ncsvsql --query 'SELECT sku, CAST(SUM(qty * unit_price) AS INT) AS rev FROM enriched GROUP BY sku ORDER BY rev DESC' /tmp/enriched.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sku,rev\nA1,2500\nB2,1250");
    });
  });

  it("7. fd + rg + sed + diff + patch: automated codebase migration and rollback verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/mig_orig/src /tmp/mig_work/src\nprintf 'import { oldApi } from \"./legacy\";\\nexport const run = () => oldApi(1);\\n' > /tmp/mig_orig/src/index.ts\ncp /tmp/mig_orig/src/index.ts /tmp/mig_work/src/index.ts\nsed -i 's/oldApi/newApi/g; s/legacy/modern/g' /tmp/mig_work/src/index.ts\ndiff -u /tmp/mig_orig/src/index.ts /tmp/mig_work/src/index.ts > /tmp/mig.patch || true\npatch -s -R /tmp/mig_work/src/index.ts /tmp/mig.patch\ncmp -s /tmp/mig_orig/src/index.ts /tmp/mig_work/src/index.ts && echo ROLLBACK_EXACT");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ROLLBACK_EXACT");
    });
  });

  it("8. dd + xxd + base64 + base32 + cksum: binary packet slicing and multi-encoding verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'HEADER_0123456789_TRAILER' > /tmp/pkt.bin\ndd if=/tmp/pkt.bin bs=1 skip=7 count=10 status=none > /tmp/payload.bin\nxxd -p /tmp/payload.bin\nbase64 < /tmp/payload.bin | base64 -d\necho\nbase32 < /tmp/payload.bin | base32 -d\necho");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "30313233343536373839\n0123456789\n0123456789");
    });
  });

  it("9. sqlite3 window functions + awk + bc + numfmt: financial ledger running balance and IEC formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE tx(id INT, acct TEXT, delta INT);\n  INSERT INTO tx VALUES (1,'ops',1024),(2,'ops',3072),(3,'eng',8192);\n  SELECT acct, id, SUM(delta) OVER (PARTITION BY acct ORDER BY id) AS bal FROM tx ORDER BY acct, id;\n\" | awk -F'|' '{print $1, $2, $3}' | numfmt --field=3 --to=iec");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "eng 3 8.0K\nops 1 1.0K\nops 2 4.0K");
    });
  });

  it("10. jq + tsort + nl + paste: JSON dependency graph to numbered execution plan", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | jq -r '.edges[] | \"\\(.[0]) \\(.[1])\"' | tsort | nl -ba -w 1 -s '.' | paste -sd' ' -\n{\"edges\":[[\"init\",\"compile\"],[\"compile\",\"bundle\"],[\"bundle\",\"deploy\"]]}\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1.init 2.compile 3.bundle 4.deploy");
    });
  });

  it("11. magick + exiftool + identify + zip + unzip: image asset pipeline with EXIF stripping", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/img_pipe /tmp/img_unz\nmagick -size 80x40 xc:navy /tmp/img_pipe/banner.png\nexiftool -overwrite_original -Artist=\"PoeBot\" -Copyright=\"2026\" /tmp/img_pipe/banner.png >/dev/null\nexiftool -s3 -Artist /tmp/img_pipe/banner.png\nexiftool -overwrite_original -all= /tmp/img_pipe/banner.png >/dev/null\nexiftool -s3 -Artist /tmp/img_pipe/banner.png\nzip -q -j /tmp/img_pipe/assets.zip /tmp/img_pipe/banner.png\nunzip -q /tmp/img_pipe/assets.zip -d /tmp/img_unz\nidentify -format '%m %wx%h' /tmp/img_unz/banner.png");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PoeBot\nPNG 80x40");
    });
  });

  it("12. soffice + pdftk + qpdf + pdfinfo: Office document to PDF merge and encryption audit", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/doc_pipe\nprintf 'Page One Content\\n' > /tmp/doc_pipe/one.txt\nprintf 'Page Two Content\\n' > /tmp/doc_pipe/two.txt\nsoffice --headless --convert-to pdf --outdir /tmp/doc_pipe /tmp/doc_pipe/one.txt /tmp/doc_pipe/two.txt >/dev/null\npdfunite /tmp/doc_pipe/one.pdf /tmp/doc_pipe/two.pdf /tmp/doc_pipe/merged.pdf\nqpdf --linearize /tmp/doc_pipe/merged.pdf /tmp/doc_pipe/opt.pdf\npdfinfo /tmp/doc_pipe/opt.pdf | grep -E '^(Pages|Optimized):' | tr -s ' '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Pages: 2\nOptimized: yes");
    });
  });

  it("13. ffmpeg + ffprobe: synthetic audio/video generation, stream inspection, and remuxing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=2:size=160x120:rate=15 -f lavfi -i sine=frequency=440:duration=2 /tmp/av.mp4 >/dev/null 2>&1\nffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /tmp/av.mp4");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "160,120");
    });
  });

  it("14. yq TOML -> YAML -> XML -> JSON 4-format configuration transcoding", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/four.toml\n[database]\nhost = \"db.prod\"\npool = 16\nEOF\nyq -p=toml -o=yaml '.' /tmp/four.toml | yq -p=yaml -o=xml '.' | xq -c '.database'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"host\":\"db.prod\",\"pool\":\"16\"}");
    });
  });

  it("15. sqlite3 FTS5 + triggers + JSON_GROUP_ARRAY: full-text search audit trail", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE audit(op TEXT);\n  CREATE TABLE notes(id INT PRIMARY KEY, body TEXT);\n  CREATE TRIGGER tr_notes AFTER INSERT ON notes BEGIN INSERT INTO audit VALUES ('ins:' || NEW.id); END;\n  CREATE VIRTUAL TABLE notes_fts USING fts5(body);\n  INSERT INTO notes VALUES (1, 'kernel panic in network driver'), (2, 'tls certificate renewed');\n  INSERT INTO notes_fts SELECT body FROM notes;\n  SELECT (SELECT JSON_GROUP_ARRAY(op) FROM audit), (SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'kernel');\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[\"ins:1\",\"ins:2\"]|1");
    });
  });

  it("16. awk + sed + sort + comm + join: reconciliation of expected vs actual inventory", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'srv1:running\\nsrv2:stopped\\nsrv3:running\\n' > /tmp/expected.txt\nprintf 'srv1:running\\nsrv2:running\\nsrv4:running\\n' > /tmp/actual.txt\ncut -d: -f1 /tmp/expected.txt | sort > /tmp/exp_hosts.txt\ncut -d: -f1 /tmp/actual.txt | sort > /tmp/act_hosts.txt\necho \"missing=$(comm -23 /tmp/exp_hosts.txt /tmp/act_hosts.txt)\"\necho \"unexpected=$(comm -13 /tmp/exp_hosts.txt /tmp/act_hosts.txt)\"\njoin -t: /tmp/expected.txt /tmp/actual.txt | awk -F: '$2 != $3 {print \"drift=\" $1 \":\" $2 \"->\" $3}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "missing=srv3\nunexpected=srv4\ndrift=srv2:stopped->running");
    });
  });

  it("17. csplit + xargs + sha256sum: multi-part certificate chain splitting and per-cert digest", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/certs\nprintf 'CERT_A_DATA\\n---SPLIT---\\nCERT_B_DATA\\n' > /tmp/certs/chain.pem\ncsplit -s -z -f /tmp/certs/c_ -n 2 /tmp/certs/chain.pem '/^---SPLIT---$/' '{*}'\nsed -i '/^---SPLIT---$/d' /tmp/certs/c_01\nwc -l /tmp/certs/c_00 /tmp/certs/c_01 | awk '{print $1, $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1 /tmp/certs/c_00\n1 /tmp/certs/c_01\n2 total");
    });
  });

  it("18. apply_patch + git-style unified diff + diff3 merge conflict resolution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/p_flow\nprintf 'v = 1\\nmode = safe\\n' > /tmp/p_flow/cfg.ini\ncd /tmp/p_flow\napply_patch >/dev/null << 'EOF'\n*** Begin Patch\n*** Update File: cfg.ini\n@@\n-v = 1\n+v = 2\n mode = safe\n*** End Patch\nEOF\ncat /tmp/p_flow/cfg.ini");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "v = 2\nmode = safe");
    });
  });

  it("19. gzip + bzip2 + xz + zstd multi-codec compression chain roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'polyglot-compression-payload-2026\\n' | gzip -c | bzip2 -c | xz -c | zstd -c | zstd -d | xz -d | bzip2 -d | gzip -d");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "polyglot-compression-payload-2026");
    });
  });

  it("20. bash associative arrays + jq + xan + column: dynamic SLA compliance matrix", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("declare -A sla=([auth]=50 [pay]=100 [search]=30)\nfor k in auth pay search; do echo \"$k,${sla[$k]}\"; done | sort > /tmp/sla_limits.csv\nprintf 'svc,sla_ms\\n' | cat - /tmp/sla_limits.csv > /tmp/sla.csv\nprintf 'svc,actual_ms\\nauth,35\\npay,120\\nsearch,25\\n' > /tmp/actual_ms.csv\nxan join svc /tmp/sla.csv svc /tmp/actual_ms.csv | xan map 'actual_ms - sla_ms as breach' - | xan filter 'breach > 0' - | xan select svc,sla_ms,actual_ms -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "svc,sla_ms,actual_ms\npay,100,120");
    });
  });

});
