use super::{BTreeMap, IgnoreFile, RgFiles, RuleError, SafeBashFs};
use std::rc::Rc;

#[derive(Default, Clone)]
pub(super) struct Rules {
    files: Rc<Vec<Rc<IgnoreFile>>>,
    pub(super) repository: bool,
}

pub(super) fn read(fs: &dyn SafeBashFs, path: &str, base: &str, priority: u8) -> Result<IgnoreFile, RuleError> {
    let bytes = (|| {
        if fs.has_path_capabilities() { fs.access_path(path, true)?; }
        fs.read_file(path)
    })().map_err(|e| RuleError::Read(super::super::coreutils::stream_file_error(e, "readFile", path)))?;
    IgnoreFile::parse(String::from_utf8_lossy(&bytes).lines(), base, priority).map_err(RuleError::Pattern)
}

pub(super) struct Local {
    root: bool,
    files: Vec<Rc<IgnoreFile>>,
}

impl Rules {
    pub(super) fn add(&mut self, file: IgnoreFile) { Rc::make_mut(&mut self.files).push(Rc::new(file)); }

    pub(super) fn selected(&self, path: &str, directory: bool) -> Option<bool> {
        let mut selected = None;
        let mut priority = 0;
        for file in self.files.iter() {
            if file.priority >= priority && let Some(include) = file.include_within(path, directory) {
                selected = Some(include);
                priority = file.priority;
            }
        }
        selected
    }

    pub(super) fn load(&mut self, options: &RgFiles, fs: &dyn SafeBashFs, directory: &str, entries: Option<&[String]>,
        cache: &mut BTreeMap<(String, bool), Local>, errors: &mut Vec<String>) {
        let local = cache.entry((directory.to_owned(), self.repository)).or_insert_with(|| {
            let path = |name: &str| format!("{}/{name}", directory.trim_end_matches('/'));
            let present = |name: &str| entries.map(|names| names.binary_search_by(|s| s.as_str().cmp(name)).is_ok())
                .or_else(|| fs.indexed_directory_entry(&path(name)));
            let root = present(".git").unwrap_or_else(|| fs.inspect_command_entry(&path(".git"), false, "lstat").is_ok());
            let mut files = Vec::new();
            if options.respect_ignore {
                for (priority, name) in [(1, ".gitignore"), (2, ".ignore"), (3, ".rgignore")] {
                    if (priority == 1 && (options.no_ignore_vcs || options.require_git && !(self.repository || root)))
                        || (priority != 1 && options.no_ignore_dot) || present(name) == Some(false) { continue; }
                    match read(fs, &path(name), directory, priority) {
                        Ok(file) => files.push(Rc::new(file)),
                        Err(RuleError::Read(e)) if e.starts_with("ENOENT:") => {}
                        Err(e) => errors.push(e.message()),
                    }
                }
            }
            Local { root, files }
        });
        if local.root {
            self.repository = true;
            if self.files.iter().any(|f| f.priority == 1) { Rc::make_mut(&mut self.files).retain(|f| f.priority != 1); }
        }
        if !local.files.is_empty() { Rc::make_mut(&mut self.files).extend(local.files.iter().cloned()); }
    }
}
