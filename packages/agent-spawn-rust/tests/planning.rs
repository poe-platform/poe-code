use agent_spawn_rust::{Planner, mcp, resolve_mode};
use mcp_protocol_rust::json::{self, Value};
fn v(source: &str) -> Value {
    json::parse_utf16(
        &source.encode_utf16().collect::<Vec<_>>(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn permission_admission_redaction_and_resume_are_declarative() {
    let planner = Planner::builtins();
    assert!(
        planner
            .build("pi", &v(r#"{"prompt":"p"}"#), None)
            .unwrap_err()
            .contains("does not support mode \"auto\"")
    );
    let built=planner.build("codex",&v(r#"{"prompt":"secret","mode":"read","resumeThreadId":"thread","model":"openai/gpt-5","args":["extra"]}"#),None).unwrap();
    assert_eq!(built.get("binaryName"), Some(&v(r#""codex""#)));
    assert_eq!(
        built.get("args"),
        Some(&v(
            r#"["exec","--model","gpt-5","--skip-git-repo-check","--json","-s","read-only","--enable","use_legacy_landlock","extra","resume","thread","secret"]"#
        ))
    );
    assert_eq!(built.get("displayArgs").unwrap().get("bad"), None);
    let Value::Array(args) = built.get("displayArgs").unwrap() else {
        panic!()
    };
    assert_eq!(args.last(), Some(&v(r#""[prompt redacted]""#)));
}
#[test]
fn mcp_serializers_preserve_names_and_admit_only_supported_features() {
    let servers =
        v(r#"{"server.name":{"command":"node","args":["--flag"],"env":{"X":"yes"},"timeout":3}}"#);
    let args = mcp::serialize(&servers, "codex").unwrap();
    let Value::Array(args) = args else { panic!() };
    assert_eq!(
        args[1],
        v(r#""mcp_servers.\"server.name\".command=\"node\"""#)
    );
    assert!(
        mcp::serialize(&servers, "goose")
            .unwrap_err()
            .contains("does not support env")
    );
    assert!(
        mcp::serialize(&servers, "opencode")
            .unwrap_err()
            .contains("does not support timeout")
    );
    assert!(resolve_mode(&v(r#"{"agentId":"custom","modes":{"read":[]}}"#), None).is_err());
}
#[test]
fn a_custom_provider_needs_only_its_declarative_definition() {
    let registry=agent_defs_rust::Registry::from_json([r#"{"exportName":"customAgent","definition":{"id":"custom","label":"Custom","summary":"Custom","binaryName":"custom-bin","aliases":["alias"]},"spawnConfig":{"kind":"cli","adapter":"native","defaultArgs":["run"],"defaultArgsPosition":"beforePrompt","modelStripProviderPrefix":true,"modes":{"auto":[]},"resume":{"argsTemplate":["--resume","{{threadId}}"]}}}"#]).unwrap();
    let planner = Planner::new(registry);
    let result = planner
        .build(
            "alias",
            &v(r#"{"prompt":"p","resumeThreadId":"{{cwd}}"}"#),
            None,
        )
        .unwrap();
    assert_eq!(
        result.get("args"),
        Some(&v(r#"["run","p","--resume","{{cwd}}"]"#))
    );
}
