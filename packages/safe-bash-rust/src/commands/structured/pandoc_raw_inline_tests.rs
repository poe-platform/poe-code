use super::*;

#[test]
fn pandoc_raw_inline_shared_fixtures() {
    let fixtures = parse_json_stream(include_str!(
        "../../../../safe-bash-command-pandoc/src/fixtures/inline-html.json"
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
        let text = |key| match jval_obj_get(&fields, key) {
            Some(JVal::Str(s)) => s.as_str(),
            _ => panic!("missing {key}"),
        };
        let name = text("name");
        let mut args = ["-f", text("from"), "-t", text("to")]
            .map(str::to_owned)
            .to_vec();
        if let Some(JVal::Array(extra)) = jval_obj_get(&fields, "args") {
            args.extend(extra.iter().map(|v| match v {
                JVal::Str(s) => s.clone(),
                _ => unreachable!(),
            }));
        }
        let result = try_run_structured_command(
            "pandoc",
            &args,
            text("source"),
            "/",
            &BTreeMap::new(),
            &crate::MemoryVfs::new(),
        )
        .unwrap();
        if jval_obj_get(&fields, "error").is_some() {
            assert_ne!(result.exit_code, 0, "{name}: {}", result.stdout);
            assert!(result.stdout.is_empty(), "{name}");
            continue;
        }
        assert_eq!(result.exit_code, 0, "{name}: {}", result.stderr);
        if let Some(expected) = jval_obj_get(&fields, "blocks") {
            let JVal::Object(doc) = parse_json_stream(&result.stdout).unwrap().remove(0) else {
                panic!("invalid document")
            };
            assert_eq!(
                jval_obj_get(&doc, "blocks")
                    .unwrap()
                    .to_json_string(true, true, 0),
                expected.to_json_string(true, true, 0),
                "{name}"
            );
        } else if let Some(expected) = jval_obj_get(&fields, "raw") {
            fn raw(value: &JVal, out: &mut Vec<JVal>) {
                match value {
                    JVal::Array(values) => values.iter().for_each(|v| raw(v, out)),
                    JVal::Object(fields) => {
                        if matches!(jval_obj_get(fields, "t"), Some(JVal::Str(t)) if t == "RawInline")
                        {
                            out.push(value.clone());
                        } else {
                            for (_, v) in fields {
                                raw(v, out);
                            }
                        }
                    }
                    _ => {}
                }
            }
            let mut nodes = Vec::new();
            raw(&parse_json_stream(&result.stdout).unwrap()[0], &mut nodes);
            assert_eq!(
                JVal::Array(nodes).to_json_string(true, true, 0),
                expected.to_json_string(true, true, 0),
                "{name}"
            );
        } else {
            assert_eq!(result.stdout, text("output"), "{name}");
        }
    }
}

#[test]
fn pandoc_raw_inline_rejection_preserves_saved_output() {
    let fs = crate::MemoryVfs::new();
    fs.write_file("/saved.txt", b"KEEP").unwrap();
    let result = try_run_structured_command(
        "pandoc",
        &["-f", "markdown", "-t", "plain", "-o", "/saved.txt"].map(str::to_owned),
        "before\n\n- a<!-- hidden -->b",
        "/",
        &BTreeMap::new(),
        &fs,
    )
    .unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(result.stdout.is_empty());
    assert_eq!(fs.read_file("/saved.txt").unwrap(), b"KEEP");
}
