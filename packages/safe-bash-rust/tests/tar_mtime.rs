use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn shell(fs: &MemoryVfs) -> Shell {
    Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    )
}

#[test]
fn tar_restores_fixed_calendar_mtime() {
    let fs = MemoryVfs::new();
    let result = shell(&fs)
        .exec_with_options(
            "printf data > a && touch -d @1009843200 a && tar --mtime=2000-01-01 -cf snap.tar a && mkdir restored && tar -xf snap.tar -C restored && stat -c %Y restored/a",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "946684800\n");
    assert!(!result.used_typescript_bridge);
    assert_eq!(fs.stat("/a").unwrap().mtime_ms, 1_009_843_200_000.);
}

#[test]
fn tar_mtime_option_forms_preserve_absolute_dates_and_epoch_precision() {
    for separator in ["=", " "] {
        for (date, expected_ms) in [
            ("2000-01-01", 946_684_800_000.),
            ("2000-01-01T01:02:03.125Z", 946_688_523_125.),
            ("2000-01-01T01:00:00+01:00", 946_684_800_000.),
            ("Sat, 01 Jan 2000 00:00:00 +0000", 946_684_800_000.),
            ("@946684800", 946_684_800_000.),
            ("@946684800.125", 946_684_800_125.),
            ("1969-12-31T23:59:59Z", -1000.),
            ("@-0.25", -250.),
        ] {
            let fs = MemoryVfs::new();
            let result = shell(&fs)
                .exec_with_options(
                    &format!("printf data > a && touch -d @1009843200 a && tar --mtime{separator}'{date}' -cf snap.tar a && mkdir restored && tar -xf snap.tar -C restored"),
                    ExecOptions::default(),
                )
                .unwrap();
            assert_eq!(result.exit_code, 0, "{separator}{date}: {}", result.stderr);
            assert_eq!(
                fs.stat("/restored/a").unwrap().mtime_ms,
                expected_ms,
                "{separator}{date}"
            );
            assert_eq!(fs.read_file("/restored/a").unwrap(), b"data");
        }
    }
}

#[test]
fn tar_rejects_invalid_mtime_before_replacing_archive() {
    for separator in ["=", " "] {
        for date in ["", "@", "@NaN", "@inf", "2000-02-30", "invalid2000"] {
            let fs = MemoryVfs::new();
            let result = shell(&fs)
                .exec_with_options(
                    &format!("printf data > a && printf original > snap.tar && tar --mtime{separator}'{date}' -cf snap.tar a"),
                    ExecOptions::default(),
                )
                .unwrap();
            assert_eq!(result.exit_code, 2, "{separator}{date}: {result:?}");
            assert_eq!(result.stderr, format!("tar: invalid mtime: {date}\n"));
            assert_eq!(fs.read_file("/snap.tar").unwrap(), b"original");
        }
    }
}
