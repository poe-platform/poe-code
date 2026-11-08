import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure polyglot milestone 100 full-stack etl, sql, jq, yq, xan, pdf, media, and archive matrix", () => {
  it("01_full_stack_k8s_yaml_to_sqlite_capacity_planner_and_bc", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/cluster.yaml\nnodes:\n  - name: node-1\n    zone: us-east-1a\n    cpu_m: 4000\n    mem_mb: 16384\n  - name: node-2\n    zone: us-east-1b\n    cpu_m: 8000\n    mem_mb: 32768\npods:\n  - name: api-1\n    node: node-1\n    req_cpu_m: 1500\n    req_mem_mb: 4096\n  - name: api-2\n    node: node-1\n    req_cpu_m: 1000\n    req_mem_mb: 2048\n  - name: db-1\n    node: node-2\n    req_cpu_m: 4000\n    req_mem_mb: 16384\nEOF\nsqlite3 /workspace/cap.db \"CREATE TABLE nodes(name TEXT, zone TEXT, cpu_m INT, mem_mb INT); CREATE TABLE pods(name TEXT, node TEXT, req_cpu_m INT, req_mem_mb INT);\"\nyq -o=json '.' /workspace/cluster.yaml | jq -r '\n  (.nodes[] | \"INSERT INTO nodes VALUES ('\\''\\(.name)'\\'', '\\''\\(.zone)'\\'', \\(.cpu_m), \\(.mem_mb));\"),\n  (.pods[] | \"INSERT INTO pods VALUES ('\\''\\(.name)'\\'', '\\''\\(.node)'\\'', \\(.req_cpu_m), \\(.req_mem_mb));\")\n' | sqlite3 /workspace/cap.db\nsqlite3 -separator '|' /workspace/cap.db \"\n  SELECT n.name, n.zone,\n         SUM(p.req_cpu_m) AS used_cpu,\n         n.cpu_m - SUM(p.req_cpu_m) AS free_cpu,\n         ROUND(100.0 * SUM(p.req_cpu_m) / n.cpu_m, 1) AS cpu_pct\n  FROM nodes n JOIN pods p ON n.name = p.node\n  GROUP BY n.name, n.zone, n.cpu_m\n  ORDER BY n.name;\n\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "node-1|us-east-1a|2500|1500|62.5\nnode-2|us-east-1b|4000|4000|50.0\n");
    } finally {
      await h.dispose();
    }
  });

  it("02_xml_soap_order_feed_to_xan_and_csvsql_revenue_rollup", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/orders.xml\n<batch>\n  <order id=\"O-100\" region=\"US\"><sku>PRO-1</sku><qty>4</qty><unit_price>125</unit_price></order>\n  <order id=\"O-101\" region=\"EU\"><sku>PRO-2</sku><qty>2</qty><unit_price>300</unit_price></order>\n  <order id=\"O-102\" region=\"US\"><sku>PRO-1</sku><qty>6</qty><unit_price>125</unit_price></order>\n</batch>\nEOF\nxq -r '\n  [\"order_id\",\"region\",\"sku\",\"qty\",\"unit_price\"],\n  (.batch.order[] | [.\"@id\", .\"@region\", .sku, .qty, .unit_price])\n  | @csv\n' /workspace/orders.xml > /workspace/orders.csv\nxan map 'qty * unit_price' line_rev /workspace/orders.csv > /workspace/orders_enriched.csv\ncsvsql --query \"\n  SELECT region, COUNT(*) AS orders, SUM(CAST(line_rev AS INT)) AS total_rev\n  FROM orders_enriched\n  GROUP BY region\n  ORDER BY total_rev DESC\n\" /workspace/orders_enriched.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "region,orders,total_rev\nUS,2,1250\nEU,1,600\n");
    } finally {
      await h.dispose();
    }
  });

  it("03_html_status_page_scrape_to_pdf_incident_report", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/status.html\n<html>\n  <body>\n    <div class=\"component\" data-name=\"API Gateway\"><span class=\"state\">Operational</span></div>\n    <div class=\"component\" data-name=\"Billing Worker\"><span class=\"state\">Degraded</span></div>\n  </body>\n</html>\nEOF\nnames=$(htmlq -a data-name '.component' -f /workspace/status.html)\nstates=$(htmlq -t '.component .state' -f /workspace/status.html)\npaste -d':' <(printf \"%s\\n\" \"$names\") <(printf \"%s\\n\" \"$states\") > /workspace/status_summary.txt\nsoffice --headless --convert-to pdf --outdir /workspace /workspace/status_summary.txt >/dev/null 2>&1\npdftotext /workspace/status_summary.pdf - | grep -E \"API Gateway|Billing Worker\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "API Gateway:Operational\nBilling Worker:Degraded\n");
    } finally {
      await h.dispose();
    }
  });

  it("04_pdf_multi_chapter_assembly_encryption_decryption_and_split", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/ch1.html\n<html><body><h1>Part 1: Architecture</h1><p>Zero-copy Wasm virtual filesystem.</p></body></html>\nEOF\ncat << 'EOF' > /workspace/ch2.html\n<html><body><h1>Part 2: Benchmarks</h1><p>Sub-millisecond command dispatch.</p></body></html>\nEOF\nwkhtmltopdf /workspace/ch1.html /workspace/ch1.pdf >/dev/null 2>&1\nwkhtmltopdf /workspace/ch2.html /workspace/ch2.pdf >/dev/null 2>&1\npdfunite /workspace/ch1.pdf /workspace/ch2.pdf /workspace/manual.pdf\nqpdf --encrypt userpass ownerpass 256 -- /workspace/manual.pdf /workspace/manual_enc.pdf\nqpdf --is-encrypted /workspace/manual_enc.pdf && printf \"encrypted=yes\\n\"\nqpdf --password=userpass --decrypt /workspace/manual_enc.pdf /workspace/manual_dec.pdf\nqpdf --show-npages /workspace/manual_dec.pdf");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "encrypted=yes\n2\n");
    } finally {
      await h.dispose();
    }
  });

  it("05_image_pipeline_magick_sips_exiftool_and_pdfimages", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("magick -size 160x100 xc:skyblue /workspace/hero.png\nsips -z 80 120 /workspace/hero.png >/dev/null\nexiftool -Artist=\"PoeDesign\" -Copyright=\"2026 Poe\" -overwrite_original /workspace/hero.png >/dev/null\nmagick identify -format \"%m %wx%h\\n\" /workspace/hero.png\nexiftool -s3 -Artist -Copyright /workspace/hero.png");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG 120x80\nPoeDesign\n2026 Poe\n");
    } finally {
      await h.dispose();
    }
  });

  it("06_video_audio_synthesis_muxing_and_ffprobe_inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=3:size=320x180:rate=24 -f lavfi -i sine=frequency=1000:duration=3 -c:v libx264 -c:a aac /workspace/demo.mp4 >/dev/null 2>&1\nffprobe -v error -show_entries stream=codec_type,width,height -of csv=p=0 /workspace/demo.mp4");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "video,320,180\naudio\n");
    } finally {
      await h.dispose();
    }
  });

  it("07_mermaid_diagram_and_rtf_markdown_documentation_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/arch.mmd\nsequenceDiagram\n  Client->>Edge: HTTPS Request\n  Edge->>Worker: RPC Dispatch\nEOF\nmmdc -i /workspace/arch.mmd -o /workspace/arch.svg\ngrep -c \"Edge\" /workspace/arch.svg\ncat << 'EOF' > /workspace/notes.rtf\n{\\rtf1\\ansi{\\b Architecture Decision Record}\\par Use deterministic sandboxed execution.}\nEOF\nunrtf --text /workspace/notes.rtf | grep -o \"Architecture Decision Record\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "2\nArchitecture Decision Record\n");
    } finally {
      await h.dispose();
    }
  });

  it("08_repo_refactoring_with_rg_sed_sponge_diff_and_patch", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/src_repo/pkg\ncat << 'EOF' > /workspace/src_repo/pkg/index.ts\nexport const VERSION = \"1.0.0-beta.1\";\nexport function greet(name: string) {\n  return `hello ${name} from 1.0.0-beta.1`;\n}\nEOF\ncp -r /workspace/src_repo /workspace/src_repo_orig\nfor f in $(rg -l \"1\\.0\\.0-beta\\.1\" /workspace/src_repo); do\n  sed 's/1\\.0\\.0-beta\\.1/1.0.0/g' \"$f\" | sponge \"$f\"\ndone\ndiff -u /workspace/src_repo_orig/pkg/index.ts /workspace/src_repo/pkg/index.ts > /workspace/release.patch || true\ngrep -E '^[+-]export const VERSION' /workspace/release.patch");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "-export const VERSION = \"1.0.0-beta.1\";\n+export const VERSION = \"1.0.0\";\n");
    } finally {
      await h.dispose();
    }
  });

  it("09_nested_tar_gzip_xz_zstd_archive_with_sha256_manifest", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/dist/bin\nprintf \"wasm_binary_payload_v100\\n\" > /workspace/dist/bin/app.wasm\nprintf \"config_payload_v100\\n\" > /workspace/dist/config.json\n(cd /workspace/dist && sha256sum bin/app.wasm config.json > SHA256SUMS)\ntar -cf - -C /workspace dist | gzip -c | xz -c | zstd -q -c > /workspace/dist.tar.gz.xz.zst\nmkdir -p /workspace/unpack_dist\nzstd -q -d -c /workspace/dist.tar.gz.xz.zst | xz -d -c | gzip -d -c | tar -xf - -C /workspace/unpack_dist\n(cd /workspace/unpack_dist/dist && sha256sum -c SHA256SUMS)");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "bin/app.wasm: OK\nconfig.json: OK\n");
    } finally {
      await h.dispose();
    }
  });

  it("10_binary_protocol_header_inspection_with_xxd_od_dd_base64", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"\\x89PNG\\r\\n\\x1a\\nPAYLOAD_DATA_2026\" > /workspace/packet.bin\ndd if=/workspace/packet.bin of=/workspace/magic.bin bs=1 count=8 status=none\ndd if=/workspace/packet.bin of=/workspace/body.bin bs=1 skip=8 status=none\nprintf \"magic_hex=%s\\nbody=%s\\nb64=%s\\n\" \\\n  \"$(xxd -p /workspace/magic.bin | tr -d '\\n')\" \\\n  \"$(cat /workspace/body.bin)\" \\\n  \"$(base64 < /workspace/body.bin | tr -d '\\n')\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "magic_hex=89504e470d0a1a0a\nbody=PAYLOAD_DATA_2026\nb64=UEFZTE9BRF9EQVRBXzIwMjY=\n");
    } finally {
      await h.dispose();
    }
  });

  it("11_sqlite3_window_frames_cte_and_json_aggregation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 :memory: << 'EOF'\nCREATE TABLE latency(svc TEXT, ts INT, ms INT);\nINSERT INTO latency VALUES\n  ('gateway', 1, 10),\n  ('gateway', 2, 20),\n  ('gateway', 3, 30),\n  ('auth', 1, 5),\n  ('auth', 2, 15);\nWITH ranked AS (\n  SELECT svc, ts, ms,\n         AVG(ms) OVER (PARTITION BY svc ORDER BY ts ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS mov_avg\n  FROM latency\n)\nSELECT svc || \":\" || ts || \"=\" || ROUND(mov_avg, 1) FROM ranked ORDER BY svc, ts;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "auth:1=5.0\nauth:2=10.0\ngateway:1=10.0\ngateway:2=15.0\ngateway:3=25.0\n");
    } finally {
      await h.dispose();
    }
  });

  it("12_awk_log_sessionizer_and_percentile_estimator", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("awk '\n  {\n    vals[++n] = $2\n    sum += $2\n    by_user[$1] += $2\n  }\n  END {\n    printf \"count=%d sum=%d\\n\", n, sum\n    for (u in by_user) {\n      printf \"user:%s=%d\\n\", u, by_user[u]\n    }\n  }\n' << 'EOF' | sort\nalice 120\nbob 80\nalice 180\ncarol 200\nbob 120\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "count=5 sum=700\nuser:alice=300\nuser:bob=200\nuser:carol=200\n");
    } finally {
      await h.dispose();
    }
  });

  it("13_sed_multi_buffer_config_section_rewriter", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sed -n '\n  /^\\[production\\]/,/^\\[/ {\n    s/debug = true/debug = false/\n    s/workers = [0-9]+/workers = 16/\n    /^\\[production\\]/p\n    /^debug =/p\n    /^workers =/p\n  }\n' -E << 'EOF'\n[development]\ndebug = true\nworkers = 2\n\n[production]\ndebug = true\nworkers = 4\n\n[staging]\ndebug = true\nworkers = 1\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[production]\ndebug = false\nworkers = 16\n");
    } finally {
      await h.dispose();
    }
  });

  it("14_jq_complex_etl_normalization_and_schema_validation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/raw_users.json\n[\n  {\"id\": \"101\", \"email\": \"  ALICE@POE.COM \", \"roles\": [\"user\", \"admin\", \"user\"], \"active\": 1},\n  {\"id\": \"102\", \"email\": \"bob@poe.com\", \"roles\": [], \"active\": 0},\n  {\"id\": \"103\", \"email\": \"CAROL@POE.COM \", \"roles\": [\"editor\"], \"active\": 1}\n]\nEOF\njq -c '\n  map(select(.active == 1))\n  | map({\n      uid: (.id | tonumber),\n      email: (.email | gsub(\"^\\\\s+|\\\\s+$\"; \"\") | ascii_downcase),\n      roles: (.roles | unique | sort)\n    })\n  | sort_by(.uid)\n' /workspace/raw_users.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"uid\":101,\"email\":\"alice@poe.com\",\"roles\":[\"admin\",\"user\"]},{\"uid\":103,\"email\":\"carol@poe.com\",\"roles\":[\"editor\"]}]\n");
    } finally {
      await h.dispose();
    }
  });

  it("15_xan_and_csvkit_cross_validation_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/ledger.csv\ntx_id,account,amount,currency\nT1,acct_a,250,USD\nT2,acct_b,400,EUR\nT3,acct_a,150,USD\nT4,acct_c,600,USD\nEOF\nxan filter 'currency == \"USD\"' /workspace/ledger.csv \\\n  | csvsort -c amount -r \\\n  | csvcut -c tx_id,account,amount");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "tx_id,account,amount\nT4,acct_c,600\nT1,acct_a,250\nT3,acct_a,150\n");
    } finally {
      await h.dispose();
    }
  });

  it("16_bash_trap_subshell_coproc_nameref_and_array_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("accumulate() {\n  local -n out_arr=\"$1\"\n  shift\n  local running=0\n  for v in \"$@\"; do\n    running=$(( running + v ))\n    out_arr+=(\"$running\")\n  done\n}\ndeclare -a totals=()\naccumulate totals 10 25 15 50\nprintf \"totals=%s count=%d\\n\" \"${totals[*]}\" \"${#totals[@]}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "totals=10 35 50 100 count=4\n");
    } finally {
      await h.dispose();
    }
  });

  it("17_find_fd_symlink_stat_realpath_and_tree_audit", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/vfs_audit/configs /workspace/vfs_audit/bin\nprintf \"port=8080\\n\" > /workspace/vfs_audit/configs/app.ini\nln -s /workspace/vfs_audit/configs/app.ini /workspace/vfs_audit/bin/active.ini\nresolved=$(realpath /workspace/vfs_audit/bin/active.ini)\nsize=$(stat -c '%s' \"$resolved\")\nprintf \"resolved=%s size=%s\\n\" \"$resolved\" \"$size\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "resolved=/workspace/vfs_audit/configs/app.ini size=10\n");
    } finally {
      await h.dispose();
    }
  });

  it("18_three_way_merge_diff3_and_apply_patch_workflow", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/m_base.txt\nalpha=1\nbeta=2\ngamma=3\nEOF\ncat << 'EOF' > /workspace/m_left.txt\nalpha=10\nbeta=2\ngamma=3\nEOF\ncat << 'EOF' > /workspace/m_right.txt\nalpha=1\nbeta=2\ngamma=30\nEOF\ndiff3 -m /workspace/m_left.txt /workspace/m_base.txt /workspace/m_right.txt > /workspace/m_merged.txt\ncat /workspace/m_merged.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha=10\nbeta=2\ngamma=30\n");
    } finally {
      await h.dispose();
    }
  });

  it("19_math_and_formatting_bc_factor_seq_numfmt_tsort", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("primes=$(factor 210 | cut -d: -f2 | tr -s ' ' ',')\nscaled=$(numfmt --to=si 2500000)\npi_approx=$(printf \"scale=4; 355 / 113\\n\" | bc)\nprintf \"factors=%s scaled=%s pi=%s\\n\" \"$primes\" \"$scaled\" \"$pi_approx\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "factors=,2,3,5,7 scaled=2.5M pi=3.1415\n");
    } finally {
      await h.dispose();
    }
  });

  it("20_milestone_100_end_to_end_signed_release_attestation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/release_v100\ncat << 'EOF' > /workspace/release_v100/manifest.yaml\nrelease: v100.0.0\nartifacts:\n  - name: engine.wasm\n    size: 2048\n  - name: cli.js\n    size: 512\nEOF\nyq -o=json '.' /workspace/release_v100/manifest.yaml > /workspace/release_v100/manifest.json\nsha=$(sha256sum /workspace/release_v100/manifest.json | awk '{print $1}')\njq -c --arg sha \"$sha\" '{release: .release, artifact_count: (.artifacts | length), total_bytes: ([.artifacts[].size] | add), sha256_prefix: ($sha | .[0:16])}' /workspace/release_v100/manifest.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"release\":\"v100.0.0\",\"artifact_count\":2,\"total_bytes\":2560,\"sha256_prefix\":\"18d2a0b8e3f06341\"}\n");
    } finally {
      await h.dispose();
    }
  });

});
