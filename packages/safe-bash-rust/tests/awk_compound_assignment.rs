use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn awk_compound_assignment_reads_the_updated_left_operand() {
    for (program, expected) in [
        (
            "BEGIN { print b += b += 1; b = 6; print b += b++; print b }",
            "2\n13\n13\n",
        ),
        (
            "BEGIN { i=0; a[0]=6; print a[i++]+=a[0]++,i,a[0]; n=1; $1=6; print $(n++)+=$1++,n,$1; d[\"seed\"]=0; print d[0]+=length(d) }",
            "13 1 13\n13 2 13\n1\n",
        ),
        (
            "BEGIN { b=6; print b-=(b=2); b=6; print b*=(b=2); b=6; print b/=(b=2); b=6; print b%=(b=2); b=6; print b^=(b=2) }",
            "0\n4\n1\n0\n4\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("awk '{program}'"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([
                        ("LC_ALL".into(), "C".into()),
                        ("TZ".into(), "UTC".into()),
                    ]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, expected, "{program}");
    }
}
