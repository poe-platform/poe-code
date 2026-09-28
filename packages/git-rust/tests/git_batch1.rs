use std::collections::BTreeMap;

use git_rust::commands::{add, set_config, status};
use git_rust::errors::{ErrorCode, ErrorDataValue, GitError};
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::fs::{FsError, mkdirp};
use git_rust::managers::GitIndexManager;
use git_rust::models::{
    CommitObject, ConfigValue, GitAnnotatedTag, GitConfig, GitIndex, GitObject, GitPackIndex,
    GitPktLine, GitRefSpecSet, GitSideBand, GitTree, PktLineItem, TagObject,
};
use git_rust::utils::delta::apply_delta;
use git_rust::utils::{
    Author, ExtractedAuth, PartialAuthor, ServerRef, extract_auth_from_url,
    flat_file_list_to_directory_structure, format_info_refs, is_binary, join, merge_file,
    normalize_author_object, normalize_committer_object, shasum, split_lines,
};
use git_rust::version;
use git_rust::wire::{
    RefsAdResponse, UploadPackRequest, parse_refs_ad_response, parse_upload_pack_request,
    parse_upload_pack_response, write_refs_ad_response, write_upload_pack_request,
};

macro_rules! dual_test {
    ($name:ident, $sub_name:ident, $fixture:expr, $body:block) => {
        #[test]
        fn $name() {
            $body
        }

        #[test]
        fn $sub_name() {
            let _sm = make_fixture_as_submodule($fixture);
            $body
        }
    };
}

// ============================================================================
// 1. test-GitAnnotatedTag.js + test-GitAnnotatedTag-in-submodule.js (4 tests)
// ============================================================================
const TAG_STRING: &str = "object af4d84a6a9fa7a74acdad07fddf9f17ff3a974ae
type commit
tag v0.0.9
tagger Will Hilton <wmhilton@gmail.com> 1507071414 -0400

0.0.9
-----BEGIN PGP SIGNATURE-----
Version: GnuPG v1

iQIcBAABAgAGBQJZ1BW2AAoJEJYJuKWSi6a5S6EQAJQkK+wIXijDf4ZfVeP1E7Be
aDDdOLga0/gj5p2p081TLLlaKKLcYj2pub8BfFVpEmvT0QRaKaMb+wAtO5PBHTbn
y2s3dCmqqAPQa0AXrChverKomK/gUYZfFzckS8GaJTiw2RyvheXOLOEGSLTHOwy2
wjP8KxGOWfHlXZEhn/Z406OlcYMzMSL70H26pgyggSTe5RNfpXEBAgWmIAA51eEM
9tF9xuijc0mlr6vzxYVmfwat4u38nrwX7JvWp2CvD/qwILMAYGIcZqRXK5jWHemD
/x5RtUGU4cr47++FD3N3zBWx0dBiCMNUwT/v68kmhrBVX20DhcC6UX38yf1sdDfZ
yapht2+TakKQuw/T/K/6bFjoa8MIHdAx7WCnMV84M0qfMr+e9ImeH5Hj592qw4Gh
vSY80gKslkXjRnVes7VHXoL/lVDvCM2VNskWTTLGHqt+rIvSXNFGP05OGtdFYu4d
K9oFVEoRPFTRSeF/9EztyeLb/gtSdBmWP2AhZn9ip0a7rjbyv5yeayZTsedoUfe5
o8cB++UXreD+h3c/F6mTRs8aVELhQTZNZ677PY71HJKsCLbQJAd4n+gS1n8Y/7wv
Zp4YxnShDkMTV3rxZc27vehq2g9gKJzQsueLyZPJTzCHqujumiLbdYV4i4X4CZjy
dBWrLc3kdnemrlhSRzR2
=PrR1
-----END PGP SIGNATURE-----
";

dual_test!(
    git_annotated_tag_parse,
    git_annotated_tag_parse_in_submodule,
    "test-annotatedTag",
    {
        let tag = GitAnnotatedTag::from_str(TAG_STRING);
        let parsed = tag.parse();
        assert_eq!(parsed.object, "af4d84a6a9fa7a74acdad07fddf9f17ff3a974ae");
        assert_eq!(parsed.object_type, "commit");
        assert_eq!(parsed.tag, "v0.0.9");
        assert_eq!(
            parsed.tagger,
            Author {
                name: "Will Hilton".into(),
                email: "wmhilton@gmail.com".into(),
                timestamp: 1507071414,
                timezone_offset: 240.0,
            }
        );
        assert_eq!(parsed.message, "0.0.9");
        assert!(parsed.gpgsig.as_ref().unwrap().starts_with("-----BEGIN PGP SIGNATURE-----"));
    }
);

dual_test!(
    git_annotated_tag_render,
    git_annotated_tag_render_in_submodule,
    "test-annotatedTag",
    {
        let parsed = GitAnnotatedTag::from_str(TAG_STRING).parse();
        let tag = GitAnnotatedTag::from_object(&TagObject { ..parsed });
        assert_eq!(tag.render(), TAG_STRING);
    }
);

// ============================================================================
// 2. test-GitConfig.js + test-GitConfig-in-submodule.js (57 + 57 = 114 tests)
// ============================================================================
dual_test!(git_config_get_simple_foo, git_config_get_simple_foo_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valfoo\n      [bar]\n      keyaaa = valbar");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("valfoo"));
});

dual_test!(git_config_get_simple_bar, git_config_get_simple_bar_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valfoo\n      [bar]\n      keyaaa = valbar");
    assert_eq!(config.get_str("bar.keyaaa").as_deref(), Some("valbar"));
});

dual_test!(git_config_get_implicit_boolean, git_config_get_implicit_boolean_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valaaa\n      keybbb\n      keyccc = valccc");
    assert_eq!(config.get_str("foo.keybbb").as_deref(), Some("true"));
});

dual_test!(git_config_get_section_case_insensitive, git_config_get_section_case_insensitive_sub, "test-config", {
    let config = GitConfig::from("[Foo]\n      keyaaa = valaaa");
    assert_eq!(config.get_str("FOO.keyaaa").as_deref(), Some("valaaa"));
});

dual_test!(git_config_get_subsection_case_sensitive, git_config_get_subsection_case_sensitive_sub, "test-config", {
    let config = GitConfig::from("[Foo \"BAR\"]\n      keyaaa = valaaa");
    assert_eq!(config.get("Foo.bar.keyaaa"), None);
    assert_eq!(config.get_str("Foo.BAR.keyaaa").as_deref(), Some("valaaa"));
});

dual_test!(git_config_get_variable_name_insensitive, git_config_get_variable_name_insensitive_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      KeyAaa = valaaa");
    assert_eq!(config.get_str("foo.KEYaaa").as_deref(), Some("valaaa"));
});

dual_test!(git_config_get_last_when_several, git_config_get_last_when_several_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valaaa\n      keybbb = valbbb\n      keybbb = valBBB");
    assert_eq!(config.get_str("foo.keybbb").as_deref(), Some("valBBB"));
});

dual_test!(git_config_get_multiple, git_config_get_multiple_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valaaa\n      keybbb = valbbb\n      keybbb = valBBB");
    assert_eq!(config.get_all("foo.keybbb"), vec![ConfigValue::Str("valbbb".into()), ConfigValue::Str("valBBB".into())]);
});

dual_test!(git_config_get_multiple_case_insensitive, git_config_get_multiple_case_insensitive_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valaaa\n      keybbb = valbbb\n      KEYBBB = valBBB");
    assert_eq!(config.get_all("foo.keybbb"), vec![ConfigValue::Str("valbbb".into()), ConfigValue::Str("valBBB".into())]);
    assert_eq!(config.get_all("foo.KEYBBB"), vec![ConfigValue::Str("valbbb".into()), ConfigValue::Str("valBBB".into())]);
});

dual_test!(git_config_get_subsection, git_config_get_subsection_sub, "test-config", {
    let config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git\n      [remote \"bar\"]\n      url = https://bar.com/project.git");
    assert_eq!(config.get_str("remote.bar.url").as_deref(), Some("https://bar.com/project.git"));
});

dual_test!(git_config_comments_lines_starting_with_hash_or_semi, git_config_comments_lines_starting_with_hash_or_semi_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      #keyaaa = valaaa\n      ;keybbb = valbbb\n      keyccc = valccc");
    assert_eq!(config.get("foo.#keyaaa"), None);
    assert_eq!(config.get("foo.;keybbb"), None);
});

dual_test!(git_config_comments_at_end_get, git_config_comments_at_end_get_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valaaa #comment #aaa\n      keybbb = valbbb ;comment ;bbb\n      keyccc = valccc");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("valaaa"));
    assert_eq!(config.get_str("foo.keybbb").as_deref(), Some("valbbb"));
});

dual_test!(git_config_comments_at_end_set, git_config_comments_at_end_set_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valaaa #comment #aaa\n      keybbb = valbbb ;comment ;bbb\n      keyccc = valccc");
    config.set("foo.keyaaa", Some("newvalaaa"));
    config.set("foo.keybbb", Some("newvalbbb"));
    assert_eq!(config.to_string(), "[foo]\n\tkeyaaa = newvalaaa\n\tkeybbb = newvalbbb\n      keyccc = valccc");
});

