use git_rust::cli::execute_git_cli;
use git_rust::crypto::{
    ed25519_public_key, ed25519_sign, ed25519_verify, format_openssh_ed25519_private_key,
    format_openssh_ed25519_public_key, hmac_sha256, parse_openssh_ed25519_private_key,
    parse_openssh_ed25519_public_key, pbkdf2_hmac_sha256, pgp_sign_detached, pgp_verify_detached,
    sha256, sha512, ssh_key_fingerprint_sha256, sshsig_sign, sshsig_verify,
};
use git_rust::MemoryFs;

fn from_hex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn test_sha256_sha512_hmac_pbkdf2_vectors() {
    let d256 = sha256(b"abc");
    assert_eq!(
        to_hex(&d256),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let d512 = sha512(b"abc");
    assert_eq!(
        to_hex(&d512),
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
    );
    let mac = hmac_sha256(b"key", b"The quick brown fox jumps over the lazy dog");
    assert_eq!(
        to_hex(&mac),
        "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
    );
    let dk = pbkdf2_hmac_sha256(b"password", b"salt", 2, 32);
    assert_eq!(
        to_hex(&dk),
        "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"
    );
}

#[test]
fn test_ed25519_rfc8032_test_vector_1_and_2() {
    // RFC 8032 Section 7.1 TEST 1 (empty message)
    let seed1: [u8; 32] = from_hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
        .try_into()
        .unwrap();
    let expected_pk1 = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
    let expected_sig1 = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
    let pk1 = ed25519_public_key(&seed1);
    assert_eq!(to_hex(&pk1), expected_pk1);
    let sig1 = ed25519_sign(&seed1, b"");
    assert_eq!(to_hex(&sig1), expected_sig1);
    assert!(ed25519_verify(&pk1, b"", &sig1));
    assert!(!ed25519_verify(&pk1, b"tampered", &sig1));

    // RFC 8032 Section 7.1 TEST 2 (1-byte message 0x72)
    let seed2: [u8; 32] = from_hex("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb")
        .try_into()
        .unwrap();
    let expected_pk2 = "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
    let expected_sig2 = "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00";
    let pk2 = ed25519_public_key(&seed2);
    assert_eq!(to_hex(&pk2), expected_pk2);
    let sig2 = ed25519_sign(&seed2, &[0x72]);
    assert_eq!(to_hex(&sig2), expected_sig2);
    assert!(ed25519_verify(&pk2, &[0x72], &sig2));
}

#[test]
fn test_openssh_keys_and_sshsig_verification() {
    let seed = sha256(b"ssh-test-seed");
    let pem = format_openssh_ed25519_private_key(&seed, "dev@poe.com");
    let (parsed_seed, parsed_pk, comment) = parse_openssh_ed25519_private_key(&pem).unwrap();
    assert_eq!(parsed_seed, seed);
    assert_eq!(parsed_pk, ed25519_public_key(&seed));
    assert_eq!(comment, "dev@poe.com");

    let pub_line = format_openssh_ed25519_public_key(&parsed_pk, "dev@poe.com");
    let (pub_pk, pub_comment) = parse_openssh_ed25519_public_key(&pub_line).unwrap();
    assert_eq!(pub_pk, parsed_pk);
    assert_eq!(pub_comment, "dev@poe.com");

    let sig = sshsig_sign(&seed, "git", b"tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n");
    let allowed = format!("dev@poe.com namespaces=\"git\" {pub_line}\n");
    let verified = sshsig_verify(
        &sig,
        "git",
        b"tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n",
        Some(&allowed),
    )
    .expect("SSHSIG should verify");
    assert_eq!(verified.principal.as_deref(), Some("dev@poe.com"));
    assert_eq!(verified.fingerprint, ssh_key_fingerprint_sha256(&parsed_pk));
    assert!(
        sshsig_verify(
            &sig,
            "git",
            b"tree 0000000000000000000000000000000000000000\n",
            Some(&allowed)
        )
        .is_none()
    );
}

#[test]
fn test_openpgp_detached_signature_verification() {
    let seed = sha256(b"pgp-test-seed");
    let payload = b"tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n\nInitial signed commit\n";
    let armored = pgp_sign_detached(&seed, "Alice <alice@example.com>", 1_700_000_000, payload);
    assert!(armored.starts_with("-----BEGIN PGP SIGNATURE-----"));
    let verified = pgp_verify_detached(&armored, payload).expect("PGP signature should verify");
    assert_eq!(verified.signer_uid, "Alice <alice@example.com>");
    assert_eq!(verified.timestamp, 1_700_000_000);
    assert!(pgp_verify_detached(&armored, b"tampered").is_none());
}

#[test]
fn test_git_cli_commit_and_tag_signing_openpgp_and_ssh() {
    let fs = MemoryFs::new();
    let cwd = "/repo";
    assert_eq!(execute_git_cli(&fs, cwd, &["init"]).exit_code, 0);
    assert_eq!(
        execute_git_cli(&fs, cwd, &["config", "user.name", "Alice"]).exit_code,
        0
    );
    assert_eq!(
        execute_git_cli(&fs, cwd, &["config", "user.email", "alice@example.com"]).exit_code,
        0
    );
    fs.write_str("/repo/hello.txt", "hello signed world\n");
    assert_eq!(execute_git_cli(&fs, cwd, &["add", "hello.txt"]).exit_code, 0);

    let pgp_private = format_openssh_ed25519_private_key(&sha256(b"alice-pgp-key"), "alice@example.com");
    fs.write_str("/repo/.ssh/pgp-key", &pgp_private);
    execute_git_cli(&fs, cwd, &["config", "user.signingkey", ".ssh/pgp-key"]);

    // 1. OpenPGP commit signing with -S
    let commit_res = execute_git_cli(&fs, cwd, &["commit", "-S", "-m", "pgp signed commit"]);
    assert_eq!(commit_res.exit_code, 0, "stderr: {}", commit_res.stderr);

    let verify_commit_res = execute_git_cli(&fs, cwd, &["verify-commit", "HEAD"]);
    assert_eq!(verify_commit_res.exit_code, 0, "stderr: {}", verify_commit_res.stderr);
    assert!(verify_commit_res.stdout.contains("Good signature from \"Alice <alice@example.com>\""));
    let signed_oid = git_rust::resolve_ref(&fs, "/repo/.git", "HEAD", None).unwrap();
    assert!(fs.read_str("/repo/.git/logs/HEAD").unwrap_or_default().contains(&signed_oid));

    let log_sig_res = execute_git_cli(&fs, cwd, &["log", "-1", "--show-signature"]);
    assert_eq!(log_sig_res.exit_code, 0);
    assert!(log_sig_res.stdout.contains("Good signature from \"Alice <alice@example.com>\""));

    // 2. OpenPGP annotated tag signing with -s
    let tag_res = execute_git_cli(&fs, cwd, &["tag", "-s", "v1.0.0", "-m", "signed v1.0.0"]);
    assert_eq!(tag_res.exit_code, 0, "stderr: {}", tag_res.stderr);
    let verify_tag_res = execute_git_cli(&fs, cwd, &["verify-tag", "v1.0.0"]);
    assert_eq!(verify_tag_res.exit_code, 0, "stderr: {}", verify_tag_res.stderr);
    assert!(verify_tag_res.stdout.contains("Good signature from \"Alice <alice@example.com>\""));
    let tag_v_res = execute_git_cli(&fs, cwd, &["tag", "-v", "v1.0.0"]);
    assert_eq!(tag_v_res.exit_code, 0);
    let tag_oid = git_rust::resolve_ref(&fs, "/repo/.git", "refs/tags/v1.0.0", None).unwrap();
    let signed_tag = git_rust::read_tag(&fs, "/repo/.git", &tag_oid).unwrap();
    assert!(pgp_verify_detached(signed_tag.tag.gpgsig.as_deref().unwrap(), signed_tag.payload.as_bytes()).is_some());
    let mut changed_tag = signed_tag.tag;
    changed_tag.message.push_str("\n\n");
    let changed_oid = git_rust::commands::plumbing::write_tag(&fs, "/repo/.git", &changed_tag).unwrap();
    git_rust::GitRefManager::write_ref(&fs, "/repo/.git", "refs/tags/tampered", &changed_oid).unwrap();
    for args in [&["verify-tag", "tampered"][..], &["tag", "-v", "tampered"][..]] {
        let result = execute_git_cli(&fs, cwd, args);
        assert_ne!(result.exit_code, 0, "tag whitespace tampering must fail");
        assert!(result.stderr.contains("BAD signature"));
    }



    // 3. SSH commit & tag signing with gpg.format=ssh and allowed_signers
    let ssh_seed = sha256(b"alice-ssh-signing-key");
    let ssh_priv = format_openssh_ed25519_private_key(&ssh_seed, "alice@example.com");
    let ssh_pub = format_openssh_ed25519_public_key(&ed25519_public_key(&ssh_seed), "alice@example.com");
    fs.write_str("/repo/.ssh/id_ed25519", &ssh_priv);
    fs.write_str(
        "/repo/.ssh/allowed_signers",
        &format!("alice@example.com {ssh_pub}\n"),
    );

    execute_git_cli(&fs, cwd, &["config", "gpg.format", "ssh"]);
    execute_git_cli(&fs, cwd, &["config", "user.signingkey", "/repo/.ssh/id_ed25519"]);
    execute_git_cli(
        &fs,
        cwd,
        &["config", "gpg.ssh.allowedSignersFile", "/repo/.ssh/allowed_signers"],
    );
    execute_git_cli(&fs, cwd, &["config", "commit.gpgsign", "true"]);

    fs.write_str("/repo/hello.txt", "hello ssh signed world\n");
    execute_git_cli(&fs, cwd, &["add", "hello.txt"]);
    let ssh_commit_res = execute_git_cli(&fs, cwd, &["commit", "-m", "ssh signed commit"]);
    assert_eq!(ssh_commit_res.exit_code, 0);

    let verify_ssh_commit = execute_git_cli(&fs, cwd, &["verify-commit", "HEAD"]);
    assert_eq!(verify_ssh_commit.exit_code, 0, "stderr: {}", verify_ssh_commit.stderr);
    assert!(verify_ssh_commit.stdout.contains("Good \"git\" signature for alice@example.com with ED25519 key SHA256:"));

    let ssh_tag_res = execute_git_cli(&fs, cwd, &["tag", "-s", "v2.0.0", "-m", "ssh signed tag"]);
    assert_eq!(ssh_tag_res.exit_code, 0);
    let verify_ssh_tag = execute_git_cli(&fs, cwd, &["verify-tag", "v2.0.0"]);
    assert_eq!(verify_ssh_tag.exit_code, 0, "stderr: {}", verify_ssh_tag.stderr);
    assert!(verify_ssh_tag.stdout.contains("Good \"git\" signature for alice@example.com with ED25519 key SHA256:"));
}

#[test]
fn rejects_unverified_pgp_armor() {
    for signature in [
        "-----BEGIN PGP SIGNATURE-----",
        "-----BEGIN PGP SIGNATURE-----\ninvalid\n-----END PGP SIGNATURE-----",
    ] {
        let result = git_rust::crypto::verify_git_signature(
            &MemoryFs::new(), "/repo", signature, "unverified payload", None,
        );
        assert!(result.is_err(), "unverified armor was accepted: {result:?}");
    }
}

#[test]
fn openpgp_signatures_are_standard_packets() {
    use sequoia_openpgp::{Packet, PacketPile, parse::Parse};
    let armor = pgp_sign_detached(&sha256(b"interop"), "Interop", 1_700_000_000, b"payload");
    let packets = PacketPile::from_bytes(armor.as_bytes()).expect("standard OpenPGP packets");
    assert!(matches!(packets.children().next(), Some(Packet::Signature(_))));
}

#[test]
fn independently_produced_openpgp_signature_verifies_with_certificate() {
    use git_rust::crypto::pgp_verify_detached_with_key;
    let signature = include_str!("fixtures/openpgp/signature.asc");
    let payload = include_bytes!("fixtures/openpgp/payload.txt");
    let cert = include_bytes!("fixtures/openpgp/public-key.asc");
    let verified = pgp_verify_detached_with_key(signature, payload, Some(cert)).unwrap();
    assert_eq!(verified.fingerprint, "8E8C33FA4626337976D97978069C0C348DD82C19");
    assert!(pgp_verify_detached_with_key(signature, b"tampered", Some(cert)).is_err());
    assert!(pgp_verify_detached_with_key(signature, payload, None).unwrap_err().contains("No public key"));
    let wrong_key = git_rust::crypto::pgp_public_key(&sha256(b"wrong"), "Wrong");
    assert!(pgp_verify_detached_with_key(signature, payload, Some(wrong_key.as_bytes())).is_err());
}

#[test]
fn cli_rejects_invalid_commit_and_tag_signatures() {
    let fs = MemoryFs::new();
    execute_git_cli(&fs, "/repo", &["init"]);
    execute_git_cli(&fs, "/repo", &["config", "user.name", "Alice"]);
    execute_git_cli(&fs, "/repo", &["config", "user.email", "alice@example.com"]);
    execute_git_cli(&fs, "/repo", &["commit", "--allow-empty", "-m", "unsigned"]);
    let oid = git_rust::resolve_ref(&fs, "/repo/.git", "HEAD", None).unwrap();
    let mut commit = git_rust::read_commit(&fs, "/repo/.git", &oid).unwrap().commit;
    commit.gpgsig = Some("-----BEGIN PGP SIGNATURE-----".into());
    let oid = git_rust::commands::plumbing::write_commit(&fs, "/repo/.git", &commit).unwrap();
    git_rust::GitRefManager::write_ref(&fs, "/repo/.git", "refs/heads/main", &oid).unwrap();
    let result = execute_git_cli(&fs, "/repo", &["verify-commit", &oid]);
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("BAD signature"));
    execute_git_cli(&fs, "/repo", &["tag", "-a", "bad", "-m", "tag"]);
    let oid = git_rust::resolve_ref(&fs, "/repo/.git", "refs/tags/bad", None).unwrap();
    let mut tag = git_rust::read_tag(&fs, "/repo/.git", &oid).unwrap().tag;
    tag.gpgsig = Some("-----BEGIN PGP SIGNATURE-----\ninvalid\n-----END PGP SIGNATURE-----".into());
    let oid = git_rust::commands::plumbing::write_tag(&fs, "/repo/.git", &tag).unwrap();
    git_rust::GitRefManager::write_ref(&fs, "/repo/.git", "refs/tags/bad", &oid).unwrap();
    for args in [&["verify-tag", "bad"][..], &["tag", "-v", "bad"][..]] {
        let result = execute_git_cli(&fs, "/repo", args);
        assert_ne!(result.exit_code, 0, "{result:?}");
        assert!(result.stderr.contains("BAD signature"));
        assert!(!result.stdout.contains("Good signature"));
    }
}

