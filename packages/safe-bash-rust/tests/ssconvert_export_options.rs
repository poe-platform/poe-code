use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn csv_export_options_preserve_exact_filesystem_effects() {
    for (option, status, output, error) in [
        (
            "unknown=raw",
            1,
            "keep",
            "ssconvert: Invalid export option \"unknown\" for format Gnumeric_stf:stf_csv\n",
        ),
        ("format=raw", 0, "name,value\n\"a,b\",1.2\n", ""),
        ("\"format\" = \"raw\"", 0, "name,value\n\"a,b\",1.2\n", ""),
        (
            "format=\"raw\"unknown=raw",
            1,
            "keep",
            "ssconvert: Invalid export option \"unknown\" for format Gnumeric_stf:stf_csv\n",
        ),
        (
            "format=bogus",
            1,
            "keep",
            "ssconvert: Invalid value for option format: \"bogus\"\n",
        ),
        (
            "format=\"raw",
            1,
            "keep",
            "ssconvert: Quoted string not terminated\n",
        ),
        ("broken", 1, "keep", "ssconvert: Syntax error\n"),
    ] {
        let fs = Arc::new(MemoryVfs::new());
        let input = b"name,value\n\"a,b\",1.20\n";
        fs.write_file("/input.csv", input).unwrap();
        fs.write_file("/output.csv", b"keep").unwrap();
        let mut shell = Shell::new(
            fs.clone(),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let mut expected = fs.export_entries().unwrap();
        expected
            .iter_mut()
            .find(|entry| entry.path == "/output.csv")
            .unwrap()
            .data = output.as_bytes().into();
        let result = shell
            .exec(&format!(
                "ssconvert -T Gnumeric_stf:stf_csv -O '{option}' /input.csv /output.csv"
            ))
            .unwrap();
        assert_eq!(result.exit_code, status, "{option}: {}", result.stderr);
        assert_eq!(result.stdout, "", "{option}");
        assert_eq!(result.stderr, error, "{option}");
        assert_eq!(fs.read_file("/input.csv").unwrap(), input);
        assert_eq!(fs.read_file("/output.csv").unwrap(), output.as_bytes());
        assert_eq!(fs.export_entries().unwrap(), expected, "{option}");
    }
}

#[test]
fn invalid_csv_options_do_not_publish_single_split_or_merged_outputs() {
    for options in [
        "-O unknown=raw",
        "-Ounknown=raw",
        "--export-options=unknown=raw",
        "-O unknown=raw -O format=raw",
    ] {
        for operands in [
            "/input.csv /output.csv",
            "-S /input.csv /output.csv",
            "-M /output.csv /input.csv /input.csv",
        ] {
            let fs = Arc::new(MemoryVfs::new());
            fs.write_file("/input.csv", b"value\n1.20\n").unwrap();
            fs.write_file("/output.csv", b"keep").unwrap();
            let mut shell = Shell::new(
                fs.clone(),
                ShellOptions {
                    cwd: Some("/".into()),
                    mode: BackendMode::NativeOnly,
                    ..Default::default()
                },
            );
            let before = fs.export_entries().unwrap();
            let result = shell
                .exec(&format!("ssconvert {options} {operands}"))
                .unwrap();
            assert_eq!(result.exit_code, 1, "{options} {operands}");
            assert_eq!(result.stdout, "");
            assert_eq!(
                result.stderr,
                "ssconvert: Invalid export option \"unknown\" for format Gnumeric_stf:stf_csv\n"
            );
            assert_eq!(fs.export_entries().unwrap(), before, "{options} {operands}");
        }
    }
}
