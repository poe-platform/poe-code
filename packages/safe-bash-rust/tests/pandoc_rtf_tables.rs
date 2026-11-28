use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

fn convert(input: &str, query: &str) -> String {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    );
    let result = shell
        .exec_with_options(
            &format!("printf %s '{input}' | pandoc -f rtf -t json | jq -c '{query}'"),
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stderr, "");
    result.stdout
}

#[test]
fn rtf_table_survives_shell_conversion() {
    let input = r"{\rtf1\ansi \trowd\cellx1000\cellx2000\intbl A\cell B\cell\row\pard next}";
    assert_eq!(
        convert(input, r#"[..|objects|select(.t?=="Table")]|length"#),
        "1\n"
    );
    assert_eq!(
        convert(input, ".blocks | map(.t)"),
        "[\"Table\",\"Para\"]\n"
    );
    assert_eq!(
        convert(input, r#".blocks[1].c"#),
        "[{\"t\":\"Str\",\"c\":\"next\"}]\n"
    );
}

#[test]
fn rtf_cells_preserve_rows_empty_cells_and_paragraphs() {
    let input = r"{\rtf1 before\par\trowd\cellx1000\cellx2000\intbl {\b A}\par second\cell B\cell\row\trowd\cellx1000\cellx2000\intbl\cell D\cell\row\pard after\par\trowd\cellx1000\intbl E\cell\row}";
    assert_eq!(
        convert(input, ".blocks | map(.t)"),
        "[\"Para\",\"Table\",\"Para\",\"Table\"]\n"
    );
    assert_eq!(
        convert(
            input,
            r#".blocks[1].c[4][0][3] | map(.[1] | map(.[4] | [..|objects|select(.t?=="Str")|.c]))"#
        ),
        "[[[\"A\",\"second\"],[\"B\"]],[[],[\"D\"]]]\n"
    );
    assert_eq!(
        convert(
            input,
            r#".blocks[1] | [..|objects|select(.t?=="Strong")]|length"#
        ),
        "1\n"
    );
}
