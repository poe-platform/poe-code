//! Development conformance only: the codec does not import the TOML SDK.
use config_mutations_rust::{toml, value::Value};
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
        Value::Date(v) => vec![
            s("date"),
            Json::Number(v.epoch_millis as f64),
            Json::String(v.to_iso_string()),
            Json::Bool(v.is_local()),
            Json::Bool(v.is_date()),
            Json::Bool(v.is_time()),
            Json::Bool(v.has_date && v.has_time),
        ],
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
import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
const owner=process.cwd()+'/packages/config-mutations-rust/package.json',require=createRequire(owner);
const {parse,stringify}=require('smol-toml');
const expected=JSON.parse(readFileSync(owner,'utf8')).devDependencies['smol-toml'];
const actual=JSON.parse(readFileSync(new URL('../package.json',pathToFileURL(require.resolve('smol-toml'))),'utf8')).version;
if(actual!==expected)throw Error(`TOML reference version mismatch: installed ${actual}, expected ${expected}`);
function wire(v){
 if(v instanceof Date)return ['date',v.getTime(),v.toISOString(),v.isLocal(),v.isDate(),v.isTime(),v.isDateTime()];
 if(Array.isArray(v))return ['array',v.map(wire)];
 if(v&&typeof v==='object')return ['object',Object.entries(v).map(([key,value])=>[key,wire(value)])];
 if(typeof v==='number')return ['number',Object.is(v,-0)?'-0':String(v)];
 return [typeof v,v];
}
const output=JSON.parse(readFileSync(0,'utf8')).map(source=>{try{const value=source.trim()?parse(source):{};return {value:wire(value),serialized:stringify(value)};}catch(error){return {error:error.message,line:error.line,column:error.column,codeblock:error.codeblock};}});
process.stdout.write(JSON.stringify(output));
"#;
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
        .write_all(json::stringify(&Json::Array(cases.iter().map(|v| s(v)).collect())).as_bytes())
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
fn own_parser_and_serializer_match_sdk_values_temporals_and_diagnostics() {
    let mut cases: Vec<String> = [
        "",
        " \u{a0}\u{feff}",
        "# comment\n",
        "value = true",
        "value = false",
        "value = -0",
        "value = -0.0",
        "value = inf",
        "value = +nan",
        "value = 0xDE_AD",
        "value = 0o7_55",
        "value = 0b1_01",
        "value = 9007199254740991",
        "value = 1e400",
        "value = '\u{d7ff}'",
        "value = [1, true, 'x', { a.b = 3 },]",
        "value = { # comment\n a = [1, 2], # after\n b = true,\n}",
        "\"quoted.key\" = 'literal'\n__proto__.safe = true\n\"2\" = 2\n\"20\" = 20\n",
        "[parent.child]\nx=1\n[parent]\ny=2",
        "[[a]]\nx=1\n[a.child]\ny=2\n[[a]]\nx=3\n[[a.child]]\ny=4",
        "value = \"\"\"\r\nfirst\\ \r\n second\r\nthird\"\"\"",
        "value = '''\nline\\n\nnext'''",
        "value = \"one\\x41\\e\\U0001F980\"",
        "value = \"\"\"ends with quote\"\"\"\"",
        "value = '''ends with quotes'''''",
        "value = 01",
        "value = 1__0",
        "value = 0b2",
        "value = +0x10",
        "value = 9007199254740992",
        "value = 1.",
        "value = .1",
        "value = 1e",
        "a = 1\na = 2",
        "a.b = 1\n[a]",
        "[a]\n[a]",
        "a = {}\n[a]",
        "a = []\n[[a]]",
        "[a]\n[[a]]",
        "[[a]]\n[a]",
        "x = { a = 1, a = 2 }",
        "x = { a = {}, a.b = 2 }",
        "a = \"\\q\"",
        "a = \"\\uD800\"",
        "a = \"\\U00110000\"",
        "a = \"\\xGG\"",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    for literal in [
        "2026-08-26T12:34:56.789Z",
        "2026-08-26t12:34:56.789z",
        "2026-08-26T12:34:56.789+05:30",
        "2026-08-26T12:34:56.789-08:00",
        "2026-08-26 12:34:56.789123",
        "2026-08-26",
        "12:34:56.789123",
        "12:34",
        "12:34Z",
        "12:34+05:30",
        "2026-02-31",
        "0000-01-01",
        "9999-12-31T23:59:59.999-23:59",
        "2026-13-01",
        "2026-01-00",
        "24:00:00",
        "12:60:00",
        "12:34:60",
        "2026-01-01T00:00:00+24:00",
    ] {
        cases.push(format!("value = {literal}"));
    }
    for input in [
        "[section]\nkey = 1\n",
        "[[section]]\nkey = [1, 2, true]\n",
        "key = { nested.item = 'text', arr = [1,2,] }\n",
        "\"quoted.key\" = \"escaped\\ntext\"\n",
        "key = \"\"\"\nmultiline\ntext\"\"\"\n",
    ] {
        for end in 0..=input.len() {
            cases.push(input[..end].to_owned());
        }
        for offset in 0..input.len() {
            cases.push(format!("{}{}", &input[..offset], &input[offset + 1..]));
        }
    }
    for value in [
        "true", "false", "1", "'text'", "\"text\"", "[]", "{}", "[1]", "{x=1}",
    ] {
        for source in [
            format!("x = [{value}"),
            format!("x = [{value} next]"),
            format!("x = {{ a = {value}"),
            format!("x = {{ a = {value} b = 1 }}"),
        ] {
            cases.push(source);
        }
    }
    cases.extend(
        ["x = [,]", "x = {,}", "x = { a =  }", "x = [  ", "x = {  "]
            .into_iter()
            .map(str::to_owned),
    );
    // Legacy parsing accepts a missing second table-array bracket at EOF.
    // Dedicated own coverage requires rejection of that malformed header.
    cases.retain(|source| source != "[[section]" && !source.starts_with("[[section]\n"));
    for year in [0, 1, 4, 99, 100, 400, 1900, 2000, 2024, 9999] {
        for month in [1, 2, 12] {
            for day in [1, 28, 29, 30, 31] {
                for offset in ["Z", "+00:00", "-00:00", "+05:30", "-23:59"] {
                    cases.push(format!(
                        "value = {year:04}-{month:02}-{day:02}T23:59:59.999999{offset}"
                    ));
                }
            }
        }
    }
    for literal in [
        "9007199254740992.0",
        "1000000000000000100.0",
        "1e21",
        "1.7976931348623157e308",
        "5e-324",
        "2.2250738585072014e-308",
    ] {
        cases.push(format!("value = {literal}"));
    }
    let expected = oracle(&cases);
    let mut failures = vec![];
    for (source, expected) in cases.iter().zip(expected) {
        let actual = match toml::parse(&u(source)) {
            Ok(value) => Json::Object(vec![
                (u("value"), wire(&value)),
                (
                    u("serialized"),
                    Json::String(toml::stringify(&value).unwrap()),
                ),
            ]),
            Err(error) => Json::Object(vec![
                (u("error"), Json::String(error.message_utf16())),
                (u("line"), Json::Number(error.line as f64)),
                (u("column"), Json::Number(error.column as f64)),
                (u("codeblock"), Json::String(error.codeblock)),
            ]),
        };
        if actual != expected {
            failures.push(format!(
                "{source:?}: {} != {}",
                json::stringify(&actual),
                json::stringify(&expected)
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
