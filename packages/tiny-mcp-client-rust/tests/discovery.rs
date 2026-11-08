use mcp_protocol_rust::json::Value;
use tiny_mcp_client_rust::discovery::{CacheIndex, UrlFacts, metadata_paths, validate_secure};

#[test]
fn raw_rust_metadata_rejects_boolean_array_elements() {
    let input = Value::Object(vec![
        (
            "response_types_supported".encode_utf16().collect(),
            Value::Array(vec![
                Value::Bool(true),
                Value::String("code".encode_utf16().collect()),
            ]),
        ),
        (
            "code_challenge_methods_supported".encode_utf16().collect(),
            Value::Array(vec![Value::String("S256".encode_utf16().collect())]),
        ),
    ]);
    assert!(tiny_mcp_client_rust::discovery::metadata_policy("arrays", &input, &[], &[]).is_err());
}

#[test]
fn secure_metadata_urls_allow_only_tls_or_actual_loopback() {
    for hostname in ["localhost", "LOCALHOST.", "[::1]", "::1", "127.255.0.1"] {
        assert!(
            validate_secure(
                &UrlFacts {
                    protocol: "http:",
                    hostname,
                    credentials: false,
                    fragment: false
                },
                "metadata"
            )
            .is_ok()
        );
    }
    for hostname in [
        "127.attacker.test",
        "127.0.0.1.attacker.test",
        "128.0.0.1",
        "127.999.0.1",
        "127.1",
        "example.test",
    ] {
        assert!(
            validate_secure(
                &UrlFacts {
                    protocol: "http:",
                    hostname,
                    credentials: false,
                    fragment: false
                },
                "metadata"
            )
            .is_err()
        );
    }
    for (credentials, fragment) in [(true, false), (false, true)] {
        assert!(
            validate_secure(
                &UrlFacts {
                    protocol: "https:",
                    hostname: "example.test",
                    credentials,
                    fragment
                },
                "metadata"
            )
            .unwrap_err()
            .contains("credentials or fragment")
        );
    }
}

#[test]
fn metadata_paths_preserve_encoded_path_and_oidc_fallback_order() {
    assert_eq!(
        metadata_paths("/", true),
        vec![
            "/.well-known/oauth-authorization-server",
            "/.well-known/openid-configuration"
        ]
    );
    assert_eq!(
        metadata_paths("/a%2Fb/", true),
        vec![
            "/.well-known/oauth-authorization-server/a%2Fb/",
            "/.well-known/openid-configuration/a%2Fb/",
            "/a%2Fb/.well-known/openid-configuration"
        ]
    );
    assert_eq!(
        metadata_paths("/mcp", false),
        vec!["/.well-known/oauth-protected-resource/mcp"]
    );
}

#[test]
fn replacing_cached_resources_releases_indexes_without_pinning_host_values() {
    let mut cache = CacheIndex::default();
    for index in 0..4096 {
        let (slot, replaced) = cache.insert(vec![120]).unwrap();
        assert_eq!(slot, index + 1);
        assert_eq!(replaced, (index > 0).then_some(index));
        assert_eq!(cache.get(&[120]), Some(slot));
        assert_eq!(cache.len(), 1);
    }
}
