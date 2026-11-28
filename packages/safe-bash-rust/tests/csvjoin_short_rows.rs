use safe_bash_rust::{BackendMode, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn csvjoin_pads_short_rows_before_combining_columns() {
    for (command, expected) in [
        (
            "csvjoin -I -c id a.csv b.csv",
            "id,kind,note,charge,receipt\nA,blue,,15,\n",
        ),
        (
            "csvjoin -I --left -c id a.csv b.csv",
            "id,kind,note,charge,receipt\nA,blue,,15,\nB,green,,,\n",
        ),
        (
            "csvjoin -I --right -c id a.csv b.csv",
            "id,charge,receipt,kind,note\nA,15,,blue,\nC,20,,,\n",
        ),
        (
            "csvjoin -I --outer -c id a.csv b.csv",
            "id,kind,note,id2,charge,receipt\nA,blue,,A,15,\nB,green,,,,\n,,,C,20,\n",
        ),
        (
            "csvjoin -I a.csv b.csv",
            "id,kind,note,id2,charge,receipt\nA,blue,,A,15,\nB,green,,C,20,\n",
        ),
        (
            "csvjoin -I -l -c id a.csv b.csv c.csv",
            "line_number,id,kind,note,charge,receipt,status\n1,A,blue,,15,,paid\n",
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
                "printf %s 'id,kind,note\nA,blue\nB,green\n' > a.csv\n\
                 printf %s 'id,charge,receipt\nA,15\nC,20\n' > b.csv\n\
                 printf %s 'id,status\nA,paid\n' > c.csv\n{command}"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {result:?}");
        assert_eq!(result.stderr, "", "{command}");
        assert_eq!(result.stdout, expected, "{command}");
        assert!(!result.used_typescript_bridge, "{command}");
    }
}

#[test]
fn csvjoin_pads_headerless_rows_to_the_first_record_width() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec(
            "printf %s 'A,blue,memo\nB,green\n' > a.csv\n\
             printf %s 'A,15\nB,20\n' > b.csv\n\
             csvjoin -I -H -c 1 a.csv b.csv",
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "a,b,c,b2\nA,blue,memo,15\nB,green,,20\n");
    assert!(!result.used_typescript_bridge);
}