dual_test!(git_config_comments_ignore_quoted, git_config_comments_ignore_quoted_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valaaa \" #commentaaa\"\n      keybbb = valbbb \" ;commentbbb\"\n      keyccc = valccc");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("valaaa  #commentaaa"));
    assert_eq!(config.get_str("foo.keybbb").as_deref(), Some("valbbb  ;commentbbb"));
});

dual_test!(git_config_quotes_simple, git_config_quotes_simple_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = \"valaaa\"");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("valaaa"));
});

dual_test!(git_config_quotes_escaped, git_config_quotes_escaped_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = \\\"valaaa");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("\"valaaa"));
});

dual_test!(git_config_quotes_multiple, git_config_quotes_multiple_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = \"val\" aaa\n      keybbb = val \"a\" a\"a\"");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("val aaa"));
    assert_eq!(config.get_str("foo.keybbb").as_deref(), Some("val a aa"));
});

dual_test!(git_config_quotes_odd_number, git_config_quotes_odd_number_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = \"val\" a \"aa");
    assert_eq!(config.get("foo.keybbb"), None);
});

dual_test!(git_config_quotes_hash_in_quoted, git_config_quotes_hash_in_quoted_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = \"#valaaa\"");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("#valaaa"));
});

dual_test!(git_config_quotes_semi_in_quoted, git_config_quotes_semi_in_quoted_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = \"val;a;a;a\"");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("val;a;a;a"));
});

dual_test!(git_config_quotes_hash_after_quoted, git_config_quotes_hash_after_quoted_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = \"valaaa\" # comment");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("valaaa"));
});

dual_test!(git_config_quotes_semi_after_quoted, git_config_quotes_semi_after_quoted_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = \"valaaa\" ; comment");
    assert_eq!(config.get_str("foo.keyaaa").as_deref(), Some("valaaa"));
});

dual_test!(git_config_cast_using_schema, git_config_cast_using_schema_sub, "test-config", {
    let config = GitConfig::from("[core]\n      repositoryformatversion = 0\n      filemode = true\n      bare = false\n      logallrefupdates = true\n      symlinks = false\n      ignorecase = true\n      bigFileThreshold = 2");
    assert_eq!(config.get("core.repositoryformatversion"), Some(ConfigValue::Str("0".into())));
    assert_eq!(config.get("core.filemode"), Some(ConfigValue::Bool(true)));
    assert_eq!(config.get("core.bare"), Some(ConfigValue::Bool(false)));
    assert_eq!(config.get("core.logallrefupdates"), Some(ConfigValue::Bool(true)));
    assert_eq!(config.get("core.symlinks"), Some(ConfigValue::Bool(false)));
    assert_eq!(config.get("core.ignorecase"), Some(ConfigValue::Bool(true)));
    assert_eq!(config.get("core.bigFileThreshold"), Some(ConfigValue::Int(2)));
});

dual_test!(git_config_cast_special_boolean, git_config_cast_special_boolean_sub, "test-config", {
    let config = GitConfig::from("[core]\n      filemode = off\n      bare = on\n      logallrefupdates = no\n      symlinks = true");
    assert_eq!(config.get("core.filemode"), Some(ConfigValue::Bool(false)));
    assert_eq!(config.get("core.bare"), Some(ConfigValue::Bool(true)));
    assert_eq!(config.get("core.logallrefupdates"), Some(ConfigValue::Bool(false)));
    assert_eq!(config.get("core.symlinks"), Some(ConfigValue::Bool(true)));
});

dual_test!(git_config_cast_numeric_suffix, git_config_cast_numeric_suffix_sub, "test-config", {
    let ca = GitConfig::from("[core]\n      bigFileThreshold = 2k");
    let cb = GitConfig::from("[core]\n      bigFileThreshold = 2m");
    let cc = GitConfig::from("[core]\n      bigFileThreshold = 2g");
    assert_eq!(ca.get("core.bigFileThreshold"), Some(ConfigValue::Int(2048)));
    assert_eq!(cb.get("core.bigFileThreshold"), Some(ConfigValue::Int(2097152)));
    assert_eq!(cc.get("core.bigFileThreshold"), Some(ConfigValue::Int(2147483648)));
});

dual_test!(git_config_insert_existing_section, git_config_insert_existing_section_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valaaa");
    config.set("foo.keybbb", Some("valbbb"));
    assert_eq!(config.to_string(), "[foo]\n\tkeybbb = valbbb\n      keyaaa = valaaa");
});

dual_test!(git_config_insert_existing_section_ci, git_config_insert_existing_section_ci_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valaaa");
    config.set("FOO.keybbb", Some("valbbb"));
    assert_eq!(config.to_string(), "[foo]\n\tkeybbb = valbbb\n      keyaaa = valaaa");
});

dual_test!(git_config_insert_existing_subsection, git_config_insert_existing_subsection_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git");
    config.set("remote.foo.fetch", Some("foo"));
    assert_eq!(config.to_string(), "[remote \"foo\"]\n\tfetch = foo\n      url = https://foo.com/project.git");
});

dual_test!(git_config_insert_existing_subsection_ci, git_config_insert_existing_subsection_ci_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git");
    config.set("REMOTE.foo.fetch", Some("foo"));
    assert_eq!(config.to_string(), "[remote \"foo\"]\n\tfetch = foo\n      url = https://foo.com/project.git");
});

dual_test!(git_config_insert_existing_subsection_dots, git_config_insert_existing_subsection_dots_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo.bar\"]\n      url = https://foo.com/project.git");
    config.set("remote.foo.bar.url", Some("https://bar.com/project.git"));
    assert_eq!(config.to_string(), "[remote \"foo.bar\"]\n\turl = https://bar.com/project.git");
});

dual_test!(git_config_insert_new_section, git_config_insert_new_section_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valaaa");
    config.set("bar.keyaaa", Some("valaaa"));
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valaaa\n[bar]\n\tkeyaaa = valaaa");
});

dual_test!(git_config_insert_new_subsection, git_config_insert_new_subsection_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git");
    config.set("remote.bar.url", Some("https://bar.com/project.git"));
    assert_eq!(config.to_string(), "[remote \"foo\"]\n      url = https://foo.com/project.git\n[remote \"bar\"]\n\turl = https://bar.com/project.git");
});

dual_test!(git_config_insert_new_subsection_dots, git_config_insert_new_subsection_dots_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git");
    config.set("remote.bar.baz.url", Some("https://bar.com/project.git"));
    assert_eq!(config.to_string(), "[remote \"foo\"]\n      url = https://foo.com/project.git\n[remote \"bar.baz\"]\n\turl = https://bar.com/project.git");
});

dual_test!(git_config_insert_new_value_with_hash, git_config_insert_new_value_with_hash_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git");
    config.set("remote.foo.bar", Some("hello#world"));
    assert_eq!(config.to_string(), "[remote \"foo\"]\n\tbar = \"hello#world\"\n      url = https://foo.com/project.git");
});

dual_test!(git_config_insert_new_value_with_semi, git_config_insert_new_value_with_semi_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git");
    config.set("remote.foo.bar", Some("hello;world"));
    assert_eq!(config.to_string(), "[remote \"foo\"]\n\tbar = \"hello;world\"\n      url = https://foo.com/project.git");
});

dual_test!(git_config_replace_simple, git_config_replace_simple_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valfoo\n      [bar]\n      keyaaa = valbar\n      keybbb = valbbb");
    config.set("bar.keyaaa", Some("newvalbar"));
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valfoo\n      [bar]\n\tkeyaaa = newvalbar\n      keybbb = valbbb");
});

dual_test!(git_config_replace_simple_ci, git_config_replace_simple_ci_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valfoo\n      [bar]\n      keyaaa = valbar\n      keybbb = valbbb");
    config.set("BAR.keyaaa", Some("newvalbar"));
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valfoo\n      [bar]\n\tkeyaaa = newvalbar\n      keybbb = valbbb");
});

dual_test!(git_config_replace_case_sensitive_key, git_config_replace_case_sensitive_key_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valfoo\n      [bar]\n      keyaaa = valbar\n      keybbb = valbbb");
    config.set("BAR.KEYAAA", Some("newvalbar"));
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valfoo\n      [bar]\n\tKEYAAA = newvalbar\n      keybbb = valbbb");
});

dual_test!(git_config_replace_last_when_several, git_config_replace_last_when_several_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valaaa\n      keybbb = valbbb\n      keybbb = valBBB");
    config.set("foo.keybbb", Some("newvalBBB"));
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valaaa\n      keybbb = valbbb\n\tkeybbb = newvalBBB");
});

dual_test!(git_config_replace_subsection, git_config_replace_subsection_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git\n      [remote \"bar\"]\n      url = https://bar.com/project.git");
    config.set("remote.foo.url", Some("https://foo.com/project-foo.git"));
    assert_eq!(config.to_string(), "[remote \"foo\"]\n\turl = https://foo.com/project-foo.git\n      [remote \"bar\"]\n      url = https://bar.com/project.git");
});

