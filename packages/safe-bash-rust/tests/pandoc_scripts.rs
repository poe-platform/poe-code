use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions,
    commands::codecs::{inflate_raw, parse_zip_archive},
};
use std::sync::Arc;

fn text(value: &Value) -> String {
    let Value::String(units) = value else {
        panic!("string")
    };
    String::from_utf16(units).unwrap()
}
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
    shell: &mut Shell,
    source: &str,
    from: &str,
    to: &str,
    options: &str,
) -> safe_bash_rust::ExecOutput {
    shell
        .exec_with_options(
            &format!("pandoc -f {from} -t {to} {options}"),
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap()
}

#[test]
fn script_syntax_matches_public_javascript_across_profiles_and_delimiters() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-scripts.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!("fixture")
    };
    let (mut shell, _) = shell();
    let mut differences = Vec::new();
    for case in cases {
        let source = text(case.get("source").unwrap());
        let from = text(case.get("from").unwrap());
        let output = run(&mut shell, &source, &from, "json", "");
        assert_eq!(output.exit_code, 0, "{from}: {source:?}: {}", output.stderr);
        let actual = json::parse(output.stdout.as_bytes(), Default::default()).unwrap();
        if actual.get("blocks") != case.get("blocks") {
            differences.push(format!("{from}: {source:?}: {}", output.stdout));
        }
    }
    assert!(
        differences.is_empty(),
        "{} differences:\n{}",
        differences.len(),
        differences.join("\n")
    );
}

#[test]
fn commonmark_rejects_unsupported_script_extension_switches() {
    let (mut shell, _) = shell();
    for from in [
        "commonmark+subscript",
        "commonmark-subscript",
        "commonmark+superscript",
        "commonmark-superscript",
    ] {
        let output = run(&mut shell, "x^2^ H~2~O", from, "json", "");
        assert_ne!(output.exit_code, 0);
        assert!(
            output.stderr.contains("Unsupported extension"),
            "{}",
            output.stderr
        );
    }
}

#[test]
fn scripts_survive_native_text_writers_and_json_roundtrips() {
    let source = "H~2~O x^2^ ~a\\ b~";
    let (mut shell, _) = shell();
    let document = run(&mut shell, source, "markdown", "json", "");
    assert_eq!(document.exit_code, 0);
    for (to, expected) in [
        (
            "html",
            "<p>H<sub>2</sub>O x<sup>2</sup> <sub>a b</sub></p>\n",
        ),
        ("plain", "H2O x2 a b\n"),
        (
            "latex",
            "H\\textsubscript{2}O x\\textsuperscript{2} \\textsubscript{a b}\n",
        ),
        ("rst", "H\\ :sub:`2`\\ O x\\ :sup:`2` :sub:`a b`\n"),
    ] {
        for (from, input) in [("markdown", source), ("json", document.stdout.as_str())] {
            let output = run(&mut shell, input, from, to, "");
            assert_eq!(output.exit_code, 0, "{from}->{to}: {}", output.stderr);
            assert_eq!(output.stdout, expected, "{from}->{to}");
        }
    }
    let rtf = run(&mut shell, source, "markdown", "rtf", "");
    assert_eq!(rtf.exit_code, 0);
    assert!(rtf.stdout.contains("H{\\sub 2}O x{\\super 2} {\\sub a b}"));
}

#[test]
fn markdown_output_explicitly_rejects_script_nodes_like_javascript() {
    let (mut shell, fs) = shell();
    for to in [
        "markdown",
        "gfm",
        "commonmark",
        "gfm+superscript+subscript",
        "markdown-subscript-superscript",
    ] {
        fs.write_file("/output", b"unchanged").unwrap();
        let output = run(&mut shell, "x^2^", "markdown", to, "-o /output");
        assert_ne!(output.exit_code, 0, "{to}");
        assert!(
            output.stderr.contains("E_UNSUPPORTED_FEATURE"),
            "{}",
            output.stderr
        );
        assert_eq!(fs.read_file("/output").unwrap(), b"unchanged");
    }
}

