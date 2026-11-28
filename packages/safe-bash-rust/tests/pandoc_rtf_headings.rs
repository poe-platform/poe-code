use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn rtf_export_and_reimport_preserves_heading_levels() {
    for (markdown, expected) in [
        ("## Section\n\nBody\n", "[2]\n"),
        (
            "# One\n\nBody\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n",
            "[1,2,3,4,5,6]\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            },
        );
        let result = shell.exec_with_options(
            &format!(r#"printf %s '{markdown}' | pandoc -f markdown -t rtf -o a.rtf && pandoc -f rtf -t json a.rtf | jq -c '[..|objects|select(.t?=="Header")|.c[0]]'"#),
            ExecOptions::default(),
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, expected);
    }
}

#[test]
fn rtf_outline_levels_respect_paragraph_resets_and_group_scope() {
    for (input, expected) in [
        (
            r"{\rtf1\outlinelevel1 Section\par\pard Body\par}",
            "[2,null]\n",
        ),
        (r"{\rtf1{\outlinelevel2 Section\par}Body\par}", "[3,null]\n"),
        (
            r"{\rtf1\outlinelevel0 One\par Two\par\outlinelevel9 Body\par}",
            "[1,1,null]\n",
        ),
        (r"{\rtf1{\outlinelevel8 Last}}", "[9]\n"),
        (r"{\rtf1\outlinelevel1\b Title\plain  end\par}", "[2]\n"),
        (
            r"{\rtf1\outlinelevel1 Title{\footnote\pard Note} end\par\pard Body}",
            "[2,null]\n",
        ),
        (
            r"{\rtf1\outlinelevel-1 Body\par\outlinelevel10 More}",
            "[null,null]\n",
        ),
        (r"{\rtf1{\b Bold}\par}", "[null]\n"),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                cwd: Some("/".into()),
                ..Default::default()
            },
        );
        let result = shell.exec_with_options(
            r#"pandoc -f rtf -t json | jq -c '[.blocks[]|if .t=="Header" then .c[0] else null end]'"#,
            ExecOptions { stdin: Some(input.into()), ..Default::default() },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{input}");
        assert_eq!(result.stdout, expected, "{input}");
    }
}
