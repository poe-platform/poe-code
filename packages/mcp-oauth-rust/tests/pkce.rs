use mcp_oauth_rust::{generate_code_challenge, generate_code_verifier, sha256};
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn rfc7636_s256_vector_and_fixed_entropy_verifiers() {
    assert_eq!(
        generate_code_challenge(&units("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    assert_eq!(
        generate_code_verifier(&[0; 32]).unwrap(),
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    );
    assert!(generate_code_verifier(&[0; 31]).is_err());
}
#[test]
fn sha256_matches_standard_empty_abc_and_million_a_vectors() {
    let hex = |bytes: [u8; 32]| {
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    };
    assert_eq!(
        hex(sha256(b"")),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        hex(sha256(b"abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        hex(sha256(&vec![b'a'; 1_000_000])),
        "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
    );
}
