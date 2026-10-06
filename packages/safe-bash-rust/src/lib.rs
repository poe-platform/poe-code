#![allow(
    clippy::chunks_exact_to_as_chunks,
    clippy::collapsible_if,
    clippy::collapsible_match,
    clippy::double_ended_iterator_last,
    clippy::if_same_then_else,
    clippy::manual_div_ceil,
    clippy::manual_ignore_case_cmp,
    clippy::missing_safety_doc,
    clippy::needless_range_loop,
    clippy::too_many_arguments,
    clippy::useless_conversion,
    clippy::useless_vec
)]

pub mod agent;
pub mod backend;
pub mod budget;
pub mod commands;
pub mod fs;
pub mod shell;
pub mod vfs;
pub mod wasm;

pub use agent::{
    AgentRunCommandRequest, BackgroundStatus, PoeAgentShellHost, PoeAgentShellOptions, ShellMode,
};
pub use backend::{BackendMode, CommandContext, CommandResult, HybridBackend, RustCommand};
pub use budget::{AllocationGuard, CancellationToken, ExecutionBudget, ShellLimits};
#[cfg(not(target_arch = "wasm32"))]
pub use fs::RealVfs;
pub use fs::{
    FileStat, FsError, FsErrorCode, MemoryVfs, MemoryVfsLimits, MountVfs, OverlayVfs, SafeBashFs,
    VfsEntryKind, VfsFileEntry,
};
pub use shell::{ExecOptions, ExecOutput, Shell, ShellOptions};
