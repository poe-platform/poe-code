use crate::vfs::path::{WalkPurpose, normalize_posix_path, walk_path};
use crate::vfs::{FileStat, SafeBashFs, VfsFileEntry};
use std::collections::BTreeMap;
use std::sync::Arc;

struct DirectoryMove {
    parent: FileStat,
    // Backing-store source and relative destination for each inspected child.
    children: Vec<(String, String)>,
}

#[derive(Clone)]
pub struct MountVfs {
    root: Arc<dyn SafeBashFs>,
    mounts: BTreeMap<String, Arc<dyn SafeBashFs>>,
}

impl MountVfs {
    pub fn new(root: Arc<dyn SafeBashFs>) -> Self {
        Self {
            root,
            mounts: BTreeMap::new(),
        }
    }

    pub fn with_mount(mut self, prefix: &str, fs: Arc<dyn SafeBashFs>) -> Self {
        self.mounts.insert(normalize_posix_path(prefix), fs);
        self
    }

    fn location(&self, norm: &str) -> (&str, &dyn SafeBashFs, String) {
        for (prefix, mounted) in self.mounts.iter().rev() {
            if prefix == "/" {
                continue;
            }
            if norm == prefix {
                return (prefix, mounted.as_ref(), "/".to_string());
            }
            if let Some(rest) = norm.strip_prefix(&format!("{prefix}/")) {
                return (prefix, mounted.as_ref(), format!("/{rest}"));
            }
        }
        ("/", self.root.as_ref(), norm.to_owned())
    }

    fn resolve(&self, path: &str, follow_final: bool, purpose: WalkPurpose) -> Result<String, String> {
        walk_path(path, follow_final, purpose, |p| {
            let (mount, fs, local) = self.location(p);
            (Some(mount), fs, local)
        }, |parent| self.mounts.keys().any(|m| m.strip_prefix(parent).is_some_and(|tail| tail.starts_with('/'))))
    }

    fn route(&self, path: &str, follow_final: bool) -> Result<(&dyn SafeBashFs, String), String> {
        let (_, fs, local) = self.location(&self.resolve(path, follow_final, WalkPurpose::AllowMissingParents)?);
        Ok((fs, local))
    }
    /// Inspect the same routed entries that will be published. The transfer
    /// checks the backing generations again under both namespace locks.
    fn inspect_directory_move(&self, source: &str, target: &str, budget: Option<&crate::ExecutionBudget>) -> Result<DirectoryMove, String> {
        use super::{VfsEntryKind::{Directory, Symlink}, dirname_posix_path, is_path_within};
        let admit = |path: &str| -> Result<(),String> {
            if let Some(b) = budget {
                b.check_cancelled()?;
                b.limits.check_path(path)?;
                b.tick_fs_op()?;
            }
            Ok(())
        };
        let inspect = |path: &str, follow| -> Result<Option<FileStat>,String> {
            admit(path)?;
            match self.inspect_command_entry(path,follow,if follow { "stat" } else { "lstat" }) {
                Ok((_,st)) => Ok(Some(st)),
                Err(e) if e.starts_with("ENOENT:") => Ok(None),
                Err(e) => Err(e),
            }
        };
        let list = |path: &str| {
            admit(path)?;
            self.list_dir(path).map_err(|e| format!("{}, readdir '{path}'", e.split_once(", ").map_or(e.as_str(),|(reason,_)| reason)))
        };
        let missing = |path: &str| format!("ENOENT: no such file or directory, lstat '{path}'");
        let root = inspect(source,false)?.ok_or_else(|| missing(source))?;
        let existing = inspect(target,false)?;
        let into_self = || format!("EINVAL: cannot move a directory into itself '{target}'");
        let same = |st: &FileStat| st.kind == Directory && root.identity.is_some() && st.identity == root.identity;
        if is_path_within(source,target) { return Err(into_self()); }
        let mut parent = dirname_posix_path(target);
        loop {
            let mut st = inspect(&parent,false)?;
            if st.as_ref().is_some_and(|s| s.kind == Symlink) { st = inspect(&parent,true)?; }
            if let Some(st) = st {
                if same(&st) { return Err(into_self()); }
                admit(&parent)?; // realpath
                if let Ok(mut canonical) = self.access_path(&parent,true) {
                    if is_path_within(source,&canonical) { return Err(into_self()); }
                    loop {
                        if inspect(&canonical,true)?.as_ref().is_some_and(same) { return Err(into_self()); }
                        if canonical == "/" { break; }
                        canonical = dirname_posix_path(&canonical);
                    }
                }
            }
            if parent == "/" { break; }
            parent = dirname_posix_path(&parent);
        }
        let source_entry = self.access_path(source,false)?;
        let source_mount = self.location(&source_entry).0;
        let target_entry = self.resolve(target,false,WalkPurpose::AllowMissingParents)?;
        let mut children = Vec::new();
        let mut pending = vec![(source.to_owned(),target.to_owned(),String::new())];
        let mut root_stats = Some((root,existing));
        let mut root_parent = None;
        while let Some((from,to,suffix)) = pending.pop() {
            let (st,existing) = match root_stats.take() {
                Some(pair) => pair,
                None => (inspect(&from,false)?.ok_or_else(|| missing(&from))?, inspect(&to,false)?),
            };
            if !suffix.is_empty() {
                let source_child = self.access_path(&from,false)?;
                let (mount, _, local) = self.location(&source_child);
                let target_child = self.resolve(&to,false,WalkPurpose::AllowMissingParents)?;
                if mount != source_mount || target_child != format!("{target_entry}{suffix}") {
                    return Err(format!("ENOTSUP: cannot bind cross-device directory entry '{from}' -> '{to}'"));
                }
                children.push((local,suffix.clone()));
            }
            if let Some(other) = existing {
                if st.identity.is_some() && st.identity == other.identity {
                    return Err(format!("EINVAL: move source and destination are aliases '{from}' -> '{to}'"));
                }
                if (st.kind == Directory) != (other.kind == Directory) {
                    let reason = if st.kind == Directory { "ENOTDIR: not a directory" } else { "EISDIR: illegal operation on a directory" };
                    return Err(format!("{reason} '{to}'"));
                }
                if st.kind == Directory && !list(&to)?.is_empty() { return Err(format!("ENOTEMPTY: directory not empty '{to}'")); }
            }
            if st.kind == Symlink { admit(&from)?; self.readlink(&from)?; }
            let dir = dirname_posix_path(&from);
            let parent = inspect(&dir,true)?.ok_or_else(|| missing(&dir))?;
            if from == source { root_parent = Some(parent); }
            if st.kind == Directory {
                let mut names = list(&from)?;
                names.sort_unstable_by(|a,b| a.encode_utf16().cmp(b.encode_utf16()));
                for name in names.into_iter().rev() {
                    pending.push((normalize_posix_path(&format!("{from}/{name}")), normalize_posix_path(&format!("{to}/{name}")), format!("{suffix}/{name}")));
                }
            }
        }
        Ok(DirectoryMove { parent: root_parent.expect("the plan starts at the source directory"), children })
    }

}

