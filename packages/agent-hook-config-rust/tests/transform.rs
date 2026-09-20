use agent_hook_config_rust::{Catalog, Handler, SourceEntry, SupportStatus, transform_hooks};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn source(event: &str, kind: &str, command: Option<&str>) -> SourceEntry {
    SourceEntry {
        event: u(event),
        matcher: None,
        handler: Handler {
            kind: u(kind),
            command: command.map(u),
            args: None,
            timeout: None,
            status_message: None,
        },
    }
}
#[test]
fn catalog_derives_support_aliases_transform_pairs_and_placeholder_rules() {
    let catalog = Catalog::builtins().unwrap();
    assert_eq!(catalog.supported_agents(), [u("claude-code"), u("codex")]);
    assert_eq!(
        catalog.resolve_normalized(&u("claude")).status,
        SupportStatus::Supported
    );
    assert_eq!(
        catalog.resolve_normalized(&u("poe-agent")).status,
        SupportStatus::Unsupported
    );
    assert_eq!(
        catalog.resolve_normalized(&u("missing")).status,
        SupportStatus::Unknown
    );
    assert_eq!(
        catalog.transform_pairs(),
        vec![(u("claude-code"), u("codex"))]
    );
    assert_eq!(
        catalog
            .placeholder_rewrites(&u("claude"), &u("codex"))
            .unwrap()
            .len(),
        3
    );
    assert!(
        catalog
            .event_mappings(&u("claude"), &u("codex"))
            .unwrap()
            .iter()
            .any(
                |mapping| mapping.source_event == u("SessionEnd") && mapping.target_event.is_none()
            )
    );
}
#[test]
fn transform_owns_event_and_handler_drops_rewrites_and_stable_ids() {
    let catalog = Catalog::builtins().unwrap();
    let mut command = source(
        "PreToolUse",
        "command",
        Some("run ${CLAUDE_PROJECT_DIR}/${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_DATA}"),
    );
    command.matcher = Some(u("Bash"));
    command.handler.args = Some(vec![u("${CLAUDE_PROJECT_DIR}"), u("😀\u{feff}")]);
    command.handler.timeout = Some(10.0);
    command.handler.status_message = Some(u("running"));
    let entries = vec![
        source("SessionEnd", "command", Some("run")),
        source("PreToolUse", "http", None),
        source("PreToolUse", "command", Some("\u{feff} \t")),
        command,
    ];
    let result =
        transform_hooks(&catalog, &entries, &u("claude"), &u("codex"), &u("round")).unwrap();
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.drops.len(), 3);
    assert_eq!(result.drops[0].source_index, 0);
    assert_eq!(result.drops[0].reason, "unsupported-event");
    assert_eq!(result.drops[1].reason, "unsupported-handler-type");
    assert_eq!(
        result.drops[2].detail,
        u("Command hook is missing an executable command")
    );
    let entry = &result.entries[0];
    assert_eq!(entry.generated_id, u("generated-round-0"));
    assert_eq!(
        entry.handler.command,
        Some(u(
            "run $(git rev-parse --show-toplevel)/$PLUGIN_ROOT/$PLUGIN_DATA"
        ))
    );
    assert_eq!(
        entry.handler.status_message,
        Some(u("[generated:poe-code:round] running"))
    );
    assert_eq!(entry.handler.timeout, Some(10.0));
    assert_eq!(entry.matcher, Some(u("Bash")));
    assert_eq!(
        entry.handler.args.as_ref().unwrap()[0],
        u("$(git rev-parse --show-toplevel)")
    );
    assert_eq!(
        entries[3].handler.command.as_ref().unwrap(),
        &u("run ${CLAUDE_PROJECT_DIR}/${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_DATA}")
    );
}

#[test]
fn mapping_resolves_case_insensitive_aliases_but_preserves_requested_target_in_drop_detail() {
    let catalog = Catalog::builtins().unwrap();
    let mappings = catalog.event_mappings(&u(" CLAUDE "), &u("CoDeX")).unwrap();
    let missing = mappings
        .iter()
        .find(|mapping| mapping.source_event == u("SessionEnd"))
        .unwrap();
    assert_eq!(missing.drop_reason, Some(u("CoDeX has no SessionEnd hook")));
}
