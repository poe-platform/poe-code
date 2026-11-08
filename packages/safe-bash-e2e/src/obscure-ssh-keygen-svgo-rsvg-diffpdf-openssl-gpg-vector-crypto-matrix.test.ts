import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("Obscure SSH/SSH-Keygen Ed25519 + SVGO + RSVG-Convert + DiffPDF + OpenSSL/GPG Vector & Crypto Matrix", () => {
  it("01_ssh_version_and_config_dump_g_flag", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("ssh -V 2>&1\nssh -G -p 2222 -l deploy -i /workspace/keys/deploy_ed25519 -o StrictHostKeyChecking=no prod.example.com\nssh -G ci-bot@git.example.org");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "OpenSSH_9.8p1, OpenSSL 3.3.2 3 Sep 2024\nuser deploy\nhostname prod.example.com\nport 2222\nidentityfile /workspace/keys/deploy_ed25519\nuser ci-bot\nhostname git.example.org\nport 22\nidentityfile /home/user/.ssh/id_ed25519\n");
    } finally {
      await h.dispose();
    }
  });

  it("02_ssh_remote_command_and_no_shell_auth_status", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("ssh -p 2200 -i /workspace/id_ed25519 release@builder.internal git-upload-pack /srv/repo.git\nset +e\nerr=$(ssh -T git@github.com 2>&1)\nrc=$?\nset -e\nprintf 'rc=%d\\n%s\\n' \"$rc\" \"$err\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ssh:release@builder.internal:2200 git-upload-pack /srv/repo.git\nrc=1\nHi git! You've successfully authenticated, but github.com does not provide interactive shell access.\n");
    } finally {
      await h.dispose();
    }
  });

  it("03_ssh_keygen_ed25519_generate_derive_pub_and_fingerprint_consistency", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("ssh-keygen -q -t ed25519 -f /workspace/deploy_key -C \"deploy@poe-platform\" -N \"\" > /workspace/keygen.out\ngrep -E '^(Generating|Your identification|Your public key|The key fingerprint)' /workspace/keygen.out\nssh-keygen -y -f /workspace/deploy_key > /workspace/derived.pub\ncmp -s /workspace/deploy_key.pub /workspace/derived.pub && echo \"pub-match=ok\"\nfp_priv=$(ssh-keygen -l -f /workspace/deploy_key)\nfp_pub=$(ssh-keygen -l -f /workspace/deploy_key.pub)\ntest \"$fp_priv\" = \"$fp_pub\" && echo \"fp-match=ok\"\nprintf '%s\\n' \"$fp_pub\" | awk '{print $1, $3, $4}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Generating public/private ed25519 key pair.\nYour identification has been saved in /workspace/deploy_key\nYour public key has been saved in /workspace/deploy_key.pub\nThe key fingerprint is:\npub-match=ok\nfp-match=ok\n256 deploy@poe-platform (ED25519)\n");
    } finally {
      await h.dispose();
    }
  });

  it("04_ssh_keygen_deterministic_fixture_key_derive_and_fingerprint", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'KEY' > /workspace/fixed_ed25519\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEgAAAJihssPUobLD\n1AAAAAtzc2gtZWQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEg\nAAAEBCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQiFS+NGbeR0kRTJC4V8uq2y3\nz/p7al7TAJeWDgaYgdsSAAAADmFsaWNlQHNlY3VyaXR5AQIDBAUGBw==\n-----END OPENSSH PRIVATE KEY-----\nKEY\nssh-keygen -y -f /workspace/fixed_ed25519 | tee /workspace/fixed_ed25519.pub\nssh-keygen -l -f /workspace/fixed_ed25519\nssh-keygen -l -f /workspace/fixed_ed25519.pub");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICFS+NGbeR0kRTJC4V8uq2y3z/p7al7TAJeWDgaYgdsS alice@security\n256 SHA256:ZsrOVCtcb1bouzun0GIHz5vL5oCjVhVIQ3jfIBIgZ8g alice@security (ED25519)\n256 SHA256:ZsrOVCtcb1bouzun0GIHz5vL5oCjVhVIQ3jfIBIgZ8g alice@security (ED25519)\n");
    } finally {
      await h.dispose();
    }
  });

  it("05_ssh_keygen_sshsig_sign_verify_find_principals_and_check_novalidate", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'KEY' > /workspace/signer_ed25519\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEgAAAJihssPUobLD\n1AAAAAtzc2gtZWQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEg\nAAAEBCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQiFS+NGbeR0kRTJC4V8uq2y3\nz/p7al7TAJeWDgaYgdsSAAAADmFsaWNlQHNlY3VyaXR5AQIDBAUGBw==\n-----END OPENSSH PRIVATE KEY-----\nKEY\npub=$(ssh-keygen -y -f /workspace/signer_ed25519 | awk '{print $1 \" \" $2}')\nprintf 'alice@security,release@security namespaces=\"file,git\" %s\\n' \"$pub\" > /workspace/allowed_signers\nprintf 'release-artifact-v2.4.0\\nsha256:9f86d081884c7d659a2feaa0c55ad015\\n' > /workspace/manifest.txt\nssh-keygen -Y sign -f /workspace/signer_ed25519 -n file /workspace/manifest.txt\ncat /workspace/manifest.txt.sig\nssh-keygen -Y find-principals -f /workspace/allowed_signers -s /workspace/manifest.txt.sig\nssh-keygen -Y check-novalidate -n file -s /workspace/manifest.txt.sig < /workspace/manifest.txt\nssh-keygen -Y verify -f /workspace/allowed_signers -I alice@security -n file -s /workspace/manifest.txt.sig < /workspace/manifest.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Signing file /workspace/manifest.txt\nWrite signature to /workspace/manifest.txt.sig\n-----BEGIN SSH SIGNATURE-----\nU1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgIVL40Zt5HSRFMkLhXy6rbLfP+n\ntqXtMAl5YOBpiB2xIAAAAEZmlsZQAAAAAAAAAGc2hhNTEyAAAAUwAAAAtzc2gtZWQyNTUx\nOQAAAECwdA+TNKtIRYQTJ8ccbZw4Ei5yQ7aUrE+gcFmut9nCWaohBpi28qLfuOZRvKhYuc\naPgpN2zflEBqbjREj9DnUJ\n-----END SSH SIGNATURE-----\nalice@security,release@security\nGood \"file\" signature for principal with ED25519 key SHA256:ZsrOVCtcb1bouzun0GIHz5vL5oCjVhVIQ3jfIBIgZ8g\nGood \"file\" signature for alice@security with ED25519 key SHA256:ZsrOVCtcb1bouzun0GIHz5vL5oCjVhVIQ3jfIBIgZ8g\n");
    } finally {
      await h.dispose();
    }
  });

  it("06_ssh_keygen_sshsig_negative_namespace_principal_and_tamper_checks", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'KEY' > /workspace/signer_ed25519\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEgAAAJihssPUobLD\n1AAAAAtzc2gtZWQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEg\nAAAEBCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQiFS+NGbeR0kRTJC4V8uq2y3\nz/p7al7TAJeWDgaYgdsSAAAADmFsaWNlQHNlY3VyaXR5AQIDBAUGBw==\n-----END OPENSSH PRIVATE KEY-----\nKEY\npub=$(ssh-keygen -y -f /workspace/signer_ed25519 | awk '{print $1 \" \" $2}')\nprintf 'alice@security namespaces=\"file\" %s\\n' \"$pub\" > /workspace/allowed_signers\nprintf 'authentic-payload\\n' > /workspace/msg.txt\nssh-keygen -Y sign -f /workspace/signer_ed25519 -n file /workspace/msg.txt > /dev/null\nset +e\nssh-keygen -Y verify -f /workspace/allowed_signers -I alice@security -n git -s /workspace/msg.txt.sig < /workspace/msg.txt 2> /dev/null\nrc_ns=$?\nssh-keygen -Y verify -f /workspace/allowed_signers -I mallory@security -n file -s /workspace/msg.txt.sig < /workspace/msg.txt 2> /dev/null\nrc_id=$?\nprintf 'tampered-payload\\n' | ssh-keygen -Y verify -f /workspace/allowed_signers -I alice@security -n file -s /workspace/msg.txt.sig 2> /dev/null\nrc_tamper=$?\nset -e\nprintf 'rc_ns=%d rc_id=%d rc_tamper=%d\\n' \"$rc_ns\" \"$rc_id\" \"$rc_tamper\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc_ns=1 rc_id=1 rc_tamper=1\n");
    } finally {
      await h.dispose();
    }
  });

  it("07_ssh_keygen_known_hosts_find_and_remove_host", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'KH' > /workspace/known_hosts\n# Corporate known hosts\ngithub.com,192.30.255.112 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\ngitlab.internal ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGx0b2JlcmVtb3ZlZHostKeyData1234567890abcdef\nprod.internal,10.0.0.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKp7f3vN8qZ4m1xL9sB2wC5dE8rF0tG3yH6jK9lM2nP5\nKH\nssh-keygen -F github.com -f /workspace/known_hosts\nssh-keygen -F 10.0.0.10 -f /workspace/known_hosts\nssh-keygen -R gitlab.internal -f /workspace/known_hosts\nset +e\nssh-keygen -F gitlab.internal -f /workspace/known_hosts\nrc=$?\nset -e\nprintf 'after_remove_rc=%d\\n' \"$rc\"\ngrep -v '^#' /workspace/known_hosts | awk 'NF {print $1}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "github.com,192.30.255.112 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\nprod.internal,10.0.0.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKp7f3vN8qZ4m1xL9sB2wC5dE8rF0tG3yH6jK9lM2nP5\n# Host gitlab.internal found: removed\n/workspace/known_hosts updated.\nafter_remove_rc=1\ngithub.com,192.30.255.112\nprod.internal,10.0.0.10\n");
    } finally {
      await h.dispose();
    }
  });

  it("08_svgo_string_precision_path_compaction_and_viewbox_synthesis", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("svgo -s '<svg width=\"120px\" height=\"80px\"><!-- comment --><metadata>secret</metadata><g><rect x=\"10.12345\" y=\"20.98765\" width=\"50.5555\" height=\"30.1111\"/><path d=\"M 0 0 L 10.1234 0 L 10.1234 25.6789 Z\"/></g></svg>' -p 2\nprintf '\\n'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "<svg width=\"120px\" height=\"80px\" viewBox=\"0 0 120 80\"><rect x=\"10.12\" y=\"20.99\" width=\"50.56\" height=\"30.11\"/><path d=\"M0 0H10.12V25.68Z\"/></svg>\n");
    } finally {
      await h.dispose();
    }
  });

  it("09_svgo_multipass_pretty_indent_and_file_inplace_vs_output", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'SVG' > /workspace/diagram.svg\n<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n<svg viewBox=\"0, 0, 200.1234, 100.5678\">\n  <!-- header comment -->\n  <metadata><rdf>ignored</rdf></metadata>\n  <g>\n    <g>\n      <circle cx=\"50.1259\" cy=\"50.8751\" r=\"25.5555\" fill=\"red\"/>\n      <path d=\"M 10 10 L 90 10 L 90 70 Z\"/>\n    </g>\n  </g>\n</svg>\nSVG\nsvgo -i /workspace/diagram.svg -o /workspace/diagram.pretty.svg --multipass --pretty --indent 2 -p 1\ncat /workspace/diagram.pretty.svg\nprintf '\\n---\\n'\nsvgo /workspace/diagram.svg --multipass -p 1\ncat /workspace/diagram.svg\nprintf '\\n'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "<svg viewBox=\"0 0 200.1 100.6\">\n  \n  \n  \n    \n      <circle cx=\"50.1\" cy=\"50.9\" r=\"25.6\" fill=\"red\"/>\n      <path d=\"M10 10H90V70Z\"/>\n    \n  \n</svg>\n---\n<svg viewBox=\"0 0 200.1 100.6\">\n  \n  \n  \n    \n      <circle cx=\"50.1\" cy=\"50.9\" r=\"25.6\" fill=\"red\"/>\n      <path d=\"M10 10H90V70Z\"/>\n    \n  \n</svg>\n");
    } finally {
      await h.dispose();
    }
  });

  it("10_rsvg_convert_svg_to_png_dimensions_and_units", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'SVG' > /workspace/banner.svg\n<svg width=\"240\" height=\"90\" viewBox=\"0 0 240 90\">\n  <rect x=\"0\" y=\"0\" width=\"240\" height=\"90\" fill=\"navy\"/>\n  <circle cx=\"45\" cy=\"45\" r=\"30\" fill=\"gold\"/>\n</svg>\nSVG\nrsvg-convert -f png -o /workspace/banner.png /workspace/banner.svg\nfile --mime-type -b /workspace/banner.png\nidentify /workspace/banner.png | awk '{print $1, $2, $3}'\nsips -g pixelWidth -g pixelHeight /workspace/banner.png | grep -E 'pixel(Width|Height):'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "image/png\n/workspace/banner.png PNG 240x90\n  pixelWidth: 240\n  pixelHeight: 90\n");
    } finally {
      await h.dispose();
    }
  });

  it("11_rsvg_convert_svg_to_pdf_with_pdfinfo_and_pdftotext", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'SVG' > /workspace/card.svg\n<svg width=\"400\" height=\"200\" viewBox=\"0 0 400 200\">\n  <rect x=\"10\" y=\"10\" width=\"380\" height=\"180\" fill=\"white\" stroke=\"black\"/>\n  <text x=\"40\" y=\"80\" font-size=\"18\">Architecture Vector Card</text>\n  <text x=\"40\" y=\"120\" font-size=\"14\">Status: Verified</text>\n</svg>\nSVG\nrsvg-convert -f pdf -o /workspace/card.pdf /workspace/card.svg\npdfinfo -box /workspace/card.pdf | grep -E '^(Pages|Page size|MediaBox):' | awk '{$1=$1; print}'\npdftotext /workspace/card.pdf - | tr -d '\\f' | sed '/^$/d'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Pages: 1\nPage size: 300 x 150 pts\nMediaBox: 0.00 0.00 300.00 150.00\nArchitecture Vector Card\nStatus: Verified\n");
    } finally {
      await h.dispose();
    }
  });

  it("12_diffpdf_and_pdfdiff_text_and_layout_comparison", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf '<h1>Release v1</h1><p>Page one content</p><div style=\"page-break-before:always\"></div><h2>Page two alpha</h2>' > /workspace/doc_a.html\nprintf '<h1>Release v1</h1><p>Page one content</p><div style=\"page-break-before:always\"></div><h2>Page two beta</h2>' > /workspace/doc_b.html\nwkhtmltopdf /workspace/doc_a.html /workspace/doc_a.pdf\nwkhtmltopdf /workspace/doc_b.html /workspace/doc_b.pdf\ncp /workspace/doc_a.pdf /workspace/doc_a_copy.pdf\ndiffpdf /workspace/doc_a.pdf /workspace/doc_a_copy.pdf && echo \"equal_rc=0\"\nset +e\ndiffpdf --text /workspace/doc_a.pdf /workspace/doc_b.pdf\nrc_text=$?\nset -e\nprintf 'rc_text=%d\\n' \"$rc_text\"\nqpdf /workspace/doc_a.pdf /workspace/doc_a_rot.pdf --rotate=+90:1\nset +e\ndiffpdf --text /workspace/doc_a.pdf /workspace/doc_a_rot.pdf\nrc_rot_text=$?\npdfdiff --layout /workspace/doc_a.pdf /workspace/doc_a_rot.pdf\nrc_rot_layout=$?\nset -e\nprintf 'rc_rot_text=%d rc_rot_layout=%d\\n' \"$rc_rot_text\" \"$rc_rot_layout\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "equal_rc=0\nPage 2 differs (text)\nrc_text=1\nPage 1 differs (layout)\nrc_rot_text=0 rc_rot_layout=1\n");
    } finally {
      await h.dispose();
    }
  });

  it("13_svgo_to_rsvg_convert_to_diffpdf_equivalence_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'SVG' > /workspace/raw_chart.svg\n<svg width=\"320px\" height=\"160px\">\n  <!-- unoptimized chart -->\n  <metadata>chart-meta</metadata>\n  <g>\n    <rect x=\"0.0000\" y=\"0.0000\" width=\"320.0000\" height=\"160.0000\" fill=\"white\"/>\n    <path d=\"M 20 20 L 300 20 L 300 140 Z\" stroke=\"black\" fill=\"none\"/>\n    <text x=\"40\" y=\"80\" font-size=\"16\">Quarterly Revenue</text>\n  </g>\n</svg>\nSVG\nsvgo -i /workspace/raw_chart.svg -o /workspace/opt_chart.svg --multipass -p 2\nrsvg-convert -f pdf -o /workspace/raw_chart.pdf /workspace/raw_chart.svg\nrsvg-convert -f pdf -o /workspace/opt_chart.pdf /workspace/opt_chart.svg\ndiffpdf --text /workspace/raw_chart.pdf /workspace/opt_chart.pdf && echo \"svg_pdf_text_parity=ok\"\npdftotext /workspace/opt_chart.pdf - | tr -d '\\f' | sed '/^$/d'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "svg_pdf_text_parity=ok\nQuarterly Revenue\n");
    } finally {
      await h.dispose();
    }
  });

  it("14_svgo_and_rsvg_convert_error_diagnostics_and_help", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("svgo --help | head -n 1\nrsvg-convert --help\ndiffpdf --help | head -n 1\nset +e\nsvgo --unknown-flag 2>&1\nrc1=$?\nrsvg-convert -f gif /workspace/in.svg 2>&1\nrc2=$?\ndiffpdf /workspace/only_one.pdf 2>&1\nrc3=$?\nset -e\nprintf 'rc1=%d rc2=%d rc3=%d\\n' \"$rc1\" \"$rc2\" \"$rc3\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Usage: svgo [INPUT|-] [-i INPUT] [-s STRING] [-o OUTPUT|-]\nUsage: rsvg-convert [-f pdf|png] [-o OUTPUT] [INPUT]\nUsage: diffpdf [--text|--layout] OLD.pdf NEW.pdf\nsvgo: unknown option: --unknown-flag\nrsvg-convert: unsupported format gif\ndiffpdf: expected two PDF files\nrc1=1 rc2=1 rc3=2\n");
    } finally {
      await h.dispose();
    }
  });

  it("15_ssh_keygen_stdin_stream_signing_and_verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'KEY' > /workspace/stream_ed25519\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEgAAAJihssPUobLD\n1AAAAAtzc2gtZWQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEg\nAAAEBCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQiFS+NGbeR0kRTJC4V8uq2y3\nz/p7al7TAJeWDgaYgdsSAAAADmFsaWNlQHNlY3VyaXR5AQIDBAUGBw==\n-----END OPENSSH PRIVATE KEY-----\nKEY\npub=$(ssh-keygen -y -f /workspace/stream_ed25519 | awk '{print $1 \" \" $2}')\nprintf '*@security namespaces=\"git,release-*\" %s\\n' \"$pub\" > /workspace/signers\nprintf 'tag v3.0.0\\ncommit 7a8b9c0d\\n' | ssh-keygen -Y sign -f /workspace/stream_ed25519 -n release-prod > /workspace/stream.sig\nprintf 'tag v3.0.0\\ncommit 7a8b9c0d\\n' | ssh-keygen -Y verify -f /workspace/signers -I bot@security -n release-prod -s /workspace/stream.sig");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Good \"release-prod\" signature for bot@security with ED25519 key SHA256:ZsrOVCtcb1bouzun0GIHz5vL5oCjVhVIQ3jfIBIgZ8g\n");
    } finally {
      await h.dispose();
    }
  });

  it("16_openssl_gpg_ssh_keygen_triple_attestation_bundle", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'KEY' > /workspace/rel_ed25519\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEgAAAJihssPUobLD\n1AAAAAtzc2gtZWQyNTUxOQAAACAhUvjRm3kdJEUyQuFfLqtst8/6e2pe0wCXlg4GmIHbEg\nAAAEBCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQiFS+NGbeR0kRTJC4V8uq2y3\nz/p7al7TAJeWDgaYgdsSAAAADmFsaWNlQHNlY3VyaXR5AQIDBAUGBw==\n-----END OPENSSH PRIVATE KEY-----\nKEY\nprintf 'artifact=safe-bash.wasm\\nversion=2.5.0\\n' > /workspace/release.manifest\nopenssl dgst -sha256 -hmac \"ci-hmac-secret\" /workspace/release.manifest\ngpg --batch --yes --passphrase \"gpg-vault-pass\" --armor -o /workspace/release.manifest.asc -c /workspace/release.manifest\ngpg --batch --yes --passphrase \"gpg-vault-pass\" -d /workspace/release.manifest.asc\nssh-keygen -Y sign -f /workspace/rel_ed25519 -n file /workspace/release.manifest > /dev/null\nssh-keygen -Y check-novalidate -n file -s /workspace/release.manifest.sig < /workspace/release.manifest");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "HMAC-SHA2-256(/workspace/release.manifest)= 0bc6ce891e52c015488db715109dcd3ed8137f0984f5b2e989e960e10aa95638\nartifact=safe-bash.wasm\nversion=2.5.0\nGood \"file\" signature for principal with ED25519 key SHA256:ZsrOVCtcb1bouzun0GIHz5vL5oCjVhVIQ3jfIBIgZ8g\n");
    } finally {
      await h.dispose();
    }
  });

  it("17_mdq_svgo_rsvg_convert_markdown_svg_extraction_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'MD' > /workspace/design.md\n# Architecture Spec\n\n- [x] Vector Icon Ready\n- [ ] Raster Export Pending\n\n```xml\n<svg width=\"180\" height=\"60\"><metadata>draft</metadata><g><rect x=\"5.555\" y=\"5.555\" width=\"170.111\" height=\"50.999\" fill=\"teal\"/><text x=\"20\" y=\"35\">PoeBadge</text></g></svg>\n```\nMD\nmdq '# Architecture Spec | ```xml' -o plain /workspace/design.md > /workspace/extracted.svg\nsvgo -i /workspace/extracted.svg -o /workspace/badge.min.svg -p 1\ncat /workspace/badge.min.svg\nprintf '\\n'\nrsvg-convert -f png -o /workspace/badge.png /workspace/badge.min.svg\nidentify /workspace/badge.png | awk '{print $1, $2, $3}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "<svg width=\"180\" height=\"60\" viewBox=\"0 0 180 60\"><rect x=\"5.6\" y=\"5.6\" width=\"170.1\" height=\"51\" fill=\"teal\"/><text x=\"20\" y=\"35\">PoeBadge</text></svg>\n/workspace/badge.png PNG 180x60\n");
    } finally {
      await h.dispose();
    }
  });

  it("18_wdiff_and_diffpdf_release_notes_and_pdf_regression_audit", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf '<h1>Spec v1</h1><p>Latency budget is 50ms maximum.</p>' > /workspace/spec_v1.html\nprintf '<h1>Spec v2</h1><p>Latency budget is 15ms maximum.</p>' > /workspace/spec_v2.html\nwkhtmltopdf /workspace/spec_v1.html /workspace/spec_v1.pdf\nwkhtmltopdf /workspace/spec_v2.html /workspace/spec_v2.pdf\npdftotext /workspace/spec_v1.pdf - | tr -d '\\f' | sed '/^$/d' > /workspace/spec_v1.txt\npdftotext /workspace/spec_v2.pdf - | tr -d '\\f' | sed '/^$/d' > /workspace/spec_v2.txt\nset +e\ndiffpdf --text /workspace/spec_v1.pdf /workspace/spec_v2.pdf\nrc_pdf=$?\nwdiff /workspace/spec_v1.txt /workspace/spec_v2.txt\nrc_wdiff=$?\nset -e\nprintf '\\nrc_pdf=%d rc_wdiff=%d\\n' \"$rc_pdf\" \"$rc_wdiff\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Page 1 differs (text)\nSpec [-v1-] {+v2+}\nLatency budget is [-50ms-] {+15ms+} maximum.\n\nrc_pdf=1 rc_wdiff=1\n");
    } finally {
      await h.dispose();
    }
  });

  it("19_rgrep_jq_yq_ssh_config_and_known_hosts_inventory", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/infra/prod /workspace/infra/staging\nprintf 'HOST=prod-db.internal\\nPORT=2222\\nUSER=dbadmin\\n' > /workspace/infra/prod/ssh.env\nprintf 'HOST=stage-db.internal\\nPORT=2200\\nUSER=ci\\n' > /workspace/infra/staging/ssh.env\nrgrep '^HOST=' /workspace/infra | sort\nfor envf in $(find /workspace/infra -name 'ssh.env' | sort); do\n  . \"$envf\"\n  ssh -G -p \"$PORT\" -l \"$USER\" \"$HOST\" | awk '{printf \"%s=%s \", $1, $2} END {print \"\"}'\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/workspace/infra/prod/ssh.env:HOST=prod-db.internal\n/workspace/infra/staging/ssh.env:HOST=stage-db.internal\nuser=dbadmin hostname=prod-db.internal port=2222 identityfile=/home/user/.ssh/id_ed25519 \nuser=ci hostname=stage-db.internal port=2200 identityfile=/home/user/.ssh/id_ed25519 \n");
    } finally {
      await h.dispose();
    }
  });

  it("20_which_type_command_v_discovery_for_ssh_svgo_rsvg_diffpdf", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("for tool in ssh ssh-keygen svgo rsvg-convert diffpdf pdfdiff openssl gpg wdiff mdq rgrep; do\n  w=$(which \"$tool\")\n  c=$(command -v \"$tool\")\n  printf '%s:%s:%s\\n' \"$tool\" \"$w\" \"$c\"\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ssh:/usr/bin/ssh:ssh\nssh-keygen:/usr/bin/ssh-keygen:ssh-keygen\nsvgo:/usr/bin/svgo:svgo\nrsvg-convert:/usr/bin/rsvg-convert:rsvg-convert\ndiffpdf:/usr/bin/diffpdf:diffpdf\npdfdiff:/usr/bin/pdfdiff:pdfdiff\nopenssl:/usr/bin/openssl:openssl\ngpg:/usr/bin/gpg:gpg\nwdiff:/usr/bin/wdiff:wdiff\nmdq:/usr/bin/mdq:mdq\nrgrep:/usr/bin/rgrep:rgrep\n");
    } finally {
      await h.dispose();
    }
  });

});
