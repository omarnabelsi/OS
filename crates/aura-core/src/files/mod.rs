//! File service - V2. Copy / move / delete / rename via the `IFileOperation` COM interface so
//! we inherit Windows progress dialogs, the Recycle Bin and undo. Folder skins (colour, icon,
//! cover, layout) are stored in the `folders` table. Not wired to IPC in V1.

use crate::error::CoreError;

pub fn not_implemented(what: &str) -> CoreError {
    CoreError::Unsupported(format!("files::{what} is planned for V2"))
}
