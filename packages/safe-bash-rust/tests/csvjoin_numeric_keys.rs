use safe_bash_rust::{BackendMode, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn csvjoin_infers_leading_zero_keys_and_preserves_literal_mode() {
    for (options, expected) in [
        ("", "id,left,right\n1,one,matched\n"),
        ("--left", "id,left,right\n1,one,matched\n2,two,\n"),
        ("--right", "id,right,left\n1,matched,one\n3,other,\n"),
        (
            "--outer",
            "id,left,id2,right\n1,one,1,matched\n2,two,,\n,,3,other\n",
        ),
        ("-I", "id,left,right\n"),
        ("--no-inference", "id,left,right\n"),
        ("--no-leading-zeroes", "id,left,right\n"),
        ("-I --left", "id,left,right\n001,one,\n002,two,\n"),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec(&format!(
                "printf %s 'id,left\n001,one\n002,two\n' > a.csv\n\
                 printf %s 'id,right\n1,matched\n3,other\n' > b.csv\n\
                 csvjoin {options} -c id a.csv b.csv"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{options}: {result:?}");
        assert_eq!(result.stderr, "", "{options}");
        assert_eq!(result.stdout, expected, "{options}");
        assert!(!result.used_typescript_bridge, "{options}");
    }
}

#[test]
fn csvjoin_uses_exact_numbers_and_column_wide_inference() {
    for (options, left, right, expected) in [
        (
            "",
            "001,one\nx,two\n",
            "1,matched\nx,other\n",
            "x,two,other\n",
        ),
        ("", "1,one\nx,two\n", "1,matched\n3,other\n", ""),
        (
            "-I",
            "001,one\n002,two\n",
            "001,matched\n",
            "001,one,matched\n",
        ),
        (
            "",
            "09007199254740992,first\n09007199254740993,second\n",
            "9007199254740993,matched\n",
            "9007199254740993,second,matched\n",
        ),
        (
            "",
            "01.00000001,first\n01.00000002,second\n",
            "1.00000002,matched\n",
            "1.00000002,second,matched\n",
        ),
        (
            "",
            "001.00,first\n1e0,second\n",
            "1.0,matched\n",
            "1.00,first,matched\n1,second,matched\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec(&format!(
                "printf %s 'id,left\n{left}' > a.csv\n\
                 printf %s 'id,right\n{right}' > b.csv\n\
                 csvjoin {options} -c id a.csv b.csv"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{options}: {left}: {result:?}");
        assert_eq!(result.stderr, "", "{options}: {left}");
        assert_eq!(
            result.stdout,
            format!("id,left,right\n{expected}"),
            "{options}: {left}"
        );
        assert!(!result.used_typescript_bridge);
    }
}
