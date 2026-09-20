//! Foreign documents remain in the host; this core controls conflicts and edits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Configure,
    Unconfigure,
}
pub enum MapState {
    Missing,
    Valid,
    Invalid,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    Map,
    EmptyMap,
    Existing,
    EqualsShaped,
    HasCanonical,
    EqualsCanonical,
    ConflictName,
    HasExpected,
    EqualsExpected,
    Delete,
    Noop,
    Upsert,
    RemoveKey,
    UpdateMap,
    Error(Vec<u16>),
}
pub enum Response {
    Map(MapState),
    Flag(bool),
    Name(Vec<u16>),
    Unit,
}
pub struct Decision {
    mode: Mode,
    key: Vec<u16>,
    path: Vec<u16>,
    current: Request,
}
impl Decision {
    pub fn new(mode: Mode, key: Vec<u16>, path: Vec<u16>) -> Self {
        Self {
            mode,
            key,
            path,
            current: Request::Map,
        }
    }
    pub fn request(&self) -> Request {
        self.current.clone()
    }
    pub fn respond(&mut self, response: Response) -> Result<(), &'static str> {
        self.current = match (&self.current, response) {
            (Request::Map, Response::Map(MapState::Missing)) => Request::EmptyMap,
            (Request::Map, Response::Map(MapState::Valid))
            | (Request::EmptyMap, Response::Unit) => Request::Existing,
            (Request::Map, Response::Map(MapState::Invalid)) => {
                let mut error = units("Expected ");
                error.extend(&self.key);
                error.extend(units(" to be an object."));
                Request::Error(error)
            }
            (Request::Existing, Response::Flag(false)) => {
                if self.mode == Mode::Configure {
                    Request::Upsert
                } else {
                    Request::Noop
                }
            }
            (Request::Existing, Response::Flag(true)) => {
                if self.mode == Mode::Configure {
                    Request::EqualsShaped
                } else {
                    Request::HasExpected
                }
            }
            (Request::EqualsShaped, Response::Flag(true)) => Request::Noop,
            (Request::EqualsShaped, Response::Flag(false)) => Request::HasCanonical,
            (Request::HasCanonical, Response::Flag(false))
            | (Request::EqualsCanonical, Response::Flag(false)) => Request::ConflictName,
            (Request::HasCanonical, Response::Flag(true)) => Request::EqualsCanonical,
            (Request::EqualsCanonical, Response::Flag(true)) => Request::Upsert,
            (Request::ConflictName, Response::Name(name)) => {
                let mut error = units("MCP server \"");
                error.extend(name);
                error.extend(units("\" already exists with different configuration in "));
                error.extend(&self.path);
                error.extend(units("."));
                Request::Error(error)
            }
            (Request::HasExpected, Response::Flag(false))
            | (Request::EqualsExpected, Response::Flag(true)) => Request::Delete,
            (Request::HasExpected, Response::Flag(true)) => Request::EqualsExpected,
            (Request::EqualsExpected, Response::Flag(false)) => Request::Noop,
            (Request::Delete, Response::Flag(true)) => Request::RemoveKey,
            (Request::Delete, Response::Flag(false)) => Request::UpdateMap,
            _ => return Err("Invalid configuration decision response"),
        };
        Ok(())
    }
}
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
