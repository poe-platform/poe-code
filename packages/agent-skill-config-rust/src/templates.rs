//! Own bundled skill content, compiled into the portable core.
pub fn bundled(id: &[u16]) -> Option<Vec<u16>> {
    let content = if "poe-generate.md".encode_utf16().eq(id.iter().copied()) {
        include_str!("templates/poe-generate.md")
    } else if "terminal-pilot.md".encode_utf16().eq(id.iter().copied()) {
        include_str!("templates/terminal-pilot.md")
    } else {
        return None;
    };
    Some(content.encode_utf16().collect())
}
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[derive(Clone, Debug, PartialEq)]
pub enum Request {
    Join(Vec<Vec<u16>>),
    Parent(Vec<u16>),
    Stat(Vec<u16>),
    Read(Vec<u16>),
    Done(Vec<u16>),
}
pub enum Response {
    Path(Vec<u16>),
    Exists(bool),
    Content(Vec<u16>),
}
#[derive(Clone, Copy)]
enum Stage {
    Ready,
    RootJoin,
    RootStat,
    Parent,
    CandidateJoin(usize),
    CandidateStat(usize),
    Read,
    Done,
}
pub struct Machine {
    id: Vec<u16>,
    root: Vec<u16>,
    path: Vec<u16>,
    stage: Stage,
}
impl Machine {
    pub fn new(id: &[u16], directory: Vec<u16>) -> Result<Self, Vec<u16>> {
        if !["poe-generate.md", "terminal-pilot.md"]
            .iter()
            .any(|name| name.encode_utf16().eq(id.iter().copied()))
        {
            return Err([u("Template not found: "), id.to_vec()].concat());
        }
        Ok(Self {
            id: id.to_vec(),
            root: directory,
            path: vec![],
            stage: Stage::Ready,
        })
    }
    fn root_join(&mut self) -> Request {
        self.stage = Stage::RootJoin;
        Request::Join(vec![self.root.clone(), u("package.json")])
    }
    fn candidate(&mut self, index: usize) -> Request {
        self.stage = Stage::CandidateJoin(index);
        let mut parts = vec![
            self.root.clone(),
            u(if index == 0 { "src" } else { "dist" }),
            u("templates"),
        ];
        if index == 2 {
            parts.push(u("skill"));
        }
        parts.push(self.id.clone());
        Request::Join(parts)
    }
    pub fn start(&mut self) -> Result<Request, Vec<u16>> {
        if !matches!(self.stage, Stage::Ready) {
            return Err(u("Template discovery already started"));
        }
        Ok(self.root_join())
    }
    pub fn respond(&mut self, response: Response) -> Result<Request, Vec<u16>> {
        match (self.stage, response) {
            (Stage::RootJoin, Response::Path(path)) => {
                self.path = path.clone();
                self.stage = Stage::RootStat;
                Ok(Request::Stat(path))
            }
            (Stage::RootStat, Response::Exists(true)) => Ok(self.candidate(0)),
            (Stage::RootStat, Response::Exists(false)) => {
                self.stage = Stage::Parent;
                Ok(Request::Parent(self.root.clone()))
            }
            (Stage::Parent, Response::Path(path)) => {
                if path == self.root {
                    return Err(u(
                        "Unable to locate package root for agent-skill-config templates.",
                    ));
                }
                self.root = path;
                Ok(self.root_join())
            }
            (Stage::CandidateJoin(index), Response::Path(path)) => {
                self.path = path.clone();
                self.stage = Stage::CandidateStat(index);
                Ok(Request::Stat(path))
            }
            (Stage::CandidateStat(_), Response::Exists(true)) => {
                self.stage = Stage::Read;
                Ok(Request::Read(self.path.clone()))
            }
            (Stage::CandidateStat(index), Response::Exists(false)) => {
                if index == 2 {
                    return Err([u("Template not found: "), self.id.clone()].concat());
                }
                Ok(self.candidate(index + 1))
            }
            (Stage::Read, Response::Content(content)) => {
                self.stage = Stage::Done;
                Ok(Request::Done(content))
            }
            _ => Err(u("Unexpected template discovery response")),
        }
    }
}
