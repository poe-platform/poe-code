#[path = "../../lua-rust/tests/source_names.rs"]
mod lua_source_names;
#[path = "../../lua-rust/tests/table_frames.rs"]
mod lua_table_frames;
#[path = "../../lua-rust/tests/errors.rs"]
mod lua_errors;
#[path = "../../lua-rust/tests/base.rs"]
mod lua_base;
#[path = "../../lua-rust/tests/iteration.rs"]
mod lua_iteration;
#[path = "../../lua-rust/tests/lengths.rs"]
mod lua_lengths;
#[path = "../../lua-rust/tests/tables.rs"]
mod lua_tables;
#[path = "../../lua-rust/tests/table_remove.rs"]
mod lua_table_remove;
#[path = "../../lua-rust/tests/varargs.rs"]
mod lua_varargs;
#[path = "../../lua-rust/tests/jumps.rs"]
mod lua_jumps;
#[path = "../../lua-rust/tests/environments.rs"]
mod lua_environments;
#[path = "../../lua-rust/tests/math.rs"]
mod lua_math;
#[path = "../../lua-rust/tests/packing.rs"]
mod lua_packing;
#[path = "../../lua-rust/tests/bytes.rs"]
mod lua_bytes;
#[path = "../../lua-rust/tests/evaluation.rs"]
mod lua_evaluation;
#[path = "../../lua-rust/tests/patterns.rs"]
mod lua_patterns;
#[path = "../../lua-rust/tests/numbers.rs"]
mod lua_numbers;
#[path = "../../lua-rust/tests/format.rs"]
mod lua_format;
#[path = "../../lua-rust/tests/metatables.rs"]
mod lua_metatables;
#[path = "../../lua-rust/tests/interning.rs"]
mod lua_interning;

use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn invalid_utf8_document_values_match_javascript_output_errors() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/a.md", b"a").unwrap();
    let mut shell = Shell::new(
        fs.clone(),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for source in [
        "function Str(el) return pandoc.Str(string.char(255)) end",
        "function Meta(m) m[string.char(255)]=pandoc.MetaString('value'); return m end",
    ] {
        fs.write_file("/filter.lua", source.as_bytes()).unwrap();
        for (output, status, error) in [
            ("", 4, "E_AST: Invalid UTF-8 Lua string\n"),
            ("-o -", 4, "E_AST: Invalid UTF-8 Lua string\n"),
            ("-o /saved", 9, "E_IO: Capability failed\n"),
        ] {
            fs.write_file("/saved", b"KEEP").unwrap();
            let result = shell
                .exec(&format!(
                    "pandoc -f markdown -t plain /a.md -L /filter.lua {output}"
                ))
                .unwrap();
            assert_eq!(result.exit_code, status, "{source}: {result:?}");
            assert_eq!(result.stderr, error);
            assert!(result.stdout.is_empty());
            assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
        }
    }
}

#[test]
fn lua_filters_match_javascript() {
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
        let path = case.get("path").map(text).unwrap_or_else(|| "/upper.lua".into());
        let cwd = case.get("cwd").map(text).unwrap_or_else(|| "/".into());
        let (parent, _) = path.rsplit_once('/').unwrap();
        fs.mkdir_all(if parent.is_empty() { "/" } else { parent })
            .unwrap();
        fs.mkdir_all(&cwd).unwrap();
        fs.write_file("/a.md", b"a").unwrap();
        let script = match case.get("script").unwrap() {
            Value::Array(bytes) => bytes
                .iter()
                .map(|value| match value {
                    Value::Number(n) => *n as u8,
                    _ => panic!("script byte expected"),
                })
                .collect(),
            value => text(value).into_bytes(),
        };
        fs.write_file(&path, &script).unwrap();
        fs.write_file("/saved", b"KEEP").unwrap();
        let mut shell = Shell::new(
            fs.clone(),
            ShellOptions {
                cwd: Some(cwd),
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
        let flags = flags
            .iter()
            .map(|value| format!("'{}'", text(value).replace('\'', "'\\''")))
            .collect::<Vec<_>>()
            .join(" ");
        for output in ["", "-o /saved"] {
            let result = shell
                .exec(&format!(
                    "pandoc -f markdown -t plain /a.md {output} {flags}"
                ))
                .unwrap();
            let expected = case.get("stdout").map(text).unwrap_or_else(|| "A\n".into());
            let status = match case.get("status").unwrap() {
                Value::Number(n) => *n as i32,
                _ => panic!(),
            };
            assert_eq!(
                result.exit_code,
                status,
                "{}: {result:?}",
                text(case.get("id").unwrap())
            );
            assert_eq!(
                result.stdout,
                if status == 0 && output.is_empty() {
                    &expected
                } else {
                    ""
                }
            );
            assert_eq!(
                result.stderr,
                case.get("stderr").map(text).unwrap_or_default()
            );
            assert_eq!(
                fs.read_file("/saved").unwrap(),
                if status == 0 && !output.is_empty() {
                    expected.as_bytes()
                } else {
                    b"KEEP".as_slice()
                }
            );
        }
    }
}

#[test]
fn filters_reach_text_and_binary_writers() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/a.md", b"hello").unwrap();
    fs.write_file(
        "/filter.lua",
        b"function Str(el) return pandoc.Str(el.text:upper()) end",
    )
    .unwrap();
    let mut shell = Shell::new(
        fs.clone(),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for format in ["plain", "html", "markdown", "json", "docx", "pdf"] {
        let result = shell
            .exec(&format!(
                "pandoc /a.md -t {format} -L /filter.lua -o /result.{format}"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{format}: {result:?}");
        let bytes = fs.read_file(&format!("/result.{format}")).unwrap();
        if matches!(format, "docx" | "pdf") {
            let command = if format == "pdf" {
                "pdftotext /result.pdf -"
            } else {
                "pandoc /result.docx -t plain"
            };
            let result = shell.exec(command).unwrap();
            assert_eq!(result.exit_code, 0, "{format}: {result:?}");
            assert!(result.stdout.contains("HELLO"), "{format}: {result:?}");
        } else {
            assert!(
                String::from_utf8(bytes).unwrap().contains("HELLO"),
                "{format}"
            );
        }
    }
}

#[test]
fn filters_receive_and_update_json_metadata() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/a.json", br#"{"pandoc-api-version":[1,23,1,2],"meta":{"title":{"t":"MetaString","c":"Before"}},"blocks":[{"t":"Para","c":[{"t":"Str","c":"a"}]}]}"#).unwrap();
    fs.write_file("/filter.lua", b"function Meta(meta) assert(meta.title=='Before'); meta.title='After'; meta.empty=pandoc.MetaMap({}); return meta end").unwrap();
    let mut shell = Shell::new(
        fs,
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell.exec("pandoc /a.json -t json -L /filter.lua").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    let pdf = shell
        .exec("pandoc /a.json -t pdf -M title=Before -L /filter.lua -o /filtered.pdf")
        .unwrap();
    assert_eq!(pdf.exit_code, 0, "{pdf:?}");
    let info = shell.exec("pdfinfo /filtered.pdf").unwrap();
    assert!(
        info.stdout
            .lines()
            .any(|line| line.starts_with("Title:") && line.ends_with("After")),
        "{info:?}"
    );
    let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    assert_eq!(
        document.get("meta").unwrap().get("title").unwrap().get("c"),
        Some(&Value::String("After".encode_utf16().collect()))
    );
    assert_eq!(
        document.get("meta").unwrap().get("empty").unwrap().get("c"),
        Some(&Value::Object(Vec::new()))
    );
}
