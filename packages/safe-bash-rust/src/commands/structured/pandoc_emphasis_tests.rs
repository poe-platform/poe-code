use super::*;

#[test]
fn pandoc_emphasis_matches_shared_fixtures() {
    let fixtures = parse_json_stream(include_str!(
        "../../../../safe-bash-command-pandoc/src/fixtures/emphasis.json"
    ))
    .unwrap()
    .remove(0);
    let JVal::Array(fixtures) = fixtures else {
        panic!("fixtures")
    };
    for fixture in fixtures {
        let JVal::Object(fields) = fixture else {
            panic!("fixture")
        };
        let Some(JVal::Str(source)) = jval_obj_get(&fields, "source") else {
            panic!("source")
        };
        let name = jval_obj_get(&fields, "name").unwrap();
        for to in ["json", "html", "plain"] {
            let result = try_run_structured_command(
                "pandoc",
                &["-f", "markdown", "-t", to].map(str::to_owned),
                source,
                "/",
                &Default::default(),
                &crate::MemoryVfs::new(),
            )
            .unwrap();
            assert_eq!(result.exit_code, 0, "{name:?}: {}", result.stderr);
            if to == "json" {
                let parsed = parse_json_stream(&result.stdout).unwrap().remove(0);
                let JVal::Object(doc) = parsed else {
                    panic!("document")
                };
                assert_eq!(
                    jval_obj_get(&doc, "blocks"),
                    jval_obj_get(&fields, "blocks"),
                    "{name:?}"
                );
            } else {
                assert_eq!(
                    Some(&JVal::Str(result.stdout)),
                    jval_obj_get(&fields, to),
                    "{name:?}: {to}"
                );
            }
        }
    }
}
