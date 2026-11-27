use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn awk_paragraph_fields_split_at_embedded_newlines() {
    for (program, input, expected) in [
        (
            r#"BEGIN{RS="";FS=":"} {print NF,$2,$3}"#,
            "a:b\nc:d\n\ne:f\n",
            "4 b c\n2 f \n",
        ),
        (
            r#"BEGIN{RS="";FS=":";OFS="|"} {print NF,$1,$2,$3,$4,$5,$6}"#,
            ":a:\n:b:\n",
            "6||a|||b|\n",
        ),
        (
            r#"BEGIN{RS="";FS="."} {print NF,$2,$3}"#,
            "a.b\nc.d\n",
            "4 b c\n",
        ),
        (
            r#"BEGIN{RS="";FS=":";getline;print NF,$2,$3}"#,
            "a:b\nc:d\n",
            "4 b c\n",
        ),
        (
            r#"BEGIN{RS="";FS=":";$0="a:b\nc:d";print NF,$2,$3}"#,
            "",
            "4 b c\n",
        ),
        (
            r#"BEGIN{RS="";FS=":"} {$2="B";print $0}"#,
            "a:b\nc:d\n",
            "a B c d\n",
        ),
        (
            r#"BEGIN{FS=":";$0="a:b\nc:d";print NF,$2,$3}"#,
            "",
            "3 b\nc d\n",
        ),
        (
            r#"BEGIN{RS="";FS="[:]"} {print NF,$2,$3}"#,
            "a:b\nc:d\n",
            "3 b\nc d\n",
        ),
        (
            r#"BEGIN{RS="";FS=""} {print NF,$4}"#,
            "a:b\nc:d\n",
            "7 \n\n",
        ),
        (
            r#"BEGIN{RS="";FS=" "} {print NF,$2,$3}"#,
            " a b\nc d \n",
            "4 b c\n",
        ),
        (
            r#"BEGIN{RS="";FS="\n"} {print NF,$1,$2}"#,
            "a:b\nc:d\n",
            "2 a:b c:d\n",
        ),
        (
            r#"BEGIN{RS="";FS=":"} {print split($0,a),a[2],a[3]}"#,
            "a:b\nc:d\n",
            "3 b\nc d\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell
            .exec_with_options(
                &format!("awk '{program}' <<'INPUT'\n{input}INPUT\n"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{program}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{program}");
        assert_eq!(result.stderr, "", "{program}");
        assert!(!result.used_typescript_bridge);
    }
}