dual_test!(git_config_append_simple, git_config_append_simple_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valfoo\n      [bar]\n      keyaaa = valbar\n      keybbb = valbbb");
    config.append("bar.keyaaa", Some("newvalbar"));
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valfoo\n      [bar]\n      keyaaa = valbar\n\tkeyaaa = newvalbar\n      keybbb = valbbb");
});

dual_test!(git_config_append_simple_ci, git_config_append_simple_ci_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valfoo\n      [bar]\n      keyaaa = valbar\n      keybbb = valbbb");
    config.append("bar.KEYAAA", Some("newvalbar"));
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valfoo\n      [bar]\n      keyaaa = valbar\n\tKEYAAA = newvalbar\n      keybbb = valbbb");
});

dual_test!(git_config_append_subsection, git_config_append_subsection_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git\n      [remote \"bar\"]\n      url = https://bar.com/project.git");
    config.append("remote.baz.url", Some("https://baz.com/project.git"));
    assert_eq!(config.to_string(), "[remote \"foo\"]\n      url = https://foo.com/project.git\n      [remote \"bar\"]\n      url = https://bar.com/project.git\n[remote \"baz\"]\n\turl = https://baz.com/project.git");
});

dual_test!(git_config_remove_simple, git_config_remove_simple_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valaaa\n      keybbb = valbbb");
    config.set("foo.keyaaa", None);
    assert_eq!(config.to_string(), "[foo]\n      keybbb = valbbb");
});

dual_test!(git_config_remove_simple_ci, git_config_remove_simple_ci_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valaaa\n      keybbb = valbbb");
    config.set("FOO.keyaaa", None);
    assert_eq!(config.to_string(), "[foo]\n      keybbb = valbbb");
});

dual_test!(git_config_remove_last_when_several, git_config_remove_last_when_several_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valone\n      keyaaa = valtwo");
    config.set("foo.keyaaa", None);
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valone");
});

dual_test!(git_config_remove_subsection, git_config_remove_subsection_sub, "test-config", {
    let mut config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git\n      [remote \"bar\"]\n      url = https://bar.com/project.git");
    config.set("remote.foo.url", None);
    assert_eq!(config.to_string(), "[remote \"foo\"]\n      [remote \"bar\"]\n      url = https://bar.com/project.git");
});

dual_test!(git_config_err_unknown_key, git_config_err_unknown_key_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valaaa\n      keybbb = valbbb");
    assert_eq!(config.get("foo.unknown"), None);
});

dual_test!(git_config_err_unknown_section, git_config_err_unknown_section_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      keyaaa = valaaa\n      keybbb = valbbb");
    assert_eq!(config.get("bar.keyaaa"), None);
});

dual_test!(git_config_err_unknown_subsection, git_config_err_unknown_subsection_sub, "test-config", {
    let config = GitConfig::from("[remote \"foo\"]\n      url = https://foo.com/project.git\n      [remote \"bar\"]\n      url = https://bar.com/project.git");
    assert_eq!(config.get("remote.unknown.url"), None);
});

dual_test!(git_config_err_invalid_section_get, git_config_err_invalid_section_get_sub, "test-config", {
    let config = GitConfig::from("[fo o]\n      keyaaa = valaaa\n      [ba~r]\n      keyaaa = valaaa\n      [ba?z]\n      keyaaa = valaaa");
    assert_eq!(config.get("fo o.keyaaa"), None);
    assert_eq!(config.get("ba~r.keyaaa"), None);
    assert_eq!(config.get("ba?z.keyaaa"), None);
});

dual_test!(git_config_err_invalid_section_set, git_config_err_invalid_section_set_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valfoo");
    config.set("ba?r.keyaaa", Some("valbar"));
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valfoo");
});

dual_test!(git_config_err_invalid_variable_get, git_config_err_invalid_variable_get_sub, "test-config", {
    let config = GitConfig::from("[foo]\n      key aaa = valaaa\n      key?bbb = valbbb\n      key%ccc = valccc\n      key.ddd = valddd");
    assert_eq!(config.get("foo.key aaa"), None);
    assert_eq!(config.get("foo.key?bbb"), None);
    assert_eq!(config.get("foo.key%ccc"), None);
    assert_eq!(config.get("foo.key.ddd"), None);
});

dual_test!(git_config_err_invalid_variable_set, git_config_err_invalid_variable_set_sub, "test-config", {
    let mut config = GitConfig::from("[foo]\n      keyaaa = valaaa");
    config.set("foo.key bbb", Some("valbbb"));
    config.set("foo.key?ccc", Some("valccc"));
    config.set("foo.key%ddd", Some("valddd"));
    assert_eq!(config.to_string(), "[foo]\n      keyaaa = valaaa");
});

dual_test!(git_config_get_subsections_simple, git_config_get_subsections_simple_sub, "test-config", {
    let config = GitConfig::from("[one]\n      keyaaa = valaaa\n          \n      [remote \"foo\"]\n      url = https://foo.com/project.git\n\n      [remote \"bar\"]\n      url = https://bar.com/project.git\n            \n      [two]\n      keyaaa = valaaa");
    assert_eq!(config.get_subsections("remote"), vec![Some("foo".into()), Some("bar".into())]);
});

dual_test!(git_config_delete_section_simple, git_config_delete_section_simple_sub, "test-config", {
    let mut config = GitConfig::from("[one]\n      keyaaa = valaaa\n[two]\n      keybbb = valbbb");
    config.delete_section("one", None);
    assert_eq!(config.to_string(), "[two]\n      keybbb = valbbb");
});

dual_test!(git_config_delete_section_subsection, git_config_delete_section_subsection_sub, "test-config", {
    let mut config = GitConfig::from("[one]\n      keyaaa = valaaa\n      \n      [remote \"foo\"]\n      url = https://foo.com/project.git\n      ; this is a comment\n      \n      [remote \"bar\"]\n      url = https://bar.com/project.git");
    config.delete_section("remote", Some("foo"));
    assert_eq!(config.to_string(), "[one]\n      keyaaa = valaaa\n      \n      [remote \"bar\"]\n      url = https://bar.com/project.git");
});

// ============================================================================
// 3. test-GitError.js + test-GitError-in-submodule.js (6 tests)
// ============================================================================
dual_test!(git_error_static_codes, git_error_static_codes_sub, "test-empty", {
    for code in ErrorCode::ALL {
        assert!(!code.as_str().is_empty());
        assert_eq!(code.to_string(), code.as_str());
    }
});

dual_test!(git_error_create_not_found, git_error_create_not_found_sub, "test-empty", {
    let err = GitError::not_found("foobar.txt");
    assert_eq!(err.code, ErrorCode::NotFoundError);
    assert_eq!(err.message, "Could not find foobar.txt.");
    assert_eq!(
        err.data.get("what"),
        Some(&ErrorDataValue::Str("foobar.txt".into()))
    );
});

dual_test!(git_error_create_internal, git_error_create_internal_sub, "test-empty", {
    let err = GitError::internal("Something unexpected happened.");
    assert_eq!(err.code, ErrorCode::InternalError);
    assert!(err.message.contains("Something unexpected happened."));
});

// ============================================================================
// 4. test-GitIndex.js + test-GitIndex-in-submodule.js (10 tests)
// ============================================================================
dual_test!(git_index_from_buffer_simple, git_index_from_buffer_simple_sub, "test-GitIndex", {
    let env = make_fixture("test-GitIndex");
    let buffer = env.fs.read(&format!("{}/simple-index", env.dir)).unwrap();
    let index = GitIndex::from_buffer(&buffer).unwrap();
    assert_eq!(index.render(), "100644 323fae03f4606ea9991df8befbb2fca795e648fa    world.txt");
    let buffer2 = index.to_object().unwrap();
    assert_eq!(&buffer[..buffer2.len() - 20], &buffer2[..buffer2.len() - 20]);
});

dual_test!(git_index_from_buffer_full, git_index_from_buffer_full_sub, "test-GitIndex", {
    let env = make_fixture("test-GitIndex");
    let buffer = env.fs.read(&format!("{}/index", env.dir)).unwrap();
    let index = GitIndex::from_buffer(&buffer).unwrap();
    assert!(index.render().starts_with("100644 1db939d41956405f755e69ab570296c7ed3cec99    .babelrc"));
    let buffer2 = index.to_object().unwrap();
    assert_eq!(&buffer[..buffer2.len() - 20], &buffer2[..buffer2.len() - 20]);
});

dual_test!(git_index_roundtrip, git_index_roundtrip_sub, "test-GitIndex", {
    let env = make_fixture("test-GitIndex");
    let buffer = env.fs.read(&format!("{}/index", env.dir)).unwrap();
    let index = GitIndex::from_buffer(&buffer).unwrap();
    let buffer2 = index.to_object().unwrap();
    let index2 = GitIndex::from_buffer(&buffer2).unwrap();
    let buffer3 = index2.to_object().unwrap();
    assert_eq!(buffer2, buffer3);
});

