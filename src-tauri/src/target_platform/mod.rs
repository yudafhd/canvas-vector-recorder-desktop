#[cfg(not(target_os = "windows"))]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(target_os = "windows"))]
pub(crate) use self::macos::{
    close_target_tab, close_target_views, open_target_tab, open_target_window, resize_target_view,
    restore_target_view, set_target_view_visible, switch_target_tab,
};

#[cfg(target_os = "windows")]
pub(crate) use self::windows::{
    close_target_tab, close_target_views, open_target_tab, open_target_window, resize_target_view,
    restore_target_view, set_target_view_visible, switch_target_tab,
};
