use safe_bash_rust::{
    BackendMode, MemoryVfs, MemoryVfsLimits, MountVfs, OverlayVfs, SafeBashFs, Shell, ShellOptions,
};
use std::collections::BTreeMap;
use std::sync::Arc;

fn new_pure_rust_shell(env: BTreeMap<String, String>) -> (Shell, MemoryVfs) {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/work").unwrap();
    let shell = Shell::new(
        Arc::new(vfs.clone()),
        ShellOptions {
            cwd: Some("/work".into()),
            env,
            mode: BackendMode::NativeOnly,
        },
    );
    (shell, vfs)
}

#[test]
fn pure_rust_compression_magic_bytes_and_tar_pipelines() {
    let (mut shell, vfs) = new_pure_rust_shell(BTreeMap::new());

    let res = shell
        .exec(
            r#"
            set -e
            printf 'pure-rust-codec-payload-0123456789\n' > sample.txt
            gzip -c sample.txt > sample.gz
            bzip2 -c sample.txt > sample.bz2
            xz -c sample.txt > sample.xz
            lzma -c sample.txt > sample.lzma
            zstd -c sample.txt > sample.zst
            gzip -dc sample.gz > out_gz.txt
            bzip2 -dc sample.bz2 > out_bz2.txt
            xz -dc sample.xz > out_xz.txt
            lzma -dc sample.lzma > out_lzma.txt
            zstd -dc sample.zst > out_zst.txt
            cmp -s sample.txt out_gz.txt
            cmp -s sample.txt out_bz2.txt
            cmp -s sample.txt out_xz.txt
            cmp -s sample.txt out_lzma.txt
            cmp -s sample.txt out_zst.txt
            echo "ALL_CODECS_OK"
        "#,
        )
        .unwrap();
    assert_eq!(res.exit_code, 0, "stderr: {}", res.stderr);
    assert!(!res.used_typescript_bridge);
    assert_eq!(res.stdout.trim(), "ALL_CODECS_OK");

    let gz = vfs.read_file("/work/sample.gz").unwrap();
    let bz2 = vfs.read_file("/work/sample.bz2").unwrap();
    let xz = vfs.read_file("/work/sample.xz").unwrap();
    let lzma = vfs.read_file("/work/sample.lzma").unwrap();
    let zst = vfs.read_file("/work/sample.zst").unwrap();

    assert_eq!(&gz[..2], &[0x1f, 0x8b]);
    assert_eq!(&bz2[..3], b"BZh");
    assert_eq!(&xz[..6], &[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
    assert_eq!(lzma[0], 0x5d);
    assert_eq!(&zst[..4], &[0x28, 0xb5, 0x2f, 0xfd]);
}

#[test]
fn pure_rust_sqlite3_binary_btree_multipage_and_window_group_by() {
    let (mut shell, vfs) = new_pure_rust_shell(BTreeMap::new());

    let res = shell
        .exec(
            r#"
            sqlite3 /work/app.db "
                CREATE TABLE metrics (id INTEGER PRIMARY KEY, team TEXT, score INT);
                WITH RECURSIVE seq(x) AS (
                    SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 140
                )
                INSERT INTO metrics(id, team, score)
                SELECT x, CASE WHEN x % 2 = 0 THEN 'even' ELSE 'odd' END, x * 10 FROM seq;
            "
            sqlite3 -separator '|' /work/app.db "
                SELECT team, COUNT(*), SUM(score), RANK() OVER (ORDER BY SUM(score) DESC)
                FROM metrics
                GROUP BY team
                ORDER BY SUM(score) DESC;
            "
        "#,
        )
        .unwrap();
    assert_eq!(res.exit_code, 0, "stderr: {}", res.stderr);
    assert!(!res.used_typescript_bridge);
    assert_eq!(res.stdout, "even|70|49700|1\nodd|70|49000|2\n");

    let db_bytes = vfs.read_file("/work/app.db").unwrap();
    assert_eq!(&db_bytes[..16], b"SQLite format 3\0");
    assert_eq!(db_bytes.len() % 4096, 0);
    assert!(db_bytes.len() >= 12288);
    let page_count = u32::from_be_bytes([db_bytes[28], db_bytes[29], db_bytes[30], db_bytes[31]]);
    assert_eq!(page_count as usize * 4096, db_bytes.len());
    assert!(!String::from_utf8_lossy(&db_bytes[16..]).contains("\"tables\""));
}

#[test]
fn pure_rust_sleep_validation_and_nested_timeout_preemption() {
    let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());

    let bad_sleep = shell.exec("sleep; echo ec=$?").unwrap();
    assert!(!bad_sleep.used_typescript_bridge);
    assert_eq!(bad_sleep.stdout.trim(), "ec=1");
    assert!(bad_sleep.stderr.contains("sleep: missing operand"));

    let bad_dur = shell.exec("sleep invalid_dur; echo ec=$?").unwrap();
    assert_eq!(bad_dur.stdout.trim(), "ec=1");
    assert!(bad_dur.stderr.contains("sleep: invalid time interval"));

    let nested = shell
        .exec("timeout 0.1s timeout 1s sh -c 'sleep 0.3; echo LATE_SHOULD_NOT_PRINT'")
        .unwrap();
    assert!(!nested.used_typescript_bridge);
    assert_eq!(nested.exit_code, 124);
    assert_eq!(nested.stdout, "");
}

#[test]
fn pure_rust_op_and_gh_full_workflows() {
    let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());

    let res = shell
        .exec(
            r#"
            set -e
            which op gh
            op vault create Private > /dev/null
            printf 'cert-body-xyz' > /work/cert.pem
            op item create --vault Private --category login --title "ProdApp" "password=super-secret-val" 'cert\.pem[file]=/work/cert.pem' > /dev/null
            echo "READ_CERT=$(op read 'op://Private/ProdApp/cert.pem')"
            printf 'literal={{ "{{keep}}" }} secret={{ op://Private/ProdApp/password }}\n' | op inject
            export PASSWORD='op://Private/ProdApp/password'
            op run -- sh -c 'echo "MASKED=$PASSWORD"'
            gh repo create poe-platform/poe-code > /dev/null
            gh issue create -R poe-platform/poe-code -t "Open issue" -b "b1" > /dev/null
            gh issue create -R poe-platform/poe-code -t "Closed issue" -b "b2" > /dev/null
            gh issue close 2 -R poe-platform/poe-code > /dev/null
            echo "OPEN_COUNT=$(gh issue list -R poe-platform/poe-code --json number | jq 'length')"
            echo "ALL_COUNT=$(gh issue list -R poe-platform/poe-code --state all --json number | jq 'length')"
        "#,
        )
        .unwrap();
    assert_eq!(res.exit_code, 0, "stderr: {}", res.stderr);
    assert!(!res.used_typescript_bridge);
    assert!(res.stdout.contains("/bin/op\n/bin/gh\n"));
    assert!(res.stdout.contains("READ_CERT=cert-body-xyz\n"));
    assert!(res.stdout.contains("literal={{keep}} secret=super-secret-val\n"));
    assert!(res.stdout.contains("MASKED=<concealed by 1Password>\n"));
    assert!(res.stdout.contains("OPEN_COUNT=1\n"));
    assert!(res.stdout.contains("ALL_COUNT=2\n"));
}

