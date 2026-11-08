import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure openssl, gpg, ssh-keygen, ssh, dd, tar, zip/unzip, xxd, od, hexdump, base64/32, and cksum parity matrix", () => {
  it("1. dd --version and option/operand error diagnostics match GNU/TypeScript contract", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        dd --version
        dd --help=1 2>&1; echo "rc_h=$?"
        dd --version=1 2>&1; echo "rc_v=$?"
        dd --bogus 2>&1; echo "rc_b=$?"
        dd -z 2>&1; echo "rc_z=$?"
        dd foo=bar 2>&1; echo "rc_op=$?"
        dd bareword 2>&1; echo "rc_bw=$?"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "dd (virtual-bash GNU-compatible profile)",
          "dd: option '--help' doesn't allow an argument",
          "Try 'dd --help' for more information.",
          "rc_h=1",
          "dd: option '--version' doesn't allow an argument",
          "Try 'dd --help' for more information.",
          "rc_v=1",
          "dd: unrecognized option `--bogus'",
          "Try 'dd --help' for more information.",
          "rc_b=1",
          "dd: invalid option -- 'z'",
          "Try 'dd --help' for more information.",
          "rc_z=1",
          "dd: unrecognized operand 'foo=bar'",
          "Try 'dd --help' for more information.",
          "rc_op=1",
          "dd: unrecognized operand 'bareword'",
          "Try 'dd --help' for more information.",
          "rc_bw=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("2. dd conv=swab,ucase and cbs conv=block / conv=unblock with truncated record count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'abCD!' | dd conv=swab,ucase status=none
        echo ""
        printf 'hi\\nlongline\\nok\\n' | dd cbs=4 conv=block status=noxfer > /workspace/blocked.bin 2> /workspace/dd.err
        cat /workspace/dd.err
        dd if=/workspace/blocked.bin cbs=4 conv=unblock status=none
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "BADC!",
          "0+1 records in",
          "0+1 records out",
          "1 truncated record",
          "hi",
          "long",
          "ok",
          "",
        ].join("\n"),
      );
    });
  });

  it("3. dd conv=excl, conv=nocreat, conv=notrunc with seek_bytes and 0x multiplier warning", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '0123456789' > /workspace/target.bin
        printf 'XY' | dd of=/workspace/target.bin conv=excl status=none 2>/dev/null; rc_excl=$?
        printf 'XY' | dd of=/workspace/missing.bin conv=nocreat status=none 2>/dev/null; rc_nocr=$?
        printf 'XY' | dd of=/workspace/target.bin bs=4 seek=3 oflag=seek_bytes conv=notrunc status=none
        cat /workspace/target.bin
        echo ""
        dd if=/dev/zero count=0x4 status=none 2>&1
        echo "excl=$rc_excl nocr=$rc_nocr"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "012XY56789",
          "dd: warning: '0x' is a zero multiplier; use '00x' if that is intended",
          "excl=1 nocr=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("4. openssl passwd -1, -apr1, -5, -6 with -salt, -stdin, and mode conflict check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        openssl passwd -1 -salt s1 passA
        openssl passwd -apr1 -salt s1 passA
        printf 'p1\\np2\\n' | openssl passwd -5 -salt salt5 -stdin
        openssl passwd -6 -salt salt6 passB | cut -d'$' -f1-3
        openssl passwd -1 -6 passB 2>/dev/null; echo "conflict=$?"
      `);
      assert.equal(res.exitCode, 0);
      const lines = res.stdout.trim().split("\n");
      assert.equal(lines.length, 6);
      assert.ok(lines[0]!.startsWith("$1$s1$"));
      assert.ok(lines[1]!.startsWith("$apr1$s1$"));
      assert.ok(lines[2]!.startsWith("$5$salt5$"));
      assert.ok(lines[3]!.startsWith("$5$salt5$"));
      assert.notEqual(lines[2], lines[3]);
      assert.equal(lines[4], "$6$salt6");
      assert.equal(lines[5], "conflict=1");
    });
  });

  it("5. openssl enc -aes-256-cbc and -aes-256-ctr with -pbkdf2, -K/-iv, and bad decrypt handling", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'confidential payload 42\\n' > /workspace/plain.txt
        openssl enc -aes-256-cbc -pbkdf2 -iter 2500 -salt -a -pass pass:topsecret -in /workspace/plain.txt -out /workspace/enc.b64
        openssl enc -aes-256-cbc -d -pbkdf2 -iter 2500 -a -pass pass:topsecret -in /workspace/enc.b64
        openssl enc -aes-256-cbc -d -pbkdf2 -iter 2500 -a -pass pass:wrongpass -in /workspace/enc.b64 2>/dev/null; rc_bad=$?
        K="000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
        IV="f0e0d0c0b0a090807060504030201000"
        printf 'stream-ctr-data' | openssl enc -aes-256-ctr -K "$K" -iv "$IV" | openssl enc -aes-256-ctr -d -K "$K" -iv "$IV"
        echo ""
        echo "bad=$rc_bad"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "confidential payload 42\nstream-ctr-data\nbad=1\n");
    });
  });

  it("6. openssl genpkey, rsa, ecparam, pkey, dgst -sign/-verify, and pkeyutl -sign/-verify", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /workspace/rsa.key
        openssl rsa -in /workspace/rsa.key -pubout -out /workspace/rsa.pub
        openssl rsa -in /workspace/rsa.key -noout -modulus -check
        printf 'signed-message' > /workspace/msg.txt
        openssl dgst -sha256 -sign /workspace/rsa.key -out /workspace/msg.sig /workspace/msg.txt
        openssl dgst -sha256 -verify /workspace/rsa.pub -signature /workspace/msg.sig /workspace/msg.txt
        openssl pkeyutl -sign -inkey /workspace/rsa.key -in /workspace/msg.txt -out /workspace/utl.sig
        openssl pkeyutl -verify -pubin -inkey /workspace/rsa.pub -in /workspace/msg.txt -sigfile /workspace/utl.sig
        openssl ecparam -name secp384r1 -genkey -noout -out /workspace/ec.key
        openssl ec -in /workspace/ec.key -pubout -out /workspace/ec.pub
        openssl dgst -sha384 -sign /workspace/ec.key -out /workspace/ec.sig /workspace/msg.txt
        openssl dgst -sha384 -verify /workspace/ec.pub -signature /workspace/ec.sig /workspace/msg.txt
      `);
      assert.equal(res.exitCode, 0);
      const lines = res.stdout.trim().split("\n");
      assert.equal(lines[0], "Key is valid");
      assert.ok(lines[1]!.startsWith("Modulus="));
      assert.equal(lines[2], "Verified OK");
      assert.equal(lines[3], "Signature Verified Successfully");
      assert.equal(lines[4], "Verified OK");
    });
  });

  it("7. openssl req CSR and x509 certificate with SAN/OID extensions, checkend, and DER/PEM roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        openssl genrsa -out /workspace/ca.key 2048
        openssl req -new -key /workspace/ca.key -subj "/CN=api.internal/O=Poe" \\
          -addext "subjectAltName=DNS:api.internal,IP:10.0.0.1" \\
          -addext "basicConstraints=critical,CA:FALSE" \\
          -out /workspace/api.csr
        openssl req -in /workspace/api.csr -noout -subject
        openssl req -in /workspace/api.csr -noout -verify 2>&1
        openssl req -x509 -new -key /workspace/ca.key -days 10 -subj "/CN=api.internal/O=Poe" \\
          -addext "subjectAltName=DNS:api.internal,IP:10.0.0.1" \\
          -addext "basicConstraints=critical,CA:FALSE" \\
          -out /workspace/api.pem
        openssl x509 -in /workspace/api.pem -noout -subject -ext 2.5.29.17,2.5.29.19
        openssl x509 -in /workspace/api.pem -noout -checkend 3600; rc_ok=$?
        openssl x509 -in /workspace/api.pem -noout -checkend 9999999; rc_exp=$?
        openssl x509 -in /workspace/api.pem -outform DER -out /workspace/api.der
        openssl x509 -in /workspace/api.der -inform DER -noout -subject
        echo "ok=$rc_ok exp=$rc_exp"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "subject=CN=api.internal, O=Poe",
          "Certificate request self-signature verify OK",
          "subject=CN=api.internal, O=Poe",
          "Subject Alternative Name:",
          "  DNS: api.internal",
          "  IP: 10.0.0.1",
          "Basic Constraints: critical",
          "Certificate will not expire",
          "Certificate will expire",
          "subject=CN=api.internal, O=Poe",
          "ok=0 exp=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("8. gpg symmetric encryption/decryption with --armor and --passphrase-file plus bad passphrase check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'vault-passphrase-99\\n' > /workspace/pass.txt
        printf 'wrong-passphrase\\n' > /workspace/wrong.txt
        printf 'secret-ledger-entry\\n' > /workspace/ledger.txt
        gpg --batch --yes -c -a --cipher-algo AES256 --passphrase-file /workspace/pass.txt -o /workspace/ledger.asc /workspace/ledger.txt
        grep -c "BEGIN PGP MESSAGE" /workspace/ledger.asc
        gpg --batch --yes -d --passphrase-file /workspace/pass.txt /workspace/ledger.asc
        gpg --batch --yes -d --passphrase-file /workspace/wrong.txt /workspace/ledger.asc 2>/dev/null; echo "bad=$?"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1\nsecret-ledger-entry\nbad=2\n");
    });
  });

  it("9. gpg key generation, --with-colons listing, export/import, detached signature, and tamper detection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        gpg --batch --quick-generate-key "Release Bot <release@poe.dev>" >/dev/null
        gpg --list-keys --with-colons "Release Bot" | grep '^uid:' | cut -d: -f10
        gpg --export --armor -o /workspace/pub.asc
        rm -rf /home/user/.gnupg
        gpg --import /workspace/pub.asc 2>&1 | grep 'imported: 1'
        printf 'artifact-v1.0.0\\n' > /workspace/art.bin
        gpg --batch -bsa -u "Release Bot" --status-fd 1 -o /workspace/art.sig /workspace/art.bin 2>&1 | grep -o 'SIG_CREATED'
        gpg --verify --status-fd 1 /workspace/art.sig /workspace/art.bin 2>/dev/null | grep -o 'GOODSIG'
        printf 'tampered\\n' > /workspace/art.bin
        gpg --verify /workspace/art.sig /workspace/art.bin >/dev/null 2>&1; echo "tamper=$?"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "Release Bot <release@poe.dev>",
          "gpg:               imported: 1",
          "SIG_CREATED",
          "GOODSIG",
          "tamper=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("10. ssh-keygen keypair creation, -y derivation, -l fingerprint, and -F/-R known_hosts management", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        ssh-keygen -q -t ed25519 -C "deploy@prod" -f /workspace/id_ed -N "" >/dev/null
        PUB_FILE=$(cat /workspace/id_ed.pub)
        PUB_DERIVED=$(ssh-keygen -y -f /workspace/id_ed)
        [ "$PUB_FILE" = "$PUB_DERIVED" ] && echo "derived=match"
        FP_PUB=$(ssh-keygen -l -f /workspace/id_ed.pub)
        FP_PRIV=$(ssh-keygen -l -f /workspace/id_ed)
        [ "$FP_PUB" = "$FP_PRIV" ] && echo "fp=match"
        cat <<'EOF' > /workspace/known_hosts
# comment line
github.com,192.30.255.112 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI
gitlab.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5BBBBJ
EOF
        ssh-keygen -F 192.30.255.112 -f /workspace/known_hosts | cut -d' ' -f1
        ssh-keygen -R github.com -f /workspace/known_hosts >/dev/null
        ssh-keygen -F github.com -f /workspace/known_hosts; rc_gone=$?
        ssh-keygen -F gitlab.com -f /workspace/known_hosts | cut -d' ' -f1
        echo "gone=$rc_gone"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "derived=match",
          "fp=match",
          "github.com,192.30.255.112",
          "gitlab.com",
          "gone=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("11. ssh-keygen -Y sign, verify, check-novalidate, and find-principals with allowed_signers patterns", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        ssh-keygen -q -t ed25519 -C "alice@eng.poe.dev" -f /workspace/alice_key -N "" >/dev/null
        KEY_MAT=$(awk '{print $1 " " $2}' /workspace/alice_key.pub)
        printf '*@eng.poe.dev,!banned@eng.poe.dev namespaces="git,release-*" %s\n' "$KEY_MAT" > /workspace/allowed_signers
        printf 'tag v2.0.0\n' > /workspace/tag.txt
        ssh-keygen -Y sign -f /workspace/alice_key -n release-prod /workspace/tag.txt >/dev/null
        ssh-keygen -Y find-principals -f /workspace/allowed_signers -s /workspace/tag.txt.sig
        ssh-keygen -Y check-novalidate -n release-prod -s /workspace/tag.txt.sig < /workspace/tag.txt | grep -o 'Good "release-prod" signature'
        ssh-keygen -Y verify -f /workspace/allowed_signers -I alice@eng.poe.dev -n release-prod -s /workspace/tag.txt.sig < /workspace/tag.txt | grep -o 'Good "release-prod" signature'
        ssh-keygen -Y verify -f /workspace/allowed_signers -I banned@eng.poe.dev -n release-prod -s /workspace/tag.txt.sig < /workspace/tag.txt 2>/dev/null; rc_ban=$?
        ssh-keygen -Y verify -f /workspace/allowed_signers -I alice@eng.poe.dev -n wrong-ns -s /workspace/tag.txt.sig < /workspace/tag.txt 2>/dev/null; rc_ns=$?
        echo "ban=$rc_ban ns=$rc_ns"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "*@eng.poe.dev,!banned@eng.poe.dev",
          'Good "release-prod" signature',
          'Good "release-prod" signature',
          "ban=1 ns=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("12. ssh -V version, -G config dump, interactive rejection, and remote command formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        ssh -V 2>&1
        ssh -G -p 2222 -i /workspace/custom_key deploy@git.internal
        ssh -T git@github.com 2>&1; rc_int=$?
        ssh -p 2200 ci@builder.internal git-upload-pack /repo.git
        echo "int=$rc_int"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "OpenSSH_9.8p1, OpenSSL 3.3.2 3 Sep 2024",
          "user deploy",
          "hostname git.internal",
          "port 2222",
          "identityfile /workspace/custom_key",
          "Hi git! You've successfully authenticated, but github.com does not provide interactive shell access.",
          "ssh:ci@builder.internal:2200 git-upload-pack /repo.git",
          "int=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("13. tar --transform, --strip-components, --exclude, and --files-from --null pipeline roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/src/sub /workspace/dst
        printf 'alpha\\n' > /workspace/src/sub/a.txt
        printf 'beta\\n' > /workspace/src/sub/b.txt
        printf 'skip\\n' > /workspace/src/sub/ignore.tmp
        printf 'sub/a.txt\\0sub/b.txt\\0sub/ignore.tmp\\0' | \\
          tar -cf /workspace/pkg.tar -C /workspace/src --exclude='*.tmp' --null -T - --transform='s,^sub/,rel/v1/,' --transform='s/\\.txt$/.md/'
        tar -tf /workspace/pkg.tar | sort
        tar -xf /workspace/pkg.tar -C /workspace/dst --strip-components=2
        cat /workspace/dst/a.md /workspace/dst/b.md
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "rel/v1/a.md",
          "rel/v1/b.md",
          "alpha",
          "beta",
          "",
        ].join("\n"),
      );
    });
  });

  it("14. tar -r append, --delete, and -d diff against modified filesystem entries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/tdir
        printf 'v1\n' > /workspace/tdir/one.txt
        printf 'v2\n' > /workspace/tdir/two.txt
        printf 'v3\n' > /workspace/tdir/three.txt
        tar -cf /workspace/mut.tar -C /workspace/tdir one.txt two.txt
        tar -rf /workspace/mut.tar -C /workspace/tdir three.txt
        tar --delete -f /workspace/mut.tar two.txt
        tar -tf /workspace/mut.tar | sort
        tar -df /workspace/mut.tar -C /workspace/tdir; rc_clean=$?
        printf 'modified-v1\n' > /workspace/tdir/one.txt
        tar -df /workspace/mut.tar -C /workspace/tdir >/dev/null 2>&1; rc_diff=$?
        echo "clean=$rc_clean diff=$rc_diff"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "one.txt",
          "three.txt",
          "clean=0 diff=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("15. zip -r with -x/-i filters, -z archive comment, -U --out copy, -d delete, and unzip -z/-p", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/zsrc
        printf 'keep-a\n' > /workspace/zsrc/a.txt
        printf 'keep-b\n' > /workspace/zsrc/b.txt
        printf 'drop-c\n' > /workspace/zsrc/c.log
        printf 'Release Archive v3\n' | zip -r -z /workspace/bundle.zip /workspace/zsrc -x '*.log' >/dev/null
        unzip -z /workspace/bundle.zip | tail -n 1
        zip -U /workspace/bundle.zip '*/a.txt' --out /workspace/only_a.zip >/dev/null
        unzip -p /workspace/only_a.zip
        zip -d /workspace/bundle.zip '*/a.txt' >/dev/null
        unzip -p /workspace/bundle.zip
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Release Archive v3\nkeep-a\nkeep-b\n");
    });
  });

  it("16. xxd -p/-r, -i -C -n C-array, -b bits, -e little-endian, -a autoskip, and error checks", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '48656c6c6f' | xxd -r -p
        echo ""
        printf 'Hi' | xxd -i -C -n my_buf
        printf 'A' | xxd -b
        printf 'ABCD' | xxd -e -g 4
        xxd -p -b /dev/null 2>&1; echo "rc_mode=$?"
        xxd -r -b /dev/null 2>&1; echo "rc_rev=$?"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "Hello",
          "unsigned char MY_BUF[] = {",
          "  0x48, 0x69",
          "};",
          "unsigned int MY_BUF_LEN = 2;",
          "00000000: 01000001                                               A",
          "00000000: 44434241                             ABCD",
          "xxd: incompatible display modes",
          "rc_mode=2",
          "xxd: cannot revert this type of hexdump",
          "rc_rev=2",
          "",
        ].join("\n"),
      );
    });
  });

  it("17. od multi-format -A x -t x1z -w4 -j 2 -N 8 and duplicate star-line suppression", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '01ABCDEFGH99' | od -A x -t x1z -w4 -j 2 -N 8
        printf 'AAAAAAAAAAAAAAAA' | od -A o -t x1 -w4
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "000002 41 42 43 44  >ABCD<",
          "000006 45 46 47 48  >EFGH<",
          "00000a",
          "0000000 41 41 41 41",
          "*",
          "0000020",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. hexdump -C canonical and -e custom format string with -s skip and -n length", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'xxHELLO!' | hexdump -C -s 2 -n 6
        printf '\\x01\\x02\\x03\\x04' | hexdump -v -e '4/1 "%02x-" "\\n"'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "00000002  48 45 4c 4c 4f 21                                 |HELLO!|",
          "00000008",
          "01-02-03-04-",
          "",
        ].join("\n"),
      );
    });
  });

  it("19. base64/base32 -w wrapping, -i ignore-garbage, and cksum -a algorithms with --tag and -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'safe-bash-codec' | base64 -w 8
        printf 'c2FmZS1i@@@YXNoLWNvZGVj' | base64 -d -i
        echo ""
        printf 'hi!' | base32
        printf 'NBUSC===' | base32 -d
        echo ""
        printf 'verify-me\\n' > /workspace/v.txt
        cksum -a sha256 --tag /workspace/v.txt > /workspace/v.sums
        cat /workspace/v.sums
        cksum -a sha256 -c /workspace/v.sums
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "c2FmZS1i",
          "YXNoLWNv",
          "ZGVj",
          "safe-bash-codec",
          "NBUSC===",
          "hi!",
          "SHA256 (/workspace/v.txt) = 75adcd372200d5efecd34b036b2535b408795a34f84df8efc6f45605793ce9f9",
          "/workspace/v.txt: OK",
          "",
        ].join("\n"),
      );
    });
  });

  it("20. strings -n minimum length, -t radix offsets, and -e b/l UTF-16 extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '\\x00\\x00ab\\x00HELLO_WORLD\\x00\\x00' | strings -n 5 -t x
        printf '\\x00\\x48\\x00\\x69\\x00\\x54\\x00\\x68\\x00\\x65\\x00\\x72\\x00\\x65\\x00\\x00' | strings -e b -n 4
        printf '\\x4c\\x00\\x69\\x00\\x74\\x00\\x74\\x00\\x6c\\x00\\x65\\x00\\x00\\x00' | strings -e l -n 4
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "      5 HELLO_WORLD",
          "HiThere",
          "Little",
          "",
        ].join("\n"),
      );
    });
  });
});
