use safe_bash_rust::{
    BackendMode, MemoryVfs, MemoryVfsLimits, MountVfs, OverlayVfs, SafeBashFs, Shell, ShellOptions, VfsFileEntry, vfs::ChunkReader,
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

struct JqStreamFs;
impl SafeBashFs for JqStreamFs {
    fn access_path(&self, path: &str, _: bool) -> Result<String, String> { Ok(path.into()) }
    fn open_chunks(&self, path: &str) -> Result<ChunkReader<'_>, String> {
        let source: &[u8] = match path {
            "/late-error" | "/json-error" => {
                let mut chunks = if path == "/json-error" { [b"1 ".as_slice(), b"\n2\n".as_slice()] } else { [b"a\xc3".as_slice(), b"\xa9\n".as_slice()] }.into_iter();
                return Ok(Box::new(move |out| {
                    out.clear();
                    out.extend_from_slice(chunks.next().ok_or("EIO: late read")?);
                    Ok(())
                }));
            }
            "/oversized" => {
                let mut first = true;
                return Ok(Box::new(move |out| {
                    assert!(std::mem::take(&mut first), "read past the memory limit");
                    out.resize(1025, b' ');
                    Ok(())
                }));
            }
            "/seq" => b"\x1e1 x\n\x1e2\n",
            "/nul" => b"1\0 2\n3\n",
            "/filter" => b"include \"m\"; value",
            "/lib/m.jq" => b"def value: \"\xc3\xa9\";",
            _ => return Err("ENOENT: no such file or directory".into()),
        };
        let mut chunks = source.chunks(1);
        Ok(Box::new(move |out| { out.clear(); out.extend_from_slice(chunks.next().unwrap_or_default()); Ok(()) }))
    }
    fn read_file(&self, _: &str) -> Result<Vec<u8>, String> { Err("EIO: whole-file read".into()) }
    fn write_file(&self, _: &str, _: &[u8]) -> Result<(), String> { unreachable!() }
    fn mkdir_all(&self, _: &str) -> Result<(), String> { Ok(()) }
    fn remove_path(&self, _: &str) -> Result<(), String> { unreachable!() }
    fn exists(&self, _: &str) -> bool { true }
    fn is_dir(&self, path: &str) -> bool { matches!(path, "/" | "/lib") }
    fn list_dir(&self, _: &str) -> Result<Vec<String>, String> { unreachable!() }
    fn symlink(&self, _: &str, _: &str) -> Result<(), String> { unreachable!() }
    fn readlink(&self, _: &str) -> Result<String, String> { unreachable!() }
    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> { unreachable!() }
    fn replace_entries(&self, _: &[VfsFileEntry]) -> Result<(), String> { unreachable!() }
}

#[test]
fn jq_compiles_streamed_programs_and_modules_before_reading_input() {
    let mut shell = Shell::new(Arc::new(JqStreamFs), ShellOptions::default());
    let r = shell.exec("jq -L/lib -nr -f /filter").unwrap();
    assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (0, "é\n", ""));
    shell.set_limits(safe_bash_rust::ShellLimits { max_memory_bytes: 1024, ..Default::default() });
    assert!(shell.exec("jq -n -f /oversized").unwrap_err().contains("maxMemoryBytes"));
}

#[test]
fn jq_json_file_reads_stop_on_the_requested_value() {
    let mut shell = Shell::new(Arc::new(JqStreamFs), ShellOptions::default());
    for (cmd, code, stdout, stderr) in [
        ("jq -nc 'first(inputs)' /json-error", 0, "1\n", ""),
        ("jq -nc 'first(inputs)' /json-error /absent", 0, "1\n", ""),
        ("jq -nc 'first(inputs) | error' /json-error", 5, "", "jq: error (at /json-error:0): 1\n"),
        ("jq error /json-error", 2, "", "jq: error (at /json-error:1): 1\njq: error (at /json-error:2): 2\njq: EIO: input/output error, readStream '/json-error'\n"),
        ("jq --seq error /seq", 5, "", "jq: ignoring parse error: Invalid numeric literal at line 2, column 0 (need RS to resync)\njq: error (at /seq:1): 1\njq: error (at /seq:2): 2\n"),
        ("jq -nc '[inputs]' /nul", 0, "[1,2,3]\n", ""),
    ] {
        let r = shell.exec(cmd).unwrap();
        assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (code, stdout, stderr), "{cmd}");
    }
}

