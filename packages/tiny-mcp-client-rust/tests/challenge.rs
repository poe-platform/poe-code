use tiny_mcp_client_rust::challenge::parse_bearer;

fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

#[test]
fn bearer_selection_prefers_parameters_and_preserves_escape_pairs() {
    let input = units(
        "Basic abc==, Bearer, Digest realm=other, BEARER realm=\"a, b\", scope=\"read\\\"write\", realm=last",
    );
    let challenge = parse_bearer(&input).unwrap();
    assert_eq!(challenge.len(), 3);
    assert_eq!(challenge[0], (units("realm"), units("a, b")));
    assert_eq!(challenge[1], (units("scope"), units("read\"write")));
    assert_eq!(challenge[2], (units("realm"), units("last")));
    assert_eq!(parse_bearer(&units("Bearer abc==")), Some(vec![]));
    assert_eq!(parse_bearer(&units("Basic realm=only")), None);
}

#[test]
fn malformed_headers_and_lone_surrogates_terminate_without_loss() {
    assert_eq!(
        parse_bearer(&units("Bearer realm=\"unfinished")),
        Some(vec![(units("realm"), units("\"unfinished"))])
    );
    let input = [
        units("Bearer name=\"").as_slice(),
        &[0xd800],
        units("\"").as_slice(),
    ]
    .concat();
    assert_eq!(
        parse_bearer(&input),
        Some(vec![(units("name"), vec![0xd800])])
    );
    for input in [
        "",
        "=",
        "\"",
        ",,,,",
        "Bearer =",
        "Bearer a=,",
        "Bearer a=\"\\",
    ] {
        let _ = parse_bearer(&units(input));
    }
}
