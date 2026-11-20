use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellLimits, ShellOptions,
    commands::codecs::parse_zip_archive,
};
use std::sync::Arc;

fn shell() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    (
        Shell::new(
            Arc::new(fs.clone()),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        ),
        fs,
    )
}
fn run(shell: &mut Shell, source: &str, flags: &str) -> safe_bash_rust::ExecOutput {
    shell
        .exec_with_options(
            &format!("pandoc {flags}"),
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap()
}
fn text(value: &Value) -> String {
    let Value::String(value) = value else {
        panic!("expected string")
    };
    String::from_utf16(value).unwrap()
}
fn part(bytes: &[u8], name: &str) -> String {
    String::from_utf8(
        parse_zip_archive(bytes)
            .unwrap()
            .into_iter()
            .find(|p| p.name == name)
            .unwrap()
            .content,
    )
    .unwrap()
}

#[test]
fn frontmatter_matches_public_reader_types_profiles_and_fallbacks() {
    let Value::Array(fixtures) = json::parse(
        include_bytes!("fixtures/pandoc-metadata.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!()
    };
    let (mut sh, fs) = shell();
    for fixture in fixtures {
        let id = text(fixture.get("id").unwrap());
        fs.write_file("/saved", b"KEEP").unwrap();
        let result = run(
            &mut sh,
            &text(fixture.get("source").unwrap()),
            &format!(
                "-f {} -t json -o /saved",
                text(fixture.get("from").unwrap())
            ),
        );
        if let Some(error) = fixture.get("error") {
            assert_ne!(result.exit_code, 0, "{id}");
            assert!(
                result.stderr.contains(&text(error)),
                "{id}: {}",
                result.stderr
            );
            assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
        } else {
            assert_eq!(result.exit_code, 0, "{id}: {}", result.stderr);
            let output = json::parse(&fs.read_file("/saved").unwrap(), Default::default()).unwrap();
            assert_eq!(output.get("meta"), fixture.get("meta"), "{id} metadata");
            assert_eq!(output.get("blocks"), fixture.get("blocks"), "{id} body");
        }
        assert!(result.stdout.is_empty(), "{id}");
    }
}

#[test]
fn metadata_alias_boundary_falls_back_without_eating_document_content() {
    let (mut sh, _) = shell();
    for count in [31, 32] {
        let source = format!(
            "---\na: &a Text\nitems: [{}]\n---\n\nBody\n",
            vec!["*a"; count].join(", ")
        );
        let result = run(&mut sh, &source, "-f markdown -t json");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
        let Value::Object(meta) = document.get("meta").unwrap() else {
            panic!()
        };
        assert_eq!(meta.is_empty(), count == 32);
        if count == 32 {
            assert!(result.stdout.contains("&amp;a") || result.stdout.contains("&a"));
        }
    }
}

#[test]
fn metadata_binary_resources_and_cli_precedence_use_the_shared_writer() {
    let (mut sh, fs) = shell();
    fs.write_file(
        "/pixel.png",
        &terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap(),
    )
    .unwrap();
    let source = "---\ntitle: 'YAML TITLE ![TITLEIMAGE](pixel.png)'\nsubtitle: '<img src=\"pixel.png\" alt=\"SUBTITLEIMAGE\">'\nauthor: [Alice, Bob]\ncustom: '![unused](never-read.png)'\n---\n\nBODY\n";
    for format in ["docx", "pdf"] {
        let result = run(
            &mut sh,
            source,
            &format!("-f markdown -t {format} -o /output"),
        );
        assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if format == "docx" {
            let body = part(&bytes, "word/document.xml");
            assert!(body.find("YAML TITLE").unwrap() < body.find("BODY").unwrap());
            assert_eq!(body.matches("<w:drawing ").count(), 2);
            assert!(body.contains("Alice") && body.contains("Bob"));
        } else {
            assert!(String::from_utf8_lossy(&bytes).contains("/Subtype /Image"));
        }
        let missing = source.replace("pixel.png", "missing.png");
        fs.write_file("/saved", b"KEEP").unwrap();
        let result = run(
            &mut sh,
            &missing,
            &format!("-f markdown -t {format} -o /saved"),
        );
        assert_ne!(result.exit_code, 0);
        assert!(result.stdout.is_empty());
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
    let source = "---\ntitle: '![overridden](missing.png)'\nauthor: [Alice, Bob]\n---\n\nBODY\n";
    for format in ["json", "docx", "pdf"] {
        let result = run(
            &mut sh,
            source,
            &format!("-f markdown -t {format} -M title=OVERRIDE -o /output"),
        );
        assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if format == "json" {
            let document = json::parse(&bytes, Default::default()).unwrap();
            assert_eq!(
                text(
                    document
                        .get("meta")
                        .unwrap()
                        .get("title")
                        .unwrap()
                        .get("c")
                        .unwrap()
                ),
                "OVERRIDE"
            );
        } else if format == "docx" {
            assert!(part(&bytes, "docProps/core.xml").contains("OVERRIDE"));
        }
    }
}

#[test]
fn metadata_raw_policy_precedes_resource_discovery() {
    let (mut sh, fs) = shell();
    let source = "---\ntitle: '<img src=\"missing.png\">'\n---\n\nBODY\n";
    for format in ["docx", "pdf"] {
        let result = run(
            &mut sh,
            source,
            &format!("-f markdown -t {format} --raw-content=escape -o /output"),
        );
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        fs.write_file("/saved", b"KEEP").unwrap();
        let result = run(
            &mut sh,
            source,
            &format!("-f markdown -t {format} --raw-content=reject -o /saved"),
        );
        assert_ne!(result.exit_code, 0);
        assert!(
            result.stderr.contains("Raw content rejected"),
            "{}",
            result.stderr
        );
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}

#[test]
fn metadata_limits_preserve_existing_output() {
    for (source, limits) in [
        (
            format!("---\ntitle: {}\n---\n\nBody\n", "a".repeat(512)),
            ShellLimits {
                max_input_bytes: 256,
                ..Default::default()
            },
        ),
        (
            format!("---\ntitle: {}\n---\n\nBody\n", "a".repeat(512)),
            ShellLimits {
                max_parse_units: 256,
                ..Default::default()
            },
        ),
        (
            format!("---\ntitle: {}\n---\n\nBody\n", "a".repeat(512)),
            ShellLimits {
                max_memory_bytes: 1024,
                ..Default::default()
            },
        ),
        (
            format!(
                "---\ncustom: {}one{}\n---\n\nBody\n",
                "[".repeat(66),
                "]".repeat(66)
            ),
            ShellLimits::default(),
        ),
    ] {
        let (mut sh, fs) = shell();
        sh.set_limits(limits);
        fs.write_file("/saved", b"KEEP").unwrap();
        let result = run(&mut sh, &source, "-f markdown -t json -o /saved");
        assert_ne!(result.exit_code, 0);
        assert!(result.stdout.is_empty());
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}

#[test]
fn file_scope_metadata_merges_with_later_values_and_cli_overrides() {
    let (mut sh, fs) = shell();
    fs.write_file("/a.md", b"---\ntitle: First\nauthor: Alice\n---\n\nONE\n")
        .unwrap();
    fs.write_file("/b.md", b"---\ntitle: Second\n---\n\nTWO\n")
        .unwrap();
    for (flags, title) in [("", "Second"), ("-M title=Override", "Override")] {
        let result = sh
            .exec(&format!(
                "pandoc -f markdown -t json --file-scope /a.md /b.md {flags}"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
        let metadata = document.get("meta").unwrap();
        assert!(json::stringify(metadata.get("title").unwrap()).contains(title));
        assert!(json::stringify(metadata.get("author").unwrap()).contains("Alice"));
        let body = json::stringify(document.get("blocks").unwrap());
        assert!(body.find("ONE").unwrap() < body.find("TWO").unwrap());
    }
}

#[test]
fn metadata_expansion_obeys_node_limit_after_source_admission() {
    let (mut sh, fs) = shell();
    sh.set_limits(ShellLimits {
        max_parse_units: 256,
        ..Default::default()
    });
    let source = format!(
        "---\na: &a '**x**'\nitems: [{}]\n---\n\nBody\n",
        vec!["*a"; 31].join(",")
    );
    fs.write_file("/saved", b"KEEP").unwrap();
    let result = run(&mut sh, &source, "-f markdown -t json -o /saved");
    assert_ne!(result.exit_code, 0);
    assert!(
        result.stderr.contains("Metadata node limit"),
        "{}",
        result.stderr
    );
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn null_or_scalar_yaml_roots_remain_markdown() {
    let (mut sh, _) = shell();
    for header in ["  \n", "  # comment\n", "  null\n"] {
        let result = run(
            &mut sh,
            &format!("---\n{header}---\n\nBody\n"),
            "-f markdown -t json",
        );
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
        let Value::Object(meta) = document.get("meta").unwrap() else {
            panic!()
        };
        let Value::Array(blocks) = document.get("blocks").unwrap() else {
            panic!()
        };
        assert!(meta.is_empty());
        assert!(blocks.len() >= 3, "unrecognized YAML consumed: {header}");
        assert_eq!(text(blocks[0].get("t").unwrap()), "HorizontalRule");
    }
}

#[test]
fn native_metadata_spans_use_the_inline_depth_guard_before_serialization() {
    let (mut sh, fs) = shell();
    let source = format!(
        "---\ntitle: '{}deep{}'\n---\n\nBody\n",
        "<span>".repeat(65),
        "</span>".repeat(65)
    );
    fs.write_file("/saved", b"KEEP").unwrap();
    let result = run(&mut sh, &source, "-f markdown -t json -o /saved");
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("E_LIMIT"), "{}", result.stderr);
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    let result = run(&mut sh, &source, "-f markdown-native_spans -t json");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(result.stdout.contains("RawInline"));
}

#[test]
fn yaml_decoded_tabs_remain_literal_after_source_tab_expansion() {
    let (mut sh, _) = shell();
    for (source, expected) in [
        (
            r#"---
title: "a\tb"
---

Body
"#,
            r#"{"t":"MetaInlines","c":[{"t":"Str","c":"a\tb"}]}"#,
        ),
        (
            r#"---
title: "<span title=\"a\tb\">x</span>"
---

Body
"#,
            r#"{"t":"MetaInlines","c":[{"t":"Span","c":[["",[],[["title","a\tb"]]],[{"t":"Str","c":"x"}]]}]}"#,
        ),
    ] {
        let result = run(&mut sh, source, "-f markdown -t json");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
        assert_eq!(
            document.get("meta").unwrap().get("title"),
            Some(&json::parse(expected.as_bytes(), Default::default()).unwrap())
        );
    }
}
