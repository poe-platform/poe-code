use agent_defs_rust::{Registry, format_specifier, parse_specifier};
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn registry_owns_order_aliases_and_capability_policy() {
    let registry = Registry::builtins();
    assert_eq!(registry.definitions().len(), 9);
    assert_eq!(
        registry.resolve_normalized(&units("claude")),
        Some(&units("claude-code")[..])
    );
    assert_eq!(registry.resolve_normalized(&units("constructor")), None);
    assert_eq!(
        registry.list(&units("skill"), false),
        [
            "claude-code",
            "codex",
            "cursor",
            "gemini-cli",
            "opencode",
            "goose"
        ]
        .map(units)
    );
    assert!(
        registry
            .list(&units("spawn"), true)
            .contains(&units("pi-agent"))
    );
    assert!(
        !registry
            .list(&units("mcp"), false)
            .contains(&units("gemini-cli"))
    );
    assert!(registry.list(&units("missing"), true).is_empty());
}
#[test]
fn mcp_descriptors_share_one_agent_definition_without_changing_public_metadata() {
    let registry = Registry::builtins();
    let ids: Vec<_> = registry
        .definitions()
        .iter()
        .filter(|definition| definition.mcp_config.is_some())
        .map(|definition| definition.metadata.get("id").unwrap().clone())
        .collect();
    use mcp_protocol_rust::json::Value;
    assert_eq!(
        ids,
        [
            "claude-code",
            "claude-desktop",
            "codex",
            "cursor",
            "opencode",
            "goose"
        ]
        .map(|id| Value::String(units(id)))
    );
    for definition in registry.definitions() {
        assert!(definition.metadata.get("mcpConfig").is_none());
        if let Some(config) = &definition.mcp_config {
            assert!(config.get("configFile").is_some());
            assert!(config.get("configKey").is_some());
            assert!(config.get("format").is_some());
            assert!(config.get("shape").is_some());
        }
    }
    let desktop = registry
        .definitions()
        .iter()
        .find(|definition| {
            definition.metadata.get("id") == Some(&Value::String(units("claude-desktop")))
        })
        .unwrap();
    assert_eq!(
        desktop.mcp_config.as_ref().unwrap().get("mcpOutputFormat"),
        Some(&Value::String(units("markdown_instructions")))
    );
}
#[test]
fn custom_agent_mcp_descriptor_is_optional_and_must_be_a_json_object() {
    let source = r#"{"exportName":"custom","definition":{"id":"custom","label":"Custom","summary":"Own provider"},"mcpConfig":{"configFile":"~/custom.json","configKey":"mcp","format":"json","shape":"standard"}}"#;
    let registry = Registry::from_json([source]).unwrap();
    assert!(registry.definitions()[0].mcp_config.is_some());
    assert!(
        registry.definitions()[0]
            .metadata
            .get("mcpConfig")
            .is_none()
    );
    assert!(Registry::from_json([r#"{"exportName":"custom","definition":{"id":"custom","label":"Custom","summary":"Own provider"},"mcpConfig":false}"#]).is_err());
}
#[test]
fn specifiers_preserve_model_case_colons_and_lone_surrogates() {
    let spec = parse_specifier(&units("\u{feff} claude : Provider/Model:variant \u{a0}")).unwrap();
    assert_eq!(spec.agent, units("claude"));
    assert_eq!(spec.model, Some(units("Provider/Model:variant")));
    assert_eq!(
        format_specifier(&spec.agent, spec.model.as_deref()).unwrap(),
        units("claude:Provider/Model:variant")
    );
    assert!(parse_specifier(&units(" : model")).is_err());
    assert_eq!(parse_specifier(&units("codex: ")).unwrap().model, None);
    let text = vec![0xd800, 58, 0xdc00];
    let spec = parse_specifier(&text).unwrap();
    assert_eq!(
        format_specifier(&spec.agent, spec.model.as_deref()).unwrap(),
        text
    );
}
#[test]
fn capability_errors_distinguish_unknown_agents_typos_and_missing_support() {
    let registry = Registry::builtins();
    let typo = registry.capability_error(
        &units("claude-cod"),
        &units("claude-cod"),
        &units("install"),
    );
    assert!(
        String::from_utf16(&typo)
            .unwrap()
            .contains("Did you mean: claude-code?")
    );
    let pi = registry.capability_error(&units("PI-AGENT"), &units("pi-agent"), &units("install"));
    assert!(
        String::from_utf16(&pi)
            .unwrap()
            .contains("pi supports: spawn.")
    );
    let removed = registry.capability_error(&units("kimi"), &units("kimi"), &units("skill"));
    assert!(
        String::from_utf16(&removed)
            .unwrap()
            .starts_with("Unknown agent \"kimi\".")
    );
}
#[test]
fn telemetry_templates_escape_endpoints_and_render_content_flags() {
    let registry = Registry::builtins();
    let args = registry
        .telemetry_arguments(&units("codex"), &units("https://trace/\"\\\n😀"), true)
        .unwrap();
    assert_eq!(args.len(), 6);
    assert_eq!(args[0], units("-c"));
    assert_eq!(args[5], units("otel.log_user_prompt=true"));
    assert!(
        String::from_utf16(&args[1])
            .unwrap()
            .contains("\\\"\\\\\\n😀/v1/traces")
    );
    assert!(
        registry
            .telemetry_arguments(&units("pi"), &[], false)
            .is_none()
    );
}

#[test]
fn one_definition_derives_name_lookup_and_telemetry_capture() {
    let source = r#"{"exportName":"customAgent","definition":{"id":"custom","label":"Custom","summary":"An agent","aliases":["Alias"],"capabilities":["spawn"]},"argumentTemplates":["${content}","${endpointJson:/traces}"]}"#;
    let registry = Registry::from_json([source]).unwrap();
    assert_eq!(
        registry.resolve_normalized(&units("alias")),
        Some(&units("custom")[..])
    );
    assert_eq!(
        registry.definitions()[0].metadata.get("name"),
        Some(&mcp_protocol_rust::json::Value::String(units("custom")))
    );
    assert_eq!(
        registry.definitions()[0].metadata.get("otelCapture"),
        Some(&mcp_protocol_rust::json::Value::Object(vec![]))
    );
    assert_eq!(
        registry
            .telemetry_arguments(&units("custom"), &units("https://host"), false)
            .unwrap(),
        [units("false"), units("\"https://host/traces\"")]
    );
    assert_eq!(
        registry
            .normalize_specifier(&units(" Alias : Mixed/Model"), &units("alias"))
            .unwrap(),
        units("custom:Mixed/Model")
    );
}
