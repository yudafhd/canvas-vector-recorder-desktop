use crate::AppError;
use tauri::AppHandle;

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSColorSampler, NSColorSpace};

/// Opens the native system eyedropper where the platform provides one.
/// macOS uses NSColorSampler, which samples any pixel on screen and presents
/// the familiar magnifying loupe. Other platforms fall back to WebView APIs.
pub async fn pick_screen_color(app: AppHandle) -> Result<Option<String>, AppError> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::sync_channel::<Option<String>>(1);
        app.run_on_main_thread(move || unsafe {
            let sampler = NSColorSampler::new();
            let handler = RcBlock::new(move |color: *mut NSColor| {
                let picked = color.as_ref().and_then(|color| {
                    let srgb = NSColorSpace::sRGBColorSpace();
                    color.colorUsingColorSpace(&srgb).map(|color| {
                        let component = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
                        format!(
                            "#{:02X}{:02X}{:02X}",
                            component(color.redComponent()),
                            component(color.greenComponent()),
                            component(color.blueComponent()),
                        )
                    })
                });
                let _ = sender.send(picked);
            });
            sampler.showSamplerWithSelectionHandler(&handler);
        })
        .map_err(|error| AppError::Window(error.to_string()))?;
        return tauri::async_runtime::spawn_blocking(move || receiver.recv().ok().flatten())
            .await
            .map_err(|error| AppError::Window(error.to_string()));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(None)
    }
}
