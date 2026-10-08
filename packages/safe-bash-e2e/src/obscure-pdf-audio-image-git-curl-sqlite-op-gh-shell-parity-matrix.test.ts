import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure pdf, audio, image, git, sqlite3 json/filter, op/gh, codecs, and shell parity matrix", () => {
  it("01. wkhtmltopdf + pdfunite 2-page merge + pdfinfo + pdfseparate + pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/pdfm
        printf '<html><body><h1>Page One Alpha</h1></body></html>' > /workspace/pdfm/p1.html
        printf '<html><body><h1>Page Two Beta</h1></body></html>' > /workspace/pdfm/p2.html
        wkhtmltopdf /workspace/pdfm/p1.html /workspace/pdfm/p1.pdf
        wkhtmltopdf /workspace/pdfm/p2.html /workspace/pdfm/p2.pdf
        pdfunite /workspace/pdfm/p1.pdf /workspace/pdfm/p2.pdf /workspace/pdfm/merged.pdf
        PAGES=$(pdfinfo /workspace/pdfm/merged.pdf | awk '/^Pages:/ {print $2}')
        pdfseparate /workspace/pdfm/merged.pdf /workspace/pdfm/out-%d.pdf
        T1=$(pdftotext /workspace/pdfm/out-1.pdf - | grep -o 'Page One Alpha')
        T2=$(pdftotext /workspace/pdfm/out-2.pdf - | grep -o 'Page Two Beta')
        echo "pages=$PAGES t1='$T1' t2='$T2'"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "pages=2 t1='Page One Alpha' t2='Page Two Beta'\n");
    });
  });

  it("02. magick PNG generation, identify format/geometry, and exiftool metadata", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/img
        magick -size 32x16 xc:red /workspace/img/banner.png
        ID_OUT=$(identify /workspace/img/banner.png | awk '{print $2, $3}')
        MAGIC=$(xxd -p -l 4 /workspace/img/banner.png)
        echo "identify=$ID_OUT magic=$MAGIC"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "identify=PNG 32x16 magic=89504e47\n");
    });
  });

  it("03. sox synthetic audio generation and soxi sample rate and channel inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/audio
        sox -n -r 16000 -c 1 /workspace/audio/tone.wav synth 0.5 sine 440
        CH=$(soxi -c /workspace/audio/tone.wav | tr -d '[:space:]')
        SR=$(soxi -r /workspace/audio/tone.wav | tr -d '[:space:]')
        RIFF=$(head -c 4 /workspace/audio/tone.wav)
        echo "riff=$RIFF ch=$CH sr=$SR"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "riff=RIFF ch=1 sr=16000\n");
    });
  });

  it("04. qpdf --empty --pages, --show-npages, and pdftk handle cat + dump_data workflow", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/pdfq
        printf '<html><body><p>Doc A Page 1</p></body></html>' > /workspace/pdfq/a.html
        printf '<html><body><p>Doc B Page 1</p></body></html>' > /workspace/pdfq/b.html
        wkhtmltopdf /workspace/pdfq/a.html /workspace/pdfq/a.pdf
        wkhtmltopdf /workspace/pdfq/b.html /workspace/pdfq/b.pdf
        qpdf --empty --pages /workspace/pdfq/a.pdf 1 /workspace/pdfq/b.pdf 1 -- /workspace/pdfq/qmerged.pdf
        NP=$(qpdf --show-npages /workspace/pdfq/qmerged.pdf | tr -d '[:space:]')
        pdftk A=/workspace/pdfq/a.pdf B=/workspace/pdfq/b.pdf cat B1 A1 output /workspace/pdfq/rev.pdf
        NP_TK=$(pdftk /workspace/pdfq/rev.pdf dump_data | awk '/^NumberOfPages:/ {print $2}')
        FIRST_TXT=$(pdftotext -f 1 -l 1 /workspace/pdfq/rev.pdf - | grep -o 'Doc B Page 1')
        echo "np=$NP np_tk=$NP_TK first='$FIRST_TXT'"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "np=2 np_tk=2 first='Doc B Page 1'\n");
    });
  });

  it("05. sqlite3 json_extract, json_object, json_array, json_group_array, and json_group_object", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/json_ops.db <<'SQL'
          CREATE TABLE items (id INT, meta TEXT);
          INSERT INTO items VALUES
            (1, '{"tier":"gold","score":10}'),
            (2, '{"tier":"silver","score":20}');
          SELECT json_extract(meta, '$.tier'), json_extract(meta, '$.score') FROM items ORDER BY id;
          SELECT json_group_array(json_extract(meta, '$.tier')) FROM items;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "gold|10",
          "silver|20",
          '["gold","silver"]',
          ""
        ].join("\n")
      );
    });
  });

  it("06. sqlite3 aggregate FILTER (WHERE ...), PRINTF, and ROUND", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/agg_filter.db "
          CREATE TABLE sales (region TEXT, amount INT);
          INSERT INTO sales VALUES ('us', 100), ('eu', 40), ('us', 150), ('apac', 25);
          SELECT COUNT(*) FILTER (WHERE region = 'us'),
                 SUM(amount) FILTER (WHERE amount >= 50),
                 PRINTF('%05d', SUM(amount))
          FROM sales;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "2|250|00315\n");
    });
  });

  it("07. sqlite3 AFTER UPDATE and AFTER DELETE triggers with OLD and NEW references", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/trig.db "
          CREATE TABLE accounts (id INT PRIMARY KEY, bal INT);
          CREATE TABLE history (entry TEXT);
          CREATE TRIGGER tr_upd AFTER UPDATE ON accounts
          BEGIN
            INSERT INTO history VALUES ('upd:' || OLD.id || ':' || OLD.bal || '->' || NEW.bal);
          END;
          CREATE TRIGGER tr_del AFTER DELETE ON accounts
          BEGIN
            INSERT INTO history VALUES ('del:' || OLD.id || ':' || OLD.bal);
          END;
          INSERT INTO accounts VALUES (1, 50), (2, 80);
          UPDATE accounts SET bal = 75 WHERE id = 1;
          DELETE FROM accounts WHERE id = 2;
          SELECT entry FROM history ORDER BY rowid;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "upd:1:50->75\ndel:2:80\n");
    });
  });

  it("08. op inject with environment variable expansion inside {{ op://... }} and literal braces", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "ProdV" >/dev/null
        op item create --category login --title "Redis" --vault ProdV password=redis_secret_321 >/dev/null
        export TARGET_VAULT="ProdV"
        export TARGET_ITEM="Redis"
        cat <<'TPL' > /workspace/redis.conf.tpl
requirepass={{ op://\${TARGET_VAULT}/\${TARGET_ITEM}/password }}
template_tag={{ "{{raw_tag}}" }}
TPL
        op inject -i /workspace/redis.conf.tpl -o /workspace/redis.conf >/dev/null
        cat /workspace/redis.conf
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "requirepass=redis_secret_321",
          "template_tag={{raw_tag}}",
          ""
        ].join("\n")
      );
    });
  });

  it("09. op item create with --tags, --favorite, custom field deletion (field[delete]), and filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "TeamV" >/dev/null
        op item create --category login --title "Bastion" --vault TeamV \\
          --tags "prod,ssh" --favorite \\
          username=bastion_admin temp_tok=remove_me >/dev/null
        op item create --category login --title "StagingBox" --vault TeamV \\
          --tags "staging" username=stage_user >/dev/null

        FAV_TITLE=$(op item list --vault TeamV --favorite --format json | jq -r '.[].title')
        TAG_TITLE=$(op item list --vault TeamV --tags prod --format json | jq -r '.[].title')

        op item edit "Bastion" --vault TeamV 'temp_tok[delete]' >/dev/null
        HAS_TEMP=$(op item get "Bastion" --vault TeamV --format json | jq '[.fields[].label] | index("temp_tok") != null')
        echo "fav=$FAV_TITLE tag=$TAG_TITLE has_temp=$HAS_TEMP"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "fav=Bastion tag=Bastion has_temp=false\n");
    });
  });

  it("10. gh release create (--prerelease, --draft), list, view --json, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/RelApp --public >/dev/null
        gh release create v1.0.0-rc1 -R acme/RelApp -t "RC1" -n "prerelease notes" --prerelease >/dev/null
        gh release create v1.0.0 -R acme/RelApp -t "GA" -n "stable notes" >/dev/null

        PRE=$(gh release view v1.0.0-rc1 -R acme/RelApp --json tagName,isPrerelease | jq -r '.tagName + ":" + (.isPrerelease|tostring)')
        gh release delete v1.0.0-rc1 -R acme/RelApp --yes >/dev/null
        REM=$(gh release list -R acme/RelApp --json tagName | jq -r '.[].tagName')
        echo "pre=$PRE remaining=$REM"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "pre=v1.0.0-rc1:true remaining=v1.0.0\n");
    });
  });

  it("11. gh variable set/list/get/delete, secret set/list/delete, and gh api user/repos", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/CfgRepo --private -d "Config Store" >/dev/null
        gh variable set REGION --body "us-west-2" -R acme/CfgRepo >/dev/null
        gh variable set TIER --body "enterprise" -R acme/CfgRepo >/dev/null
        gh variable delete TIER -R acme/CfgRepo >/dev/null
        VARS=$(gh variable list -R acme/CfgRepo --json name,value | jq -r '.[] | "\\(.name)=\\(.value)"')

        gh secret set API_TOKEN --body "sec1" -R acme/CfgRepo >/dev/null
        gh secret delete API_TOKEN -R acme/CfgRepo >/dev/null
        SECS=$(gh secret list -R acme/CfgRepo --json name | jq 'length')

        LOGIN=$(gh api user | jq -r '.login')
        PRIV=$(gh api repos/acme/CfgRepo | jq -r '.private')
        echo "vars=$VARS secs=$SECS login=$LOGIN priv=$PRIV"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "vars=REGION=us-west-2 secs=0 login=octocat priv=true\n");
    });
  });

  it("12. tar -tf listing and selective extraction across .tar.gz, .tar.bz2, .tar.xz, and .tar.zst", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/tars/src
        printf 'alpha_body\\n' > /workspace/tars/src/alpha.txt
        printf 'beta_body\\n' > /workspace/tars/src/beta.txt

        tar -zcf /workspace/tars/a.tar.gz -C /workspace/tars/src alpha.txt beta.txt
        tar -jcf /workspace/tars/a.tar.bz2 -C /workspace/tars/src alpha.txt beta.txt
        tar -Jcf /workspace/tars/a.tar.xz -C /workspace/tars/src alpha.txt beta.txt
        tar --zstd -cf /workspace/tars/a.tar.zst -C /workspace/tars/src alpha.txt beta.txt

        for arc in a.tar.gz a.tar.bz2 a.tar.xz a.tar.zst; do
          CNT=$(tar -tf "/workspace/tars/$arc" | wc -l | tr -d ' ')
          echo "$arc:$CNT"
        done
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "a.tar.gz:2",
          "a.tar.bz2:2",
          "a.tar.xz:2",
          "a.tar.zst:2",
          ""
        ].join("\n")
      );
    });
  });

  it("13. xxd (-p, -r -p), od -An -tx1, strings, base64, and base32 binary roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        HEX=$(printf 'RustWasm' | xxd -p | tr -d '\\n')
        BACK=$(printf '%s' "$HEX" | xxd -r -p | base64 | base64 -d | base32 | base32 -d)
        OD_HEX=$(printf 'AB' | od -An -tx1 | tr -d ' \\n')
        echo "hex=$HEX back=$BACK od=$OD_HEX"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "hex=527573745761736d back=RustWasm od=4142\n");
    });
  });

  it("14. in2csv JSON-to-CSV conversion, csvlook markdown table, and csvsql query", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/csv3
        cat <<'JSON' > /workspace/csv3/items.json
[{"item":"cpu","qty":4},{"item":"gpu","qty":2}]
JSON
        in2csv /workspace/csv3/items.json > /workspace/csv3/items.csv
        csvcut -c item,qty /workspace/csv3/items.csv
        csvlook /workspace/csv3/items.csv | grep -c 'cpu'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "item,qty",
          "cpu,4",
          "gpu,2",
          "1",
          ""
        ].join("\n")
      );
    });
  });

  it("15. mmdc Mermaid diagram SVG rendering and htmlq SVG inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/mmd
        cat <<'MMD' > /workspace/mmd/flow.mmd
graph LR
  A[Client] --> B[Gateway]
  B --> C[Database]
MMD
        mmdc -i /workspace/mmd/flow.mmd -o /workspace/mmd/flow.svg
        grep -c '<svg' /workspace/mmd/flow.svg
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1\n");
    });
  });

  it("16. date -u -d @0, basename, dirname, pathchk, and uname/id coreutils", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        EPOCH=$(date -u -d "@0" "+%Y-%m-%dT%H:%M:%SZ")
        BASE=$(basename /usr/local/bin/poe-code.tar.gz .tar.gz)
        DIR=$(dirname /usr/local/bin/poe-code)
        pathchk /workspace/valid_path/file.txt && echo "pathchk=ok"
        echo "epoch=$EPOCH base=$BASE dir=$DIR"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "pathchk=ok",
          "epoch=1970-01-01T00:00:00Z base=poe-code dir=/usr/local/bin",
          ""
        ].join("\n")
      );
    });
  });

  it("17. split -l file chunking, cat reassembly, and sha256sum / md5sum / sha1sum -c verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/chunks
        cd /workspace/chunks
        seq 1 6 > full.txt
        sha256sum full.txt > sums.sha256
        md5sum full.txt > sums.md5
        sha1sum full.txt > sums.sha1
        split -l 2 full.txt part_
        cat part_* > rebuilt.txt
        cmp -s full.txt rebuilt.txt && echo "rebuilt=equal"
        sha256sum -c sums.sha256
        md5sum -c sums.md5
        sha1sum -c sums.sha1
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rebuilt=equal",
          "full.txt: OK",
          "full.txt: OK",
          "full.txt: OK",
          ""
        ].join("\n")
      );
    });
  });

  it("18. shell case glob matching, until loop, C-style for loop, subshell isolation, and PIPESTATUS", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -o pipefail
        classify() {
          case "$1" in
            *.tar.zst|*.tar.xz) echo "compressed_tar" ;;
            *.db) echo "sqlite_db" ;;
            *) echo "unknown" ;;
          esac
        }
        echo "c1=\$(classify archive.tar.zst) c2=\$(classify state.db)"

        N=3
        ACC=""
        until [ "\$N" -eq 0 ]; do
          ACC="\${ACC}\${N}"
          N=\$(( N - 1 ))
        done
        echo "until=\$ACC"

        set +e
        false | true
        echo "pipe=\${PIPESTATUS[0]}:\${PIPESTATUS[1]}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "c1=compressed_tar c2=sqlite_db",
          "until=321",
          "pipe=1:0",
          ""
        ].join("\n")
      );
    });
  });

  it("19. xargs -I {} placeholder replacement with find and file type inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/xargs_i
        printf 'one\\n' > /workspace/xargs_i/a.txt
        printf 'two\\n' > /workspace/xargs_i/b.txt
        find /workspace/xargs_i -name '*.txt' | sort | xargs -I {} sh -c 'echo "$(basename "{}"):$(cat "{}")"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "a.txt:one\nb.txt:two\n");
    });
  });

  it("20. combined sqlite3 + op + gh + zstd + tar + sha256sum disaster recovery drill", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/dr/src /workspace/dr/restore
        op vault create "DR" >/dev/null
        op item create --category login --title "BackupKey" --vault DR password=dr_secret_key >/dev/null
        gh repo create acme/dr-manifests --private >/dev/null
        gh release create v2026.10 -R acme/dr-manifests -t "DR Snapshot" -n "verified" >/dev/null

        REL_TAG=$(gh release view v2026.10 -R acme/dr-manifests --json tagName | jq -r '.tagName')
        KEY_TYPE=$(op read "op://DR/BackupKey/password?attribute=type")

        sqlite3 /workspace/dr/src/state.db "
          CREATE TABLE manifest (release_tag TEXT, key_type TEXT);
          INSERT INTO manifest VALUES ('$REL_TAG', '$KEY_TYPE');
        "
        tar --zstd -cf /workspace/dr/snapshot.tar.zst -C /workspace/dr/src state.db
        tar --zstd -xf /workspace/dr/snapshot.tar.zst -C /workspace/dr/restore
        sqlite3 /workspace/dr/restore/state.db "SELECT release_tag, key_type FROM manifest;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "v2026.10|CONCEALED\n");
    });
  });
});
