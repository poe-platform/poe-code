use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi(object)]
pub struct DashboardCellSnapshot {
    pub width: u32,
    pub height: u32,
    pub cells: Vec<Utf16String>,
}

#[napi]
pub fn design_dashboard_buffer_diff(
    previous: DashboardCellSnapshot,
    next: DashboardCellSnapshot,
    blank: Utf16String,
) -> Result<Vec<u32>> {
    let width = previous.width.max(next.width) as usize;
    let height = previous.height.max(next.height) as usize;
    if width.checked_mul(height).is_none_or(|area| area > u32::MAX as usize)
        || previous.width as usize * previous.height as usize != previous.cells.len()
        || next.width as usize * next.height as usize != next.cells.len()
    {
        return Err(Error::new(Status::InvalidArg, "Invalid dashboard cell snapshot"));
    }
    let previous_cells: Vec<&[u16]> = previous.cells.iter().map(|cell| &**cell).collect();
    let next_cells: Vec<&[u16]> = next.cells.iter().map(|cell| &**cell).collect();
    Ok(toolcraft_design_rust::dashboard_buffer::diff_indices(
        width, height, previous.width as usize, &previous_cells,
        next.width as usize, &next_cells, &blank,
    ))
}

#[napi]
pub fn design_dashboard_buffer_has_controls(text: Utf16String) -> bool {
    toolcraft_design_rust::dashboard_buffer::has_controls(&text)
}

#[napi]
pub fn design_dashboard_buffer_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    toolcraft_design_rust::dashboard_buffer::run(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        &operation,
        &args,
    )?
    .to_host(&env)
}