#[test]
fn signs_using_the_configured_openpgp_secret_certificate() {
    let fs = MemoryFs::new();
    fs.write_str("/repo/key.asc", include_str!("fixtures/openpgp/test-secret-key.asc"));
    let signature = git_rust::crypto::sign_git_payload(
        &fs, "/repo", "openpgp", "key.asc", "Alice", 1_700_000_000, "payload",
    ).unwrap();
    let verified = git_rust::crypto::pgp_verify_detached_with_key(
        &signature, b"payload", Some(include_bytes!("fixtures/openpgp/public-key.asc")),
    ).expect("signature made by the configured key");
    assert_eq!(verified.fingerprint, "8E8C33FA4626337976D97978069C0C348DD82C19");
}

#[test]
fn configured_openpgp_key_signs_commits_and_tags_at_requested_date() {
    let _environment = git_rust::environment::EnvironmentScope::new([
        ("GIT_AUTHOR_DATE".into(), "1700000000 +0000".into()),
        ("GIT_COMMITTER_DATE".into(), "1700000000 +0000".into()),
    ].into());
    let fs = MemoryFs::new();
    execute_git_cli(&fs, "/repo", &["init"]);
    execute_git_cli(&fs, "/repo", &["config", "user.name", "Alice"]);
    execute_git_cli(&fs, "/repo", &["config", "user.email", "alice@example.com"]);
    fs.write_str("/repo/key.asc", include_str!("fixtures/openpgp/test-secret-key.asc"));
    fs.write_str("/repo/public.asc", include_str!("fixtures/openpgp/public-key.asc"));
    execute_git_cli(&fs, "/repo", &["config", "user.signingkey", "key.asc"]);
    execute_git_cli(&fs, "/repo", &["config", "gpg.openpgp.publicKeyFile", "public.asc"]);
    for args in [
        &["commit", "--allow-empty", "-S", "-m", "signed"][..],
        &["verify-commit", "HEAD"],
        &["tag", "-s", "signed", "-m", "signed tag"],
        &["verify-tag", "signed"],
    ] {
        let result = execute_git_cli(&fs, "/repo", args);
        assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    }
}

#[test]
fn failed_openpgp_signing_does_not_publish_an_unsigned_commit() {
    let fs = MemoryFs::new();
    execute_git_cli(&fs, "/repo", &["init"]);
    execute_git_cli(&fs, "/repo", &["config", "user.name", "Alice"]);
    execute_git_cli(&fs, "/repo", &["config", "user.email", "alice@example.com"]);
    fs.write_str("/repo/key.asc", "-----BEGIN PGP PRIVATE KEY BLOCK-----\ninvalid");
    execute_git_cli(&fs, "/repo", &["config", "user.signingkey", "key.asc"]);
    let result = execute_git_cli(&fs, "/repo", &["commit", "--allow-empty", "-S", "-m", "invalid key"]);
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("Invalid secret key"));
    assert!(git_rust::resolve_ref(&fs, "/repo/.git", "HEAD", None).is_err());
}

#[test]
fn rejects_signing_without_secret_key_material() {
    let result = git_rust::crypto::sign_git_payload(
        &MemoryFs::new(), "/repo", "openpgp", "alice@example.com", "Alice", 1_700_000_000, "payload",
    );
    assert!(result.is_err(), "an identity string is not a secret key");
}