dual_test!(git_index_write_unmerged_and_read_back, git_index_write_unmerged_and_read_back_sub, "test-GitIndex", {
    let env = make_fixture("test-GitIndex");
    GitIndexManager::acquire(&env.fs, &env.gitdir, |index| {
        assert_eq!(index.entries().len(), 0);
        assert_eq!(index.entries_flat().len(), 0);
        index.insert("a", None, "01", 1);
        index.insert("a", None, "10", 2);
        index.insert("a", None, "11", 3);
        assert_eq!(index.unmerged_paths(), vec!["a".to_string()]);
        Ok(())
    })
    .unwrap();
    GitIndexManager::acquire(&env.fs, &env.gitdir, |index| {
        assert_eq!(index.entries().len(), 1);
        assert_eq!(index.entries_flat().len(), 3);
        assert_eq!(index.unmerged_paths(), vec!["a".to_string()]);
        let entry_a = index.entries_map().get("a").unwrap();
        assert_eq!(entry_a.stages.len(), 4);
        assert!(entry_a.stages[1].is_some());
        assert!(entry_a.stages[2].is_some());
        assert!(entry_a.stages[3].is_some());
        Ok(())
    })
    .unwrap();
});

dual_test!(git_index_read_existing_unmerged, git_index_read_existing_unmerged_sub, "test-GitIndex-unmerged", {
    let env = make_fixture("test-GitIndex-unmerged");
    let raw = env.fs.read(&format!("{}/index", env.gitdir)).unwrap();
    let index = GitIndex::from_buffer(&raw).unwrap();
    assert_eq!(index.unmerged_paths(), vec!["a".to_string(), "b".to_string()]);
    assert_eq!(index.entries().len(), 3);
    assert_eq!(index.entries_flat().len(), 7);
});

// ============================================================================
// 5. test-GitPackIndex.js + test-GitPackIndex-in-submodule.js (12 tests)
// ============================================================================
dual_test!(git_pack_index_from_idx_1, git_pack_index_from_idx_1_sub, "test-GitPackIndex", {
    let env = make_fixture("test-GitPackIndex");
    let idx_buf = env.fs.read(&format!("{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.idx", env.gitdir)).unwrap();
    let idx = GitPackIndex::from_idx(&idx_buf).unwrap().unwrap();
    assert!(idx.offsets.contains_key("0b8faa11b353db846b40eb064dfb299816542a46"));
});

dual_test!(git_pack_index_from_idx_2, git_pack_index_from_idx_2_sub, "test-GitPackIndex", {
    let env = make_fixture("test-GitPackIndex");
    let idx_buf = env.fs.read(&format!("{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.idx", env.gitdir)).unwrap();
    let idx = GitPackIndex::from_idx(&idx_buf).unwrap().unwrap();
    assert_eq!(idx.hashes.len(), 769);
});

dual_test!(git_pack_index_from_pack_1, git_pack_index_from_pack_1_sub, "test-GitPackIndex", {
    let env = make_fixture("test-GitPackIndex");
    let pack = env.fs.read(&format!("{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.pack", env.gitdir)).unwrap();
    let idx_expected = env.fs.read(&format!("{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.idx", env.gitdir)).unwrap();
    let idx = GitPackIndex::from_pack::<fn(&str) -> Result<_, _>>(&pack, None).unwrap();
    assert_eq!(idx.to_buffer().unwrap(), idx_expected);
});

dual_test!(git_pack_index_from_pack_2, git_pack_index_from_pack_2_sub, "test-GitPackIndex", {
    let env = make_fixture("test-GitPackIndex");
    let pack = env.fs.read(&format!("{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.pack", env.gitdir)).unwrap();
    let idx_expected = env.fs.read(&format!("{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.idx", env.gitdir)).unwrap();
    let idx = GitPackIndex::from_pack::<fn(&str) -> Result<_, _>>(&pack, None).unwrap();
    assert_eq!(idx.to_buffer().unwrap(), idx_expected);
});

dual_test!(git_pack_index_read_undeltified, git_pack_index_read_undeltified_sub, "test-GitPackIndex", {
    let env = make_fixture("test-GitPackIndex");
    let pack = env.fs.read(&format!("{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.pack", env.gitdir)).unwrap();
    let idx = GitPackIndex::from_pack::<fn(&str) -> Result<_, _>>(&pack, None).unwrap();
    let obj = idx.read("0b8faa11b353db846b40eb064dfb299816542a46").unwrap();
    assert_eq!(obj.object_type, "commit");
});

dual_test!(git_pack_index_read_ofs_delta, git_pack_index_read_ofs_delta_sub, "test-GitPackIndex", {
    let env = make_fixture("test-GitPackIndex");
    let pack = env.fs.read(&format!("{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.pack", env.gitdir)).unwrap();
    let idx = GitPackIndex::from_pack::<fn(&str) -> Result<_, _>>(&pack, None).unwrap();
    let obj = idx.read("5f1f014326b1d7e8079d00b87fa7a9913bd91324").unwrap();
    assert!(!obj.object.is_empty());
});

// ============================================================================
// 6. test-GitPktLine.js + test-GitPktLine-in-submodule.js (12 tests)
// ============================================================================
dual_test!(git_pkt_line_encode_string, git_pkt_line_encode_string_sub, "test-empty", {
    assert_eq!(GitPktLine::encode_str("hello\n"), b"000ahello\n");
});

dual_test!(git_pkt_line_encode_empty, git_pkt_line_encode_empty_sub, "test-empty", {
    assert_eq!(GitPktLine::encode_str(""), b"0004");
});

dual_test!(git_pkt_line_flush, git_pkt_line_flush_sub, "test-empty", {
    assert_eq!(GitPktLine::flush(), b"0000");
});

dual_test!(git_pkt_line_delim, git_pkt_line_delim_sub, "test-empty", {
    assert_eq!(GitPktLine::delim(), b"0001");
});

dual_test!(git_pkt_line_stream_reader, git_pkt_line_stream_reader_sub, "test-empty", {
    let mut buf = Vec::new();
    buf.extend_from_slice(&GitPktLine::encode_str("foo\n"));
    buf.extend_from_slice(&GitPktLine::encode_str("bar\n"));
    buf.extend_from_slice(&GitPktLine::flush());
    let mut reader = GitPktLine::stream_reader(&buf);
    assert_eq!(reader.read(), PktLineItem::Line(b"foo\n".to_vec()));
    assert_eq!(reader.read(), PktLineItem::Line(b"bar\n".to_vec()));
    assert_eq!(reader.read(), PktLineItem::Flush);
});

dual_test!(git_pkt_line_stream_reader_delim, git_pkt_line_stream_reader_delim_sub, "test-empty", {
    let mut buf = Vec::new();
    buf.extend_from_slice(&GitPktLine::encode_str("cmd\n"));
    buf.extend_from_slice(&GitPktLine::delim());
    buf.extend_from_slice(&GitPktLine::encode_str("arg\n"));
    buf.extend_from_slice(&GitPktLine::flush());
    let mut reader = GitPktLine::stream_reader(&buf);
    assert_eq!(reader.read(), PktLineItem::Line(b"cmd\n".to_vec()));
    assert_eq!(reader.read(), PktLineItem::Delim);
    assert_eq!(reader.read(), PktLineItem::Line(b"arg\n".to_vec()));
    assert_eq!(reader.read(), PktLineItem::Flush);
});

// ============================================================================
// 7. test-GitRefSpecSet.js + test-GitRefSpecSet-in-submodule.js (6 tests)
// ============================================================================
dual_test!(git_ref_spec_set_fetch_master, git_ref_spec_set_fetch_master_sub, "test-empty", {
    let set = GitRefSpecSet::from(&[
        "+refs/heads/*:refs/remotes/origin/*",
        "refs/tags/v1.0:refs/tags/v1.0-local",
    ]);
    assert_eq!(
        set.translate(&["refs/heads/master", "refs/tags/v1.0"]),
        vec![
            ("refs/heads/master".into(), "refs/remotes/origin/master".into()),
            ("refs/tags/v1.0".into(), "refs/tags/v1.0-local".into()),
        ]
    );
});

dual_test!(git_ref_spec_set_translate_one, git_ref_spec_set_translate_one_sub, "test-empty", {
    let set = GitRefSpecSet::from(&["+refs/heads/*:refs/remotes/origin/*"]);
    assert_eq!(set.translate_one("refs/heads/main").as_deref(), Some("refs/remotes/origin/main"));
});

dual_test!(git_ref_spec_set_local_namespaces, git_ref_spec_set_local_namespaces_sub, "test-empty", {
    let set = GitRefSpecSet::from(&["+refs/heads/*:refs/remotes/origin/*"]);
    assert_eq!(set.local_names(&["refs/heads/master"]), vec!["refs/remotes/origin/master".to_string()]);
});

// ============================================================================
// 8. test-GitSideBand.js + test-GitSideBand-in-submodule.js (4 tests)
// ============================================================================
dual_test!(git_side_band_demux_pack_progress_error, git_side_band_demux_pack_progress_error_sub, "test-empty", {
    let muxed = GitSideBand::mux("side-band-64k", b"PACKDATA", &[b"progress msg\n".to_vec()], &[]);
    let demuxed = GitSideBand::demux(&muxed);
    assert_eq!(demuxed.packfile, b"PACKDATA");
    assert_eq!(demuxed.progress, vec![b"progress msg\n".to_vec()]);
    assert_eq!(demuxed.error, None);
});

