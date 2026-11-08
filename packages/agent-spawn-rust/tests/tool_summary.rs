use agent_spawn_rust::tool_summary::command;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn wrappers_and_read_only_pipelines_keep_meaning() {
    assert_eq!(
        command(&u("zsh -lc 'cd src && rg TODO . | head -20'")),
        u("Search TODO in . · src")
    );
    assert_eq!(command(&u("cat one; cat two")), u("Read one, two"));
    assert_eq!(
        command(&u("rg --files | sort -oout")),
        u("Run rg --files | sort -oout")
    );
}
#[test]
fn variables_remain_unexpanded_and_input_budget_is_utf16() {
    assert_eq!(command(&u("cat $HOME/file")), u("Read $HOME/file"));
    assert_eq!(command(&vec![97; 8193]), u("Run shell script"));
    assert_eq!(
        command(&[99, 97, 116, 32, 0xd800]),
        [u("Read "), vec![0xd800]].concat()
    );
}
