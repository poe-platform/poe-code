//! Rust validation ordering; hosts admit strings and use their URL constructor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Request {
    Name,
    Transport,
    Command,
    Url,
    ParseUrl,
    Http,
    Https,
    Error(&'static str),
    Done,
}
pub struct Validation {
    request: Request,
}
impl Default for Validation {
    fn default() -> Self {
        Self::new()
    }
}
impl Validation {
    pub fn new() -> Self {
        Self {
            request: Request::Name,
        }
    }
    pub fn request(&self) -> Request {
        self.request
    }
    pub fn respond(&mut self, accepted: bool) -> Result<(), &'static str> {
        const URL_ERROR: Request =
            Request::Error("MCP HTTP URL must be a valid http or https URL.");
        self.request = match (self.request, accepted) {
            (Request::Name, true) => Request::Transport,
            (Request::Name, false) => Request::Error("MCP server name must be a non-empty string."),
            (Request::Transport, true) => Request::Command,
            (Request::Transport, false) => Request::Url,
            (Request::Command, true) => Request::Done,
            (Request::Command, false) => {
                Request::Error("MCP stdio command must be a non-empty string.")
            }
            (Request::Url, true) => Request::ParseUrl,
            (Request::ParseUrl, true) => Request::Http,
            (Request::Http, true) | (Request::Https, true) => Request::Done,
            (Request::Http, false) => Request::Https,
            (Request::Url | Request::ParseUrl | Request::Https, false) => URL_ERROR,
            _ => return Err("Validation is already terminal"),
        };
        Ok(())
    }
}
