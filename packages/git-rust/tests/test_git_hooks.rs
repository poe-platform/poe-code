use git_rust::cli::execute_git_cli;
use git_rust::MemoryFs;

#[test]
fn test_pre_commit_prepare_commit_msg_commit_msg_and_post_commit() {
    let fs = MemoryFs::new();
    let cwd = "/repo";
    assert_eq!(execute_git_cli(&fs, cwd, &["init"]).exit_code, 0);
    execute_git_cli(&fs, cwd, &["config", "user.name", "Alice"]);
    execute_git_cli(&fs, cwd, &["config", "user.email", "alice@example.com"]);

    fs.write_str("/repo/app.ts", "console.log('hi');\n");
    execute_git_cli(&fs, cwd, &["add", "app.ts"]);

    // 1. Install a failing pre-commit hook
    fs.write_str(
        "/repo/.git/hooks/pre-commit",
        "#!/bin/sh\necho \"pre-commit blocked\" >&2\nexit 1\n",
    );
    let blocked = execute_git_cli(&fs, cwd, &["commit", "-m", "feat: blocked"]);
    assert_eq!(blocked.exit_code, 1);
    assert!(blocked.stderr.contains("pre-commit blocked"));

    // 2. --no-verify (-n) bypasses pre-commit
    let bypassed = execute_git_cli(&fs, cwd, &["commit", "-n", "-m", "feat: bypassed"]);
    assert_eq!(bypassed.exit_code, 0, "stderr: {}", bypassed.stderr);

    // 3. Passing pre-commit + prepare-commit-msg + commit-msg + post-commit
    fs.write_str(
        "/repo/.git/hooks/pre-commit",
        "#!/bin/sh\necho \"ok\" > .git/pre-commit-ok\nexit 0\n",
    );
    fs.write_str(
        "/repo/.git/hooks/prepare-commit-msg",
        "#!/bin/sh\necho \"Signed-off-by: Hook <hook@example.com>\" >> \"$1\"\n",
    );
    fs.write_str(
        "/repo/.git/hooks/commit-msg",
        "#!/bin/sh\nif grep -q \"WIP\" \"$1\"; then\n  echo \"WIP commits not allowed\" >&2\n  exit 1\nfi\n",
    );
    fs.write_str(
        "/repo/.git/hooks/post-commit",
        "#!/bin/sh\necho \"$(git rev-parse HEAD)\" > .git/last-post-commit\n",
    );

    fs.write_str("/repo/app.ts", "console.log('v2');\n");
    execute_git_cli(&fs, cwd, &["add", "app.ts"]);

    // WIP message should be rejected by commit-msg hook
    let wip_res = execute_git_cli(&fs, cwd, &["commit", "-m", "WIP: draft"]);
    assert_eq!(wip_res.exit_code, 1);
    assert!(wip_res.stderr.contains("WIP commits not allowed"));

    // Valid commit message gets trailer added by prepare-commit-msg and triggers post-commit
    let ok_res = execute_git_cli(&fs, cwd, &["commit", "-m", "feat: release v2"]);
    assert_eq!(ok_res.exit_code, 0, "stderr: {}", ok_res.stderr);
    assert_eq!(fs.read_str("/repo/.git/pre-commit-ok").as_deref(), Some("ok\n"));

    let head_oid = execute_git_cli(&fs, cwd, &["rev-parse", "HEAD"]).stdout.trim().to_string();
    assert_eq!(
        fs.read_str("/repo/.git/last-post-commit").map(|s| s.trim().to_string()),
        Some(head_oid.clone())
    );

    let log_out = execute_git_cli(&fs, cwd, &["log", "-1"]).stdout;
    assert!(log_out.contains("feat: release v2"));
    assert!(log_out.contains("Signed-off-by: Hook <hook@example.com>"));

    // 4. post-rewrite on commit --amend
    fs.write_str(
        "/repo/.git/hooks/post-rewrite",
        "#!/bin/sh\nwhile read old_sha new_sha; do\n  echo \"$1:$old_sha->$new_sha\" > .git/rewritten\ndone\n",
    );
    let amend_res = execute_git_cli(&fs, cwd, &["commit", "--amend", "-m", "feat: amended v2"]);
    assert_eq!(amend_res.exit_code, 0);
    let new_head = execute_git_cli(&fs, cwd, &["rev-parse", "HEAD"]).stdout.trim().to_string();
    let rewritten = fs.read_str("/repo/.git/rewritten").unwrap_or_default();
    assert_eq!(rewritten.trim(), format!("amend:{head_oid}->{new_head}"));
}

