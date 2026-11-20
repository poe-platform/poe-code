use document_ast_rust::{TextStyle, cooperate::block_on};
use document_converter_rust::html::{dom::bounded_html_dom, html_notes};

fn admit(source: &str, inherited: &TextStyle, maximum: usize) -> Result<usize, String> {
    let nodes = bounded_html_dom(source).unwrap();
    block_on(html_notes(&nodes, inherited, 10_000, 95, maximum)).map(|notes| notes.len())
}

fn linked_notes(url: &str, definitions: usize, references: usize, body: &str) -> String {
    let refs = (0..references)
        .map(|i| format!("<a role='doc-noteref' href='#n{}'>1</a>", i % definitions))
        .collect::<String>();
    let defs = (0..definitions)
        .map(|i| format!("<li id='n{i}'>{body}</li>"))
        .collect::<String>();
    format!(
        "<p>{refs}</p><a href='{url}'><section role='doc-endnotes'><ol>{defs}</ol></section></a>"
    )
}

const NOTE: &str = "<p><a role='doc-noteref' href='#n'>1</a></p><section role='doc-endnotes'><ol><li id='n'><p>N</p></li></ol></section>";

#[test]
fn inherited_definition_urls_are_admitted_before_retaining_the_index() {
    let url = "x".repeat(32 * 1024);
    let source = linked_notes(&url, 60, 60, "<p>N</p>");
    assert!(source.len() < 128 * 1024);
    let error = admit(&source, &TextStyle::default(), 128 * 1024).unwrap_err();
    assert!(error.contains("HTML note style byte limit"), "{error}");
    // This ceiling admits several definitions, but cannot retain all sixty.
    assert!(admit(&source, &TextStyle::default(), 512 * 1024).is_err());
    assert_eq!(
        admit(
            &linked_notes(&url, 1, 1, "<p>N</p>"),
            &TextStyle::default(),
            6 * url.len()
        ),
        Ok(1)
    );
    assert!(
        admit(
            &linked_notes(&url, 1, 1, "<p>N</p>"),
            &TextStyle::default(),
            6 * url.len() - 1
        )
        .is_err()
    );
}

#[test]
fn note_index_bounds_live_depth_without_charging_every_sibling() {
    let url = "x".repeat(32 * 1024);
    let deep = format!(
        "<a href='{url}'>{}x{}</a>{NOTE}",
        "<span>".repeat(60),
        "</span>".repeat(60)
    );
    let broad = format!("<a href='{url}'>{}</a>{NOTE}", "<span>x</span>".repeat(60));
    assert!(
        admit(&deep, &TextStyle::default(), 128 * 1024)
            .unwrap_err()
            .contains("HTML note style byte limit")
    );
    assert_eq!(admit(&broad, &TextStyle::default(), 128 * 1024), Ok(1));
}

#[test]
fn initial_style_and_href_override_transients_are_admitted_before_cloning() {
    let inherited = TextStyle {
        link: Some("x".repeat(32 * 1024)),
        ..Default::default()
    };
    assert!(
        admit(NOTE, &inherited, 32 * 1024 - 1)
            .unwrap_err()
            .contains("HTML note style byte limit")
    );
    let source = format!("<a href='{}'></a>{NOTE}", "y".repeat(32 * 1024));
    // The initial frame, inherited clone and replacement href coexist briefly.
    assert!(
        admit(&source, &inherited, 80 * 1024)
            .unwrap_err()
            .contains("HTML note style byte limit")
    );
    assert_eq!(admit(&source, &inherited, 256 * 1024), Ok(1));
}

#[test]
fn repeated_note_bodies_charge_inherited_styles_before_expansion() {
    let url = "x".repeat(32 * 1024);
    for body in [
        "<p>N</p>",
        "<p><img src='unread.png'></p>",
        "<p><input type='checkbox'></p>",
    ] {
        let source = linked_notes(&url, 1, 10, body);
        let error = admit(&source, &TextStyle::default(), 256 * 1024).unwrap_err();
        assert!(error.contains("expanded text"), "{body}: {error}");
        assert_eq!(
            admit(
                &linked_notes(&url, 1, 1, body),
                &TextStyle::default(),
                256 * 1024
            ),
            Ok(1)
        );
    }
    // A body's explicit shorter target replaces the definition's inherited URL.
    assert_eq!(
        admit(
            &linked_notes(&url, 1, 10, "<p><a href='s'>N</a></p>"),
            &TextStyle::default(),
            256 * 1024
        ),
        Ok(1)
    );
}

#[test]
fn consumed_backlink_urls_do_not_use_the_note_string_budget() {
    let url = "x".repeat(64 * 1024);
    let source = NOTE.replace(
        "N</p>",
        &format!("N<a role='doc-backlink' href='{url}'>Return</a></p>"),
    );
    assert_eq!(admit(&source, &TextStyle::default(), 256), Ok(1));
    let body_backlink = format!("<a role='doc-backlink' href='{url}'>Return</a>{NOTE}");
    assert!(admit(&body_backlink, &TextStyle::default(), 256).is_err());
}

#[test]
fn documents_without_notes_keep_the_existing_string_limit_behavior() {
    let url = "x".repeat(32 * 1024);
    let source = format!(
        "<a href='{url}'>{}x{}</a>",
        "<span>".repeat(60),
        "</span>".repeat(60)
    );
    let inherited = TextStyle {
        link: Some(url),
        ..Default::default()
    };
    assert_eq!(admit(&source, &inherited, 0), Ok(0));
}
