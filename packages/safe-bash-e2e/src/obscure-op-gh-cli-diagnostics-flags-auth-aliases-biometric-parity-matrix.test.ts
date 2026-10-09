import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("obscure op and gh CLI diagnostics, flag validations, auth/admin gates, alias expansion, and biometric env parity matrix", () => {
  it("01. OP_BIOMETRIC_UNLOCK_ENABLED environment validation and precedence over --version and --help", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        OP_BIOMETRIC_UNLOCK_ENABLED=invalid op --version >out1 2>err1
        rc1=$?
        OP_BIOMETRIC_UNLOCK_ENABLED=1 op --help >out2 2>err2
        rc2=$?
        OP_BIOMETRIC_UNLOCK_ENABLED=true op --version >out3 2>err3
        rc3=$?
        OP_BIOMETRIC_UNLOCK_ENABLED=false op -v >out4 2>err4
        rc4=$?
        printf "rc=%d,%d,%d,%d\\n" "$rc1" "$rc2" "$rc3" "$rc4"
        cat err1 err2 out3 out4
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,0,0",
          "op: OP_BIOMETRIC_UNLOCK_ENABLED must be true or false.",
          "op: OP_BIOMETRIC_UNLOCK_ENABLED must be true or false.",
          "0.0.1",
          "0.0.1",
          "",
        ].join("\n")
      );
    });
  });

  it("02. op --version / -v succeeds at root and fails as unknown flag on subcommands", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op --version >v1 2>e1
        rc1=$?
        op -v >v2 2>e2
        rc2=$?
        op vault list --version >v3 2>e3
        rc3=$?
        op item list -v >v4 2>e4
        rc4=$?
        printf "rc=%d,%d,%d,%d\\n" "$rc1" "$rc2" "$rc3" "$rc4"
        cat v1 v2 e3 e4
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=0,0,1,1",
          "0.0.1",
          "0.0.1",
          "op: unknown flag: --version",
          "op: unknown flag: -v",
          "",
        ].join("\n")
      );
    });
  });

  it("03. op --format and OP_FORMAT validation and missing flag value diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op vault list --format xml 2>e1
        rc1=$?
        op vault list --format=yaml 2>e2
        rc2=$?
        OP_FORMAT=csv op vault list 2>e3
        rc3=$?
        op vault list --format 2>e4
        rc4=$?
        OP_FORMAT=csv op vault list --format json >out5 2>e5
        rc5=$?
        printf "rc=%d,%d,%d,%d,%d\\n" "$rc1" "$rc2" "$rc3" "$rc4" "$rc5"
        cat e1 e2 e3 e4 out5
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,1,1,0",
          "op: format must be json or human-readable",
          "op: format must be json or human-readable",
          "op: format must be json or human-readable",
          "op: flag needs a value: --format",
          "[]",
          "",
        ].join("\n")
      );
    });
  });

  it("04. op --encoding validation vs --help bypass", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op vault list --encoding=utf-16 2>e1
        rc1=$?
        op vault list --encoding latin1 2>e2
        rc2=$?
        op read --encoding=invalid --help >/dev/null 2>e3
        rc3=$?
        op vault list --encoding=shift_jis --format json >out4 2>e4
        rc4=$?
        printf "rc=%d,%d,%d,%d\\n" "$rc1" "$rc2" "$rc3" "$rc4"
        cat e1 e2 e3 out4
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,0,0",
          "op: unsupported character-encoding",
          "op: unsupported character-encoding",
          "[]",
          "",
        ].join("\n")
      );
    });
  });

  it("05. op boolean flag and environment variable validation (--cache, OP_CACHE, --debug, OP_DEBUG, --iso-timestamps)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op vault list --cache=maybe 2>e1
        rc1=$?
        OP_CACHE=invalid op vault list 2>e2
        rc2=$?
        op vault list --debug=nope 2>e3
        rc3=$?
        OP_DEBUG=2 op vault list 2>e4
        rc4=$?
        op vault list --iso-timestamps=bad 2>e5
        rc5=$?
        printf "rc=%d,%d,%d,%d,%d\\n" "$rc1" "$rc2" "$rc3" "$rc4" "$rc5"
        cat e1 e2 e3 e4 e5
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,1,1,1",
          "op: invalid boolean value for --cache",
          "op: invalid boolean value for --cache",
          "op: invalid boolean value for --debug",
          "op: invalid boolean value for --debug",
          "op: invalid boolean value for --iso-timestamps",
          "",
        ].join("\n")
      );
    });
  });

  it("06. op --file-mode octal validation on op read and op document get", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op read op://v/i/f --file-mode 0999 2>e1
        rc1=$?
        op read op://v/i/f --file-mode=60 2>e2
        rc2=$?
        op document get doc1 --file-mode abc 2>e3
        rc3=$?
        printf "rc=%d,%d,%d\\n" "$rc1" "$rc2" "$rc3"
        cat e1 e2 e3
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,1",
          "op: invalid value for --file-mode",
          "op: invalid value for --file-mode",
          "op: invalid value for --file-mode",
          "",
        ].join("\n")
      );
    });
  });

  it("07. op domain-specific flag validations (--allow-admins-to-manage, --travel-mode, --ssh-generate-key, --deauthorize-devices-after, --generate-password, --role, --permissions)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op vault create V --allow-admins-to-manage maybe 2>e1
        rc1=$?
        op user edit u1 --travel-mode invalid 2>e2
        rc2=$?
        op item create --category "SSH Key" --title k --ssh-generate-key rsa1024 2>e3
        rc3=$?
        op user suspend u1 --deauthorize-devices-after 5x 2>e4
        rc4=$?
        op item create --category Login --title t --generate-password=0 2>e5
        rc5=$?
        op group user grant --group g1 --user u1 --role superadmin 2>e6
        rc6=$?
        op vault group grant --vault v1 --group g1 --permissions bogus_perm 2>e7
        rc7=$?
        printf "rc=%d,%d,%d,%d,%d,%d,%d\\n" "$rc1" "$rc2" "$rc3" "$rc4" "$rc5" "$rc6" "$rc7"
        cat e1 e2 e3 e4 e5 e6 e7
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,1,1,1,1,1",
          "op: invalid value for --allow-admins-to-manage",
          "op: invalid value for --travel-mode",
          "op: invalid value for --ssh-generate-key",
          "op: invalid value for --deauthorize-devices-after",
          "op: invalid value for --generate-password",
          "op: invalid value for --role",
          "op: invalid value for --permissions",
          "",
        ].join("\n")
      );
    });
  });

  it("08. op operand count and selector diagnostics across read, vault, item, document, group, user, whoami, and completion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op read 2>e1
        op read a b 2>e2
        op vault get missing_v 2>e3
        op vault get 2>e4
        op vault edit v1 2>e5
        op item get 2>e6
        op item edit 2>e7
        op document get 2>e8
        op document edit d1 a b 2>e9
        op whoami extra 2>e10
        op completion 2>e11
        op completion fish_invalid 2>e12
        cat e1 e2 e3 e4 e5 e6 e7 e8 e9 e10 e11 e12
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "op: expected at least 1 arguments but got 0 instead",
          "op: expected at most 1 arguments but got 2 instead",
          "op: Object not found",
          "op: One object selector is required",
          "op: Object not found",
          "op: An object selector or piped input is required",
          "op: item edit requires an item selector",
          "op: expected at least 1 arguments but got 0 instead",
          "op: invalid arguments for document edit",
          "op: expected at most 0 arguments but got 1 instead",
          "op: completion requires one shell: bash, zsh, fish, or powershell",
          "op: completion requires one shell: bash, zsh, fish, or powershell",
          "",
        ].join("\n")
      );
    });
  });

  it("09. op admin hook requirement on signin, update, account add, item share, service-account, events-api, user provision, and connect create", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op signin 2>e1
        op update 2>e2
        op account add 2>e3
        op item share i1 2>e4
        op service-account create sa1 2>e5
        op service-account ratelimit 2>e6
        op events-api create ev1 2>e7
        op user provision --name Alice --email a@example.com 2>e8
        op connect server create cs1 2>e9
        op connect token create ct1 --server cs1 --vault v1 2>e10
        cat e1 e2 e3 e4 e5 e6 e7 e8 e9 e10
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        Array(10).fill("op: Admin command requires an injected hook").concat([""]).join("\n")
      );
    });
  });

  it("10. op signout, op account forget/get/list, and unknown op command diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        op signout 2>e1
        rc1=$?
        op signout --all >o2 2>e2
        rc2=$?
        op account forget 2>e3
        rc3=$?
        op account forget --all >o4 2>e4
        rc4=$?
        op account forget --all myacct 2>e5
        rc5=$?
        op account get 2>e6
        rc6=$?
        op nonexistent 2>e7
        rc7=$?
        op vault bogus 2>e8
        rc8=$?
        printf "rc=%d,%d,%d,%d,%d,%d,%d,%d\\n" "$rc1" "$rc2" "$rc3" "$rc4" "$rc5" "$rc6" "$rc7" "$rc8"
        cat e1 e2 e3 e4 e5 e6 e7 e8
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,0,1,0,1,1,1,1",
          "op: Account selection is required",
          "op: Account selection is required",
          "op: Conflicting account selection",
          "op: Account selection is required",
          "op: unknown command: nonexistent",
          "op: unknown command: vault bogus",
          "",
        ].join("\n")
      );
    });
  });

  it("11. gh top-level -R / --repo / --repo= flag before subcommand", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh -R acme/widgets repo create acme/widgets --public >/dev/null
        gh --repo acme/widgets issue create --title "Top-level repo flag" --body "Works" >/dev/null
        gh --repo=acme/widgets issue list --json number,title | jq -c '.'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '[{"number":1,"title":"Top-level repo flag"}]\n');
    });
  });

  it("12. gh built-in co alias and custom gh alias set expansion with positional placeholders ($1, $2)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/alias-app --public >/dev/null
        gh alias set ic 'issue create -R acme/alias-app --title "$1" --body "$2"'
        gh ic "Bug via alias" "Detailed body"
        gh issue list -R acme/alias-app --json number,title,body | jq -S -c '.'
        gh pr create -R acme/alias-app --title "PR 1" --head feat-co --base main >/dev/null
        gh co 2 -R acme/alias-app
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "✓ Added alias for ic: issue create -R acme/alias-app --title \"$1\" --body \"$2\"",
          "https://github.com/acme/alias-app/issues/1",
          '[{"body":"Detailed body","number":1,"title":"Bug via alias"}]',
          "Switched to branch 'feat-co'",
          "",
        ].join("\n")
      );
    });
  });

  it("13. gh alias set --shell (-s) with !gh prefix stripping, alias list, and alias delete (--all)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/shell-alias --public >/dev/null
        gh alias set -s rl 'gh repo list --json nameWithOwner'
        gh rl | jq -r '[.[].nameWithOwner] | map(select(. == "acme/shell-alias")) | .[0]'
        gh alias list
        gh alias delete --all
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "✓ Added alias for rl: !gh repo list --json nameWithOwner",
          "acme/shell-alias",
          "co: pr checkout",
          "rl: !gh repo list --json nameWithOwner",
          "✓ Deleted all aliases",
          "",
        ].join("\n")
      );
    });
  });

  it("14. gh alias expansion loop detection and missing alias set arguments", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        gh alias set 2>e1
        rc1=$?
        gh alias set onlyname 2>e2
        rc2=$?
        gh alias set ping 'pong' >/dev/null
        gh alias set pong 'ping' >/dev/null
        gh ping 2>e3
        rc3=$?
        printf "rc=%d,%d,%d\\n" "$rc1" "$rc2" "$rc3"
        cat e1 e2 e3
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,1",
          "alias name and expansion required",
          "alias name and expansion required",
          "gh: alias expansion loop detected",
          "",
        ].join("\n")
      );
    });
  });

  it("15. gh config get/set unknown key diagnostics and valid config roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        gh config get invalid_key 2>e1
        rc1=$?
        gh config set invalid_key val 2>e2
        rc2=$?
        gh config set editor nvim 2>e3
        rc3=$?
        val=$(gh config get editor)
        printf "rc=%d,%d,%d val=%s\\n" "$rc1" "$rc2" "$rc3" "$val"
        cat e1 e2
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,0 val=nvim",
          'unknown config key "invalid_key"',
          'unknown config key "invalid_key"',
          "",
        ].join("\n")
      );
    });
  });

  it("16. gh label create, edit, delete, and clone diagnostics and cloning between repos", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        gh repo create acme/src-repo --public >/dev/null
        gh repo create acme/dst-repo --public >/dev/null
        gh label create -R acme/src-repo 2>e1
        rc1=$?
        gh label edit missing-lbl -R acme/src-repo -d "nope" 2>e2
        rc2=$?
        gh label delete missing-lbl -R acme/src-repo >o3 2>e3
        rc3=$?
        gh label clone -R acme/dst-repo 2>e4
        rc4=$?
        gh label create priority:p0 -R acme/src-repo -c ff0000 -d "Critical" >/dev/null
        gh label clone acme/src-repo -R acme/dst-repo >/dev/null
        cloned=$(gh label list -R acme/dst-repo --json name,color | jq -S -c 'map(select(.name == "priority:p0"))')
        printf "rc=%d,%d,%d,%d cloned=%s\\n" "$rc1" "$rc2" "$rc3" "$rc4" "$cloned"
        cat e1 e2 o3 e4
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          'rc=1,1,0,1 cloned=[{"color":"ff0000","name":"priority:p0"}]',
          "label name required",
          'label "missing-lbl" not found',
          '✓ Deleted label "missing-lbl" from acme/src-repo',
          "source repository required",
          "",
        ].join("\n")
      );
    });
  });

  it("17. gh variable set/get and gh secret set diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        gh repo create acme/vars-repo --public >/dev/null
        gh variable set -R acme/vars-repo 2>e1
        rc1=$?
        gh variable get MISSING_VAR -R acme/vars-repo 2>e2
        rc2=$?
        gh secret set -R acme/vars-repo 2>e3
        rc3=$?
        printf "rc=%d,%d,%d\\n" "$rc1" "$rc2" "$rc3"
        cat e1 e2 e3
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,1",
          "variable name required",
          "variable MISSING_VAR not found",
          "secret name required",
          "",
        ].join("\n")
      );
    });
  });

  it("18. gh project copy duplicates project fields and items into a new project", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh project create --title "Q1 Roadmap" >/dev/null
        gh project item-create 1 --title "Ship Rust parity" >/dev/null
        gh project copy 1 --title "Q2 Roadmap"
        gh project view 2 --format json | jq -c '{number, title}'
        gh project item-list 2 --format json | jq -r '.items[0].title'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/orgs/octocat/projects/2",
          '{"number":2,"title":"Q2 Roadmap"}',
          "Ship Rust parity",
          "",
        ].join("\n")
      );
    });
  });

  it("19. gh unknown root commands and unknown subcommands across command groups", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        gh repo create acme/unk-repo --public >/dev/null
        gh unknowncmd 2>e1
        gh auth bogus 2>e2
        gh repo bogus 2>e3
        gh issue bogus 2>e4
        gh pr bogus 2>e5
        gh release bogus -R acme/unk-repo 2>e6
        gh project bogus 2>e7
        gh codespace bogus >e8 2>&1
        gh label bogus -R acme/unk-repo 2>e9
        gh config bogus 2>e10
        gh alias bogus 2>e11
        cat e1 e2 e3 e4 e5 e6 e7 e8 e9 e10 e11
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          'unknown command "unknowncmd" for "gh"',
          'unknown command "bogus" for "gh auth"',
          'unknown command "bogus" for "gh repo"',
          'unknown command "bogus" for "gh issue"',
          'unknown command "bogus" for "gh pr"',
          'unknown command "bogus" for "gh release"',
          'unknown command "bogus" for "gh project"',
          "✓ Codespace bogus executed",
          'unknown command "bogus" for "gh label"',
          'unknown command "bogus" for "gh config"',
          'unknown command "bogus" for "gh alias"',
          "",
        ].join("\n")
      );
    });
  });

  it("20. end-to-end DevSecOps workflow: OP_BIOMETRIC_UNLOCK_ENABLED=false + op read/inject + gh -R alias + sqlite3", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        export OP_BIOMETRIC_UNLOCK_ENABLED=false
        op vault create SecVault >/dev/null
        op item create --vault SecVault --category Login --title "GitHubDeploy" username=bot token=ghp_supersecret999 >/dev/null
        TOK=$(op read "op://SecVault/GitHubDeploy/token")
        printf "%s" "$TOK" | gh auth login --with-token >/dev/null
        gh -R secops/service repo create secops/service --private >/dev/null
        gh alias set lv 'variable list -R "$1" --json name,value'
        gh -R secops/service variable set DEPLOY_USER --body "$(op read 'op://SecVault/GitHubDeploy/username')" >/dev/null
        VARS=$(gh lv secops/service | jq -r '.[0] | "\\(.name)=\\(.value)"')
        sqlite3 /tmp/audit.db "CREATE TABLE audit(kv TEXT); INSERT INTO audit VALUES ('$VARS'); SELECT kv FROM audit;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "✓ Added alias for lv: variable list -R \"$1\" --json name,value",
          "DEPLOY_USER=bot",
          "",
        ].join("\n")
      );
    });
  });
});
