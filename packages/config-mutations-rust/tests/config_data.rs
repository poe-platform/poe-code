use config_mutations_rust::{
    config_data::{merge, prune},
    value::Value,
};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn object(entries: Vec<(&str, Value)>) -> Value {
    Value::Object(entries.into_iter().map(|(k, v)| (u(k), v)).collect())
}
#[test]
fn owned_merge_keeps_base_order_skips_undefined_and_replaces_arrays() {
    let base = object(vec![
        ("nested", object(vec![("keep", Value::Number(1.0))])),
        ("items", Value::Array(vec![Value::Number(1.0)])),
    ]);
    let patch = object(vec![
        ("nested", object(vec![("added", Value::Bool(true))])),
        ("items", Value::Array(vec![Value::String(u("new"))])),
        ("ignored", Value::Undefined),
    ]);
    assert_eq!(
        merge(&base, &patch, None).unwrap(),
        object(vec![
            (
                "nested",
                object(vec![
                    ("keep", Value::Number(1.0)),
                    ("added", Value::Bool(true))
                ])
            ),
            ("items", Value::Array(vec![Value::String(u("new"))]))
        ])
    );
}
#[test]
fn owned_prefix_map_repeats_at_nested_tables_and_uses_shallow_merge() {
    let base = object(vec![
        (
            "servers",
            object(vec![
                ("old-a", Value::Bool(true)),
                ("keep", object(vec![("old", Value::Bool(true))])),
            ]),
        ),
        (
            "group",
            object(vec![(
                "servers",
                object(vec![("old-b", Value::Bool(true))]),
            )]),
        ),
    ]);
    let patch = object(vec![
        (
            "servers",
            object(vec![("keep", object(vec![("new", Value::Bool(true))]))]),
        ),
        (
            "group",
            object(vec![(
                "servers",
                object(vec![("added", Value::Bool(true))]),
            )]),
        ),
    ]);
    assert_eq!(
        merge(&base, &patch, Some(&[(u("servers"), u("old-"))])).unwrap(),
        object(vec![
            (
                "servers",
                object(vec![("keep", object(vec![("new", Value::Bool(true))]))])
            ),
            (
                "group",
                object(vec![(
                    "servers",
                    object(vec![("added", Value::Bool(true))])
                )])
            )
        ])
    );
}
#[test]
fn owned_prune_deletes_by_shape_and_retains_sdk_empty_child_changed_flag() {
    let base = object(vec![
        ("keep", Value::Bool(true)),
        (
            "nested",
            object(vec![
                ("remove", Value::Bool(true)),
                ("keep", Value::Bool(false)),
            ]),
        ),
        ("empty", object(vec![])),
    ]);
    let shape = object(vec![
        ("nested", object(vec![("remove", Value::Null)])),
        ("empty", object(vec![("absent", Value::Null)])),
    ]);
    let pruned = prune(&base, &shape).unwrap();
    assert!(pruned.changed);
    assert_eq!(
        pruned.result,
        object(vec![
            ("keep", Value::Bool(true)),
            ("nested", object(vec![("keep", Value::Bool(false))]))
        ])
    );
    let pruned = prune(
        &object(vec![("empty", object(vec![]))]),
        &object(vec![("empty", object(vec![("absent", Value::Null)]))]),
    )
    .unwrap();
    assert!(!pruned.changed);
    assert_eq!(pruned.result, object(vec![]));
}
#[test]
fn owned_data_work_stacks_support_depth1000_and_reject_beyond() {
    let mut value = object(vec![("leaf", Value::Number(1.0))]);
    let mut patch = object(vec![("added", Value::Bool(true))]);
    for _ in 0..999 {
        value = object(vec![("child", value)]);
        patch = object(vec![("child", patch)]);
    }
    assert!(merge(&value, &patch, None).is_ok());
    assert!(prune(&value, &patch).is_ok());
    let mut deeper = object(vec![("child", value)]);
    for _ in 0..8 {
        deeper = object(vec![("child", deeper)]);
    }
    assert!(merge(&deeper, &object(vec![]), None).is_err());
}

#[test]
fn owned_data_matches_current_sdk_on_generated_merge_and_prune_shapes() {
    use mcp_protocol_rust::json::{self, Limits, Value as Json};
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    fn owned(value: Json) -> Value {
        match value {
            Json::Null => Value::Null,
            Json::Bool(v) => Value::Bool(v),
            Json::Number(v) => Value::Number(v),
            Json::String(v) => Value::String(v),
            Json::Array(v) => Value::Array(v.into_iter().map(owned).collect()),
            Json::Object(v) => Value::Object(v.into_iter().map(|(k, v)| (k, owned(v))).collect()),
        }
    }
    fn wire(value: Value) -> Json {
        match value {
            Value::Null => Json::Null,
            Value::Bool(v) => Json::Bool(v),
            Value::Number(v) => Json::Number(v),
            Value::String(v) => Json::String(v),
            Value::Array(v) => Json::Array(v.into_iter().map(wire).collect()),
            Value::Object(v) => Json::Object(v.into_iter().map(|(k, v)| (k, wire(v))).collect()),
            _ => panic!("Non-JSON fixture"),
        }
    }
    let sources = [
        "{}",
        "{\"field\":null}",
        "{\"field\":true}",
        "{\"field\":1}",
        "{\"field\":\"🦀\\ud800\"}",
        "{\"field\":[1,{\"child\":true}]}",
        "{\"field\":{}}",
        "{\"field\":{\"child\":true,\"keep\":false}}",
        "{\"field\":{\"child\":{\"leaf\":1}},\"keep\":true}",
        "{\"__proto__\":{\"child\":true},\"constructor\":{\"leaf\":1}}",
    ];
    let cases: Vec<_> = sources
        .iter()
        .flat_map(|base| sources.iter().map(move |patch| (*base, *patch)))
        .collect();
    let input = Json::Array(
        cases
            .iter()
            .map(|(base, patch)| Json::Array(vec![Json::String(u(base)), Json::String(u(patch))]))
            .collect(),
    );
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let script = r#"
import {readFileSync} from 'node:fs';
import {jsonFormat} from './packages/config-mutations/dist/formats/json.js';
const output=JSON.parse(readFileSync(0,'utf8')).map(([base,patch])=>{
 const current=JSON.parse(base),shape=JSON.parse(patch);
 return {merged:jsonFormat.merge(current,shape),pruned:jsonFormat.prune(current,shape)};
});
process.stdout.write(JSON.stringify(output));
"#;
    let mut child = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(json::stringify(&input).as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let Json::Array(expected) = json::parse(&output.stdout, Limits::default()).unwrap() else {
        panic!()
    };
    for ((base, patch), expected) in cases.into_iter().zip(expected) {
        let base_value = owned(json::parse(base.as_bytes(), Limits::default()).unwrap());
        let patch_value = owned(json::parse(patch.as_bytes(), Limits::default()).unwrap());
        let merged = merge(&base_value, &patch_value, None).unwrap();
        let pruned = prune(&base_value, &patch_value).unwrap();
        let actual = Json::Object(vec![
            (u("merged"), wire(merged)),
            (
                u("pruned"),
                Json::Object(vec![
                    (u("changed"), Json::Bool(pruned.changed)),
                    (u("result"), wire(pruned.result)),
                ]),
            ),
        ]);
        assert_eq!(actual, expected, "base={base}, patch/shape={patch}");
    }
}
