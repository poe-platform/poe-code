use git_rust::models::{GitConfig, GitPktLine};
use git_rust::wire::parse_receive_pack_response;

#[test]
fn malformed_config_and_unicode_push_status_do_not_panic() {
    let _ = GitConfig::from("[remote \"]\n");
    let mut response = GitPktLine::encode(b"unpack ok\n");
    response.extend(GitPktLine::encode(
        "💥 refs/heads/main rejected\n".as_bytes(),
    ));
    response.extend(b"0000");
    assert!(parse_receive_pack_response(&response).is_err());
}

