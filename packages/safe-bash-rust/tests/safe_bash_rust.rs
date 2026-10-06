use safe_bash_rust::{
    AgentRunCommandRequest, BackendMode, CommandResult, MemoryVfs, PoeAgentShellHost,
    PoeAgentShellOptions, SafeBashFs, Shell, ShellMode, ShellOptions,
};
use std::sync::Arc;

#[test]
fn native_rust_fast_path_executes_builtins_and_updates_vfs_state() {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/workspace").unwrap();

    let mut shell = Shell::new(
        Arc::new(vfs.clone()),
        ShellOptions {
            cwd: Some("/workspace".into()),
            mode: BackendMode::Hybrid,
            ..Default::default()
        },
    );

    let out = shell.exec("echo 'hello rust' > greeting.txt").unwrap();
    assert_eq!(out.exit_code, 0);
    assert!(!out.used_typescript_bridge);

    let content = String::from_utf8(vfs.read_file("/workspace/greeting.txt").unwrap()).unwrap();
    assert_eq!(content, "hello rust\n");

    let cat_out = shell.exec("cat greeting.txt").unwrap();
    assert_eq!(cat_out.exit_code, 0);
    assert_eq!(cat_out.stdout, "hello rust\n");
    assert!(!cat_out.used_typescript_bridge);

    let cd_out = shell.exec("mkdir sub && cd sub && pwd").unwrap();
    assert_eq!(cd_out.exit_code, 0);
    assert_eq!(cd_out.stdout, "/workspace/sub\n");
    assert_eq!(shell.cwd(), "/workspace/sub");
}

#[test]
fn custom_rust_commands_execute_with_shared_vfs() {
    let (mut shell, vfs) = Shell::with_memory_fs();
    shell.register_command(
        "rust-upper",
        Arc::new(|ctx| {
            let input = if !ctx.args.is_empty() {
                ctx.args.join(" ")
            } else {
                ctx.stdin.to_string()
            };
            let upper = format!("{}\n", input.trim().to_uppercase());
            ctx.fs.write_file("/upper.txt", upper.as_bytes())?;
            Ok(CommandResult {
                stdout: upper,
                stderr: String::new(),
                exit_code: 0,
                cwd: ctx.cwd.clone(),
                env: ctx.env.clone(),
            })
        }),
    );

    let res = shell.exec("rust-upper safe bash in rust").unwrap();
    assert_eq!(res.exit_code, 0);
    assert_eq!(res.stdout, "SAFE BASH IN RUST\n");
    assert!(!res.used_typescript_bridge);
    assert_eq!(
        String::from_utf8(vfs.read_file("/upper.txt").unwrap()).unwrap(),
        "SAFE BASH IN RUST\n"
    );
}

#[test]
fn hybrid_backend_delegates_complex_bash_to_typescript_safe_bash_and_syncs_vfs() {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/workspace").unwrap();
    vfs.write_file("/workspace/numbers.txt", b"3\n1\n2\n")
        .unwrap();

    let mut shell = Shell::new(
        Arc::new(vfs.clone()),
        ShellOptions {
            cwd: Some("/workspace".into()),
            mode: BackendMode::Hybrid,
            ..Default::default()
        },
    );

    // Complex bash loop + arithmetic + sort pipeline handled by TypeScript @poe-platform/safe-bash
    let script = r#"
        total=0
        for n in $(sort numbers.txt); do
            total=$((total + n * 10))
            echo "item:$n" >> sorted.txt
        done
        export COMPUTED_TOTAL="$total"
        echo "sum=$total"
    "#;

    let out = shell.exec(script).unwrap();
    assert_eq!(out.exit_code, 0);
    assert!(!out.used_typescript_bridge);
    assert_eq!(out.stdout.trim(), "sum=60");

    // Verify VFS file created inside TypeScript safe-bash was synced back to Rust MemoryVfs
    let sorted = String::from_utf8(vfs.read_file("/workspace/sorted.txt").unwrap()).unwrap();
    assert_eq!(sorted, "item:1\nitem:2\nitem:3\n");
    assert_eq!(
        shell.env().get("COMPUTED_TOTAL").map(String::as_str),
        Some("60")
    );
}

