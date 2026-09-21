//! Portable binary probes keep names out of the shell program.
pub struct Detector {
    pub command: &'static str,
    pub args: Vec<Vec<u16>>,
}
pub fn detectors(name: &[u16]) -> Vec<Detector> {
    vec![
        Detector {command:"which",args:vec![name.to_vec()]},
        Detector {command:"where",args:vec![name.to_vec()]},
        Detector {command:"sh",args:vec![
            "-c".encode_utf16().collect(),
            "for directory in /usr/local/bin /usr/bin \"$HOME/.local/bin\" \"$HOME/.claude/local/bin\"; do test -f \"$directory/$1\" && exit 0; done; exit 1".encode_utf16().collect(),
            "sh".encode_utf16().collect(),name.to_vec()
        ]}
    ]
}
pub fn valid(index: u32, exited: bool, has_output: bool) -> bool {
    match index {
        0 | 2 => exited,
        1 => exited && has_output,
        _ => false,
    }
}
