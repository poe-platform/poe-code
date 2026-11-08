import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure polyglot cloud secops k8s sbom sql jq yq xan pdf matrix", () => {
  it("1. SBOM CycloneDX JSON vulnerability join with CVE database in sqlite3 and xan summary", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'JSON' > /tmp/sbom83.json\n{\"components\":[\n  {\"name\":\"openssl\",\"version\":\"3.0.1\"},\n  {\"name\":\"zlib\",\"version\":\"1.2.11\"},\n  {\"name\":\"curl\",\"version\":\"8.4.0\"}\n]}\nJSON\njq -r '.components[] | [.name, .version] | @csv' /tmp/sbom83.json | tr -d '\"' > /tmp/sbom_rows.csv\nprintf \"pkg,ver\\n\" | cat - /tmp/sbom_rows.csv > /tmp/sbom83.csv\nprintf \"pkg,cve,cvss\\nopenssl,CVE-2026-1001,9.8\\ncurl,CVE-2026-2002,7.5\\n\" > /tmp/cves83.csv\nxan join pkg /tmp/sbom83.csv pkg /tmp/cves83.csv | xan sort -R -N -s cvss - | xan select pkg,ver,cve,cvss -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "pkg,ver,cve,cvss\nopenssl,3.0.1,CVE-2026-1001,9.8\ncurl,8.4.0,CVE-2026-2002,7.5");
    });
  });

  it("2. Kubernetes multi-doc YAML security audit (non-root & resource limits) via yq and jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'YAML' > /tmp/k8s83.yaml\napiVersion: v1\nkind: Pod\nmetadata:\n  name: payment-pod\nspec:\n  securityContext:\n    runAsNonRoot: true\n---\napiVersion: v1\nkind: Pod\nmetadata:\n  name: legacy-pod\nspec:\n  securityContext:\n    runAsNonRoot: false\nYAML\nyq -o=json 'select(.kind == \"Pod\" and .spec.securityContext.runAsNonRoot == false) | .metadata.name' /tmp/k8s83.yaml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "\"legacy-pod\"");
    });
  });

  it("3. Nginx access log forensics: rg extraction + awk IP aggregation + sqlite3 top talkers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'LOG' > /tmp/nginx83.log\n10.0.0.1 - [06/Oct/2026] \"POST /login\" 401 128\n10.0.0.2 - [06/Oct/2026] \"GET /home\" 200 1024\n10.0.0.1 - [06/Oct/2026] \"POST /login\" 401 128\n10.0.0.3 - [06/Oct/2026] \"POST /login\" 401 128\n10.0.0.1 - [06/Oct/2026] \"POST /login\" 401 128\nLOG\nrg -N '^([0-9.]+) .* \"POST /login\" 401' -r '$1' /tmp/nginx83.log | sort | uniq -c | awk '$1 >= 2 { print $2 \":\" $1 }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "10.0.0.1:3");
    });
  });

  it("4. Maven pom.xml dependency version audit with xmllint and xq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'XML' > /tmp/pom83.xml\n<project>\n  <dependencies>\n    <dependency><artifactId>jackson-databind</artifactId><version>2.17.0</version></dependency>\n    <dependency><artifactId>netty-handler</artifactId><version>4.1.108</version></dependency>\n  </dependencies>\n</project>\nXML\nxmllint --xpath 'count(//dependency)' /tmp/pom83.xml; echo\nxq -r '.project.dependencies.dependency[] | \"\\(.artifactId)=\\(.version)\"' /tmp/pom83.xml | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2\n\njackson-databind=2.17.0\nnetty-handler=4.1.108");
    });
  });

  it("5. HTML status page scraping -> Markdown -> PDF executive incident report roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' > /tmp/status83.html\n<div class=\"incident\">\n  <h1>Incident 8301: Database Failover</h1>\n  <p>Primary replica promoted in <strong>14 seconds</strong>.</p>\n</div>\nHTML\nhtmlq '.incident' -f /tmp/status83.html > /tmp/inc_frag.html\nhtml-to-markdown /tmp/inc_frag.html | head -n 1\nwkhtmltopdf -q /tmp/inc_frag.html /tmp/inc83.pdf\npdftotext /tmp/inc83.pdf - | grep -o '14 seconds'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "# Incident 8301: Database Failover\n14 seconds");
    });
  });

  it("6. FinOps cloud billing reconciliation across AWS and GCP CSV exports using csvstack and csvsql", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"team,cost\\ncore,450\\nai,1200\\n\" > /tmp/aws83.csv\nprintf \"team,cost\\ncore,350\\nai,800\\n\" > /tmp/gcp83.csv\ncsvstack -g aws,gcp -n cloud /tmp/aws83.csv /tmp/gcp83.csv > /tmp/cloud83.csv\ncsvsql --query \"SELECT team, SUM(CAST(cost AS INT)) AS total_spend FROM cloud83 GROUP BY team ORDER BY total_spend DESC\" /tmp/cloud83.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "team,total_spend\nai,2000\ncore,800");
    });
  });

  it("7. automated hotfix workflow: apply_patch + test script execution + tar.zst release artifact", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/hotfix83\nprintf 'calc() { echo $(( $1 + $2 )); }\\ncalc 10 20\\n' > /tmp/hotfix83/app.sh\ncd /tmp/hotfix83\napply_patch << 'PATCH'\n*** Begin Patch\n*** Update File: app.sh\n@@\n-calc() { echo $(( $1 + $2 )); }\n+calc() { echo $(( $1 * $2 )); }\n calc 10 20\n*** End Patch\nPATCH\nbash /tmp/hotfix83/app.sh\ntar --zstd -cf /tmp/hotfix83.tar.zst -C /tmp/hotfix83 app.sh\ntar --zstd -tf /tmp/hotfix83.tar.zst");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Success. Updated the following files:\nM app.sh\n200\napp.sh");
    });
  });

  it("8. Mermaid architecture diagram to SVG + PDF cover merge + encrypted distribution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'MMD' > /tmp/arch83.mmd\ngraph TD\n  LB[LoadBalancer] --> API[API_Server]\nMMD\nmmdc -i /tmp/arch83.mmd -o /tmp/arch83.svg >/dev/null\ngrep -o 'API_Server' /tmp/arch83.svg | head -n 1\nprintf \"Architecture Specification v83\\n\" > /tmp/spec83.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/spec83.txt >/dev/null\nqpdf --encrypt pass83 own83 256 -- /tmp/spec83.pdf /tmp/spec83_enc.pdf\nqpdf --password=pass83 --decrypt /tmp/spec83_enc.pdf - | pdftotext - - | grep -o 'Architecture Specification v83'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "API_Server\nArchitecture Specification v83");
    });
  });

  it("9. SQLite window analytics exported to JSON and transformed with jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/w83.db << 'SQL' | jq -c 'map(select(.rn == 1) | {dept, top_earner: .emp, sal})'\nCREATE TABLE payroll(dept TEXT, emp TEXT, sal INT);\nINSERT INTO payroll VALUES ('eng','Alice',180),('eng','Bob',150),('sales','Carol',160),('sales','Dave',140);\n.mode json\nSELECT dept, emp, sal, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY sal DESC) AS rn FROM payroll ORDER BY dept;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"dept\":\"eng\",\"top_earner\":\"Alice\",\"sal\":180},{\"dept\":\"sales\",\"top_earner\":\"Carol\",\"sal\":160}]");
    });
  });

  it("10. Git-style 3-way config merge with diff3 and YAML validation via yq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'YAML' > /tmp/base83.yaml\nreplicas: 2\nimage: app:1.0\ntimeout: 30\nYAML\ncat << 'YAML' > /tmp/mine83.yaml\nreplicas: 5\nimage: app:1.0\ntimeout: 30\nYAML\ncat << 'YAML' > /tmp/theirs83.yaml\nreplicas: 2\nimage: app:1.0\ntimeout: 60\nYAML\ndiff3 -m /tmp/mine83.yaml /tmp/base83.yaml /tmp/theirs83.yaml | yq -o=json . | jq -S -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"image\":\"app:1.0\",\"replicas\":5,\"timeout\":60}");
    });
  });

  it("11. image asset sanitization pipeline: magick resize + exiftool strip + zip packaging", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/assets83\nmagick -size 100x80 xc:coral /tmp/assets83/hero.png\nexiftool -overwrite_original -Artist=\"SecretAuthor\" /tmp/assets83/hero.png >/dev/null\nmagick /tmp/assets83/hero.png -resize 50x40! /tmp/assets83/hero_thumb.png\nexiftool -overwrite_original -all= /tmp/assets83/hero_thumb.png >/dev/null\nidentify -format '%m %wx%h' /tmp/assets83/hero_thumb.png; echo\nexiftool -j /tmp/assets83/hero_thumb.png | jq -r '.[0].Artist // \"CLEAN\"'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG 50x40\nCLEAN");
    });
  });

  it("12. multi-env .env template rendering with envsubst, awk validation, and sha256sum", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'ENV' > /tmp/tmpl83.env\nDB_HOST=${DB_HOST}\nDB_PORT=${DB_PORT}\nREDIS_URL=redis://${DB_HOST}:6379\nENV\nexport DB_HOST=\"10.20.30.40\" DB_PORT=\"5432\"\nenvsubst '$DB_HOST $DB_PORT' < /tmp/tmpl83.env > /tmp/prod83.env\nawk -F= '{ print $1 \"=>\" $2 }' /tmp/prod83.env");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "DB_HOST=>10.20.30.40\nDB_PORT=>5432\nREDIS_URL=>redis://10.20.30.40:6379");
    });
  });

  it("13. binary telemetry packet decoding with xxd, dd, od, and bc scaling", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"\\x00\\x64\\x01\\xf4\" > /tmp/pkt83.bin\nhi=$(dd if=/tmp/pkt83.bin bs=1 count=2 status=none | xxd -p | tr 'a-f' 'A-F')\nlo=$(dd if=/tmp/pkt83.bin bs=1 skip=2 count=2 status=none | xxd -p | tr 'a-f' 'A-F')\nbc << BC\nibase=16\n$hi + $lo\nBC");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "600");
    });
  });

  it("14. DAG build planner: jq dependency extraction + tsort + nl execution schedule", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'JSON' | jq -r '.edges[] | \"\\(.[0]) \\(.[1])\"' | tsort | nl -w 2 -n rz -s '. '\n{\"edges\":[[\"lint\",\"compile\"],[\"compile\",\"test\"],[\"test\",\"deploy\"]]}\nJSON");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "01. lint\n02. compile\n03. test\n04. deploy");
    });
  });

  it("15. SQLite trigger-backed inventory ledger with CSV import and xan stats", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/tx83.csv\nsku,delta\nA100,50\nA100,-15\nB200,30\nCSV\nsqlite3 /tmp/inv83.db << 'SQL'\nCREATE TABLE stock(sku TEXT PRIMARY KEY, qty INT);\nCREATE TABLE tx(sku TEXT, delta INT);\nCREATE TRIGGER tr_tx AFTER INSERT ON tx BEGIN\n  INSERT INTO stock VALUES (NEW.sku, NEW.delta)\n  ON CONFLICT(sku) DO UPDATE SET qty = stock.qty + NEW.delta;\nEND;\n.mode csv\n.import /tmp/tx83.csv tx\n.mode list\nSELECT sku, qty FROM stock WHERE sku != 'sku' ORDER BY sku;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "A100|35\nB200|30");
    });
  });

  it("16. media transcode verification: ffmpeg video+audio muxing and ffprobe JSON stream check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=1:size=64x36:rate=10 -f lavfi -i sine=frequency=440:sample_rate=16000:duration=1 /tmp/mux83.mp4 2>/dev/null\nffprobe -v quiet -print_format json -show_streams /tmp/mux83.mp4 | jq -c '[.streams[] | {type: .codec_type, w: .width, sr: .sample_rate}]'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"type\":\"video\",\"w\":64,\"sr\":null},{\"type\":\"audio\",\"w\":null,\"sr\":\"16000\"}]");
    });
  });

  it("17. multi-file log rotation & compression: split + find + xargs gzip + zcat reassembly", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("seq -f 'event-log-%02g' 1 6 > /tmp/events83.log\nmkdir -p /tmp/rot83\nsplit -l 2 -d /tmp/events83.log /tmp/rot83/part_\nfor f in /tmp/rot83/part_*; do gzip \"$f\"; done\nls /tmp/rot83 | sort\ncat /tmp/rot83/part_*.gz | gunzip -c | wc -l | awk '{print $1}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "part_00.gz\npart_01.gz\npart_02.gz\n6");
    });
  });

  it("18. TOML -> YAML -> XML -> JSON roundtrip configuration normalization", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'TOML' | yq -p=toml -o=yaml . | yq -p=yaml -o=xml . | xq -c .\n[cluster]\nname = \"eu-central\"\nnodes = 3\nTOML");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"cluster\":{\"name\":\"eu-central\",\"nodes\":\"3\"}}");
    });
  });

  it("19. PDF dossier assembly: soffice + pdftk attach_files + pdfdetach + sha256sum", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"Dossier Summary Page\\n\" > /tmp/dos83.txt\nprintf \"raw_evidence_payload_83\\n\" > /tmp/ev83.dat\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/dos83.txt >/dev/null\npdftk /tmp/dos83.pdf attach_files /tmp/ev83.dat output /tmp/dossier83.pdf\nmkdir -p /tmp/dos_ext83\npdfdetach -saveall -o /tmp/dos_ext83 /tmp/dossier83.pdf\ncmp -s /tmp/ev83.dat /tmp/dos_ext83/ev83.dat && echo \"EVIDENCE_VERIFIED\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "EVIDENCE_VERIFIED");
    });
  });

  it("20. full-stack observability pipeline: rg -> jq -> sqlite3 -> xan -> column report", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'NDJSON' > /tmp/traces83.jsonl\n{\"trace\":\"t1\",\"svc\":\"gateway\",\"ms\":18,\"ok\":true}\n{\"trace\":\"t2\",\"svc\":\"gateway\",\"ms\":42,\"ok\":true}\n{\"trace\":\"t3\",\"svc\":\"payments\",\"ms\":210,\"ok\":false}\n{\"trace\":\"t4\",\"svc\":\"payments\",\"ms\":90,\"ok\":true}\nNDJSON\njq -r '[.svc, (.ms | tostring), (if .ok then \"1\" else \"0\" end)] | @csv' /tmp/traces83.jsonl | tr -d '\"' > /tmp/tr_rows83.csv\nprintf \"svc,ms,ok\\n\" | cat - /tmp/tr_rows83.csv > /tmp/tr83.csv\nxan groupby svc 'count() as calls, sum(ms) as total_ms, max(ms) as max_ms' /tmp/tr83.csv | xan sort -s svc - | column -t -s ','");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "svc       calls  total_ms  max_ms\ngateway   2      60        42\npayments  2      300       210");
    });
  });

});
