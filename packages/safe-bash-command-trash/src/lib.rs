//! Trash commands use a provider's atomic operation. No copy/delete fallback.

pub struct Item {
    pub name: String,
    pub path: String,
    pub deletion_date: String,
}

/// Providers must atomically commit payload and metadata, preserve identity and
/// authorization, reject trashing the trash, and restore without replacement.
pub trait TrashBackend: Send + Sync {
    fn put(&self, path: &str) -> Result<(), String>;
    fn list(&self) -> Result<Vec<Item>, String>;
    fn restore(&self, item: &str) -> Result<(), String>;
}

pub struct Location<'a> {
    pub backend: &'a dyn TrashBackend,
    pub path: String,
}

pub fn run<'a>(
    command: &str,
    args: &[String],
    cwd: &str,
    locate: impl Fn(&str) -> Result<Option<Location<'a>>, String>,
) -> Result<String, String> {
    let args = args.strip_prefix(&["--".into()]).unwrap_or(args);
    match command {
        "trash-put" => {
            if args.is_empty() {
                return Err("missing operand".into());
            }
            if args.len() > 10_000 {
                return Err("too many operands".into());
            }
            for arg in args {
                if arg.is_empty() || arg.contains('\0') {
                    return Err("invalid path".into());
                }
                let path = if arg.starts_with('/') {
                    arg.clone()
                } else {
                    format!("{cwd}/{arg}")
                };
                let location = locate(&path)?.ok_or("ENOTSUP: atomic trash is unavailable")?;
                location.backend.put(&location.path)?;
            }
            Ok(String::new())
        }
        "trash-list" if args.is_empty() => {
            let location = locate(cwd)?.ok_or("ENOTSUP: atomic trash is unavailable")?;
            let mut output = String::new();
            for item in location.backend.list()? {
                output.push_str(&format!(
                    "{}\t{}\t{}\n",
                    item.name, item.deletion_date, item.path
                ));
                if output.len() > 16 * 1024 * 1024 {
                    return Err("trash listing exceeds output limit".into());
                }
            }
            Ok(output)
        }
        "trash-restore" if args.len() == 1 => {
            let location = locate(cwd)?.ok_or("ENOTSUP: atomic trash is unavailable")?;
            if args[0].is_empty()
                || args[0].contains(['/', '\0'])
                || matches!(args[0].as_str(), "." | "..")
            {
                return Err("invalid trash item".into());
            }
            location.backend.restore(&args[0])?;
            Ok(String::new())
        }
        _ => Err(format!(
            "usage: {command}{}",
            if command == "trash-restore" {
                " ITEM"
            } else {
                ""
            }
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    struct Backend(Mutex<Vec<String>>);
    impl TrashBackend for Backend {
        fn put(&self, path: &str) -> Result<(), String> {
            self.0.lock().unwrap().push(path.into());
            Ok(())
        }
        fn list(&self) -> Result<Vec<Item>, String> {
            Ok(vec![Item {
                name: "item".into(),
                path: "/a".into(),
                deletion_date: "2026-11-25T10:00:00".into(),
            }])
        }
        fn restore(&self, item: &str) -> Result<(), String> {
            self.0.lock().unwrap().push(item.into());
            Ok(())
        }
    }
    #[test]
    fn routes_operands_and_refuses_unsupported_or_invalid_restore() {
        let backend = Backend(Mutex::new(vec![]));
        let locate = |path: &str| {
            Ok(Some(Location {
                backend: &backend,
                path: path.into(),
            }))
        };
        run(
            "trash-put",
            &["note".into(), "/folder".into()],
            "/work",
            locate,
        )
        .unwrap();
        assert_eq!(*backend.0.lock().unwrap(), ["/work/note", "/folder"]);
        assert!(run("trash-put", &["a".into()], "/", |_| Ok(None)).is_err());
        assert!(run("trash-restore", &["../item".into()], "/", locate).is_err());
        assert!(
            run("trash-list", &[], "/", locate)
                .unwrap()
                .starts_with("item\t2026-11-25T10:00:00\t/a\n")
        );
        run("trash-restore", &["item".into()], "/", locate).unwrap();
    }
}
