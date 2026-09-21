use poe_agent_rust::file_tools::{Glob, count_occurrences, image_mime, replace_text, slice_lines};
fn utf(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn line_windows_keep_exact_newlines_surrogates_and_out_of_range_semantics() {
    let value = utf("zero\r\none\ntwo\n");
    assert_eq!(slice_lines(&value, 1.0, Some(1.0)), utf("one\n"));
    assert_eq!(slice_lines(&value, 0.0, None), value);
    assert_eq!(slice_lines(&value, 99.0, None), vec![]);
    assert_eq!(slice_lines(&value, 1.0, Some(0.0)), vec![]);
    assert_eq!(slice_lines(&[0xd800, 10, 0xdc00], 1.0, None), vec![0xdc00]);
}
#[test]
fn exact_edits_count_nonoverlapping_matches_and_preserve_js_replacement_patterns() {
    assert_eq!(count_occurrences(&utf("aaaaa"), &utf("aa")), 2);
    assert_eq!(count_occurrences(&utf("abc"), &[]), 0);
    assert_eq!(
        replace_text(&utf("xabcx"), &utf("abc"), &utf("$$:$&:$`:$':$1"), false),
        utf("x$:abc:x:x:$1x")
    );
    assert_eq!(
        replace_text(&utf("abcabc"), &utf("abc"), &utf("$&"), true),
        utf("$&$&")
    );
    assert_eq!(image_mime(&utf(".jpeg")), Some("image/jpeg"));
    assert_eq!(image_mime(&utf(".txt")), None);
}
#[test]
fn glob_matches_hidden_paths_nested_globstars_classes_braces_and_extglobs() {
    for (pattern, positives, negatives) in [
        (
            "**/*.ts",
            vec!["a.ts", "src/a.ts", ".hidden/a.ts"],
            vec!["src/a.tsx", "a.md"],
        ),
        (
            "src/{a,b}.[tj]s",
            vec!["src/a.ts", "src/b.js"],
            vec!["src/c.ts", "other/a.ts"],
        ),
        (
            "@(src|test)/**/+(a|b).ts",
            vec!["src/a.ts", "test/sub/abba.ts"],
            vec!["src/c.ts", "a.ts"],
        ),
        ("a/**", vec!["a/b", "a/b/c"], vec!["a", "ab/c"]),
        ("*.{ts,js}", vec!["a.ts", ".a.js"], vec!["src/a.ts", "a.md"]),
        ("file\\?.txt", vec!["file?.txt"], vec!["filea.txt"]),
        (
            "x{01..03}.txt",
            vec!["x01.txt", "x03.txt"],
            vec!["x04.txt", "x1.txt"],
        ),
    ] {
        let glob = Glob::new(&utf(pattern)).unwrap();
        for path in positives {
            assert!(glob.matches(&utf(path)), "{pattern} should match {path}");
        }
        for path in negatives {
            assert!(!glob.matches(&utf(path)), "{pattern} should reject {path}");
        }
    }
}
#[test]
fn glob_repetition_and_large_inputs_do_not_recurse_per_character() {
    let glob = Glob::new(&utf("**/+(a|aa)*.ts")).unwrap();
    assert!(glob.matches(&utf(&format!("deep/{}.ts", "a".repeat(4096)))));
    assert!(Glob::new(&utf(&format!("{}a,b{}", "{".repeat(100), "}".repeat(100)))).is_err());
}

#[test]
fn glob_traversal_depth_follows_alternatives_and_repetitions() {
    assert_eq!(Glob::new(&utf("src/*.ts")).unwrap().max_depth(), Some(0));
    assert_eq!(
        Glob::new(&utf("@(src|test)/*.ts")).unwrap().max_depth(),
        Some(1)
    );
    assert_eq!(Glob::new(&utf("**/*.ts")).unwrap().max_depth(), None);
    assert_eq!(Glob::new(&utf("*(src/)*.ts")).unwrap().max_depth(), None);
}
