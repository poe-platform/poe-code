use agent_spawn_rust::adapters::Adapter;
use mcp_protocol_rust::json::Value;
#[test]
fn independent_adapters_preserve_surrogates_and_isolate_sessions() {
    let mut adapter = Adapter::new("claude").unwrap();
    let first=adapter.line(&r#"{"type":"assistant","session_id":"s","message":{"content":[{"type":"tool_use","id":"1","name":"Read","input":{"file_path":"x\ud800"}}]}}"#.encode_utf16().collect::<Vec<_>>());
    assert_eq!(first.len(), 2);
    let value = first[1].get("value").unwrap();
    assert_eq!(value.get("title"), Some(&Value::String(vec![120, 0xd800])));
    let mut other = Adapter::new("claude").unwrap();
    assert_eq!(other.tracked_tools(), 0);
    assert_eq!(adapter.tracked_tools(), 1);
    let events=other.line(&r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"1","content":"done"}]}}"#.encode_utf16().collect::<Vec<_>>());
    assert_eq!(events.len(), 2);
}
#[test]
fn codex_completion_without_start_emits_both_and_releases_tracking() {
    let mut adapter = Adapter::new("codex").unwrap();
    let events=adapter.line(&r#"{"type":"item.completed","item":{"type":"command_execution","id":"c","command":"pwd","exit_code":1}}"#.encode_utf16().collect::<Vec<_>>());
    assert_eq!(events.len(), 2);
    assert_eq!(adapter.tracked_tools(), 0);
    assert!(Adapter::new("constructor").is_err());
}

#[test]
fn codex_esbuild_diagnostic_preserves_output_and_ecmascript_whitespace() {
    for started in [false, true] {
        for prefix in ["error", "Error"] {
            let mut adapter = Adapter::new("codex").unwrap();
            let item = format!(
                r#"{{"type":"command_execution","id":"build","command":"bun build.ts","exit_code":1,"aggregated_output":"\ufeff{prefix}: The service was stopped\u00a0\n at /node_modules/esbuild/lib/main.js:1230\n\ud800\n"}}"#
            );
            if started {
                adapter.line(
                    &format!(r#"{{"type":"item.started","item":{item}}}"#)
                        .encode_utf16()
                        .collect::<Vec<_>>(),
                );
            }
            let events = adapter.line(
                &format!(r#"{{"type":"item.completed","item":{item}}}"#)
                    .encode_utf16()
                    .collect::<Vec<_>>(),
            );
            let diagnostic = events.last().unwrap().get("value").unwrap();
            assert_eq!(
                diagnostic.get("event"),
                Some(&Value::String("error".encode_utf16().collect()))
            );
            let Value::String(message) = diagnostic.get("message").unwrap() else {
                panic!("expected diagnostic text");
            };
            let mut expected = format!(
                "{prefix}: The service was stopped\u{a0}\n at /node_modules/esbuild/lib/main.js:1230\n"
            )
            .encode_utf16()
            .collect::<Vec<_>>();
            expected.extend([0xd800, 10]);
            assert!(message.starts_with(&expected));
            assert_eq!(adapter.tracked_tools(), 0);
        }
    }
}

#[test]
fn codex_mount_enospc_does_not_assume_host_exhaustion() {
    for failure in [
        "failed to register synthetic bubblewrap mount target /tmp/.git",
        "failed to create synthetic bubblewrap mount marker directory /tmp/codex-bwrap-synthetic-mount-targets-1/marker",
    ] {
        let mut adapter = Adapter::new("codex").unwrap();
        let output = format!(
            "thread 'main' panicked at linux-sandbox/src/linux_run_main.rs:994: {failure}: No space left on device (os error 28)"
        );
        let events = adapter.line(
            &format!(r#"{{"type":"item.completed","item":{{"type":"command_execution","id":"mount","exit_code":101,"aggregated_output":"{output}"}}}}"#)
                .encode_utf16().collect::<Vec<_>>(),
        );
        let diagnostic = events.last().unwrap().get("value").unwrap();
        let Value::String(message) = diagnostic.get("message").unwrap() else {
            panic!("expected diagnostic text");
        };
        let message = String::from_utf16(message).unwrap();
        assert!(message.starts_with(&output));
        assert!(message.contains("does not establish host disk exhaustion"));
        assert!(message.contains("mount namespace"));
        assert!(message.contains("quotas"));
        assert!(!message.contains("staging ran out of space"));
        assert!(message.contains("existing approval reviewer"));
        assert!(message.contains("set TMPDIR before launching a new Codex process"));
        assert!(
            message.contains("private directory on a filesystem with available blocks and inodes")
        );
        assert!(message.contains("does not relocate an already running session"));
        assert!(message.contains("does not prevent other writes to the full filesystem"));
    }
}
