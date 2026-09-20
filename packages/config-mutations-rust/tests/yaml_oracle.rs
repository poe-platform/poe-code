//! Development conformance only: the codec does not import the YAML SDK.
use config_mutations_rust::{value::Value, yaml};
use mcp_protocol_rust::{
    json::{self, Limits, Value as Json},
    numbers,
};
use std::{
    io::Write,
    process::{Command, Stdio},
};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn s(s: &str) -> Json {
    Json::String(u(s))
}
fn wire(value: &Value) -> Json {
    let parts = match value {
        Value::String(v) => vec![s("string"), Json::String(v.clone())],
        Value::Bool(v) => vec![s("boolean"), Json::Bool(*v)],
        Value::Number(v) => vec![
            s("number"),
            s(&if *v == 0.0 && v.is_sign_negative() {
                "-0".into()
            } else {
                numbers::format(*v)
            }),
        ],
        Value::Null => vec![s("null")],
        Value::Symbol(v) => vec![s("symbol"), Json::String(v.clone())],
        Value::Undefined => vec![s("undefined")],
        Value::BigInt(v) => vec![s("bigint"), Json::String(v.clone())],
        Value::Date(v) => vec![s("date"), Json::Number(v.epoch_millis as f64)],
        Value::Array(items) => vec![s("array"), Json::Array(items.iter().map(wire).collect())],
        Value::Object(items) => vec![
            s("object"),
            Json::Array(
                items
                    .iter()
                    .map(|(key, v)| Json::Array(vec![Json::String(key.clone()), wire(v)]))
                    .collect(),
            ),
        ],
        _ => panic!("Unexpected parsed value"),
    };
    Json::Array(parts)
}
fn oracle(cases: &[String]) -> Vec<Json> {
    let script = r#"
import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';
const {yamlFormat}=await import(process.cwd()+'/packages/config-mutations/dist/formats/yaml.js');
function wire(v){
 if(v instanceof Date)return ['date',v.getTime()];
 if(typeof v==='symbol')return ['symbol',v.description];
 if(v===null)return ['null'];
 if(Array.isArray(v))return ['array',v.map(wire)];
 if(v&&typeof v==='object')return ['object',Object.entries(v).map(([key,value])=>[key,wire(value)])];
 if(typeof v==='number')return ['number',Object.is(v,-0)?'-0':String(v)];
 return [typeof v,v];
}
const output=JSON.parse(readFileSync(0,'utf8')).map(source=>{try{const value=yamlFormat.parse(source);return {value:wire(value)};}catch(error){return {error:true};}});
process.stdout.write(JSON.stringify(output));
"#;
    run_node(script, &Json::Array(cases.iter().map(|v| s(v)).collect()))
}
fn run_node(script: &str, input: &Json) -> Vec<Json> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
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
        .write_all(json::stringify(input).as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let Json::Array(values) = json::parse(&output.stdout, Limits::default()).unwrap() else {
        panic!()
    };
    values
}
#[test]
fn own_yaml_composition_matches_original_configuration_values_and_admission() {
    let mut cases:Vec<String>=[
 "", " # comment\n", "null", "~", "true", "[]", "- one\n- two\n",
 "key: value\n", "quoted: 'null'\nempty: \n", "extensions:\n  terminal:\n    enabled: true\n    cmd: node\n    args: [server.mjs, --stdio]\n",
 "key: one\nkey: two\n", "defaults: &defaults {enabled: true}\nserver: *defaults\n", "key: *missing\n",
 "literal: |-\n  one\n  two\nfolded: >-\n  one\n  two\n", "flow: {nested: [1, 2, {key: value}]}\n",
 "key: !local 123", "key: !!bool yes", "key: !!str 123", "key: !!float 1", "key: !!int 1.5",
 "key: !!timestamp 2026-8-6 1:2:3 +5", "key: !!timestamp 0001-01-01", "key: !!binary aGVsbG8=",
 "? [a,b]\n: value", "__proto__: {safe: true}\nconstructor: string\n",
 "%YAML 1.1\n---\nyes: yes\nnum: 012\n", "%YAML 1.2\n---\nyes: yes\nnum: 012\n",
 ].into_iter().map(str::to_owned).collect();
    for value in [
        "null",
        "NULL",
        "Null",
        "~",
        "yes",
        "YES",
        "true",
        "True",
        "TRUE",
        "false",
        "FALSE",
        "y",
        "on",
        "OFF",
        "001",
        "+0",
        "-0",
        "0o17",
        "0xFF",
        "0b11",
        "0x_1",
        "1_000",
        "-0xFE",
        "1e3",
        "1e+3",
        ".5",
        "1.",
        ".",
        "e3",
        ".e3",
        "0_",
        "0x__",
        "0b__",
        "1_:2",
        "._5",
        "1_.5",
        ".inf",
        "-.Inf",
        "+.INF",
        ".NaN",
        "+NaN",
        ".NAN",
        "9007199254740993",
        "18446744073709551617",
        "1:23:45",
        "2026-08-26",
        "2026-08-26T12:34:56Z",
    ] {
        for version in ["", "%YAML 1.1\n---\n", "%YAML 1.2\n---\n"] {
            cases.push(format!("{version}key: {value}\n"));
        }
    }
    cases.push("%TAG !a! tag:example.com,a/\n%TAG !b! tag:example.com,b/\n---\nx: !a!kind 123\ny: !b!kind text\n".into());
    for count in [99, 100] {
        cases.push(format!(
            "a: &a text\nitems: [{}]\n",
            vec!["*a"; count].join(", ")
        ));
    }
    cases.push(format!(
        "a: &a [text]\nb: &b [{}]\nc: [{}]\n",
        ["*a"; 10].join(", "),
        ["*b"; 10].join(", ")
    ));
    for fixture in [
        "extensions:\n  terminal:\n    args: [one, \"two\", {nested: true}]\n",
        "literal: |+\n  one\n\nfolded: >-\n  two\n  three\n",
        "defaults: &defaults {enabled: true}\nserver: *defaults\n",
    ] {
        for index in 0..fixture.len() {
            cases.push(fixture[..index].into());
            cases.push(format!("{}{}", &fixture[..index], &fixture[index + 1..]));
        }
    }
    for source in [
        "%YAML 1.1\n---\nbase: &base {a: 1, b: 2}\nserver: {<<: *base, b: 3}\n",
        "base: &base {a: 1, b: 2}\nserver: {!!merge <<: *base, b: 3}\n",
        "%YAML 1.1\n---\na: &a {x: first, y: a}\nb: &b {x: second, z: b}\nserver: {z: explicit, <<: [*a, *b], y: explicit}\n",
        "%YAML 1.1\n---\nserver: {<<: {key: value}, added: true}\n",
        "%YAML 1.1\n---\nserver: {<<: [{a: 1}, {b: 2}]}\n",
        "%YAML 1.1\n---\nserver: {'<<': {a: 1}}\n",
        "%YAML 1.1\n---\nserver: {<<: {a: 1}, <<: {b: 2}}\n",
        "%YAML 1.1\n---\nserver: {<<: 1}\n",
        "%YAML 1.1\n---\nserver: {<<: [{a: 1}, false]}\n",
        "server: {!!merge 'anything': {a: 1}}\n",
        "items: !!pairs [a, b, {c: d}, {}]",
        "items: !!pairs [{a: 1, b: 2}]",
        "items: !!omap [{a: 1}, {b: 2}]",
        "items: !!omap [{a: 1}, {a: 2}]",
        "items: !!omap [a, a]",
        "items: !!set {a: null, b: null}",
        "items: !!set {a: 1}",
        "items: !!set [a, b]",
        "items: !!pairs {a: 1}",
        "items: !!seq {a: 1}",
        "items: !!map [a, b]",
    ] {
        cases.push(source.into());
    }
    for source in [
        "? ['a',\"b\",{1: x,\"1\": y}]\n: value",
        "base: &base {1: one, '1': two}\nserver: {!!merge <<: *base}\n",
        "items: !!omap [{1: one}, {'1': two}]",
        "b: first\n0: zero\na: last\n2: two\n1: one\n",
    ] {
        cases.push(source.into());
    }
    for source in [
        "? !!binary aGVsbG8=\n: value",
        "? [!!binary aGVsbG8=]\n: value",
        "base: &base [one,two]\n? *base\n: value",
        "? [!!timestamp 2026-08-26T12:34:56Z]\n: value",
    ] {
        cases.push(source.into());
    }
    cases.extend(
        [
            "value: !!merge anything",
            "first: &a !!merge <<\nsecond: *a\nthird: !!merge <<",
        ]
        .map(str::to_owned),
    );
    for tag in [
        "%C3%A9",
        "%F0%9F%A6%80",
        "%C0%80",
        "%ED%A0%80",
        "%F4%90%80%80",
        "%80",
        "%E0%A0",
    ] {
        cases.push(format!("value: !<tag:example.com,{tag}> text"));
    }
    cases.extend(
        [
            "value: !!%69nt 123",
            "value: !!%80 123",
            "value: !local%80 123",
            "%TAG !a! tag:example.com,\n---\nvalue: !a!%80 123",
            "value: !<tag:example.com,%> text",
            "value: !<tag:example.com,%zz> text",
        ]
        .map(str::to_owned),
    );
    cases.extend(
        [
            "base: &base {[one,two]: array}\nserver: {!!merge <<: *base}",
            "base: &base {{key: value}: object}\nserver: {!!merge <<: *base}",
            "base: &base {[one, [two,null]]: array}\nserver: {!!merge <<: *base}",
        ]
        .map(str::to_owned),
    );
    let expected = oracle(&cases);
    let mut failures = vec![];
    for (source, expected) in cases.iter().zip(expected) {
        match yaml::parse(&u(source), None) {
            Ok(parsed) => {
                let value = parsed.value;
                if expected.get("value") != Some(&wire(&value)) {
                    failures.push(format!(
                        "{source:?}: expected {} actual {}",
                        json::stringify(&expected),
                        json::stringify(&wire(&value))
                    ));
                }
            }
            Err(error) => {
                if expected.get("error").is_none() {
                    failures.push(format!(
                        "{source:?}: rejected {error}; expected {}",
                        json::stringify(&expected)
                    ));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn own_yaml_serialization_matches_original_default_layout() {
    let script = r#"
import {readFileSync} from 'node:fs';
const {yamlFormat}=await import(process.cwd()+'/packages/config-mutations/dist/formats/yaml.js');
function restore(w) {
 const [kind,v]=w;
 switch(kind){case 'null':return null;case 'undefined':return undefined;case 'number':return Number(v);case 'bigint':return BigInt(v);case 'string':case 'boolean':return v;
 case 'date':return new Date(v);case 'array':return v.map(restore);case 'object':return Object.fromEntries(v.map(([k,v])=>[k,restore(v)]));}
}
process.stdout.write(JSON.stringify(JSON.parse(readFileSync(0,'utf8')).map(v=>yamlFormat.serialize(restore(v)))));
"#;
    let mut texts: Vec<String> = [
        "",
        "null",
        "~",
        "true",
        "false",
        "yes",
        "001",
        "1e3",
        "0o17",
        "0xFF",
        ".NaN",
        "?",
        "-",
        "-foo",
        ":foo",
        "?foo",
        ": value",
        "#comment",
        "--- marker",
        "%doc",
        "a#b",
        "a #b",
        "a: b",
        "hello",
        "one\ntwo",
        "one\n",
        "one\n\n",
        "\n",
        "\n\n",
        " one\n two",
        "one\n  ",
        "one\n\ntwo",
        "quote \" text",
        "quote ' text",
        "quote \" ' both",
        "ten spaces          ",
        "cr\rtext",
        "tab\ttext",
        "emoji 🦀",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    for size in [39, 40, 60, 79, 80, 81, 100, 200] {
        texts.push("word ".repeat(size / 5));
        texts.push("x".repeat(size));
        texts.push(format!("{}\nend", "words ".repeat(size / 6)));
        texts.push(format!("{}\nend", "x".repeat(size)));
        texts.push(format!("{}\n  indented\nlast", "words ".repeat(size / 6)));
        texts.push(format!("{}\nend", "quote \" ".repeat(size / 8)));
    }
    for control in [
        0, 7, 8, 9, 11, 12, 13, 27, 31, 127, 133, 159, 160, 0x2028, 0x2029,
    ] {
        texts.push(format!("first{}last", char::from_u32(control).unwrap()));
    }
    let mut generated = vec![String::new()];
    for _ in 0..4 {
        generated = generated
            .iter()
            .flat_map(|text| ["a", " ", "\n", "\t", "'", "\""].map(|ch| format!("{text}{ch}")))
            .collect();
        texts.extend(generated.iter().cloned());
    }
    for text in [
        " one\ntwo",
        "one\n two",
        "one\n\n two",
        "one\n two\n\nlast",
        " one\n two\nlast",
        "\n one",
        "\n\n one",
        "one\n\t",
        " \n",
        " \n \n",
        "\n \n",
    ] {
        for size in [0, 40, 100] {
            texts.push(format!("{}{text}", "word ".repeat(size)));
        }
    }
    texts.extend(["x".repeat(1024), "x".repeat(1025), "\"".repeat(1025)]);
    let mut cases = vec![];
    for text in texts {
        let value = Value::String(u(&text));
        cases.push(value.clone());
        cases.push(Value::Object(vec![(u("key"), value.clone())]));
        cases.push(Value::Object(vec![(
            u("nested"),
            Value::Object(vec![(u("longer key"), value.clone())]),
        )]));
        cases.push(Value::Array(vec![value.clone(), Value::Null]));
        cases.push(Value::Object(vec![(u(&text), Value::Null)]));
        cases.push(Value::Object(vec![(u(&text), Value::Number(1.0))]));
    }
    cases.push(Value::Object(vec![
        (u("first"), Value::Null),
        (u("second"), Value::Null),
    ]));
    cases.push(Value::Array(vec![
        Value::Array(vec![Value::Number(1.0), Value::Number(2.0)]),
        Value::Object(vec![(u("a"), Value::Bool(true))]),
    ]));
    cases.push(Value::Object(vec![
        (u("x"), Value::String(vec![0xD800])),
        (u("y"), Value::String(vec![0xDC00])),
    ]));
    for number in [-0.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e21, 1e-7] {
        cases.push(Value::Number(number));
    }
    cases.push(Value::BigInt(u("12345678901234567890")));
    cases.push(Value::Object(vec![
        (u("skip"), Value::Undefined),
        (u("array"), Value::Array(vec![Value::Undefined])),
    ]));
    let expected = run_node(script, &Json::Array(cases.iter().map(wire).collect()));
    let mut failures = vec![];
    for (value, expected) in cases.iter().zip(expected) {
        let actual = Json::String(yaml::stringify(value).unwrap());
        if actual != expected {
            failures.push(format!(
                "{}: expected {} actual {}",
                json::stringify(&wire(value)),
                json::stringify(&expected),
                json::stringify(&actual)
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
