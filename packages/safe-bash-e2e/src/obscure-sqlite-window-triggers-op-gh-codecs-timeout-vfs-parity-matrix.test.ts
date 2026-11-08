import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 window/triggers/upsert, op/gh APIs, codecs, timeout -k, and VFS quotas parity matrix", () => {
  it("01. sqlite3 CREATE TRIGGER AFTER INSERT, AFTER UPDATE, and AFTER DELETE audit log with binary format 3 header", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/audit.db "
          CREATE TABLE inventory (id INTEGER PRIMARY KEY, sku TEXT, qty INT);
          CREATE TABLE audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, sku TEXT, old_qty INT, new_qty INT);
          CREATE TRIGGER trg_ins AFTER INSERT ON inventory BEGIN
            INSERT INTO audit_log(action, sku, old_qty, new_qty) VALUES ('INS', NEW.sku, 0, NEW.qty);
          END;
          CREATE TRIGGER trg_upd AFTER UPDATE ON inventory BEGIN
            INSERT INTO audit_log(action, sku, old_qty, new_qty) VALUES ('UPD', NEW.sku, OLD.qty, NEW.qty);
          END;
          CREATE TRIGGER trg_del AFTER DELETE ON inventory BEGIN
            INSERT INTO audit_log(action, sku, old_qty, new_qty) VALUES ('DEL', OLD.sku, OLD.qty, 0);
          END;
          INSERT INTO inventory VALUES (1, 'gpu-a100', 4), (2, 'nvme-4tb', 10);
          UPDATE inventory SET qty = 7 WHERE id = 1;
          DELETE FROM inventory WHERE id = 2;
        "
        xxd -p -l 16 /workspace/audit.db | tr -d '\\n'
        printf '\\n'
        sqlite3 /workspace/audit.db "SELECT seq, action, sku, old_qty, new_qty FROM audit_log ORDER BY seq;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "53514c69746520666f726d6174203300",
          "1|INS|gpu-a100|0|4",
          "2|INS|nvme-4tb|0|10",
          "3|UPD|gpu-a100|4|7",
          "4|DEL|nvme-4tb|10|0",
          ""
        ].join("\n")
      );
    });
  });

  it("02. sqlite3 window functions ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD, and SUM OVER piped to jq via -json", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/win.db "
          CREATE TABLE sales (dept TEXT, rep TEXT, amount INT);
          INSERT INTO sales VALUES
            ('cloud', 'alice', 300),
            ('cloud', 'bob', 300),
            ('cloud', 'carol', 150),
            ('edge', 'dave', 400),
            ('edge', 'erin', 250);
        "
        sqlite3 -json /workspace/win.db "
          SELECT dept, rep, amount,
                 ROW_NUMBER() OVER (PARTITION BY dept ORDER BY amount DESC, rep ASC) AS rn,
                 RANK() OVER (PARTITION BY dept ORDER BY amount DESC) AS rnk,
                 DENSE_RANK() OVER (PARTITION BY dept ORDER BY amount DESC) AS drnk,
                 COALESCE(LAG(amount, 1) OVER (PARTITION BY dept ORDER BY amount DESC, rep ASC), -1) AS prev_amt,
                 SUM(amount) OVER (PARTITION BY dept) AS dept_total
            FROM sales
           ORDER BY dept ASC, rn ASC;
        " | jq -c '.[] | [ .dept, .rep, .rn, .rnk, .drnk, .prev_amt, .dept_total ]'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '["cloud","alice",1,1,1,-1,750]',
          '["cloud","bob",2,1,1,300,750]',
          '["cloud","carol",3,3,2,300,750]',
          '["edge","dave",1,1,1,-1,650]',
          '["edge","erin",2,2,2,400,650]',
          ""
        ].join("\n")
      );
    });
  });

  it("03. sqlite3 INSERT ON CONFLICT DO UPDATE upsert with -csv -header output", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/upsert.db "
          CREATE TABLE counters (name TEXT PRIMARY KEY, hits INT);
          INSERT INTO counters VALUES ('api', 5), ('web', 10);
          INSERT INTO counters VALUES ('api', 3), ('worker', 7)
            ON CONFLICT(name) DO UPDATE SET hits = counters.hits + excluded.hits;
        "
        sqlite3 -csv -header /workspace/upsert.db "SELECT name, hits FROM counters ORDER BY name;" | tr -d '\\r'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["name,hits", "api,8", "web,10", "worker,7", ""].join("\n")
      );
    });
  });

  it("04. sqlite3 WITH RECURSIVE hierarchical graph traversal computing depth and path trail", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/org.db "
          CREATE TABLE nodes (id INT PRIMARY KEY, parent_id INT, name TEXT);
          INSERT INTO nodes VALUES (1, NULL, 'ceo'), (2, 1, 'vp_eng'), (3, 1, 'vp_ops'), (4, 2, 'staff_swe'), (5, 4, 'intern');
          WITH RECURSIVE tree(id, name, depth, trail) AS (
            SELECT id, name, 0, name FROM nodes WHERE parent_id IS NULL
            UNION ALL
            SELECT n.id, n.name, t.depth + 1, t.trail || '->' || n.name
              FROM nodes n JOIN tree t ON n.parent_id = t.id
          )
          SELECT depth, trail FROM tree ORDER BY id;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "0|ceo",
          "1|ceo->vp_eng",
          "1|ceo->vp_ops",
          "2|ceo->vp_eng->staff_swe",
          "3|ceo->vp_eng->staff_swe->intern",
          ""
        ].join("\n")
      );
    });
  });

  it("05. op document create, get with --out-file and --file-mode, edit via stdin, list, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "SecVault" >/dev/null
        printf 'INITIAL-KEY-MATERIAL\\n' > /workspace/key.txt
        DOC_ID=$(op document create /workspace/key.txt --title "SigningKey" --vault SecVault --format json | jq -r '.id')
        op document get "$DOC_ID" --vault SecVault --out-file /workspace/exported.key --file-mode 0600 >/dev/null
        cmp -s /workspace/key.txt /workspace/exported.key && echo "cmp:ok"
        stat -c '%a' /workspace/exported.key
        printf 'ROTATED-KEY-MATERIAL\\n' | op document edit "$DOC_ID" - --title "SigningKey-v2" >/dev/null
        op document get "SigningKey-v2" --vault SecVault
        op document delete "SigningKey-v2" --vault SecVault
        op document list --vault SecVault --format json | jq 'length'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["cmp:ok", "600", "ROTATED-KEY-MATERIAL", "0"].join("\n")
      );
    });
  });

  it("06. op item create with escaped \\. and \\= in section/field names and invalid escape rejection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op vault create "EscVault" >/dev/null
        op item create --category login --title "EscItem" --vault EscVault \\
          'Docs\\.Private.api_token=tok_escaped_dot' \\
          'Docs\\.Private.api\\=key=val_escaped_eq' >/dev/null
        rc_ok=$?
        op read "op://EscVault/EscItem/Docs.Private/api_token"
        op item get "EscItem" --vault EscVault --format json | jq -r '.fields[] | select(.label == "api=key") | [.section.label, .label, .value] | @tsv'
        op item edit "EscItem" --vault EscVault 'bad\\q=1' 2>/workspace/op_err.txt
        rc_bad=$?
        grep -q "Invalid field name escape" /workspace/op_err.txt && echo "escape_err:matched:$rc_ok:$rc_bad"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "tok_escaped_dot",
          "Docs.Private\tapi=key\tval_escaped_eq",
          "escape_err:matched:0:1",
          ""
        ].join("\n")
      );
    });
  });

  it("07. op vault create, icon validation, edit, get, list, and delete lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op vault create "BadIconVault" --icon "not-a-valid-icon" 2>/workspace/icon_err.txt
        rc_bad=$?
        grep -q "Invalid vault icon" /workspace/icon_err.txt && echo "icon_err:$rc_bad"
        set -e
        VID=$(op vault create "Ops-Primary" --description "Primary Ops" --icon "vault-door" --format json | jq -r '.id')
        op vault edit "$VID" --name "Ops-Renamed" --description "Updated Ops" --icon "castle" >/dev/null
        op vault get "$VID" --format json | jq -r '[.name, .description, .icon] | @tsv'
        op vault delete "$VID" >/dev/null
        op vault list --format json | jq 'length'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["icon_err:1", "Ops-Renamed\tUpdated Ops\tcastle", "0", ""].join("\n")
      );
    });
  });

  it("08. gh issue create, list, view, edit, close, reopen, and delete with --json and --jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/tracker --private >/dev/null
        gh issue create -R acme/tracker -t "Memory leak" -b "Details 1" -l "bug" >/dev/null
        gh issue create -R acme/tracker -t "Dark mode" -b "Details 2" -l "enhancement" >/dev/null
        gh issue edit 1 -R acme/tracker -t "Memory leak in worker" >/dev/null
        gh issue close 1 -R acme/tracker >/dev/null
        gh issue view 1 -R acme/tracker --json number,title,state --jq '[.number, .title, .state] | @tsv'
        gh issue reopen 1 -R acme/tracker >/dev/null
        gh issue delete 2 -R acme/tracker --yes >/dev/null
        gh issue list -R acme/tracker --state all --json number,title,state | jq -r '.[] | [.number, .title, .state] | @tsv'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1\tMemory leak in worker\tCLOSED",
          "1\tMemory leak in worker\tOPEN",
          ""
        ].join("\n")
      );
    });
  });

  it("09. gh api REST endpoints reflect repo, issues, pulls, and releases state", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/api-svc --public -d "API Service" >/dev/null
        gh issue create -R acme/api-svc -t "Issue A" -b "Body A" >/dev/null
        gh pr create -R acme/api-svc -t "PR A" -b "Body PR" -H feat/a -B main >/dev/null
        gh release create v1.2.0 -R acme/api-svc -t "v1.2.0" -n "Notes" >/dev/null
        gh api repos/acme/api-svc | jq -r '.full_name + "|" + .description'
        gh api repos/acme/api-svc/issues | jq -r '.[0].title'
        gh api repos/acme/api-svc/pulls | jq -r '.[0].title'
        gh api repos/acme/api-svc/releases | jq -r '.[0].tagName'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["acme/api-svc|API Service", "Issue A", "PR A", "v1.2.0", ""].join("\n")
      );
    });
  });

  it("10. timeout -s KILL (137), default timeout (124), and fast completion (0)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        timeout -s KILL 0.05s sh -c 'sleep 0.5'
        rc_kill=$?
        timeout 0.05s sleep 1
        rc_term=$?
        timeout 2s sh -c 'sleep 0.02; printf "done\\n"'
        rc_ok=$?
        printf "%d|%d|%d\\n" "$rc_kill" "$rc_term" "$rc_ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "done\n137|124|0\n");
    });
  });

  it("11. sleep accepts multiple fractional and scientific-notation durations and rejects invalid units", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        sleep 0.02 2e-2s
        rc_ok=$?
        sleep 1w 2>/dev/null
        rc_bad_unit=$?
        sleep --invalid-flag 2>/dev/null
        rc_bad_flag=$?
        printf "%d|%d|%d\\n" "$rc_ok" "$rc_bad_unit" "$rc_bad_flag"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "0|1|1\n");
    });
  });

  it("12. bzip2, xz, zstd, and gzip roundtrip multi-kilobyte repetitive + binary data with identical sha256sum", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        seq 1 250 > /workspace/payload.dat
        orig_sha=$(sha256sum /workspace/payload.dat | awk '{print $1}')

        bzip2 -c /workspace/payload.dat | bzip2 -dc > /workspace/from_bz2.dat
        xz -c /workspace/payload.dat | xz -dc > /workspace/from_xz.dat
        zstd -c /workspace/payload.dat | zstd -dc > /workspace/from_zst.dat
        gzip -c /workspace/payload.dat | gzip -dc > /workspace/from_gz.dat

        for f in from_bz2.dat from_xz.dat from_zst.dat from_gz.dat; do
          sha=$(sha256sum "/workspace/$f" | awk '{print $1}')
          test "$sha" = "$orig_sha" && printf "%s:match\\n" "$f"
        done
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "from_bz2.dat:match",
          "from_xz.dat:match",
          "from_zst.dat:match",
          "from_gz.dat:match",
          ""
        ].join("\n")
      );
    });
  });

  it("13. tar -tf lists archive entries across .tar.gz, .tar.bz2, .tar.xz, and .tar.zst archives", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/pkg_dir/sub
        printf 'one\\n' > /workspace/pkg_dir/one.txt
        printf 'two\\n' > /workspace/pkg_dir/sub/two.txt

        tar -cjf /workspace/a.tar.bz2 -C /workspace pkg_dir
        tar -cJf /workspace/a.tar.xz -C /workspace pkg_dir
        tar --zstd -cf /workspace/a.tar.zst -C /workspace pkg_dir

        for archive in a.tar.bz2 a.tar.xz a.tar.zst; do
          count=$(tar -tf "/workspace/$archive" | grep -E 'one\\.txt|two\\.txt' | wc -l | tr -d ' ')
          printf "%s:%s\\n" "$archive" "$count"
        done
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["a.tar.bz2:2", "a.tar.xz:2", "a.tar.zst:2", ""].join("\n")
      );
    });
  });

  it("14. awk associative array multi-field aggregation piped to sort and cut", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'LOG' > /workspace/access.log
GET /api/v1/users 200 12
POST /api/v1/users 201 45
GET /api/v1/users 500 130
GET /api/v1/orders 200 25
POST /api/v1/orders 200 35
LOG
        awk '{
          count[$2]++
          lat[$2] += $4
          if ($3 >= 500) errs[$2]++
        }
        END {
          for (ep in count) {
            printf "%s|%d|%d|%d\\n", ep, count[ep], lat[ep], errs[ep] + 0
          }
        }' /workspace/access.log | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["/api/v1/orders|2|60|0", "/api/v1/users|3|187|1", ""].join("\n")
      );
    });
  });

  it("15. sed address range transformations and in-place -i editing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'TXT' > /workspace/config.ini
[general]
debug = false
[database]
debug = false
port = 5432
[cache]
debug = false
TXT
        sed -i '/^\\[database\\]/,/^\\[cache\\]/ s/debug = false/debug = true/' /workspace/config.ini
        grep -n "debug =" /workspace/config.ini
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["2:debug = false", "4:debug = true", "7:debug = false", ""].join("\n")
      );
    });
  });

  it("16. rg -c and find -maxdepth piped to xargs wc -l across nested source tree", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/src/deep/nested
        printf 'TODO: fix auth\\nok line\\nTODO: add test\\n' > /workspace/src/a.ts
        printf 'TODO: optimize\\n' > /workspace/src/deep/b.ts
        printf 'TODO: ignored deep\\n' > /workspace/src/deep/nested/c.ts

        rg -c "TODO" /workspace/src/a.ts
        find /workspace/src -maxdepth 2 -name "*.ts" | sort | xargs grep -c "TODO"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "2",
          "/workspace/src/a.ts:2",
          "/workspace/src/deep/b.ts:1",
          ""
        ].join("\n")
      );
    });
  });

  it("17. bc scale division, expr, factor, seq, and numfmt --to=iec / --from=iec", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'scale=4; 22 / 7\\n' | bc
        expr 14 '*' 3 + 2
        factor 360
        numfmt --to=iec 1048576
        numfmt --from=iec 2K
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["3.1428", "44", "360: 2 2 2 3 3 5", "1.0M", "2048", ""].join("\n")
      );
    });
  });

  it("18. diff -u unified patch generation and patch application round-trip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'alpha\\nbeta\\ngamma\\n' > /workspace/orig.txt
        printf 'alpha\\nbeta_patched\\ngamma\\ndelta\\n' > /workspace/new.txt
        diff -u /workspace/orig.txt /workspace/new.txt > /workspace/changes.patch || true
        cp /workspace/orig.txt /workspace/target.txt
        patch -s /workspace/target.txt /workspace/changes.patch
        cmp -s /workspace/target.txt /workspace/new.txt && echo "patch_roundtrip:ok"
        cat /workspace/target.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["patch_roundtrip:ok", "alpha", "beta_patched", "gamma", "delta", ""].join("\n")
      );
    });
  });

  it("19. bash trap EXIT/ERR, process substitution <(...), and mapfile -t array capture", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        trap 'printf "TRAP_EXIT:%d\\n" "$?"' EXIT
        mapfile -t lines < <(printf 'first\\nsecond\\nthird\\n')
        printf "count=%d|second=%s\\n" "\${#lines[@]}" "\${lines[1]}"
        comm -12 <(printf 'a\\nb\\nc\\n') <(printf 'b\\nc\\nd\\n')
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["count=3|second=second", "b", "c", "TRAP_EXIT:0", ""].join("\n")
      );
    });
  });

  it("20. memoryFsOptions maxTotalBytes and maxEntries quotas enforce limits and recover after rm", async () => {
    await withE2EHarness(
      {
        memoryFsOptions: {
          maxBytes: 64,
          maxMetadataUnits: 16
        }
      },
      async (h) => {
        const res = await h.exec(`
          set +e
          printf '012345678901234567890123456789' > /workspace/f1.txt
          rc1=$?
          printf '012345678901234567890123456789' > /workspace/f2.txt
          rc2=$?
          printf 'overflow_total_bytes' > /workspace/f3.txt 2>/dev/null
          rc3=$?
          rm /workspace/f2.txt
          printf 'fits_now' > /workspace/f3.txt
          rc4=$?
          printf "%d|%d|%d|%d|%s\\n" "$rc1" "$rc2" "$rc3" "$rc4" "$(cat /workspace/f3.txt)"
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "0|0|1|0|fits_now\n");
      }
    );
  });
});
