use mcp_protocol_rust::formats::{is_base64, is_valid_uri};

fn uri(value: &str) -> bool {
    is_valid_uri(&value.encode_utf16().collect::<Vec<_>>())
}

#[test]
fn base64_requires_canonical_alphabet_padding_and_zero_unused_bits() {
    for source in [
        "", "Zg==", "Zm8=", "Zm9v", "AA==", "AAA=", "/w==", "//8=", "////",
    ] {
        assert!(
            is_base64(&source.encode_utf16().collect::<Vec<_>>()),
            "{source}"
        );
    }
    for source in [
        "Zg", "Zg=", "Zg===", "Zh==", "Zm9=", "AA=A", "=AAA", "AAAA====", "Zm9v\n", "____", "----",
        "🦀==",
    ] {
        assert!(
            !is_base64(&source.encode_utf16().collect::<Vec<_>>()),
            "{source}"
        );
    }
}

#[test]
fn accepts_absolute_opaque_encoded_and_ipv6_resource_uris() {
    for source in [
        "file:///some%20file",
        "https://example.com/a%2Fb?x=1#part",
        "urn:example:resource",
        "data:text/plain,hello",
        "file:///caf%C3%A9",
        "file:///a%3Cb",
        "urn:example:%7Bvalue%7D",
        "https://[::1]/resource",
        "https://user:pass@[2001:db8::1]:8080/resource",
        "https://example.test/a%5Bb%5D",
        "urn:example:a%5Bb%5D",
        "custom:",
        "custom:/path",
        "https:example.com/path",
        "https:///example.com/path",
        "http://127.1",
        "http://0xffffffff",
        "http://0300.0250.01.01",
    ] {
        assert!(uri(source), "{source}");
    }
}

#[test]
fn rejects_lossy_characters_relative_uris_bad_escape_and_misplaced_brackets() {
    for source in [
        "",
        "/relative",
        "1bad:resource",
        " file:///data",
        "file:///data ",
        "file:///some file",
        "file:///a\nb",
        "file:///a\tb",
        "https:\\example.com\\file",
        "file:///bad%",
        "file:///bad%0",
        "file:///bad%zz",
        "file:///café",
        "file:///a\u{85}b",
        "https://example.com/a<",
        "urn:example:{value}",
        "file:///a\"b",
        "file:///a>b",
        "file:///a^b",
        "file:///a`b",
        "file:///a|b",
        "urn:example:a[b]",
        "urn:example:a]b",
        "https://example.test/a[b]",
        "https://example.test/#x[y]",
        "https://example.test/?x[y]",
        "https://[::1]/a[b]",
        "https:[::1]",
    ] {
        assert!(!uri(source), "{source}");
    }
    assert!(!is_valid_uri(&[b'x' as u16, b':' as u16, 0xd800]));
}

#[test]
fn validates_special_authorities_ports_ipv4_and_ipv6() {
    for source in [
        "http://",
        "http://?x",
        "http://host:65536",
        "http://host:-1",
        "http://host:1x",
        "http://[bad]/",
        "http://[::1]:65536/",
        "http://[::1]extra/",
        "http://256.1.1.1/",
        "http://1.2.3.256/",
        "http://1.2.3.4.5/",
        "http://4294967296/",
        "http://08/",
        "http://%00/",
        "http://%23/",
        "http://%2F/",
        "http://%FF/",
        "file://user@host/path",
        "file://host:80/path",
        "custom://host:65536/path",
    ] {
        assert!(!uri(source), "{source}");
    }
    for source in [
        "http://host:65535/",
        "http://host:/",
        "http://[::ffff:192.0.2.1]/",
        "http://%65xample.com/",
        "file://localhost/path",
        "custom://",
    ] {
        assert!(uri(source), "{source}");
    }
}