#[test]
fn jq_raw_inputs_only_pull_as_far_as_the_requested_line() {
    let mut shell = Shell::new(Arc::new(JqStreamFs), ShellOptions::default());
    let r = shell.exec("jq -nRr 'first(inputs)' /late-error /absent").unwrap();
    assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (0, "aé\n", ""));
    shell.set_limits(safe_bash_rust::ShellLimits { max_memory_bytes: 1024, ..Default::default() });
    assert!(shell.exec("jq -nR 'first(inputs)' /oversized").unwrap_err().contains("maxMemoryBytes"));
    for script in ["jq -nR '[inputs]' /late-error", "jq --rawfile v /late-error -n '$v'"] {
        let r = shell.exec(script).unwrap();
        assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (2, "", "jq: EIO: input/output error, readStream '/late-error'\n"));
    }
}

#[test]
fn recursive_jq_functions_return_a_diagnostic_and_leave_the_shell_usable() {
    let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());
    for filter in ["def f: f; f", "def f: f; path(f)", "def f: if . > 0 then .-1 | f else . end; 10000 | f"] {
        let result = shell.exec(&format!("jq -n '{filter}'")).unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (5, "jq: maxDepth limit exceeded\n"));
    }
    let chain = vec!["first(range(1; 2))"; 2500].join("+");
    let result = shell.exec(&format!("jq -n '{chain}'")).unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (5, "jq: maxDepth limit exceeded\n"));
    assert_eq!(shell.exec("echo ok").unwrap().stdout, "ok\n");
}

#[test]
fn version_flags_follow_each_command_provider() {
    let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());
    for (command, version) in [
        ("shuf", "virtual-bash, GNU coreutils 9.7 profile"),
        ("install", "safe-bash; GNU coreutils 9.7 target"),
        ("sqlite3", "3.45.0 2024-01-15"),
        ("qpdf", "11.9.1 (@poe-code/pdf-ast)"),
        ("wkhtmltopdf", "Qt compatibility unqualified"),
    ] {
        let result = shell.exec(&format!("{command} --version")).unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert!(result.stdout.contains(version), "{command}: {}", result.stdout);
    }
    for (command, code) in [("mogrify", 0), ("compare", 2), ("montage", 1), ("composite", 1)] {
        let result = shell.exec(&format!("{command} --version")).unwrap();
        assert_eq!(result.exit_code, code, "{command}: {}", result.stderr);
        assert!(result.stdout.is_empty());
        if code != 0 { assert_eq!(result.stderr, format!("{command}: missing an image filename\n")); }
    }
}

#[test]
fn saved_stdout_bypasses_pipeline_and_substitution_capture() {
    for (script, expected, bytes) in [
        ("exec 2>&1; printf a >&2 | tr a z", "a", 1),
        ("exec 3>&1; { printf a >&3; printf b; } | tr ab yz | tr z q", "aq", 4),
        ("shopt -s lastpipe; exec 2>&1; printf a >&2 | tr a z", "a", 1),
        ("exec 3>&1; v=$(printf a >&3; printf b); printf '[%s]' \"$v\"", "a[b]", 5),
        ("exec 2>&1; v=$(printf a >&2; printf b); printf '[%s]' \"$v\"", "a[b]", 5),
    ] {
        let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());
        shell.set_limits(safe_bash_rust::ShellLimits { max_output_bytes: bytes, ..Default::default() });
        let result = shell.exec(script).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, expected, ""), "{script}");
        if bytes > 1 {
            let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());
            shell.set_limits(safe_bash_rust::ShellLimits { max_output_bytes: bytes - 1, ..Default::default() });
            assert!(shell.exec(script).unwrap_err().contains("maxOutputBytes"), "{script}");
        }
    }
}

#[test]
fn merged_descriptors_emit_in_command_order() {
    for (script, stdout, stderr) in [
        ("{ printf a; printf b >&2; printf c; } 2>&1", "abc", ""),
        ("{ printf a; printf b >&2; printf c; } >&2", "", "abc"),
        ("{ printf a >&3; printf b >&2; printf c; } 3>&2 2>&1", "bc", "a"),
        ("{ sh -c 'printf x; printf a >&2' | tr a z; } 2>&1", "ax", ""),
        ("{ printf a; printf b >&2; printf c; } 2>&1 | tr b z", "azc", ""),
        ("{ x=$(printf a; printf b >&2); printf %s \"$x\"; } 2>&1", "ba", ""),
        ("f(){ printf a; printf b >&2; printf c; }; f 2>&1", "abc", ""),
        ("f(){ printf a; printf b >&2; printf c; } 2>&1; f", "abc", ""),
        ("{ exec 3>&2; printf a >&3; } 2>&1; printf b >&3", "ab", ""),
        ("{ select x in 1; do printf b >&2; break; done <<<1; } 2>&1", "1) 1\n#? b", ""),
        ("{ exec 2>/file; printf a >&2; printf b; } 2>&1; cat /file", "ba", ""),
    ] {
        let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());
        let result = shell.exec(script).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, stdout, stderr), "{script}");
    }
}

