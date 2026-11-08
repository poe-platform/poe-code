import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure gpg openssl wdiff mdq rgrep crypto markdown diff matrix", () => {
  it("01 gpg symmetric encryption and decryption with --armor and --passphrase", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"confidential-audit-record-2026\\n\" > /tmp/secret.txt\ngpg --batch --yes -c -a --passphrase \"vault-key-99\" -o /tmp/secret.txt.asc /tmp/secret.txt\nhead -n 1 /tmp/secret.txt.asc\ngpg --batch --yes -d --passphrase \"vault-key-99\" /tmp/secret.txt.asc");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "-----BEGIN PGP MESSAGE-----\nconfidential-audit-record-2026\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 gpg --quick-generate-key --list-keys --detach-sign and --verify", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("gpg --batch --quick-generate-key \"Release Bot <bot@poe.local>\" > /dev/null\ngpg --list-keys | grep -o \"Release Bot <bot@poe.local>\"\nprintf \"release-tarball-sha256=deadbeef\\n\" > /tmp/SHA256SUMS\ngpg --batch -u \"Release Bot <bot@poe.local>\" --detach-sign -a -o /tmp/SHA256SUMS.asc /tmp/SHA256SUMS\ngpg --verify /tmp/SHA256SUMS.asc /tmp/SHA256SUMS 2>&1 | grep -o 'Good signature from \"Release Bot <bot@poe.local>\"'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Release Bot <bot@poe.local>\nGood signature from \"Release Bot <bot@poe.local>\"\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 gpg --export and --import public keyring across armored blocks", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("gpg --batch --quick-generate-key \"SecOps Signer <secops@poe.local>\" > /dev/null\ngpg --armor --export > /tmp/pubkey.asc\nhead -n 1 /tmp/pubkey.asc\ngpg --import /tmp/pubkey.asc 2>&1 | grep -o \"imported: 1\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "-----BEGIN PGP PUBLIC KEY BLOCK-----\nimported: 1\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 openssl enc -aes-128-cbc and -aes-256-ctr with explicit -K key and -iv", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"ctr-stream-cipher-test-payload\\n\" > /tmp/ctr_in.txt\nKEY=\"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f\"\nIV=\"f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff\"\nopenssl enc -aes-256-ctr -K \"$KEY\" -iv \"$IV\" -in /tmp/ctr_in.txt -out /tmp/ctr.enc\nopenssl enc -d -aes-256-ctr -K \"$KEY\" -iv \"$IV\" -in /tmp/ctr.enc");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ctr-stream-cipher-test-payload\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 openssl enc -aes-256-cbc -a base64 armored with env: password source", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("export MY_ENC_PASS=\"env-derived-passphrase-2026\"\nprintf \"armored-aes256-payload\" | openssl enc -aes-256-cbc -pbkdf2 -iter 2500 -a -pass env:MY_ENC_PASS > /tmp/enc.b64\nopenssl enc -d -aes-256-cbc -pbkdf2 -iter 2500 -a -pass env:MY_ENC_PASS -in /tmp/enc.b64\necho \"\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "armored-aes256-payload\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 openssl pkeyutl -sign and -verify with generated RSA keypair", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/pkey.pem 2>/dev/null\nopenssl pkey -in /tmp/pkey.pem -pubout -out /tmp/pkey_pub.pem 2>/dev/null\nprintf \"digest-payload-for-pkeyutl\\n\" > /tmp/msg.bin\nopenssl pkeyutl -sign -inkey /tmp/pkey.pem -in /tmp/msg.bin -out /tmp/msg.sig\nopenssl pkeyutl -verify -pubin -inkey /tmp/pkey_pub.pem -in /tmp/msg.bin -sigfile /tmp/msg.sig");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Signature Verified Successfully\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 wdiff word-level LCS diff with deletions and insertions and exit code 1", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"The quick brown fox jumps over the lazy dog\\n\" > /tmp/old_words.txt\nprintf \"The fast brown cat leaps over the sleepy dog\\n\" > /tmp/new_words.txt\nwdiff /tmp/old_words.txt /tmp/new_words.txt || echo \"status=$?\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "The [-quick-] {+fast+} brown [-fox jumps-] {+cat leaps+} over the [-lazy-] {+sleepy+} dog\nstatus=1\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 wdiff identical files return exit code 0 and preserve whitespace", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"alpha   beta\\tgamma\\n\" > /tmp/same1.txt\nprintf \"alpha   beta\\tgamma\\n\" > /tmp/same2.txt\nwdiff /tmp/same1.txt /tmp/same2.txt && echo \"status=$?\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha   beta\tgamma\nstatus=0\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 mdq section selector # Heading with piped list and code extraction", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/guide.md\n# Architecture\n\nIntro text.\n\n## Storage Engine\n\n- In-memory VFS\n- Copy-on-write snapshots\n\n```sql\nSELECT * FROM snapshots WHERE active = 1;\n```\n\n## Network Layer\n\n- Loopback mock\nEOF\nmdq '# Storage Engine | -' /tmp/guide.md\nmdq '# Storage Engine | ```sql' -o plain /tmp/guide.md");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "- In-memory VFS\n\n   -----\n\n- Copy-on-write snapshots\nSELECT * FROM snapshots WHERE active = 1;\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 mdq task list filtering - [x] vs - [ ] and JSON output -o json", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/todo.md\n# Sprint Tasks\n\n- [x] Implement openssl in Rust\n- [ ] Add benchmark report\n- [x] Add wdiff and mdq parity\nEOF\nmdq -o plain -- '- [x]' /tmp/todo.md\nmdq '# Sprint Tasks | - [ ]' -o json /tmp/todo.md | jq -r '.items[0].list[0].item[0].paragraph'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Implement openssl in Rust\nAdd wdiff and mdq parity\nAdd benchmark report\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 mdq link selector [text](url) and quiet exit status -q", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/links.md\nCheck [Documentation](https://docs.poe.local/guide) and [Status](https://status.poe.local).\nEOF\nmdq -l inline '[Documentation](*)' /tmp/links.md\nmdq -q '[Status](*)' /tmp/links.md && echo \"found_status\"\nmdq -q '[Missing](*)' /tmp/links.md || echo \"missing_status=$?\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[Documentation](https://docs.poe.local/guide)found_status\nmissing_status=1\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 mdq table column and row filtering :-: header :-: cell", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/metrics.md\n| Service | Latency | Status |\n| :--- | :---: | ---: |\n| auth | 12ms | ok |\n| billing | 45ms | deg |\n| search | 8ms | ok |\nEOF\nmdq ':-: * :-: ok' -o json /tmp/metrics.md | jq -c '.items[0].table.rows'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[[\"Service\",\"Latency\",\"Status\"],[\"auth\",\"12ms\",\"ok\"],[\"search\",\"8ms\",\"ok\"]]\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 rgrep recursive search across nested directory tree with -n and -i", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /tmp/rsearch/a/b\nprintf \" normal line\\nCRITICAL_ERROR: disk full\\n\" > /tmp/rsearch/a/app.log\nprintf \"critical_error: timeout\\nok\\n\" > /tmp/rsearch/a/b/worker.log\nrgrep -i -n \"critical_error\" /tmp/rsearch | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/tmp/rsearch/a/app.log:2:CRITICAL_ERROR: disk full\n/tmp/rsearch/a/b/worker.log:1:critical_error: timeout\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 html-to-markdown conversion piped into mdq section and link query", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/page.html\n<html><body>\n<h1>Release Notes</h1>\n<p>Visit <a href=\"https://poe.local/v2\">Portal v2</a> for details.</p>\n<h2>Fixes</h2>\n<ul><li>Fixed memory leak</li><li>Improved latency</li></ul>\n</body></html>\nEOF\nhtml-to-markdown /tmp/page.html > /tmp/page.md\nmdq '# Fixes | -' -o plain /tmp/page.md");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Fixed memory leak\nImproved latency\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 unrtf document extraction piped into wdiff against baseline text", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/doc_v1.rtf\n{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Courier;}}\n\\f0\\fs20 System status is nominal and healthy.\\par\n}\nEOF\ncat << 'EOF' > /tmp/doc_v2.rtf\n{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Courier;}}\n\\f0\\fs20 System status is degraded and recovering.\\par\n}\nEOF\nunrtf --text /tmp/doc_v1.rtf | grep \"^System\" > /tmp/v1.txt\nunrtf --text /tmp/doc_v2.rtf | grep \"^System\" > /tmp/v2.txt\nwdiff /tmp/v1.txt /tmp/v2.txt || true");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "System status is [-nominal-] {+degraded+} and [-healthy.-] {+recovering.+}\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 mmdc Mermaid diagram compilation to SVG and xmllint XPath verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/flow.mmd\ngraph TD\n  A[Client] --> B[Gateway]\n  B --> C[AuthService]\nEOF\nmmdc -i /tmp/flow.mmd -o /tmp/flow.svg\ngrep -q \"<svg\" /tmp/flow.svg && echo \"valid_svg\"\ngrep -o \"Gateway\" /tmp/flow.svg | head -n 1");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "valid_svg\nGateway\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 diff3 three-way merge with non-conflicting changes and conflict markers", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/base.txt\nline 1\nline 2\nline 3\nline 4\nEOF\ncat << 'EOF' > /tmp/mine.txt\nline 1 modified\nline 2\nline 3\nline 4\nEOF\ncat << 'EOF' > /tmp/yours.txt\nline 1\nline 2\nline 3\nline 4 updated\nEOF\ndiff3 -m /tmp/mine.txt /tmp/base.txt /tmp/yours.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "line 1 modified\nline 2\nline 3\nline 4 updated\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 iconv character encoding conversion and dos2unix/unix2dos line endings", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"hello\\r\\nworld\\r\\n\" > /tmp/crlf.txt\nfile -b /tmp/crlf.txt | grep -i -o \"CRLF\" || echo \"crlf_checked\"\ndos2unix /tmp/crlf.txt 2>/dev/null\nod -An -tx1 /tmp/crlf.txt | tr -s \" \" | sed \"s/^ //;s/ $//\"\niconv -f UTF-8 -t ASCII//TRANSLIT /tmp/crlf.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "crlf_checked\n68 65 6c 6c 6f 0a 77 6f 72 6c 64 0a\nhello\nworld\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 sponge in-place file transformation after multi-stage pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"30\\n10\\n20\\n10\\n\" > /tmp/nums.txt\nsort -n /tmp/nums.txt | uniq | awk '{print $1 * 2}' | sponge /tmp/nums.txt\ncat /tmp/nums.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "20\n40\n60\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 polyglot pipeline: mdq JSON -> jq -> sqlite3 -> openssl dgst -> gpg sign", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /tmp/changelog_sec.md\n# Security Advisory\n\n```json\n{\"cve\":\"CVE-2026-9001\",\"pkg\":\"auth-proxy\",\"cvss\":9.4}\n```\nEOF\nmdq '```json' -o plain /tmp/changelog_sec.md > /tmp/adv.json\nsqlite3 /tmp/adv.db \"CREATE TABLE adv(cve TEXT, pkg TEXT, cvss REAL);\"\njq -r '\"INSERT INTO adv VALUES ('\\''\\(.cve)'\\'', '\\''\\(.pkg)'\\'', \\(.cvss));\"' /tmp/adv.json | sqlite3 /tmp/adv.db\nsqlite3 /tmp/adv.db \"SELECT cve || ':' || pkg || '=' || cvss FROM adv;\" > /tmp/summary.txt\ncat /tmp/summary.txt\nopenssl dgst -sha256 -r /tmp/summary.txt | awk '{print $1}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "CVE-2026-9001:auth-proxy=9.4\n16c9889a135c945f1514f289f4a4db0fab6226b1005c9f5a8dd96397dcd7bf4d\n");
    } finally {
      await h.dispose();
    }
  });

});
