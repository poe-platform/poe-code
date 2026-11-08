import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure polyglot full-stack incident forensics, DevSecOps, financial ETL & repository audit matrix", () => {
  it("01: unpacks a .tar.zst JSONL incident bundle, strips CSV quotes via ${s//\\\"/}, and joins in sqlite3", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "mkdir -p logs",
          "cat << 'JSONL' > logs/access.jsonl",
          '{"svc":"auth","status":502,"ms":140}',
          '{"svc":"pay","status":200,"ms":25}',
          '{"svc":"auth","status":504,"ms":310}',
          '{"svc":"db","status":500,"ms":890}',
          "JSONL",
          "tar --zstd -cf bundle.tar.zst logs/access.jsonl",
          "rm -rf logs && mkdir -p unpacked",
          "tar --zstd -xf bundle.tar.zst -C unpacked",
          "jq -r 'select(.status >= 500) | [.svc, (.status|tostring), (.ms|tostring)] | @csv' unpacked/logs/access.jsonl > errs.csv",
          "sqlite3 audit.db \"CREATE TABLE owners(svc TEXT, team TEXT); INSERT INTO owners VALUES ('auth','sec-eng'),('db','infra'); CREATE TABLE errs(svc TEXT, status INT, ms INT);\"",
          'while IFS=, read -r s st ms; do s="${s//\\"/}"; sqlite3 audit.db "INSERT INTO errs VALUES (\'$s\', $st, $ms);"; done < errs.csv',
          'sqlite3 audit.db "SELECT o.team, COUNT(*), MAX(e.ms) FROM errs e JOIN owners o ON e.svc = o.svc GROUP BY o.team ORDER BY MAX(e.ms) DESC;"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "infra|1|890\nsec-eng|2|310\n");
    });
  });

  it("02: performs a 3-way YAML config merge with diff3 -m and computes capacity invariants via yq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'Y' > base.yaml",
          "service: gateway",
          "replicas: 2",
          "port: 8080",
          "timeout: 30",
          "Y",
          "cat << 'Y' > ours.yaml",
          "service: gateway",
          "replicas: 5",
          "port: 8080",
          "timeout: 30",
          "Y",
          "cat << 'Y' > theirs.yaml",
          "service: gateway",
          "replicas: 2",
          "port: 8080",
          "timeout: 60",
          "Y",
          "diff3 -m ours.yaml base.yaml theirs.yaml | yq -o json -I 0 '{service, replicas, timeout, cap: (.replicas * .timeout)}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"service":"gateway","replicas":5,"timeout":60,"cap":300}\n',
      );
    });
  });

  it("03: generates a unified diff, applies it with patch, and verifies byte/SHA-256 identity via cmp and sha256sum", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "v1\\nalpha\\nbeta\\n" > orig.txt',
          'printf "v2\\nalpha\\ngamma\\n" > target.txt',
          "cp orig.txt working.txt",
          "diff -u orig.txt target.txt > upgrade.patch || true",
          "patch -s working.txt < upgrade.patch",
          'cmp -s working.txt target.txt && echo "cmp:identical"',
          "sha256sum working.txt target.txt | awk '{print $1}' | uniq | wc -l | tr -d ' '",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "cmp:identical\n1\n");
    });
  });

  it("04: reconciles financial ledger transactions using sqlite3 window functions and bc -l precision math", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "sqlite3 fin.db \"CREATE TABLE tx(id INT, acct TEXT, amt REAL); INSERT INTO tx VALUES (1,'A',100.50),(2,'A',49.25),(3,'B',200.00),(4,'A',-29.75);\"",
          "sqlite3 fin.db \"SELECT acct, printf('%.2f', SUM(amt)) FROM tx GROUP BY acct ORDER BY acct;\"",
          'echo "scale=2; 120.00 * 1.05" | bc -l',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "A|120.00\nB|200.00\n126.00\n");
    });
  });

  it("05: extracts XML SBOM dependencies with xq, joins against a JSON CVE feed with jq, and renders via csvlook", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'XML' > pom.xml",
          '<project><deps><dep name="zlib" ver="1.2.11"/><dep name="openssl" ver="3.0.1"/></deps></project>',
          "XML",
          "cat << 'JSON' > cves.json",
          '[{"pkg":"zlib","cve":"CVE-2026-0001","sev":"HIGH"},{"pkg":"curl","cve":"CVE-2026-0002","sev":"LOW"}]',
          "JSON",
          'xq -c \'.project.deps.dep | map({pkg: ."@name", ver: ."@ver"})\' pom.xml > deps.json',
          'jq -r -s \'INDEX(.[1][]; .pkg) as $adv | ["pkg","ver","cve","sev"], (.[0][] | select($adv[.pkg] != null) | [.pkg, .ver, $adv[.pkg].cve, $adv[.pkg].sev]) | @csv\' deps.json cves.json | csvlook',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "| pkg  | ver    | cve           | sev  |\n| ---- | ------ | ------------- | ---- |\n| zlib | 1.2.11 | CVE-2026-0001 | HIGH |\n",
      );
    });
  });

  it("06: scrapes degraded service status from HTML via htmlq and compiles a Mermaid topology diagram via mmdc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'HTML' > status.html",
          '<ul><li data-svc="edge">OK</li><li data-svc="db">DEGRADED</li></ul>',
          "HTML",
          'deg=$(htmlq -t \'li[data-svc="db"]\' -f status.html | tr -d "\\n")',
          "cat << MMD > arch.mmd",
          "graph LR",
          "  edge --> db_${deg}",
          "MMD",
          "mmdc -i arch.mmd -o arch.svg",
          'grep -o "db_DEGRADED" arch.svg | head -n 1',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "db_DEGRADED\n");
    });
  });

  it("07: builds a multi-page incident PDF via wkhtmltopdf + pdfunite, slices page 2 via qpdf, and extracts text via pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'wkhtmltopdf --title "Incident47" - <<< "<html><body><h1>Postmortem 47</h1></body></html>" p1.pdf',
          'wkhtmltopdf - <<< "<html><body><p>Root cause resolved</p></body></html>" p2.pdf',
          "pdfunite p1.pdf p2.pdf full.pdf",
          "qpdf full.pdf --pages . 2 -- page2.pdf",
          "pdfinfo full.pdf | grep -E '^Pages:' | awk '{print $2}'",
          'pdftotext page2.pdf - | grep -o "Root cause resolved"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "2\nRoot cause resolved\n");
    });
  });

  it("08: normalizes encoding with iconv and aggregates regional revenue via xan groupby and xan sort", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'printf "region,sales\\neu,120\\nus,80\\neu,180\\napac,95\\n" | iconv -f UTF-8 -t UTF-8 | xan groupby region "sum(sales) as total" | xan sort -N -s total -R',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "region,total\neu,300\napac,95\nus,80\n");
    });
  });

  it("09: encrypts a PDF with qpdf, packages it in a zip archive, extracts, decrypts, and verifies text", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'wkhtmltopdf - <<< "<html><body>Classified Payload 99</body></html>" plain.pdf',
          "qpdf --encrypt secpass ownpass 256 -- plain.pdf enc.pdf",
          "zip -q archive.zip enc.pdf",
          "rm -f plain.pdf enc.pdf",
          "unzip -q archive.zip",
          "qpdf --password=secpass --decrypt enc.pdf dec.pdf",
          'pdftotext dec.pdf - | grep -o "Classified Payload 99"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Classified Payload 99\n");
    });
  });

  it("10: computes a topological build plan with tsort and indexes build steps via jq to_entries on arrays", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'DEPS' > edges.txt",
          "core utils",
          "utils logging",
          "app core",
          "DEPS",
          "tsort edges.txt | jq -R . | jq -s -c 'to_entries | map({step: (.key + 1), pkg: .value})'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"step":1,"pkg":"app"},{"step":2,"pkg":"core"},{"step":3,"pkg":"utils"},{"step":4,"pkg":"logging"}]\n',
      );
    });
  });

  it("11: dissects a binary packet header with dd and decompresses the embedded gzip payload via gunzip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "HEADER8B" > pkt.bin',
          'printf "secret-telemetry-payload\\n" | gzip -c >> pkt.bin',
          "dd if=pkt.bin of=body.gz bs=1 skip=8 status=none",
          "gunzip -c body.gz",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "secret-telemetry-payload\n");
    });
  });

  it("12: splits a multi-part log with csplit, compresses chunks with bzip2 and xz, and tallies severities with awk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'LOG' > multi.log",
          "INFO boot complete",
          "WARN disk 82%",
          "---SPLIT---",
          "ERROR db timeout",
          "ERROR auth timeout",
          "LOG",
          "csplit -s -f part_ multi.log '/---SPLIT---/'",
          "bzip2 -c part_00 > p0.bz2",
          "xz -c part_01 > p1.xz",
          '{ bunzip2 -c p0.bz2; unxz -c p1.xz; } | awk \'/^(INFO|WARN|ERROR)/ { c[$1]++ } END { printf "I=%d W=%d E=%d\\n", c["INFO"], c["WARN"], c["ERROR"] }\'',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "I=1 W=1 E=2\n");
    });
  });

  it("13: searches across symlinked packages with rg -l and performs in-place refactoring via xargs sed -i", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'mkdir -p pkgs/lib && printf "export const OLD_API = 1;\\n" > pkgs/lib/index.ts',
          "ln -s pkgs/lib link_lib",
          'rg -l "OLD_API" pkgs/ | xargs sed -i "s/OLD_API/NEW_API/g"',
          "cat link_lib/index.ts",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "export const NEW_API = 1;\n");
    });
  });

  it("14: queries an FTS5 incident index in sqlite3 and formats an RTF executive advisory via unrtf --text", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "sqlite3 :memory: \"CREATE VIRTUAL TABLE docs USING fts5(id, body); INSERT INTO docs VALUES ('INC-1','database deadlock during migration'),('INC-2','tls certificate renewal'),('INC-3','worker deadlock on queue'); SELECT json_group_array(id) FROM (SELECT id FROM docs WHERE docs MATCH 'deadlock' ORDER BY id);\"",
          "printf '{\\\\rtf1\\\\ansi\\\\b RESOLVED\\\\b0 : deadlock fixed}' | unrtf --text | grep -v '^###' | sed '/^[[:space:]]*$/d'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '["INC-1","INC-3"]\nRESOLVED: deadlock fixed\n');
    });
  });

  it("15: resizes a badge image with magick and sips, stamps metadata with exiftool, and strips PII on public copy via -all=", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "magick -size 40x20 xc:navy badge.png",
          "sips -z 10 20 badge.png >/dev/null",
          'exiftool -overwrite_original -Artist="SecOps" -Comment="Internal" badge.png >/dev/null',
          "cp badge.png public.png",
          "exiftool -overwrite_original -all= public.png >/dev/null",
          'identify -format "%m %wx%h\\n" public.png',
          "exiftool -s3 -Artist badge.png",
          'echo "pub_artist:$(exiftool -s3 -Artist public.png)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "PNG 20x10\nSecOps\npub_artist:\n");
    });
  });

  it("16: synthesizes and scales video telemetry with ffmpeg and inspects JSON stream metadata via ffprobe and jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=black:s=64x48:d=1 -vf scale=32:24 -frames:v 1 clip.mp4 2>/dev/null",
          "ffprobe -v quiet -print_format json -show_streams clip.mp4 | jq -c '.streams[0] | {codec_type, width, height}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '{"codec_type":"video","width":32,"height":24}\n');
    });
  });

  it("17: converts specification text to DOCX via soffice --headless and HTML release notes via html-to-markdown", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "Release 47 Ready\\n" > spec.txt',
          "soffice --headless --convert-to docx spec.txt >/dev/null",
          "soffice --cat spec.docx",
          "cat << 'HTML' | html-to-markdown | sed 's/^[*+-][[:space:]]\\+/* /' | grep -E '^(# |\\* )'",
          "<h1>Status</h1><ul><li>Green</li></ul>",
          "HTML",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Release 47 Ready\n# Status\n* Green\n");
    });
  });

  it("18: coordinates background worker jobs with wait $!, namerefs, associative arrays, and an EXIT trap summary", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "declare -A results",
          "record_res() { local -n map_ref=$1; map_ref[$2]=$3; }",
          'trap \'echo "summary:w1=${results[w1]}:w2=${results[w2]}"\' EXIT',
          "(exit 0) & p1=$!",
          "(exit 17) & p2=$!",
          'wait "$p1"; record_res results w1 $?',
          'wait "$p2"; record_res results w2 $?',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "summary:w1=0:w2=17\n");
    });
  });

  it("19: joins TOML quota configs (yq) with CSV usage metrics (csvjson) using jq to flag over-quota regions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'TOML' > quotas.toml",
          "[limits]",
          "eu = 500",
          "us = 300",
          "TOML",
          "cat << 'CSV' > usage.csv",
          "region,used",
          "eu,420",
          "us,350",
          "CSV",
          'jq -n -c --argjson q "$(yq -p toml -o json -I 0 .limits quotas.toml)" --argjson u "$(csvjson usage.csv)" \'$u | map({region, used: (.used|tonumber), limit: $q[.region], over: ((.used|tonumber) > $q[.region])})\'',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"region":"eu","used":420.0,"limit":500,"over":false},{"region":"us","used":350.0,"limit":300,"over":true}]\n',
      );
    });
  });

  it("20: packages a SQLite JSON audit export and PDF compliance report into a .tar.gz with SHA256SUMS verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "mkdir -p dist",
          "sqlite3 comp.db \"CREATE TABLE checks(name TEXT, pass INT); INSERT INTO checks VALUES ('tls',1),('mfa',1),('audit',1);\"",
          'sqlite3 -json comp.db "SELECT * FROM checks ORDER BY name;" > dist/checks.json',
          'wkhtmltopdf - <<< "<html><body>Compliance Passed</body></html>" dist/report.pdf',
          "(cd dist && sha256sum checks.json report.pdf > SHA256SUMS)",
          "tar -czf compliance.tar.gz -C dist checks.json report.pdf SHA256SUMS",
          "rm -rf dist && mkdir -p verify && tar -xzf compliance.tar.gz -C verify",
          "(cd verify && sha256sum -c SHA256SUMS)",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "checks.json: OK\nreport.pdf: OK\n");
    });
  });
});
