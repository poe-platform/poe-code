import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure tar, zip, codecs, xxd, od, hexdump, base64/32, hashes, openssl, gpg, and ssh-keygen parity matrix", () => {
  it("1. gzip, gunzip, and zcat with genuine 1f8b magic header and -k/-c/-d flags", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'gzip_payload_line_1\ngzip_payload_line_2\n' > data.txt
      gzip -k -9 data.txt
      magic=$(xxd -p -l 2 data.txt.gz)
      stream=$(zcat data.txt.gz | paste -sd: -)
      gunzip -c data.txt.gz > restored.txt
      cmp -s data.txt restored.txt && echo "magic=$magic stream=$stream match=yes"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "magic=1f8b stream=gzip_payload_line_1:gzip_payload_line_2 match=yes\n"
    );
  });

  it("2. bzip2, bunzip2, and bzcat with genuine 425a68 (BZh) magic header", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'bzip2_block_sorting_payload_12345\n' > data.txt
      bzip2 -k -9 data.txt
      magic=$(xxd -p -l 3 data.txt.bz2)
      out=$(bzcat data.txt.bz2)
      bunzip2 -c data.txt.bz2 > restored.txt
      cmp -s data.txt restored.txt && echo "magic=$magic out=$out match=yes"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "magic=425a68 out=bzip2_block_sorting_payload_12345 match=yes\n"
    );
  });

  it("3. xz, unxz, and xzcat with genuine fd377a585a00 (\\xfd7zXZ\\x00) magic header", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'xz_lzma2_container_payload_98765\n' > data.txt
      xz -k data.txt
      magic=$(xxd -p -l 6 data.txt.xz)
      out=$(xzcat data.txt.xz)
      unxz -c data.txt.xz > restored.txt
      cmp -s data.txt restored.txt && echo "magic=$magic out=$out match=yes"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "magic=fd377a585a00 out=xz_lzma2_container_payload_98765 match=yes\n"
    );
  });

  it("4. zstd, unzstd, and zstdcat with genuine 28b52ffd RFC 8878 frame header", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'zstd_frame_payload_abcdef\n' > data.txt
      zstd -q data.txt
      magic=$(xxd -p -l 4 data.txt.zst)
      out=$(zstdcat data.txt.zst)
      unzstd -q -c data.txt.zst > restored.txt
      zstd -o bad.zst data.txt 2>/dev/null
      bad_rc=$?
      gzip -z data.txt 2>/dev/null
      gz_z_rc=$?
      cmp -s data.txt restored.txt && echo "magic=$magic out=$out match=yes bad_rc=$bad_rc gz_z_rc=$gz_z_rc"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "magic=28b52ffd out=zstd_frame_payload_abcdef match=yes bad_rc=2 gz_z_rc=2\n"
    );
  });

  it("5. tar create, list, extract, -C directory, --strip-components, --exclude, and -O stdout", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p pkg/src pkg/tmp
      printf 'fn main() {}\n' > pkg/src/main.rs
      printf 'README_BODY\n' > pkg/README.md
      printf 'ignore\n' > pkg/tmp/cache.tmp
      tar --exclude='*.tmp' -cf bundle.tar pkg
      listed=$(tar -tf bundle.tar | sort | paste -sd, -)
      mkdir -p unpacked
      tar -xf bundle.tar -C unpacked --strip-components=1
      readme=$(tar -xOf bundle.tar pkg/README.md)
      echo "listed=$listed | readme=$readme | main=$(cat unpacked/src/main.rs)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "listed=pkg/,pkg/README.md,pkg/src/,pkg/src/main.rs,pkg/tmp/ | readme=README_BODY | main=fn main() {}\n"
    );
  });

  it("6. tar compressed archives (-z gzip, -j bzip2, -J xz, --zstd) magic bytes and extraction", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p tree
      printf 'multi_codec_tar_content\n' > tree/item.txt
      tar -czf a.tar.gz tree
      tar -cjf a.tar.bz2 tree
      tar -cJf a.tar.xz tree
      tar --zstd -cf a.tar.zst tree
      m_gz=$(xxd -p -l 2 a.tar.gz)
      m_bz=$(xxd -p -l 3 a.tar.bz2)
      m_xz=$(xxd -p -l 6 a.tar.xz)
      m_zs=$(xxd -p -l 4 a.tar.zst)
      echo "magic=$m_gz:$m_bz:$m_xz:$m_zs"
      for arch in a.tar.gz a.tar.bz2 a.tar.xz a.tar.zst; do
        rm -rf out && mkdir out
        tar -xf "$arch" -C out
        cat out/tree/item.txt
      done | uniq -c | awk '{print $1 ":" $2}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "magic=1f8b:425a68:fd377a585a00:28b52ffd",
        "4:multi_codec_tar_content",
        "",
      ].join("\n")
    );
  });

  it("7. zip -r and unzip -l / -p / -d with PKZIP 504b0304 header verification", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p app/conf
      printf 'port=8080\n' > app/conf/settings.ini
      printf 'entry_point\n' > app/index.js
      zip -q -r app.zip app
      magic=$(xxd -p -l 4 app.zip)
      piped=$(unzip -p app.zip app/conf/settings.ini)
      mkdir -p extracted
      unzip -q app.zip -d extracted
      echo "magic=$magic piped=$piped extracted=$(cat extracted/app/index.js)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "magic=504b0304 piped=port=8080 extracted=entry_point\n"
    );
  });

  it("8. xxd hex dump, -p plain hex, -s seek, -l length, and -r -p binary reconstruction", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '0061736d01000000' | xxd -r -p > mod.wasm
      file_type=$(file -b mod.wasm)
      slice=$(xxd -p -s 1 -l 3 mod.wasm)
      echo "type=$file_type slice=$slice"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "type=WebAssembly binary module slice=61736d\n");
  });

  it("9. od -An -tx1 / -tu1 / -tc with -j skip and -N count, plus hexdump -C", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'ABCDEF' > bytes.bin
      hex=$(od -An -tx1 -j 1 -N 4 bytes.bin | tr -s ' ' | sed 's/^ //;s/ $//')
      dec=$(od -An -tu1 -j 0 -N 3 bytes.bin | tr -s ' ' | sed 's/^ //;s/ $//')
      hd=$(hexdump -C bytes.bin | head -n 1)
      echo "hex=$hex | dec=$dec"
      echo "$hd" | grep -q '|ABCDEF|' && echo "hd=matched"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "hex=42 43 44 45 | dec=65 66 67",
        "hd=matched",
        "",
      ].join("\n")
    );
  });

  it("10. base64 and base32 encoding and decoding round-trips", async () => {
    const env = createEnv();
    const res = await env.exec(`
      b64=$(printf 'binary:payload:256' | base64 -w 0)
      d64=$(printf '%s' "$b64" | base64 -d)
      b32=$(printf 'hello_base32' | base32 -w 0)
      d32=$(printf '%s' "$b32" | base32 -d)
      echo "b64=$b64 d64=$d64 b32=$b32 d32=$d32"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "b64=YmluYXJ5OnBheWxvYWQ6MjU2 d64=binary:payload:256 b32=NBSWY3DPL5RGC43FGMZA==== d32=hello_base32\n"
    );
  });

  it("11. strings -n printable sequence extraction from binary payloads", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '\\x00\\x01ab\\x00BUILD_ID_2026\\x00\\xffxy\\x00RELEASE_OK\\x00' > bin.dat
      strings -n 5 bin.dat
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "BUILD_ID_2026",
        "RELEASE_OK",
        "",
      ].join("\n")
    );
  });

  it("12. md5sum, sha1sum, sha256sum, sha512sum, and cksum digests and -c verification", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'abc' > abc.txt
      md5=$(md5sum abc.txt | awk '{print $1}')
      sha1=$(sha1sum abc.txt | awk '{print $1}')
      sha256=$(sha256sum abc.txt | awk '{print $1}')
      ck=$(cksum abc.txt | awk '{print $1 ":" $2}')
      sha256sum abc.txt > sums.sha256
      verify=$(sha256sum -c sums.sha256)
      echo "md5=$md5"
      echo "sha1=$sha1"
      echo "sha256=$sha256"
      echo "ck=$ck verify=$verify"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "md5=900150983cd24fb0d6963f7d28e17f72",
        "sha1=a9993e364706816aba3e25717850c26c9cd0d89d",
        "sha256=ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "ck=1219131554:3 verify=abc.txt: OK",
        "",
      ].join("\n")
    );
  });

  it("13. openssl dgst -sha256 -hmac and openssl rand -hex", async () => {
    const env = createEnv();
    const res = await env.exec(`
      hmac=$(printf 'message_body' | openssl dgst -sha256 -hmac 'secret_key' | awk '{print $NF}')
      rnd=$(openssl rand -hex 16)
      echo "hmac=$hmac rnd_len=\${#rnd}"
    `);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /^hmac=[0-9a-f]{64} rnd_len=32\n$/);
  });

  it("14. openssl enc -aes-256-cbc -pbkdf2 -salt encryption and decryption round-trip", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'confidential_payload_2026\n' > plain.txt
      openssl enc -aes-256-cbc -pbkdf2 -salt -pass pass:strong_key_99 -in plain.txt -out cipher.bin
      openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:strong_key_99 -in cipher.bin -out decrypted.txt
      cat decrypted.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "confidential_payload_2026\n");
  });

  it("15. openssl genpkey RSA, pkey -pubout, and dgst -sha256 -sign / -verify", async () => {
    const env = createEnv();
    const res = await env.exec(`
      openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out priv.pem 2>/dev/null
      openssl pkey -in priv.pem -pubout -out pub.pem 2>/dev/null
      printf 'signed_artifact_manifest\n' > manifest.txt
      openssl dgst -sha256 -sign priv.pem -out manifest.sig manifest.txt
      openssl dgst -sha256 -verify pub.pem -signature manifest.sig manifest.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "Verified OK\n");
  });

  it("16. openssl req -x509 certificate generation with SANs and x509 inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      openssl req -new -x509 -nodes -newkey ec:prime256v1 -keyout tls.key -out tls.crt -days 30 -subj '/CN=api.internal/O=Platform' -addext 'subjectAltName=DNS:api.internal,IP:10.0.0.1' 2>/dev/null
      subj=$(openssl x509 -in tls.crt -noout -subject)
      ext=$(openssl x509 -in tls.crt -noout -ext subjectAltName)
      openssl x509 -in tls.crt -noout -checkend 60
      echo "rc=$? | $subj"
      echo "$ext" | grep -q 'DNS: api.internal' && echo "san=ok"
    `);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /rc=0 \| subject=.*CN\s*=\s*api\.internal/);
    assert.match(res.stdout, /san=ok/);
  });

  it("17. gpg symmetric AES256 armor encryption and decryption round-trip", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'top_secret_gpg_message\n' > secret.txt
      gpg --batch --yes --passphrase 'vault_pass' --symmetric --cipher-algo AES256 --armor -o secret.asc secret.txt 2>/dev/null
      grep -q 'BEGIN PGP MESSAGE' secret.asc && echo "header=ok"
      gpg --batch --yes --passphrase 'vault_pass' --decrypt secret.asc 2>/dev/null
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "header=ok\ntop_secret_gpg_message\n");
  });

  it("18. gpg detached signature (--detach-sign --armor) and verification (--verify --status-fd=1)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gpg --quick-generate-key 'Release Bot <bot@example.com>' ed25519 sign never >/dev/null 2>&1
      printf 'release_tarball_sha256=deadbeef\n' > release.txt
      gpg --detach-sign --armor -u 'Release Bot <bot@example.com>' -o release.txt.asc release.txt 2>/dev/null
      status=$(gpg --status-fd=1 --verify release.txt.asc release.txt 2>/dev/null)
      echo "$status" | grep -q 'GOODSIG' && echo "gpg_verify=goodsig"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "gpg_verify=goodsig\n");
  });

  it("19. ssh-keygen ed25519 key generation, -l fingerprint, and -y public key derivation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      ssh-keygen -t ed25519 -f id_ed25519 -C 'deploy@cluster' -N '' >/dev/null 2>&1
      fp=$(ssh-keygen -l -f id_ed25519.pub)
      derived=$(ssh-keygen -y -f id_ed25519 | awk '{print $1 " " $2}')
      pub_prefix=$(awk '{print $1 " " $2}' id_ed25519.pub)
      test "$derived" = "$pub_prefix" && echo "derived_match=yes"
      echo "$fp" | grep -q 'SHA256:' && echo "fp_ok=yes"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "derived_match=yes\nfp_ok=yes\n");
  });

  it("20. ssh-keygen -Y sign and -Y verify with allowed_signers", async () => {
    const env = createEnv();
    const res = await env.exec(`
      ssh-keygen -t ed25519 -f signer_key -C 'dev@example.com' -N '' >/dev/null 2>&1
      printf 'commit_payload_v1\n' > commit.txt
      ssh-keygen -Y sign -f signer_key -n git commit.txt >/dev/null 2>&1
      printf 'dev@example.com namespaces="git" %s\n' "$(cat signer_key.pub)" > allowed_signers
      out=$(ssh-keygen -Y verify -f allowed_signers -I 'dev@example.com' -n git -s commit.txt.sig < commit.txt)
      echo "$out" | grep -q 'Good "git" signature' && echo "ssh_sig=good"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "ssh_sig=good\n");
  });
});