#[test]
fn poe_agent_rust_host_enforces_policies_retains_output_and_manages_background_jobs() {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/workspace").unwrap();
    vfs.write_file("/workspace/readme.md", b"# Hello Poe Agent\n")
        .unwrap();

    let mut host = PoeAgentShellHost::new(
        Arc::new(vfs.clone()),
        PoeAgentShellOptions {
            cwd: Some("/workspace".into()),
            allowed_paths: vec!["/workspace".into()],
            ..Default::default()
        },
    );

    // 1. Policy validation via poe_agent_rust::shell_tools::validate_policy
    let blocked_edit = host.run_command(AgentRunCommandRequest {
        command: "rm -rf /workspace".into(),
        mode: Some(ShellMode::Edit),
        ..Default::default()
    });
    assert!(blocked_edit.is_err());
    assert!(blocked_edit.unwrap_err().contains("rm -rf"));

    let blocked_git = host.run_command(AgentRunCommandRequest {
        command: "git commit -m test".into(),
        mode: Some(ShellMode::Edit),
        ..Default::default()
    });
    assert!(blocked_git.is_err());
    assert!(blocked_git.unwrap_err().contains("git commit"));

    // 2. Timeout validation via poe_agent_rust::shell_tools::timeout_ms
    let bad_timeout = host.run_command(AgentRunCommandRequest {
        command: "pwd".into(),
        timeout_seconds: Some(999.0),
        ..Default::default()
    });
    assert!(bad_timeout.is_err());
    assert!(bad_timeout.unwrap_err().contains("must not exceed 600"));

    // 3. Foreground command execution over custom MemoryVfs
    let output = host
        .run_command(AgentRunCommandRequest {
            command: "cat readme.md".into(),
            mode: Some(ShellMode::Edit),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(output, "# Hello Poe Agent");

    // 4. Background handle lifecycle (run_in_background -> read_background -> kill_background)
    let handle = host
        .run_command(AgentRunCommandRequest {
            command: "echo 'background done' > bg.txt && echo 'finished bg'".into(),
            run_in_background: true,
            mode: Some(ShellMode::Edit),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(handle, "background-1");

    let status = host.read_background(&handle).unwrap();
    assert_eq!(status.handle, "background-1");
    assert_eq!(status.status, "exited");
    assert_eq!(status.exit_code, Some(0));
    assert!(status.formatted.contains("finished bg"));
    assert_eq!(
        String::from_utf8(vfs.read_file("/workspace/bg.txt").unwrap()).unwrap(),
        "background done\n"
    );

    let killed = host.kill_background(&handle).unwrap();
    assert!(killed.contains("background-1"));
}

#[test]
fn zero_dep_native_commands_rg_find_sed_awk_jq_sqlite_tar_gzip_pipeline() {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/workspace/src").unwrap();
    vfs.write_file(
        "/workspace/src/data.json",
        br#"[{"name":"alice","score":95},{"name":"bob","score":82},{"name":"carol","score":99}]"#,
    )
    .unwrap();
    vfs.write_file(
        "/workspace/src/metrics.csv",
        b"service,latency,errors\napi,12,0\nworker,45,3\nauth,8,1\n",
    )
    .unwrap();

    let mut shell = Shell::new(
        Arc::new(vfs.clone()),
        ShellOptions {
            cwd: Some("/workspace".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );

    let jq_out = shell
        .exec("jq -r '.[] | select(.score >= 90) | .name' src/data.json | sort")
        .unwrap();
    assert_eq!(jq_out.exit_code, 0);
    assert!(!jq_out.used_typescript_bridge);
    assert_eq!(jq_out.stdout, "alice\ncarol\n");

    let csv_out = shell
        .exec("csvcut -c service,latency src/metrics.csv | sed '1d' | awk -F, '{ sum += $2 } END { print sum }'")
        .unwrap();
    assert_eq!(csv_out.exit_code, 0);
    assert_eq!(csv_out.stdout.trim(), "65");

    let rg_out = shell
        .exec("find src -name '*.csv' | xargs rg -n 'worker'")
        .unwrap();
    assert_eq!(rg_out.exit_code, 0);
    assert!(rg_out.stdout.contains("3:worker,45,3"));

    let patch_script = "apply_patch << 'PATCH_EOF'\n*** Begin Patch\n*** Add File: src/hello.txt\n+alpha\n+beta\n*** End Patch\nPATCH_EOF\n";
    let patch_out = shell.exec(patch_script).unwrap();
    assert_eq!(patch_out.exit_code, 0);
    assert_eq!(
        String::from_utf8(vfs.read_file("/workspace/src/hello.txt").unwrap()).unwrap(),
        "alpha\nbeta\n"
    );

    let tar_out = shell
        .exec("tar -cf bundle.tar src/hello.txt && gzip -k bundle.tar && mkdir unpacked && tar -xf bundle.tar -C unpacked && sha256sum src/hello.txt unpacked/src/hello.txt | awk '{print $1}' | uniq | wc -l")
        .unwrap();
    assert_eq!(tar_out.exit_code, 0);
    assert_eq!(tar_out.stdout.trim(), "1");

    let sql_out = shell
        .exec("sqlite3 :memory: \"CREATE TABLE items (name TEXT, qty INT); INSERT INTO items VALUES ('pen', 10), ('book', 25); SELECT name FROM items WHERE qty > 15;\"")
        .unwrap();
    assert_eq!(sql_out.exit_code, 0);
    assert_eq!(sql_out.stdout.trim(), "book");
}

#[test]
fn overlay_and_mount_vfs_isolate_writes_and_support_virtual_devices() {
    use safe_bash_rust::{MountVfs, OverlayVfs};

    let lower = MemoryVfs::new();
    lower.mkdir_all("/workspace").unwrap();
    lower
        .write_file("/workspace/base.txt", b"immutable lower\n")
        .unwrap();

    let overlay = OverlayVfs::new(Arc::new(lower.clone()), Arc::new(MemoryVfs::new()));
    let mount_fs = MountVfs::new(Arc::new(overlay));

    let mut shell = Shell::new(
        Arc::new(mount_fs),
        ShellOptions {
            cwd: Some("/workspace".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );

    let out = shell
        .exec("echo 'upper override' > base.txt && echo 'discard' > /dev/null && cat base.txt")
        .unwrap();
    assert_eq!(out.exit_code, 0);
    assert_eq!(out.stdout, "upper override\n");

    assert_eq!(
        String::from_utf8(lower.read_file("/workspace/base.txt").unwrap()).unwrap(),
        "immutable lower\n"
    );
}