#[test]
fn pure_rust_vfs_quotas_dev_devices_mount_and_overlay() {
    let limited = MemoryVfs::with_limits(MemoryVfsLimits {
        max_total_bytes: 16,
        max_file_bytes: 10,
        max_entries: 4,
        max_symlink_hops: 8,
    });
    let mut shell = Shell::new(
        Arc::new(limited),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );

    let over_file = shell.exec("printf '0123456789A' > /big.txt").unwrap();
    assert_ne!(over_file.exit_code, 0);

    let dev_check = shell
        .exec("head -c 4 /dev/zero | xxd -p; head -c 8 /dev/urandom | wc -c | tr -d ' '")
        .unwrap();
    assert_eq!(dev_check.exit_code, 0);
    assert_eq!(dev_check.stdout, "00000000\n8\n");

    // Verify OverlayVfs and MountVfs with PureRust Shell
    let lower = MemoryVfs::new();
    lower.write_file("/base.txt", b"immutable\n").unwrap();
    let upper = MemoryVfs::new();
    let overlay = OverlayVfs::new(Arc::new(lower.clone()), Arc::new(upper));
    let mount_root = MemoryVfs::new();
    let mount_vfs = MountVfs::new(Arc::new(mount_root)).with_mount("/mnt/ov", Arc::new(overlay));

    let mut mshell = Shell::new(
        Arc::new(mount_vfs),
        ShellOptions {
            cwd: Some("/mnt/ov".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let ov_res = mshell
        .exec("cat base.txt; echo 'modified' > base.txt; cat base.txt")
        .unwrap();
    assert_eq!(ov_res.exit_code, 0);
    assert_eq!(ov_res.stdout, "immutable\nmodified\n");
    assert_eq!(lower.read_file("/base.txt").unwrap(), b"immutable\n");
}

#[test]
fn pure_rust_shell_grammar_arrays_namerefs_procsub_traps_and_env_flags() {
    let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());

    let res = shell
        .exec(
            r#"
            set -euo pipefail
            trap 'echo "TRAP_RAN"' EXIT
            declare -a nums=(10 20 30)
            nums+=(40)
            declare -A map=([alpha]="one" [beta]="two")
            target_var="map[beta]"
            declare -n ref_var=target_var
            echo "ARR=${nums[*]} LEN=${#nums[@]} REF=${!target_var}"
            diff -u <(printf 'a\nb\n') <(printf 'a\nb\n')
            env -i FOO=bar BAR=baz env -u BAR | sort
        "#,
        )
        .unwrap();
    assert_eq!(res.exit_code, 0, "stderr: {}", res.stderr);
    assert!(!res.used_typescript_bridge);
    assert!(res.stdout.contains("ARR=10 20 30 40 LEN=4 REF=two\n"));
    assert!(res.stdout.contains("FOO=bar\n"));
    assert!(!res.stdout.contains("BAR=baz"));
    assert!(res.stdout.contains("TRAP_RAN\n"));
}

#[test]
fn pure_rust_structured_text_search_math_and_graphviz_pipeline() {
    let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());

    let res = shell
        .exec(
            r#"
            set -e
            printf 'name,score\nalice,15\nbob,27\n' > scores.csv
            printf 'list(reader)\nexit()\n' | csvpy scores.csv 2>/dev/null | grep -q "alice"
            total=$(awk -F, 'NR > 1 { sum += $2 } END { print sum }' scores.csv)
            calc=$(echo "$total * 2 + 16" | bc)
            json=$(jq -nc --arg t "$total" --arg c "$calc" '{total: ($t|tonumber), calc: ($c|tonumber)}')
            echo "$json"
            echo 'digraph G { a -> b; }' | dot -Tsvg | grep -q '<svg' && echo "SVG_OK"
        "#,
        )
        .unwrap();
    assert_eq!(res.exit_code, 0, "stderr: {}", res.stderr);
    assert!(!res.used_typescript_bridge);
    assert_eq!(res.stdout, "{\"total\":42,\"calc\":100}\nSVG_OK\n");
}