impl SafeBashFs for MountVfs {
    fn has_path_capabilities(&self) -> bool { true }

    fn access_path(&self, path: &str, follow_final: bool) -> Result<String, String> {
        self.resolve(path, follow_final, WalkPurpose::Access)
    }

    fn inspect_command_entry(&self, path: &str, follow: bool, syscall: &str) -> Result<(String, FileStat), String> {
        // The mount router reports traversal failures against the original request.
        let entry = self.resolve(path, follow, WalkPurpose::Access).map_err(|e| {
            let reason = if e.starts_with("EACCES:") { "EACCES: permission denied" }
                else if e.starts_with("ENOTDIR:") { "ENOTDIR: not a directory" }
                else if e.starts_with("ELOOP:") { "ELOOP: too many symbolic links encountered" }
                else if syscall == "capabilitiesFor" && e.starts_with("ENOENT:") { "ENOENT: no such file or directory" }
                else { return e };
            format!("{reason}, {syscall} '{path}'")
        })?;
        let (_, fs, local) = self.location(&entry);
        fs.lstat(&local).map(|st| (entry, st))
    }

    fn scratch_file(&self, directory: &str) -> Result<std::rc::Rc<dyn super::OpenRedirectFile>, String> {
        let (fs, local) = self.route(directory, true)?;
        fs.scratch_file(&local)
    }

