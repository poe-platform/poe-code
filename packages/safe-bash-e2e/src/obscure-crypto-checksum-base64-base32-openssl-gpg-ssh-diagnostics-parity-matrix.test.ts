import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

const createEnv = () => SafeBashE2EHarness.create();

describe("obscure crypto, checksum, base64/base32, openssl, gpg, ssh, and ssh-keygen diagnostics parity matrix", () => {
  it("1. help and version banners across sha*sum, md5sum, cksum, base64, base32, openssl, gpg, and ssh", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      for cmd in sha256sum sha512sum sha384sum sha224sum sha1sum md5sum cksum base64 base32 openssl gpg; do
        out_h="$($cmd --help 2>&1)"
        rc_h=$?
        echo "HELP:$cmd:$rc_h:\${#out_h}"
      done
      for cmd in sha256sum sha512sum sha384sum sha224sum sha1sum md5sum cksum base64 base32 gpg; do
        out_v="$($cmd --version 2>&1 | head -n 1)"
        rc_v=$?
        echo "VER:$cmd:$rc_v:$out_v"
      done
      ssh_v="$(ssh -V 2>&1)"
      echo "SSH_V:$?:$ssh_v"
      ossl_v="$(openssl version 2>&1)"
      echo "OSSL_V:$?:$ossl_v"
    `);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /HELP:sha256sum:0:[1-9]/);
    assert.match(result.stdout, /HELP:sha384sum:0:[1-9]/);
    assert.match(result.stdout, /HELP:cksum:0:[1-9]/);
    assert.match(result.stdout, /HELP:base64:0:[1-9]/);
    assert.match(result.stdout, /HELP:base32:0:[1-9]/);
    assert.match(result.stdout, /HELP:openssl:0:[1-9]/);
    assert.match(result.stdout, /HELP:gpg:0:[1-9]/);
    assert.match(result.stdout, /VER:sha256sum:0:sha256sum \(safe-bash virtual implementation\)/);
    assert.match(result.stdout, /VER:md5sum:0:md5sum \(safe-bash virtual implementation\)/);
    assert.match(result.stdout, /VER:cksum:0:cksum \(safe-bash virtual implementation\)/);
    assert.match(result.stdout, /VER:base64:0:base64 \(safe-bash virtual implementation\)/);
    assert.match(result.stdout, /VER:base32:0:base32 \(safe-bash virtual implementation\)/);
    assert.match(result.stdout, /VER:gpg:0:gpg \(GnuPG\) 2\.4\.5 \(safe-bash\)/);
    assert.match(result.stdout, /SSH_V:0:OpenSSH_9\.8p1, OpenSSL 3\.3\.2 3 Sep 2024/);
    assert.match(result.stdout, /OSSL_V:0:OpenSSL compatible safe-bash toolkit \(Web Crypto\)/);
  });

  it("2. sha*sum and md5sum unknown option diagnostics, mode conflicts, EISDIR, and ENOENT", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      mkdir -p /tmp/hash_dir
      printf 'abc' > /tmp/hash_ok.txt

      sha256sum -Z 2>/tmp/sha_short.err
      echo "SHA_SHORT:$?:$(cat /tmp/sha_short.err)"

      md5sum --bad-opt 2>/tmp/md5_long.err
      echo "MD5_LONG:$?:$(cat /tmp/md5_long.err)"

      sha256sum --tag --text /tmp/hash_ok.txt 2>/tmp/sha_tag_txt.err
      echo "SHA_TAG_TXT:$?:$(cat /tmp/sha_tag_txt.err)"

      sha256sum --tag -c /tmp/hash_ok.txt 2>/tmp/sha_tag_chk.err
      echo "SHA_TAG_CHK:$?:$(cat /tmp/sha_tag_chk.err)"

      sha256sum -b -c /tmp/hash_ok.txt 2>/tmp/sha_bin_chk.err
      echo "SHA_BIN_CHK:$?:$(cat /tmp/sha_bin_chk.err)"

      sha256sum /tmp/hash_dir 2>/tmp/sha_dir.err
      echo "SHA_DIR:$?:$(cat /tmp/sha_dir.err)"

      sha256sum /tmp/no_such_hash.txt 2>/tmp/sha_noent.err
      echo "SHA_NOENT:$?:$(cat /tmp/sha_noent.err)"

      sha256sum --ignore-missing /tmp/hash_ok.txt 2>/tmp/sha_ign_no_c.err
      echo "SHA_IGN_NO_C:$?:$(cat /tmp/sha_ign_no_c.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "SHA_SHORT:2:sha256sum: unrecognized option '-Z'",
        "MD5_LONG:2:md5sum: unrecognized option '--bad-opt'",
        "SHA_TAG_TXT:2:sha256sum: --tag does not support --text mode",
        "SHA_TAG_CHK:2:sha256sum: the --tag option is meaningless when verifying checksums",
        "SHA_BIN_CHK:2:sha256sum: --zero, --binary and --text are not supported with --check",
        "SHA_DIR:1:sha256sum: /tmp/hash_dir: Is a directory",
        "SHA_NOENT:1:sha256sum: ENOENT: no such file or directory, readStream '/tmp/no_such_hash.txt'",
        "SHA_IGN_NO_C:1:sha256sum: verification options require --check",
      ].join("\n")
    );
  });

  it("3. sha256sum and cksum --check manifest verification with --status, --quiet, --warn, --strict, --ignore-missing, and --tag", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      printf 'alpha\n' > /tmp/a.txt
      printf 'beta\n' > /tmp/b.txt

      sha256sum --tag /tmp/a.txt /tmp/b.txt > /tmp/manifest.sha
      cat /tmp/manifest.sha

      sha256sum -c --quiet /tmp/manifest.sha >/tmp/chk_q.out 2>/tmp/chk_q.err
      echo "CHK_QUIET:$?:$(cat /tmp/chk_q.out):$(cat /tmp/chk_q.err)"

      printf 'not a valid checksum line\n' >> /tmp/manifest.sha
      sha256sum -c --warn /tmp/manifest.sha >/tmp/chk_w.out 2>/tmp/chk_w.err
      echo "CHK_WARN:$?:$(cat /tmp/chk_w.err)"

      sha256sum -c --strict /tmp/manifest.sha >/tmp/chk_s.out 2>/tmp/chk_s.err
      echo "CHK_STRICT:$?:$(cat /tmp/chk_s.err)"

      printf 'tampered\n' > /tmp/b.txt
      sha256sum -c --status /tmp/manifest.sha >/tmp/chk_st.out 2>/tmp/chk_st.err
      echo "CHK_STATUS:$?:$(cat /tmp/chk_st.out):$(cat /tmp/chk_st.err)"

      rm -f /tmp/b.txt
      sha256sum --tag /tmp/a.txt > /tmp/ign.manifest
      printf 'SHA256 (/tmp/missing.txt) = 87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7\n' >> /tmp/ign.manifest
      sha256sum -c --ignore-missing /tmp/ign.manifest >/tmp/chk_ign.out 2>/tmp/chk_ign.err
      echo "CHK_IGN:$?:$(cat /tmp/chk_ign.out):$(cat /tmp/chk_ign.err)"

      cksum -a blake2b -l 128 --tag /tmp/a.txt > /tmp/b2.manifest
      cat /tmp/b2.manifest
      cksum -c /tmp/b2.manifest
      echo "B2_CHK:$?"
    `);
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout,
      /SHA256 \(\/tmp\/a\.txt\) = b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060/
    );
    assert.match(result.stdout, /CHK_QUIET:0::/);
    assert.match(
      result.stdout,
      /CHK_WARN:0:sha256sum: \/tmp\/manifest\.sha: 3: improperly formatted sha256 checksum line\nsha256sum: WARNING: 1 improperly formatted checksum line\(s\)/
    );
    assert.match(
      result.stdout,
      /CHK_STRICT:1:sha256sum: WARNING: 1 improperly formatted checksum line\(s\)/
    );
    assert.match(result.stdout, /CHK_STATUS:1::/);
    assert.match(result.stdout, /CHK_IGN:0:\/tmp\/a\.txt: OK:/);
    assert.match(result.stdout, /BLAKE2b-128 \(\/tmp\/a\.txt\) = [0-9a-f]{32}/);
    assert.match(result.stdout, /\/tmp\/a\.txt: OK\nB2_CHK:0/);
  });

  it("4. cksum option diagnostics, clustered flags, case-sensitive algorithms, EISDIR, and ENOENT", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      mkdir -p /tmp/ck_dir
      printf 'hello' > /tmp/ck.txt

      cksum --algorithm 2>/tmp/ck1.err
      echo "CK1:$?:$(cat /tmp/ck1.err)"

      cksum -a 2>/tmp/ck2.err
      echo "CK2:$?:$(cat /tmp/ck2.err)"

      cksum --length 2>/tmp/ck3.err
      echo "CK3:$?:$(cat /tmp/ck3.err)"

      cksum -l 2>/tmp/ck4.err
      echo "CK4:$?:$(cat /tmp/ck4.err)"

      cksum --tag=no /tmp/ck.txt 2>/tmp/ck5.err
      echo "CK5:$?:$(cat /tmp/ck5.err)"

      cksum -a SHA256 /tmp/ck.txt 2>/tmp/ck6.err
      echo "CK6:$?:$(cat /tmp/ck6.err)"

      cksum --untagged -ba sha256 /tmp/ck.txt
      echo "CK_CLUSTER_A:$?"

      cksum --untagged -a blake2b -bl128 /tmp/ck.txt
      echo "CK_CLUSTER_L:$?"

      cksum /tmp/ck_dir 2>/tmp/ck_dir.err
      echo "CK_DIR:$?:$(cat /tmp/ck_dir.err)"

      cksum /tmp/no_such_ck.txt 2>/tmp/ck_noent.err
      echo "CK_NOENT:$?:$(cat /tmp/ck_noent.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "CK1:2:cksum: option '--algorithm' requires an argument",
        "CK2:2:cksum: option requires an argument -- 'a'",
        "CK3:2:cksum: option '--length' requires an argument",
        "CK4:2:cksum: option requires an argument -- 'l'",
        "CK5:2:cksum: option '--tag' does not take an argument",
        "CK6:2:cksum: unsupported checksum algorithm 'SHA256'",
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824 */tmp/ck.txt",
        "CK_CLUSTER_A:0",
        "46fb7408d4f285228f4af516ea25851b */tmp/ck.txt",
        "CK_CLUSTER_L:0",
        "CK_DIR:1:cksum: /tmp/ck_dir: Is a directory",
        "CK_NOENT:1:cksum: ENOENT: no such file or directory, readStream '/tmp/no_such_ck.txt'",
      ].join("\n")
    );
  });

  it("5. cksum --raw multi-file rejection, BLAKE2b length constraints, and -c verification across algorithms", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      printf 'one' > /tmp/one.txt
      printf 'two' > /tmp/two.txt

      cksum -a crc --raw /tmp/one.txt 2>/tmp/ck_raw.err
      echo "CK_RAW_CRC:$?:$(cat /tmp/ck_raw.err)"

      raw_hex="$(cksum -a md5 --raw /tmp/one.txt | xxd -p)"
      echo "CK_RAW_MD5:$?:$raw_hex"

      cksum -a sha256 -l 128 /tmp/one.txt 2>/tmp/ck_sha_l.err
      echo "CK_SHA_L:$?:$(cat /tmp/ck_sha_l.err)"

      cksum -a blake2b -l 600 /tmp/one.txt 2>/tmp/ck_b2_l.err
      echo "CK_B2_L:$?:$(cat /tmp/ck_b2_l.err)"

      cksum -a sha2 /tmp/one.txt 2>/tmp/ck_sha2_l.err
      echo "CK_SHA2_L:$?:$(cat /tmp/ck_sha2_l.err)"

      cksum -a sha256 /tmp/one.txt /tmp/two.txt > /tmp/ck.manifest
      cksum -a blake2b -l 256 /tmp/one.txt >> /tmp/ck.manifest
      cat /tmp/ck.manifest
      cksum -c /tmp/ck.manifest
      echo "CK_CHECK:$?"
    `);
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout,
      /CK_RAW_CRC:2:cksum: --raw requires a hash algorithm and cannot be combined with --tag, --untagged, --base64 or --zero/
    );
    assert.match(result.stdout, /CK_RAW_MD5:0:f97c5d29941bfb1b2fdab0874906ab82/);
    assert.match(
      result.stdout,
      /CK_SHA_L:2:cksum: invalid length '128' for sha256/
    );
    assert.match(result.stdout, /CK_B2_L:2:cksum: invalid length '600' for blake2b/);
    assert.match(result.stdout, /CK_SHA2_L:2:cksum: sha2 requires --length 224, 256, 384 or 512/);
    assert.match(result.stdout, /SHA256 \(\/tmp\/one\.txt\) = 7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed/);
    assert.match(result.stdout, /BLAKE2b-256 \(\/tmp\/one\.txt\) = /);
    assert.match(result.stdout, /\/tmp\/one\.txt: OK\n\/tmp\/two\.txt: OK\n\/tmp\/one\.txt: OK\nCK_CHECK:0/);
  });

  it("6. base64 and base32 option diagnostics, wrap validation, EISDIR, and ENOENT", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      mkdir -p /tmp/b64_dir
      printf 'hello world' > /tmp/b64.txt

      base64 --wrap 2>/tmp/b1.err
      echo "B1:$?:$(cat /tmp/b1.err)"

      base32 -w 2>/tmp/b2.err
      echo "B2:$?:$(cat /tmp/b2.err)"

      base64 -w -1 /tmp/b64.txt 2>/tmp/b3.err
      echo "B3:$?:$(cat /tmp/b3.err)"

      base64 --decode=1 /tmp/b64.txt 2>/tmp/b4.err
      echo "B4:$?:$(cat /tmp/b4.err)"

      base64 -D /tmp/b64.txt 2>/tmp/b5.err
      echo "B5:$?:$(cat /tmp/b5.err)"

      base64 /tmp/b64.txt /tmp/b64.txt 2>/tmp/b6.err
      echo "B6:$?:$(cat /tmp/b6.err)"

      base64 -w +4 /tmp/b64.txt
      echo "B_PLUS4:$?"

      base64 /tmp/b64_dir 2>/tmp/b_dir.err
      echo "B_DIR:$?:$(cat /tmp/b_dir.err)"

      base32 /tmp/no_such_b32.txt 2>/tmp/b_noent.err
      echo "B_NOENT:$?:$(cat /tmp/b_noent.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "B1:2:base64: option '--wrap' requires an argument",
        "B2:2:base32: option requires an argument -- 'w'",
        "B3:2:base64: invalid number '-1'",
        "B4:2:base64: option '--decode' does not take an argument",
        "B5:2:base64: invalid option -- 'D'",
        "B6:2:base64: extra operand '/tmp/b64.txt'",
        "aGVs",
        "bG8g",
        "d29y",
        "bGQ=",
        "B_PLUS4:0",
        "B_DIR:1:base64: EISDIR: illegal operation on a directory, readStream '/tmp/b64_dir'",
        "B_NOENT:1:base32: ENOENT: no such file or directory, readStream '/tmp/no_such_b32.txt'",
      ].join("\n")
    );
  });

  it("7. base64 and base32 decode invalid input rejection vs --ignore-garbage recovery", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      printf 'aGVs!bG8=\n' | base64 -d 2>/tmp/b64_bad.err
      echo "B64_BAD:$?:$(cat /tmp/b64_bad.err)"

      printf 'aGVs!@#bG8=\n' | base64 -di
      echo ":B64_IGN:$?"

      printf 'NBSWY3DP!\n' | base32 -d 2>/tmp/b32_bad.err
      echo "B32_BAD:$?:$(cat /tmp/b32_bad.err)"

      printf 'NBSWY3DP!@#\n' | base32 -di
      echo ":B32_IGN:$?"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "helB64_BAD:1:base64: invalid input",
        "hello:B64_IGN:0",
        "helloB32_BAD:1:base32: invalid input",
        "hello:B32_IGN:0",
      ].join("\n")
    );
  });

  it("8. openssl version flags and unknown subcommand/flag diagnostics", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      openssl version -a
      echo "RC_A:$?"
      openssl version -v -b -p -d
      echo "RC_MULTI:$?"
      openssl version -z 2>/tmp/ossl_vz.err
      echo "VZ:$?:$(cat /tmp/ossl_vz.err)"
      openssl version extra 2>/tmp/ossl_varg.err
      echo "VARG:$?:$(cat /tmp/ossl_varg.err)"
      openssl nosuchcmd 2>/tmp/ossl_sub.err
      echo "SUB:$?:$(cat /tmp/ossl_sub.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /OpenSSL compatible safe-bash toolkit \(Web Crypto\)/);
    assert.match(result.stdout, /platform: portable/);
    assert.match(result.stdout, /OPENSSLDIR: virtual filesystem/);
    assert.match(result.stdout, /RC_A:0/);
    assert.match(result.stdout, /RC_MULTI:0/);
    assert.match(result.stdout, /VZ:1:openssl: unknown option: -z/);
    assert.match(result.stdout, /VARG:1:openssl: unexpected version argument/);
    assert.match(result.stdout, /SUB:1:openssl: Invalid command 'nosuchcmd'; type "openssl help" for a list\./);
  });

  it("9. openssl dgst algorithms, -r, -binary, -hmac, -out, EISDIR, ENOENT, and option diagnostics", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      mkdir -p /tmp/dgst_dir
      printf 'payload' > /tmp/dgst.txt

      openssl dgst -sha256 /tmp/dgst.txt
      openssl dgst -sha256 -r /tmp/dgst.txt
      openssl dgst -md5 -hmac 'secret-key' /tmp/dgst.txt
      openssl dgst -sha1 -binary -out /tmp/dgst.bin /tmp/dgst.txt
      echo "BIN_HEX:$(xxd -p /tmp/dgst.bin)"

      openssl dgst -unknown /tmp/dgst.txt 2>/tmp/dgst_opt.err
      echo "DGST_OPT:$?:$(cat /tmp/dgst_opt.err)"

      openssl dgst -signature /tmp/dgst.bin /tmp/dgst.txt 2>/tmp/dgst_sig.err
      echo "DGST_SIG:$?:$(cat /tmp/dgst_sig.err)"

      openssl dgst /tmp/dgst_dir 2>/tmp/dgst_dir.err
      echo "DGST_DIR:$?:$(cat /tmp/dgst_dir.err)"

      openssl dgst /tmp/no_such_dgst.txt 2>/tmp/dgst_noent.err
      echo "DGST_NOENT:$?:$(cat /tmp/dgst_noent.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "SHA2-256(/tmp/dgst.txt)= 239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
        "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5 */tmp/dgst.txt",
        "HMAC-MD5(/tmp/dgst.txt)= ab4f5086f2a93d21728e3cded5df73f9",
        "BIN_HEX:f07e5a815613c5abeddc4b682247a4c42d8a95df",
        "DGST_OPT:1:openssl: unknown option: -unknown",
        "DGST_SIG:1:openssl: -signature requires -verify",
        "DGST_DIR:1:openssl: EISDIR: illegal operation on a directory, readFile '/tmp/dgst_dir'",
        "DGST_NOENT:1:openssl: ENOENT: no such file or directory, readFile '/tmp/no_such_dgst.txt'",
      ].join("\n")
    );
  });

  it("10. openssl rand and openssl base64 option diagnostics, -A single-line mode, EISDIR, and ENOENT", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      mkdir -p /tmp/ob_dir
      openssl rand -hex 8 > /tmp/rand.hex
      rhex="$(cat /tmp/rand.hex)"
      echo "RAND_LEN:\${#rhex}"

      openssl rand 2>/tmp/rand_miss.err
      echo "RAND_MISS:$?:$(cat /tmp/rand_miss.err)"

      openssl rand -hex abc 2>/tmp/rand_abc.err
      echo "RAND_ABC:$?:$(cat /tmp/rand_abc.err)"

      openssl rand -bad 8 2>/tmp/rand_bad.err
      echo "RAND_BAD:$?:$(cat /tmp/rand_bad.err)"

      printf '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' > /tmp/long.txt
      openssl base64 -A -in /tmp/long.txt -out /tmp/long.b64
      echo "B64_A:$(cat /tmp/long.b64)"
      openssl base64 -d -A -in /tmp/long.b64 -out /tmp/long.dec
      cmp -s /tmp/long.txt /tmp/long.dec
      echo "B64_CMP:$?"

      openssl base64 extra 2>/tmp/ob_inv.err
      echo "OB_INV:$?:$(cat /tmp/ob_inv.err)"

      openssl base64 -in /tmp/ob_dir 2>/tmp/ob_dir.err
      echo "OB_DIR:$?:$(cat /tmp/ob_dir.err)"

      openssl base64 -in /tmp/no_such_ob.txt 2>/tmp/ob_noent.err
      echo "OB_NOENT:$?:$(cat /tmp/ob_noent.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /RAND_LEN:16/);
    assert.match(result.stdout, /RAND_MISS:1:openssl: rand requires a byte count and one output format/);
    assert.match(result.stdout, /RAND_ABC:1:openssl: invalid random byte count/);
    assert.match(result.stdout, /RAND_BAD:1:openssl: unknown option: -bad/);
    assert.match(
      result.stdout,
      /B64_A:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZg==\nB64_CMP:0/
    );
    assert.match(result.stdout, /OB_INV:1:openssl: unexpected base64 argument/);
    assert.match(
      result.stdout,
      /OB_DIR:1:openssl: EISDIR: illegal operation on a directory, readFile '\/tmp\/ob_dir'/
    );
    assert.match(
      result.stdout,
      /OB_NOENT:1:openssl: ENOENT: no such file or directory, readFile '\/tmp\/no_such_ob\.txt'/
    );
  });

  it("11. openssl passwd modes (-1, -apr1, -5, -6), -salt, -stdin, mode conflict, rounds validation, and missing password", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      printf 'my-secret\nsecond-secret\n' > /tmp/pws.txt

      openssl passwd -6 -salt mysalt12 -stdin < /tmp/pws.txt

      openssl passwd -1 -6 secret 2>/tmp/pw_conf.err
      echo "PW_CONF:$?:$(cat /tmp/pw_conf.err)"

      openssl passwd -6 -salt 'rounds=bad$salt' secret 2>/tmp/pw_salt.err
      echo "PW_SALT:$?:$(cat /tmp/pw_salt.err)"

      printf '' | openssl passwd -stdin 2>/tmp/pw_empty.err
      echo "PW_EMPTY:$?:$(cat /tmp/pw_empty.err)"

      openssl passwd -bad secret 2>/tmp/pw_opt.err
      echo "PW_OPT:$?:$(cat /tmp/pw_opt.err)"
    `);
    assert.equal(result.exitCode, 0);
    const lines = result.stdout.trim().split("\n");
    assert.match(lines[0] ?? "", /^\$6\$mysalt12\$[./0-9A-Za-z]{86}$/);
    assert.match(lines[1] ?? "", /^\$6\$mysalt12\$[./0-9A-Za-z]{86}$/);
    assert.notEqual(lines[0], lines[1]);
    assert.equal(
      lines.slice(2).join("\n"),
      [
        "PW_CONF:1:openssl: choose one password hash format",
        "PW_SALT:1:openssl: invalid crypt rounds",
        "PW_EMPTY:1:openssl: password required via argument or -stdin",
        "PW_OPT:1:openssl: unknown option: -bad",
      ].join("\n")
    );
  });

  it("12. openssl enc diagnostics (-K/-iv validation, -pass sources, -iter validation, bad decrypt, EISDIR/ENOENT)", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      mkdir -p /tmp/enc_dir
      printf 'confidential message\n' > /tmp/plain.txt
      printf 'file-passphrase\n' > /tmp/pass.txt

      openssl enc -aes-256-cbc -pbkdf2 -iter 2048 -a -pass file:/tmp/pass.txt -in /tmp/plain.txt -out /tmp/cipher.b64
      openssl enc -aes-256-cbc -d -pbkdf2 -iter 2048 -a -pass file:/tmp/pass.txt -in /tmp/cipher.b64 -out /tmp/dec.txt
      echo "DEC:$(cat /tmp/dec.txt)"

      openssl enc -aes-128-cbc -K 001122 -iv 00112233445566778899aabbccddeeff -in /tmp/plain.txt 2>/tmp/enc_k.err
      echo "ENC_K:$?:$(cat /tmp/enc_k.err)"

      openssl enc -aes-128-cbc -K 00112233445566778899aabbccddeeff -in /tmp/plain.txt 2>/tmp/enc_noiv.err
      echo "ENC_NOIV:$?:$(cat /tmp/enc_noiv.err)"

      openssl enc -aes-256-cbc -pbkdf2 -iter 0 -k pass -in /tmp/plain.txt 2>/tmp/enc_iter.err
      echo "ENC_ITER:$?:$(cat /tmp/enc_iter.err)"

      openssl enc -aes-256-cbc -pbkdf2 -pass env:MISSING_PASS_VAR -in /tmp/plain.txt 2>/tmp/enc_pass.err
      echo "ENC_PASS:$?:$(cat /tmp/enc_pass.err)"

      openssl enc -aes-256-cbc -pbkdf2 -pass bogus:val -in /tmp/plain.txt 2>/tmp/enc_src.err
      echo "ENC_SRC:$?:$(cat /tmp/enc_src.err)"

      openssl enc -aes-256-cbc -pbkdf2 -k pass -in /tmp/enc_dir 2>/tmp/enc_dir.err
      echo "ENC_DIR:$?:$(cat /tmp/enc_dir.err)"

      openssl enc -aes-256-cbc -pbkdf2 -k pass -in /tmp/no_such_enc.txt 2>/tmp/enc_noent.err
      echo "ENC_NOENT:$?:$(cat /tmp/enc_noent.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "DEC:confidential message",
        "ENC_K:1:openssl: key must contain 16 bytes and IV 16 bytes",
        "ENC_NOIV:1:openssl: key must contain 16 bytes and IV 16 bytes",
        "ENC_ITER:1:openssl: invalid or excessive -iter: 0",
        "ENC_PASS:1:openssl: password environment variable is not set",
        "ENC_SRC:1:openssl: password source must be pass:, env:, file: or stdin",
        "ENC_DIR:1:openssl: EISDIR: illegal operation on a directory, readFile '/tmp/enc_dir'",
        "ENC_NOENT:1:openssl: ENOENT: no such file or directory, readFile '/tmp/no_such_enc.txt'",
      ].join("\n")
    );
  });

  it("13. openssl genpkey, genrsa, rsa, ecparam, ec, and pkey algorithm/size/curve/format validation diagnostics", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      printf 'not a pem file\n' > /tmp/bad.pem

      openssl genpkey -algorithm DSA 2>/tmp/gp_alg.err
      echo "GP_ALG:$?:$(cat /tmp/gp_alg.err)"

      openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:256 2>/tmp/gp_bits.err
      echo "GP_BITS:$?:$(cat /tmp/gp_bits.err)"

      openssl genrsa 1025 2>/tmp/gr_bits.err
      echo "GR_BITS:$?:$(cat /tmp/gr_bits.err)"

      openssl genrsa notanumber 2>/tmp/gr_nan.err
      echo "GR_NAN:$?:$(cat /tmp/gr_nan.err)"

      openssl ecparam -name secp256k1 2>/tmp/ec_curve.err
      echo "EC_CURVE:$?:$(cat /tmp/ec_curve.err)"

      openssl rsa extra_arg 2>/tmp/rsa_arg.err
      echo "RSA_ARG:$?:$(cat /tmp/rsa_arg.err)"

      openssl rsa -inform TXT -in /tmp/bad.pem 2>/tmp/rsa_fmt.err
      echo "RSA_FMT:$?:$(cat /tmp/rsa_fmt.err)"

      openssl rsa -in /tmp/bad.pem 2>/tmp/rsa_pem.err
      echo "RSA_PEM:$?:$(cat /tmp/rsa_pem.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "GP_ALG:1:openssl: unsupported key algorithm: DSA",
        "GP_BITS:1:openssl: RSA size must be a multiple of 8 from 512 to 4096",
        "GR_BITS:1:openssl: RSA size must be a multiple of 8 from 512 to 4096",
        "GR_NAN:1:openssl: RSA size must be a multiple of 8 from 512 to 4096",
        "EC_CURVE:1:openssl: unsupported curve: secp256k1",
        "RSA_ARG:1:openssl: unexpected key argument",
        "RSA_FMT:1:openssl: format must be PEM or DER",
        "RSA_PEM:1:openssl: invalid PEM input",
      ].join("\n")
    );
  });

  it("14. openssl ecparam ASN.1 OID DER/PEM output, -genkey, and ec/pkey public key extraction", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set -e
      openssl ecparam -name prime256v1 -outform DER -out /tmp/p256.param.der
      openssl ecparam -name secp384r1 -outform DER -out /tmp/p384.param.der
      openssl ecparam -name secp521r1 -outform DER -out /tmp/p521.param.der
      echo "P256_DER:$(xxd -p /tmp/p256.param.der)"
      echo "P384_DER:$(xxd -p /tmp/p384.param.der)"
      echo "P521_DER:$(xxd -p /tmp/p521.param.der)"

      openssl ecparam -name prime256v1 -out /tmp/p256.param.pem
      grep -q "BEGIN EC PARAMETERS" /tmp/p256.param.pem
      echo "P256_PEM:OK"

      openssl ecparam -name secp384r1 -genkey -noout -out /tmp/ec384.key
      openssl ec -in /tmp/ec384.key -pubout -out /tmp/ec384.pub
      openssl pkey -pubin -in /tmp/ec384.pub -text -noout > /tmp/ec384.txt
      grep -q "Public-Key: (P-384)" /tmp/ec384.txt
      echo "EC384_TEXT:OK"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "P256_DER:06082a8648ce3d030107",
        "P384_DER:06052b81040022",
        "P521_DER:06052b81040023",
        "P256_PEM:OK",
        "EC384_TEXT:OK",
      ].join("\n")
    );
  });

  it("15. openssl dgst -sign/-verify and pkeyutl -sign/-verify diagnostics and EC/RSA roundtrips", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      printf 'document to sign\n' > /tmp/doc.txt
      openssl ecparam -name prime256v1 -genkey -noout -out /tmp/ec.key
      openssl pkey -in /tmp/ec.key -pubout -out /tmp/ec.pub

      openssl dgst -sha256 -verify /tmp/no_such_pub.pem /tmp/doc.txt 2>/tmp/dgst_nosig.err
      echo "DGST_NOSIG:$?:$(cat /tmp/dgst_nosig.err)"

      openssl pkeyutl -verify -pubin -inkey /tmp/no_such_pub.pem -in /tmp/doc.txt 2>/tmp/pku_nosig.err
      echo "PKU_NOSIG:$?:$(cat /tmp/pku_nosig.err)"

      openssl pkeyutl -sign -inkey /tmp/ec.key -digest md5 -in /tmp/doc.txt 2>/tmp/pku_md5.err
      echo "PKU_MD5:$?:$(cat /tmp/pku_md5.err)"

      openssl pkeyutl -sign -inkey /tmp/ec.key -digest sha384 -in /tmp/doc.txt -out /tmp/doc.sig
      openssl pkeyutl -verify -pubin -inkey /tmp/ec.pub -digest sha384 -in /tmp/doc.txt -sigfile /tmp/doc.sig >/tmp/pku_ok.out
      echo "PKU_OK:$?:$(cat /tmp/pku_ok.out)"

      printf 'tampered\n' > /tmp/doc_bad.txt
      openssl pkeyutl -verify -pubin -inkey /tmp/ec.pub -digest sha384 -in /tmp/doc_bad.txt -sigfile /tmp/doc.sig >/tmp/pku_bad.out 2>&1
      echo "PKU_BAD:$?:$(cat /tmp/pku_bad.out)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "DGST_NOSIG:1:openssl: sign/verify requires a key and verification requires a signature",
        "PKU_NOSIG:1:openssl: sign/verify requires a key and verification requires a signature",
        "PKU_MD5:1:openssl: unsupported signing digest",
        "PKU_OK:0:Signature Verified Successfully",
        "PKU_BAD:1:Signature Verification Failure",
      ].join("\n")
    );
  });

  it("16. openssl req and x509 diagnostics (-newkey validation, -subj requirement, -inform, -checkend)", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      openssl req -new -newkey rsa:256 2>/tmp/req_bits.err
      echo "REQ_BITS:$?:$(cat /tmp/req_bits.err)"

      openssl req -new -newkey dsa:1024 2>/tmp/req_alg.err
      echo "REQ_ALG:$?:$(cat /tmp/req_alg.err)"

      openssl ecparam -name prime256v1 -genkey -noout -out /tmp/ca.key
      openssl req -new -key /tmp/ca.key 2>/tmp/req_nosubj.err
      echo "REQ_NOSUBJ:$?:$(cat /tmp/req_nosubj.err)"

      openssl req -x509 -key /tmp/ca.key -subj '/CN=test.example.com/O=TestOrg' -days 10 -out /tmp/ca.crt
      openssl x509 -in /tmp/ca.crt -noout -subject -issuer -checkend 60
      echo "CHECKEND_60:$?"

      openssl x509 -in /tmp/ca.crt -noout -checkend 99999999
      echo "CHECKEND_EXP:$?"

      openssl x509 -inform XML -in /tmp/ca.crt 2>/tmp/x509_fmt.err
      echo "X509_FMT:$?:$(cat /tmp/x509_fmt.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "REQ_BITS:1:openssl: RSA size must be a multiple of 8 from 512 to 4096",
        "REQ_ALG:1:openssl: unsupported key algorithm: DSA",
        "REQ_NOSUBJ:1:openssl: -subj is required for noninteractive requests",
        "subject=CN=test.example.com, O=TestOrg",
        "issuer=CN=test.example.com, O=TestOrg",
        "Certificate will not expire",
        "CHECKEND_60:0",
        "Certificate will expire",
        "CHECKEND_EXP:1",
        "X509_FMT:1:openssl: format must be PEM or DER",
      ].join("\n")
    );
  });

  it("17. gpg option and file diagnostics (unknown option, missing signature file, EISDIR, and ENOENT with exit 2)", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      mkdir -p /tmp/gpg_dir

      gpg --unknown-flag 2>/tmp/gpg_opt.err
      echo "GPG_OPT:$?:$(cat /tmp/gpg_opt.err)"

      gpg --verify 2>/tmp/gpg_nosig.err
      echo "GPG_NOSIG:$?:$(cat /tmp/gpg_nosig.err)"

      gpg --import /tmp/gpg_dir 2>/tmp/gpg_imp_dir.err
      echo "GPG_IMP_DIR:$?:$(cat /tmp/gpg_imp_dir.err)"

      gpg --import /tmp/no_such_key.asc 2>/tmp/gpg_imp_noent.err
      echo "GPG_IMP_NOENT:$?:$(cat /tmp/gpg_imp_noent.err)"

      gpg --verify /tmp/no_such_sig.asc 2>/tmp/gpg_ver_noent.err
      echo "GPG_VER_NOENT:$?:$(cat /tmp/gpg_ver_noent.err)"

      gpg --batch --yes --passphrase-file /tmp/no_such_pass.txt -c /etc/hosts 2>/tmp/gpg_pf.err
      echo "GPG_PF:$?:$(cat /tmp/gpg_pf.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "GPG_OPT:2:gpg: unknown option: --unknown-flag",
        "GPG_NOSIG:2:gpg: missing signature file for --verify",
        "GPG_IMP_DIR:2:gpg: EISDIR: illegal operation on a directory, readFile '/tmp/gpg_dir'",
        "GPG_IMP_NOENT:2:gpg: ENOENT: no such file or directory, readFile '/tmp/no_such_key.asc'",
        "GPG_VER_NOENT:2:gpg: ENOENT: no such file or directory, readFile '/tmp/no_such_sig.asc'",
        "GPG_PF:2:gpg: ENOENT: no such file or directory, readFile '/tmp/no_such_pass.txt'",
      ].join("\n")
    );
  });

  it("18. gpg key lifecycle: quick-generate-key, list-keys --with-colons, export, import, detached sign, and verify", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      printf 'release artifact v1.0\n' > /tmp/artifact.txt

      gpg --batch --quick-generate-key "Release Bot <bot@example.com>" >/tmp/gen.out
      echo "GEN:$?"

      gpg --list-keys --with-colons "bot@example.com" > /tmp/cols.txt
      grep -q "^sec:" /tmp/cols.txt && grep -q "^uid:" /tmp/cols.txt && grep -q "Release Bot <bot@example.com>" /tmp/cols.txt
      echo "COLS:$?"

      gpg --armor --export > /tmp/sec.asc
      rm -f /home/user/.gnupg/keyring.json

      gpg --import /tmp/sec.asc >/tmp/imp.out 2>&1
      echo "REIMPORT:$?"

      gpg --batch --yes --status-fd 2 -u "bot@example.com" --armor --detach-sign -o /tmp/artifact.sig /tmp/artifact.txt 2>/tmp/sign.err
      grep -q "\\[GNUPG:\\] SIG_CREATED" /tmp/sign.err
      echo "SIGNED:$?"

      gpg --verify /tmp/artifact.sig /tmp/artifact.txt 2>/tmp/ver.err
      echo "VERIFY:$?:$(grep -o 'Good signature from \"Release Bot <bot@example.com>\"' /tmp/ver.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "GEN:0",
        "COLS:0",
        "REIMPORT:0",
        "SIGNED:0",
        'VERIFY:0:Good signature from "Release Bot <bot@example.com>"',
      ].join("\n")
    );
  });

  it("19. ssh and ssh-keygen option, argument, and EISDIR/ENOENT diagnostics", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set +e
      mkdir -p /tmp/ssh_dir

      ssh -G -p 2222 -i /tmp/id_custom deploy@prod.example.com > /tmp/ssh_g.out
      echo "SSH_G:$?:$(tr '\n' ';' < /tmp/ssh_g.out)"

      ssh 2>/tmp/ssh_nohost.err
      echo "SSH_NOHOST:$?:$(cat /tmp/ssh_nohost.err)"

      ssh deploy@prod.example.com 2>/tmp/ssh_inter.err
      echo "SSH_INTER:$?:$(cat /tmp/ssh_inter.err)"

      ssh -p 2222 deploy@prod.example.com git-upload-pack /repo.git > /tmp/ssh_cmd.out
      echo "SSH_CMD:$?:$(cat /tmp/ssh_cmd.out)"

      ssh-keygen -Z 2>/tmp/sk_opt.err
      echo "SK_OPT:$?:$(cat /tmp/sk_opt.err)"

      ssh-keygen -y -f /tmp/ssh_dir 2>/tmp/sk_dir.err
      echo "SK_DIR:$?:$(cat /tmp/sk_dir.err)"

      ssh-keygen -l -f /tmp/no_such_key.pub 2>/tmp/sk_noent.err
      echo "SK_NOENT:$?:$(cat /tmp/sk_noent.err)"

      ssh-keygen -Y sign -f /tmp/no_such_key -n file /etc/hosts 2>/tmp/sk_ysign.err
      echo "SK_YSIGN:$?:$(cat /tmp/sk_ysign.err)"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.trim(),
      [
        "SSH_G:0:user deploy;hostname prod.example.com;port 2222;identityfile /tmp/id_custom;",
        "SSH_NOHOST:1:Hi git! You've successfully authenticated, but localhost does not provide interactive shell access.",
        "SSH_INTER:1:Hi deploy! You've successfully authenticated, but prod.example.com does not provide interactive shell access.",
        "SSH_CMD:0:ssh:deploy@prod.example.com:2222 git-upload-pack /repo.git",
        "SK_OPT:1:ssh-keygen: unsupported option: -Z",
        "SK_DIR:1:ssh-keygen: EISDIR: illegal operation on a directory, readFile '/tmp/ssh_dir'",
        "SK_NOENT:1:ssh-keygen: ENOENT: no such file or directory, readFile '/tmp/no_such_key.pub'",
        "SK_YSIGN:1:ssh-keygen: ENOENT: no such file or directory, readFile '/tmp/no_such_key'",
      ].join("\n")
    );
  });

  it("20. ssh-keygen SHA256 fingerprints, known_hosts -F/-R, and -Y sign/verify/check-novalidate/find-principals", async () => {
    const bash = await createEnv();
    const result = await bash.exec(`
      set -e
      ssh-keygen -q -t ed25519 -C "alice@example.com" -N "" -f /tmp/id_ed25519 >/dev/null
      fp_sha="$(ssh-keygen -l -f /tmp/id_ed25519.pub)"
      derived="$(ssh-keygen -y -f /tmp/id_ed25519)"
      echo "FP_SHA:$fp_sha"

      pub_key="$(cat /tmp/id_ed25519.pub)"
      [ "$derived" = "$pub_key" ]
      echo "DERIVED_MATCH:$?"

      printf 'git.example.com %s\nother.example.com %s\n' "$pub_key" "$pub_key" > /tmp/known_hosts
      found="$(ssh-keygen -F git.example.com -f /tmp/known_hosts)"
      echo "FOUND:$(printf '%s' "$found" | grep -c '^git\.example\.com ')"

      ssh-keygen -R git.example.com -f /tmp/known_hosts >/dev/null
      set +e
      ssh-keygen -F git.example.com -f /tmp/known_hosts >/dev/null
      echo "AFTER_REMOVE:$?"
      set -e
      ssh-keygen -F other.example.com -f /tmp/known_hosts >/dev/null
      echo "OTHER_STILL_THERE:$?"

      printf 'alice@example.com namespaces="file,git" %s\n' "$pub_key" > /tmp/allowed_signers
      printf 'signed release tag\n' > /tmp/tag.txt
      ssh-keygen -Y sign -f /tmp/id_ed25519 -n git /tmp/tag.txt >/dev/null
      principal="$(ssh-keygen -Y find-principals -f /tmp/allowed_signers -s /tmp/tag.txt.sig)"
      echo "PRINCIPAL:$principal"
      ssh-keygen -Y check-novalidate -n git -s /tmp/tag.txt.sig < /tmp/tag.txt >/dev/null
      echo "NOVALIDATE:$?"
      ssh-keygen -Y verify -f /tmp/allowed_signers -I alice@example.com -n git -s /tmp/tag.txt.sig < /tmp/tag.txt >/dev/null
      echo "Y_VERIFY:$?"
    `);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /FP_SHA:256 SHA256:[A-Za-z0-9+/]{43} alice@example\.com \(ED25519\)/);
    assert.match(result.stdout, /DERIVED_MATCH:0/);
    assert.match(result.stdout, /FOUND:1/);
    assert.match(result.stdout, /AFTER_REMOVE:1/);
    assert.match(result.stdout, /OTHER_STILL_THERE:0/);
    assert.match(result.stdout, /PRINCIPAL:alice@example\.com/);
    assert.match(result.stdout, /NOVALIDATE:0/);
    assert.match(result.stdout, /Y_VERIFY:0/);
  });
});