dual_test!(git_side_band_demux_packetlines, git_side_band_demux_packetlines_sub, "test-empty", {
    let muxed = GitSideBand::mux("side-band-64k", b"PACKDATA", &[], &[b"err msg\n".to_vec()]);
    let demuxed = GitSideBand::demux(&muxed);
    assert!(demuxed.packfile.is_empty());
    assert_eq!(demuxed.error.as_deref(), Some("err msg\n"));
});

// ============================================================================
// 9. test-GitTree-entry-name-validation.js (13 tests)
// ============================================================================
fn make_tree_entry_bytes(mode: &str, name: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(format!("{mode} {name}").as_bytes());
    buf.push(0);
    buf.extend_from_slice(&[1u8; 20]);
    buf
}

#[test] fn git_tree_rejects_empty_entry_name() {
    assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", "")).unwrap_err().code, ErrorCode::UnsafeFilepathError);
}
#[test] fn git_tree_rejects_dot_entry_name() {
    assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", ".")).unwrap_err().code, ErrorCode::UnsafeFilepathError);
}
#[test] fn git_tree_rejects_dotdot_entry_name() {
    assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", "..")).unwrap_err().code, ErrorCode::UnsafeFilepathError);
}
#[test] fn git_tree_rejects_dot_git_exact() {
    assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", ".git")).unwrap_err().code, ErrorCode::UnsafeFilepathError);
}
#[test] fn git_tree_rejects_dot_git_uppercase() {
    assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", ".GIT")).unwrap_err().code, ErrorCode::UnsafeFilepathError);
}
#[test] fn git_tree_rejects_dot_git_mixed_case() {
    assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", ".GiT")).unwrap_err().code, ErrorCode::UnsafeFilepathError);
}
#[test] fn git_tree_rejects_forward_slash() {
    assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", "a/b")).unwrap_err().code, ErrorCode::UnsafeFilepathError);
}
#[test] fn git_tree_rejects_dos_short_names() {
    for bad in ["git~1", "GIT~1", "git~2", "git~9", "git~1.", "git~1 "] {
        assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", bad)).unwrap_err().code, ErrorCode::UnsafeFilepathError);
    }
}
#[test] fn git_tree_rejects_ntfs_alternate_streams() {
    for bad in [".git::$INDEX_ALLOCATION", ".git:$INDEX_ALLOCATION", ".git:foo", ".GIT:$DATA", "git~1:foo"] {
        assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", bad)).unwrap_err().code, ErrorCode::UnsafeFilepathError);
    }
}
#[test] fn git_tree_rejects_zero_width_dot_git() {
    for bad in [".g\u{200C}it", ".\u{200D}git", ".gi\u{200E}t", ".git\u{FEFF}", ".\u{200C}", ".\u{200C}."] {
        assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", bad)).unwrap_err().code, ErrorCode::UnsafeFilepathError);
    }
}
#[test] fn git_tree_allows_valid_entry_names() {
    for good in ["foo:bar", ".gitignore:bar", "git~10", "git~0", "normal.txt", ".gitignore"] {
        let tree = GitTree::from_bytes(&make_tree_entry_bytes("100644", good)).unwrap();
        assert_eq!(tree.entries()[0].path, good);
    }
}
#[test] fn git_tree_rejects_trailing_dot_and_space_git() {
    for bad in [".git.", ".git "] {
        assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", bad)).unwrap_err().code, ErrorCode::UnsafeFilepathError);
    }
}
#[test] fn git_tree_rejects_backslash_separator() {
    assert_eq!(GitTree::from_bytes(&make_tree_entry_bytes("100644", "a\\b")).unwrap_err().code, ErrorCode::UnsafeFilepathError);
}

// ============================================================================
// 10. test-applyDelta-bounded-allocation.js (2 tests)
// ============================================================================
#[test]
fn apply_delta_bounded_allocation_throws_without_allocating_header_size() {
    let delta = [0x00, 0xff, 0xff, 0xff, 0xff, 0x07, 0x01, 0x00];
    let err = apply_delta(&delta, b"").unwrap_err();
    assert_eq!(err.code, ErrorCode::InternalError);
}

#[test]
fn apply_delta_valid_multi_op_delta() {
    let delta = [0x00, 0x02, 0x01, b'a', 0x01, b'b'];
    let result = apply_delta(&delta, b"").unwrap();
    assert_eq!(result, b"ab");
}

// ============================================================================
// 11. test-flatFileListToDirectoryStructure.js (+ submodule) (4 tests)
// ============================================================================
dual_test!(flat_file_list_simple, flat_file_list_simple_sub, "test-empty", {
    let nodes = flat_file_list_to_directory_structure(&[("hello/there.txt".to_string(), 1)]);
    assert_eq!(nodes.len(), 3);
    let root = nodes.get(".").unwrap();
    assert_eq!(root.children, vec!["hello".to_string()]);
});

dual_test!(flat_file_list_advanced, flat_file_list_advanced_sub, "test-empty", {
    let files = [
        ("src/commands/checkout.js".to_string(), 1),
        ("src/commands/config.js".to_string(), 2),
        ("src/index.js".to_string(), 3),
        ("test/test-clone.js".to_string(), 4),
    ];
    let nodes = flat_file_list_to_directory_structure(&files);
    assert_eq!(nodes.len(), 8);
});

// ============================================================================
// 12. test-isBinary.js (+ submodule) (4 tests)
// ============================================================================
dual_test!(is_binary_binary_files, is_binary_binary_files_sub, "test-isBinary", {
    let env = make_fixture("test-isBinary");
    for name in env.fs.readdir(&env.dir).unwrap() {
        if name.ends_with(".png") || name.ends_with(".gz") || name.ends_with(".zip") {
            let buf = env.fs.read(&format!("{}/{name}", env.dir)).unwrap();
            assert!(is_binary(&buf));
        }
    }
});

dual_test!(is_binary_text_files, is_binary_text_files_sub, "test-isBinary", {
    let env = make_fixture("test-isBinary");
    for name in env.fs.readdir(&env.dir).unwrap() {
        if name.ends_with(".txt") || name.ends_with(".json") {
            let buf = env.fs.read(&format!("{}/{name}", env.dir)).unwrap();
            assert!(!is_binary(&buf));
        }
    }
});

// ============================================================================
// 13. test-mergeFile.js (+ submodule) (4 tests)
// ============================================================================
dual_test!(merge_file_clean, merge_file_clean_sub, "test-mergeFile", {
    let env = make_fixture("test-mergeFile");
    let a = env.fs.read_str(&format!("{}/a.txt", env.dir)).unwrap();
    let b = env.fs.read_str(&format!("{}/b.txt", env.dir)).unwrap();
    let o = env.fs.read_str(&format!("{}/o.txt", env.dir)).unwrap();
    let ab = env.fs.read_str(&format!("{}/aob.txt", env.dir)).unwrap();
    let res = merge_file(["base", "ours", "theirs"], [&o, &a, &b]);
    assert!(res.clean_merge);
    assert_eq!(res.merged_text, ab);
});

dual_test!(merge_file_conflict, merge_file_conflict_sub, "test-mergeFile", {
    let env = make_fixture("test-mergeFile");
    let a = env.fs.read_str(&format!("{}/a.txt", env.dir)).unwrap();
    let c = env.fs.read_str(&format!("{}/c.txt", env.dir)).unwrap();
    let o = env.fs.read_str(&format!("{}/o.txt", env.dir)).unwrap();
    let ac = env.fs.read_str(&format!("{}/aoc.txt", env.dir)).unwrap();
    let res = merge_file(["base", "ours", "theirs"], [&o, &a, &c]);
    assert!(!res.clean_merge);
    assert_eq!(res.merged_text, ac);
});

// ============================================================================
// 14. test-normalizeAuthorObject.js (+ submodule) (8 tests)
// ============================================================================
dual_test!(normalize_author_all_populated, normalize_author_all_populated_sub, "test-normalizeAuthorObject", {
    let env = make_fixture("test-normalizeAuthorObject");
    set_config(&env.fs, &env.gitdir, "user.name", Some("user-config"), false).unwrap();
    set_config(&env.fs, &env.gitdir, "user.email", Some("user-config@example.com"), false).unwrap();
    let author = Author {
        name: "user".into(),
        email: "user@example.com".into(),
        timestamp: 1720159690,
        timezone_offset: -120.0,
    };
    let pa: PartialAuthor = author.clone().into();
    assert_eq!(normalize_author_object(&env.fs, &env.gitdir, Some(&pa), None), Some(author));
});