#[test]
fn op_run_masks_writes_to_a_saved_copy_of_its_stdout() {
    let (mut shell, _) = new_pure_rust_shell(BTreeMap::new());
    let result = shell.exec(r#"op vault create V >/dev/null
        op item create --category login --title T --vault V password=fixture_value >/dev/null
        export V=op://V/T/password
        { op run -- sh -c 'printf "%s" "$V" >&3'; } 3>&1"#).unwrap();
    assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, "<concealed by 1Password>", ""));
}

#[test]
fn redirected_pipeline_writes_before_the_next_command() {
    let (mut shell, fs) = new_pure_rust_shell(BTreeMap::new());
    let result = shell.exec("(printf A | cat; cat output >&2; printf B) > output").unwrap();
    assert_eq!(result.exit_code, 0);
    assert_eq!(result.stderr, "A");
    assert_eq!(fs.read_file("/work/output").unwrap(), b"AB");
}

#[test]
fn canonical_paths_resume_after_cycles_and_repeated_symlinks() {
    let (mut shell, fs) = new_pure_rust_shell(BTreeMap::new());
    fs.mkdir_all("/work/sub").unwrap();
    fs.symlink("sub", "/work/link").unwrap();
    fs.symlink("b", "/work/a").unwrap();
    fs.symlink("a", "/work/b").unwrap();
    for command in ["realpath -m", "readlink -m"] {
        let result = shell.exec(&format!("{command} a/tail a/../link/../link/tail")).unwrap();
        assert_eq!(result.stdout, "/work/a/tail\n/work/sub/tail\n", "{command}: {}", result.stderr);
        assert_eq!(result.exit_code, 0);
    }
    let result = shell.exec("realpath -s missing/sub").unwrap();
    assert_eq!(result.stdout, "/work/missing/sub\n");
    assert_eq!(result.exit_code, 0);
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

#[test]
fn xmllint_checks_cumulative_encoded_output_before_opening_the_next_document() {
    let (mut shell, fs) = new_pure_rust_shell(BTreeMap::new());
    fs.write_file("/a", b"<root>123456789012345</root>").unwrap();
    fs.write_file("/big", format!("<s>{}</s>", "a".repeat(300)).as_bytes()).unwrap();
    for (flags, bytes) in [("--format", 102), ("--encode UTF-16", 280), ("--c14n", 56), ("--xpath 'string(/root)'", 32)] {
        let script = format!("printf abc; xmllint {flags} /a /a /big");
        for (limit, error) in [(bytes + 2, "maxOutputBytes"), (bytes + 3, "maxInputBytes")] {
            shell.set_limits(safe_bash_rust::ShellLimits { max_output_bytes: limit, max_input_bytes: 65, ..Default::default() });
            let result = shell.exec(&script).unwrap_err();
            assert!(result.contains(error), "{script}: {result}");
        }
    }
    fs.write_file("/bad", b"<r>&bad;</r>").unwrap();
    fs.write_file("/dest", b"old").unwrap();
    shell.set_limits(safe_bash_rust::ShellLimits { max_output_bytes: 60, ..Default::default() });
    assert!(shell.exec("xmllint --recover -o /dest /bad").unwrap_err().contains("maxOutputBytes"));
    assert_eq!(fs.read_file("/dest").unwrap(), b"old");
}

#[test]
fn jq_opens_input_variable_and_program_files_in_path_traversal_order() {
    let (mut shell, fs) = new_pure_rust_shell(BTreeMap::new());
    fs.mkdir_all("/real/sub").unwrap();
    fs.symlink("/real/sub", "/link").unwrap();
    fs.write_file("/f", b"7").unwrap();
    fs.write_file("/real/f", b"8").unwrap();
    fs.write_file("/doc", b"<r/>").unwrap();
    for script in ["jq . /link/../f", "jq -n -f /link/../f", "jq --rawfile v /link/../f -nr '$v'",
        "jq --slurpfile v /link/../f -n '$v[0]'", "xq -f /link/../f /doc"] {
        let out = shell.exec(script).unwrap();
        assert_eq!((out.exit_code, out.stdout.as_str(), out.stderr.as_str()), (0, "8\n", ""), "{script}");
    }
    fs.mkdir_all("/locked").unwrap();
    fs.chmod("/locked", 0).unwrap();
    for (script, error) in [
        ("jq . /f///", "ENOTDIR: not a directory, readStream '/f///'"),
        ("jq -f /f/../f -n", "ENOTDIR: not a directory, readStream '/f/../f'"),
        ("jq --slurpfile v /missing/../f -n .", "ENOENT: no such file or directory, readStream '/missing/../f'"),
        ("jq --rawfile v '' -n .", "ENOENT: no such file or directory ''"),
        ("jq . /locked/f", "EACCES: permission denied, lstat '/locked/f'"),
        ("jq . /real", "EISDIR: illegal operation on a directory, readStream '/real'"),
    ] {
        let out = shell.exec(script).unwrap();
        assert_eq!((out.exit_code, out.stderr), (2, format!("jq: {error}\n")), "{script}");
    }
}

#[test]
fn jq_waits_for_a_newline_after_nul_before_publishing_json_values() {
    let (mut shell, fs) = new_pure_rust_shell(BTreeMap::new());
    fs.write_file("/a", b"1\0 2").unwrap();
    fs.write_file("/b", b"\n").unwrap();
    fs.write_file("/str", b"\"a\0b\"").unwrap();
    fs.write_file("/seq", b"\x1e1\n\x1e2\0ignored").unwrap();
    for (script, expected) in [
        ("jq -n 'first(inputs)' /a /absent", (2, "", "jq: ENOENT: no such file or directory, readStream '/absent'\n")),
        ("jq -c . /a", (0, "1\n", "")), ("jq -c . /a /b", (0, "1\n2\n", "")),
        ("jq 'error(.)' /a /b", (5, "", "jq: error (at /b:1): 1\njq: error (at /b:1): 2\n")),
        ("jq --stream-errors -c . /str", (0, "[\"Unfinished string at EOF at line 1, column 2\",[]]\n", "")),
        ("jq --seq -c . /seq", (0, "\x1e1\n", "jq: ignoring parse error: Potentially truncated top-level numeric value at EOF at line 2, column 2\n")),
        ("jq -R . /a", (0, "\"1\\u0000 2\"\n", "")),
    ] {
        let result = shell.exec(script).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), expected, "{script}");
    }
}

