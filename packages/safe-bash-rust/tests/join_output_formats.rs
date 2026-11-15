use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn shell() -> Shell {
    let fs = MemoryVfs::new();
    fs.write_file("/left", b"a one\n").unwrap();
    fs.write_file("/right", b"a two\n").unwrap();
    Shell::new(
        Arc::new(fs),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    )
}

#[test]
fn rejects_conflicting_output_formats_in_both_orders_and_spellings() {
    for options in [
        "-o auto -o 1.1",
        "-o 1.1 -o auto",
        "-oauto -o1.1",
        "-o1.1 -oauto",
        "-oauto -o 1.1",
        "-o1.1 -o auto",
        "-o auto -o1.1",
        "-o 1.1 -oauto",
    ] {
        let result = shell().exec(&format!("join {options} left right")).unwrap();
        assert_eq!(result.exit_code, 1, "{options}: {}", result.stderr);
        assert_eq!(result.stdout, "", "{options}");
        assert!(
            result
                .stderr
                .contains("conflicting output format specifications"),
            "{options}: {}",
            result.stderr
        );
    }
}

#[test]
fn preserves_automatic_explicit_and_repeated_output_formats() {
    for (options, expected) in [
        ("-o auto", "a one two\n"),
        ("-oauto -o auto", "a one two\n"),
        ("-o 2.2,1.2", "two one\n"),
        ("-o2.2 -o 1.2", "two one\n"),
    ] {
        let result = shell().exec(&format!("join {options} left right")).unwrap();
        assert_eq!(result.exit_code, 0, "{options}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{options}");
        assert_eq!(result.stderr, "", "{options}");
    }
}

#[test]
fn rejects_conflicting_formats_before_processing_operands_or_headers() {
    for options in ["-oauto -o1.1", "-o1.1 -oauto"] {
        for operands in [
            "",
            "missing-left missing-right",
            "- missing-right",
            "left right",
        ] {
            let result = shell()
                .exec(&format!("join --header {operands} {options}"))
                .unwrap();
            assert_eq!(
                result.exit_code, 1,
                "{operands} {options}: {}",
                result.stderr
            );
            assert_eq!(result.stdout, "", "{operands} {options}");
            assert!(
                result
                    .stderr
                    .contains("conflicting output format specifications"),
                "{operands} {options}: {}",
                result.stderr
            );
        }
    }
}
