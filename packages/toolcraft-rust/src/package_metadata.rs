/// Filesystem and platform path operations are supplied by the host. The search
/// and fallback rules remain independent of Node and its injectable filesystem.
pub trait PackageMetadataHost {
    type Error;
    fn realpath(&mut self, path: &[u16]) -> Result<Vec<u16>, Self::Error>;
    fn is_directory(&mut self, path: &[u16]) -> Result<bool, Self::Error>;
    fn parent(&mut self, path: &[u16]) -> Result<Vec<u16>, Self::Error>;
    fn package_path(&mut self, directory: &[u16]) -> Result<Vec<u16>, Self::Error>;
    fn exists(&mut self, path: &[u16]) -> Result<bool, Self::Error>;
}

pub fn find_package_path<H: PackageMetadataHost>(
    from: &[u16],
    host: &mut H,
) -> Result<Option<Vec<u16>>, H::Error> {
    let resolved = host.realpath(from).unwrap_or_else(|_| from.to_vec());
    let directory = match host.is_directory(&resolved) {
        Ok(true) => Ok(resolved),
        Ok(false) => host.parent(&resolved),
        Err(error) => Err(error),
    };
    let mut current = directory.or_else(|_| host.parent(from))?;
    loop {
        let candidate = host.package_path(&current)?;
        if host.exists(&candidate)? {
            return Ok(Some(candidate));
        }
        let parent = host.parent(&current)?;
        if parent == current {
            return Ok(None);
        }
        current = parent;
    }
}
