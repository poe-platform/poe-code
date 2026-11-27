use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::{collections::BTreeMap, sync::Arc};

#[test]
fn xpath_boolean_operands_short_circuit() {
    for (predicate, expected) in [
        ("false() and count(\"bad\")", Ok("0\n")),
        ("true() or count(\"bad\")", Ok("2\n")),
        ("true() and count(\"bad\")", Err(())),
        ("false() or count(\"bad\")", Err(())),
        ("count(\"bad\") and false()", Err(())),
        ("count(\"bad\") or true()", Err(())),
        ("false() and count(\"bad\") or true()", Ok("2\n")),
        ("true() or false() and count(\"bad\")", Ok("2\n")),
        ("true() and (true() or count(\"bad\"))", Ok("2\n")),
        ("not(false() and count(\"bad\"))", Ok("2\n")),
        ("@id=\"a\" or false()", Ok("1\n")),
        ("1 or count(\"bad\")", Ok("2\n")),
        ("0 and count(\"bad\")", Ok("0\n")),
        ("true() or n[count(\"bad\")]", Ok("2\n")),
        ("false() and n[count(\"bad\")]", Ok("0\n")),
        (
            "concat(true() or count(\"bad\"), \"!\")=\"true!\"",
            Ok("2\n"),
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell.exec_with_options(
            &format!("printf %s '<r><g id=\"a\"><n>1</n><n>2</n></g><g id=\"b\"><n>3</n><n>4</n></g></r>' | xmllint --xpath 'count(//g[{predicate}])' -"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        let (status, stdout, stderr) = match expected {
            Ok(stdout) => (0, stdout, ""),
            Err(()) => (10, "", "xmllint: XPath function requires a node-set\n"),
        };
        assert_eq!(
            (
                result.exit_code,
                result.stdout.as_str(),
                result.stderr.as_str()
            ),
            (status, stdout, stderr),
            "{predicate}"
        );
    }
}
