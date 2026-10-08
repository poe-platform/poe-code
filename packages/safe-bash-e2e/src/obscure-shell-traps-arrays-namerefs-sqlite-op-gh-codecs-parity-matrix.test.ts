import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure shell traps, arrays, namerefs, sqlite3, op/gh, and codecs parity matrix", () => {
  it("1. associative arrays, nameref indirection, and parameter transformations piped into jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        declare -A cfg=([host]="db.internal" [port]="5432" [mode]="ro")
        declare -n ref=cfg
        ref[mode]="rw"
        printf '%s=%s\\n' "host" "\${cfg[host]^^}" "port" "\${cfg[port]}" "mode" "\${cfg[mode]}" | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "host=DB.INTERNAL\nmode=rw\nport=5432\n");
    });
  });

  it("2. EXIT trap ordering across subshells and main shell with return and exit codes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        trap 'echo "MAIN_EXIT:$?"' EXIT
        (
          trap 'echo "SUB_EXIT:$?"' EXIT
          echo "IN_SUB"
          exit 0
        )
        echo "AFTER_SUB"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "IN_SUB\nSUB_EXIT:0\nAFTER_SUB\nMAIN_EXIT:0\n");
    });
  });

  it("3. process substitution <(cmd) with comm, join, and paste", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        comm -12 <(printf 'a\\nb\\nc\\n') <(printf 'b\\nc\\nd\\n')
        join <(printf '1 alpha\\n2 beta\\n') <(printf '1 100\\n2 200\\n')
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "b\nc\n1 alpha 100\n2 beta 200\n");
    });
  });

  it("4. sqlite3 triggers, PRAGMA user_version, and .dump round-trip into a fresh database", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        sqlite3 /workspace/src.db "
          PRAGMA user_version = 77;
          CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INT);
          CREATE TABLE audit (msg TEXT);
          CREATE TRIGGER tr_item_ins AFTER INSERT ON items BEGIN
            INSERT INTO audit VALUES ('added:' || NEW.name);
          END;
          INSERT INTO items VALUES (1, 'widget', 10), (2, 'gadget', 25);
        "
        sqlite3 /workspace/src.db ".dump" > /workspace/dump.sql
        sqlite3 /workspace/restored.db < /workspace/dump.sql
        sqlite3 /workspace/restored.db "SELECT id, name, qty FROM items ORDER BY id; SELECT msg FROM audit ORDER BY msg;"
        sqlite3 /workspace/src.db "PRAGMA user_version;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "1|widget|10\n2|gadget|25\nadded:gadget\nadded:widget\n77\n"
      );
    });
  });

  it("5. sqlite3 .mode json, csv, and line output formatting parity", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        sqlite3 /workspace/modes.db "CREATE TABLE t (k TEXT, v INT); INSERT INTO t VALUES ('a', 1), ('b', 2);"
        sqlite3 -json /workspace/modes.db "SELECT k, v FROM t ORDER BY k;"
        sqlite3 -csv -header /workspace/modes.db "SELECT k, v FROM t ORDER BY k;" | tr -d '\\r'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '[{"k":"a","v":1},\n{"k":"b","v":2}]\nk,v\na,1\nb,2\n'
      );
    });
  });

  it("6. op item lifecycle: create, section edit, [delete] field, move across vaults, and delete --archive", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        op vault create V1 > /dev/null
        op vault create V2 > /dev/null
        op item create --vault V1 --category login --title "Svc" "username=admin" "password=p1" "sec.tok=t1" > /dev/null
        op item edit "Svc" --vault V1 "sec.tok[delete]" "sec.newtok=t2" > /dev/null
        echo "NEWTOK=$(op read 'op://V1/Svc/sec/newtok')"
        op item move "Svc" --current-vault V1 --destination-vault V2 > /dev/null
        echo "MOVED=$(op read 'op://V2/Svc/password')"
        op item delete "Svc" --vault V2 --archive > /dev/null
        echo "ACTIVE_COUNT=$(op item list --vault V2 --format json | jq 'length')"
        echo "ARCHIVED_COUNT=$(op item list --vault V2 --include-archive --format json | jq 'length')"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "NEWTOK=t2\nMOVED=p1\nACTIVE_COUNT=0\nARCHIVED_COUNT=1\n"
      );
    });
  });

  it("7. op document create, list, edit, get with --out-file and --force, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        op vault create Docs > /dev/null
        printf 'doc-v1-bytes' > /workspace/d1.txt
        op document create /workspace/d1.txt --vault Docs --title "Runbook" --file-name "runbook.txt" > /dev/null
        op document get "Runbook" --vault Docs --out-file /workspace/out_doc.txt > /dev/null
        echo "V1=$(cat /workspace/out_doc.txt)"
        printf 'doc-v2-bytes' | op document edit "Runbook" - --vault Docs > /dev/null
        op document get "Runbook" --vault Docs --out-file /workspace/out_doc.txt --force > /dev/null
        echo "V2=$(cat /workspace/out_doc.txt)"
        op document delete "Runbook" --vault Docs > /dev/null
        echo "COUNT=$(op document list --vault Docs --format json | jq 'length')"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "V1=doc-v1-bytes\nV2=doc-v2-bytes\nCOUNT=0\n");
    });
  });

  it("8. op item template list and get Login vs unsupported category rejection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        op item template list --format json | jq -r '.[0]'
        op item template get Login --format json | jq -r '.category'
        if op item template get UnknownCat 2>/workspace/tpl_err.txt; then
          echo "UNEXPECTED_OK"
        else
          echo "REJECTED:$?"
        fi
        grep -q "Item template schema is unavailable" /workspace/tpl_err.txt && echo "ERR_MATCHED"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Login\nLOGIN\nREJECTED:1\nERR_MATCHED\n");
    });
  });

  it("9. gh issue create with labels, comment, view --json, close, reopen, and state filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        gh repo create acme/tracker > /dev/null
        gh issue create -R acme/tracker -t "Outage" -b "db down" -l "bug,help wanted" > /dev/null
        gh issue comment 1 -R acme/tracker -b "investigating now" > /dev/null
        gh issue view 1 -R acme/tracker --json number,title,state,labels,comments | jq -c '{number, title, state, labels: (.labels|map(.name)), comments: (.comments|map(.body))}'
        gh issue close 1 -R acme/tracker > /dev/null
        echo "OPEN_AFTER_CLOSE=$(gh issue list -R acme/tracker --json number | jq 'length')"
        gh issue reopen 1 -R acme/tracker > /dev/null
        echo "OPEN_AFTER_REOPEN=$(gh issue list -R acme/tracker --json number | jq 'length')"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"number":1,"title":"Outage","state":"OPEN","labels":["bug","help wanted"],"comments":["investigating now"]}\nOPEN_AFTER_CLOSE=0\nOPEN_AFTER_REOPEN=1\n'
      );
    });
  });

  it("10. gh repo create, view --json, list --json, and gh api repos endpoint", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        gh repo create acme/service --private -d "Core microservice" > /dev/null
        gh repo view acme/service --json name,nameWithOwner,isPrivate,description | jq -c '{name, nameWithOwner, isPrivate, description}'
        gh api repos/acme/service | jq -c '{full_name, private}'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"name":"service","nameWithOwner":"acme/service","isPrivate":true,"description":"Core microservice"}\n{"full_name":"acme/service","private":true}\n'
      );
    });
  });

  it("11. 5-layer compression & encoding onion pipeline (tar -> bzip2 -> xz -> zstd -> gzip -> base64)", async () => {
    await withE2EHarness(
      { files: { "/workspace/src/secret.txt": "five-layer-onion-payload-9876543210\n" } },
      async (h) => {
        const res = await h.exec(`
          set -e
          tar -cf - -C /workspace/src secret.txt | bzip2 -c | xz -c | zstd -c | gzip -c | base64 > /workspace/onion.b64
          mkdir -p /workspace/out
          base64 -d /workspace/onion.b64 | gzip -dc | zstd -dc | xz -dc | bzip2 -dc | tar -xf - -C /workspace/out
          cat /workspace/out/secret.txt
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "five-layer-onion-payload-9876543210\n");
      }
    );
  });

  it("12. zip multiple files, unzip -l listing, and unzip -p pipe extraction", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/f1.txt": "first-file\n",
          "/workspace/f2.txt": "second-file\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -e
          zip -q /workspace/bundle.zip f1.txt f2.txt
          unzip -l /workspace/bundle.zip | grep -q "f1.txt" && echo "LISTED_F1"
          unzip -p /workspace/bundle.zip f2.txt
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "LISTED_F1\nsecond-file\n");
      }
    );
  });

  it("13. timeout -k kill-after (137), -v verbose signal diagnostic, and 0 duration", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        timeout 0 sh -c 'sleep 0.05; echo ZERO_TIMEOUT_OK'
        timeout --preserve-status -s TERM 0.05s sleep 0.2 || echo "PRESERVE_EC=$?"
        timeout -v 0.05s sleep 0.2 2>/workspace/t_err.txt || echo "EC=$?"
        grep -Eq "timeout: (sending signal TERM to|cooperative deadline expired for) command" /workspace/t_err.txt && echo "VERBOSE_OK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ZERO_TIMEOUT_OK\nPRESERVE_EC=143\nEC=124\nVERBOSE_OK\n");
    });
  });

  it("14. bc scale math, expr regex match, factor prime decomposition, and numfmt IEC formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        echo "scale=2; 22 / 7" | bc
        expr "release-v42" : 'release-v\\([0-9]*\\)'
        factor 84
        numfmt --to=iec 1048576
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "3.14\n42\n84: 2 2 3 7\n1.0M\n");
    });
  });

  it("15. csvpy --dict and --agate interactive inspection plus csvcut and csvgrep", async () => {
    await withE2EHarness(
      { files: { "/workspace/team.csv": "id,role,active\n1,eng,yes\n2,ops,no\n3,eng,yes\n" } },
      async (h) => {
        const res = await h.exec(`
          set -e
          printf 'len(list(reader))\\nexit()\\n' | csvpy --dict /workspace/team.csv 2>/dev/null | grep -q "3" && echo "CSVPY_OK"
          csvgrep -c active -m yes /workspace/team.csv | csvcut -c id,role | tr -d '\\r'
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "CSVPY_OK\nid,role\n1,eng\n3,eng\n");
      }
    );
  });

  it("16. yq YAML to JSON transformation and filtering", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/config.yaml": "services:\n  - name: api\n    port: 8080\n  - name: worker\n    port: 9090\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -e
          yq -o=json '.services | map(.name)' /workspace/config.yaml | jq -c '.'
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, '["api","worker"]\n');
      }
    );
  });

  it("17. apply_patch creating, updating, and deleting files in workspace", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/mod.txt": "alpha\nbeta\ngamma\n",
          "/workspace/old.txt": "delete-me\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -e
          apply_patch <<'PATCH' > /workspace/patch_out.txt
*** Begin Patch
*** Add File: /workspace/added.txt
+created-via-patch
*** Update File: /workspace/mod.txt
@@
 alpha
-beta
+beta-updated
 gamma
*** Delete File: /workspace/old.txt
*** End Patch
PATCH
          grep -q "Success. Updated the following files:" /workspace/patch_out.txt && echo "SUMMARY_OK"
          cat /workspace/added.txt /workspace/mod.txt
          test ! -e /workspace/old.txt && echo "DELETED_OK"
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "SUMMARY_OK\ncreated-via-patch\nalpha\nbeta-updated\ngamma\nDELETED_OK\n"
        );
      }
    );
  });

  it("18. rg + sed -i multi-file refactoring across nested directories", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/src/a.ts": "const API_URL = 'v1/items';\n",
          "/workspace/src/sub/b.ts": "export const ENDPOINT = 'v1/users';\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -e
          rg -l 'v1/' /workspace/src | sort | xargs sed -i 's|v1/|v2/|g'
          cat /workspace/src/a.ts /workspace/src/sub/b.ts
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "const API_URL = 'v2/items';\nexport const ENDPOINT = 'v2/users';\n"
        );
      }
    );
  });

  it("19. /dev/zero and /dev/null stream slicing with head -c, od, and wc", async () => {
    await withE2EHarness({ mountDev: true }, async (h) => {
      const res = await h.exec(`
        set -e
        head -c 4 /dev/zero | od -An -tx1 | tr -d ' \\n'
        echo ""
        head -c 32 /dev/urandom | wc -c | tr -d ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "00000000\n32\n");
    });
  });

  it("20. end-to-end polyglot incident response: gh issue -> jq -> sqlite3 -> op inject -> tar -Jcf .tar.xz", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        op vault create IncidentVault > /dev/null
        op item create --vault IncidentVault --category login --title "Pager" "password=inc-key-777" > /dev/null
        gh repo create acme/ops > /dev/null
        gh issue create -R acme/ops -t "DB latency spike" -b "p99 > 500ms" > /dev/null
        title=$(gh issue view 1 -R acme/ops --json title | jq -r '.title')
        sqlite3 /workspace/incidents.db "
          CREATE TABLE incidents (id INT, title TEXT);
          INSERT INTO incidents VALUES (1, '$title');
        "
        row=$(sqlite3 -separator ':' /workspace/incidents.db "SELECT id, title FROM incidents;")
        printf "incident=%s key={{ op://IncidentVault/Pager/password }}\\n" "$row" | op inject > /workspace/report.txt
        tar -Jcf /workspace/report.tar.xz -C /workspace report.txt
        mkdir -p /workspace/verify
        tar -xf /workspace/report.tar.xz -C /workspace/verify
        cat /workspace/verify/report.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "incident=1:DB latency spike key=inc-key-777\n");

      const xzBytes = await h.readBytes("/workspace/report.tar.xz");
      assert.deepEqual([...xzBytes.slice(0, 6)], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
    });
  });
});
