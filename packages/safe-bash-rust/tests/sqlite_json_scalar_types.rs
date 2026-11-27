use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::Arc;

#[test]
fn sqlite_json_extract_preserves_scalar_types() {
    for (sql, expected) in [
        (
            r#"SELECT typeof(json_extract('{"n":12}','$.n')),typeof(json_extract('{"n":"12"}','$.n'));"#,
            "integer|text\n",
        ),
        (
            r#"SELECT typeof(json_extract('{"n":"12.5"}','$.n')),typeof(json_extract('{"n":""}','$.n')),typeof(json_extract('{"n":12.5}','$.n')),typeof(json_extract('{"n":true}','$.n')),typeof(json_extract('{"n":false}','$.n')),typeof(json_extract('{"n":null}','$.n')),typeof(json_extract('{}','$.n'));"#,
            "text|text|real|integer|integer|null|null\n",
        ),
        (
            r#"SELECT typeof(json_extract('{"n":12.0}','$.n')),typeof(json_extract('{"n":1e2}','$.n')),typeof(json_extract('{"n":[]}','$.n')),typeof(json_extract('{"n":{}}','$.n')),typeof(json_extract('{"n":12}','$.n','$.n'));"#,
            "real|real|text|text|text\n",
        ),
        (
            r#"SELECT typeof((json_extract('{"n":"0012"}','$.n'))),typeof(json_extract('{"n":12}','$.n')+1),typeof(json_extract(NULL,'$.n'));"#,
            "text|integer|null\n",
        ),
        (
            r#"SELECT json_extract('{"s":"0012","n":12,"t":true,"f":false,"x":null}','$.s'),json_extract('{"n":12}','$.n'),json_extract('{"t":true}','$.t'),json_extract('{"f":false}','$.f'),json_extract('{"x":null}','$.x'),json_extract('{"n":12}','$.n','$.missing');"#,
            "0012|12|1|0||[12,null]\n",
        ),
        (
            r#"SELECT typeof(json_extract('["12",12]','$[#-1]')),typeof(json_extract('["12",12]','$[0]')),typeof(json_extract('[12]','$[#]')),typeof(json_extract('[12]','$[#-2]'));"#,
            "integer|text|null|null\n",
        ),
        (
            r#"CREATE TABLE docs(body TEXT); INSERT INTO docs VALUES('{"n":12}'),('{"n":"12"}'); SELECT typeof(json_extract(body,'$.n')),json_extract(body,'$.n') FROM docs;"#,
            "integer|12\ntext|12\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            },
        );
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{sql}");
        assert_eq!(result.stdout, expected, "{sql}");
    }
}
