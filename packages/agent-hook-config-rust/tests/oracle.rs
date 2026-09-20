//! Actual SDK references run against memfs; no unit fixture touches disk.
use agent_hook_config_rust::{
    Catalog, GeneratedEntry, Handler, SourceEntry,
    files::{mutate_file, read_settings},
    transform_hooks,
};
use mcp_protocol_rust::json::{self, Limits, Value};
use std::{
    io::Write,
    process::{Command, Stdio},
};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn s(value: &str) -> Value {
    Value::String(u(value))
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (u(key), value))
            .collect(),
    )
}
fn handler(value: &Handler) -> Value {
    let mut fields = vec![(u("type"), Value::String(value.kind.clone()))];
    for (key, value) in [
        ("command", &value.command),
        ("statusMessage", &value.status_message),
    ] {
        if let Some(value) = value {
            fields.push((u(key), Value::String(value.clone())));
        }
    }
    if let Some(args) = &value.args {
        fields.push((
            u("args"),
            Value::Array(args.iter().cloned().map(Value::String).collect()),
        ));
    }
    if let Some(timeout) = value.timeout {
        fields.push((u("timeout"), Value::Number(timeout)));
    }
    Value::Object(fields)
}
fn source(value: &SourceEntry) -> Value {
    let mut fields = vec![
        (u("event"), Value::String(value.event.clone())),
        (u("handler"), handler(&value.handler)),
    ];
    if let Some(matcher) = &value.matcher {
        fields.push((u("matcher"), Value::String(matcher.clone())));
    }
    Value::Object(fields)
}
fn generated(value: &GeneratedEntry) -> Value {
    let mut fields = vec![(u("event"), Value::String(value.event.clone()))];
    if let Some(matcher) = &value.matcher {
        fields.push((u("matcher"), Value::String(matcher.clone())));
    }
    fields.push((u("handler"), handler(&value.handler)));
    fields.push((u("generatedId"), Value::String(value.generated_id.clone())));
    Value::Object(fields)
}
fn compare(actual: Value, expected: Vec<Value>) {
    let Value::Array(actual) = actual else {
        panic!("SDK must return case array");
    };
    assert_eq!(actual.len(), expected.len());
    for (index, (actual, expected)) in actual.into_iter().zip(expected).enumerate() {
        assert!(
            actual == expected,
            "Case {index}: SDK {} vs Rust {}",
            json::stringify(&actual),
            json::stringify(&expected)
        );
    }
}
fn sdk(script: &str, cases: Vec<Value>) -> Value {
    let mut child = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(json::stringify(&Value::Array(cases)).as_bytes())
        .unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    json::parse(&result.stdout, Limits::default()).unwrap()
}
#[test]
fn generated_hook_transforms_and_alias_errors_match_the_current_sdk() {
    let catalog = Catalog::builtins().unwrap();
    let mut cases = vec![];
    let mut expected = vec![];
    for seed in 0..128 {
        let from = ["claude-code", " CLAUDE ", "codex", "missing"][seed % 4];
        let to = ["codex", "CoDeX", "claude-code", "unknown"][(seed / 4) % 4];
        let events = [
            "SessionStart",
            "SessionEnd",
            "PreToolUse",
            "Stop",
            "Notification",
            "Unknown",
        ];
        let types = ["command", "http", "mcp_tool", "prompt", "agent", "unknown"];
        let mut sources = vec![];
        for index in 0..4 {
            let mut command =
                u("run ${CLAUDE_PROJECT_DIR}/${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_DATA}");
            if seed & 16 != 0 {
                command.push(0xd800);
            }
            let command = match (seed + index) % 4 {
                0 => None,
                1 => Some(u("\u{feff} \t")),
                _ => Some(command),
            };
            sources.push(SourceEntry {
                event: u(events[(seed + index) % events.len()]),
                matcher: (seed & 1 == 0).then(|| u(if index % 2 == 0 { "" } else { "Bash" })),
                handler: Handler {
                    kind: u(types[(seed + index) % types.len()]),
                    command,
                    args: (seed & 2 == 0)
                        .then(|| vec![u("${CLAUDE_PROJECT_DIR}"), u("$PLUGIN_ROOT/😀")]),
                    timeout: (seed & 4 == 0).then_some(2.5),
                    status_message: (seed & 8 == 0).then(|| u("prior")),
                },
            });
        }
        let raw = Value::Array(sources.iter().map(source).collect());
        let run = u(&format!("run-{seed}"));
        cases.push(object(vec![
            ("source", raw.clone()),
            ("from", s(from)),
            ("to", s(to)),
            ("runId", Value::String(run.clone())),
        ]));
        let output = match transform_hooks(&catalog, &sources, &u(from), &u(to), &run) {
            Err(error) => object(vec![("error", Value::String(error))]),
            Ok(result) => {
                let Value::Array(raw) = &raw else {
                    unreachable!()
                };
                object(vec![
                    (
                        "entries",
                        Value::Array(result.entries.iter().map(generated).collect()),
                    ),
                    (
                        "drops",
                        Value::Array(
                            result
                                .drops
                                .iter()
                                .map(|drop| {
                                    object(vec![
                                        ("reason", s(drop.reason)),
                                        ("detail", Value::String(drop.detail.clone())),
                                        ("source", raw[drop.source_index].clone()),
                                    ])
                                })
                                .collect(),
                        ),
                    ),
                ])
            }
        };
        expected.push(output);
    }
    let script = "import{transformHooks}from'../agent-hook-config/dist/index.js';let input='';for await(const chunk of process.stdin)input+=chunk;const result=JSON.parse(input).map(({source,from,to,runId})=>{try{return transformHooks(source,from,to,{runId});}catch(error){return {error:error.message};}});console.log(JSON.stringify(result));";
    compare(sdk(script, cases), expected);
}
#[test]
fn generated_file_mutations_and_read_records_match_sdk_using_memfs() {
    let catalog = Catalog::builtins().unwrap();
    let mut cases = vec![];
    let mut expected = vec![];
    for seed in 0..64 {
        let run = u("current");
        let source = SourceEntry {
            event: u("Stop"),
            matcher: (seed & 1 == 0).then(|| u("")),
            handler: Handler {
                kind: u("command"),
                command: Some(u("new")),
                args: (seed & 2 == 0).then(|| vec![u("arg")]),
                timeout: (seed & 4 == 0).then_some(3.0),
                status_message: None,
            },
        };
        let incoming = transform_hooks(&catalog, &[source], &u("claude"), &u("codex"), &run)
            .unwrap()
            .entries;
        let mut groups = vec![
            object(vec![
                ("custom", Value::Bool(true)),
                (
                    "hooks",
                    Value::Array(vec![
                        object(vec![("type", s("command")), ("command", s("user first"))]),
                        object(vec![
                            ("type", s("command")),
                            ("statusMessage", s("[generated:poe-code:old] stale")),
                        ]),
                        object(vec![("type", s("command")), ("command", s("user last"))]),
                    ]),
                ),
            ]),
            object(vec![("matcher", s("")), ("hooks", Value::Array(vec![]))]),
        ];
        if seed & 8 == 0 {
            groups.push(object(vec![
                ("matcher", s("stale")),
                (
                    "hooks",
                    Value::Array(vec![object(vec![(
                        "statusMessage",
                        s("[generated:poe-code:old]"),
                    )])]),
                ),
            ]));
        }
        let hooks = object(vec![
            ("Stop", Value::Array(groups)),
            ("Empty", Value::Array(vec![])),
        ]);
        let file = if seed & 16 == 0 {
            object(vec![("extra", s("preserved")), ("hooks", hooks)])
        } else {
            object(vec![("extra", s("preserved"))])
        };
        let preserve = seed & 32 == 0;
        let entries = read_settings(&file, &u("/work/.claude/settings.json")).unwrap();
        let read = Value::Array(
            entries
                .into_iter()
                .map(|entry| {
                    let mut fields = vec![(u("event"), Value::String(entry.event))];
                    if let Some(matcher) = entry.matcher {
                        fields.push((u("matcher"), matcher));
                    }
                    fields.push((u("handler"), entry.handler));
                    Value::Object(fields)
                })
                .collect(),
        );
        let output = mutate_file(
            file.clone(),
            &incoming,
            &run,
            preserve,
            &u("/work/.codex/hooks.json"),
        )
        .unwrap();
        cases.push(object(vec![
            ("file", file),
            (
                "entries",
                Value::Array(incoming.iter().map(generated).collect()),
            ),
            ("preserveGenerated", Value::Bool(preserve)),
        ]));
        expected.push(object(vec![
            ("file", output.file),
            ("removed", Value::Number(output.removed as f64)),
            ("written", Value::Number(output.written as f64)),
            ("read", read),
        ]));
    }
    let script = "import fs from'node:fs';import{syncBuiltinESMExports}from'node:module';import{fs as memory,vol}from'memfs';import{readClaudeHooks,writeCodexHooks}from'../agent-hook-config/dist/index.js';for(const name of['lstatSync','readFileSync','mkdirSync','writeFileSync','renameSync','unlinkSync'])fs[name]=memory[name];syncBuiltinESMExports();let input='';for await(const chunk of process.stdin)input+=chunk;const results=[];for(const{file,entries,preserveGenerated}of JSON.parse(input)){vol.reset();vol.fromJSON({'/work/.claude/settings.json':JSON.stringify(file),'/work/.codex/hooks.json':JSON.stringify(file)});const read=readClaudeHooks('/work','/home',{scope:'project'}).entries;const result=writeCodexHooks('/work/.codex/hooks.json',entries,'current',{preserveGenerated});results.push({file:JSON.parse(vol.readFileSync('/work/.codex/hooks.json','utf8')),removed:result.previousGeneratedRemoved,written:result.generatedWritten,read});}console.log(JSON.stringify(results));";
    compare(sdk(script, cases), expected);
}
