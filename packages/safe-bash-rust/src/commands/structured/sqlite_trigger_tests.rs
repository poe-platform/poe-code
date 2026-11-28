use super::*;
use crate::vfs::MemoryVfs;

#[test]
fn sqlite_drop_trigger_preserves_names_and_removes_persisted_schema_entry() {
    let fs = MemoryVfs::new();
    for (sql, expected) in [
        (
            "CREATE TABLE t(v);CREATE TABLE audit(v);CREATE TRIGGER au AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(NEW.v);END;CREATE TRIGGER keep AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(99);END;",
            vec!["au", "keep"],
        ),
        ("DROP TRIGGER au;", vec!["keep"]),
        ("DROP TRIGGER keep;", vec![]),
    ] {
        let result = cmd_sqlite3(&["/db".into(), sql.into()], "", "/", &fs);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let bytes = fs.read_file("/db").unwrap();
        let rows = sqlite_parse_table_btree_rows(
            &bytes,
            sqlite_read_u16_be(&bytes, 16),
            1,
            &mut BTreeSet::new(),
        );
        let names: Vec<_> = rows
            .iter()
            .filter_map(|(_, row)| match (&row[0], &row[1], &row[2], &row[4]) {
                (
                    SqlBtreeVal::Text(kind),
                    SqlBtreeVal::Text(name),
                    SqlBtreeVal::Text(table),
                    SqlBtreeVal::Text(sql),
                ) if kind == "trigger" => {
                    assert_eq!(table, "t");
                    assert!(sql.contains(&format!("CREATE TRIGGER \"{name}\" ")));
                    Some(name.as_str())
                }
                _ => None,
            })
            .collect();
        assert_eq!(names, expected);
    }
}
