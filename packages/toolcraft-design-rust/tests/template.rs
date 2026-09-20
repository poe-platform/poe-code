use toolcraft_design_rust::template;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn partial_discovery_keeps_first_encounter_order_inside_sections() {
    let actual =
        template::partial_names(&u("{{> one}}{{#items}}{{> two}}{{> one}}{{/items}}")).unwrap();
    assert_eq!(actual, vec![u("one"), u("two")]);
}
#[test]
fn partial_expansion_preserves_standalone_indentation_and_yield_tags() {
    let partials = vec![
        (u("items"), u("one\ntwo\n{{yield}}")),
        (u("outer"), u("Before\n  {{> items}}\nAfter")),
    ];
    let actual = template::expand_partials(&u("Start\n  {{> outer}}\nEnd"), &partials).unwrap();
    assert_eq!(
        actual,
        u("Start\n  Before\n    one\n    two\n    {{yield}}  AfterEnd")
    );
}
#[test]
fn malformed_tag_diagnostics_count_utf16_columns() {
    let error = template::partial_names(&u("first\n🦀 {{ name\n")).unwrap_err();
    assert_eq!((error.line, error.column), (Some(2), Some(4)));
    assert_eq!(
        error.description,
        u("Unclosed tag \"{{ name\": expected \"}}\"")
    );
}
#[test]
fn parser_validates_sections_even_for_partial_discovery() {
    for (source, message) in [
        ("{{#a}}x", "Unclosed section \"a\""),
        ("{{/a}}", "Closing unopened section \"a\""),
        (
            "{{#a}}{{/b}}",
            "Unclosed section \"a\" before closing \"b\"",
        ),
    ] {
        assert_eq!(
            template::partial_names(&u(source)).unwrap_err().description,
            u(message)
        );
    }
}
#[test]
fn partial_cycles_and_missing_references_fail_before_recursing() {
    let partials = vec![(u("one"), u("{{> two}}")), (u("two"), u("{{> one}}"))];
    assert_eq!(
        template::expand_partials(&u("{{> one}}"), &partials)
            .unwrap_err()
            .description,
        u("Circular partial reference detected: one -> two -> one.")
    );
    assert_eq!(
        template::expand_partials(&u("{{> missing}}"), &partials)
            .unwrap_err()
            .description,
        u("Partial \"missing\" not found.")
    );
}
#[test]
fn deeply_nested_sections_compile_without_recursive_tree_ownership() {
    let source = format!("{}done{}", "{{#flag}}".repeat(512), "{{/flag}}".repeat(512));
    let program = template::compile(&u(&source)).unwrap();
    assert_eq!(program.tokens.len(), 513);
    assert_eq!(program.roots.len(), 1);
}
#[test]
fn partial_depth_admission_matches_the_design_contract() {
    let partials: Vec<_> = (0..102)
        .map(|i| {
            (
                u(&format!("partial-{i}")),
                u(&format!("{{{{> partial-{}}}}}", i + 1)),
            )
        })
        .collect();
    assert_eq!(
        template::expand_partials(&u("{{> partial-0}}"), &partials)
            .unwrap_err()
            .description,
        u("Maximum partial depth exceeded (100).")
    );
}
