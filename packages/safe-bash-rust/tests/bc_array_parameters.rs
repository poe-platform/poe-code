use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_array_parameters_are_local_copies() {
    for (program, expected) in [
        (
            "define f(a[]){a[0]=8;return a[0];}\na[0]=3; f(a[]); a[0]",
            "8\n3\n",
        ),
        (
            "define f(b[]){b[0]+=5;b[7]=9;return b[0]+b[2];}\na[0]=3;a[2]=4;b[0]=6;f(a[]);a[0];a[7];b[0];b[7]",
            "12\n3\n0\n6\n0\n",
        ),
        (
            "define f(a[],b[]){a[0]+=1;return b[0];}\na[0]=3;b[0]=7;f(b[],a[]);a[0];b[0]",
            "3\n3\n7\n",
        ),
        (
            "define g(a[]){a[0]+=5;return a[0];}\ndefine f(a[]){auto x;x=g(a[]);return x+a[0];}\na[0]=3;f(a[]);a[0]",
            "11\n3\n",
        ),
        (
            "define f(a[]){a+=1;a[0]+=5;return a[0];}\na=10;a[0]=3;f(a[]);a;a[0]",
            "8\n11\n3\n",
        ),
        (
            "define f(a){a[0]+=5;return a;}\na=10;a[0]=3;f(2);a;a[0]",
            "2\n10\n8\n",
        ),
        (
            "define f(a[]){auto b[];b[0]=a[0]+1;return b[0];}\nb[0]=9;f(c[]);b[0];c[0]",
            "1\n9\n0\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("bc <<'INPUT'\n{program}\nINPUT\n"),
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
        assert_eq!(result.exit_code, 0, "{program}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{program}");
        assert_eq!(result.stdout, expected, "{program}");
    }
}
