pub mod agent;
pub mod backend;
pub mod fs;
pub mod shell;

pub use agent::{
    AgentRunCommandRequest, BackgroundStatus, PoeAgentShellHost, PoeAgentShellOptions, ShellMode,
};
pub use backend::{BackendMode, CommandContext, CommandResult, HybridBackend, RustCommand};
pub use fs::{MemoryVfs, SafeBashFs, VfsEntryKind, VfsFileEntry};
pub use shell::{ExecOptions, ExecOutput, Shell, ShellOptions};
