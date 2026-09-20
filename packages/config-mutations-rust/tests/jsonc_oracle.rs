//! Development-only conformance oracle; no filesystem fixtures or runtime SDK.
use config_mutations_rust::jsonc::{self, PathSegment};
use mcp_protocol_rust::json::{self as json, Limits, Value};
use std::{
    io::Write,
    process::{Command, Stdio},
};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn s(s: &str) -> Value {
    Value::String(u(s))
}
fn oracle(requests: Value, mode: &str) -> Value {
    let script = r#"
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const jsonc=createRequire(process.cwd()+'/package.json')('jsonc-parser');
const requests=JSON.parse(readFileSync(0,'utf8'));
const mode=process.argv[1];
const output=requests.map(([source,path,value,remove])=>{
 if(mode==='parse') {
  if(!source.trim()) return {value:{}};
  const errors=[]; const value=jsonc.parse(source,errors,{allowTrailingComma:true});
  if(errors.length) return {error:'JSON parse error: '+jsonc.printParseErrorCode(errors[0].error),offset:errors[0].offset};
  if(value===null) return {value:{}};
  if(typeof value!=='object'||Array.isArray(value)) return {error:'Expected JSON object.',offset:0};
  return {value};
 }
 try{
  const indent=source.match(/^[\t ]+/m)?.[0]??'  ';
  const edits=jsonc.modify(source,path,remove?undefined:value,{formattingOptions:{tabSize:indent==='\t'?1:indent.length,insertSpaces:indent!=='\t',eol:'\n'}});
  let result=jsonc.applyEdits(source,edits); if(!result.endsWith('\n'))result+='\n'; return {result};
 }catch(error){return {error:error.message};}
});
process.stdout.write(JSON.stringify(output));
"#;
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let mut child = Command::new("node")
        .args(["--input-type=module", "-e", script, mode])
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
        .write_all(json::stringify(&requests).as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    json::parse(&output.stdout, Limits::default()).unwrap()
}
#[test]
fn parser_matches_development_sdk_for_truncations_and_lexical_errors() {
    let mut cases = vec![
        "".to_owned(),
        "null".to_owned(),
        "[]".to_owned(),
        "// comment".to_owned(),
        "/* comment */".to_owned(),
        "/* unclosed".to_owned(),
        "-".to_owned(),
        "{} // after".to_owned(),
        "\u{feff}{}".to_owned(),
    ];
    let document = r#"{"a":1,"nested":{"b":[true,false,null,"string"]}}"#;
    for offset in 0..document.len() {
        cases.push(format!(
            "{}{}",
            &document[..offset],
            &document[offset + 1..]
        ));
        for token in [",", ":", "}", "[", " ", "\t", "\u{a0}", "/*c*/", "//c\n"] {
            cases.push(format!(
                "{}{token}{}",
                &document[..offset],
                &document[offset..]
            ));
        }
    }
    for input in [
        r#"{"a":1,"nested":{"b":[true,false,null,"str\\\"ing"]}}"#,
        r#"{"a":1.}"#,
        r#"{"a":1e}"#,
        r#"{"a":"\q"}"#,
        r#"{"a":"\uZZZZ"}"#,
        r#"{"a":01}"#,
        r#"{"a":truefalse}"#,
        r#"{"a":[1,2,],}"#,
        "{\"a\":\"\t\"}",
    ] {
        for end in 0..=input.len() {
            if input.is_char_boundary(end) {
                cases.push(input[..end].to_owned());
            }
        }
    }
    let requests = Value::Array(cases.iter().map(|v| Value::Array(vec![s(v)])).collect());
    let Value::Array(expected) = oracle(requests, "parse") else {
        panic!()
    };
    let mut mismatches = vec![];
    for (input, expected) in cases.iter().zip(expected) {
        let actual = match jsonc::parse_object(&u(input)) {
            Ok(value) => Value::Object(vec![(u("value"), value)]),
            Err(error) => Value::Object(vec![
                (u("error"), s(&error.message)),
                (u("offset"), Value::Number(error.offset as f64)),
            ]),
        };
        // JSON.stringify normalizes infinity to null in the oracle transport.
        if json::stringify(&actual) != json::stringify(&expected) {
            mismatches.push(format!(
                "{input:?}: {} != {}",
                json::stringify(&actual),
                json::stringify(&expected)
            ));
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
#[test]
fn editor_matches_development_sdk_for_comments_arrays_and_line_endings() {
    let sources = [
        "{}",
        "{\"a\":1}",
        "{\"a\":1,\"b\":2}",
        "{\n  // retained\n  \"a\":1, // a\n  \"b\": {\"x\":true},\n  \"list\": [1, 2, 3]\n}",
        "{\r\n\t\"a\":1,\r\n\t\"list\":[1,2,3,],\r\n}",
        "{\r    \"a\":1, /* suffix */\r    \"list\":[1,2,3]\r}",
        "{ /* before */ \"a\":1, /* after */ }",
        "{\"list\":[1,2,3]}",
        "",
        "// retained\n{}",
    ];
    let paths = vec![
        vec![],
        vec![PathSegment::Key(u("a"))],
        vec![PathSegment::Key(u("new"))],
        vec![PathSegment::Key(u("b")), PathSegment::Key(u("y"))],
        vec![PathSegment::Key(u("list")), PathSegment::Index(-1)],
        vec![PathSegment::Key(u("list")), PathSegment::Index(0)],
        vec![PathSegment::Key(u("list")), PathSegment::Index(1)],
        vec![PathSegment::Key(u("list")), PathSegment::Index(2)],
        vec![PathSegment::Key(u("list")), PathSegment::Index(20)],
    ];
    let values = [
        Some(Value::Bool(true)),
        Some(Value::Object(vec![(
            u("nested"),
            Value::Array(vec![s("text"), Value::Number(3.0)]),
        )])),
        None,
    ];
    let mut cases = vec![];
    let mut requests = vec![];
    for source in sources {
        for path in &paths {
            for value in &values {
                // Undefined append produces invalid JSON in the SDK; checked separately.
                // The SDK joins neighboring numbers when removing the last
                // array item. The own regression test checks correct removal.
                if value.is_none() && matches!(path.last(), Some(PathSegment::Index(2))) {
                    continue;
                }
                if value.is_none()
                    && path
                        .iter()
                        .any(|s| matches!(s, PathSegment::Index(-1 | 20)))
                {
                    continue;
                }
                requests.push(Value::Array(vec![
                    s(source),
                    Value::Array(
                        path.iter()
                            .map(|p| match p {
                                PathSegment::Key(k) => Value::String(k.clone()),
                                PathSegment::Index(i) => Value::Number(*i as f64),
                            })
                            .collect(),
                    ),
                    value.clone().unwrap_or(Value::Null),
                    Value::Bool(value.is_none()),
                ]));
                cases.push((source, path.clone(), value.clone()));
            }
        }
    }
    let Value::Array(expected) = oracle(Value::Array(requests), "edit") else {
        panic!()
    };
    let mut mismatches = vec![];
    for ((source, path, value), expected) in cases.into_iter().zip(expected) {
        let actual = match jsonc::modify(&u(source), &path, value) {
            Ok(result) => Value::Object(vec![(u("result"), Value::String(result))]),
            Err(error) => Value::Object(vec![(u("error"), s(&error.message))]),
        };
        // SDK out-of-range array deletion throws an implementation-specific TypeError.
        if actual.get("error").is_some() && expected.get("error").is_some() {
            continue;
        }
        if actual != expected {
            mismatches.push(format!(
                "{source:?} {path:?}: {} != {}",
                json::stringify(&actual),
                json::stringify(&expected)
            ));
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
