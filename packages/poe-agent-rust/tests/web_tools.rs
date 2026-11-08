use poe_agent_rust::web_tools::{non_public_host, normalize_content_type, page};
fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn host_policy_and_pagination_follow_url_and_utf16_semantics() {
    for host in [
        "localhost",
        "LOCALHOST.",
        "a.localhost",
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "[::1]",
        "[fc00::1]",
    ] {
        assert!(non_public_host(&units(host)), "{host}");
    }
    for host in [
        "example.com",
        "8.8.8.8",
        "172.32.0.1",
        "[2001:4860:4860::8888]",
    ] {
        assert!(!non_public_host(&units(host)), "{host}");
    }
    assert_eq!(
        normalize_content_type(Some(&units(" Text/HTML ; charset=utf-8"))),
        units("text/html")
    );
    let content = [vec![120; 19999], vec![0xd83c, 0xdf0d, 0xd800]].concat();
    let first = page(
        &units("https://example.test/"),
        &units("text/plain"),
        &content,
        0,
    );
    assert!(first.starts_with(&units("URL: https://example.test/\nContent type: text/plain\nShowing characters 0-20000 of 20002.\nMore content available at offset 20000.\n\n")));
    assert_eq!(first.last(), Some(&0xd83c));
    assert!(page(&units("u"), &units("unknown"), &content, 20000).ends_with(&[0xdf0d, 0xd800]));
}
