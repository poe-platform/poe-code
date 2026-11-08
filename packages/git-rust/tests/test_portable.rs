use git_rust::http::{GitHttpRequest, HttpClient, MockHttpServer};
use git_rust::portable::execute_portable;
use mcp_protocol_rust::json::{self, Value};
use std::collections::BTreeMap;

fn text(s: &str) -> Value {
    Value::String(s.encode_utf16().collect())
}
fn string(v: &Value) -> String {
    if let Value::String(s) = v {
        String::from_utf16(s).unwrap()
    } else {
        panic!("expected string")
    }
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}

#[test]
fn portable_http_replay_fetches_objects_without_host_files() {
    let server = MockHttpServer::new();
    let mut responses = Vec::new();
    let entries=vec![
        object(vec![("path",text("/repo/.git")),("kind",text("directory")),("mode",Value::Number(0o755 as f64)),("data",text(""))]),
        object(vec![("path",text("/repo/.git/HEAD")),("kind",text("file")),("mode",Value::Number(0o644 as f64)),("data",text(&hex(b"ref: refs/heads/master\n")))]),
        object(vec![("path",text("/repo/.git/config")),("kind",text("file")),("mode",Value::Number(0o644 as f64)),("data",text(&hex(b"[remote \"origin\"]\nurl = http://localhost:8888/test-fetch-server.git\nfetch = +refs/heads/*:refs/remotes/origin/*\n")))]),
    ];
    for _ in 0..8 {
        let input = object(vec![
            ("cwd", text("/repo")),
            (
                "args",
                Value::Array(vec![
                    text("fetch"),
                    text("--prune"),
                    text("origin"),
                    text("master"),
                ]),
            ),
            ("entries", Value::Array(entries.clone())),
            ("responses", Value::Array(responses.clone())),
        ]);
        let output = execute_portable(json::stringify(&input).as_bytes()).unwrap();
        let output = json::parse(&output, json::Limits::default()).unwrap();
        if output.get("request") == Some(&Value::Null) {
            assert_eq!(
                output.get("exitCode"),
                Some(&Value::Number(0.0)),
                "{}",
                json::stringify(&output)
            );
            let Value::Array(entries) = output.get("entries").unwrap() else {
                panic!()
            };
            assert!(
                entries
                    .iter()
                    .any(|e| string(e.get("path").unwrap())
                        == "/repo/.git/refs/remotes/origin/master")
            );
            return;
        }
        let request = output.get("request").unwrap();
        let Value::Object(headers) = request.get("headers").unwrap() else {
            panic!()
        };
        let headers: BTreeMap<_, _> = headers
            .iter()
            .map(|(k, v)| (String::from_utf16(k).unwrap(), string(v)))
            .collect();
        let response = server
            .request(GitHttpRequest {
                url: string(request.get("url").unwrap()),
                method: string(request.get("method").unwrap()),
                headers,
                body: unhex(&string(request.get("body").unwrap())),
            })
            .unwrap();
        let headers = Value::Object(
            response
                .headers
                .iter()
                .map(|(k, v)| (k.encode_utf16().collect(), text(v)))
                .collect(),
        );
        responses.push(object(vec![
            ("status", Value::Number(response.status_code as f64)),
            ("headers", headers),
            ("body", text(&hex(&response.body))),
        ]));
    }
    panic!("fetch exceeded HTTP replay rounds");
}

#[test]
fn portable_request_has_no_implicit_byte_or_node_budget() {
    // Unknown metadata is ignored, but still goes through the real JSON parser.
    for padding in [
        format!("\"{}\"", "x".repeat(16 * 1024 * 1024)),
        format!("[{}]", vec!["0"; 262_145].join(",")),
    ] {
        let input =
            format!(r#"{{"cwd":"/repo","args":["init"],"entries":[],"metadata":{padding}}}"#);
        let output = execute_portable(input.as_bytes()).unwrap();
        let result = json::parse(&output, json::Limits::default()).unwrap();
        assert_eq!(result.get("exitCode"), Some(&Value::Number(0.0)));
    }
}
