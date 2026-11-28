use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_unixepoch_interprets_seconds_before_applying_date_modifiers() {
    for (script, expected) in [
        (
            r#"sqlite3 :memory: 'SELECT date(86400,'"'"'unixepoch'"'"');'"#,
            "1970-01-02\n",
        ),
        (
            "sqlite3 :memory: \"SELECT date(0,'unixepoch'),date(-1,'unixepoch'),date('86400','UnIxEpOcH');\"",
            "1970-01-01|1969-12-31|1970-01-02\n",
        ),
        (
            "sqlite3 :memory: \"SELECT strftime('%Y-%m-%d %H:%M:%S',-0.1,'unixepoch'),strftime('%Y-%m-%d %H:%M:%S',951827696,'unixepoch'),date(86399.9999,'unixepoch');\"",
            "1969-12-31 23:59:59|2000-02-29 12:34:56|1970-01-02\n",
        ),
        (
            "sqlite3 :memory: \"SELECT date(86400,'unixepoch','+1 day'),date(86400,'unixepoch','start of month');\"",
            "1970-01-03|1970-01-01\n",
        ),
        (
            "sqlite3 :memory: \"SELECT date('unknown','unixepoch'),date(NULL,'unixepoch'),date('2026-01-01','unixepoch'),date(86400,'+1 day','unixepoch');\"",
            "|||\n",
        ),
        (
            "sqlite3 :memory: \"SELECT date(-210866760000,'unixepoch'),date(253402300799,'unixepoch'),date(-210866760001,'unixepoch'),date(253402300800,'unixepoch'),date(253402300799.9999,'unixepoch'),date(-62167219201,'unixepoch');\"",
            "-4713-11-24|9999-12-31||||-0001-12-31\n",
        ),
        (
            "sqlite3 :memory: \"SELECT date('NaN','unixepoch'),date('inf','unixepoch'),date('1e999','unixepoch'),date(0,'unixepoch','unixepoch');\"",
            "|||\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                script,
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
        assert_eq!(result.stdout, expected, "{script}");
        assert_eq!(result.stderr, "");
    }
}
