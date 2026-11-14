use super::*;

fn targets(value: &JVal, out: &mut Vec<JVal>) {
    match value {
        JVal::Array(values) => values.iter().for_each(|value| targets(value, out)),
        JVal::Object(fields) => {
            if let Some(JVal::Str(kind)) = jval_obj_get(fields, "t")
                && matches!(kind.as_str(), "Link" | "Image")
                && let Some(JVal::Array(c)) = jval_obj_get(fields, "c")
            {
                out.push(JVal::Object(vec![
                    ("kind".into(), JVal::Str(kind.clone())),
                    ("target".into(), c.last().unwrap().clone()),
                ]));
            }
            for (_, value) in fields {
                targets(value, out);
            }
        }
        _ => {}
    }
}

#[test]
fn reference_links_match_native_pandoc_fixtures() {
    let fixtures = parse_json_stream(include_str!(
        "../../../../safe-bash-command-pandoc/src/fixtures/reference-links.json"
    ))
    .unwrap()
    .remove(0);
    let JVal::Array(fixtures) = fixtures else {
        panic!("fixtures must be an array")
    };
    for fixture in fixtures {
        let JVal::Object(fields) = fixture else {
            panic!("fixture must be an object")
        };
        let (Some(JVal::Str(name)), Some(JVal::Str(source))) = (
            jval_obj_get(&fields, "name"),
            jval_obj_get(&fields, "source"),
        ) else {
            panic!("missing fixture fields")
        };
        let fs = crate::MemoryVfs::new();
        let result = cmd_pandoc(
            &["-f", "markdown", "-t", "json"].map(str::to_owned),
            source,
            "/",
            &fs,
        );
        assert_eq!(result.exit_code, 0, "{name}: {}", result.stderr);
        let mut actual = Vec::new();
        targets(&parse_json_stream(&result.stdout).unwrap()[0], &mut actual);
        assert_eq!(
            JVal::Array(actual).to_json_string(true, true, 0),
            jval_obj_get(&fields, "targets")
                .unwrap()
                .to_json_string(true, true, 0),
            "{name}"
        );
        let plain = cmd_pandoc(
            &["-f", "markdown", "-t", "plain"].map(str::to_owned),
            source,
            "/",
            &fs,
        );
        let Some(JVal::Str(expected)) = jval_obj_get(&fields, "plain") else {
            panic!("missing plain output")
        };
        assert_eq!(&plain.stdout, expected, "{name}");
    }
}

#[test]
fn duplicate_precedence_follows_the_reader_dialect() {
    let fs = crate::MemoryVfs::new();
    for from in [
        "markdown",
        "markdown_strict",
        "markdown_phpextra",
        "markdown_mmd",
        "gfm",
        "commonmark",
        "commonmark_x",
    ] {
        let result = cmd_pandoc(
            &["-f", from, "-t", "json"].map(str::to_owned),
            "[a][id]\n\n[id]: /first\n[id]: /second",
            "/",
            &fs,
        );
        assert_eq!(result.exit_code, 0, "{from}: {}", result.stderr);
        let mut actual = Vec::new();
        targets(&parse_json_stream(&result.stdout).unwrap()[0], &mut actual);
        let expected = if matches!(from, "gfm" | "commonmark" | "commonmark_x") {
            "/first"
        } else {
            "/second"
        };
        assert_eq!(
            JVal::Array(actual).to_json_string(true, true, 0),
            format!(r#"[{{"kind":"Link","target":["{expected}",""]}}]"#),
            "{from}"
        );
    }
}

#[test]
fn definitions_follow_combined_and_file_scope_inputs() {
    let fs = crate::MemoryVfs::new();
    crate::SafeBashFs::write_file(&fs, "/a.md", b"[a][id]").unwrap();
    crate::SafeBashFs::write_file(&fs, "/b.md", b"[id]: /target").unwrap();
    for (flag, expected) in [(false, "a\n"), (true, "[a][id]\n")] {
        let mut args = ["-f", "markdown", "-t", "plain", "/a.md", "/b.md"]
            .map(str::to_owned)
            .to_vec();
        if flag {
            args.push("--file-scope".into());
        }
        let result = cmd_pandoc(&args, "", "/", &fs);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected);
    }
}