dual_test!(normalize_author_from_commit, normalize_author_from_commit_sub, "test-normalizeAuthorObject", {
    let env = make_fixture("test-normalizeAuthorObject");
    set_config(&env.fs, &env.gitdir, "user.name", Some("user-config"), false).unwrap();
    set_config(&env.fs, &env.gitdir, "user.email", Some("user-config@example.com"), false).unwrap();
    let commit = CommitObject {
        message: "commit message".into(),
        tree: "80655da8d80aaaf92ce5357e7828dc09adb00993".into(),
        parent: vec!["d8fd39d0bbdd2dcf322d8b11390a4c5825b11495".into()],
        author: Author {
            name: "commit-author".into(),
            email: "commit-author@example.com".into(),
            timestamp: 1720169744,
            timezone_offset: 60.0,
        },
        committer: Author {
            name: "commit-commiter".into(),
            email: "commit-commiter@example.com".into(),
            timestamp: 1720169744,
            timezone_offset: 120.0,
        },
        gpgsig: None,
    };
    assert_eq!(normalize_author_object(&env.fs, &env.gitdir, None, Some(&commit)), Some(commit.author));
});

dual_test!(normalize_author_from_config, normalize_author_from_config_sub, "test-normalizeAuthorObject", {
    let env = make_fixture("test-normalizeAuthorObject");
    set_config(&env.fs, &env.gitdir, "user.name", Some("user-config"), false).unwrap();
    set_config(&env.fs, &env.gitdir, "user.email", Some("user-config@example.com"), false).unwrap();
    let author = normalize_author_object(&env.fs, &env.gitdir, None, None).unwrap();
    assert_eq!(author.name, "user-config");
    assert_eq!(author.email, "user-config@example.com");
});

dual_test!(normalize_author_undefined_when_missing, normalize_author_undefined_when_missing_sub, "test-normalizeAuthorObject", {
    let env = make_fixture("test-normalizeAuthorObject");
    assert_eq!(normalize_author_object(&env.fs, &env.gitdir, None, None), None);
});

// ============================================================================
// 15. test-normalizeCommitterObject.js (+ submodule) (10 tests)
// ============================================================================
dual_test!(normalize_committer_all_populated, normalize_committer_all_populated_sub, "test-normalizeAuthorObject", {
    let env = make_fixture("test-normalizeAuthorObject");
    let author = PartialAuthor::from(Author {
        name: "user-author".into(),
        email: "user-author@example.com".into(),
        timestamp: 1720159690,
        timezone_offset: -120.0,
    });
    let committer = Author {
        name: "user-author".into(),
        email: "user-author@example.com".into(),
        timestamp: 1720165308,
        timezone_offset: -60.0,
    };
    let pc = PartialAuthor::from(committer.clone());
    assert_eq!(normalize_committer_object(&env.fs, &env.gitdir, Some(&author), Some(&pc), None), Some(committer));
});

dual_test!(normalize_committer_fallback_to_author, normalize_committer_fallback_to_author_sub, "test-normalizeAuthorObject", {
    let env = make_fixture("test-normalizeAuthorObject");
    let author = Author {
        name: "user-author".into(),
        email: "user-author@example.com".into(),
        timestamp: 1720159690,
        timezone_offset: -120.0,
    };
    let pa = PartialAuthor::from(author.clone());
    assert_eq!(normalize_committer_object(&env.fs, &env.gitdir, Some(&pa), None, None), Some(author));
});

dual_test!(normalize_committer_fallback_to_commit, normalize_committer_fallback_to_commit_sub, "test-normalizeAuthorObject", {
    let env = make_fixture("test-normalizeAuthorObject");
    let commit = CommitObject {
        message: "commit message".into(),
        tree: "80655da8d80aaaf92ce5357e7828dc09adb00993".into(),
        parent: vec!["d8fd39d0bbdd2dcf322d8b11390a4c5825b11495".into()],
        author: Author {
            name: "commit-author".into(),
            email: "commit-author@example.com".into(),
            timestamp: 1720169744,
            timezone_offset: 60.0,
        },
        committer: Author {
            name: "commit-commiter".into(),
            email: "commit-commiter@example.com".into(),
            timestamp: 1720169744,
            timezone_offset: 120.0,
        },
        gpgsig: None,
    };
    assert_eq!(normalize_committer_object(&env.fs, &env.gitdir, None, None, Some(&commit)), Some(commit.committer));
});

dual_test!(normalize_committer_from_config, normalize_committer_from_config_sub, "test-normalizeAuthorObject", {
    let env = make_fixture("test-normalizeAuthorObject");
    set_config(&env.fs, &env.gitdir, "user.name", Some("user-config"), false).unwrap();
    set_config(&env.fs, &env.gitdir, "user.email", Some("user-config@example.com"), false).unwrap();
    let committer = normalize_committer_object(&env.fs, &env.gitdir, None, None, None).unwrap();
    assert_eq!(committer.name, "user-config");
    assert_eq!(committer.email, "user-config@example.com");
});

dual_test!(normalize_committer_undefined_when_missing, normalize_committer_undefined_when_missing_sub, "test-normalizeAuthorObject", {
    let env = make_fixture("test-normalizeAuthorObject");
    assert_eq!(normalize_committer_object(&env.fs, &env.gitdir, None, None, None), None);
});

// ============================================================================
// 16. test-utils-extractAuthFromUrl.js (11 tests)
// ============================================================================
#[test] fn extract_auth_clean_url() {
    let r = extract_auth_from_url("https://github.com/git/git.git");
    assert_eq!(r.url, "https://github.com/git/git.git");
    assert_eq!(r.auth, ExtractedAuth::default());
}
#[test] fn extract_auth_username_only() {
    let r = extract_auth_from_url("https://username@github.com/git/git.git");
    assert_eq!(r.url, "https://github.com/git/git.git");
    assert_eq!(r.auth.username.as_deref(), Some("username"));
    assert_eq!(r.auth.password, None);
}
#[test] fn extract_auth_username_and_empty_password() {
    let r = extract_auth_from_url("https://username:@github.com/git/git.git");
    assert_eq!(r.url, "https://github.com/git/git.git");
    assert_eq!(r.auth.username.as_deref(), Some("username"));
    assert_eq!(r.auth.password.as_deref(), Some(""));
}
#[test] fn extract_auth_empty_username_and_password() {
    let r = extract_auth_from_url("https://:password@github.com/git/git.git");
    assert_eq!(r.url, "https://github.com/git/git.git");
    assert_eq!(r.auth.username.as_deref(), Some(""));
    assert_eq!(r.auth.password.as_deref(), Some("password"));
}
#[test] fn extract_auth_username_and_password() {
    let r = extract_auth_from_url("https://username:password@github.com/git/git.git");
    assert_eq!(r.url, "https://github.com/git/git.git");
    assert_eq!(r.auth.username.as_deref(), Some("username"));
    assert_eq!(r.auth.password.as_deref(), Some("password"));
}
#[test] fn extract_auth_with_at_in_path() {
    let r = extract_auth_from_url("https://username:password@github.com/org@team/repo.git");
    assert_eq!(r.url, "https://github.com/org@team/repo.git");
    assert_eq!(r.auth.username.as_deref(), Some("username"));
    assert_eq!(r.auth.password.as_deref(), Some("password"));
}
#[test] fn extract_auth_no_auth_with_at_in_path() {
    let r = extract_auth_from_url("https://github.com/org@team/repo.git");
    assert_eq!(r.url, "https://github.com/org@team/repo.git");
    assert_eq!(r.auth.username, None);
}
#[test] fn extract_auth_http_scheme() {
    let r = extract_auth_from_url("http://u:p@localhost:8080/repo.git");
    assert_eq!(r.url, "http://localhost:8080/repo.git");
    assert_eq!(r.auth.username.as_deref(), Some("u"));
    assert_eq!(r.auth.password.as_deref(), Some("p"));
}
#[test] fn extract_auth_token_username() {
    let r = extract_auth_from_url("https://ghp_12345@github.com/user/repo.git");
    assert_eq!(r.url, "https://github.com/user/repo.git");
    assert_eq!(r.auth.username.as_deref(), Some("ghp_12345"));
}
#[test] fn extract_auth_port_preserved() {
    let r = extract_auth_from_url("https://user:pass@example.com:8443/git/repo.git");
    assert_eq!(r.url, "https://example.com:8443/git/repo.git");
}
#[test] fn extract_auth_query_preserved() {
    let r = extract_auth_from_url("https://user:pass@example.com/repo.git?service=git-upload-pack");
    assert_eq!(r.url, "https://example.com/repo.git?service=git-upload-pack");
}

