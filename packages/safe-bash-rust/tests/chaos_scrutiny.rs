use safe_bash_rust::{
    AgentRunCommandRequest, BackendMode, ExecOptions, MemoryVfs, PoeAgentShellHost,
    PoeAgentShellOptions, SafeBashFs, Shell, ShellMode, ShellOptions,
};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

#[test]
fn chaos_empty_directories_and_symlinks_survive_bidirectional_vfs_sync() {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/workspace/empty_from_rust/nested").unwrap();
    vfs.write_file("/workspace/target.txt", b"symlink payload\n")
        .unwrap();

    let mut shell = Shell::new(
        Arc::new(vfs.clone()),
        ShellOptions {
            cwd: Some("/workspace".into()),
            mode: BackendMode::Hybrid,
            ..Default::default()
        },
    );

    // Run via TypeScript bridge: create an empty dir and a symlink, and read existing empty dir
    let out = shell
        .exec("mkdir -p empty_from_ts/deep && ln -s target.txt sym.txt && [ -d empty_from_rust/nested ] && cat sym.txt")
        .unwrap();
    assert_eq!(out.exit_code, 0, "stderr: {}", out.stderr);
    assert_eq!(out.stdout, "symlink payload\n");

    // Both empty directories must still exist in Rust MemoryVfs after replace_entries!
    assert!(
        vfs.is_dir("/workspace/empty_from_rust/nested"),
        "empty_from_rust/nested was lost during VFS sync"
    );
    assert!(
        vfs.is_dir("/workspace/empty_from_ts/deep"),
        "empty_from_ts/deep was not synced back to Rust MemoryVfs"
    );

    // Symlink must be preserved in git_rust::MemoryFs and readable in subsequent commands
    let link_target = vfs.as_git_fs().readlink("/workspace/sym.txt").unwrap();
    assert_eq!(link_target, b"target.txt");
}

#[test]
fn chaos_binary_all_256_byte_values_round_trip_without_corruption() {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/workspace").unwrap();

    // 4096 bytes cycling through 0x00..=0xFF (including NUL, lone surrogates, invalid UTF-8)
    let original_bytes: Vec<u8> = (0..4096).map(|i| (i & 0xFF) as u8).collect();
    vfs.write_file("/workspace/raw.bin", &original_bytes)
        .unwrap();

    let mut shell = Shell::new(
        Arc::new(vfs.clone()),
        ShellOptions {
            cwd: Some("/workspace".into()),
            mode: BackendMode::Hybrid,
            ..Default::default()
        },
    );

    // Copy binary file inside TypeScript safe-bash and verify byte count
    let out = shell
        .exec("cp raw.bin copy.bin && wc -c < copy.bin")
        .unwrap();
    assert_eq!(out.exit_code, 0);
    assert_eq!(out.stdout.trim(), "4096");

    let synced_orig = vfs.read_file("/workspace/raw.bin").unwrap();
    let synced_copy = vfs.read_file("/workspace/copy.bin").unwrap();
    assert_eq!(synced_orig, original_bytes);
    assert_eq!(synced_copy, original_bytes);
}

#[test]
fn chaos_env_unset_and_special_characters_propagate_accurately() {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/workspace").unwrap();

    let mut initial_env = BTreeMap::new();
    initial_env.insert("KEEP_ME".into(), "initial".into());
    initial_env.insert("REMOVE_ME".into(), "to_be_unset".into());

    let mut shell = Shell::new(
        Arc::new(vfs),
        ShellOptions {
            cwd: Some("/workspace".into()),
            env: initial_env,
            mode: BackendMode::Hybrid,
        },
    );

    let out = shell
        .exec(
            r#"
            unset REMOVE_ME
            export KEEP_ME="updated 🚀 🦀"
            export MULTILINE=$'line1\nline2'
            echo "$KEEP_ME"
            "#,
        )
        .unwrap();
    assert_eq!(out.exit_code, 0);
    assert_eq!(out.stdout.trim(), "updated 🚀 🦀");
    assert_eq!(shell.env().get("KEEP_ME").map(String::as_str), Some("updated 🚀 🦀"));
    assert_eq!(shell.env().get("MULTILINE").map(String::as_str), Some("line1\nline2"));
    assert!(
        !shell.env().contains_key("REMOVE_ME"),
        "unset variable REMOVE_ME should be removed from Rust shell env"
    );
}