    fn start_command_stream(&self, _path: &str, entry: &str, append: bool, exclusive: bool, mode: u32) -> Result<super::ChunkWriter<'_>, String> {
        let (_, fs, local) = self.location(entry);
        fs.start_command_stream(&local, &local, append, exclusive, mode)
    }

    fn supports_command_descriptor(&self, entry: &str) -> bool {
        let (_, fs, local) = self.location(entry);
        fs.supports_command_descriptor(&local)
    }

    fn open_exclusive_redirect(&self, path: &str, mode: u32) -> Result<Option<crate::vfs::ChunkWriter<'static>>, String> {
        if path == "/" || self.mounts.contains_key(path) {
            return Err(format!("EBUSY: resource busy or locked, open '{path}'"));
        }
        let (fs, local) = self.route(path, false)?;
        fs.open_exclusive_redirect(&local, mode)
    }

    fn open_redirect_file(&self, path: &str, access: crate::vfs::RedirectAccess, create_mode: Option<u32>) -> Result<Option<std::rc::Rc<dyn crate::vfs::OpenRedirectFile>>, String> {
        let exclusive = access == super::RedirectAccess::Exclusive;
        if exclusive && (path == "/" || self.mounts.contains_key(path)) {
            return Err(format!("EBUSY: resource busy or locked, open '{path}'"));
        }
        let (fs, local) = self.route(path, !exclusive)?;
        fs.open_redirect_file(&local, access, create_mode)
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let entry = self.access_path(path, true)?;
        let (_, fs, rel) = self.location(&entry);
        fs.read_file(&rel)
    }

    fn open_read_file(&self, path: &str, allow_directory: bool) -> Result<Box<dyn super::FileReadHandle>, String> {
        let (fs, entry) = self.route(path, true)?;
        fs.open_read_file(&entry, allow_directory)
    }

    fn open_chunks(&self, path: &str) -> Result<super::ChunkReader<'_>, String> {
        let (fs, path) = self.route(path, true)?;
        fs.open_chunks(&path)
    }

    fn open_chunks_sized(&self, path: &str, size: std::num::NonZeroUsize) -> Result<super::ChunkReader<'_>, String> {
        let (fs, path) = self.route(path, true)?;
        fs.open_chunks_sized(&path, size)
    }

    fn commit_file_edit(&self, path: &str, original: &FileStat, before: &[u8], after: &[u8], in_place: bool) -> Result<(), String> {
        let (_, fs, entry) = self.location(&self.resolve(path, false, WalkPurpose::Access)?);
        fs.commit_file_edit(&entry, original, before, after, in_place)
    }

    fn create_file(&self, path: &str, data: &[u8], mode: u32) -> Result<(), String> {
        let entry = self.resolve(path, false, WalkPurpose::Rename)?;
        if entry != path { return Err("EAGAIN: resolved entry changed".into()); }
        let (_, fs, rel) = self.location(&entry);
        fs.create_file(&rel, data, mode)
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.write_file(&rel, data)
    }

    fn append_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.append_file(&rel, data)
    }

    fn patch_revision(&self, path: &str) -> Result<(u64, u64), String> {
        let (_, fs, local) = self.location(path);
        fs.patch_revision(&local)
    }

    fn patch_file(&self, path: &str, bytes: Option<&[u8]>, expected: (u64, u64)) -> Result<u64, String> {
        // A patch never follows symlinks. Route the inspected lexical path, not a newly resolved alias.
        if self.mounts.keys().any(|mount| crate::vfs::is_path_within(path, mount)) {
            return Err("EBUSY: cannot patch a mount or its parent".into());
        }
        let (_, fs, local) = self.location(path);
        fs.patch_file(&local, bytes, expected)
    }

    fn replace_file_entry(&self, path: &str, data: &[u8], version: u64) -> Result<(), String> {
        let (fs, rel) = self.route(path, false)?;
        let local_version = fs.generation();
        if version != self.generation() { return Err("EAGAIN: filesystem changed before replacement".into()); }
        fs.replace_file_entry(&rel, data, local_version)
    }
    fn replace_file_entry_with_mode(&self, path: &str, data: &[u8], mode: u32, version: u64) -> Result<(), String> {
        let (fs, rel) = self.route(path, false)?;
        let local_version = fs.generation();
        if version != self.generation() { return Err("EAGAIN: filesystem changed before replacement".into()); }
        fs.replace_file_entry_with_mode(&rel, data, mode, local_version)
    }
    fn replace_file_entry_with_metadata(&self, path: &str, data: &[u8], mode: u32, times: (Option<f64>, Option<f64>), version: u64) -> Result<(), String> {
        let (fs, rel) = self.route(path, false)?;
        let local_version = fs.generation();
        if version != self.generation() { return Err("EAGAIN: filesystem changed before replacement".into()); }
        fs.replace_file_entry_with_metadata(&rel, data, mode, times, local_version)
    }

    fn publish_file(
        &self,
        path: &str,
        data: &[u8],
        inputs: &[String],
        version: u64,
    ) -> Result<u64, String> {
        let (fs, rel) = self.route(path, false)?;
        let inner_version = fs.generation();
        if version != self.generation() {
            return Err("EAGAIN: filesystem changed before publication".into());
        }
        let mut local_inputs = Vec::new();
        for input in inputs {
            let (source, local) = self.route(input, true)?;
            if std::ptr::addr_eq(source, fs) {
                local_inputs.push(local);
            }
        }
        fs.publish_file(&rel, data, &local_inputs, inner_version)
    }

    fn remove_unchanged_file(&self, path: &str, parent: &FileStat, expected: &FileStat) -> Result<(), String> {
        let (mount, fs, local) = self.location(path);
        if mount == path || local == "/" { return Err("EBUSY: cannot remove a mount".into()); }
        fs.remove_unchanged_file(&local, parent, expected)
    }

    fn remove_published(&self, path: &str, publication: u64) -> Result<bool, String> {
        let (fs, rel) = self.route(path, false)?;
        fs.remove_published(&rel, publication)
    }

    fn move_across_devices(&self, source: &str, destination: &str, budget: Option<&crate::ExecutionBudget>) -> Result<(), String> {
        // Bind path resolution to the two backing-store versions inspected under the transfer locks.
        let versions: BTreeMap<_, _> = std::iter::once(("/", self.root.generation()))
            .chain(self.mounts.iter().map(|(m, fs)| (m.as_str(), fs.generation()))).collect();
        // Rename has already established the terminal entry type, including
        // trailing slash requirements. A cross-device copy accepts terminal dots.
        let entry = |path: &str| {
            let trimmed = path.trim_end_matches('/');
            self.resolve(if trimmed.is_empty() && !path.is_empty() { "/" } else { trimmed }, false, WalkPurpose::Access)
        };
        let from = entry(source)?;
        let to = entry(destination)?;
        if self.mounts.keys().any(|m| [from.as_str(), to.as_str()].iter().any(|p| crate::vfs::is_path_within(p, m))) {
            return Err("EBUSY: resource busy or locked".into());
        }
        let (src_mount, src, src_path) = self.location(&from);
        let (dst_mount, dst, dst_path) = self.location(&to);
        let Some(src) = src.memory_backend() else { return Err(format!("ENOTSUP: operation not supported, removeEntryConditional '{source}'")); };
        let Some(dst) = dst.memory_backend() else { return Err(format!("ENOTSUP: operation not supported, mv '{destination}'")); };
        let plan = if src.lstat(&src_path)?.kind == super::VfsEntryKind::Directory {
            Some(self.inspect_directory_move(source,destination,budget)?)
        } else { None };
        let retained = src.transfer_to(dst, (&src_path, source, versions[src_mount]), (&dst_path, destination, versions[dst_mount]), plan.as_ref().map_or(&[][..], |p| &p.children), budget)?;
        if let (Some(plan), Some(expected)) = (plan, retained) {
            // Removing the children may have removed a component of the original operand.
            let version = src.generation();
            let entry = self.resolve(source,false,WalkPurpose::Access).map_err(|e|
                format!("{}, lstat '{source}'", e.split_once(", ").map_or(e.as_str(), |(reason,_)| reason)))?;
            if entry != from { return Err(format!("EBUSY: move source changed before removal '{source}'")); }
            src.remove_moved_directory(&src_path, &plan.parent, &expected, version)
                .map_err(|e| format!("{e}, removeEntryConditional '{source}'"))?;
        }
        Ok(())
    }

    fn rename(&self, source: &str, destination: &str, no_replace: bool) -> Result<(), String> {
        use super::VfsEntryKind::Directory;
        let protected = |p: &str| p == "/" || self.mounts.keys().any(|m| super::is_path_within(p, m));
        let reason = |e: String| match e.split_once(", ").map_or(e.as_str(), |(code, _)| code) {
            "EACCES: Permission denied" => "EACCES: permission denied".into(),
            "ELOOP: too many symbolic links" => "ELOOP: too many symbolic links encountered".into(),
            s => s.to_owned(),
        };
        let inspect = |path: &str, allow_missing: bool, missing_directory: bool| {
            // A trailing slash requires a directory but does not follow a final symlink.
            let trimmed = path.trim_end_matches('/');
            let entry = self.resolve(if trimmed.is_empty() && !path.is_empty() { "/" } else { trimmed }, false, WalkPurpose::Access).map_err(reason)?;
            let (mount, fs, local) = self.location(&entry);
            let directory = if protected(&entry) { true } else {
                match fs.lstat(&local) {
                    Ok(st) => {
                        if path.ends_with('/') && st.kind != Directory { return Err("ENOTDIR: not a directory".to_owned()); }
                        if path.ends_with('/') && st.mode & 0o100 == 0 { return Err("EACCES: permission denied".to_owned()); }
                        st.kind == Directory
                    }
                    Err(e) if allow_missing && e.starts_with("ENOENT:") && (!path.ends_with('/') || missing_directory) => false,
                    Err(e) => return Err(reason(e)),
                }
            };
            Ok((entry, mount, fs, local, directory))
        };
        let (from, mount, fs, src, directory) = inspect(source, false, false)?;
        let (to, other, _, dest, _) = inspect(destination, true, directory)?;
        if protected(&from) || protected(&to) { return Err("EBUSY: resource busy or locked".into()); }
        if mount != other { return Err("EXDEV: cross-device link not permitted".into()); }
        if [source, destination].iter().any(|p| matches!(p.trim_end_matches('/').rsplit('/').next(), Some("." | ".."))) {
            return Err("EINVAL: invalid argument".into());
        }
        fs.rename(&src, &dest, no_replace)
    }

    fn remove_one(&self, path: &str, directory: bool) -> Result<(), String> {
        let entry = self.resolve(path, false, WalkPurpose::Rename)?;
        if self.mounts.keys().any(|m| crate::vfs::is_path_within(&entry, m)) {
            return Err("EBUSY: resource busy or locked".into());
        }
        let (_, fs, mut local) = self.location(&entry);
        if path.ends_with('/') { local.push('/'); }
        fs.remove_one(&local, directory)
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let resolved = self.resolve(path, false, WalkPurpose::Rename)?;
        if self
            .mounts
            .keys()
            .any(|m| crate::vfs::is_path_within(&resolved, m))
        {
            return Err("EBUSY: cannot remove a mount or its parent".into());
        }
        let (_, fs, mut rel) = self.location(&resolved);
        if path.ends_with('/') { rel.push('/'); }
        fs.remove_path(&rel)
    }

    fn mkdir(&self, path: &str, recursive: bool, mode: u32) -> Result<(), (String, String)> {
        super::mkdir::mkdir(path, recursive, mode, super::mkdir::Namespace::Mounted, |p| {
            let (prefix, fs, local) = self.location(p);
            (Some(prefix), fs, local)
        })
    }

    fn mkdir_one(&self, path: &str, mode: u32) -> Result<(), String> {
        let p = self.resolve(path, false, WalkPurpose::Access)?;
        let (_, fs, local) = self.location(&p);
        fs.mkdir_one(&local, mode)
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.mkdir_all(&rel)
    }

    fn exists(&self, path: &str) -> bool {
        self.route(path, true)
            .is_ok_and(|(fs, rel)| fs.exists(&rel))
    }

    fn is_dir(&self, path: &str) -> bool {
        self.route(path, true)
            .is_ok_and(|(fs, rel)| fs.is_dir(&rel))
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let parent = self.resolve(path, true, WalkPurpose::AllowMissingParents)?;
        let (_, fs, rel) = self.location(&parent);
        let mut entries = fs.list_dir(&rel)?;
        for mount in self.mounts.keys() {
            if crate::vfs::parent_posix_path(mount).as_deref() == Some(&parent) {
                let name = crate::vfs::basename_posix_path(mount);
                if !entries.contains(&name) {
                    entries.push(name);
                }
            }
        }
        Ok(entries)
    }

    fn directory_entries(&self, path: &str, limit: usize) -> Result<Vec<(String, u32)>, String> {
        let parent = self.resolve(path, true, WalkPurpose::Access)?;
        let (_, fs, rel) = self.location(&parent);
        let mut entries = fs.directory_entries(&rel, limit)?;
        for mount in self.mounts.keys() {
            if let Some(suffix) = mount.strip_prefix(&format!("{}/", parent.trim_end_matches('/')))
                && let Some(name) = suffix.split('/').next() {
                if let Some((_, mode)) = entries.iter_mut().find(|(n, _)| n == name) { *mode = 0o040000; }
                else if entries.len() == limit { return Err("EFBIG: directory entry limit exceeded".into()); }
                else { entries.push((name.to_owned(), 0o040000)); }
            }
        }
        Ok(entries)
    }

    fn supports_hard_links(&self, path: &str) -> bool {
        self.route(path, false).is_ok_and(|(fs, local)| fs.supports_hard_links(&local))
    }

    fn hard_link(&self, source: &str, destination: &str) -> Result<(), String> {
        let from_path = self.access_path(source, false)?;
        let (mount, fs, from) = self.location(&from_path);
        fs.lstat(&from)?;
        let to_path = self.access_path(destination, false)?;
        if [&from_path, &to_path].into_iter().any(|p| p == "/" || self.mounts.keys().any(|m| super::is_path_within(p, m))) {
            return Err("EBUSY: resource busy or locked".into());
        }
        let (other, _, to) = self.location(&to_path);
        if mount != other { return Err("EXDEV: cross-device link not permitted".into()); }
        fs.hard_link(&from, &to)
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        let (fs, rel) = self.route(path, false)?;
        fs.symlink(target, &rel)
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let (fs, rel) = self.route(path, false)?;
        fs.readlink(&rel)
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        let (fs, rel) = self.route(path, true)?;
        fs.stat(&rel)
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        let (fs, rel) = self.route(path, false)?;
        fs.lstat(&rel)
    }

    fn prepare_chmod(&self, path: &str, ancestors: &[(&str,FileStat)]) -> Result<(),String> {
        let resolved = self.resolve(path,false,WalkPurpose::Access)?;
        let (_,fs,local) = self.location(&resolved);
        let st = fs.lstat(&local)?;
        if resolved == "/" || self.mounts.keys().any(|m| super::is_path_within(&resolved,m)) {
            return Err("EBUSY: resource busy or locked".into());
        }
        if resolved != path { return Err("EAGAIN: mount resolution changed".into()); }
        if st.mode & 0o170000 == 0o020000 || fs.memory_backend().is_none() { return Err("ENOTSUP: unsupported conditional chmod backend".into()); }
        for (p,receipt) in ancestors {
            let (_,fs,local) = self.location(p);
            let st = fs.lstat(&local)?;
            if receipt.identity.is_none() || st.identity.is_none() { return Err("ENOTSUP: missing directory identity".into()); }
            if st.identity != receipt.identity || st.kind != super::VfsEntryKind::Directory { return Err("EAGAIN: mounted directory changed".into()); }
            if st.mode & 0o100 == 0 { return Err("EACCES: permission denied".into()); }
        }
        Ok(())
    }

    fn chmod_conditional(&self, path: &str, mode: u32, ancestors: &[(&str,FileStat)], parent: &FileStat, expected: &FileStat) -> Result<(),String> {
        super::validate_chmod_ancestry(path,mode,ancestors)?;
        if path == "/" || self.mounts.keys().any(|m| super::is_path_within(path,m)) {
            return Err("EBUSY: resource busy or locked".into());
        }
        let (prefix,fs,local) = self.location(path);
        if prefix == "/" { return fs.chmod_conditional(&local,mode,ancestors,parent,expected); }
        let target = fs.memory_backend().ok_or("ENOTSUP: unsupported conditional chmod backend")?;
        let routed = ancestors.iter().map(|(p,receipt)| {
            let (_,fs,local) = self.location(p);
            Ok::<_,String>((fs.memory_backend().ok_or("ENOTSUP: unsupported mounted ancestry")?,local,receipt))
        }).collect::<Result<Vec<_>,_>>()?;
        target.chmod_across_mounts(&local,mode,&routed,parent,expected)
    }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.chmod(&rel, mode)
    }

    fn set_times(&self, path: &str, atime_ms: Option<f64>, mtime_ms: Option<f64>) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.set_times(&rel, atime_ms, mtime_ms)
    }

    fn generation(&self) -> u64 {
        let mut g = self.root.generation();
        for m in self.mounts.values() {
            g = g.wrapping_mul(31).wrapping_add(m.generation());
        }
        g
    }

    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        let mut entries = self.root.export_entries()?;
        entries.retain(|e| self.location(&e.path).0 == "/");
        for (prefix, mounted) in &self.mounts {
            for mut entry in mounted.export_entries()? {
                entry.path = if entry.path == "/" {
                    prefix.clone()
                } else {
                    format!("{prefix}{}", entry.path)
                };
                if self.location(&entry.path).0 == prefix {
                    entries.push(entry);
                }
            }
        }
        Ok(entries)
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        if !self.mounts.is_empty() {
            return Err("ENOTSUP: cannot replace a mounted namespace with a flat snapshot".into());
        }
        self.root.replace_entries(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    #[test]
    fn cross_mount_permission_failure_keeps_the_copy_and_completed_source_unlinks() {
        let root = Arc::new(MemoryVfs::new());
        root.mkdir_all("/w/d").unwrap();
        for p in ["/w/a","/w/z","/w/d/b"] { root.write_file(p,p.as_bytes()).unwrap(); }
        root.chmod("/w/d",0o555).unwrap();
        let dst = Arc::new(MemoryVfs::new());
        let fs = MountVfs::new(root.clone()).with_mount("/m",dst.clone());
        let error = fs.move_across_devices("/w/.", "/m/copy", None).unwrap_err();
        for p in ["a","d/b","z"] {
            assert_eq!(dst.read_file(&format!("/copy/{p}")).unwrap(),format!("/w/{p}").as_bytes());
        }
        assert_eq!(error, "EACCES: permission denied, removeEntryConditional '/w/d/b'");
        assert!(!root.exists("/w/z"));
        assert!(root.exists("/w/a"));
        assert!(root.exists("/w/d/b"));
        let error = fs.move_across_devices("/w/d/b","/m/single",None).unwrap_err();
        assert_eq!(error, "EACCES: permission denied, removeEntryConditional '/w/d/b'");
        assert_eq!(dst.read_file("/single").unwrap(), b"/w/d/b");
        assert!(root.exists("/w/d/b"));
    }

    #[test]
    fn cross_mount_move_copies_only_the_child_entries_selected_during_planning() {
        for alternate in [false,true] {
            let root = Arc::new(MemoryVfs::new());
            root.mkdir_all("/w/dir").unwrap();
            root.write_file("/w/file", b"original").unwrap();
            root.mkdir_all("/a").unwrap();
            root.symlink("/w/dir","/a/link").unwrap();
            if alternate {
                root.mkdir_all("/a/dir").unwrap();
                root.write_file("/a/file",b"alternate").unwrap();
            }
            let dst = Arc::new(MemoryVfs::new());
            let fs = MountVfs::new(root.clone()).with_mount("/m",dst.clone());
            let error = fs.move_across_devices("/a/link/..", "/m/copy", None).unwrap_err();
            assert_eq!(root.read_file("/w/file").unwrap(), b"original");
            assert!(root.exists("/w/dir"));
            if alternate {
                assert_eq!(error, "EAGAIN: resource temporarily unavailable, removeEntryConditional '/a/link/..'");
                assert_eq!(dst.read_file("/copy/file").unwrap(),b"alternate");
                assert!(!root.exists("/a/file"));
                assert!(!root.exists("/a/dir"));
            } else {
                assert_eq!(error, "ENOENT: no such file or directory, lstat '/a/dir'");
                assert!(!dst.exists("/copy"));
            }
        }
    }

    #[test]
    fn cross_mount_directory_cleanup_rechecks_the_original_root_operand() {
        for (source, error) in [
            ("/w/.", Some("EAGAIN: resource temporarily unavailable, removeEntryConditional '/w/.'")),
            ("/w/dir/..", Some("ENOENT: no such file or directory, lstat '/w/dir/..'")),
            ("/w/dir/../../w", Some("ENOENT: no such file or directory, lstat '/w/dir/../../w'")),
            ("/w/", None),
        ] {
            let root = Arc::new(MemoryVfs::new());
            root.mkdir_all("/w/dir").unwrap();
            root.write_file("/w/file", b"keep").unwrap();
            let store = Arc::new(MemoryVfs::new());
            let fs = MountVfs::new(root.clone()).with_mount("/m",store.clone());
            let result = fs.move_across_devices(source, "/m/copy/", None);
            assert_eq!(result.as_ref().err().map(String::as_str), error, "{source}");
            assert_eq!(store.read_file("/copy/file").unwrap(), b"keep");
            assert!(store.list_dir("/copy/dir").unwrap().is_empty());
            if error.is_some() { assert!(root.list_dir("/w").unwrap().is_empty()); }
            else { assert!(!root.exists("/w")); }
        }
    }

    #[test]
    fn rename_checks_mounted_operands_before_rejecting_protected_entries() {
        let root = Arc::new(MemoryVfs::new());
        root.write_file("/w/file", b"keep").unwrap();
        root.symlink("/", "/rootlink").unwrap();
        let fs = MountVfs::new(root.clone()).with_mount("/dev", Arc::new(MemoryVfs::new()));
        for (src, dst, expected) in [
            ("/missing", "/", "ENOENT"), ("/w/file/", "/", "ENOTDIR"),
            ("/", "/rootlink/", "ENOTDIR"), ("/", "/missing/", "EBUSY"),
            ("/w/file", "/missing/", "ENOENT"), ("/w/file", "/w/..", "EBUSY"),
            ("/w/.", "/dev/sub", "EXDEV"), ("/rootlink/..", "/w", "EACCES"),
            ("/w/.", "/w/other", "EINVAL"),
        ] {
            let err = fs.rename(src,dst,false).unwrap_err();
            assert_eq!(err.split(':').next().unwrap(),expected,"{src} -> {dst}");
        }
        assert_eq!(root.read_file("/w/file").unwrap(), b"keep");
    }

    #[test]
    fn separate_filesystems_allocate_inodes_locally_and_snapshot_links_stay_separate() {
        let root = Arc::new(MemoryVfs::new());
        let mounted = Arc::new(MemoryVfs::new());
        for (fs, bytes) in [(&root, b"A"), (&mounted, b"B")] {
            fs.write_file("/f", bytes).unwrap();
            fs.hard_link("/f", "/alias").unwrap();
            let Some(crate::vfs::EntryIdentity::Memory(_, ino)) = fs.stat("/f").unwrap().identity else { panic!() };
            assert_eq!(ino, 2);
            assert_ne!(fs.stat("/f").unwrap().identity, fs.stat("/dev/null").unwrap().identity);
            assert_eq!(fs.stat("/dev/null").unwrap().nlink, Some(1));
        }
        let fs = MountVfs::new(root).with_mount("/mnt", mounted);
        let restored = MemoryVfs::new();
        restored.replace_entries(&fs.export_entries().unwrap()).unwrap();
        restored.write_file("/alias", b"C").unwrap();
        assert_eq!(restored.read_file("/f").unwrap(), b"C");
        assert_eq!(restored.read_file("/mnt/alias").unwrap(), b"B");
    }

    #[test]
    fn snapshots_exclude_covered_files_and_cannot_overwrite_the_backing_tree() {
        let root = Arc::new(MemoryVfs::new());
        root.write_file("/data/m/covered", b"hidden").unwrap();
        let mounted = Arc::new(MemoryVfs::new());
        mounted.write_file("/shown", b"visible").unwrap();
        let fs = MountVfs::new(root.clone()).with_mount("/data/m", mounted);
        let snapshot = fs.export_entries().unwrap();
        assert!(!snapshot.iter().any(|e| e.path == "/data/m/covered"));
        assert!(snapshot.iter().any(|e| e.path == "/data/m/shown"));
        assert!(fs.replace_entries(&snapshot).is_err());
        assert!(fs.remove_path("/data").is_err());
        assert_eq!(root.read_file("/data/m/covered").unwrap(), b"hidden");
    }

    #[test]
    fn symlinks_cannot_cross_into_covering_or_nested_mounts() {
        let root = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        root.write_file("/mnt/private", b"covered").unwrap();
        root.symlink("/mnt", "/alias").unwrap();
        root.symlink("/mnt/private", "/file-link").unwrap();
        upper
            .write_file("/nested/private", b"also covered")
            .unwrap();
        upper.symlink("/nested/private", "/nested-link").unwrap();
        upper.write_file("/visible", b"ok").unwrap();
        upper.symlink("/visible", "/ok").unwrap();
        let fs = MountVfs::new(root.clone())
            .with_mount("/mnt", upper)
            .with_mount("/mnt/nested", Arc::new(MemoryVfs::new()));
        for path in ["/file-link", "/alias/private", "/mnt/nested-link"] {
            assert!(
                fs.read_file(path).unwrap_err().starts_with("EACCES"),
                "{path}"
            );
            assert!(fs.write_file(path, b"overwritten").is_err());
        }
        assert_eq!(fs.read_file("/mnt/ok").unwrap(), b"ok");
        assert_eq!(fs.readlink("/file-link").unwrap(), "/mnt/private");
        fs.remove_path("/file-link").unwrap();
        assert_eq!(root.read_file("/mnt/private").unwrap(), b"covered");
    }

    #[test]
    fn mount_vfs_routes_longest_prefix_and_exports_combined_tree() {
        let root = Arc::new(MemoryVfs::new());
        let mnt = Arc::new(MemoryVfs::new());
        root.mkdir_all("/mnt/data").unwrap();
        let fs = MountVfs::new(root.clone()).with_mount("/mnt/data", mnt.clone());

        fs.write_file("/root.txt", b"in-root").unwrap();
        fs.write_file("/mnt/data/nested.txt", b"in-mount").unwrap();

        assert_eq!(root.read_file("/root.txt").unwrap(), b"in-root");
        assert!(!root.exists("/mnt/data/nested.txt"));
        assert_eq!(mnt.read_file("/nested.txt").unwrap(), b"in-mount");
        assert_eq!(fs.read_file("/mnt/data/nested.txt").unwrap(), b"in-mount");
    }

    #[test]
    fn mount_vfs_nested_mounts_and_directory_listing() {
        let root = Arc::new(MemoryVfs::new());
        let m1 = Arc::new(MemoryVfs::new());
        let m2 = Arc::new(MemoryVfs::new());
        root.mkdir_all("/mnt/a/b").unwrap();
        let fs = MountVfs::new(root.clone())
            .with_mount("/mnt/a", m1.clone())
            .with_mount("/mnt/a/b", m2.clone());

        fs.write_file("/mnt/a/f1.txt", b"m1-val").unwrap();
        fs.write_file("/mnt/a/b/f2.txt", b"m2-val").unwrap();
        assert_eq!(m1.read_file("/f1.txt").unwrap(), b"m1-val");
        assert_eq!(m2.read_file("/f2.txt").unwrap(), b"m2-val");
        let exported = fs.export_entries().unwrap();
        assert!(exported.iter().any(|e| e.path == "/mnt/a/f1.txt"));
        assert!(exported.iter().any(|e| e.path == "/mnt/a/b/f2.txt"));
    }

    #[test]
    fn conditional_chmod_pins_directories_in_each_backing_store() {
        let root = Arc::new(MemoryVfs::new());
        root.mkdir_all("/top").unwrap();
        let store = Arc::new(MemoryVfs::new());
        store.write_file("/d/f",b"original").unwrap();
        let fs = MountVfs::new(root.clone()).with_mount("/top/m",store.clone());
        let path = "/top/m/d/f";
        let ancestor_paths = ["/","/top","/top/m","/top/m/d"];
        let chain: Vec<_> = ancestor_paths.iter().map(|&p|(p,fs.lstat(p).unwrap())).collect();
        let parent = &chain.last().unwrap().1;
        let entry = fs.lstat(path).unwrap();
        fs.prepare_chmod(path,&chain).unwrap();
        fs.chmod_conditional(path,0o600,&chain,parent,&entry).unwrap();
        assert_eq!(store.stat("/d/f").unwrap().mode,0o100600);
        let fresh = fs.lstat(path).unwrap();
        fs.prepare_chmod(path,&chain).unwrap();
        root.rename("/top","/original",false).unwrap();
        root.mkdir_all("/top").unwrap();
        assert!(fs.chmod_conditional(path,0o777,&chain,parent,&fresh).unwrap_err().starts_with("EAGAIN:"));
        assert_eq!(store.stat("/d/f").unwrap().mode,0o100600);
    }

    #[test]
    fn mount_vfs_stat_and_remove_route_to_mounted_fs() {
        let root = Arc::new(MemoryVfs::new());
        let mnt = Arc::new(MemoryVfs::new());
        root.mkdir_all("/mnt").unwrap();
        let fs = MountVfs::new(root).with_mount("/mnt", mnt.clone());
        fs.write_file("/mnt/temp.txt", b"1234").unwrap();
        assert_eq!(fs.stat("/mnt/temp.txt").unwrap().size, 4);
        fs.remove("/mnt/temp.txt", false).unwrap();
        assert!(!mnt.exists("/temp.txt"));
    }
}
