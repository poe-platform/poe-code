use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    MemoryVfs, SafeBashFs,
    commands::archive::{base64_decode, sha256_bytes, try_run_archive_command},
};
fn text(value: &Value) -> String {
    let Value::String(s) = value else {
        panic!("string expected")
    };
    String::from_utf16_lossy(s)
}

#[test]
fn json_trailer_preserves_binary_document_identifiers() {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/in.pdf",
        include_bytes!("fixtures/qpdf-report-widgets.pdf"),
    )
    .unwrap();
    let args = [
        "--json=2",
        "--json-key=qpdf",
        "--json-object=trailer",
        "in.pdf",
    ]
    .map(str::to_owned);
    let out = try_run_archive_command("qpdf", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(out.exit_code, 0, "{}", out.stderr);
    let report = json::parse(out.stdout.as_bytes(), Default::default()).unwrap();
    let Value::Array(qpdf) = report.get("qpdf").unwrap() else {
        panic!()
    };
    let id = qpdf[1]
        .get("trailer")
        .unwrap()
        .get("value")
        .unwrap()
        .get("/ID");
    let expected = json::parse(
        br#"["b:00112233deadbeef","b:fffe807f"]"#,
        Default::default(),
    )
    .unwrap();
    assert_eq!(id, Some(&expected), "{}", out.stdout);
}

