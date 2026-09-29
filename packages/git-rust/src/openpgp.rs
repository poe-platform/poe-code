//! Native OpenPGP packets. Embedded certificates establish cryptographic validity,
//! not trust in the signer's identity; callers may supply their own certificate.
use sequoia_openpgp::{
    self as pgp, Cert, Packet, PacketPile,
    packet::prelude::*,
    parse::Parse,
    policy::{HashAlgoSecurity, Policy, StandardPolicy},
    serialize::Serialize,
    types::{KeyFlags, SignatureType},
};
use std::time::{Duration, UNIX_EPOCH};

const CERT_NOTATION: &str = "certificate@poe-code";

fn signing_cert(seed: &[u8; 32], uid: &str) -> pgp::Result<Cert> {
    let key: Key<key::SecretParts, key::PrimaryRole> =
        Key4::import_secret_ed25519(seed, UNIX_EPOCH)?.into();
    let mut signer = key.clone().into_keypair()?;
    let userid = UserID::from(uid);
    let binding = SignatureBuilder::new(SignatureType::PositiveCertification)
        .set_signature_creation_time(UNIX_EPOCH)?
        .set_key_flags(KeyFlags::empty().set_certification().set_signing())?
        .sign_userid_binding(&mut signer, key.parts_as_public(), &userid)?;
    Cert::from_packets([Packet::SecretKey(key), userid.into(), binding.into()].into_iter())
}

pub fn pgp_public_key(seed: &[u8; 32], uid: &str) -> String {
    let cert = signing_cert(seed, uid).expect("valid Ed25519 seed");
    let mut bytes = Vec::new();
    cert.armored()
        .serialize(&mut bytes)
        .expect("serialize to memory");
    String::from_utf8(bytes).expect("ASCII armor")
}

pub fn pgp_fingerprint_from_pubkey(pk: &[u8; 32]) -> String {
    let key: Key<key::PublicParts, key::PrimaryRole> = Key4::import_public_ed25519(pk, UNIX_EPOCH)
        .expect("valid Ed25519 key")
        .into();
    key.fingerprint().to_hex()
}

pub fn pgp_key_id_from_pubkey(pk: &[u8; 32]) -> String {
    let fp = pgp_fingerprint_from_pubkey(pk);
    fp[fp.len() - 16..].to_string()
}

pub fn pgp_sign_detached(seed: &[u8; 32], uid: &str, timestamp: u32, payload: &[u8]) -> String {
    let cert = signing_cert(seed, uid).expect("valid Ed25519 seed");
    sign_certificate(&cert, timestamp, payload).expect("valid Ed25519 signing certificate")
}

pub fn pgp_sign_with_secret_key(
    secret: &[u8],
    timestamp: u32,
    payload: &[u8],
) -> Result<String, String> {
    let cert = Cert::from_bytes(secret).map_err(|e| format!("gpg: Invalid secret key: {e}"))?;
    sign_certificate(&cert, timestamp, payload).map_err(|e| format!("gpg: Signing failed: {e}"))
}

fn sign_certificate(cert: &Cert, timestamp: u32, payload: &[u8]) -> pgp::Result<String> {
    let time = UNIX_EPOCH + Duration::from_secs(timestamp.into());
    let policy = StandardPolicy::new();
    let key = cert
        .keys()
        .with_policy(&policy, time)
        .supported()
        .alive()
        .revoked(false)
        .unencrypted_secret()
        .for_signing()
        .next()
        .ok_or_else(|| {
            pgp::Error::InvalidOperation("No usable unencrypted OpenPGP signing key".into())
        })?;
    let mut signer = key.key().clone().into_keypair()?;
    let mut public = Vec::new();
    cert.serialize(&mut public)?;
    let signature = SignatureBuilder::new(SignatureType::Binary)
        .set_signature_creation_time(time)?
        .set_notation(CERT_NOTATION, public, None, false)?
        .sign_message(&mut signer, payload)?;
    let mut bytes = Vec::new();
    let mut armor = pgp::armor::Writer::new(&mut bytes, pgp::armor::Kind::Signature)?;
    Packet::Signature(signature).serialize(&mut armor)?;
    armor.finalize()?;
    Ok(String::from_utf8(bytes)?)
}

#[derive(Debug, Clone)]
pub struct PgpSigVerified {
    /// Serialized OpenPGP public key packet (supports RSA as well as Ed25519).
    pub public_key: Vec<u8>,
    pub key_id: String,
    pub fingerprint: String,
    pub signer_uid: String,
    pub timestamp: u32,
}

pub fn pgp_verify_detached(armor: &str, payload: &[u8]) -> Option<PgpSigVerified> {
    pgp_verify_detached_with_key(armor, payload, None).ok()
}

pub fn pgp_verify_detached_with_key(
    armor: &str,
    payload: &[u8],
    public_key: Option<&[u8]>,
) -> Result<PgpSigVerified, String> {
    let bad = || "gpg: BAD signature".to_string();
    let pile = PacketPile::from_bytes(armor.as_bytes()).map_err(|_| bad())?;
    let mut packets = pile.children();
    let Some(Packet::Signature(sig)) = packets.next() else {
        return Err(bad());
    };
    if packets.next().is_some() {
        return Err(bad());
    }
    let embedded = sig
        .notation_data()
        .find(|n| n.name() == CERT_NOTATION)
        .map(|n| n.value());
    let cert = Cert::from_bytes(
        public_key
            .or(embedded)
            .ok_or_else(|| "gpg: Can't check signature: No public key".to_string())?,
    )
    .map_err(|_| "gpg: Invalid OpenPGP public key".to_string())?;
    let time = sig.signature_creation_time().ok_or_else(bad)?;
    let policy = StandardPolicy::new();
    policy
        .signature(sig, HashAlgoSecurity::CollisionResistance)
        .map_err(|_| bad())?;
    let valid = cert.with_policy(&policy, time).map_err(|_| bad())?;
    for key in valid
        .keys()
        .supported()
        .alive()
        .revoked(false)
        .for_signing()
    {
        if sig.verify_message(key.key(), payload).is_ok() {
            let mut public_key = Vec::new();
            Packet::PublicKey(key.key().clone().role_into_primary())
                .serialize(&mut public_key)
                .map_err(|_| bad())?;
            let uid = valid
                .primary_userid()
                .ok()
                .map(|u| String::from_utf8_lossy(u.userid().value()).into_owned())
                .unwrap_or_else(|| cert.fingerprint().to_hex());
            return Ok(PgpSigVerified {
                public_key,
                key_id: key.key().keyid().to_hex(),
                fingerprint: cert.fingerprint().to_hex(),
                signer_uid: uid,
                timestamp: time
                    .duration_since(UNIX_EPOCH)
                    .map_err(|_| bad())?
                    .as_secs() as u32,
            });
        }
    }
    Err(bad())
}
