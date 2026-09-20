use config_extends_rust::{Layer, escape_path, merge_layers};
use config_mutations_rust::value::Value;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn s(text: &str) -> Value {
    Value::String(u(text))
}
fn o(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (u(key), value))
            .collect(),
    )
}
fn layer(source: &str, data: Value) -> Layer {
    Layer {
        source: u(source),
        data,
    }
}
#[test]
fn first_layer_wins_null_deletes_undefined_and_empty_prompts_fall_through() {
    let result = merge_layers(&[
        layer(
            "first",
            o(vec![
                ("title", s("first")),
                ("removed", Value::Null),
                ("missing", Value::Undefined),
                ("prompt", s("")),
            ]),
        ),
        layer(
            "second",
            o(vec![
                ("title", s("second")),
                ("removed", s("retained?")),
                ("missing", Value::Bool(true)),
                ("prompt", s("write")),
            ]),
        ),
    ])
    .unwrap();
    assert_eq!(
        result.data,
        o(vec![
            ("title", s("first")),
            ("missing", Value::Bool(true)),
            ("prompt", s("write"))
        ])
    );
    assert_eq!(
        result.sources,
        [
            (u("title"), u("first")),
            (u("missing"), u("second")),
            (u("prompt"), u("second"))
        ]
    );
}
#[test]
fn nested_objects_fill_gaps_and_arrays_replace_without_pruning_their_children() {
    let array = Value::Array(vec![o(vec![("null", Value::Null), ("prompt", s(""))])]);
    let result = merge_layers(&[
        layer(
            "first",
            o(vec![(
                "a",
                o(vec![("x", Value::Number(1.0)), ("items", array.clone())]),
            )]),
        ),
        layer(
            "second",
            o(vec![(
                "a",
                o(vec![
                    ("x", Value::Number(2.0)),
                    ("y", Value::Number(3.0)),
                    ("items", Value::Array(vec![s("b")])),
                ]),
            )]),
        ),
    ])
    .unwrap();
    assert_eq!(result.data.get("a").unwrap().get("items"), Some(&array));
    assert_eq!(
        result.data.get("a").unwrap().get("y"),
        Some(&Value::Number(3.0))
    );
    assert_eq!(
        result.sources,
        [
            (u("a"), u("first")),
            (u("a.x"), u("first")),
            (u("a.items"), u("first")),
            (u("a.y"), u("second"))
        ]
    );
}
#[test]
fn provenance_escapes_literal_dots_backslashes_and_surrogates_without_mutating_inputs() {
    let data = o(vec![
        ("service.url", s("literal")),
        ("service", o(vec![("url", s("nested"))])),
        ("__proto__", o(vec![("owner", s("safe"))])),
    ]);
    let layers = [layer("document", data.clone())];
    let result = merge_layers(&layers).unwrap();
    assert_eq!(layers[0].data, data);
    assert!(
        result
            .sources
            .contains(&(u("service\\.url"), u("document")))
    );
    assert!(result.sources.contains(&(u("service.url"), u("document"))));
    assert_eq!(
        result.data.get("__proto__").unwrap().get("owner"),
        Some(&s("safe"))
    );
    assert_eq!(
        escape_path(&[u("a.b"), vec![0xd800, 92, 46]]),
        vec![97, 92, 46, 98, 46, 0xd800, 92, 92, 92, 46]
    );
}
#[test]
fn nonobject_first_values_block_objects_and_empty_layers_are_valid() {
    let result = merge_layers(&[
        layer("first", o(vec![("a", s("value"))])),
        layer("second", o(vec![("a", o(vec![("x", s("hidden"))]))])),
    ])
    .unwrap();
    assert_eq!(result.data.get("a"), Some(&s("value")));
    let result = merge_layers(&[]).unwrap();
    assert_eq!(result.data, Value::Object(vec![]));
    assert!(result.sources.is_empty());
    assert!(merge_layers(&[layer("bad", Value::Array(vec![]))]).is_err());
}
#[test]
fn owned_merging_and_array_cloning_use_explicit_work_stacks_at_the_depth_boundary() {
    std::thread::Builder::new()
        .stack_size(4 * 1024 * 1024)
        .spawn(|| {
            fn nested(depth: usize) -> Value {
                let mut value = s("leaf");
                for _ in 0..depth {
                    value = o(vec![("n", value)]);
                }
                value
            }
            let result = merge_layers(&[layer("deep", nested(1000))]).unwrap();
            assert_eq!(result.sources.len(), 1000);
            let mut value = &result.data;
            for _ in 0..1000 {
                value = value.get("n").unwrap();
            }
            assert_eq!(value, &s("leaf"));
            assert_eq!(
                merge_layers(&[layer("too-deep", nested(1001))]).unwrap_err(),
                "Maximum configuration depth exceeded"
            );
            let array = Value::Array(vec![nested(998)]);
            let result = merge_layers(&[layer("array", o(vec![("items", array)]))]).unwrap();
            assert_eq!(result.sources.len(), 1);
        })
        .unwrap()
        .join()
        .unwrap();
}
