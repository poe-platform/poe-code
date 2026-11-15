use super::*;

#[test]
fn pandoc_code_spans_match_shared_fixtures() {
    let fixtures = parse_json_stream(include_str!(
        "../../../../safe-bash-command-pandoc/src/fixtures/code-spans.json"
    ))
    .unwrap()
    .remove(0);
    let JVal::Array(fixtures) = fixtures else {
        panic!("expected fixtures")
    };
    let fs = crate::MemoryVfs::new();
    for fixture in fixtures {
        let JVal::Object(fields) = fixture else {
            panic!("expected fixture")
        };
        let Some(JVal::Str(source)) = jval_obj_get(&fields, "source") else {
            panic!("expected source")
        };
        let name = jval_obj_get(&fields, "name")
            .unwrap()
            .to_json_string(true, true, 0);
        for format in ["json", "html", "plain"] {
            let result = try_run_structured_command(
                "pandoc",
                &["-f", "markdown", "-t", format].map(str::to_owned),
                source,
                "/",
                &BTreeMap::new(),
                &fs,
            )
            .unwrap();
            assert_eq!(result.exit_code, 0, "{name}: {}", result.stderr);
            if format == "json" {
                let JVal::Object(document) = parse_json_stream(&result.stdout).unwrap().remove(0)
                else {
                    panic!("expected document")
                };
                assert_eq!(
                    jval_obj_get(&document, "blocks")
                        .unwrap()
                        .to_json_string(true, true, 0),
                    jval_obj_get(&fields, "blocks")
                        .unwrap()
                        .to_json_string(true, true, 0),
                    "{name}"
                );
            } else {
                let Some(JVal::Str(expected)) = jval_obj_get(&fields, format) else {
                    panic!("expected output")
                };
                assert_eq!(&result.stdout, expected, "{name}: {format}");
            }
        }
    }
}
