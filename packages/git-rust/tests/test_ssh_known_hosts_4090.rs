use git_rust::crypto::{base64_encode, sha1_hmac};
use git_rust::ssh::host_matches_known_hosts_entry;

#[test]
fn known_hosts_plain_and_hashed_entries_are_port_specific() {
    for host in ["example.com", "[example.com]:2222"] {
        let hashed = format!(
            "|1|{}|{}",
            base64_encode(b"salt"),
            base64_encode(&sha1_hmac(b"salt", host.as_bytes()))
        );
        for entry in [host, hashed.as_str()] {
            assert_eq!(
                host_matches_known_hosts_entry(entry, "example.com", 22),
                host == "example.com"
            );
            assert_eq!(
                host_matches_known_hosts_entry(entry, "example.com", 2222),
                host != "example.com"
            );
            assert!(!host_matches_known_hosts_entry(entry, "example.com", 3333));
        }
    }
    assert!(host_matches_known_hosts_entry(
        "other,example.com",
        "example.com",
        22
    ));
    assert!(!host_matches_known_hosts_entry(
        "other,example.com",
        "example.com",
        2222
    ));
}
