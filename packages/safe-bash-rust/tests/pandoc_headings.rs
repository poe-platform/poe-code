use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
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
fn run(
    sh: &mut Shell,
    source: &str,
    format: &str,
    target: &str,
    flags: &str,
) -> safe_bash_rust::ExecOutput {
    sh.exec_with_options(
        &format!("pandoc -f {format} -t {target} {flags}"),
        ExecOptions {
            stdin: Some(source.into()),
            ..Default::default()
        },
    )
    .unwrap()
}
fn headers(source: &str, format: &str) -> Vec<Value> {
    let (mut sh, _) = shell();
    let result = run(&mut sh, source, format, "json", "");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let document = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    let Value::Array(blocks) = document.get("blocks").unwrap() else {
        panic!()
    };
    blocks
        .iter()
        .filter_map(|block| {
            if block.get("t") != Some(&Value::String("Header".encode_utf16().collect())) {
                return None;
            }
            let Value::Array(content) = block.get("c").unwrap() else {
                panic!()
            };
            Some(content[1].clone())
        })
        .collect()
}
fn attrs(expected: &str) -> Vec<Value> {
    let Value::Array(values) = json::parse(expected.as_bytes(), Default::default()).unwrap() else {
        panic!()
    };
    values
}

#[test]
fn unicode_identifiers_match_profile_categories_and_inline_text() {
    let source =
        "# Café Ω 中文\n\n# 33. *Hello*, [World](/url) `A_B.C`!\n\n# 123 !!!\n\n# A\u{301} Ⅷ ²\n";
    assert_eq!(
        headers(source, "markdown"),
        attrs(
            r#"[["café-ω-中文",[],[]],["hello-world-a_b.c",[],[]],["section",[],[]],["a-ⅷ-²",[],[]]]"#
        )
    );
    assert_eq!(
        headers(source, "gfm"),
        attrs(
            "[[\"café-ω-中文\",[],[]],[\"33-hello-world-a_bc\",[],[]],[\"123-\",[],[]],[\"a\u{301}-ⅷ-²\",[],[]]]"
        )
    );
}
#[test]
fn identifiers_are_unique_under_markdown_and_counted_per_gfm_base() {
    let source = [
        "Report", "Report", "Report-1", "Report", "Report-1", "!!!", "!!!",
    ]
    .map(|title| format!("# {title}\n\n"))
    .concat();
    assert_eq!(
        headers(&source, "markdown"),
        attrs(
            r#"[["report",[],[]],["report-1",[],[]],["report-1-1",[],[]],["report-2",[],[]],["report-1-2",[],[]],["section",[],[]],["section-1",[],[]]]"#
        )
    );
    assert_eq!(
        headers(&source, "gfm"),
        attrs(
            r#"[["report",[],[]],["report-1",[],[]],["report-1",[],[]],["report-2",[],[]],["report-1-1",[],[]],["",[],[]],["-1",[],[]]]"#
        )
    );
}
#[test]
fn profile_gates_disable_automatic_identifiers_and_leave_attributes_literal() {
    for profile in [
        "commonmark",
        "markdown-auto_identifiers",
        "gfm-gfm_auto_identifiers",
    ] {
        assert_eq!(
            headers("# Hello\n\nHello\n=====\n", profile),
            attrs(r#"[["",[],[]],["",[],[]]]"#),
            "{profile}"
        );
    }
    assert_eq!(
        headers("# Heading {#custom .loud}\n", "gfm"),
        attrs(r#"[["heading-custom-loud",[],[]]]"#)
    );
    assert_eq!(
        headers("# Heading {#custom .loud}\n", "markdown-header_attributes"),
        attrs(r#"[["heading-custom-.loud",[],[]]]"#)
    );
}
#[test]
fn authored_heading_attributes_are_consumed_and_survive_json_and_html() {
    for profile in [
        "markdown",
        "md",
        "gfm+header_attributes",
        "markdown-auto_identifiers",
    ] {
        for source in [
            "# Heading {#custom .loud .extra title=\"a { b\"}\n",
            "Heading {#custom .loud .extra title=\"a { b\"}\n=======\n",
        ] {
            assert_eq!(
                headers(source, profile),
                attrs(r#"[["custom",["loud","extra"],[["title","a { b"]]]]"#)
            );
        }
    }
    let (mut sh, _) = shell();
    let result = run(
        &mut sh,
        "# Heading {#custom .loud}\n",
        "markdown",
        "html",
        "",
    );
    assert_eq!(result.exit_code, 0);
    assert_eq!(
        result.stdout,
        "<h1 id=\"custom\" class=\"loud\">Heading</h1>\n"
    );
}
#[test]
fn malformed_escaped_and_code_attributes_remain_literal() {
    for source in [
        "# Heading {invalid}",
        "# Heading {#custom",
        r"# Heading \{#custom}",
        "# Heading `{#custom}`",
    ] {
        assert_eq!(
            headers(source, "markdown-auto_identifiers"),
            attrs(r#"[["",[],[]]]"#)
        );
        let (mut sh, _) = shell();
        let result = run(&mut sh, source, "markdown-auto_identifiers", "plain", "");
        assert!(result.stdout.contains('{'), "{source}: {}", result.stdout);
    }
}
#[test]
fn closing_hashes_and_empty_atx_headings_have_no_visible_marker_text() {
    let (mut sh, _) = shell();
    let result = run(
        &mut sh,
        "### ###\n\n## text ##\n\n## text##\n\n## text \\##\n",
        "commonmark",
        "json",
        "",
    );
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let actual = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    let expected = json::parse(br###"[{"t":"Header","c":[3,["",[],[]],[]]},{"t":"Header","c":[2,["",[],[]],[{"t":"Str","c":"text"}]]},{"t":"Header","c":[2,["",[],[]],[{"t":"Str","c":"text##"}]]},{"t":"Header","c":[2,["",[],[]],[{"t":"Str","c":"text"},{"t":"Space"},{"t":"Str","c":"##"}]]}]"###, Default::default()).unwrap();
    assert_eq!(actual.get("blocks"), Some(&expected));
}
#[test]
fn unicode_and_authored_heading_links_survive_both_binary_writers() {
    let (mut sh, fs) = shell();
    let source = "# Café Ω 中文\n\n# Named {#authored .wide}\n\n[UNICODE](#café-ω-中文) [NAMED](#authored)\n";
    for format in ["docx", "pdf"] {
        // PDF intentionally rejects scripts requiring shaping; Latin/Greek still
        // exercise multibyte heading IDs and percent-encoded link resolution.
        let source = if format == "pdf" {
            source.replace(" 中文", "").replace("-中文", "")
        } else {
            source.into()
        };
        let result = run(&mut sh, &source, "markdown", format, "-o /output");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        let serialized = String::from_utf8_lossy(&bytes);
        if format == "docx" {
            assert!(serialized.contains("w:name=\"café-ω-中文\""));
            assert!(serialized.contains("w:anchor=\"authored\""));
            assert!(!serialized.contains("{#authored"));
        } else {
            assert_eq!(serialized.matches("/Subtype /Link").count(), 2);
            assert!(
                serialized
                    .split("endobj")
                    .filter(|object| object.contains("/Subtype /Link"))
                    .all(|object| object.contains("/Dest ["))
            );
        }
    }
}

#[test]
fn html_attributes_keep_passive_values_and_reject_unsupported_properties() {
    let (mut sh, fs) = shell();
    let result = run(
        &mut sh,
        "# Heading {#custom .wide title=\"a & b\" data-kind=sample dir=rtl}\n",
        "markdown",
        "html",
        "",
    );
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(
        result.stdout,
        "<h1 id=\"custom\" class=\"wide\" title=\"a &amp; b\" data-kind=\"sample\" dir=\"rtl\">Heading</h1>\n"
    );
    for attributes in [
        "onclick=alert(1)",
        "id=duplicate",
        "title=one title=two",
        "style=color:red",
        "dir=invalid",
    ] {
        fs.write_file("/saved", b"KEEP").unwrap();
        let result = run(
            &mut sh,
            &format!("# Heading {{{attributes}}}\n"),
            "markdown",
            "html",
            "-o /saved",
        );
        assert_ne!(result.exit_code, 0, "accepted {attributes}");
        assert!(result.stderr.contains("E_CAPABILITY"), "{}", result.stderr);
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}

#[test]
fn heading_extension_admission_matches_supported_profiles() {
    let (mut sh, fs) = shell();
    for profile in [
        "commonmark+auto_identifiers",
        "commonmark-auto_identifiers",
        "commonmark+header_attributes",
        "commonmark-header_attributes",
        "commonmark+gfm_auto_identifiers",
        "markdown+gfm_auto_identifiers",
        "markdown-gfm_auto_identifiers",
    ] {
        fs.write_file("/saved", b"KEEP").unwrap();
        let result = run(&mut sh, "# Heading\n", profile, "json", "-o /saved");
        assert_ne!(result.exit_code, 0, "accepted {profile}");
        assert!(
            result.stderr.contains("Unsupported extension"),
            "{}",
            result.stderr
        );
        assert!(result.stdout.is_empty());
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
    assert_eq!(
        headers("# Heading\n", "gfm+gfm_auto_identifiers"),
        attrs(r#"[["heading",[],[]]]"#)
    );
}