#[test]
fn rst_script_roles_reject_nested_styles_before_overwriting_output() {
    let (mut shell, fs) = shell();
    for source in ["~*a*~", "^**a**^", "*~a~*", "[~a~](url)", "~`a`~"] {
        fs.write_file("/output", b"unchanged").unwrap();
        let output = run(&mut shell, source, "markdown", "rst", "-o /output");
        assert_ne!(output.exit_code, 0, "{source}");
        assert!(
            output.stderr.contains("E_UNSUPPORTED_FEATURE"),
            "{}",
            output.stderr
        );
        assert_eq!(fs.read_file("/output").unwrap(), b"unchanged");
    }
}

#[test]
fn scripts_keep_notes_raw_html_and_heading_visitors() {
    let (mut shell, _) = shell();
    let output = run(
        &mut shell,
        "# H~2~O\n\n~a[^note]~\n\n[^note]: # Nested x^2^",
        "markdown",
        "json",
        "--shift-heading-level-by=1",
    );
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    let document = json::parse(output.stdout.as_bytes(), Default::default()).unwrap();
    let Value::Array(blocks) = document.get("blocks").unwrap() else {
        panic!("blocks")
    };
    let Value::Array(heading) = blocks[0].get("c").unwrap() else {
        panic!("heading")
    };
    assert_eq!(heading[0], Value::Number(2.));
    assert!(output.stdout.contains("\"h2o\""), "{}", output.stdout);
    assert!(output.stdout.contains("\"Note\""), "{}", output.stdout);
    assert!(output.stdout.contains("\"nested-x2\""), "{}", output.stdout);
    let output = run(
        &mut shell,
        "~<em>a</em>~",
        "markdown",
        "html",
        "--raw-content=reject",
    );
    assert_ne!(
        output.exit_code, 0,
        "raw HTML inside scripts must not bypass policy"
    );
    assert!(output.stderr.contains("E_CAPABILITY"), "{}", output.stderr);
}

#[test]
fn scripts_reach_real_word_and_pdf_typography() {
    let (mut shell, fs) = shell();
    for to in ["docx", "pdf"] {
        let output = run(&mut shell, "BASE~SUB~ x^SUP^", "markdown", to, "-o /output");
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if to == "docx" {
            let part = parse_zip_archive(&bytes)
                .unwrap()
                .into_iter()
                .find(|part| part.name == "word/document.xml")
                .unwrap();
            let xml = String::from_utf8(part.content).unwrap();
            assert!(xml.contains("w:val=\"subscript\""));
            assert!(xml.contains("w:val=\"superscript\""));
            assert!(xml.contains(">SUB</w:t>") && xml.contains(">SUP</w:t>"));
        } else {
            assert!(bytes.starts_with(b"%PDF-"));
            let mut runs = Vec::new();
            for start in bytes
                .windows(7)
                .enumerate()
                .filter_map(|(at, value)| (value == b"stream\n").then_some(at + 7))
            {
                let Ok((stream, _)) = inflate_raw(&bytes[start + 2..]) else {
                    continue;
                };
                let Ok(stream) = String::from_utf8(stream) else {
                    continue;
                };
                for line in stream.lines().filter(|line| line.contains(" Tf ")) {
                    let tokens: Vec<_> = line.split_whitespace().collect();
                    let font = tokens.iter().position(|token| *token == "Tf").unwrap();
                    let matrix = tokens.iter().position(|token| *token == "Tm").unwrap();
                    runs.push((
                        tokens[font - 1].parse::<f64>().unwrap(),
                        tokens[matrix - 1].parse::<f64>().unwrap(),
                    ));
                }
            }
            assert!(
                runs.len() >= 4,
                "expected base, subscript and superscript text runs: {runs:?}"
            );
            let (base_size, baseline) = runs[0];
            assert!(
                runs.iter()
                    .any(|&(size, y)| size < base_size && y < baseline),
                "subscript must be smaller and below the baseline: {runs:?}"
            );
            assert!(
                runs.iter()
                    .any(|&(size, y)| size < base_size && y > baseline),
                "superscript must be smaller and above the baseline: {runs:?}"
            );
        }
    }
}
