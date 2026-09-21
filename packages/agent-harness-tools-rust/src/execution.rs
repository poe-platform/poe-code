//! Capability admission requests lazy host facts in observable SDK order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fact {
    Detach,
    SupportsDetach,
    WantsTransfer,
    SupportsTransfer,
}
impl Fact {
    pub fn name(self) -> &'static str {
        match self {
            Self::Detach => "detach",
            Self::SupportsDetach => "supportsDetach",
            Self::WantsTransfer => "wantsTransfer",
            Self::SupportsTransfer => "supportsTransfer",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapabilityError {
    Detach,
    Transfer,
}
impl CapabilityError {
    pub fn name(self) -> &'static str {
        match self {
            Self::Detach => "detach",
            Self::Transfer => "transfer",
        }
    }
}
pub fn admit<E>(
    mut read: impl FnMut(Fact) -> Result<bool, E>,
) -> Result<Option<CapabilityError>, E> {
    if read(Fact::Detach)? && !read(Fact::SupportsDetach)? {
        return Ok(Some(CapabilityError::Detach));
    }
    if read(Fact::WantsTransfer)? && !read(Fact::SupportsTransfer)? {
        return Ok(Some(CapabilityError::Transfer));
    }
    Ok(None)
}
