use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn yq_toml_integer_literals_through_shell() {
    for (input, expected) in [
        (
            "perm=0o755\nmask=0xFF\ncount=1_000\n",
            "{\"perm\":493,\"mask\":255,\"count\":1000}\n",
        ),
        (
            "values=[0b1010_0101,0o7_55,0xDE_AD,+1_000,-1_000,0]\n",
            "{\"values\":[165,493,57005,1000,-1000,0]}\n",
        ),
        (
            "value={count=1_234,mask=0xff}\ntext=\"0xFF\"\nliteral='1_000'\n",
            "{\"value\":{\"count\":1234,\"mask\":255},\"text\":\"0xFF\",\"literal\":\"1_000\"}\n",
        ),
        (
            "max=0x7fff_ffff_ffff_ffff\nmin=-9_223_372_036_854_775_808\n",
            "{\"max\":9223372036854775807,\"min\":-9223372036854775808}\n",
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
        let quoted = input.replace('\'', "'\\''");
        let result = shell
            .exec_with_options(
                &format!("printf %s '{quoted}' | yq -I 0 -p=toml -o=json ."),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}
