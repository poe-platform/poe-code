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
            &format!("printf %s '{input}' | pandoc -f latex -t json | jq -c '{query}'"),
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stderr, "");
    result.stdout
}

#[test]
fn latex_tabular_retains_each_cell() {
    let input = "\\begin{tabular}{ll}A & B \\\\ C & D\\end{tabular}\n";
    assert_eq!(
        convert(
            input,
            r#"[..|objects|select(.t?=="Table")|[..|objects|select(.t?=="Str")|.c]]"#
        ),
        "[[\"A\",\"B\",\"C\",\"D\"]]\n"
    );
    assert_eq!(
        convert(
            input,
            r#".blocks[0].c[4][0][3] | map(.[1] | map(.[4] | [..|objects|select(.t?=="Str")|.c]))"#
        ),
        "[[[\"A\"],[\"B\"]],[[\"C\"],[\"D\"]]]\n"
    );
}

#[test]
fn latex_tabular_preserves_empty_cells_formatting_and_surrounding_blocks() {
    let input =
        "before\n\\begin{tabular}{lr}\n\\textbf{A} & B \\\\\n & D \\\\\n\\end{tabular}\nafter";
    assert_eq!(
        convert(input, ".blocks | map(.t)"),
        "[\"Para\",\"Table\",\"Para\"]\n"
    );
    assert_eq!(
        convert(
            input,
            r#".blocks[1].c[4][0][3] | map(.[1] | map(.[4] | [..|objects|select(.t?=="Str")|.c]))"#
        ),
        "[[[\"A\"],[\"B\"]],[[],[\"D\"]]]\n"
    );
    assert_eq!(
        convert(input, r#"[..|objects|select(.t?=="Strong")]|length"#),
        "1\n"
    );
    assert_eq!(
        convert(input, ".blocks[1].c[2] | map(.[0].t)"),
        "[\"AlignLeft\",\"AlignRight\"]\n"
    );
}

#[test]
fn latex_tabular_does_not_split_escaped_or_grouped_ampersands() {
    let input = r"\begin{tabular}{ll}A \& B & \textbf{C & D}\end{tabular}";
    assert_eq!(
        convert(
            input,
            r#".blocks[0].c[4][0][3] | map(.[1] | map(.[4] | [..|objects|select(.t?=="Str")|.c]))"#
        ),
        "[[[\"A\",\"&\",\"B\"],[\"C\",\"&\",\"D\"]]]\n"
    );
}
