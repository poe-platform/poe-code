# SOURCE/DATA audit

2026-08-29. The archive snapshots 33 captured administrative Git children, all closed, before editor/Git publication. No runtime imports, validator calls, compilers, Workers, native or engine tests were executed. Instructions were read separately, not captured. No existing compressed input was decoded.

Archive SOURCE-READS.json.gz.base64.data: authenticate decoded compressed bytes before gunzip; compressed 199260 bytes, SHA-256 70e53d42dc0a3048d344d91482f8d33a8de71b9b893d6cca460c137b76c61515; uncompressed 871888 bytes, SHA-256 0aa581aa71715063c2c69b6e3d9fa7eafac0759df409bd341a0d7649b419eed1. Refuse inflation above 871888 bytes. This is raw source capture, not executable replay.

Publication preparation initially attempted reading a write-only capture descriptor and received EBADF; no child or patch launched. Separate read descriptors were then opened against the same authenticated inode/size and independently closed. Original captures remained open and intact.

Later publication uses the existing captured owner under 25-minute/48-known-process bounds; this snapshot does not certify its later commit. Final totals and capture closure are reported at handoff. Raw captures remain local/ignored. Explicit-path --only commit preserves foreign staging. Historical author64 administrative compliance remains NOT CERTIFIED.
