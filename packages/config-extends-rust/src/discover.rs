//! Ordered base discovery. The host classifies only own ENOENT as a missing read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error<E> {
    Policy(Vec<u16>),
    Host(E),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscoveredBase {
    pub content: Vec<u16>,
    pub file_path: Vec<u16>,
    pub base_index: usize,
}
pub trait Host {
    type Error;
    fn join(&mut self, directory: &[u16], file: &[u16]) -> Vec<u16>;
    fn contains(&mut self, directory: &[u16], file: &[u16]) -> bool;
    /// None means ENOENT; every other host error must remain an error.
    fn read(
        &mut self,
        file: &[u16],
    ) -> impl std::future::Future<Output = Result<Option<Vec<u16>>, Self::Error>>;
}
pub async fn find_base<H: Host>(
    name: &[u16],
    bases: &[Vec<u16>],
    host: &mut H,
) -> Result<DiscoveredBase, Error<H::Error>> {
    let mut checked = vec![];
    for (base_index, directory) in bases.iter().enumerate() {
        for extension in [".md", ".yaml", ".yml", ".json"] {
            let mut file = name.to_vec();
            file.extend(extension.encode_utf16());
            let file_path = host.join(directory, &file);
            if !host.contains(directory, &file_path) {
                return Err(Error::Policy(
                    "Base name must remain inside configured base directories."
                        .encode_utf16()
                        .collect(),
                ));
            }
            checked.push(file_path.clone());
            if let Some(content) = host.read(&file_path).await.map_err(Error::Host)? {
                return Ok(DiscoveredBase {
                    content,
                    file_path,
                    base_index,
                });
            }
        }
    }
    let mut message: Vec<u16> = "Base \"".encode_utf16().collect();
    message.extend(name);
    message.extend("\" not found.\nChecked paths:\n- ".encode_utf16());
    for (index, path) in checked.iter().enumerate() {
        if index > 0 {
            message.extend("\n- ".encode_utf16());
        }
        message.extend(path);
    }
    Err(Error::Policy(message))
}
