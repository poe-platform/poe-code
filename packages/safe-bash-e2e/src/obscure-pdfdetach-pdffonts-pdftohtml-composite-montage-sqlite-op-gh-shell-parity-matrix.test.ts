import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure pdfdetach/pdffonts/pdftohtml, composite/montage/qrencode, sqlite3 pragma/pivot, op/gh, and shell parity matrix", () => {
  it("01. qpdf --add-attachment, --list-attachments, and --show-attachment roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/qatt
        printf '<html><body><p>Base Document</p></body></html>' > /workspace/qatt/base.html
        printf 'embedded-secret-payload-2026' > /workspace/qatt/note.txt
        wkhtmltopdf /workspace/qatt/base.html /workspace/qatt/base.pdf
        qpdf /workspace/qatt/base.pdf --add-attachment /workspace/qatt/note.txt --key=note.txt -- /workspace/qatt/attached.pdf
        LIST_HAS=$(qpdf --list-attachments /workspace/qatt/attached.pdf | grep -c 'note.txt')
        EXTRACTED=$(qpdf --show-attachment=note.txt /workspace/qatt/attached.pdf)
        echo "has=$LIST_HAS extracted=$EXTRACTED"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "has=1 extracted=embedded-secret-payload-2026\n");
    });
  });

  it("02. pdftk attach_files and unpack_files roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/tkatt/out
        printf '<html><body><p>PDFTK Host</p></body></html>' > /workspace/tkatt/host.html
        printf 'manifest-v1-bytes' > /workspace/tkatt/manifest.txt
        wkhtmltopdf /workspace/tkatt/host.html /workspace/tkatt/host.pdf
        pdftk /workspace/tkatt/host.pdf attach_files /workspace/tkatt/manifest.txt output /workspace/tkatt/with_att.pdf
        pdftk /workspace/tkatt/with_att.pdf unpack_files output /workspace/tkatt/out
        UNPACKED=$(cat /workspace/tkatt/out/manifest.txt)
        echo "unpacked=$UNPACKED"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "unpacked=manifest-v1-bytes\n");
    });
  });

  it("03. magick, composite, montage, and mogrify image processing pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/im
        magick -size 16x16 xc:red /workspace/im/a.png
        magick -size 16x16 xc:green /workspace/im/b.png
        composite /workspace/im/a.png /workspace/im/b.png /workspace/im/comp.png
        montage -tile 2x1 -geometry 16x16+0+0 /workspace/im/a.png /workspace/im/b.png /workspace/im/Sheet.png
        COMP_FMT=$(identify /workspace/im/comp.png | awk '{print $2, $3}')
        SHEET_FMT=$(identify /workspace/im/Sheet.png | awk '{print $2, $3}')
        echo "comp='$COMP_FMT' sheet='$SHEET_FMT'"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "comp='PNG 16x16' sheet='PNG 32x16'\n");
    });
  });

  it("04. qrencode SVG generation, svgo optimization, and rsvg-convert PNG rasterization", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/qr
        qrencode -t SVG -o /workspace/qr/code.svg "https://poe.com/safe-bash"
        svgo /workspace/qr/code.svg -o /workspace/qr/min.svg >/dev/null
        rsvg-convert -f png -o /workspace/qr/code.png /workspace/qr/min.svg
        ID=$(identify /workspace/qr/code.png | awk '{print $2}')
        echo "qr_png='$ID'"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "qr_png='PNG'\n");
    });
  });

  it("05. sqlite3 CREATE INDEX, DROP INDEX IF EXISTS, PRAGMA table_info, and sqlite_master", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/schema.db <<'SQL'
          CREATE TABLE orders (id INT PRIMARY KEY, customer TEXT NOT NULL, total INT);
          CREATE INDEX idx_orders_customer ON orders (customer);
          SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'orders';
          PRAGMA table_info(orders);
          DROP INDEX IF EXISTS idx_orders_customer;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1",
          "0|id|INT|0||1",
          "1|customer|TEXT|1||0",
          "2|total|INT|0||0",
          ""
        ].join("\n")
      );
    });
  });

  it("06. sqlite3 DELETE WHERE id IN (SELECT ...) and UPDATE WHERE EXISTS (SELECT ...)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/subq_dml.db <<'SQL'
          CREATE TABLE users (id INT PRIMARY KEY, tier TEXT);
          CREATE TABLE bans (user_id INT);
          CREATE TABLE VIP (user_id INT);
          INSERT INTO users VALUES (1, 'free'), (2, 'free'), (3, 'free');
          INSERT INTO bans VALUES (2);
          INSERT INTO VIP VALUES (3);
          DELETE FROM users WHERE id IN (SELECT user_id FROM bans);
          UPDATE users SET tier = 'vip' WHERE EXISTS (SELECT 1 FROM VIP WHERE VIP.user_id = users.id);
          SELECT id, tier FROM users ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1|free\n3|vip\n");
    });
  });

  it("07. sqlite3 SUM(CASE WHEN ...) pivot table aggregation and CASE WHEN inside ORDER BY", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/pivot.db <<'SQL'
          CREATE TABLE deployments (env TEXT, status TEXT, cnt INT);
          INSERT INTO deployments VALUES
            ('prod', 'ok', 12), ('prod', 'fail', 1),
            ('stage', 'ok', 8), ('stage', 'fail', 3),
            ('dev', 'ok', 20);
          SELECT env,
                 SUM(CASE WHEN status = 'ok' THEN cnt ELSE 0 END) AS ok_cnt,
                 SUM(CASE WHEN status = 'fail' THEN cnt ELSE 0 END) AS fail_cnt
          FROM deployments
          GROUP BY env
          ORDER BY CASE env WHEN 'prod' THEN 1 WHEN 'stage' THEN 2 ELSE 3 END;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "prod|12|1",
          "stage|8|3",
          "dev|20|0",
          ""
        ].join("\n")
      );
    });
  });

  it("08. sqlite3 -csv -header, -line, and -separator formatting modes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/modes.db "CREATE TABLE t (k TEXT, v INT); INSERT INTO t VALUES ('x', 1), ('y', 2);"
        CSV_OUT=$(sqlite3 -csv -header /workspace/modes.db "SELECT k, v FROM t ORDER BY k;" | tr -d '\\r' | tr '\\n' ';')
        SEP_OUT=$(sqlite3 -separator ':' /workspace/modes.db "SELECT k, v FROM t ORDER BY k;" | tr '\\n' ';')
        LINE_OUT=$(sqlite3 -line /workspace/modes.db "SELECT k, v FROM t WHERE k = 'x';" | tr -s ' ' | tr '\\n' ';')
        echo "csv=$CSV_OUT sep=$SEP_OUT line='$LINE_OUT'"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "csv=k,v;x,1;y,2; sep=x:1;y:2; line=' k = x; v = 1;'\n");
    });
  });

  it("09. op vault create, edit (--name, --description, --icon), get, list, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "InitialV" --description "v1 desc" --icon " locks " >/dev/null 2>&1 || op vault create "InitialV" --description "v1 desc" >/dev/null
        op vault edit "InitialV" --name "RenamedV" --description "v2 desc" >/dev/null
        INFO=$(op vault get "RenamedV" --format json | jq -c '{name,description}')
        op vault delete "RenamedV" >/dev/null
        REM=$(op vault list --format json | jq 'length')
        echo "info=$INFO rem=$REM"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, 'info={"name":"RenamedV","description":"v2 desc"} rem=0\n');
    });
  });

  it("10. op item template list/get and op item create/edit with --generate-password", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        TPLS=$(op item template list --format json | jq -r '.[0]')
        CAT=$(op item template get login --format json | jq -r '.category')
        op vault create "GenV" >/dev/null
        op item create --category login --title "AutoLogin" --vault GenV --generate-password username=bot >/dev/null
        PW1=$(op read "op://GenV/AutoLogin/password")
        op item edit "AutoLogin" --vault GenV --generate-password=24 >/dev/null
        PW2=$(op read "op://GenV/AutoLogin/password")
        [[ "$PW1" != "$PW2" ]] && ROT=1 || ROT=0
        echo "tpl=$TPLS cat=$CAT pw1_nonempty=$(( \${#PW1} >= 16 )) pw2_len=\${#PW2} rotated=$ROT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "tpl=Login cat=LOGIN pw1_nonempty=1 pw2_len=24 rotated=1\n");
    });
  });

  it("11. gh auth status, gh config set/get/list, and gh alias set/list/delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh auth status >/dev/null
        gh config set prompt disabled
        P_VAL=$(gh config get prompt)
        gh alias set iv "issue view" >/dev/null
        HAS_IV=$(gh alias list | grep -c 'iv')
        gh alias delete iv >/dev/null
        echo "prompt=$P_VAL has_iv=$HAS_IV"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "prompt=disabled has_iv=1\n");
    });
  });

  it("12. gh repo create, view --json, and list --json", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/platform-core --private --description "Core services" >/dev/null
        VIEW=$(gh repo view acme/platform-core --json name,description,isPrivate | jq -c '{name,description,isPrivate}')
        echo "view=$VIEW"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        'view={"name":"platform-core","description":"Core services","isPrivate":true}\n'
      );
    });
  });

  it("13. envsubst template expansion + tr character classes + cut + sort + uniq -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        export APP_NAME="gateway" APP_PORT="8080"
        RENDERED=$(printf 'svc=\${APP_NAME}:\${APP_PORT}' | envsubst)
        TR_OUT=$(printf 'hello   world' | tr -s ' ' '_' | tr '[:lower:]' '[:upper:]')
        TOP=$(printf 'b:2\na:1\nb:3\na:4\nb:5\n' | cut -d: -f1 | sort | uniq -c | sort -nr | head -n 1 | awk '{print $2 ":" $1}')
        echo "env='$RENDERED' tr=$TR_OUT top=$TOP"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "env='svc=gateway:8080' tr=HELLO_WORLD top=b:3\n");
    });
  });

  it("14. head -n/-c, tail -n/-n +K/-c, and wc -l/-w/-c slicing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'L1\nL2\nL3\nL4\nL5\n' > /workspace/lines.txt
        H2=$(head -n 2 /workspace/lines.txt | tr '\\n' ',')
        T2=$(tail -n 2 /workspace/lines.txt | tr '\\n' ',')
        FROM3=$(tail -n +3 /workspace/lines.txt | tr '\\n' ',')
        HC4=$(printf 'abcdefgh' | head -c 4)
        TC3=$(printf 'abcdefgh' | tail -c 3)
        LC=$(wc -l < /workspace/lines.txt | tr -d ' ')
        echo "h2=$H2 t2=$T2 from3=$FROM3 hc4=$HC4 tc3=$TC3 lc=$LC"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "h2=L1,L2, t2=L4,L5, from3=L3,L4,L5, hc4=abcd tc3=fgh lc=5\n");
    });
  });

  it("15. ln -s, readlink, realpath, cp -r, mv, chmod, stat -c, and rm -rf", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/fs_ops/src
        printf 'payload-99' > /workspace/fs_ops/src/data.txt
        chmod 750 /workspace/fs_ops/src/data.txt
        ln -s /workspace/fs_ops/src/data.txt /workspace/fs_ops/link.txt
        LINK_TARGET=$(readlink /workspace/fs_ops/link.txt)
        REAL=$(realpath /workspace/fs_ops/link.txt)
        cp -r /workspace/fs_ops/src /workspace/fs_ops/backup
        mv /workspace/fs_ops/backup/data.txt /workspace/fs_ops/backup/moved.txt
        SZ=$(stat -c '%s' /workspace/fs_ops/backup/moved.txt)
        rm -rf /workspace/fs_ops/src
        echo "target=$LINK_TARGET real=$REAL sz=$SZ"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "target=/workspace/fs_ops/src/data.txt real=/workspace/fs_ops/src/data.txt sz=10\n"
      );
    });
  });

  it("16. mktemp, mktemp -d, du, df, and tree directory hierarchy", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        TDIR=$(mktemp -d /workspace/tmp.XXXXXX)
        TFILE=$(mktemp "$TDIR/item.XXXXXX")
        printf '12345' > "$TFILE"
        HAS_DF=$(df | grep -c '/')
        TREE_OUT=$(tree "$TDIR" | grep -c 'item\\.')
        echo "dir_ok=$(test -d "$TDIR" && echo 1 || echo 0) file_ok=$(test -f "$TFILE" && echo 1 || echo 0) df=$((HAS_DF >= 1)) tree=$TREE_OUT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "dir_ok=1 file_ok=1 df=1 tree=1\n");
    });
  });

  it("17. bash arithmetic expansion $((...)) and ((...)) with bitwise, ternary, and compound assignments", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        a=5
        (( a += 3 ))
        (( a *= 2 ))
        BIT=$(( (a << 1) | 3 ))
        TERN=$(( a > 10 ? 100 : 200 ))
        (( a == 16 )) && CMP_OK=1 || CMP_OK=0
        echo "a=$a bit=$BIT tern=$TERN cmp=$CMP_OK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "a=16 bit=35 tern=100 cmp=1\n");
    });
  });

  it("18. bash [[ ... ]] conditional with =~ regex BASH_REMATCH, glob matching, and file predicates", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/cond
        printf 'non-empty' > /workspace/cond/f.txt
        ln -s /workspace/cond/f.txt /workspace/cond/l.txt
        VER="release-v24.8.1"
        if [[ "$VER" =~ ^release-v([0-9]+)\\.([0-9]+)\\.([0-9]+)$ ]]; then
          MAJ="\${BASH_REMATCH[1]}"
          MIN="\${BASH_REMATCH[2]}"
          PAT="\${BASH_REMATCH[3]}"
        fi
        [[ "$VER" == release-v* ]] && GLOB_OK=1 || GLOB_OK=0
        [[ -f /workspace/cond/f.txt && -s /workspace/cond/f.txt && -L /workspace/cond/l.txt ]] && FILE_OK=1 || FILE_OK=0
        echo "ver=$MAJ.$MIN.$PAT glob=$GLOB_OK file=$FILE_OK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ver=24.8.1 glob=1 file=1\n");
    });
  });

  it("19. bash redirections: <<< here-string, <<- tab-stripped heredoc, 2>&1, and custom fd 3", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        read -r HS <<< "herestring_value"
        TAB_DOC=$(cat <<-EOF
		line_a
		line_b
	EOF
        )
        BOTH=$(sh -c 'printf "out:"; printf "err" >&2' 2>&1)
        echo "hs=$HS tab=$(echo "$TAB_DOC" | tr '\\n' ',') both=$BOTH"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "hs=herestring_value tab=line_a,line_b, both=out:err\n");
    });
  });

  it("20. end-to-end secure PDF attachment + sqlite3 + op + gh + xz archive pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/sec_pipe
        sqlite3 /workspace/sec_pipe/ledger.db "
          CREATE TABLE tx (id INT PRIMARY KEY, code TEXT);
          INSERT INTO tx VALUES (1, 'TX-9001');
        "
        TX_CODE=$(sqlite3 /workspace/sec_pipe/ledger.db "SELECT code FROM tx WHERE id = 1;")

        op vault create "SecPipeV" >/dev/null
        op item create --category login --title "Signer" --vault SecPipeV key=sig_key_42 >/dev/null
        SIG=$(op read "op://SecPipeV/Signer/key")

        printf '%s:%s' "$TX_CODE" "$SIG" > /workspace/sec_pipe/att.txt
        printf '<html><body><p>Receipt</p></body></html>' > /workspace/sec_pipe/doc.html
        wkhtmltopdf /workspace/sec_pipe/doc.html /workspace/sec_pipe/doc.pdf
        qpdf /workspace/sec_pipe/doc.pdf --add-attachment /workspace/sec_pipe/att.txt --key=att.txt -- /workspace/sec_pipe/signed.pdf
        DETACHED=$(qpdf --show-attachment=att.txt /workspace/sec_pipe/signed.pdf)

        gh repo create acme/ledger-archive --private >/dev/null
        gh release create v1.0.0 -R acme/ledger-archive --title "Ledger v1" --notes "$DETACHED" >/dev/null
        NOTES=$(gh release view v1.0.0 -R acme/ledger-archive --json body | jq -r '.body')

        printf '%s' "$NOTES" | xz -c > /workspace/sec_pipe/notes.xz
        XZ_MAGIC=$(xxd -p -l 6 /workspace/sec_pipe/notes.xz)
        UNXZ=$(unxz -c /workspace/sec_pipe/notes.xz)
        echo "magic=$XZ_MAGIC unxz=$UNXZ"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "magic=fd377a585a00 unxz=TX-9001:sig_key_42\n");
    });
  });
});