#[test]
fn jq_sequence_warnings_stop_input_at_the_shared_output_limit() {
    let (mut shell, fs) = new_pure_rust_shell(BTreeMap::new());
    fs.write_file("/bad", b"\x1e1\n\x1e!\n\x1e!\n").unwrap();
    fs.write_file("/end", b"\x1e2\n").unwrap();
    // Two 90-byte warnings follow the prefix "ab". Non-slurp mode has
    // already published the three bytes of the first JSON sequence result.
    for (filter, threshold) in [(".", 185), ("-n inputs", 185), ("-s .", 182)] {
        for limit in [threshold - 1, threshold] {
            fs.set_times("/end", Some(1.0), Some(1.0)).unwrap();
            shell.set_limits(safe_bash_rust::ShellLimits { max_output_bytes: limit, ..Default::default() });
            let script = format!("printf ab; jq --seq -c {filter} /bad /end");
            assert!(shell.exec(&script).unwrap_err().contains("maxOutputBytes"));
            assert_eq!(fs.stat("/end").unwrap().atime_ms != 1.0, limit == threshold, "{script}: {limit}");
        }
    }
}

#[test]
fn xq_enforces_the_output_budget_before_reading_another_document() {
    let (mut shell, fs) = new_pure_rust_shell(BTreeMap::new());
    fs.write_file("/doc", "<r>é</r>".as_bytes()).unwrap();
    fs.write_file("/big", format!("<r>{}</r>", "a".repeat(200)).as_bytes()).unwrap();
    for (filter, bytes) in [("-r .r", 3), ("-a .r", 9), ("-c .", 11), ("--raw-output0 .r", 3), ("-j .r", 2)] {
        let script = format!("printf abc; xq {filter} /doc /big");
        for (limit, expected) in [(bytes + 2, "maxOutputBytes"), (bytes + 3, "maxInputBytes")] {
            shell.set_limits(safe_bash_rust::ShellLimits { max_output_bytes: limit, max_input_bytes: 24, ..Default::default() });
            let error = shell.exec(&script).unwrap_err();
            assert!(error.contains(expected), "{script}: {error}");
        }
    }
}
