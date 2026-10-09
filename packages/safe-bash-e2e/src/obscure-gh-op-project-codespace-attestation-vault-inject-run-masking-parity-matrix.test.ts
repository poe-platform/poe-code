import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure gh and op project, codespace, attestation, vault permissions, inject, and run masking parity matrix", () => {
  it("1. gh auth login --with-token, setup-git, status, and token inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'gho_secops_token_999\\n' | gh auth login --with-token -h github.com -u secops-bot -p ssh -s repo,workflow >/dev/null
      gh auth setup-git -h github.com | grep -o 'Configured git credential helper'
      gh auth token -h github.com
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Configured git credential helper",
        "gho_secops_token_999",
        "",
      ].join("\n")
    );
  });

  it("2. gh repo create, edit topics/merge settings, deploy-key add/list, and autolink create/list", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/platform -d "Core Platform" --private >/dev/null
      gh repo edit acme/platform --add-topic "rust,wasm" --enable-auto-merge --delete-branch-on-merge >/dev/null
      printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKey prod@acme\\n' > deploy.pub
      gh repo deploy-key add deploy.pub -R acme/platform -t "prod-key" -w >/dev/null
      gh repo autolink create "INFRA-" "https://tickets.acme.test/INFRA-<num>" -R acme/platform >/dev/null
      gh repo view acme/platform --json name,isPrivate | jq -c -S '.'
      gh repo deploy-key list -R acme/platform --json title,readOnly | jq -c -S '.'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '{"isPrivate":true,"name":"platform"}',
        '[{"readOnly":false,"title":"prod-key"}]',
        "",
      ].join("\n")
    );
  });

  it("3. gh issue create, pin/unpin, comment, develop branch linking, and close/reopen lifecycle", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/issues --private >/dev/null
      gh issue create -R acme/issues -t "Fix memory quota" -b "Details" -a "@me" >/dev/null
      gh issue pin 1 -R acme/issues >/dev/null
      gh issue develop 1 -R acme/issues >/dev/null
      gh issue develop 1 -R acme/issues --list
      gh issue close 1 -R acme/issues >/dev/null
      gh issue view 1 -R acme/issues --json state,title | jq -c '.'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "1-fix-memory-quota\thttps://github.com/acme/issues/tree/1-fix-memory-quota",
        '{"state":"CLOSED","title":"Fix memory quota"}',
        "",
      ].join("\n")
    );
  });

  it("4. gh pr create, checks, review, squash merge, --state closed/merged filtering, and revert", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/prs --private >/dev/null
      gh pr create -R acme/prs -t "Add codec parity" -b "Body" -H feat/codecs -B main >/dev/null
      gh pr checks 1 -R acme/prs --json bucket,state | jq -r '.[0] | "\\(.bucket):\\(.state)"'
      gh pr review 1 -R acme/prs --approve -b "LGTM" >/dev/null
      gh pr merge 1 -R acme/prs --squash >/dev/null
      gh pr list -R acme/prs --state closed --json number,state | jq -c '.'
      gh pr revert 1 -R acme/prs
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "pass:SUCCESS",
        '[{"number":1,"state":"MERGED"}]',
        "https://github.com/acme/prs/pull/2",
        "",
      ].join("\n")
    );
  });

  it("5. gh release create, asset upload, download, view --json, and delete", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/rel --private >/dev/null
      printf 'WASM-BINARY-PAYLOAD' > safe-bash.wasm
      gh release create v2.0.0 -R acme/rel -t "Release 2.0.0" -n "Notes" >/dev/null
      gh release upload v2.0.0 safe-bash.wasm -R acme/rel >/dev/null
      mkdir -p dl
      gh release download v2.0.0 -R acme/rel -D dl >/dev/null
      cat dl/safe-bash.wasm
      echo ""
      gh release delete v2.0.0 -R acme/rel -y >/dev/null
      gh release list -R acme/rel --json tagName | jq 'length'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "WASM-BINARY-PAYLOAD",
        "0",
        "",
      ].join("\n")
    );
  });

  it("6. gh workflow run/disable/enable and gh run list/view --log/rerun", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/ci --private >/dev/null
      gh workflow run CI -R acme/ci >/dev/null
      gh run view -R acme/ci --log | grep -o 'Completed workflow_dispatch'
      gh run rerun -R acme/ci | grep -o 'Requested rerun'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Completed workflow_dispatch",
        "Requested rerun",
        "",
      ].join("\n")
    );
  });

  it("7. gh project create, edit, field-create/list/delete, item-create/list/delete, and close/delete", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh project create --title "Roadmap" --owner octocat >/dev/null
      gh project edit 1 --title "Core Roadmap" >/dev/null
      FID=$(gh project field-create 1 --name "Track" --data-type "TEXT")
      FCNT=$(gh project field-list 1 | wc -l | tr -d '[:space:]')
      gh project field-delete --id "$FID" >/dev/null
      gh project item-create 1 --title "Ship WASM" --body "done" >/dev/null
      ICNT=$(gh project item-list 1 | wc -l | tr -d '[:space:]')
      gh project close 1 >/dev/null
      CLOSED=$(gh project view 1 --format json | jq -r '.closed')
      echo "fcnt=$FCNT icnt=$ICNT closed=$CLOSED"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "fcnt=3 icnt=1 closed=true\n");
  });

  it("8. gh codespace (gh cs) create, list, stop, view, and delete lifecycle", async () => {
    const env = createEnv();
    const res = await env.exec(`
      CS=$(gh codespace create -R octocat/Hello-World -b main -d "rust-dev")
      S1=$(gh cs list --json displayName,state | jq -r '.[0] | "\\(.displayName):\\(.state)"')
      gh codespace stop -c "$CS" >/dev/null
      S2=$(gh cs view -c "$CS" --json state | jq -r '.state')
      gh codespace delete -c "$CS" >/dev/null
      REM=$(gh cs list --json name | jq 'length')
      echo "s1=$S1 s2=$S2 rem=$REM"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "s1=rust-dev:Available s2=Shutdown rem=0\n");
  });

  it("9. gh browse URL generation, gh attestation verify SHA-256, and gh completion/status/org", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh browse -R octocat/Hello-World -s -n
      gh browse src/lib.rs -R octocat/Hello-World -b main -n
      printf 'binary-v1\\n' > bin.tar
      gh attestation verify bin.tar -R octocat/Hello-World --format json | jq -r '.[0].verified'
      gh org list | tr '\\n' ':'
      echo ""
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "https://github.com/octocat/Hello-World/settings",
        "https://github.com/octocat/Hello-World/blob/main/src/lib.rs",
        "true",
        "poe-platform:github:",
        "",
      ].join("\n")
    );
  });

  it("10. gh secret, variable, label, gist, cache, ssh-key, gpg-key, and api --jq", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/cfg --private >/dev/null
      gh variable set DEPLOY_ENV -b "production" -R acme/cfg >/dev/null
      gh variable get DEPLOY_ENV -R acme/cfg
      gh label create "p0-critical" -c "ff0000" -d "Urgent" -R acme/cfg >/dev/null
      gh label list -R acme/cfg --json name,color | jq -r '.[] | select(.name=="p0-critical") | "\\(.name):#\\(.color)"'
      gh api /repos/acme/cfg --jq '.full_name'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "production",
        "p0-critical:#ff0000",
        "acme/cfg",
        "",
      ].join("\n")
    );
  });

  it("11. op vault and group creation with permission prerequisite validation on grant and revoke", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create "ProdVault" >/dev/null
      op group create "SRE" >/dev/null
      op vault group grant --vault "ProdVault" --group "SRE" --permissions "edit_items" >/dev/null 2>&1; rc_bad_grant=$?
      op vault group grant --vault "ProdVault" --group "SRE" --permissions "view_items,view_and_copy_passwords,edit_items" >/dev/null
      op vault group revoke --vault "ProdVault" --group "SRE" --permissions "view_items" >/dev/null 2>&1; rc_bad_rev=$?
      op vault group revoke --vault "ProdVault" --group "SRE" --permissions "edit_items,view_and_copy_passwords" >/dev/null
      PERMS=$(op vault group list "ProdVault" --format json | jq -r '.[0].permissions | join(",")')
      echo "bad_grant=$rc_bad_grant bad_rev=$rc_bad_rev perms=$PERMS"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "bad_grant=1 bad_rev=1 perms=view_items\n");
  });

  it("12. op item create with sections, escaped field names, file attachments ([file]=), edit [delete], and op read", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create "Keys" >/dev/null
      printf 'CERT-PEM-DATA' > tls.pem
      op item create --category Login --title "GatewayTLS" --vault "Keys" \
        "username=admin" "password=s3cr3t_pw" "net.port=8443" "cert[file]=tls.pem" >/dev/null
      op read "op://Keys/GatewayTLS/username"
      op read "op://Keys/GatewayTLS/net/port"
      op read "op://Keys/GatewayTLS/cert"
      echo ""
      op item edit "GatewayTLS" --vault "Keys" "net.port[delete]" >/dev/null
      op read "op://Keys/GatewayTLS/net/port" >/dev/null 2>&1; echo "deleted_rc=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "admin",
        "8443",
        "CERT-PEM-DATA",
        "deleted_rc=1",
        "",
      ].join("\n")
    );
  });

  it("13. op inject template rendering with env variable interpolation and literal brace escaping", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create "AppVault" >/dev/null
      op item create --category login --title "DBCreds" --vault "AppVault" username=pg_app password=pg_live_99 >/dev/null
      printf 'dsn="postgres://{{ op://AppVault/DBCreds/username }}:{{ op://AppVault/DBCreds/password }}@db.internal:5432"\\nescaped={{ "{{literal_braces}}" }}\\n' > config.tpl
      op inject -i config.tpl -o config.out >/dev/null
      cat config.out
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        'dsn="postgres://pg_app:pg_live_99@db.internal:5432"',
        "escaped={{literal_braces}}",
        "",
      ].join("\n")
    );
  });

  it("14. op run secret environment injection, output masking (<concealed by 1Password>), and --no-masking", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create "RunVault" >/dev/null
      op item create --category login --title "ApiTok" --vault "RunVault" password=super_secret_tok_777 >/dev/null
      API_TOKEN="op://RunVault/ApiTok/password" op run -- sh -c 'echo "tok=$API_TOKEN"'
      API_TOKEN="op://RunVault/ApiTok/password" op run --no-masking -- sh -c 'echo "len=\${#API_TOKEN}"'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "tok=<concealed by 1Password>",
        "len=20",
        "",
      ].join("\n")
    );
  });

  it("15. op document create, get, edit, list, and delete lifecycle", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create "DocsVault" >/dev/null
      printf 'recovery-codes-v1\\n' > codes.txt
      op document create codes.txt --title "RecoveryCodes" --vault "DocsVault" >/dev/null
      op document get "RecoveryCodes" --vault "DocsVault"
      printf 'recovery-codes-v2\\n' > codes2.txt
      op document edit "RecoveryCodes" codes2.txt --vault "DocsVault" >/dev/null
      op document get "RecoveryCodes" --vault "DocsVault"
      op document delete "RecoveryCodes" --vault "DocsVault" >/dev/null
      op document list --vault "DocsVault" --format json | jq 'length'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "recovery-codes-v1",
        "recovery-codes-v2",
        "0",
        "",
      ].join("\n")
    );
  });

  it("16. op service-account, connect server/token, events-api, plugin list, and completion", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op plugin list | awk '$1=="gh"{print $1 ":" $2}'
      op completion bash | grep -o 'complete -o filenames -F _op op'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "gh:GitHub",
        "complete -o filenames -F _op op",
        "",
      ].join("\n")
    );
  });

  it("17. gh gist create/list/view/edit/delete and gh cache list/delete lifecycle", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'console.log("snippet");\\n' > snippet.js
      gh gist create snippet.js -d "Helper snippet" >/dev/null
      gh gist list | awk 'NR==1{print $2}'
      gh gist view 1
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Helper",
        'console.log("snippet");',
        "",
      ].join("\n")
    );
  });

  it("18. openssl enc AES-256-CBC with secret from op read and sha256 verification", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create "CryptoVault" >/dev/null
      op item create --category Password --title "EncKey" --vault "CryptoVault" "password=aes_master_key_2026" >/dev/null
      KEY=$(op read "op://CryptoVault/EncKey/password")
      printf 'confidential-audit-log\\n' > plain.txt
      openssl enc -aes-256-cbc -pbkdf2 -pass "pass:$KEY" -in plain.txt -out cipher.bin
      openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$KEY" -in cipher.bin
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "confidential-audit-log\n");
  });

  it("19. sqlite3 audit warehouse storing gh PRs and op vault inventory with window ranking", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/audit --private >/dev/null
      gh pr create -R acme/audit -t "PR Alpha" -b "a" -H b1 -B main >/dev/null
      gh pr create -R acme/audit -t "PR Beta" -b "b" -H b2 -B main >/dev/null
      gh pr merge 1 -R acme/audit --squash >/dev/null
      sqlite3 audit.db "CREATE TABLE prs (num INT PRIMARY KEY, title TEXT, state TEXT);"
      gh pr list -R acme/audit --state all --json number,title,state | \
        jq -r '.[] | "INSERT INTO prs VALUES (\\(.number), \\"\\(.title)\\", \\"\\(.state)\\");"' | \
        sqlite3 audit.db
      sqlite3 audit.db "SELECT num, title, state FROM prs ORDER BY num;"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "1|PR Alpha|MERGED",
        "2|PR Beta|OPEN",
        "",
      ].join("\n")
    );
  });

  it("20. end-to-end SecOps release bundle: op inject -> gh release upload -> gh attestation verify -> tar.zst", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create "RelVault" >/dev/null
      op item create --category login --title "SignId" --vault "RelVault" password=rel-2026-sig >/dev/null
      printf 'build_sig={{ op://RelVault/SignId/password }}\\n' > manifest.tpl
      op inject -i manifest.tpl -o manifest.txt >/dev/null
      tar -cf bundle.tar manifest.txt && zstd -c bundle.tar > bundle.tar.zst
      gh attestation verify bundle.tar.zst -R octocat/Hello-World --format json | jq -r '.[0].verified'
      mkdir -p ext && zstd -dc bundle.tar.zst > bundle2.tar && tar -xf bundle2.tar -C ext && cat ext/manifest.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "true",
        "build_sig=rel-2026-sig",
        "",
      ].join("\n")
    );
  });
});
