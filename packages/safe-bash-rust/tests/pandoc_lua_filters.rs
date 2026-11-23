use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn unsupported_lua_filters_fail_without_publishing() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-lua-filters.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!()
    };
    let text = |value: &Value| {
        let Value::String(value) = value else {
            panic!()
        };
        String::from_utf16(value).unwrap()
    };
    for case in cases {
        let fs = Arc::new(MemoryVfs::new());
        fs.write_file("/a.md", b"a").unwrap();
        fs.write_file("/upper.lua", text(case.get("script").unwrap()).as_bytes())
            .unwrap();
        fs.write_file("/saved", b"KEEP").unwrap();
        let mut shell = Shell::new(
            fs.clone(),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let control = shell.exec("pandoc -f markdown -t plain /a.md").unwrap();
        assert_eq!(control.exit_code, 0);
        assert_eq!(control.stdout, "a\n");
        let Value::Array(flags) = case.get("flags").unwrap() else {
            panic!()
        };
        let flags = flags.iter().map(text).collect::<Vec<_>>().join(" ");
        for output in ["", "-o /saved"] {
            let result = shell
                .exec(&format!(
                    "pandoc -f markdown -t plain /a.md {output} {flags}"
                ))
                .unwrap();
            assert_eq!(
                result.exit_code,
                3,
                "{}: {result:?}",
                text(case.get("id").unwrap())
            );
            assert_eq!(result.stdout, "");
            assert_eq!(
                result.stderr,
                "E_CAPABILITY: Lua filters are not supported by native Pandoc\n"
            );
            assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
        }
    }
}