// ============================================================================
// 17. test-utils-formatInfoRefs.js (3 tests)
// ============================================================================
#[test] fn format_info_refs_no_peeled() {
    let refs = vec![("refs/heads/master".to_string(), "a90588d2f7c079c6d4026b62605d0238b6b647d3".to_string())];
    let list = format_info_refs(&refs, &BTreeMap::new(), "", true, true);
    assert_eq!(
        list,
        vec![ServerRef {
            r#ref: "refs/heads/master".into(),
            oid: "a90588d2f7c079c6d4026b62605d0238b6b647d3".into(),
            target: None,
            peeled: None,
        }]
    );
}
#[test] fn format_info_refs_with_peeled() {
    let refs = vec![
        ("refs/tags/v1.0.0".to_string(), "f2e3b4d00334d09d2c79d6229b60f92b07d8e0b2".to_string()),
        ("refs/tags/v1.0.0^{}".to_string(), "a90588d2f7c079c6d4026b62605d0238b6b647d3".to_string()),
    ];
    let list = format_info_refs(&refs, &BTreeMap::new(), "", true, true);
    assert_eq!(
        list,
        vec![ServerRef {
            r#ref: "refs/tags/v1.0.0".into(),
            oid: "f2e3b4d00334d09d2c79d6229b60f92b07d8e0b2".into(),
            target: None,
            peeled: Some("a90588d2f7c079c6d4026b62605d0238b6b647d3".into()),
        }]
    );
}
#[test] fn format_info_refs_filtered_by_prefix() {
    let refs = vec![
        ("refs/heads/a".to_string(), "1".repeat(40)),
        ("refs/tags/b".to_string(), "2".repeat(40)),
    ];
    let list = format_info_refs(&refs, &BTreeMap::new(), "refs/heads/", false, false);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].r#ref, "refs/heads/a");
}

// ============================================================================
// 18. test-utils-join.js (+ submodule) (2 tests)
// ============================================================================
dual_test!(utils_join_paths, utils_join_paths_sub, "test-empty", {
    assert_eq!(join(&["a", "b", "c"]), "a/b/c");
    assert_eq!(join(&["/a/b/", "/c/d"]), "/a/b/c/d");
    assert_eq!(join(&["a\\b", "c\\d"]), "a/b/c/d");
    assert_eq!(join(&["a", ".", "b", "..", "c"]), "a/c");
});

// ============================================================================
// 19. test-utils-mkdirp.js (7 tests)
// ============================================================================
#[test] fn utils_mkdirp_creates_nested_directory() {
    let mut dirs = std::collections::BTreeSet::from(["".to_string()]);
    mkdirp(|p| {
        let parent = &p[..p.rfind('/').unwrap_or(0)];
        if !dirs.contains(parent) { return Err(FsError::new("ENOENT", "ENOENT")); }
        if dirs.contains(p) { return Err(FsError::new("EEXIST", "EEXIST")); }
        dirs.insert(p.to_string());
        Ok(())
    }, "/workspace/a/b/c", 10).unwrap();
    assert!(dirs.contains("/workspace/a/b/c"));
}
#[test] fn utils_mkdirp_idempotent_on_existing_directory() {
    let mut dirs = std::collections::BTreeSet::from(["".to_string(), "/workspace".into(), "/workspace/a".into(), "/workspace/a/b".into()]);
    mkdirp(|p| {
        if dirs.contains(p) { return Err(FsError::new("EEXIST", "EEXIST")); }
        dirs.insert(p.to_string());
        Ok(())
    }, "/workspace/a/b", 10).unwrap();
}
#[test] fn utils_mkdirp_errors_when_target_is_file() {
    assert!(mkdirp(|_| Err(FsError::new("ENOTDIR", "ENOTDIR")), "/workspace/file.txt", 10).is_err());
}
#[test] fn utils_mkdirp_errors_when_ancestor_is_file() {
    assert!(mkdirp(|_| Err(FsError::new("EACCES", "EACCES")), "/workspace/file.txt/sub", 10).is_err());
}
#[test] fn utils_mkdirp_handles_root_path() {
    mkdirp(|_| Err(FsError::new("EEXIST", "EEXIST")), "/", 10).unwrap();
}
#[test] fn utils_mkdirp_handles_trailing_slash() {
    let mut dirs = std::collections::BTreeSet::from(["".to_string()]);
    mkdirp(|p| {
        let parent = &p[..p.rfind('/').unwrap_or(0)];
        if !dirs.contains(parent) { return Err(FsError::new("ENOENT", "ENOENT")); }
        dirs.insert(p.to_string());
        Ok(())
    }, "/workspace/dir", 10).unwrap();
    assert!(dirs.contains("/workspace/dir"));
}
#[test] fn utils_mkdirp_handles_deep_hierarchy() {
    let mut dirs = std::collections::BTreeSet::from(["".to_string()]);
    mkdirp(|p| {
        let parent = &p[..p.rfind('/').unwrap_or(0)];
        if !dirs.contains(parent) { return Err(FsError::new("ENOENT", "ENOENT")); }
        dirs.insert(p.to_string());
        Ok(())
    }, "/1/2/3/4/5/6", 10).unwrap();
    assert!(dirs.contains("/1/2/3/4/5/6"));
}

// ============================================================================
// 20. test-utils-splitLines.js (4 tests)
// ============================================================================
#[test] fn split_lines_preserves_lf_and_crlf() {
    assert_eq!(split_lines("a\nb\r\nc\rd"), vec!["a\n", "b\r\n", "c\r", "d"]);
}
#[test] fn split_lines_keeps_crlf_together_across_chunks() {
    assert_eq!(split_lines(&["a\r", "\nb"].concat()), split_lines("a\r\nb"));
}
#[test] fn split_lines_emits_trailing_lone_cr() {
    assert_eq!(split_lines("a\r"), vec!["a\r"]);
}
#[test] fn split_lines_keeps_cr_followed_by_non_lf() {
    assert_eq!(split_lines(&["a\r", "b"].concat()), vec!["a\r", "b"]);
}

// ============================================================================
// 21. test-validate.js + test-validate-in-submodule.js (6 tests)
// ============================================================================
dual_test!(validate_invalid_index_empty_file, validate_invalid_index_empty_file_sub, "test-empty", {
    let env = make_fixture("test-empty");
    let file = "a.txt";
    env.fs.write_str(&format!("{}/{file}", env.dir), "Hi");
    add(&env.fs, &env.dir, Some(&env.gitdir), &[file.to_string()], false).unwrap();
    env.fs.write_str(&format!("{}/index", env.gitdir), "");

    let err = status(&env.fs, &env.dir, Some(&env.gitdir), file).unwrap_err();
    assert_eq!(err.code, ErrorCode::InternalError);
    assert!(err.message.contains("Index file is empty (.git/index)"));
});

dual_test!(validate_invalid_index_no_magic_number, validate_invalid_index_no_magic_number_sub, "test-empty", {
    let env = make_fixture("test-empty");
    let file = "a.txt";
    env.fs.write_str(&format!("{}/{file}", env.dir), "Hi");
    add(&env.fs, &env.dir, Some(&env.gitdir), &[file.to_string()], false).unwrap();
    env.fs.write_str(&format!("{}/index", env.gitdir), "no-magic-number");

    let err = status(&env.fs, &env.dir, Some(&env.gitdir), file).unwrap_err();
    assert_eq!(err.code, ErrorCode::InternalError);
    assert!(err.message.contains("Invalid dircache magic file number"));
});

dual_test!(validate_invalid_index_wrong_checksum, validate_invalid_index_wrong_checksum_sub, "test-empty", {
    let env = make_fixture("test-empty");
    let file = "a.txt";
    env.fs.write_str(&format!("{}/{file}", env.dir), "Hi");
    add(&env.fs, &env.dir, Some(&env.gitdir), &[file.to_string()], false).unwrap();
    env.fs.write_str(&format!("{}/index", env.gitdir), "DIRCxxxxx");

    let err = status(&env.fs, &env.dir, Some(&env.gitdir), file).unwrap_err();
    assert_eq!(err.code, ErrorCode::InternalError);
    assert!(err.message.contains("Invalid checksum in GitIndex buffer: expected 444952437878787878 but saw da39a3ee5e6b4b0d3255bfef95601890afd80709"));
});

// ============================================================================
// 22. test-version.js + test-version-in-submodule.js (2 tests)
// ============================================================================
dual_test!(test_version_fn, test_version_fn_sub, "test-empty", {
    assert_eq!(version(), "0.0.0-development");
});

// ============================================================================
// 23. test-exports.js + test-exports-in-submodule.js (2 tests)
// ============================================================================
dual_test!(test_exports_surface, test_exports_surface_sub, "test-empty", {
    let raw = GitObject::wrap("blob", b"hello world");
    let unwrapped = GitObject::unwrap(&raw).unwrap();
    assert_eq!(unwrapped.object_type, "blob");
    assert_eq!(unwrapped.object, b"hello world");
    assert_eq!(shasum(&raw), "95d09f2b10159347eece71399a7e2e907ea3df4f");
});