#[test]
fn encrypted_json_matches_js_for_legacy_aes_and_mixed_methods() {
    let fixture = json::parse(
        include_bytes!("../../safe-bash-command-qpdf/src/fixtures/encryption-reports.json"),
        Default::default(),
    )
    .unwrap();
    let Value::Array(cases) = fixture.get("cases").unwrap() else {
        panic!()
    };
    // Exact JSON references from current JS against the existing native-qpdf encrypted fixtures.
    for (name, password, version, expected) in [
        (
            "r2",
            "reader",
            1,
            "55204ac8782f418a6bcd98e28ea5deb442e5cd1852154e2835b5aec5af2bbdaf",
        ),
        (
            "r2",
            "reader",
            2,
            "f1ce142d2b4c59ec9d64c6cc2dca03ccd92373b3cb460e380885d024f74b5e1a",
        ),
        (
            "r2",
            "owner",
            1,
            "af46ea62f827bce74c51e46cf65f4496d59d43281e09fa3a6a1a8fcebde0e694",
        ),
        (
            "r2",
            "owner",
            2,
            "3703c4f655dc7d7b77bb08a54130c41c7dc74bd6c2d1eed13811c45922c7a088",
        ),
        (
            "r3",
            "reader",
            1,
            "eeb24a2fb8ea3fc9f290ffe4d930c4d8501ee724c8391a9d8b670811ada6f691",
        ),
        (
            "r3",
            "reader",
            2,
            "3e50824c8c58e9ae46761a2b623ac612ca79eee9c35f6b5b7ac9f4a5c19ea94f",
        ),
        (
            "r3",
            "owner",
            1,
            "101a40b115f6f2ea71b6e930074d6c3fc117e28b298e485600303ff8784e2f7f",
        ),
        (
            "r3",
            "owner",
            2,
            "0302ccc8a78287f0d1518a1a8dc76d937b35053982bd017a980b89014a25e1cf",
        ),
        (
            "r4",
            "reader",
            1,
            "9f063df5c9dc212e9bce3622f7ce9cf5733a7746d0a98e73ef75a1e2fef50e52",
        ),
        (
            "r4",
            "reader",
            2,
            "a34441341f72111d42aea1094515ffb4044cba683ce2cc5ddfdb497dee640d34",
        ),
        (
            "r4",
            "owner",
            1,
            "8dd11c8f0383c71288d72e8290f5d30a2b35056c703e30228997476be1010f79",
        ),
        (
            "r4",
            "owner",
            2,
            "ae2f8672bb92c3a902189263dea0f20602f6e3033f4d0b2ea27cf453323caff8",
        ),
        (
            "r5",
            "reader",
            1,
            "6be15a25be61a560e13897f4f4b7d5bafba39279ee591cdcc2c02e45127e7304",
        ),
        (
            "r5",
            "reader",
            2,
            "f512462f83b73f8c20141398f119d1d4a99e8cd1d9ac10772dfcbce85d68346c",
        ),
        (
            "r5",
            "owner",
            1,
            "1f1d12fc610a93bbca689f199f11f9d82abb79e2052e6cc49f4fc22e777a3ea7",
        ),
        (
            "r5",
            "owner",
            2,
            "d78ee13669e49c840b88cd0441777609f3840df0adb71d2d9e6c8c3f976b4f6b",
        ),
        (
            "r6",
            "reader",
            1,
            "99ab07a0af842a33118a5c7d8706d7229bc3b71465b61130e04e039a27dfa088",
        ),
        (
            "r6",
            "reader",
            2,
            "9a2fec5d5fd7f4842523381fe5d4e123e08bf3b40527ddba45728cd1141fa626",
        ),
        (
            "r6",
            "owner",
            1,
            "8404d56a1e82c25c98055e2fc13600ffd77a27882faae22049a06f13f133f056",
        ),
        (
            "r6",
            "owner",
            2,
            "f48f5673086776455e77aea985f2a68989fac4f9248e82eae57c2d0d28a31b28",
        ),
        (
            "same",
            "same",
            1,
            "6eb41e6b149d24a1d33b4461785feb54a533dc37145ed9138cce1165c6ab9f6b",
        ),
        (
            "same",
            "same",
            2,
            "4cb42749cc674e31206d4e2ed8a2dbf1b99886e51ee8c7217f2c6d978f559e62",
        ),
        (
            "empty",
            "",
            1,
            "2d4c45950a0f231787be9ac28d1a27eaf5862073d3a0f2654fc9ffb9b6d63dad",
        ),
        (
            "empty",
            "",
            2,
            "a388a0257832cf64338da9d131cecaa0395fa0acf56fce196ff2d622583ba207",
        ),
        (
            "empty",
            "owner",
            1,
            "2f47bd61b79fff31b8268b88c12b8d8e0f46261a6cd6ff1ac25db927ca8034e9",
        ),
        (
            "empty",
            "owner",
            2,
            "d640db571c7743a34e3389a03c0f157666eb291f9195947043aef0c1917344cb",
        ),
        (
            "r4-identity-streams-aes-attachments",
            "reader",
            1,
            "c796fde0119132daae09c37d2422c64d9f70300af9076735ea325960ddd62ba5",
        ),
        (
            "r4-identity-streams-aes-attachments",
            "reader",
            2,
            "8e18a189c41b7dd6268e40cc79b1927cd018355ebac618d481a8848cff36c122",
        ),
        (
            "r4-identity-streams-aes-attachments",
            "owner",
            1,
            "7269d8640c5243e1eb99c223da32c23611c537e632385b83c11b610c91918d7b",
        ),
        (
            "r4-identity-streams-aes-attachments",
            "owner",
            2,
            "3570eaac8e8818a800a7b57ab11adb6a6639ffdd295e956765e1118163ef78b7",
        ),
    ] {
        let case = cases
            .iter()
            .find(|c| text(c.get("name").unwrap()) == name)
            .unwrap();
        let bytes = base64_decode(&text(case.get("pdf").unwrap())).unwrap();
        let fs = MemoryVfs::new();
        fs.write_file("/in.pdf", &bytes).unwrap();
        let args = vec![
            format!("--password={password}"),
            format!("--json={version}"),
            "--json-key=encrypt".into(),
            "in.pdf".into(),
        ];
        let out =
            try_run_archive_command("qpdf", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(
            out.exit_code, 0,
            "{name} {password} {version}: {}",
            out.stderr
        );
        assert_eq!(
            sha256_bytes(out.stdout.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
            expected,
            "{name} {password} {version}: {}",
            out.stdout
        );
    }
}

#[test]
fn page_labels_and_widget_fields_match_both_json_schemas() {
    let bytes = include_bytes!("fixtures/qpdf-report-widgets.pdf");
    for (mode, version, expected) in [
        (
            "widgets",
            1,
            "f6e65fd8709536703e380b107ab989339f6feaf963473a55a21e3bc8a3e1960a",
        ),
        (
            "widgets",
            2,
            "9f9735ac6b418ab53eeca7831712e53e228302643634aa8949a42ba9b8fa9dcc",
        ),
        (
            "widgetless",
            1,
            "4bf8d0792f1cf916ca5ba3471a6477d28ac0a393bbafc34a94b04dfcdabb931a",
        ),
        (
            "widgetless",
            2,
            "a41dc11ae35739d424aeb47fb89274945e9e39a71a7a3ebba50266720c0f9b76",
        ),
        (
            "noform",
            1,
            "d5bf835f9ae3af746d568f4b7ae934b3f4b7ab942fbb3b729f7e4ac3f0ea7a65",
        ),
        (
            "noform",
            2,
            "98f5cd56ff21fca5a534a28d433f988f0354754b70adc84304d2cfdcb289ecff",
        ),
    ] {
        let mut bytes = bytes.to_vec();
        if mode != "widgets" {
            let (from, to): (&[u8], &[u8]) = if mode == "widgetless" {
                (b"/Annots", b"/Hidden")
            } else {
                (b"/AcroForm", b"/NotAForm")
            };
            let at = bytes.windows(from.len()).position(|w| w == from).unwrap();
            bytes[at..at + from.len()].copy_from_slice(to);
        }
        let fs = MemoryVfs::new();
        fs.write_file("/in.pdf", &bytes).unwrap();
        let args = vec![
            format!("--json={version}"),
            "--json-key=pagelabels".into(),
            "--json-key=acroform".into(),
            "in.pdf".into(),
        ];
        let out =
            try_run_archive_command("qpdf", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(out.exit_code, 0, "{mode} {version}: {}", out.stderr);
        assert_eq!(
            sha256_bytes(out.stdout.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
            expected,
            "{mode} {version}: {}",
            out.stdout
        );
    }
}

#[test]
fn externalized_images_are_in_page_summaries_and_respect_object_selection() {
    for (flags, expected) in [
        (
            "--json=1  --json-stream-data=inline --json-stream-prefix=p-",
            "6098eb8b701c0fef0bd927ad286068b4c662ac0e9894bc88a761e64f27fa61b4",
        ),
        (
            "--json=2  --json-stream-data=file --json-stream-prefix=p-",
            "ed45adcc09941adacc3eff51191cc7cde2b2e113949d496242207d5006bea079",
        ),
        (
            "--json=1 --json-key=pages --json-stream-data=inline --json-stream-prefix=p-",
            "a3ac6612fcdcb930245741ecfa48af08764807cbd7cc75762dff1802924f2007",
        ),
        (
            "--json=2 --json-key=pages --json-stream-data=file --json-stream-prefix=p-",
            "aa1ba3662e338de9b5510d7c5c7074b34fb1f424e2ec793fed575c5540a86308",
        ),
        (
            "--json=2 --json-object=999 --json-stream-data=file --json-stream-prefix=p-",
            "b94a0251d54261ae72f7fbfa1a4b57b0f824d761a25a47026a7f1877d509d69f",
        ),
    ] {
        let fs = MemoryVfs::new();
        fs.write_file("/in", include_bytes!("fixtures/qpdf-inline-images.pdf"))
            .unwrap();
        let args = ["in", "--externalize-inline-images", "--ii-min-bytes=1"]
            .into_iter()
            .chain(flags.split_whitespace())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let out =
            try_run_archive_command("qpdf", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(out.exit_code, 0, "{flags}: {}", out.stderr);
        let digest = sha256_bytes(out.stdout.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        assert_eq!(digest, expected, "{flags}: {}", out.stdout);
    }
}
