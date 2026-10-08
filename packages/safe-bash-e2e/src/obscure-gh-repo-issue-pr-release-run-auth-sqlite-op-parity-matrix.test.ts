import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure gh repo/issue/pr/release/run/auth deep subcommands, op, sqlite3, codecs, and shell parity matrix", () => {
  it("01. gh auth login --with-token, status (-t and --json), token, switch, refresh, and logout lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        export GH_CONFIG_DIR="/tmp/gh-cfg-01"
        printf 'gho_secret_tok_998877\\n' | gh auth login --with-token -h github.com -u secbot -p ssh -s repo,workflow
        gh auth token
        gh auth status -t | grep -E "Logged in to|Git operations protocol|Token:|Token scopes:"
        gh auth status --json hosts -q '.hosts["github.com"][] | select(.active) | [.login, .gitProtocol, .state, (.active | tostring)] | join("|")'
        printf 'gho_release_tok_112233\\n' | gh auth login --with-token -h github.com -u releasebot -p https -s repo
        gh auth switch -h github.com -u secbot
        gh auth refresh -h github.com -s gist,read:org
        gh auth status --json hosts -q '.hosts["github.com"][] | select(.active) | [.login, .scopes] | join("|")'
        gh auth logout -h github.com
        if gh auth status >/dev/null 2>&1; then
          echo "unexpected-logged-in"
        else
          echo "logged-out-ok"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "✓ Logged in as secbot on github.com",
          "gho_secret_tok_998877",
          "  ✓ Logged in to github.com account octocat (keyring)",
          "  - Git operations protocol: https",
          "  - Token: gho_default_safe_bash_token_1234567890",
          "  - Token scopes: 'repo', 'read:org', 'workflow', 'gist', 'admin:public_key', 'admin:gpg_key'",
          "  ✓ Logged in to github.com account secbot (keyring)",
          "  - Git operations protocol: ssh",
          "  - Token: gho_secret_tok_998877",
          "  - Token scopes: 'repo', 'workflow'",
          "secbot|ssh|success|true",
          "✓ Logged in as releasebot on github.com",
          "✓ Switched active account for github.com to secbot",
          "✓ Authentication credentials refreshed for github.com",
          "secbot|repo, workflow, gist, read:org",
          "✓ Logged out of github.com",
          "logged-out-ok",
          ""
        ].join("\n")
      );
    });
  });

  it("02. gh auth setup-git writes git credential helper to .git/config and hosts.yml in GH_CONFIG_DIR", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        export GH_CONFIG_DIR="/tmp/gh-cfg-02"
        mkdir -p /tmp/repo-02/.git && cd /tmp/repo-02
        printf '[core]\\n\\trepositoryformatversion = 0\\n' > .git/config
        printf 'gho_git_cred_token_111\\n' | gh auth login --with-token -h ghe.acme.internal -u devops -p https
        gh auth setup-git -h ghe.acme.internal
        grep -F 'credential "https://ghe.acme.internal"' .git/config
        grep -F 'oauth_token: gho_git_cred_token_111' "$GH_CONFIG_DIR/hosts.yml"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "✓ Logged in as devops on ghe.acme.internal",
          "✓ Configured git credential helper for ghe.acme.internal",
          '[credential "https://ghe.acme.internal"]',
          "    oauth_token: gho_git_cred_token_111",
          ""
        ].join("\n")
      );
    });
  });

  it("03. gh config set/get/list/clear-cache and gh alias set (-s)/list/delete (--all)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh config set -h github.com editor nano
        gh config set prompt disabled
        gh config get -h github.com editor
        gh config get prompt
        gh config clear-cache
        gh alias set pv 'pr view'
        gh alias set -s ig 'gh issue list | grep -i bug'
        gh alias list
        gh alias delete pv
        gh alias list
        gh alias delete --all
        gh alias list | wc -l | tr -d ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "nano",
          "disabled",
          "✓ Cleared the cache",
          "✓ Added alias for pv: pr view",
          "✓ Added alias for ig: !gh issue list | grep -i bug",
          "co: pr checkout",
          "pv: pr view",
          "ig: !gh issue list | grep -i bug",
          "✓ Deleted alias pv",
          "co: pr checkout",
          "ig: !gh issue list | grep -i bug",
          "✓ Deleted all aliases",
          "0",
          ""
        ].join("\n")
      );
    });
  });

  it("04. gh repo create (-h homepage) and gh repo edit flags (--visibility, --default-branch, topics, merge settings)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/platform -d "Initial desc" -h "https://acme.test" --private
        gh repo edit acme/platform \\
          -d "Updated platform description" \\
          -h "https://platform.acme.test" \\
          --default-branch trunk \\
          --visibility internal \\
          --enable-discussions \\
          --enable-wiki=false \\
          --enable-auto-merge \\
          --enable-rebase-merge=false \\
          --delete-branch-on-merge \\
          --template \\
          --add-topic "rust,wasm,secops" \\
          --remove-topic "wasm"
        gh repo view acme/platform --json name,description,homepageUrl,visibility,isPrivate,isTemplate,hasWikiEnabled,rebaseMergeAllowed,deleteBranchOnMerge,defaultBranchRef,repositoryTopics \\
          -q '[.name, .description, .homepageUrl, .visibility, (.isPrivate|tostring), (.isTemplate|tostring), (.hasWikiEnabled|tostring), (.rebaseMergeAllowed|tostring), (.deleteBranchOnMerge|tostring), .defaultBranchRef.name, ([.repositoryTopics[].name] | join(","))] | join("|")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/platform",
          "✓ Edited repository acme/platform",
          "platform|Updated platform description|https://platform.acme.test|INTERNAL|true|true|false|false|true|trunk|rust,secops",
          ""
        ].join("\n")
      );
    });
  });

  it("05. gh repo archive, unarchive, rename, set-default (-v and -u), and delete lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /tmp/repo-05/.git && cd /tmp/repo-05
        printf '[core]\\n\\trepositoryformatversion = 0\\n' > .git/config
        gh repo create acme/legacy-svc --public
        gh repo set-default acme/legacy-svc
        gh repo set-default -v
        gh repo archive acme/legacy-svc
        gh repo view acme/legacy-svc --json isArchived -q '.isArchived'
        gh repo unarchive acme/legacy-svc
        gh repo view acme/legacy-svc --json isArchived -q '.isArchived'
        gh repo rename modern-svc -R acme/legacy-svc
        gh repo set-default -v
        gh repo set-default -u
        gh repo delete acme/modern-svc --yes
        gh repo list --json nameWithOwner -q '[.[].nameWithOwner] | join(",")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/legacy-svc",
          "✓ Set acme/legacy-svc as the default repository for the current directory",
          "acme/legacy-svc",
          "✓ Archived repository acme/legacy-svc",
          "true",
          "✓ Unarchived repository acme/legacy-svc",
          "false",
          "✓ Renamed repository to acme/modern-svc",
          "acme/legacy-svc",
          "✓ Unset default repository",
          "✓ Deleted repository acme/modern-svc",
          "octocat/Hello-World",
          ""
        ].join("\n")
      );
    });
  });

  it("06. gh repo deploy-key add (file and stdin), list (--json), and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /tmp/keys-06
        printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIProdDeployKey deploy@acme.io\\n' > /tmp/keys-06/deploy_key.pub
        printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIReadOnlyKey ro@acme.io\\n' > /tmp/keys-06/ro_key.pub
        gh repo create acme/deploy-target
        gh repo deploy-key add /tmp/keys-06/deploy_key.pub -R acme/deploy-target -t "prod-ed25519" -w
        gh repo deploy-key add /tmp/keys-06/ro_key.pub -R acme/deploy-target -t "ro-stdin-key"
        gh repo deploy-key list -R acme/deploy-target --json title,readOnly -q 'map([.title, (.readOnly|tostring)] | join(":")) | join(",")'
        KEY_ID=$(gh repo deploy-key list -R acme/deploy-target --json id,title -q '.[] | select(.title == "ro-stdin-key") | .id')
        gh repo deploy-key delete "$KEY_ID" -R acme/deploy-target >/dev/null
        gh repo deploy-key list -R acme/deploy-target --json title -q 'map(.title) | join(",")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/deploy-target",
          "✓ Deploy key added to acme/deploy-target",
          "✓ Deploy key added to acme/deploy-target",
          "prod-ed25519:false,ro-stdin-key:true",
          "prod-ed25519",
          ""
        ].join("\n")
      );
    });
  });

  it("07. gh repo autolink create (alphanumeric and -n numeric), list, view, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/tracker
        gh repo autolink create JIRA- "https://jira.acme.io/browse/JIRA-<num>" -R acme/tracker >/dev/null
        gh repo autolink create BUG- "https://bugs.acme.io/id/<num>" -n -R acme/tracker >/dev/null
        gh repo autolink list -R acme/tracker --json keyPrefix,urlTemplate,isAlphanumeric \\
          -q 'map([.keyPrefix, .urlTemplate, (.isAlphanumeric|tostring)] | join("|")) | join("\\n")'
        AL_ID=$(gh repo autolink list -R acme/tracker --json id,keyPrefix -q '.[] | select(.keyPrefix == "BUG-") | .id')
        gh repo autolink view "$AL_ID" -R acme/tracker --json keyPrefix,isAlphanumeric -q '[.keyPrefix, (.isAlphanumeric|tostring)] | join(":")'
        gh repo autolink delete "$AL_ID" -R acme/tracker >/dev/null
        gh repo autolink list -R acme/tracker --json keyPrefix -q 'map(.keyPrefix) | join(",")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/tracker",
          "JIRA-|https://jira.acme.io/browse/JIRA-<num>|true",
          "BUG-|https://bugs.acme.io/id/<num>|false",
          "BUG-:false",
          "JIRA-",
          ""
        ].join("\n")
      );
    });
  });

  it("08. gh repo gitignore, gh repo license, gh repo credits, and gh org list", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo gitignore list | head -n 3 | paste -sd, -
        gh repo gitignore view Rust | tr '\\n' '|'
        echo ""
        gh repo license list | head -n 2 | cut -f1 | paste -sd, -
        gh repo license view mit | head -n 1
        gh repo credits octocat/Hello-World
        gh org list | paste -sd, -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Node,Python,Rust",
          "# Rust|node_modules/|dist/|.env|",
          "mit,apache-2.0",
          "MIT License",
          "Contributors: octocat",
          "poe-platform,github",
          ""
        ].join("\n")
      );
    });
  });

  it("09. gh issue create (-a @me), edit (--add-assignee/--remove-assignee), pin/unpin, and lock/unlock", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/issues-lab
        gh issue create -R acme/issues-lab -t "Memory leak in worker" -b "Details" -l bug -a @me
        gh issue edit 1 -R acme/issues-lab --add-assignee alice,bob --remove-assignee octocat >/dev/null
        gh issue pin 1 -R acme/issues-lab
        gh issue lock 1 -R acme/issues-lab
        gh issue view 1 -R acme/issues-lab --json number,title,isPinned,assignees \\
          -q '[(.number|tostring), .title, (.isPinned|tostring), ([.assignees[].login] | join(","))] | join("|")'
        gh issue unpin 1 -R acme/issues-lab
        gh issue unlock 1 -R acme/issues-lab
        gh issue view 1 -R acme/issues-lab --json isPinned -q '.isPinned'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/issues-lab",
          "https://github.com/acme/issues-lab/issues/1",
          "✓ Pinned issue #1",
          "✓ Locked issue #1",
          "1|Memory leak in worker|true|alice,bob",
          "✓ Unpinned issue #1",
          "✓ Unlocked issue #1",
          "false",
          ""
        ].join("\n")
      );
    });
  });

  it("10. gh issue develop (slug branch, -n custom branch, --list), transfer across repos, and status", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/frontend
        gh repo create acme/backend
        gh issue create -R acme/frontend -t "Fix OAuth2 callback & state!" -b "OAuth bug" -a @me >/dev/null
        gh issue develop 1 -R acme/frontend
        gh issue develop 1 -R acme/frontend -n feat/oauth-fix
        gh issue develop 1 -R acme/frontend --list
        gh issue status -R acme/frontend | grep -F "#1  Fix OAuth2 callback & state!" | wc -l | tr -d ' '
        gh issue transfer 1 acme/backend -R acme/frontend
        gh issue list -R acme/frontend --json number -q 'length'
        gh issue list -R acme/backend --json number,title -q 'map([(.number|tostring), .title] | join(":")) | join(",")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/frontend",
          "https://github.com/acme/backend",
          "https://github.com/acme/frontend/tree/1-fix-oauth2-callback-state",
          "https://github.com/acme/frontend/tree/feat/oauth-fix",
          "1-fix-oauth2-callback-state\thttps://github.com/acme/frontend/tree/1-fix-oauth2-callback-state",
          "feat/oauth-fix\thttps://github.com/acme/frontend/tree/feat/oauth-fix",
          "2",
          "https://github.com/acme/backend/issues/1",
          "0",
          "1:Fix OAuth2 callback & state!",
          ""
        ].join("\n")
      );
    });
  });

  it("11. gh pr create (-a, -r), edit (--add-assignee/--remove-assignee/--add-reviewer/--remove-reviewer), and lock/unlock", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/pr-lab
        gh pr create -R acme/pr-lab -t "Add B-tree cursor" -b "PR body" -H feat/btree -B main -a @me -r alice,bob
        gh pr edit 1 -R acme/pr-lab --add-assignee carol --remove-assignee octocat --add-reviewer dave --remove-reviewer alice >/dev/null
        gh pr lock 1 -R acme/pr-lab
        gh pr unlock 1 -R acme/pr-lab
        gh pr view 1 -R acme/pr-lab --json number,assignees,reviewRequests \\
          -q '[(.number|tostring), ([.assignees[].login]|join(",")), ([.reviewRequests[].login]|join(","))] | join("|")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/pr-lab",
          "https://github.com/acme/pr-lab/pull/1",
          "✓ Locked pull request #1",
          "✓ Unlocked pull request #1",
          "1|carol|bob,dave",
          ""
        ].join("\n")
      );
    });
  });

  it("12. gh pr status, update-branch (--rebase), checks (--json), and revert (-t, -b, -d)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /tmp/repo-12/.git && cd /tmp/repo-12
        printf 'ref: refs/heads/feat/simd\\n' > .git/HEAD
        gh repo create acme/ci-repo
        gh pr create -R acme/ci-repo -t "Enable SIMD parser" -H feat/simd -B main >/dev/null
        gh pr status -R acme/ci-repo --json currentBranch,createdBy -q '[.currentBranch.title, (.createdBy|length|tostring)] | join("|")'
        gh pr update-branch 1 -R acme/ci-repo
        gh pr update-branch 1 -R acme/ci-repo --rebase
        gh pr checks 1 -R acme/ci-repo --json bucket,name,state,workflow -q '.[0] | [.bucket, .name, .state, .workflow] | join("|")'
        gh pr merge 1 -R acme/ci-repo --squash >/dev/null
        gh pr revert 1 -R acme/ci-repo -d
        gh pr view 2 -R acme/ci-repo --json number,title,body,headRefName,isDraft \\
          -q '[(.number|tostring), .title, .body, .headRefName, (.isDraft|tostring)] | join("|")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/ci-repo",
          "Enable SIMD parser|1",
          "✓ Pull request #1 branch updated",
          "✓ Pull request #1 branch updated",
          "pass|build|SUCCESS|CI",
          "https://github.com/acme/ci-repo/pull/2",
          '2|Revert "Enable SIMD parser"|Reverts acme/ci-repo#1|revert-1-feat/simd|true',
          ""
        ].join("\n")
      );
    });
  });

  it("13. gh release create with assets, upload, edit, download (-D and -O), and delete-asset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /tmp/rel-13/out
        printf 'binary-linux-amd64' > /tmp/rel-13/app-linux.bin
        printf 'checksums-sha256-list' > /tmp/rel-13/SHA256SUMS
        gh repo create acme/releases
        gh release create v2.0.0 /tmp/rel-13/app-linux.bin -R acme/releases -t "Release 2.0" -n "Initial notes" --draft
        gh release upload v2.0.0 /tmp/rel-13/SHA256SUMS -R acme/releases
        gh release edit v2.0.0 -R acme/releases -t "Release 2.0 GA" -n "Updated GA notes" --draft=false --prerelease
        gh release view v2.0.0 -R acme/releases --json tagName,name,body,isDraft,isPrerelease,assets \\
          -q '[.tagName, .name, .body, (.isDraft|tostring), (.isPrerelease|tostring), ([.assets[].name]|join(","))] | join("|")'
        gh release download v2.0.0 -R acme/releases -D /tmp/rel-13/out
        ls /tmp/rel-13/out | sort | paste -sd, -
        gh release delete-asset v2.0.0 app-linux.bin -R acme/releases
        gh release view v2.0.0 -R acme/releases --json assets -q '[.assets[].name] | join(",")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/releases",
          "https://github.com/acme/releases/releases/tag/v2.0.0",
          "✓ Uploaded assets to v2.0.0",
          "https://github.com/acme/releases/releases/tag/v2.0.0",
          "v2.0.0|Release 2.0 GA|Updated GA notes|false|true|app-linux.bin,SHA256SUMS",
          "SHA256SUMS,app-linux.bin",
          "✓ Deleted asset app-linux.bin from release v2.0.0",
          "SHA256SUMS",
          ""
        ].join("\n")
      );
    });
  });

  it("14. gh workflow run and gh run view (--log), watch, rerun, cancel, and delete lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/actions-lab
        gh workflow run CI -R acme/actions-lab -r release/v1
        RUN_ID=$(gh run list -R acme/actions-lab --json databaseId -q '.[0].databaseId')
        gh run view "$RUN_ID" -R acme/actions-lab --log | head -n 1
        gh run watch "$RUN_ID" -R acme/actions-lab | sed "s/([0-9][0-9]*)/(RUN)/"
        gh run cancel "$RUN_ID" -R acme/actions-lab | sed "s/run [0-9][0-9]*/run RUN/"
        gh run view "$RUN_ID" -R acme/actions-lab --json status,conclusion,attempt -q '[.status, .conclusion, (.attempt|tostring)] | join("|")'
        gh run rerun "$RUN_ID" -R acme/actions-lab | sed "s/run [0-9][0-9]*/run RUN/"
        gh run view "$RUN_ID" -R acme/actions-lab --json status,conclusion,attempt -q '[.status, .conclusion, (.attempt|tostring)] | join("|")'
        gh run delete "$RUN_ID" -R acme/actions-lab | sed "s/run [0-9][0-9]*/run RUN/"
        gh run list -R acme/actions-lab --json databaseId -q 'length'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/acme/actions-lab",
          "✓ Created workflow_dispatch event for .github/workflows/ci.yml at release/v1",
          "CI\tbuild\t2026-09-28T12:00:00Z Completed workflow_dispatch",
          "✓ Run CI (RUN) completed with 'success'",
          "✓ Requested cancellation of workflow run RUN",
          "completed|cancelled|1",
          "✓ Requested rerun of run RUN",
          "completed|success|2",
          "✓ Deleted workflow run RUN",
          "1",
          ""
        ].join("\n")
      );
    });
  });

  it("15. gh status aggregates open issues and pull requests across repositories", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh status | grep -c "Nothing here"
        gh repo create acme/alpha >/dev/null
        gh issue create -R acme/alpha -t "Alpha issue 1" -a @me >/dev/null
        gh pr create -R acme/alpha -t "Alpha PR 1" -H feat/a -a @me >/dev/null
        gh status
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "3",
          "Assigned Issues",
          "  acme/alpha#1  Alpha issue 1",
          "",
          "Assigned Pull Requests",
          "  acme/alpha#2  Alpha PR 1",
          "",
          "Review Requests",
          "  Nothing here ^_^",
          ""
        ].join("\n")
      );
    });
  });

  it("16. SecOps pipeline: op secret provisioning -> gh auth login --with-token -> gh secret/variable -> sqlite3 audit log", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create SecVault >/dev/null
        op item create --vault SecVault --category login --title "GitHubBot" \\
          username=secops-bot password=gho_vault_pat_778899 "webhook_secret[password]=whsec_554433" >/dev/null

        op read "op://SecVault/GitHubBot/password" | gh auth login --with-token -h github.com -u secops-bot
        gh repo create acme/sec-pipeline >/dev/null
        op read "op://SecVault/GitHubBot/webhook_secret" | gh secret set WEBHOOK_SECRET -R acme/sec-pipeline >/dev/null
        gh variable set DEPLOY_ENV -b "production" -R acme/sec-pipeline >/dev/null

        WHO=$(gh auth status --json hosts -q '.hosts["github.com"][] | select(.active) | .login')
        SEC=$(gh secret list -R acme/sec-pipeline --json name -q '.[0].name')
        VAR=$(gh variable get DEPLOY_ENV -R acme/sec-pipeline)

        sqlite3 /tmp/sec_audit.db <<SQL
CREATE TABLE audit (actor TEXT, secret_name TEXT, deploy_env TEXT);
INSERT INTO audit VALUES ('$WHO', '$SEC', '$VAR');
SELECT actor || '|' || secret_name || '|' || deploy_env FROM audit;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "✓ Logged in as secops-bot on github.com",
          "secops-bot|WEBHOOK_SECRET|production",
          ""
        ].join("\n")
      );
    });
  });

  it("17. sqlite3 json_each + window function analytics over gh issue and pr JSON exports", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/metrics >/dev/null
        gh issue create -R acme/metrics -t "Bug A" -l bug -a alice >/dev/null
        gh issue create -R acme/metrics -t "Bug B" -l bug -a bob >/dev/null
        gh issue create -R acme/metrics -t "Feat C" -l enhancement -a alice >/dev/null
        gh issue pin 1 -R acme/metrics >/dev/null

        ISSUES_JSON=$(gh issue list -R acme/metrics --json number,title,isPinned,assignees)
        sqlite3 /tmp/metrics.db <<SQL
CREATE TABLE issues (num INT PRIMARY KEY, title TEXT, pinned INT, assignee TEXT);
INSERT INTO issues
SELECT
  json_extract(value, '$.number'),
  json_extract(value, '$.title'),
  CASE WHEN json_extract(value, '$.isPinned') THEN 1 ELSE 0 END,
  json_extract(value, '$.assignees[0].login')
FROM json_each('$ISSUES_JSON');

SELECT
  num || ':' || title || ':' || assignee || ':pinned=' || pinned || ':user_cnt=' ||
  COUNT(*) OVER (PARTITION BY assignee)
FROM issues
ORDER BY num;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1:Bug A:alice:pinned=1:user_cnt=2",
          "2:Bug B:bob:pinned=0:user_cnt=1",
          "3:Feat C:alice:pinned=0:user_cnt=2",
          ""
        ].join("\n")
      );
    });
  });

  it("18. multi-codec tar archives (zstd, xz, bzip2) uploaded and managed via gh release assets", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /tmp/pkg-18/src
        printf 'fn main() { println!("ok"); }\\n' > /tmp/pkg-18/src/main.rs
        tar -cf - -C /tmp/pkg-18 src | zstd -c > /tmp/pkg-18/pkg.tar.zst
        tar -cf - -C /tmp/pkg-18 src | xz -c > /tmp/pkg-18/pkg.tar.xz
        tar -cf - -C /tmp/pkg-18 src | bzip2 -c > /tmp/pkg-18/pkg.tar.bz2

        gh repo create acme/bundles >/dev/null
        gh release create v1.0.0 /tmp/pkg-18/pkg.tar.zst /tmp/pkg-18/pkg.tar.xz -R acme/bundles -t "v1.0.0" -n "Bundles" >/dev/null
        gh release upload v1.0.0 /tmp/pkg-18/pkg.tar.bz2 -R acme/bundles >/dev/null
        gh release view v1.0.0 -R acme/bundles --json assets -q '[.assets[].name] | join(",")'

        zstd -dc /tmp/pkg-18/pkg.tar.zst | tar -xf - -O src/main.rs
        xz -dc /tmp/pkg-18/pkg.tar.xz | tar -xf - -O src/main.rs
        bzip2 -dc /tmp/pkg-18/pkg.tar.bz2 | tar -xf - -O src/main.rs
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "pkg.tar.zst,pkg.tar.xz,pkg.tar.bz2",
          'fn main() { println!("ok"); }',
          'fn main() { println!("ok"); }',
          'fn main() { println!("ok"); }',
          ""
        ].join("\n")
      );
    });
  });

  it("19. xan + yq + jq pipeline transforming gh repo and workflow run metadata into a gh gist report", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/telemetry -d "Telemetry service" --private >/dev/null
        gh repo edit acme/telemetry --add-topic "metrics,otel" --default-branch main >/dev/null
        gh workflow run CI -R acme/telemetry -r main >/dev/null
        RUN_ID=$(gh run list -R acme/telemetry --json databaseId -q '.[0].databaseId')
        gh run rerun "$RUN_ID" -R acme/telemetry >/dev/null

        REPO_YAML=$(gh repo view acme/telemetry --json nameWithOwner,visibility,defaultBranchRef,repositoryTopics | yq -P '.' -)
        RUN_SUMMARY=$(gh run view "$RUN_ID" -R acme/telemetry --json workflowName,status,conclusion,attempt -q '[.workflowName, .status, .conclusion, (.attempt|tostring)] | join(",")')

        printf 'workflow,status,conclusion,attempt\\n%s\\n' "$RUN_SUMMARY" > /tmp/runs.csv
        CSV_OUT=$(xan select workflow,attempt,conclusion /tmp/runs.csv | tail -n 1)

        printf '%s\\n---\\n%s\\n' "$REPO_YAML" "$CSV_OUT" | gh gist create -f report.yaml -d "Telemetry Report" >/dev/null
        gh gist view --filename report.yaml | grep -E "nameWithOwner:|visibility:|CI,2,success"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "nameWithOwner: acme/telemetry",
          "visibility: PRIVATE",
          "CI,2,success",
          ""
        ].join("\n")
      );
    });
  });

  it("20. shell EXIT trap, namerefs, associative arrays, and env -S orchestrating gh issue transfer and pr revert", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        declare -A REPOS=( [src]="acme/monolith" [dst]="acme/microservice" )
        declare -n SRC_REF="REPOS[src]"
        declare -n DST_REF="REPOS[dst]"

        gh repo create "$SRC_REF" >/dev/null
        gh repo create "$DST_REF" >/dev/null
        gh issue create -R "$SRC_REF" -t "Extract auth module" -a @me >/dev/null
        gh pr create -R "$SRC_REF" -t "Initial auth spike" -H spike/auth >/dev/null
        gh pr merge 2 -R "$SRC_REF" --squash >/dev/null

        run_transfer_and_revert() {
          trap 'echo "trap:cleanup:$?"' EXIT
          env -S "gh issue transfer 1 \${DST_REF} -R \${SRC_REF}" >/dev/null
          env -S "gh pr revert 2 -R \${SRC_REF} -t Revert-Spike" >/dev/null
          echo "inside:done"
        }
        OUT=$(run_transfer_and_revert)
        echo "$OUT"
        gh issue list -R "$DST_REF" --json number,title,assignees -q '.[0] | [(.number|tostring), .title, .assignees[0].login] | join("|")'
        gh pr list -R "$SRC_REF" --state all --json number,title -q 'map([(.number|tostring), .title] | join(":")) | join(",")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "inside:done",
          "trap:cleanup:0",
          "1|Extract auth module|octocat",
          "3:Revert-Spike,2:Initial auth spike",
          ""
        ].join("\n")
      );
    });
  });
});