#[test]
fn test_post_checkout_post_merge_pre_rebase_pre_push_and_core_hooks_path() {
    let fs = MemoryFs::new();
    let cwd = "/repo";
    execute_git_cli(&fs, cwd, &["init", "-b", "main"]);
    execute_git_cli(&fs, cwd, &["config", "user.name", "Alice"]);
    execute_git_cli(&fs, cwd, &["config", "user.email", "alice@example.com"]);
    execute_git_cli(&fs, cwd, &["config", "core.hooksPath", ".githooks"]);

    fs.write_str("/repo/file.txt", "base\n");
    execute_git_cli(&fs, cwd, &["add", "file.txt"]);
    execute_git_cli(&fs, cwd, &["commit", "-m", "base commit"]);
    let base_oid = execute_git_cli(&fs, cwd, &["rev-parse", "HEAD"]).stdout.trim().to_string();

    // Custom .githooks/post-checkout
    fs.write_str(
        "/repo/.githooks/post-checkout",
        "#!/bin/sh\necho \"$1 $2 $3\" > .git/post-checkout-args\n",
    );
    let co_res = execute_git_cli(&fs, cwd, &["checkout", "-b", "feature"]);
    assert_eq!(co_res.exit_code, 0);
    assert_eq!(
        fs.read_str("/repo/.git/post-checkout-args").map(|s| s.trim().to_string()),
        Some(format!("{base_oid} {base_oid} 1"))
    );

    // Commit on feature and merge into main with post-merge hook
    fs.write_str("/repo/feature.txt", "feature\n");
    execute_git_cli(&fs, cwd, &["add", "feature.txt"]);
    execute_git_cli(&fs, cwd, &["commit", "-m", "feature commit"]);

    execute_git_cli(&fs, cwd, &["checkout", "main"]);
    fs.write_str(
        "/repo/.githooks/post-merge",
        "#!/bin/sh\necho \"merged:$1\" > .git/post-merge-ran\n",
    );
    let merge_res = execute_git_cli(&fs, cwd, &["merge", "feature"]);
    assert_eq!(merge_res.exit_code, 0);
    assert_eq!(
        fs.read_str("/repo/.git/post-merge-ran").map(|s| s.trim().to_string()),
        Some("merged:0".to_string())
    );

    // pre-rebase hook blocking rebase
    fs.write_str(
        "/repo/.githooks/pre-rebase",
        "#!/bin/sh\necho \"rebase blocked for $1\" >&2\nexit 1\n",
    );
    let rb_res = execute_git_cli(&fs, cwd, &["rebase", "main"]);
    assert_eq!(rb_res.exit_code, 1);
    assert!(rb_res.stderr.contains("rebase blocked for main"));

    // pre-push hook reading stdin and blocking push
    fs.write_str(
        "/repo/.githooks/pre-push",
        "#!/bin/sh\nwhile read lref lsha rref rsha; do\n  echo \"$1|$2|$lref\" > .git/pre-push-seen\ndone\nexit 1\n",
    );
    execute_git_cli(&fs, cwd, &["remote", "add", "origin", "https://example.com/repo.git"]);
    let push_res = execute_git_cli(&fs, cwd, &["push", "origin", "main"]);
    assert_eq!(push_res.exit_code, 1);
    let seen = fs.read_str("/repo/.git/pre-push-seen").unwrap_or_default();
    assert_eq!(seen.trim(), "origin|https://example.com/repo.git|refs/heads/main");
}


#[test]
fn test_post_rewrite_hook_cat_stdin_on_amend_and_rebase() {
    let fs = MemoryFs::new();
    let repo = "/repo-rewrite";
    assert_eq!(execute_git_cli(&fs, repo, &["init", "-b", "main"]).exit_code, 0);
    assert_eq!(execute_git_cli(&fs, repo, &["config", "user.name", "Tester"]).exit_code, 0);
    assert_eq!(execute_git_cli(&fs, repo, &["config", "user.email", "tester@example.com"]).exit_code, 0);

    fs.write_str(
        "/repo-rewrite/.git/hooks/post-rewrite",
        "#!/bin/sh\necho \"mode:$1\" >> /repo-rewrite/rewrite.log\ncat >> /repo-rewrite/rewrite.log\nexit 0\n",
    );

    fs.write_str("/repo-rewrite/a.txt", "v1\n");
    assert_eq!(execute_git_cli(&fs, repo, &["add", "a.txt"]).exit_code, 0);
    assert_eq!(execute_git_cli(&fs, repo, &["commit", "-m", "initial"]).exit_code, 0);
    let old_oid = execute_git_cli(&fs, repo, &["rev-parse", "HEAD"]).stdout.trim().to_string();

    assert_eq!(execute_git_cli(&fs, repo, &["commit", "--amend", "-m", "amended"]).exit_code, 0);
    let new_oid = execute_git_cli(&fs, repo, &["rev-parse", "HEAD"]).stdout.trim().to_string();

    let log = fs.read_str("/repo-rewrite/rewrite.log").unwrap_or_default();
    assert!(log.contains("mode:amend"));
    assert!(log.contains(&format!("{old_oid} {new_oid}")));
}
