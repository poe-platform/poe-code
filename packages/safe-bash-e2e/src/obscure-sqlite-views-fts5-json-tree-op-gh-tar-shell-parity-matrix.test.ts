import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 views/json_each/json_tree/returning/generated, op/gh, csvkit/xan, and shell parity matrix", () => {
  it("01. sqlite3 CREATE VIEW, SELECT from view with WHERE/ORDER BY, and DROP VIEW", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/views.db <<'SQL'
          CREATE TABLE products (id INT PRIMARY KEY, name TEXT, price INT, active INT);
          INSERT INTO products VALUES (1, 'Keyboard', 80, 1), (2, 'Mouse', 40, 1), (3, 'CRT', 15, 0);
          CREATE VIEW active_products AS SELECT id, name, price FROM products WHERE active = 1;
          SELECT name, price FROM active_products WHERE price >= 40 ORDER BY price DESC;
          DROP VIEW active_products;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Keyboard|80\nMouse|40\n");
    });
  });

  it("02. sqlite3 json_each() table-valued function over JSON array and object", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/jeach.db <<'SQL'
          SELECT key, value FROM json_each('["alpha","beta","gamma"]');
          SELECT key, value FROM json_each('{"host":"db.internal","port":5432}');
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "0|alpha",
          "1|beta",
          "2|gamma",
          "host|db.internal",
          "port|5432",
          ""
        ].join("\n")
      );
    });
  });

  it("03. sqlite3 json_tree() recursive JSON traversal", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/jtree.db <<'SQL'
          SELECT fullkey, type, COALESCE(atom, '') FROM json_tree('{"a":{"b":42}}') ORDER BY fullkey;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "$|object|",
          "$.a|object|",
          "$.a.b|integer|42",
          ""
        ].join("\n")
      );
    });
  });

  it("04. sqlite3 generate_series(start, stop, step) table-valued function", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/series.db <<'SQL'
          SELECT GROUP_CONCAT(value, ','), SUM(value) FROM generate_series(2, 10, 2);
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "2,4,6,8,10|30\n");
    });
  });

  it("05. sqlite3 INSERT RETURNING, UPDATE RETURNING, and DELETE RETURNING", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/returning.db <<'SQL'
          CREATE TABLE tasks (id INT PRIMARY KEY, title TEXT, done INT);
          INSERT INTO tasks VALUES (1, 'build', 0), (2, 'test', 0) RETURNING id, title;
          UPDATE tasks SET done = 1 WHERE id = 1 RETURNING id, done;
          DELETE FROM tasks WHERE id = 2 RETURNING id, title;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1|build",
          "2|test",
          "1|1",
          "2|test",
          ""
        ].join("\n")
      );
    });
  });

  it("06. sqlite3 GENERATED ALWAYS AS computed columns and CHECK constraints", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/computed.db <<'SQL'
          CREATE TABLE line_items (
            id INT PRIMARY KEY,
            qty INT CHECK (qty > 0),
            unit_price INT,
            subtotal INT GENERATED ALWAYS AS (qty * unit_price)
          );
          INSERT INTO line_items (id, qty, unit_price) VALUES (1, 3, 25), (2, 4, 15);
          SELECT id, qty, unit_price, subtotal FROM line_items ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1|3|25|75",
          "2|4|15|60",
          ""
        ].join("\n")
      );
    });
  });

  it("07. sqlite3 FOREIGN KEY enforcement with PRAGMA foreign_keys = ON", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/fk.db <<'SQL'
          PRAGMA foreign_keys = ON;
          CREATE TABLE parents (id INT PRIMARY KEY);
          CREATE TABLE children (id INT PRIMARY KEY, parent_id INT REFERENCES parents(id));
          INSERT INTO parents VALUES (10);
          INSERT INTO children VALUES (1, 10);
SQL
        set +e
        sqlite3 /workspace/fk.db "PRAGMA foreign_keys = ON; INSERT INTO children VALUES (2, 999);" >/dev/null 2>&1
        FK_RC=$?
        set -e
        VALID_CNT=$(sqlite3 /workspace/fk.db "SELECT COUNT(*) FROM children;")
        echo "fk_rejected=$((FK_RC != 0)) valid=$VALID_CNT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "fk_rejected=1 valid=1\n");
    });
  });

  it("08. op file attachment assignment (field[file]=path), op read -o out-file, and ?attribute=size", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/op_att
        printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test@poe' > /workspace/op_att/id_ed25519.pub
        op vault create "KeyV" >/dev/null
        op item create --category login --title "DeployKey" --vault KeyV \\
          username=deployer "pubkey[file]=/workspace/op_att/id_ed25519.pub" >/dev/null
        SZ=$(op read "op://KeyV/DeployKey/pubkey?attribute=size")
        op read -o /workspace/op_att/restored.pub "op://KeyV/DeployKey/pubkey" >/dev/null
        cmp -s /workspace/op_att/id_ed25519.pub /workspace/op_att/restored.pub && CMP_OK=1 || CMP_OK=0
        echo "sz=$SZ cmp=$CMP_OK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "sz=46 cmp=1\n");
    });
  });

  it("09. op inject multiple secret references per line and -f overwrite flag", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "MultiV" >/dev/null
        op item create --category login --title "Db" --vault MultiV username=pgadmin password=pgsecret >/dev/null
        printf 'url=postgres://{{ op://MultiV/Db/username }}:{{ op://MultiV/Db/password }}@db:5432/app\n' > /workspace/dsn.tpl
        op inject -i /workspace/dsn.tpl -o /workspace/dsn.out >/dev/null
        op inject -f -i /workspace/dsn.tpl -o /workspace/dsn.out >/dev/null
        cat /workspace/dsn.out
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "url=postgres://pgadmin:pgsecret@db:5432/app\n");
    });
  });

  it("10. gh pr create with labels, gh pr close, gh pr reopen, and gh pr list --state filters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/pr-lifecycle --private >/dev/null
        gh pr create -R acme/pr-lifecycle --title "fix: race condition" --body "Fixes #1" --head fix/race --base main >/dev/null
        gh pr close 1 -R acme/pr-lifecycle >/dev/null
        CLOSED_CNT=$(gh pr list -R acme/pr-lifecycle --state closed --json number | jq 'length')
        gh pr reopen 1 -R acme/pr-lifecycle >/dev/null
        OPEN_CNT=$(gh pr list -R acme/pr-lifecycle --state open --json number | jq 'length')
        echo "closed=$CLOSED_CNT open=$OPEN_CNT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "closed=1 open=1\n");
    });
  });

  it("11. gh release create with --notes, --prerelease, view --json, and list --json", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/rel-app --private >/dev/null
        gh release create v2.0.0-rc.1 -R acme/rel-app --title "2.0 RC1" --notes "Release candidate" --prerelease >/dev/null
        VIEW=$(gh release view v2.0.0-rc.1 -R acme/rel-app --json tagName,name,isPrerelease | jq -c '{tagName,name,isPrerelease}')
        echo "view=$VIEW"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        'view={"tagName":"v2.0.0-rc.1","name":"2.0 RC1","isPrerelease":true}\n'
      );
    });
  });

  it("12. tar compression with -z, -j, -J, and --zstd flags and -tf listing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/tflags/src
        printf 'tar-flag-payload\n' > /workspace/tflags/src/item.txt
        tar -czf /workspace/tflags/a.tgz -C /workspace/tflags/src item.txt
        tar -cjf /workspace/tflags/a.tbz2 -C /workspace/tflags/src item.txt
        tar -cJf /workspace/tflags/a.txz -C /workspace/tflags/src item.txt
        tar --zstd -cf /workspace/tflags/a.tzst -C /workspace/tflags/src item.txt

        L1=$(tar -tf /workspace/tflags/a.tgz)
        L2=$(tar -tf /workspace/tflags/a.tbz2)
        L3=$(tar -tf /workspace/tflags/a.txz)
        L4=$(tar -tf /workspace/tflags/a.tzst)
        echo "$L1:$L2:$L3:$L4"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "item.txt:item.txt:item.txt:item.txt\n");
    });
  });

  it("13. csvcut -c, csvgrep -c -m, csvstat --count, and csvjson pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'CSV' > /workspace/emp.csv
id,name,dept,salary
1,Ada,eng,150
2,Grace,eng,160
3,Alan,sec,140
CSV
        CNT=$(csvstat --count /workspace/emp.csv | tr -dc '0-9')
        ENG_NAMES=$(csvgrep -c dept -m eng /workspace/emp.csv | csvcut -c name | tail -n +2 | tr '\\n' ',')
        JSON_FIRST=$(csvjson /workspace/emp.csv | jq -r '.[0].name')
        echo "cnt=$CNT eng=$ENG_NAMES first=$JSON_FIRST"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "cnt=3 eng=Ada,Grace, first=Ada\n");
    });
  });

  it("14. xan count, headers, select, and sort CSV analytics pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'CSV' > /workspace/metrics.csv
host,latency,region
web-2,45,eu
web-1,12,us
web-3,28,apac
CSV
        ROWS=$(xan count /workspace/metrics.csv | tr -d '[:space:]')
        SORTED=$(xan select host,latency /workspace/metrics.csv | xan sort -s host | tail -n +2 | tr '\\n' ';')
        echo "rows=$ROWS sorted=$SORTED"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "rows=3 sorted=web-1,12;web-2,45;web-3,28;\n");
    });
  });

  it("15. dot and neato Graphviz rendering across -Tsvg, -Tjson, -Tplain, and -Tcanon", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'DOT' > /workspace/topology.dot
digraph Mesh {
  rankdir=LR;
  ingress -> router [label="tls"];
  router -> worker;
}
DOT
        SVG_OK=$(dot -Tsvg /workspace/topology.dot | grep -c '<svg')
        JSON_NODES=$(dot -Tjson /workspace/topology.dot | jq '.nodes | length')
        PLAIN_GRAPH=$(dot -Tplain /workspace/topology.dot | head -n 1 | awk '{print $1}')
        echo "svg=$((SVG_OK >= 1)) nodes=$JSON_NODES plain=$PLAIN_GRAPH"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "svg=1 nodes=3 plain=graph\n");
    });
  });

  it("16. openssl dgst -sha256 -hmac, enc -aes-256-cbc -pbkdf2 -base64, and rand -hex", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        HMAC=$(printf 'message-payload' | openssl dgst -sha256 -hmac "secret-key" | awk '{print $NF}')
        B64=$(printf 'openssl-roundtrip' | openssl enc -aes-256-cbc -pbkdf2 -pass pass:secret -base64 | tr -d '\\n')
        DEC=$(printf '%s\n' "$B64" | openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:secret -base64)
        RHEX=$(openssl rand -hex 8 | tr -d '\\n')
        echo "hmac_len=\${#HMAC} dec=$DEC rhex_len=\${#RHEX}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "hmac_len=64 dec=openssl-roundtrip rhex_len=16\n");
    });
  });

  it("17. bash nameref (declare -n / local -n) indirection and function out-parameter mutation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        assign_out() {
          local -n out_ref="$1"
          out_ref="computed:$2"
        }
        target_a="initial"
        target_b="initial"
        assign_out target_a "alpha"
        declare -n ptr="target_b"
        ptr="beta"
        echo "a=$target_a b=$target_b"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "a=computed:alpha b=beta\n");
    });
  });

  it("18. bash process substitution <( ... ) with comm and paste", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        COMMON=$(comm -12 <(printf 'a\nb\nc\n') <(printf 'b\nc\nd\n') | tr '\\n' ',')
        PASTED=$(paste -d: <(printf 'k1\nk2\n') <(printf 'v1\nv2\n') | tr '\\n' ';')
        echo "common=$COMMON pasted=$PASTED"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "common=b,c, pasted=k1:v1;k2:v2;\n");
    });
  });

  it("19. bash errexit (set -e), nounset (set -u), pipefail, and short-circuit exemptions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        false || RECOVERED="yes"
        if false; then
          BRANCH="never"
        else
          BRANCH="else_taken"
        fi
        set +e
        (set -euo pipefail; false | true)
        PF_RC=$?
        (set -u; echo "$DEFINITELY_UNSET_VAR_XYZ") >/dev/null 2>&1
        UNSET_RC=$?
        set -e
        echo "rec=$RECOVERED branch=$BRANCH pf=$PF_RC unset_nz=$((UNSET_RC != 0))"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "rec=yes branch=else_taken pf=1 unset_nz=1\n");
    });
  });

  it("20. end-to-end polyglot data warehouse drill: csvjson -> jq -> sqlite3 view -> op -> gh -> tar.xz", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/dw/out
        cat <<'CSV' > /workspace/dw/raw.csv
region,rev
us,120
eu,80
us,180
CSV
        sqlite3 /workspace/dw/warehouse.db <<'SQL'
          CREATE TABLE sales (region TEXT, rev INT);
          INSERT INTO sales VALUES ('us', 120), ('eu', 80), ('us', 180);
          CREATE VIEW regional_totals AS
            SELECT region, SUM(rev) AS total_rev FROM sales GROUP BY region;
SQL
        US_REV=$(sqlite3 /workspace/dw/warehouse.db "SELECT total_rev FROM regional_totals WHERE region = 'us';")

        op vault create "DWVault" >/dev/null
        op item create --category login --title "WarehouseKey" --vault DWVault token=dw_tok_555 >/dev/null
        printf '{"us_rev":%s,"token":"{{ op://DWVault/WarehouseKey/token }}"}\n' "$US_REV" > /workspace/dw/summary.tpl
        op inject -i /workspace/dw/summary.tpl -o /workspace/dw/out/summary.json >/dev/null

        gh repo create acme/dw-snapshots --private >/dev/null
        gh release create v2026.11 -R acme/dw-snapshots --title "DW Snapshot" --notes "us_rev=$US_REV" >/dev/null

        tar -cJf /workspace/dw/snapshot.tar.xz -C /workspace/dw/out summary.json
        XZ_MAGIC=$(xxd -p -l 6 /workspace/dw/snapshot.tar.xz)
        EXTRACTED_REV=$(tar -xJf /workspace/dw/snapshot.tar.xz -O summary.json | jq -r '.us_rev')
        echo "magic=$XZ_MAGIC rev=$EXTRACTED_REV"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "magic=fd377a585a00 rev=300\n");
    });
  });
});