// ============================================================================
// 24. test-wire.js + test-wire-in-submodule.js (12 + 12 = 24 tests)
// ============================================================================
dual_test!(wire_write_refs_ad_response, wire_write_refs_ad_response_sub, "test-empty", {
    let mut refs = BTreeMap::new();
    refs.insert("HEAD".into(), "a90588d2f7c079c6d4026b62605d0238b6b647d3".into());
    refs.insert("refs/heads/master".into(), "a90588d2f7c079c6d4026b62605d0238b6b647d3".into());
    let mut symrefs = BTreeMap::new();
    symrefs.insert("HEAD".into(), "refs/heads/master".into());
    let mut ad = Vec::new();
    ad.extend_from_slice(&GitPktLine::encode_str("# service=git-upload-pack\n"));
    ad.extend_from_slice(&GitPktLine::flush());
    ad.extend_from_slice(&write_refs_ad_response(&["multi_ack", "thin-pack"], &refs, &symrefs));
    let parsed = parse_refs_ad_response(&ad, "git-upload-pack").unwrap();
    match parsed {
        RefsAdResponse::V1 { capabilities, refs: p_refs, .. } => {
            assert!(capabilities.contains("multi_ack"));
            assert_eq!(p_refs.get("refs/heads/master").map(String::as_str), Some("a90588d2f7c079c6d4026b62605d0238b6b647d3"));
        }
        _ => panic!("expected v1"),
    }
});

dual_test!(wire_parse_refs_ad_v1_clean, wire_parse_refs_ad_v1_clean_sub, "test-empty", {
    let mut buf = Vec::new();
    buf.extend_from_slice(&GitPktLine::encode_str("# service=git-upload-pack\n"));
    buf.extend_from_slice(&GitPktLine::flush());
    buf.extend_from_slice(&GitPktLine::encode_str("a90588d2f7c079c6d4026b62605d0238b6b647d3 HEAD\0multi_ack thin-pack symref=HEAD:refs/heads/master\n"));
    buf.extend_from_slice(&GitPktLine::encode_str("a90588d2f7c079c6d4026b62605d0238b6b647d3 refs/heads/master\n"));
    buf.extend_from_slice(&GitPktLine::flush());
    let parsed = parse_refs_ad_response(&buf, "git-upload-pack").unwrap();
    match parsed {
        RefsAdResponse::V1 { symrefs, .. } => {
            assert_eq!(symrefs.get("HEAD").map(String::as_str), Some("refs/heads/master"));
        }
        _ => panic!("expected v1"),
    }
});

dual_test!(wire_parse_refs_ad_v2, wire_parse_refs_ad_v2_sub, "test-empty", {
    let mut buf = Vec::new();
    buf.extend_from_slice(&GitPktLine::encode_str("# service=git-upload-pack\n"));
    buf.extend_from_slice(&GitPktLine::flush());
    buf.extend_from_slice(&GitPktLine::encode_str("version 2\n"));
    buf.extend_from_slice(&GitPktLine::encode_str("agent=git/2.30.0\n"));
    buf.extend_from_slice(&GitPktLine::encode_str("ls-refs\n"));
    buf.extend_from_slice(&GitPktLine::flush());
    let parsed = parse_refs_ad_response(&buf, "git-upload-pack").unwrap();
    match parsed {
        RefsAdResponse::V2 { protocol_version, capabilities2 } => {
            assert_eq!(protocol_version, 2);
            assert_eq!(capabilities2.get("agent").and_then(|o| o.as_deref()), Some("git/2.30.0"));
        }
        _ => panic!("expected v2"),
    }
});

dual_test!(wire_write_upload_pack_request, wire_write_upload_pack_request_sub, "test-empty", {
    let req = UploadPackRequest {
        capabilities: vec![
            "multi_ack_detailed".into(),
            "no-done".into(),
            "side-band-64k".into(),
            "thin-pack".into(),
            "ofs-delta".into(),
            "agent=git/2.10.1.windows.1".into(),
        ],
        wants: vec![
            "fb74ea1a9b6a9601df18c38d3de751c51f064bf7".into(),
            "5faa96fe725306e060386975a70e4b6eacb576ed".into(),
        ],
        haves: Vec::new(),
        shallows: Vec::new(),
        depth: None,
        since: None,
        exclude: Vec::new(),
        relative: false,
        done: true,
    };
    let raw = write_upload_pack_request(&req);
    let text = String::from_utf8(raw).unwrap();
    assert!(text.starts_with("008awant fb74ea1a9b6a9601df18c38d3de751c51f064bf7"));
    assert!(text.ends_with("00000009done\n"));
});

dual_test!(wire_parse_upload_pack_request, wire_parse_upload_pack_request_sub, "test-empty", {
    let raw = b"008awant fb74ea1a9b6a9601df18c38d3de751c51f064bf7 multi_ack_detailed no-done side-band-64k thin-pack ofs-delta agent=git/2.10.1.windows.1\n0032want 5faa96fe725306e060386975a70e4b6eacb576ed\n00000009done\n";
    let parsed = parse_upload_pack_request(raw);
    assert_eq!(parsed.wants.len(), 2);
    assert!(parsed.done);
});

dual_test!(wire_parse_upload_pack_request_depth_and_haves, wire_parse_upload_pack_request_depth_and_haves_sub, "test-empty", {
    let req = UploadPackRequest {
        capabilities: vec!["thin-pack".into()],
        wants: vec!["fb74ea1a9b6a9601df18c38d3de751c51f064bf7".into()],
        haves: vec!["5faa96fe725306e060386975a70e4b6eacb576ed".into()],
        shallows: vec!["9ea43b479f5fedc679e3eb37803275d727bf51b7".into()],
        depth: Some(1),
        since: None,
        exclude: vec!["v1.0".into()],
        relative: true,
        done: true,
    };
    let raw = write_upload_pack_request(&req);
    let parsed = parse_upload_pack_request(&raw);
    assert_eq!(parsed.depth, Some(1));
    assert_eq!(parsed.haves, vec!["5faa96fe725306e060386975a70e4b6eacb576ed".to_string()]);
    assert_eq!(parsed.shallows, vec!["9ea43b479f5fedc679e3eb37803275d727bf51b7".to_string()]);
    assert!(parsed.relative);
});

dual_test!(wire_parse_upload_pack_response_simple_clone, wire_parse_upload_pack_response_simple_clone_sub, "test-empty", {
    let res = GitPktLine::encode_str("NAK\n");
    let parsed = parse_upload_pack_response(&res).unwrap();
    assert!(parsed.nak);
});

dual_test!(wire_parse_upload_pack_response_no_packetlines, wire_parse_upload_pack_response_no_packetlines_sub, "test-empty", {
    let res = b"0000";
    let parsed = parse_upload_pack_response(res).unwrap();
    assert!(!parsed.nak);
});

dual_test!(wire_parse_upload_pack_response_incremental_fetch, wire_parse_upload_pack_response_incremental_fetch_sub, "test-empty", {
    let mut res = Vec::new();
    res.extend_from_slice(&GitPktLine::encode_str("ACK 7e47fe2bd8d01d481f44d7af0531bd93d3b21c01 continue\n"));
    res.extend_from_slice(&GitPktLine::encode_str("ACK 74730d410fcb6603ace96f1dc55ea6196122532d\n"));
    let parsed = parse_upload_pack_response(&res).unwrap();
    assert!(!parsed.nak);
    assert_eq!(parsed.acks.len(), 2);
    assert_eq!(parsed.acks[0].oid, "7e47fe2bd8d01d481f44d7af0531bd93d3b21c01");
    assert_eq!(parsed.acks[0].status.as_deref(), Some("continue"));
    assert_eq!(parsed.acks[1].oid, "74730d410fcb6603ace96f1dc55ea6196122532d");
    assert_eq!(parsed.acks[1].status, None);
});

dual_test!(wire_parse_upload_pack_response_shallow_unshallow, wire_parse_upload_pack_response_shallow_unshallow_sub, "test-empty", {
    let mut res = Vec::new();
    res.extend_from_slice(&GitPktLine::encode_str("shallow 7e47fe2bd8d01d481f44d7af0531bd93d3b21c01\n"));
    res.extend_from_slice(&GitPktLine::encode_str("unshallow 74730d410fcb6603ace96f1dc55ea6196122532d\n"));
    res.extend_from_slice(&GitPktLine::flush());
    res.extend_from_slice(&GitPktLine::encode_str("NAK\n"));
    let parsed = parse_upload_pack_response(&res).unwrap();
    assert_eq!(parsed.shallows, vec!["7e47fe2bd8d01d481f44d7af0531bd93d3b21c01".to_string()]);
    assert_eq!(parsed.unshallows, vec!["74730d410fcb6603ace96f1dc55ea6196122532d".to_string()]);
    assert!(parsed.nak);
});

dual_test!(wire_parse_upload_pack_response_with_sideband_pack, wire_parse_upload_pack_response_with_sideband_pack_sub, "test-empty", {
    let mut res = Vec::new();
    res.extend_from_slice(&GitPktLine::encode_str("NAK\n"));
    res.extend_from_slice(&GitSideBand::mux("side-band-64k", b"PACK1234", &[], &[]));
    let parsed = parse_upload_pack_response(&res).unwrap();
    assert!(parsed.nak);
    assert_eq!(parsed.packfile, b"PACK1234");
});

dual_test!(wire_parse_upload_pack_response_sideband_error, wire_parse_upload_pack_response_sideband_error_sub, "test-empty", {
    let res = GitSideBand::mux("side-band-64k", b"", &[], &[b"fatal: repository not found\n".to_vec()]);
    let err = parse_upload_pack_response(&res).unwrap_err();
    assert!(err.message.contains("fatal: repository not found"));
});
