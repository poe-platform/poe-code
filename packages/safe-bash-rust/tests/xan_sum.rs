use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn xan_sum_rejects_nonnumeric_contributors() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "xan agg 'sum(n)' <<'INPUT'\nn\n2\nno\n4\nINPUT",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(result.stdout, "sum(n)\n");
    assert_eq!(
        result.stderr,
        "xan agg: <agg-expr> cannot safely cast Bytes(\"no\") from type \"bytes\" to type \"number\"\n"
    );
}

#[test]
fn xan_grouped_sum_rejects_invalid_values_without_emitting_totals() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "xan groupby category 'sum(n) as total'",
            ExecOptions {
                stdin: Some("category,n\na,3\nb,2\nb,no\nb,4\n".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(result.stdout, "category,total\n");
    assert_eq!(
        result.stderr,
        "xan groupby: <agg-expr> cannot safely cast Bytes(\"no\") from type \"bytes\" to type \"number\"\n"
    );
}

#[test]
fn xan_sum_keeps_numeric_and_empty_cell_behavior() {
    for (command, input, expected) in [
        ("xan agg 'sum(n)'", "n\n2\n4\n", "sum(n)\n6\n"),
        ("xan agg 'sum(n)'", "n\n2.5\n\"\"\n-1\n4\n", "sum(n)\n5.5\n"),
        (
            "xan groupby category 'sum(n) as total'",
            "category,n\na,2\na,\na,4\nb,-1.5\nb,2\n",
            "category,total\na,6\nb,0.5\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                command,
                ExecOptions {
                    stdin: Some(input.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected);
        assert_eq!(result.stderr, "");
    }
}
