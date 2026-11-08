use crate::errors::GitError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnwrappedObject {
    pub object_type: String,
    pub object: Vec<u8>,
}

pub struct GitObject;

impl GitObject {
    pub fn wrap(object_type: &str, object: &[u8]) -> Vec<u8> {
        let header = format!("{object_type} {}\0", object.len());
        let mut out = Vec::with_capacity(header.len() + object.len());
        out.extend_from_slice(header.as_bytes());
        out.extend_from_slice(object);
        out
    }

    pub fn unwrap(buffer: &[u8]) -> Result<UnwrappedObject, GitError> {
        let s = buffer
            .iter()
            .position(|&b| b == b' ')
            .ok_or_else(|| GitError::internal("GitObject.unwrap: missing space in header"))?;
        let i = buffer
            .iter()
            .position(|&b| b == 0)
            .ok_or_else(|| GitError::internal("GitObject.unwrap: missing NUL in header"))?;
        let object_type = String::from_utf8_lossy(&buffer[..s]).to_string();
        let length_str = String::from_utf8_lossy(&buffer[s + 1..i]);
        let expected_len = length_str
            .parse::<usize>()
            .map_err(|_| GitError::internal("GitObject.unwrap: invalid length in header"))?;
        let actual_len = buffer.len() - (i + 1);
        if expected_len != actual_len {
            return Err(GitError::internal(&format!(
                "Length mismatch: expected {expected_len} bytes but got {actual_len} instead."
            )));
        }
        Ok(UnwrappedObject {
            object_type,
            object: buffer[i + 1..].to_vec(),
        })
    }
}
