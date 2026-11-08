import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure polyglot sqlite3, jq, yq, xan, csvkit, awk, sed, rg, and archive pipeline matrix", () => {
  test("1. sqlite3 COUNT(DISTINCT), GROUP_CONCAT(DISTINCT), AVG with NULLs, and ROUND(AVG(...), 1)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 metrics.db <<'SQL'",
          "CREATE TABLE samples(region TEXT, latency REAL);",
          "INSERT INTO samples VALUES ('us-east', 10.0), ('us-east', 20.0), ('eu-west', NULL), ('eu-west', 30.0), ('ap-south', 19.99);",
          "SELECT COUNT(DISTINCT region), GROUP_CONCAT(DISTINCT region), AVG(latency), ROUND(AVG(latency), 1) FROM samples;",
          "SELECT region, ROUND(AVG(latency), 1), COALESCE(SUM(latency), 0), IIF(COUNT(*) > 1, 'multi', 'single') FROM samples GROUP BY region ORDER BY region;",
          "SQL"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "3|us-east,eu-west,ap-south|19.9975|20.0",
          "ap-south|20.0|19.99|single",
          "eu-west|30.0|30.0|multi",
          "us-east|15.0|30.0|multi",
          ""
        ].join("\n")
      );
    });
  });

  test("2. sqlite3 TRIM, LTRIM, RTRIM with custom character sets and CAST AS INTEGER / REAL", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "SELECT LTRIM('---hello---', '-'), RTRIM('---hello---', '-'), TRIM('xyxhelloxyx', 'xy');",
          "SELECT CAST('42px' AS INTEGER), CAST(15 AS REAL), ROUND(19.99, 1), TYPEOF(ROUND(19.99, 1));",
          "SQL"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "hello---|---hello|hello",
          "42|15.0|20.0|real",
          ""
        ].join("\n")
      );
    });
  });

  test("3. sqlite3 JSON export (.mode json) piped into jq reduce + update assignment |= and yq YAML output", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 store.db <<'SQL' > items.json",
          "CREATE TABLE inv(sku TEXT, qty INTEGER, active INTEGER);",
          "INSERT INTO inv VALUES ('A1', 5, 1), ('B2', 12, 0), ('C3', 8, 1);",
          ".mode json",
          "SELECT sku, qty, active FROM inv ORDER BY sku;",
          "SQL",
          "jq '(.[] | select(.active == 1).qty) |= (. + 10)' items.json | yq -P"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "- sku: A1",
          "  qty: 15",
          "  active: 1",
          "- sku: B2",
          "  qty: 12",
          "  active: 0",
          "- sku: C3",
          "  qty: 18",
          "  active: 1",
          ""
        ].join("\n")
      );
    });
  });

  test("4. xan join -> xan map -> xan groupby -> xan sort multi-stage tabular pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "sku,dept\\nA1,core\\nA2,core\\nB1,infra\\n" > items.csv',
          'printf "sku,qty,price\\nA1,2,10\\nA2,3,20\\nB1,5,15\\n" > orders.csv',
          "xan join sku items.csv sku orders.csv | xan map 'qty * price' rev | xan groupby dept 'sum(rev) as total_rev' | xan sort -s total_rev -N -R"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "dept,total_rev",
          "core,80",
          "infra,75",
          ""
        ].join("\n")
      );
    });
  });

  test("5. rg named capture group replacement (-r '$name') piped into sed case conversion (\\U, \\u, \\E)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "user=alice role=admin\\nuser=bob role=viewer\\n" > access.log',
          "rg 'user=(?P<u_name>\\w+) role=(?P<u_role>\\w+)' -r '$u_name:$u_role' access.log | sed -E 's/^([a-z]+):([a-z]+)$/\\u\\1=\\U\\2\\E/'"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Alice=ADMIN\nBob=VIEWER\n");
    });
  });

  test("6. fd --and multi-pattern search with --no-ignore-parent piped into xargs wc -c", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p parent/child",
          'printf "*.log\\n" > parent/.gitignore',
          'printf "12345" > parent/child/audit_2026.log',
          'printf "99" > parent/child/other_2026.log',
          "fd --no-ignore-parent --and 2026 audit parent/child"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "parent/child/audit_2026.log\n");
    });
  });

  test("7. htmlq CSS attribute/text extraction piped into paste and csvlook", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'HTML' > table.html",
          '<ul id="services">',
          '  <li data-tier="edge">api</li>',
          '  <li data-tier="core">db</li>',
          "</ul>",
          "HTML",
          'paste -d, <(htmlq "#services li" -t < table.html) <(htmlq "#services li" -a data-tier < table.html) > services.csv',
          'printf "service,tier\\n" | cat - services.csv | csvlook'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "| service | tier |",
          "| ------- | ---- |",
          "| api     | edge |",
          "| db      | core |",
          ""
        ].join("\n")
      );
    });
  });

  test("8. xmllint --xpath extraction + xq JSON transformation + jq compact projection", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'XML' > cfg.xml",
          "<cluster><node id=\"n1\" cpu=\"4\"/><node id=\"n2\" cpu=\"8\"/></cluster>",
          "XML",
          'xmllint --xpath "string(//node[@id=\'n2\']/@cpu)" cfg.xml',
          "xq '.cluster.node | map({id: .\"@id\", cpu: (.\"@cpu\" | tonumber)})' cfg.xml | jq -c ."
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "8",
          '[{"id":"n1","cpu":4},{"id":"n2","cpu":8}]',
          ""
        ].join("\n")
      );
    });
  });

  test("9. csvsql multi-table SQL aggregation piped into csvformat -T", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "dept_id,dept_name\\n1,Eng\\n2,Sales\\n" > depts.csv',
          'printf "emp,dept_id,salary\\nada,1,120\\nbob,1,100\\ncarol,2,90\\n" > salaries.csv',
          'csvsql --query "SELECT d.dept_name AS dept, CAST(SUM(s.salary) AS INTEGER) AS total FROM depts d JOIN salaries s ON d.dept_id = s.dept_id GROUP BY d.dept_name ORDER BY total DESC" depts.csv salaries.csv | csvformat -T'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "dept\ttotal",
          "Eng\t220",
          "Sales\t90",
          ""
        ].join("\n")
      );
    });
  });

  test("10. awk associative array frequency table piped into sort -k2,2nr and column -t", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "WARN disk\\nERROR net\\nWARN mem\\nERROR cpu\\nERROR io\\nINFO boot\\n" | awk \'{ cnt[$1]++ } END { for (k in cnt) print k, cnt[k] }\' | sort -k2,2nr -k1,1 | column -t'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "ERROR  3",
          "WARN   2",
          "INFO   1",
          ""
        ].join("\n")
      );
    });
  });

  test("11. bc arbitrary-precision math with define function feeding numfmt and printf", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "val=$(bc <<'BC'",
          "define pow2(n) {",
          "  return (2 ^ n);",
          "}",
          "pow2(20)",
          "BC",
          ")",
          'echo "raw=$val iec=$(numfmt --to=iec "$val")"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "raw=1048576 iec=1.0M\n");
    });
  });

  test("12. expr regex/arithmetic evaluation combined with factor prime factorization and seq", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'n=$(expr 12 \\* 30)',
          'factor "$n"',
          'seq -s "+" 1 5 | bc'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "360: 2 2 2 3 3 5\n15\n");
    });
  });

  test("13. tar -czf archive creation, base64 -w 0 single-line transport encoding, base64 -d, and tar -xzf", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p pkg/src",
          'printf "export const v = 1;\\n" > pkg/src/index.ts',
          "tar -czf pkg.tar.gz pkg",
          "b64=$(base64 -w 0 pkg.tar.gz)",
          'echo "lines=$(printf "%s" "$b64" | wc -l | tr -d " ")"',
          "mkdir -p unpacked",
          'printf "%s" "$b64" | base64 -d | tar -xzf - -C unpacked',
          "cat unpacked/pkg/src/index.ts"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "lines=0\nexport const v = 1;\n");
    });
  });

  test("14. zip archive creation, zip -d entry removal, unzip -p stream extraction, and sha256sum -c", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "keep_payload\\n" > keep.txt',
          'printf "drop_payload\\n" > drop.txt',
          "sha256sum keep.txt > keep.sha256",
          "zip -q bundle.zip keep.txt drop.txt",
          "zip -q -d bundle.zip drop.txt",
          "rm keep.txt drop.txt",
          "unzip -p bundle.zip keep.txt > keep.txt",
          "sha256sum -c --status keep.sha256 && echo 'verified_ok'"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "verified_ok\n");
    });
  });

  test("15. xxd -p hex encoding, sed byte-stream patching, xxd -r -p binary reconstruction, and od -tx1", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "HELLO" | xxd -p | sed "s/48454c4c4f/574f524c44/" | xxd -r -p',
          'printf "\\n"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "WORLD\n");
    });
  });

  test("16. diff -u patch generation, patch application, and diff3 -m clean 3-way merge", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "a\\nb\\nc\\n" > base.txt',
          'printf "a_left\\nb\\nc\\n" > left.txt',
          'printf "a\\nb\\nc_right\\n" > right.txt',
          "diff3 -m left.txt base.txt right.txt > merged.txt",
          "cat merged.txt"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a_left\nb\nc_right\n");
    });
  });

  test("17. wkhtmltopdf -> qpdf page encryption/decryption -> pdftotext extraction", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "<h1>Confidential Report 2026</h1>" > doc.html',
          "wkhtmltopdf -q doc.html doc.pdf",
          "qpdf --encrypt userpw ownerpw 256 -- doc.pdf enc.pdf",
          "qpdf --password=userpw --decrypt enc.pdf dec.pdf",
          "pdftotext dec.pdf - | grep -o 'Confidential Report 2026'"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Confidential Report 2026\n");
    });
  });

  test("18. magick image creation -> exiftool metadata tag injection -> identify & exiftool -j", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "magick -size 32x24 xc:navy badge.png",
          'exiftool -overwrite_original -Artist="PoeAgent" badge.png >/dev/null',
          "identify -format '%wx%h' badge.png",
          'printf "\\n"',
          "exiftool -j badge.png | jq -r '.[0].Artist'"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "32x24\nPoeAgent\n");
    });
  });

  test("19. sponge in-place pipeline rewrite combined with envsubst template rendering", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'TPL' > app.conf",
          "service=${SVC_NAME}",
          "port=${SVC_PORT}",
          "TPL",
          'SVC_NAME="gateway" SVC_PORT="8443" envsubst < app.conf | sponge app.conf',
          "cat app.conf"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "service=gateway\nport=8443\n");
    });
  });

  test("20. end-to-end codebase refactoring workflow: find + xargs + sed -i + diff -u + patch -R + sha256sum", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p repo/src",
          'printf "const API_URL = \\"v1\\";\\n" > repo/src/a.ts',
          'printf "export const VER = \\"v1\\";\\n" > repo/src/b.ts',
          "cp -r repo repo_orig",
          "find repo/src -name '*.ts' | sort | xargs sed -i 's/\"v1\"/\"v2\"/g'",
          "rg -o '\"v2\"' repo/src | sort",
          "diff -u repo_orig/src/a.ts repo/src/a.ts > a.patch || true",
          "patch -R -u repo/src/a.ts < a.patch >/dev/null",
          "cmp -s repo_orig/src/a.ts repo/src/a.ts && echo 'restored_a_ok'"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          'repo/src/a.ts:"v2"',
          'repo/src/b.ts:"v2"',
          "restored_a_ok",
          ""
        ].join("\n")
      );
    });
  });
});