#[test]
fn chaos_syntax_errors_short_circuits_and_rm_flags_behave_per_posix() {
    let (mut shell, vfs) = Shell::with_memory_fs();
    vfs.mkdir_all("/workspace").unwrap();
    shell.exec("cd /workspace").unwrap();

    // 1. Invalid bash syntax returns exit_code == 2 instead of crashing bridge
    let syn = shell.exec("if [ 1 -eq 1 ]; then echo unclosed").unwrap();
    assert_eq!(syn.exit_code, 2);
    assert!(!syn.stderr.is_empty());

    // 2. Short-circuit `&&` on failure in native fast-path
    let chain = shell
        .exec("false && echo should_not_write > /workspace/ghost.txt")
        .unwrap();
    assert_eq!(chain.exit_code, 1);
    assert!(!vfs.exists("/workspace/ghost.txt"));

    // 3. `rm -f` on missing file succeeds with exit_code 0, while `rm` without `-f` returns 1
    let rmf = shell.exec("rm -f /workspace/missing_file.txt").unwrap();
    assert_eq!(rmf.exit_code, 0);

    let rm_no_f = shell.exec("rm /workspace/missing_file.txt").unwrap();
    assert_eq!(rm_no_f.exit_code, 1);
}

#[test]
fn chaos_infinite_loop_is_terminated_by_timeout() {
    let (mut shell, _) = Shell::with_memory_fs();
    let start = Instant::now();
    let res = shell.exec_with_options(
        "while true; do :; done",
        ExecOptions {
            timeout_ms: Some(150),
            ..Default::default()
        },
    );
    let elapsed = start.elapsed();
    assert!(
        elapsed.as_secs() < 30,
        "Infinite loop was not aborted promptly (took {elapsed:?})"
    );
    match res {
        Err(msg) => assert!(msg.to_lowercase().contains("timed out") || msg.to_lowercase().contains("abort")),
        Ok(out) => assert_ne!(out.exit_code, 0),
    }
}

#[test]
fn chaos_poe_agent_host_output_flood_truncation_and_cwd_escape_clamp() {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/workspace/sub").unwrap();
    vfs.mkdir_all("/secret").unwrap();
    vfs.write_file("/secret/key.txt", b"top-secret").unwrap();

    let mut host = PoeAgentShellHost::new(
        Arc::new(vfs),
        PoeAgentShellOptions {
            cwd: Some("/workspace".into()),
            allowed_paths: vec!["/workspace".into()],
            ..Default::default()
        },
    );

    // 1. Reject traversal in requested cwd
    let traversal = host.run_command(AgentRunCommandRequest {
        command: "pwd".into(),
        cwd: Some("/workspace/../secret".into()),
        mode: Some(ShellMode::Edit),
        ..Default::default()
    });
    assert!(traversal.is_err());

    // 2. If a script `cd /secret` inside execution, host must not stay outside allowed_paths
    let _ = host.run_command(AgentRunCommandRequest {
        command: "cd /secret".into(),
        mode: Some(ShellMode::Edit),
        ..Default::default()
    });
    let next_pwd = host
        .run_command(AgentRunCommandRequest {
            command: "pwd".into(),
            mode: Some(ShellMode::Edit),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(next_pwd, "/workspace");

    // 3. Flood > 200,000 characters of output and verify 128 KiB RetainedOutput truncation
    let flood = host
        .run_command(AgentRunCommandRequest {
            command: "yes '0123456789abcdef🦀' | head -n 10000".into(),
            mode: Some(ShellMode::Edit),
            ..Default::default()
        })
        .unwrap();
    assert!(
        flood.starts_with("[output truncated:"),
        "Expected truncation header, got prefix: {:?}",
        &flood[..flood.len().min(60)]
    );
}

#[test]
fn chaos_concurrent_multithreaded_shells_do_not_interfere() {
    std::thread::scope(|s| {
        let mut handles = Vec::new();
        for idx in 0..6 {
            handles.push(s.spawn(move || {
                let vfs = MemoryVfs::new();
                vfs.mkdir_all("/work").unwrap();
                let mut shell = Shell::new(
                    Arc::new(vfs.clone()),
                    ShellOptions {
                        cwd: Some("/work".into()),
                        mode: BackendMode::Hybrid,
                        ..Default::default()
                    },
                );
                shell
                    .exec(&format!("echo 'worker-{idx}' > id.txt"))
                    .unwrap();
                let res = shell
                    .exec(&format!(
                        "val=$(cat id.txt); echo \"$val:$(( {idx} * 7 ))\" > out.txt; cat out.txt"
                    ))
                    .unwrap();
                assert_eq!(res.exit_code, 0);
                assert_eq!(res.stdout.trim(), format!("worker-{idx}:{}", idx * 7));
                let stored = String::from_utf8(vfs.read_file("/work/out.txt").unwrap()).unwrap();
                assert_eq!(stored.trim(), format!("worker-{idx}:{}", idx * 7));
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    });
}
