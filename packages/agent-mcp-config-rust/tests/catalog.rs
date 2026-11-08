use agent_defs_rust::Registry;
use agent_mcp_config_rust::{
    Catalog, Support,
    validation::{Request, Validation},
};
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn declarative_catalog_keeps_support_order_aliases_and_platform_fallback() {
    let catalog = Catalog::new(Registry::builtins()).unwrap();
    assert_eq!(
        catalog.supported(),
        [
            "claude-code",
            "claude-desktop",
            "codex",
            "cursor",
            "opencode",
            "goose"
        ]
        .map(units)
    );
    assert!(matches!(
        catalog.resolve(&units("claude")),
        Support::Supported { .. }
    ));
    assert!(matches!(
        catalog.resolve(&units("gemini")),
        Support::Unsupported(_)
    ));
    assert!(matches!(
        catalog.resolve(&units("constructor")),
        Support::Unknown
    ));
    let Support::Supported { config, .. } = catalog.resolve(&units("claude-desktop")) else {
        panic!()
    };
    assert_eq!(
        config.path(&units("darwin")),
        units("~/Library/Application Support/Claude/claude_desktop_config.json")
    );
    assert_eq!(
        config.path(&units("win32")),
        units("~/AppData/Roaming/Claude/claude_desktop_config.json")
    );
    assert_eq!(
        config.path(&units("other")),
        units("~/.config/Claude/claude_desktop_config.json")
    );
}
#[test]
fn a_single_new_agent_definition_derives_its_mcp_support() {
    let source = r#"{"exportName":"newAgent","definition":{"id":"new","label":"New","summary":"Own","aliases":["alias"]},"mcpConfig":{"configFile":"~/own.json","configKey":"servers","format":"json","shape":"standard"}}"#;
    let catalog = Catalog::new(Registry::from_json([source]).unwrap()).unwrap();
    assert_eq!(catalog.supported(), [units("new")]);
    let Support::Supported { id, config } = catalog.resolve(&units("alias")) else {
        panic!()
    };
    assert_eq!(id, units("new"));
    assert_eq!(config.path(&units("linux")), units("~/own.json"));
}
#[test]
fn validation_short_circuits_and_preserves_capability_order() {
    let mut validation = Validation::new();
    assert_eq!(validation.request(), Request::Name);
    validation.respond(false).unwrap();
    assert_eq!(
        validation.request(),
        Request::Error("MCP server name must be a non-empty string.")
    );
    let mut validation = Validation::new();
    for (expected, result) in [
        (Request::Name, true),
        (Request::Transport, false),
        (Request::Url, true),
        (Request::ParseUrl, true),
        (Request::Http, false),
        (Request::Https, true),
    ] {
        assert_eq!(validation.request(), expected);
        validation.respond(result).unwrap();
    }
    assert_eq!(validation.request(), Request::Done);
    assert!(validation.respond(true).is_err());
    let mut validation = Validation::new();
    for result in [true, true, false] {
        validation.respond(result).unwrap();
    }
    assert_eq!(
        validation.request(),
        Request::Error("MCP stdio command must be a non-empty string.")
    );
    let mut validation = Validation::new();
    for result in [true, false, true, false] {
        validation.respond(result).unwrap();
    }
    assert_eq!(
        validation.request(),
        Request::Error("MCP HTTP URL must be a valid http or https URL.")
    );
}
