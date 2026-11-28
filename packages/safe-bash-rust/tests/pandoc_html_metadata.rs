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
fn run(sh: &mut Shell, source: &str, args: &str) -> safe_bash_rust::ExecOutput {
    sh.exec_with_options(
        &format!("pandoc -f html {args}"),
        ExecOptions {
            stdin: Some(source.into()),
            ..Default::default()
        },
    )
    .unwrap()
}
fn text(value: &Value) -> String {
    let Value::String(value) = value else {
        panic!()
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
fn pdf_string(text: &str) -> String {
    format!(
        "<FEFF{}>",
        text.encode_utf16()
            .map(|u| format!("{u:04X}"))
            .collect::<String>()
    )
}

#[test]
fn html_coauthors_survive_shell_pipeline_in_source_order() {
    let (mut sh, _) = shell();
    let result = sh.exec_with_options(
        r#"LC_ALL=C TZ=UTC; printf %s '<html><head><meta name="author" content="Ada"><meta name="author" content="Grace"></head><body><p>Body</p></body></html>' | pandoc -f html -t json | jq -c .meta.author"#,
        ExecOptions::default(),
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(
        result.stdout,
        "{\"t\":\"MetaList\",\"c\":[{\"t\":\"MetaInlines\",\"c\":[{\"t\":\"Str\",\"c\":\"Ada\"}]},{\"t\":\"MetaInlines\",\"c\":[{\"t\":\"Str\",\"c\":\"Grace\"}]}]}\n"
    );
}

#[test]
fn html_coauthors_keep_duplicates_and_allow_cli_override() {
    let source = "<head><meta name=author content=Ada><title>Title</title><meta name=AUTHOR content=Grace><meta name=author content=Ada></head><p>Body</p>";
    let (mut sh, _) = shell();
    let result = run(&mut sh, source, "-t json");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    let expected = json::parse(br#"{"t":"MetaList","c":[{"t":"MetaInlines","c":[{"t":"Str","c":"Ada"}]},{"t":"MetaInlines","c":[{"t":"Str","c":"Grace"}]},{"t":"MetaInlines","c":[{"t":"Str","c":"Ada"}]}]}"#, Default::default()).unwrap();
    assert_eq!(document.get("meta").unwrap().get("author"), Some(&expected));
    let result = run(&mut sh, source, "-t json -M author=Override");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    let expected =
        json::parse(br#"{"t":"MetaString","c":"Override"}"#, Default::default()).unwrap();
    assert_eq!(document.get("meta").unwrap().get("author"), Some(&expected));
}

#[test]
fn html_base_resolves_links_through_shell_pipeline() {
    let (mut sh, _) = shell();
    let result = sh.exec_with_options(
        r#"printf %s '<html><head><base href="https://example.org/manual/"></head><body><a href="next">Next</a></body></html>' | pandoc -f html -t json | jq -c '[..|objects|select(.t?=="Link")|.c[2][0]]'"#,
        ExecOptions::default(),
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "[\"https://example.org/manual/next\"]\n");
}

#[test]
fn html_base_resolves_nested_links_and_images() {
    let (mut sh, _) = shell();
    for (target, expected) in [
        ("next", "https://example.org/manual/next"),
        ("../image.png", "https://example.org/image.png"),
        ("/root", "https://example.org/root"),
        (
            "//cdn.example.org/image.png",
            "https://cdn.example.org/image.png",
        ),
        ("#part", "https://example.org/manual/page.html?old=1#part"),
        ("?new=2", "https://example.org/manual/page.html?new=2"),
        ("", "https://example.org/manual/page.html?old=1"),
        ("https://other.org/next", "https://other.org/next"),
        ("tel:123", "tel:123"),
        (
            "../next?path=/../#part/..",
            "https://example.org/next?path=/../#part/..",
        ),
        ("nested//next", "https://example.org/manual/nested//next"),
        ("..", "https://example.org/"),
    ] {
        let source = format!(
            r#"<head><base href="https://example.org/manual/page.html?old=1"><base href="https://ignored.org/"></head><body><p><em><a href="{target}">Link</a></em><img src="{target}" alt="Image"></p></body>"#
        );
        let result = sh.exec_with_options(
            r#"pandoc -f html -t json | jq -c '[..|objects|select(.t?=="Link" or .t?=="Image")|.c[2][0]]'"#,
            ExecOptions { stdin: Some(source.clone()), ..Default::default() },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{target}: {}", result.stderr);
        assert_eq!(
            result.stdout,
            format!("[\"{expected}\",\"{expected}\"]\n"),
            "{target}"
        );
        let result = sh
            .exec_with_options(
                "htmlq -B -a href a",
                ExecOptions {
                    stdin: Some(source),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{target}: {}", result.stderr);
        assert_eq!(result.stdout, format!("{expected}\n"), "htmlq: {target}");
    }
}

#[test]
fn html_base_is_scoped_to_each_input_document() {
    let (mut sh, fs) = shell();
    fs.write_file(
        "/a.html",
        br#"<base href="https://example.org/manual/"><a href="next">Next</a>"#,
    )
    .unwrap();
    fs.write_file("/b.html", br#"<a href="next">Next</a>"#)
        .unwrap();
    let result = sh.exec(r#"pandoc -f html --file-scope /a.html /b.html -t json | jq -c '[..|objects|select(.t?=="Link")|.c[2][0]]'"#).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(
        result.stdout,
        "[\"https://example.org/manual/next\",\"next\"]\n"
    );
}

#[test]
fn html_base_reaches_binary_hyperlinks() {
    let (mut sh, fs) = shell();
    let result = run(
        &mut sh,
        r#"<base href="https://example.org/manual/"><p><a href="next">Next</a></p>"#,
        "-t docx -o /output",
    );
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(
        part(
            &fs.read_file("/output").unwrap(),
            "word/_rels/document.xml.rels"
        )
        .contains("https://example.org/manual/next")
    );
}

#[test]
fn html_base_expansion_respects_memory_limit() {
    let (mut sh, fs) = shell();
    sh.set_limits(ShellLimits {
        max_memory_bytes: 4096,
        ..Default::default()
    });
    fs.write_file("/saved", b"KEEP").unwrap();
    let source = format!(
        "<base href='https://example.org/{}/'>{}",
        "a".repeat(1000),
        "<a href='next'>Link</a>".repeat(8)
    );
    let result = run(&mut sh, &source, "-t json -o /saved");
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("E_LIMIT"), "{}", result.stderr);
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn authored_html_metadata_and_head_boundaries_match_public_reader() {
    let Value::Array(fixtures) = json::parse(
        include_bytes!("fixtures/pandoc-html-metadata.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!()
    };
    let (mut sh, _) = shell();
    for row in fixtures {
        let id = text(row.get("id").unwrap());
        let result = run(&mut sh, &text(row.get("source").unwrap()), "-t json");
        assert_eq!(result.exit_code, 0, "{id}: {}", result.stderr);
        let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
        assert_eq!(document.get("meta"), row.get("meta"), "{id} metadata");
        assert_eq!(document.get("blocks"), row.get("blocks"), "{id} body");
    }
}

#[test]
fn html_binary_title_and_author_use_metadata_mapper_without_losing_rich_body() {
    let (mut sh, fs) = shell();
    let source = "<html><head><title>Page title</title><meta name=author content='Page author'></head><body><table><tr><th>HEAD</th><td>CELL</td></tr></table><p>BODY</p></body></html>";
    for format in ["docx", "pdf"] {
        let result = run(&mut sh, source, &format!("-t {format} -o /output"));
        assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if format == "docx" {
            let body = part(&bytes, "word/document.xml");
            assert!(body.find("Page title").unwrap() < body.find("Page author").unwrap());
            assert!(body.find("Page author").unwrap() < body.find("HEAD").unwrap());
            assert!(body.contains("<w:tbl>") && body.contains("CELL") && body.contains("BODY"));
            assert_eq!(body.matches("Page title").count(), 1);
            assert!(part(&bytes, "docProps/core.xml").contains("Page title"));
        } else {
            let pdf = String::from_utf8_lossy(&bytes);
            assert!(pdf.contains(&format!("/Title {}", pdf_string("Page title"))));
            assert!(pdf.contains(&format!("/Author {}", pdf_string("Page author"))));
        }
    }
}

#[test]
fn literal_title_tags_never_gain_resource_or_raw_content_capabilities() {
    let (mut sh, fs) = shell();
    let source = "<title>Literal <img src='missing.png'> and <p>not body</p></title><meta name=author content='&lt;img src=missing-author.png&gt;'><p>BODY</p>";
    for format in ["docx", "pdf"] {
        let result = run(
            &mut sh,
            source,
            &format!("-t {format} --raw-content=reject -o /output"),
        );
        assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if format == "docx" {
            let body = part(&bytes, "word/document.xml");
            assert!(body.contains("missing.png") && body.contains("missing-author.png"));
            assert!(!body.contains("<w:drawing"));
            assert_eq!(body.matches("Literal").count(), 1);
            assert_eq!(body.matches("not body").count(), 1);
        } else {
            assert!(!String::from_utf8_lossy(&bytes).contains("/Subtype /Image"));
        }
    }
}

#[test]
fn html_metadata_cli_precedence_and_file_scope_are_preserved() {
    let (mut sh, fs) = shell();
    fs.write_file(
        "/a.html",
        b"<title>First</title><meta name=author content=Alice><p>ONE</p>",
    )
    .unwrap();
    fs.write_file("/b.html", b"<title>Second</title><p>TWO</p>")
        .unwrap();
    for format in ["json", "docx", "pdf"] {
        let result=sh.exec(&format!("pandoc -f html --file-scope /a.html /b.html -t {format} -M title=Override -M author=Bob -o /output")).unwrap();
        assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if format == "json" {
            let document = json::parse(&bytes, Default::default()).unwrap();
            let metadata = document.get("meta").unwrap();
            assert_eq!(
                text(metadata.get("title").unwrap().get("c").unwrap()),
                "Override"
            );
            assert_eq!(
                text(metadata.get("author").unwrap().get("c").unwrap()),
                "Bob"
            );
        } else if format == "docx" {
            let body = part(&bytes, "word/document.xml");
            for text in ["Override", "Bob", "ONE", "TWO"] {
                assert!(body.contains(text));
            }
            assert!(!body.contains("First") && !body.contains("Second") && !body.contains("Alice"));
        } else {
            let pdf = String::from_utf8_lossy(&bytes);
            assert!(pdf.contains(&format!("/Title {}", pdf_string("Override"))));
            assert!(pdf.contains(&format!("/Author {}", pdf_string("Bob"))));
        }
    }
}

#[test]
fn html_metadata_input_and_node_limits_preserve_output() {
    for (source, limits) in [
        (
            format!("<title>{}</title><p>BODY</p>", "a".repeat(1024)),
            ShellLimits {
                max_input_bytes: 512,
                ..Default::default()
            },
        ),
        (
            format!(
                "<head>{}</head><p>BODY</p>",
                "<meta name=author content=A>".repeat(64)
            ),
            ShellLimits {
                max_parse_units: 32,
                ..Default::default()
            },
        ),
    ] {
        let (mut sh, fs) = shell();
        sh.set_limits(limits);
        fs.write_file("/saved", b"KEEP").unwrap();
        let result = sh.exec_with_options(
            "pandoc -f html -t json -o /saved",
            ExecOptions {
                stdin: Some(source),
                ..Default::default()
            },
        );
        match result {
            Ok(output) => {
                assert_ne!(output.exit_code, 0);
                assert!(output.stdout.is_empty());
            }
            Err(message) => assert!(message.contains("limit exceeded"), "{message}"),
        }
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}

#[test]
fn html_json_reuses_typed_headings_and_rejects_unrepresented_tables() {
    let (mut sh, fs) = shell();
    let result = run(
        &mut sh,
        "<title>Title</title><h2 id='authored'>Hello <em>world</em></h2>",
        "-t json",
    );
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    let expected=json::parse(br#"[{"t":"Header","c":[2,["authored",[],[]],[{"t":"Str","c":"Hello"},{"t":"Space"},{"t":"Emph","c":[{"t":"Str","c":"world"}]}]]}]"#,Default::default()).unwrap();
    assert_eq!(document.get("blocks"), Some(&expected));
    fs.write_file("/saved", b"KEEP").unwrap();
    let result = run(
        &mut sh,
        "<table><tr><td>DATA</td></tr></table>",
        "-t json -o /saved",
    );
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("E_CAPABILITY"));
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}
