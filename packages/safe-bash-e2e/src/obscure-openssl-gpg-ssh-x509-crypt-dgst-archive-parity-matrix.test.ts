import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure openssl, gpg, ssh, ssh-keygen, x509, crypt, dgst, and archive parity matrix", () => {
  it("1. openssl RSA-2048 genpkey, pkey -pubout/-check, rsa -modulus/-text, DER round-trip, and 256-byte dgst -sign/-verify", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/dossier.pdf": "%PDF-1.7 signed payload\n",
          "/workspace/tampered.pdf": "%PDF-1.7 tampered payload\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /workspace/rsa-priv.pem
          priv_len=$(wc -c < /workspace/rsa-priv.pem | tr -d ' ')
          test "$priv_len" -gt 1200
          openssl pkey -in /workspace/rsa-priv.pem -check -noout
          openssl pkey -in /workspace/rsa-priv.pem -pubout -out /workspace/rsa-pub.pem
          pub_len=$(wc -c < /workspace/rsa-pub.pem | tr -d ' ')
          test "$pub_len" -gt 400
          openssl rsa -in /workspace/rsa-priv.pem -noout -modulus | grep -q '^Modulus='
          openssl rsa -in /workspace/rsa-priv.pem -noout -text | grep -q 'Private-Key: (2048 bit)'
          openssl dgst -sha256 -sign /workspace/rsa-priv.pem -out /workspace/dossier.sig /workspace/dossier.pdf
          sig_len=$(wc -c < /workspace/dossier.sig | tr -d ' ')
          echo "SIG_LEN=$sig_len"
          openssl dgst -sha256 -verify /workspace/rsa-pub.pem -signature /workspace/dossier.sig /workspace/dossier.pdf
          if openssl dgst -sha256 -verify /workspace/rsa-pub.pem -signature /workspace/dossier.sig /workspace/tampered.pdf >/dev/null 2>&1; then
            echo "UNEXPECTED_VERIFY"
            exit 1
          fi
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /Key is valid/);
        assert.match(res.stdout, /SIG_LEN=256/);
        assert.match(res.stdout, /Verified OK/);
      },
    );
  });

  it("2. openssl EC curves (prime256v1, secp384r1, secp521r1) ecparam -genkey, DER/PEM conversion, and dgst -sign/-verify", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/msg.txt": "elliptic curve message\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          for curve in prime256v1 secp384r1 secp521r1; do
            openssl ecparam -name "$curve" -text -noout | grep -q "ASN1 OID: $curve"
            openssl ecparam -name "$curve" -genkey -noout -out "/workspace/$curve.key"
            openssl ec -in "/workspace/$curve.key" -pubout -out "/workspace/$curve.pub"
            openssl pkey -in "/workspace/$curve.key" -outform DER -out "/workspace/$curve.der"
            openssl pkey -inform DER -in "/workspace/$curve.der" -pubout -out "/workspace/$curve.der.pub"
            cmp -s "/workspace/$curve.pub" "/workspace/$curve.der.pub"
            openssl dgst -sha256 -sign "/workspace/$curve.key" -out "/workspace/$curve.sig" /workspace/msg.txt
            openssl dgst -sha256 -verify "/workspace/$curve.pub" -signature "/workspace/$curve.sig" /workspace/msg.txt
          done
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout.trim().split("\n").length, 3);
      },
    );
  });

  it("3. openssl Ed25519 genpkey, pkey -pubout, and pkeyutl -sign/-verify with tamper rejection", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/payload.txt": "forensics payload\n",
          "/workspace/tampered.txt": "tampered payload\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          openssl genpkey -algorithm Ed25519 -out /workspace/ed-priv.pem
          openssl pkey -in /workspace/ed-priv.pem -pubout -out /workspace/ed-pub.pem
          openssl pkeyutl -sign -rawin -inkey /workspace/ed-priv.pem -in /workspace/payload.txt -out /workspace/payload.sig
          openssl pkeyutl -verify -rawin -pubin -inkey /workspace/ed-pub.pem -in /workspace/payload.txt -sigfile /workspace/payload.sig
          if openssl pkeyutl -verify -rawin -pubin -inkey /workspace/ed-pub.pem -in /workspace/tampered.txt -sigfile /workspace/payload.sig >/dev/null 2>&1; then
            exit 1
          fi
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "Signature Verified Successfully\n");
      },
    );
  });

  it("4. openssl req -x509 self-signed certificate with -addext, -ext inspection, -checkend validity, and DER round-trip", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        openssl req -new -x509 -nodes -newkey ec:prime256v1 \\
          -keyout /workspace/ca.key \\
          -subj "/CN=test.example/O=Test" \\
          -days 3 \\
          -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \\
          -addext "subjectAltName=DNS:test.example,IP:127.0.0.1" \\
          -addext "keyUsage=critical,digitalSignature,keyCertSign" \\
          -addext "extendedKeyUsage=serverAuth,clientAuth" \\
          -addext "subjectKeyIdentifier=hash" \\
          -out /workspace/ca.crt
        openssl x509 -in /workspace/ca.crt -noout -subject -issuer -serial
        openssl x509 -in /workspace/ca.crt -noout -ext subjectAltName,basicConstraints,keyUsage,extendedKeyUsage
        openssl x509 -in /workspace/ca.crt -noout -ext 2.5.29.17
        openssl x509 -in /workspace/ca.crt -noout -checkend 1
        set +e
        openssl x509 -in /workspace/ca.crt -noout -checkend 999999
        exp_rc=$?
        set -e
        echo "EXP_RC=$exp_rc"
        openssl x509 -in /workspace/ca.crt -outform DER -out /workspace/ca.der
        openssl x509 -inform DER -in /workspace/ca.der -noout -subject
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /subject=CN=test\.example, O=Test/);
      assert.match(res.stdout, /issuer=CN=test\.example, O=Test/);
      assert.match(res.stdout, /DNS: test\.example/);
      assert.match(res.stdout, /CA: true/);
      assert.match(res.stdout, /Path Length: 1/);
      assert.match(res.stdout, /digitalSignature, keyCertSign/);
      assert.match(res.stdout, /TLS WWW server authentication, TLS WWW client authentication/);
      assert.match(res.stdout, /Certificate will not expire/);
      assert.match(res.stdout, /Certificate will expire\nEXP_RC=1/);
    });
  });

  it("5. openssl req CSR self-signature verification and -addext / key type error diagnostics", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:1024 -out /workspace/csr.key
        openssl req -new -key /workspace/csr.key -subj "/CN=csr.example/O=Poe" -out /workspace/req.csr
        grep -q "BEGIN CERTIFICATE REQUEST" /workspace/req.csr
        openssl req -in /workspace/req.csr -noout -verify -subject 2>/workspace/verify.err
        cat /workspace/verify.err
        set +e
        openssl req -new -x509 -key /workspace/csr.key -subj "/CN=bad" -addext "basicConstraints=CA:MAYBE" >/dev/null 2>&1
        rc1=$?
        openssl req -new -x509 -key /workspace/csr.key -subj "/CN=bad" -addext "subjectAltName=BAD:x" >/dev/null 2>&1
        rc2=$?
        openssl ec -in /workspace/csr.key -noout >/dev/null 2>&1
        rc3=$?
        set -e
        echo "RCS=$rc1,$rc2,$rc3"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /subject=CN=csr\.example, O=Poe/);
      assert.match(res.stdout, /Certificate request self-signature verify OK/);
      assert.match(res.stdout, /RCS=1,1,1/);
    });
  });

  it("6. openssl passwd modular crypt (-1, -apr1, -5, -6, rounds= prefix, -stdin, and UTF-8)", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        openssl passwd -1 -salt salt password
        openssl passwd -apr1 -salt salt password
        openssl passwd -5 -salt salt password
        openssl passwd -6 -salt salt password
        openssl passwd -5 -salt 'rounds=1000$salt' password
        printf 'password\\nignored\\n' | openssl passwd -6 -salt salt -stdin
        openssl passwd -1 -salt salt "ąßé"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      const lines = res.stdout.trim().split("\n");
      assert.equal(lines.length, 8);
      assert.equal(lines[0], "$1$salt$qJH7.N4xYta3aEG/dfqo/0");
      assert.ok(lines[1]!.startsWith("$apr1$salt$"));
      assert.ok(lines[2]!.startsWith("$5$salt$"));
      assert.ok(lines[3]!.startsWith("$6$salt$"));
      assert.ok(lines[4]!.startsWith("$5$rounds=1000$salt$"));
      assert.equal(lines[5], lines[3]);
      assert.ok(lines[6]!.startsWith("$6$salt$"));
      assert.notEqual(lines[6], lines[5]);
      assert.ok(lines[7]!.startsWith("$1$salt$"));
    });
  });

  it("7. openssl enc AES-128-CBC, AES-256-CBC, and AES-256-CTR with PBKDF2, EVP, raw key/IV, and env/file/stdin pass sources", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/plain.bin": "payload with more than one AES block 0123456789abcdef\n",
          "/workspace/pw.txt": "my-secret-pw\nextra-line\n",
        },
        env: { SECRET_PW: "my-secret-pw" },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          for cipher in -aes-128-cbc -aes-256-cbc -aes-256-ctr; do
            openssl enc "$cipher" -pbkdf2 -iter 50 -pass pass:my-secret-pw -in /workspace/plain.bin -out "/workspace/c$cipher.enc" -a
            openssl enc "$cipher" -d -pbkdf2 -iter 50 -pass env:SECRET_PW -in "/workspace/c$cipher.enc" -out "/workspace/d$cipher.bin" -a
            cmp -s /workspace/plain.bin "/workspace/d$cipher.bin"
          done
          c1=$(printf 'data' | openssl enc -aes-256-ctr -pbkdf2 -iter 2 -nosalt -a -A -pass pass:my-secret-pw)
          c2=$(printf 'data' | openssl enc -aes-256-ctr -pbkdf2 -iter 2 -nosalt -a -A -pass file:/workspace/pw.txt)
          c3=$(printf 'my-secret-pw\\ndata' | openssl enc -aes-256-ctr -pbkdf2 -iter 2 -nosalt -a -A -pass stdin)
          test "$c1" = "$c2"
          test "$c2" = "$c3"
          echo "MATCH=$c1"
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /MATCH=e\/uAQA==/);
      },
    );
  });

  it("8. openssl dgst / md5 / sha1 / sha256 / sha384 / sha512 with -hex, -r, -hmac, and multi-file -binary", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/one.txt": "abc",
          "/workspace/two.txt": "def",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          openssl dgst -sha256 /workspace/one.txt
          openssl sha256 -r /workspace/one.txt
          openssl dgst -sha256 -hmac "secret" /workspace/one.txt
          openssl md5 -hex /workspace/one.txt
          openssl dgst -sha256 -binary -out /workspace/both.bin /workspace/one.txt /workspace/two.txt
          wc -c < /workspace/both.bin | tr -d ' '
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /SHA2-256\(\/workspace\/one\.txt\)= ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/);
        assert.match(res.stdout, /ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad \*\/workspace\/one\.txt/);
        assert.match(res.stdout, /HMAC-SHA2-256\(\/workspace\/one\.txt\)= 9946dad4e00e913fc8be8e5d3f7e110a4a9e832f83fb09c345285d78638d8a0e/);
        assert.match(res.stdout, /MD5\(\/workspace\/one\.txt\)= 900150983cd24fb0d6963f7d28e17f72/);
        assert.match(res.stdout, /\n64\n$/);
      },
    );
  });

  it("9. openssl rand (-hex, -base64, -out) and openssl base64 (-e, -d, -A) round-trips", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        hex_val=$(openssl rand -hex 24)
        echo "HEX_LEN=\${#hex_val}"
        openssl rand -base64 -out /workspace/rand.b64 48
        openssl base64 -d -in /workspace/rand.b64 -out /workspace/rand.raw
        raw_len=$(wc -c < /workspace/rand.raw | tr -d ' ')
        echo "RAW_LEN=$raw_len"
        openssl base64 -A -in /workspace/rand.raw -out /workspace/rand.noline.b64
        openssl base64 -d -A -in /workspace/rand.noline.b64 -out /workspace/rand.roundtrip
        cmp -s /workspace/rand.raw /workspace/rand.roundtrip
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "HEX_LEN=48\nRAW_LEN=48\n");
    });
  });

  it("10. openssl version flags (-a, -v, -b, -o, -f, -p, -d) and error handling on invalid options", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        openssl version -a | wc -l | tr -d ' '
        openssl version -v
        openssl version -p
        set +e
        openssl version -unknown >/dev/null 2>&1
        rc1=$?
        openssl bogus-subcommand >/dev/null 2>&1
        rc2=$?
        set -e
        echo "RC=$rc1,$rc2"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "6\nOpenSSL compatible safe-bash toolkit (Web Crypto)\nplatform: portable\nRC=1,1\n",
      );
    });
  });

  it("11. gpg Ed25519 key generation, --list-secret-keys --with-colons, --detach-sign --armor, and --status-fd=1 --verify", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/commit.txt": "tree abcdef\nauthor Alice <alice@example.com>\n\nsigned commit\n",
          "/workspace/tampered.txt": "tree abcdef\nauthor Mallory\n\ntampered commit\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          gpg --quick-generate-key "Alice <alice@example.com>" ed25519 sign never
          gpg --list-secret-keys --with-colons "Alice" | grep -q '^sec:u:255:22:'
          gpg --detach-sign --armor -u "Alice <alice@example.com>" -o /workspace/commit.asc /workspace/commit.txt
          grep -q "BEGIN PGP SIGNATURE" /workspace/commit.asc
          gpg --status-fd=1 --verify /workspace/commit.asc /workspace/commit.txt 2>/workspace/gpg.err
          cat /workspace/gpg.err
          set +e
          gpg --verify /workspace/commit.asc /workspace/tampered.txt >/dev/null 2>&1
          bad_rc=$?
          set -e
          echo "BAD_RC=$bad_rc"
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /\[GNUPG:\] GOODSIG [0-9A-F]{16} Alice <alice@example\.com>/);
        assert.match(res.stdout, /Good signature from "Alice <alice@example\.com>" \[ultimate\]/);
        assert.match(res.stdout, /BAD_RC=1/);
      },
    );
  });

  it("12. gpg --export and --import merges keyrings without overwriting existing keys", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/msg.txt": "multi-signer message\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          gpg --quick-generate-key "Alice <alice@example.com>" ed25519 sign never >/dev/null
          gpg --detach-sign --armor -u "Alice <alice@example.com>" -o /workspace/alice.asc /workspace/msg.txt
          gpg --export -o /workspace/alice.pub.asc
          rm -f /home/user/.gnupg/keyring.json
          gpg --quick-generate-key "Bob <bob@example.com>" ed25519 sign never >/dev/null
          gpg --detach-sign --armor -u "Bob <bob@example.com>" -o /workspace/bob.asc /workspace/msg.txt
          gpg --import /workspace/alice.pub.asc 2>/workspace/import.err
          cat /workspace/import.err
          gpg --verify /workspace/alice.asc /workspace/msg.txt >/dev/null 2>&1
          gpg --verify /workspace/bob.asc /workspace/msg.txt >/dev/null 2>&1
          gpg --list-keys | grep -c '^uid'
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /gpg: Total number processed: 1\ngpg: {15}imported: 1/);
        assert.match(res.stdout, /\n2\n$/);
      },
    );
  });

  it("13. gpg symmetric encryption (-c / --symmetric) and decryption (-d) with --passphrase, --passphrase-file, and --armor", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/sales.csv": "region,q1,q2\nNA,120,150\nEU,95,110\n",
          "/workspace/pass.txt": "top-secret-passphrase\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          gpg --batch --passphrase "top-secret-passphrase" -c -o /workspace/sales.csv.gpg /workspace/sales.csv
          gpg --batch --passphrase-file /workspace/pass.txt -d /workspace/sales.csv.gpg > /workspace/dec1.csv
          cmp -s /workspace/sales.csv /workspace/dec1.csv
          gpg --batch --passphrase=top-secret-passphrase --armor --symmetric /workspace/sales.csv
          grep -q "BEGIN PGP MESSAGE" /workspace/sales.csv.asc
          gpg --batch --passphrase=top-secret-passphrase --decrypt /workspace/sales.csv.asc > /workspace/dec2.csv
          cmp -s /workspace/sales.csv /workspace/dec2.csv
          set +e
          gpg --batch --passphrase "wrong-passphrase" -d /workspace/sales.csv.gpg >/dev/null 2>&1
          wrong_rc=$?
          set -e
          echo "WRONG_RC=$wrong_rc"
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "WRONG_RC=2\n");
      },
    );
  });

  it("14. gpg preserves option-like filenames after -- and exits 2 on unknown options", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/-payload": "dash-prefixed file content\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          cd /workspace
          gpg --batch --yes --no-tty --armor --detach-sign -- -payload > /workspace/sig.asc
          gpg --verify /workspace/sig.asc -- -payload >/dev/null 2>&1
          set +e
          gpg --unknown-nonexistent-flag >/dev/null 2>/workspace/unk.err
          unk_rc=$?
          set -e
          echo "UNK_RC=$unk_rc"
          cat /workspace/unk.err
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "UNK_RC=2\ngpg: unknown option: --unknown-nonexistent-flag\n",
        );
      },
    );
  });

  it("15. ssh-keygen Ed25519 key generation (-f, -C), public key derivation (-y), and fingerprint inspection (-l)", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        ssh-keygen -t ed25519 -N "" -C "deploy@poe.test" -f /workspace/id_ed25519 >/dev/null
        derived=$(ssh-keygen -y -f /workspace/id_ed25519)
        disk_pub=$(cat /workspace/id_ed25519.pub)
        test "$derived" = "$disk_pub"
        fp_pub=$(ssh-keygen -l -f /workspace/id_ed25519.pub)
        fp_priv=$(ssh-keygen -l -f /workspace/id_ed25519)
        test "$fp_pub" = "$fp_priv"
        echo "$fp_pub"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /^256 SHA256:[A-Za-z0-9+/]+ deploy@poe\.test \(ED25519\)\n$/);
    });
  });

  it("16. ssh-keygen -Y sign, find-principals, verify, and check-novalidate with allowed_signers wildcard & negation rules", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/artifact.txt": "release v2.4.0 checksums\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          ssh-keygen -t ed25519 -N "" -C "alice@example.com" -f /workspace/alice_key >/dev/null
          pub=$(cat /workspace/alice_key.pub)
          printf 'bob,?lice@*.com,!*@evil.com namespaces="file,git" %s\\n' "$pub" > /workspace/allowed_signers
          ssh-keygen -Y sign -f /workspace/alice_key -n git /workspace/artifact.txt >/dev/null
          ssh-keygen -Y find-principals -f /workspace/allowed_signers -s /workspace/artifact.txt.sig
          ssh-keygen -Y check-novalidate -n git -s /workspace/artifact.txt.sig < /workspace/artifact.txt
          ssh-keygen -Y verify -f /workspace/allowed_signers -I "alice@example.com" -n git -s /workspace/artifact.txt.sig < /workspace/artifact.txt
          set +e
          ssh-keygen -Y verify -f /workspace/allowed_signers -I "alice@evil.com" -n git -s /workspace/artifact.txt.sig < /workspace/artifact.txt >/dev/null 2>&1
          neg_rc=$?
          ssh-keygen -Y verify -f /workspace/allowed_signers -I "alice@example.com" -n ssh -s /workspace/artifact.txt.sig < /workspace/artifact.txt >/dev/null 2>&1
          ns_rc=$?
          set -e
          echo "NEG=$neg_rc NS=$ns_rc"
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /bob,\?lice@\*\.com,!\*@evil\.com/);
        assert.match(res.stdout, /Good "git" signature for principal with ED25519 key SHA256:/);
        assert.match(res.stdout, /Good "git" signature for alice@example\.com with ED25519 key SHA256:/);
        assert.match(res.stdout, /NEG=1 NS=1/);
      },
    );
  });

  it("17. ssh-keygen -F and -R known_hosts lookup and host removal with multi-host lines", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/known_hosts": [
            "# comment line",
            "github.com,192.30.255.112 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
            "gitlab.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAfuCHKVTjquxvt6CM6tdG4SLp1Btn/nOeHHE5UOzRdf",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          ssh-keygen -F 192.30.255.112 -f /workspace/known_hosts
          ssh-keygen -R github.com -f /workspace/known_hosts
          set +e
          ssh-keygen -F github.com -f /workspace/known_hosts
          missing_rc=$?
          set -e
          echo "MISSING_RC=$missing_rc"
          ssh-keygen -F gitlab.com -f /workspace/known_hosts
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /github\.com,192\.30\.255\.112 ssh-ed25519/);
        assert.match(res.stdout, /# Host github\.com found: removed/);
        assert.match(res.stdout, /MISSING_RC=1/);
        assert.match(res.stdout, /gitlab\.com ssh-ed25519/);
      },
    );
  });

  it("18. ssh -V, ssh -G config dump, interactive shell denial, and remote command execution", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        ssh -V 2>&1
        ssh -G -p 2222 -i /workspace/custom_key deploy@git.example.com
        ssh -p 2222 deploy@git.example.com git-upload-pack /repo.git
        set +e
        ssh -T git@github.com 2>/workspace/ssh.err
        no_cmd_rc=$?
        set -e
        echo "NO_CMD_RC=$no_cmd_rc"
        cat /workspace/ssh.err
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /OpenSSH_9\.8p1/);
      assert.match(res.stdout, /user deploy\nhostname git\.example\.com\nport 2222\nidentityfile \/workspace\/custom_key/);
      assert.match(res.stdout, /ssh:deploy@git\.example\.com:2222 git-upload-pack \/repo\.git/);
      assert.match(res.stdout, /NO_CMD_RC=1\nHi git! You've successfully authenticated, but github\.com does not provide interactive shell access\./);
    });
  });

  it("19. multi-stage release attestation pipeline: tar --zstd + openssl dgst -sign + gpg --detach-sign + ssh-keygen -Y sign", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/dist/bin/app": "#!/bin/sh\necho v1.0.0\n",
          "/workspace/dist/manifest.json": "{\"name\":\"app\",\"version\":\"1.0.0\"}\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -euo pipefail
          tar --zstd -cf /workspace/release.tar.zst -C /workspace/dist bin manifest.json
          sha256sum /workspace/release.tar.zst > /workspace/release.sha256

          # 1. OpenSSL RSA-2048 signature
          openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /workspace/rel-rsa.key
          openssl pkey -in /workspace/rel-rsa.key -pubout -out /workspace/rel-rsa.pub
          openssl dgst -sha256 -sign /workspace/rel-rsa.key -out /workspace/release.rsa.sig /workspace/release.tar.zst
          openssl dgst -sha256 -verify /workspace/rel-rsa.pub -signature /workspace/release.rsa.sig /workspace/release.tar.zst

          # 2. GPG Ed25519 detached signature
          gpg --quick-generate-key "Release Bot <release@poe.test>" ed25519 sign never >/dev/null
          gpg --detach-sign --armor -u "Release Bot <release@poe.test>" -o /workspace/release.gpg.asc /workspace/release.tar.zst
          gpg --status-fd=1 --verify /workspace/release.gpg.asc /workspace/release.tar.zst 2>/dev/null | grep -q 'GOODSIG'

          # 3. SSHSIG signature
          ssh-keygen -t ed25519 -N "" -C "release@poe.test" -f /workspace/rel_ssh >/dev/null
          printf 'release@poe.test namespaces="release" %s\\n' "$(cat /workspace/rel_ssh.pub)" > /workspace/allowed
          ssh-keygen -Y sign -f /workspace/rel_ssh -n release /workspace/release.tar.zst >/dev/null
          ssh-keygen -Y verify -f /workspace/allowed -I "release@poe.test" -n release -s /workspace/release.tar.zst.sig < /workspace/release.tar.zst | grep -q 'Good "release" signature'

          # 4. Verify checksum & extract
          sha256sum -c /workspace/release.sha256
          mkdir -p /workspace/unpacked
          tar --zstd -xf /workspace/release.tar.zst -C /workspace/unpacked
          jq -r '.name + ":" + .version' /workspace/unpacked/manifest.json
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "Verified OK\n/workspace/release.tar.zst: OK\napp:1.0.0\n",
        );
      },
    );
  });

  it("20. encrypted SQLite audit ledger pipeline: sqlite3 -> openssl enc -aes-256-cbc -pbkdf2 -> HMAC-SHA256 verification -> restore", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/ledger.db <<'SQL'
CREATE TABLE audit (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, amount INTEGER);
INSERT INTO audit (actor, action, amount) VALUES ('alice', 'deposit', 250), ('bob', 'transfer', 175), ('alice', 'withdraw', 50);
SQL
        openssl enc -aes-256-cbc -pbkdf2 -iter 100 -pass pass:vault-key-99 -in /workspace/ledger.db -out /workspace/ledger.db.enc
        mac1=$(openssl dgst -sha256 -hmac "audit-mac-key" -r /workspace/ledger.db.enc | awk '{print $1}')
        openssl enc -aes-256-cbc -d -pbkdf2 -iter 100 -pass pass:vault-key-99 -in /workspace/ledger.db.enc -out /workspace/restored.db
        sqlite3 /workspace/restored.db "SELECT actor, SUM(amount) FROM audit GROUP BY actor ORDER BY actor;"
        echo "MAC_LEN=\${#mac1}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "alice|300\nbob|175\nMAC_LEN=64\n");
    });
  });
});
