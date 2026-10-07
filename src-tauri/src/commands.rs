use crate::{
    license,
    recorder::{self, events::RecorderEvent, svg_asset::{SvgAsset, SvgAssetInput}, validator::MicrostockSettings},
    target_platform, AppError, AppState, TargetState, TargetTab,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, State};

const MAHES_APP_URL: &str = "https://mahes.app";
const DISCOVER_URL: &str = "https://www.mahes.app/api/v1/discover";

#[tauri::command]
pub async fn get_discover() -> Result<serde_json::Value, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| AppError::Network(error.to_string()))?;
    client
        .get(DISCOVER_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| AppError::Network(format!("Discover tidak dapat dihubungi: {error}")))?
        .json()
        .await
        .map_err(|error| AppError::Network(format!("Respons Discover tidak valid: {error}")))
}

#[tauri::command]
pub fn open_discover_link(url: String) -> Result<(), AppError> {
    let parsed = url::Url::parse(&url).map_err(|_| AppError::InvalidUrl)?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err(AppError::InvalidUrl);
    }

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(parsed.as_str()).spawn();

    #[cfg(target_os = "windows")]
    let result = {
        use std::os::windows::process::CommandExt;
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", parsed.as_str()])
            .creation_flags(0x08000000)
            .spawn()
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(parsed.as_str()).spawn();

    result
        .map(|_| ())
        .map_err(|error| AppError::Window(format!("Gagal membuka tautan Discover: {error}")))
}

#[derive(Debug, Serialize)]
pub struct StartRecording {
    pub session_id: String,
    pub target_capability: String,
}

#[tauri::command]
pub fn start_recording(
    state: State<'_, AppState>,
) -> Result<StartRecording, AppError> {
    let mut recorder = state.recorder.lock().map_err(|_| AppError::State)?;
    let session_id = recorder.start();
    Ok(StartRecording {
        session_id,
        target_capability: "record_canvas_events".into(),
    })
}

#[tauri::command]
pub async fn pick_screen_color(app: AppHandle) -> Result<Option<String>, AppError> {
    crate::color_picker::pick_screen_color(app).await
}

#[tauri::command]
pub fn stop_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    for webview in target_webviews(&app) {
        let _ = webview.eval("window.__CVR_STOP_RECORDER__ && window.__CVR_STOP_RECORDER__()");
    }
    state.recorder.lock().map_err(|_| AppError::State)?.stop();
    Ok(())
}

#[tauri::command]
pub fn record_canvas_events(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    events: Vec<RecorderEvent>,
) -> Result<(), AppError> {
    let mut recorder = state.recorder.lock().map_err(|_| AppError::State)?;
    recorder.record(&session_id, events)?;
    drop(recorder);

    let should_emit = {
        let mut last = state.last_emit.lock().map_err(|_| AppError::State)?;
        if last.elapsed() >= std::time::Duration::from_millis(500) {
            *last = std::time::Instant::now();
            true
        } else {
            false
        }
    };
    if should_emit {
        let canvases = state.recorder.lock().map_err(|_| AppError::State)?.list();
        let _ = app.emit("canvases-updated", canvases);
    }
    Ok(())
}

#[tauri::command]
pub fn list_canvases(
    _app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<recorder::CanvasDetection>, AppError> {
    Ok(state.recorder.lock().map_err(|_| AppError::State)?.list())
}

#[tauri::command]
pub fn record_svg_asset(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    asset: SvgAssetInput,
) -> Result<(), AppError> {
    let changed = state.recorder.lock().map_err(|_| AppError::State)?.record_svg(&session_id, asset)?;
    if changed {
        let assets = state.recorder.lock().map_err(|_| AppError::State)?.list_svgs();
        let _ = app.emit("svgs-updated", assets);
    }
    Ok(())
}

#[tauri::command]
pub fn list_svg_assets(
    _app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SvgAsset>, AppError> {
    Ok(state.recorder.lock().map_err(|_| AppError::State)?.list_svgs())
}

#[tauri::command]
pub fn get_svg_asset(
    _app: AppHandle,
    state: State<'_, AppState>,
    svg_id: String,
) -> Result<Option<SvgAsset>, AppError> {
    Ok(state.recorder.lock().map_err(|_| AppError::State)?.svg(&svg_id))
}

fn svg_asset_with_markup(
    state: &State<'_, AppState>,
    svg_id: &str,
    source_markup: Option<String>,
) -> Result<SvgAsset, AppError> {
    let mut asset = svg_asset_or_error(state, svg_id)?;
    if let Some(markup) = source_markup {
        if markup.len() > recorder::svg_asset::MAX_SVG_BYTES || !markup.trim_start().starts_with("<svg") {
            return Err(AppError::InvalidEvent("invalid SVG markup override".into()));
        }
        asset.markup = markup;
    }
    Ok(asset)
}

fn svg_asset_or_error(
    state: &State<'_, AppState>,
    svg_id: &str,
) -> Result<SvgAsset, AppError> {
    state
        .recorder
        .lock()
        .map_err(|_| AppError::State)?
        .svg(svg_id)
        .ok_or_else(|| AppError::NotFound(format!("SVG tidak ditemukan: {svg_id}")))
}

#[tauri::command]
pub fn generate_svg_asset(
    _app: AppHandle,
    state: State<'_, AppState>,
    svg_id: String,
    settings: Option<MicrostockSettings>,
    source_markup: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let asset = svg_asset_with_markup(&state, &svg_id, source_markup)?;
    Ok(recorder::svg_asset::result(&asset, &settings.unwrap_or_default()))
}

#[tauri::command]
pub fn get_canvas_result(
    _app: AppHandle,
    state: State<'_, AppState>,
    canvas_id: String,
) -> Result<Option<recorder::canvas::CanvasResult>, AppError> {
    Ok(state
        .recorder
        .lock()
        .map_err(|_| AppError::State)?
        .canvas(&canvas_id))
}

fn canvas_or_error(
    state: &State<'_, AppState>,
    canvas_id: &str,
) -> Result<recorder::canvas::CanvasResult, AppError> {
    state
        .recorder
        .lock()
        .map_err(|_| AppError::State)?
        .canvas(canvas_id)
        .ok_or_else(|| AppError::NotFound(format!("Canvas tidak ditemukan: {canvas_id}")))
}

#[tauri::command]
pub fn generate_svg(
    _app: AppHandle,
    state: State<'_, AppState>,
    canvas_id: String,
    settings: Option<MicrostockSettings>,
) -> Result<serde_json::Value, AppError> {
    let data = canvas_or_error(&state, &canvas_id)?;
    Ok(recorder::svg::result(&data, &settings.unwrap_or_default()))
}

#[tauri::command]
pub fn export_svg(
    _app: AppHandle,
    state: State<'_, AppState>,
    canvas_id: String,
    settings: Option<MicrostockSettings>,
) -> Result<String, AppError> {
    let data = canvas_or_error(&state, &canvas_id)?;
    let (svg, _) = recorder::svg::build(&data, &settings.unwrap_or_default());
    Ok(svg)
}

#[tauri::command]
pub fn save_svg(
    app: AppHandle,
    state: State<'_, AppState>,
    canvas_id: String,
    settings: Option<MicrostockSettings>,
    filename: Option<String>,
    save_directory: Option<String>,
) -> Result<String, AppError> {
    let data = canvas_or_error(&state, &canvas_id)?;
    let (svg, (width, height, _)) = recorder::svg::build(&data, &settings.unwrap_or_default());
    let filename = filename.as_deref().unwrap_or("vectorized-result.svg");
    check_stock_artboard(width, height)?;
    let directory = export_directory(&app, save_directory.as_deref())?;
    let path = unique_download_path(&directory, &safe_svg_filename(&filename));
    if svg.len() > 45_000_000 { return Err(AppError::PayloadTooLarge); }
    std::fs::write(&path, svg).map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn save_svg_asset(
    app: AppHandle,
    state: State<'_, AppState>,
    svg_id: String,
    settings: Option<MicrostockSettings>,
    filename: Option<String>,
    source_markup: Option<String>,
    save_directory: Option<String>,
) -> Result<String, AppError> {
    let asset = svg_asset_with_markup(&state, &svg_id, source_markup)?;
    let (svg, (width, height, _)) = recorder::svg_asset::build_for_export(&asset, &settings.unwrap_or_default());
    check_stock_artboard(width, height)?;
    let directory = export_directory(&app, save_directory.as_deref())?;
    let path = unique_download_path(&directory, &safe_svg_filename(filename.as_deref().unwrap_or(&asset.filename)));
    if svg.len() > 45_000_000 { return Err(AppError::PayloadTooLarge); }
    std::fs::write(&path, svg).map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

/// Use the exact Online SVG/EPS layout and serializers for Offline exports.
#[tauri::command]
pub fn render_tracing_export(svg: String, settings: MicrostockSettings, format: String, title: String) -> Result<String, AppError> {
    if svg.len() > 20 * 1024 * 1024 { return Err(AppError::PayloadTooLarge); }
    validate_tracing_svg(&svg)?;
    if !settings.min_pixels.is_finite() || !settings.max_pixels.is_finite() || settings.min_pixels < 15_000_000.0 || settings.max_pixels > 65_000_000.0 || settings.max_pixels <= settings.min_pixels {
        return Err(AppError::InvalidEvent("Artboard harus 15-65 MP".into()));
    }
    let document = roxmltree::Document::parse(&svg).map_err(|_| AppError::InvalidEvent("SVG tidak valid".into()))?;
    let root = document.root_element();
    let box_values: Vec<f64> = root.attribute("viewBox").unwrap_or("").split_whitespace().filter_map(|v| v.parse().ok()).collect();
    if box_values.len() != 4 || box_values.iter().any(|v| !v.is_finite()) || box_values[0] != 0.0 || box_values[1] != 0.0 || box_values[2] <= 0.0 || box_values[3] <= 0.0 {
        return Err(AppError::InvalidEvent("ViewBox tracing tidak valid".into()));
    }
    let paths: Vec<_> = root.children().filter(|n| n.is_element()).collect();
    let markup = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\">{}</svg>", box_values[2], box_values[3], box_values[2], box_values[3], paths.iter().map(|n| &svg[n.range()]).collect::<String>());
    let asset = recorder::svg_asset::SvgAsset { svg_id: "offline-trace".into(), width: box_values[2], height: box_values[3], shapes: paths.len(), filename: "offline-trace.svg".into(), markup, revision: 0 };
    let title = title.replace(['\r', '\n'], " ");
    let (output, (width, height, _)) = match format.as_str() {
        "svg" => recorder::svg_asset::build_for_export(&asset, &settings),
        "eps" => recorder::eps::build_svg_asset_eps(&asset, &settings, &title),
        _ => return Err(AppError::InvalidEvent("Format ekspor tidak valid".into())),
    };
    check_stock_artboard(width, height)?;
    let area = width as f64 * height as f64;
    if area < settings.min_pixels || area > settings.max_pixels { return Err(AppError::InvalidEvent("Rasio artboard tidak dapat memenuhi rentang MP yang dipilih".into())); }
    if output.len() > 45_000_000 { return Err(AppError::PayloadTooLarge); }
    Ok(output)
}

/// Save the local tracing page's generated path-only SVG using the existing export convention.
#[tauri::command]
pub fn save_tracing_svg(app: AppHandle, svg: String, filename: String, settings: Option<MicrostockSettings>) -> Result<String, AppError> {
    if svg.len() > 20 * 1024 * 1024 {
        return Err(AppError::PayloadTooLarge);
    }
    let svg = if let Some(settings) = settings { render_tracing_export(svg, settings, "svg".into(), filename.clone())? } else { validate_tracing_svg(&svg)?; svg };
    let directory = export_directory(&app, None)?;
    let path = unique_download_path(&directory, &safe_svg_filename(&filename));
    if svg.len() > 45_000_000 { return Err(AppError::PayloadTooLarge); }
    std::fs::write(&path, svg).map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn save_tracing_eps(
    app: AppHandle,
    svg: Option<String>,
    bytes: Option<Vec<u8>>,
    filename: String,
) -> Result<String, AppError> {
    let directory = export_directory(&app, None)?;
    let raw_filename = if filename.ends_with(".eps") {
        filename
    } else {
        format!("{}.eps", filename.trim_end_matches(".svg"))
    };
    let safe_filename = safe_eps_filename(&raw_filename);
    let data: Vec<u8> = if let Some(b) = bytes {
        if b.len() > 45_000_000 {
            return Err(AppError::PayloadTooLarge);
        }
        b
    } else if let Some(s) = svg {
        if s.len() > 20 * 1024 * 1024 {
            return Err(AppError::PayloadTooLarge);
        }
        recorder::eps::build_tracing_eps(&s, &safe_filename)?
    } else {
        return Err(AppError::InvalidEvent("Payload kosong".into()));
    };
    let path = unique_download_path(&directory, &safe_filename);
    if data.len() > 45_000_000 { return Err(AppError::PayloadTooLarge); }
    std::fs::write(&path, data).map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn save_tracing_batch(app: AppHandle, entries: Vec<crate::tracing_batch::BatchEntry>) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let zip = crate::tracing_batch::make_zip(&entries)?;
        let directory = export_directory(&app, None)?;
        let is_eps = entries.first().map(|e| e.filename.ends_with(".eps")).unwrap_or(false);
        let zip_name = if is_eps { "tracing-batch-eps.zip" } else { "tracing-batch.zip" };
        let path = unique_download_path(&directory, zip_name);
        std::fs::write(&path, zip).map_err(|error| AppError::Storage(error.to_string()))?;
        Ok(path.to_string_lossy().into_owned())
    }).await.map_err(|error| AppError::Storage(error.to_string()))?
}

pub(crate) fn validate_tracing_svg(svg: &str) -> Result<(), AppError> {
    let document = roxmltree::Document::parse(svg)
        .map_err(|_| AppError::InvalidEvent("SVG tracing tidak valid".into()))?;
    let root = document.root_element();
    if root.tag_name().name() != "svg" || root.tag_name().namespace() != Some("http://www.w3.org/2000/svg") {
        return Err(AppError::InvalidEvent("Dokumen harus berupa SVG".into()));
    }
    let mut clips = std::collections::HashSet::new();
    let mut references = Vec::new();
    for node in root.descendants().filter(|node| node.is_element()) {
        if node.tag_name().namespace() != Some("http://www.w3.org/2000/svg") {
            return Err(AppError::InvalidEvent("Namespace SVG tidak diizinkan".into()));
        }
        let allowed: &[&str] = match node.tag_name().name() {
            "svg" if node == root => &["width", "height", "viewBox"],
            "defs" if node.parent_element() == Some(root) => &[],
            "clipPath" if node.parent_element().is_some_and(|p| p.has_tag_name("defs")) => &["id", "clipPathUnits"],
            "path" if node.parent_element() == Some(root) => &["fill", "fill-rule", "d", "clip-path"],
            "path" if node.parent_element().is_some_and(|p| p.has_tag_name("clipPath")) => &["clip-rule", "d"],
            _ => return Err(AppError::InvalidEvent("Elemen SVG tracing tidak diizinkan".into())),
        };
        for attribute in node.attributes() {
            if attribute.namespace().is_some() || !allowed.contains(&attribute.name())
                || (attribute.name() != "clip-path" && attribute.value().contains("url(")) {
                return Err(AppError::InvalidEvent("Atribut SVG tracing tidak diizinkan".into()));
            }
            if attribute.name() == "fill" {
                let color = attribute.value();
                if color.len() != 7 || !color.starts_with('#') || !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit()) {
                    return Err(AppError::InvalidEvent("Warna SVG tracing tidak valid".into()));
                }
            }
        }
        if node.has_tag_name("clipPath") {
            let id = node.attribute("id").unwrap_or("");
            if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
                || !clips.insert(id) || node.attribute("clipPathUnits").is_some_and(|v| v != "userSpaceOnUse")
                || !node.children().any(|child| child.is_element()) {
                return Err(AppError::InvalidEvent("Definisi clip tracing tidak valid".into()));
            }
        }
        if node.has_tag_name("path") && node.parent_element().is_some_and(|p| p.has_tag_name("clipPath")) {
            if node.attribute("clip-rule").is_some_and(|v| v != "nonzero")
                || node.attribute("d").and_then(recorder::eps::path_to_postscript).is_none() {
                return Err(AppError::InvalidEvent("Path clip tracing tidak valid".into()));
            }
        }
        if let Some(reference) = node.attribute("clip-path") {
            let id = reference.strip_prefix("url(#").and_then(|v| v.strip_suffix(')'))
                .filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_')))
                .ok_or_else(|| AppError::InvalidEvent("Referensi clip tracing tidak valid".into()))?;
            references.push(id);
        }
    }
    if references.iter().any(|id| !clips.contains(id)) {
        return Err(AppError::InvalidEvent("Clip tracing tidak tersedia".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tracing_export_tests {
    use super::validate_tracing_svg;

    #[test]
    fn clipped_underpaint_survives_export_layout_and_batch() {
        let source = r##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><defs><clipPath id="seam" clipPathUnits="userSpaceOnUse"><path clip-rule="nonzero" d="M1 1L7 1L7 7L1 7ZM3 3L3 5L5 5L5 3Z"/></clipPath></defs><path fill="#ff0000" fill-rule="evenodd" clip-path="url(#seam)" d="M0 0L8 0L8 8L0 8Z"/></svg>"##;
        let mut settings = super::MicrostockSettings::default();
        settings.ratio = "4:5".into();
        settings.artwork_scale = 1.3;
        settings.transparent_background = true;
        let svg = super::render_tracing_export(source.into(), settings.clone(), "svg".into(), "clipped".into()).unwrap();
        let eps = super::render_tracing_export(source.into(), settings.clone(), "eps".into(), "clipped".into()).unwrap();
        assert!(svg.contains("clip-path=\"url(#seam)\""));
        assert!(svg.contains("<clipPath id=\"seam\""));
        assert_eq!(eps.matches("clip\nnewpath\n").count(), 1);
        assert_eq!(eps.matches("setrgbcolor").count(), 1);
        assert!(eps.contains("3 3 moveto\n3 5 lineto\n5 5 lineto\n5 3 lineto\nclosepath\nclip\n"));
        assert!(eps.find(" scale\n").unwrap() < eps.find("clip\n").unwrap());
        let zip = crate::tracing_batch::make_zip(&[crate::tracing_batch::BatchEntry {
            filename: "clipped.svg".into(), svg: source.into(), bytes: None, settings: Some(settings),
        }]).unwrap();
        assert!(String::from_utf8_lossy(&zip).contains("clip-path=\"url(#seam)\""));
    }

    #[test]
    fn offline_exports_share_online_artboard_background_and_scale() {
        let source = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2400\" height=\"2400\" viewBox=\"0 0 32 32\"><path fill=\"#ff0000\" d=\"M0 0L32 0L0 32Z\"/></svg>";
        let mut settings = super::MicrostockSettings::default();
        settings.ratio = "4:5".into();
        settings.artwork_scale = 0.8;
        for transparent in [false, true] {
            settings.transparent_background = transparent;
            let svg = super::render_tracing_export(source.into(), settings.clone(), "svg".into(), "test".into()).unwrap();
            let eps = super::render_tracing_export(source.into(), settings.clone(), "eps".into(), "test".into()).unwrap();
            let (w, h, _) = crate::recorder::validator::artboard(32.0, 32.0, &settings);
            assert_eq!(w * 5, h * 4);
            assert!(svg.contains(&format!("viewBox=\"0 0 {w} {h}\"")));
            assert!(eps.contains(&format!("%%BoundingBox: 0 0 {w} {h}")));
            assert_eq!(svg.contains("background-color"), !transparent);
            assert_eq!(eps.contains("% Background"), !transparent);
            assert!(eps.contains("1 0 0 setrgbcolor"));
            assert!(!eps.contains("<?xpacket"));
            let scale = w as f64 * 0.9 / 32.0 * 0.8;
            assert!(eps.contains(&format!("{} {} scale", crate::recorder::transform::f(scale), crate::recorder::transform::f(scale))));
        }
        settings.min_pixels = 1_000_000.0;
        assert!(super::render_tracing_export(source.into(), settings, "svg".into(), "test".into()).is_err());
    }

    #[test]
    fn accepts_generated_paths_and_rejects_active_or_external_content() {
        let wrap = |content: &str| format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\">{content}</svg>");
        assert!(validate_tracing_svg(&wrap("<path fill=\"#ffc107\" fill-rule=\"evenodd\" d=\"M0 0L32 0L0 32Z\"/>")).is_ok());
        for invalid in ["<script>alert(1)</script>", "<image href=\"https://example.com/x\"/>", "<path onload=\"alert(1)\"/>", "<path fill=\"URL(https://example.com/x)\"/>", "<path xmlns=\"https://example.com\"/>"] {
            assert!(validate_tracing_svg(&wrap(invalid)).is_err());
        }
        assert!(validate_tracing_svg("not xml").is_err());
    }

    #[test]
    fn accepts_only_local_generated_clip_definitions() {
        let wrap = |content: &str| format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\">{content}</svg>");
        let defs = r#"<defs><clipPath id="seam" clipPathUnits="userSpaceOnUse"><path clip-rule="nonzero" d="M1 1L7 1L7 7Z"/></clipPath></defs>"#;
        let painted = r##"<path fill="#ff0000" clip-path="url(#seam)" d="M0 0L8 0L8 8Z"/>"##;
        assert!(validate_tracing_svg(&wrap(&format!("{painted}{defs}"))).is_ok());
        for invalid in [
            painted.to_string(),
            format!("{defs}{defs}{painted}"),
            format!("{defs}{}", painted.replace("url(#seam)", "url(https://example.com/clip)")),
            format!("{defs}{}", painted.replace("url(#seam)", "url(#missing)")),
            format!("{}{painted}", defs.replace("userSpaceOnUse", "objectBoundingBox")),
            format!("{}{painted}", defs.replace("nonzero", "evenodd")),
            format!("{}{painted}", defs.replace("<path", "<path onload=\"alert(1)\"")),
            format!("{}{painted}", defs.replace("M1 1L7 1L7 7Z", "invalid path")),
            "<defs><path d=\"M0 0L8 8\"/></defs>".into(),
            "<defs><clipPath id=\"seam\"><use href=\"https://example.com/x\"/></clipPath></defs>".into(),
        ] {
            assert!(validate_tracing_svg(&wrap(&invalid)).is_err(), "{invalid}");
        }
    }
}

#[tauri::command]
pub fn save_eps(
    app: AppHandle,
    state: State<'_, AppState>,
    canvas_id: String,
    settings: Option<MicrostockSettings>,
    filename: Option<String>,
    save_directory: Option<String>,
) -> Result<String, AppError> {
    let data = canvas_or_error(&state, &canvas_id)?;
    let raw_filename = filename.as_deref().unwrap_or("vectorized-result.eps");
    let safe_filename = safe_eps_filename(raw_filename);
    let (eps, (width, height, _)) =
        recorder::eps::build_canvas_eps(&data, &settings.unwrap_or_default(), &safe_filename);
    check_stock_artboard(width, height)?;
    let directory = export_directory(&app, save_directory.as_deref())?;
    let path = unique_download_path(&directory, &safe_filename);
    if eps.len() > 45_000_000 { return Err(AppError::PayloadTooLarge); }
    std::fs::write(&path, eps).map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn save_eps_asset(
    app: AppHandle,
    state: State<'_, AppState>,
    svg_id: String,
    settings: Option<MicrostockSettings>,
    filename: Option<String>,
    source_markup: Option<String>,
    save_directory: Option<String>,
) -> Result<String, AppError> {
    let asset = svg_asset_with_markup(&state, &svg_id, source_markup)?;
    let raw_filename = filename.as_deref().unwrap_or(&asset.filename);
    let safe_filename = safe_eps_filename(raw_filename);
    let (eps, (width, height, _)) =
        recorder::eps::build_svg_asset_eps(&asset, &settings.unwrap_or_default(), &safe_filename);
    check_stock_artboard(width, height)?;
    let directory = export_directory(&app, save_directory.as_deref())?;
    let path = unique_download_path(&directory, &safe_filename);
    if eps.len() > 45_000_000 { return Err(AppError::PayloadTooLarge); }
    std::fs::write(&path, eps).map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

fn check_stock_artboard(width: u64, height: u64) -> Result<(), AppError> {
    if !(15_000_000..=65_000_000).contains(&width.saturating_mul(height)) {
        return Err(AppError::InvalidEvent("Adobe Stock memerlukan artboard 15?65 MP. Sesuaikan ukuran atau rasio artboard.".into()));
    }
    Ok(())
}

fn export_directory(app: &AppHandle, selected: Option<&str>) -> Result<PathBuf, AppError> {
    if let Some(selected) = selected {
        let directory = PathBuf::from(selected);
        if !directory.is_absolute() || !directory.is_dir() {
            return Err(AppError::Storage(format!(
                "Lokasi simpan tidak tersedia: {}",
                directory.display()
            )));
        }
        return Ok(directory);
    }
    let downloads = app.path().download_dir().map_err(|error| AppError::Storage(error.to_string()))?;
    std::fs::create_dir_all(&downloads).map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(downloads)
}

fn safe_svg_filename(filename: &str) -> String {
    let base = Path::new(filename)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("vectorized-result.svg");
    let mut safe = base
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    if safe.is_empty() || safe == "." || safe == ".." {
        safe = "vectorized-result.svg".into();
    }
    if !safe.to_ascii_lowercase().ends_with(".svg") {
        safe.push_str(".svg");
    }
    safe
}

fn safe_eps_filename(filename: &str) -> String {
    let base = Path::new(filename)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("vectorized-result.eps");
    let mut safe = base
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    if safe.is_empty() || safe == "." || safe == ".." {
        safe = "vectorized-result.eps".into();
    }
    if safe.to_ascii_lowercase().ends_with(".svg") {
        safe = safe[..safe.len() - 4].to_string();
    }
    if !safe.to_ascii_lowercase().ends_with(".eps") {
        safe.push_str(".eps");
    }
    safe
}

fn unique_download_path(directory: &Path, filename: &str) -> PathBuf {
    let first = directory.join(filename);
    if !first.exists() {
        return first;
    }
    let p = Path::new(filename);
    let stem = p
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("vectorized-result");
    let ext = p
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("svg");
    for index in 1..100_000 {
        let candidate = directory.join(format!("{stem}_{index}.{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}_{}.{ext}", uuid::Uuid::new_v4()))
}

#[tauri::command]
pub fn clear_recording(_app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    state.recorder.lock().map_err(|_| AppError::State)?.clear();
    Ok(())
}

#[tauri::command]
pub fn clear_surfaces(_app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    state
        .recorder
        .lock()
        .map_err(|_| AppError::State)?
        .clear_surfaces();
    Ok(())
}

#[tauri::command]
pub fn open_target_url(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    url: String,
) -> Result<(), AppError> {
    let parsed = url::Url::parse(&url).map_err(|_| AppError::InvalidUrl)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidUrl);
    }
    target_platform::close_target_views(&app)?;
    let tab_id = new_tab_id();
    {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        target.session_id = session_id.clone();
        target.tabs = vec![TargetTab {
            id: tab_id.clone(),
            url: parsed.to_string(),
            title: "Memuat…".into(),
            webview_label: "target".into(),
        }];
        target.active_id = Some(tab_id.clone());
    }
    let token =
        serde_json::to_string(&session_id).map_err(|e| AppError::InvalidEvent(e.to_string()))?;
    let script = target_script(&token, &tab_id, &state)?;
    let result = target_platform::open_target_window(&app, parsed, script);
    if let Err(error) = result {
        *state.target.lock().map_err(|_| AppError::State)? = TargetState::default();
        return Err(error);
    }
    broadcast_target_tabs(&app, &state)?;
    Ok(())
}

#[tauri::command]
pub fn open_mahes_app(_app: AppHandle) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(MAHES_APP_URL).spawn();

    #[cfg(target_os = "windows")]
    let result = Command::new("cmd")
        .args(["/C", "start", "", MAHES_APP_URL])
        .spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(MAHES_APP_URL).spawn();

    result
        .map(|_| ())
        .map_err(|error| AppError::Window(format!("Unable to open mahes.app: {error}")))
}

#[tauri::command]
pub fn open_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<(), AppError> {
    target_platform::open_target_tab(app, state, url)
}

#[cfg(any())]
#[tauri::command]
fn legacy_open_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<(), AppError> {
    let parsed = url::Url::parse(&url).map_err(|_| AppError::InvalidUrl)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidUrl);
    }
    let window = app
        .get_window("target")
        .ok_or_else(|| AppError::Window("Target window tidak ditemukan.".into()))?;
    let tab_id = new_tab_id();
    let webview_label = if cfg!(target_os = "windows") {
        "target".into()
    } else {
        format!("target-{tab_id}")
    };
    let session_id = {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        if target.tabs.is_empty() || target.session_id.is_empty() {
            return Err(AppError::Window("Sesi target belum siap.".into()));
        }
        if target.tabs.len() >= MAX_TARGET_TABS {
            return Err(AppError::Window(format!(
                "Maksimal {MAX_TARGET_TABS} tab dapat dibuka dalam satu window."
            )));
        }
        target.tabs.push(TargetTab {
            id: tab_id.clone(),
            url: parsed.to_string(),
            title: "Memuat…".into(),
            webview_label: webview_label.clone(),
        });
        target.active_id = Some(tab_id.clone());
        target.session_id.clone()
    };

    // WebView2 has known issues with dynamically adding child webviews. On
    // Windows, keep one webview and navigate it instead of creating a child.
    if cfg!(target_os = "windows") {
        let result = app
            .get_webview("target")
            .ok_or_else(|| AppError::Window("WebView target tidak ditemukan.".into()))?
            .navigate(parsed.clone());
        if let Err(error) = result {
            let mut target = state.target.lock().map_err(|_| AppError::State)?;
            target.tabs.retain(|tab| tab.id != tab_id);
            target.active_id = target.tabs.last().map(|tab| tab.id.clone());
            return Err(AppError::Window(error.to_string()));
        }
        broadcast_target_tabs(&app, &state)?;
        return Ok(());
    }

    let token =
        serde_json::to_string(&session_id).map_err(|e| AppError::InvalidEvent(e.to_string()))?;
    let script = target_script(&token, &tab_id, &state)?;
    let script_on_load = script.clone();
    let size = window
        .inner_size()
        .map_err(|e| AppError::Window(e.to_string()))?;
    let builder = WebviewBuilder::new(&webview_label, WebviewUrl::External(parsed));
    let builder = if cfg!(target_os = "windows") {
        builder.initialization_script(&script)
    } else {
        builder.initialization_script_for_all_frames(&script)
    };
    let result = window.add_child(
        builder.on_page_load(move |webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Started) {
                let _ = webview.eval(&script_on_load);
            }
        }),
        LogicalPosition::new(0.0, 0.0),
        size,
    );
    if let Err(error) = result {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        target.tabs.retain(|tab| tab.id != tab_id);
        target.active_id = target.tabs.last().map(|tab| tab.id.clone());
        return Err(AppError::Window(error.to_string()));
    }
    activate_target_webview(&app, &webview_label)?;
    broadcast_target_tabs(&app, &state)?;
    Ok(())
}

#[tauri::command]
pub fn switch_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), AppError> {
    target_platform::switch_target_tab(app, state, tab_id)
}

#[cfg(any())]
#[tauri::command]
fn legacy_switch_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), AppError> {
    let (webview_label, url) = {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        let tab = target
            .tabs
            .iter()
            .find(|tab| tab.id == tab_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound("Tab target tidak ditemukan.".into()))?;
        target.active_id = Some(tab_id);
        (tab.webview_label, tab.url)
    };
    if cfg!(target_os = "windows") {
        let parsed = url::Url::parse(&url).map_err(|_| AppError::InvalidUrl)?;
        app.get_webview("target")
            .ok_or_else(|| AppError::Window("WebView target tidak ditemukan.".into()))?
            .navigate(parsed)
            .map_err(|e| AppError::Window(e.to_string()))?;
        return broadcast_target_tabs(&app, &state);
    }
    activate_target_webview(&app, &webview_label)?;
    broadcast_target_tabs(&app, &state)
}

#[tauri::command]
pub fn close_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), AppError> {
    let (tab_exists, closes_last_tab) = {
        let target = state.target.lock().map_err(|_| AppError::State)?;
        (
            target.tabs.iter().any(|tab| tab.id == tab_id),
            target.tabs.len() == 1,
        )
    };
    if !tab_exists {
        return Err(AppError::NotFound("Tab target tidak ditemukan.".into()));
    }
    if closes_last_tab {
        target_platform::close_target_views(&app)?;
        *state.target.lock().map_err(|_| AppError::State)? = TargetState::default();
        state.recorder.lock().map_err(|_| AppError::State)?.stop();
        let _ = app.emit("target-closed", ());
        return Ok(());
    }
    target_platform::close_target_tab(app, state, tab_id)
}

#[tauri::command]
pub fn reload_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), AppError> {
    target_platform::reload_target_tab(&app, &state, &tab_id)
}

#[tauri::command]
pub fn set_target_view_visible(
    app: AppHandle,
    state: State<'_, AppState>,
    visible: bool,
) -> Result<(), AppError> {
    target_platform::set_target_view_visible(&app, &state, visible)
}

#[tauri::command]
pub fn restore_target_view(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    target_platform::restore_target_view(&app, state)
}

#[tauri::command]
pub fn resize_target_view(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    target_platform::resize_target_view(&app, x, y, width, height)
}

#[cfg(any())]
#[tauri::command]
fn legacy_close_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), AppError> {
    let (webview_label, next_id, next_url, closing_active) = {
        let target = state.target.lock().map_err(|_| AppError::State)?;
        if target.tabs.len() <= 1 {
            return Err(AppError::Window("Tab terakhir tidak dapat ditutup.".into()));
        }
        let index = target
            .tabs
            .iter()
            .position(|tab| tab.id == tab_id)
            .ok_or_else(|| AppError::NotFound("Tab target tidak ditemukan.".into()))?;
        let closing_active = target.active_id.as_deref() == Some(tab_id.as_str());
        let next_id = if closing_active {
            let next_index = index.saturating_sub(1).min(target.tabs.len() - 2);
            target.tabs[next_index].id.clone()
        } else {
            target.active_id.clone().ok_or_else(|| AppError::State)?
        };
        let next_url = target
            .tabs
            .iter()
            .find(|tab| tab.id == next_id)
            .map(|tab| tab.url.clone())
            .ok_or_else(|| AppError::NotFound("Tab target berikutnya tidak ditemukan.".into()))?;
        (
            target.tabs[index].webview_label.clone(),
            next_id,
            next_url,
            closing_active,
        )
    };

    if cfg!(target_os = "windows") {
        {
            let mut target = state.target.lock().map_err(|_| AppError::State)?;
            target.tabs.retain(|tab| tab.id != tab_id);
            if closing_active {
                target.active_id = Some(next_id.clone());
            }
        }
        if closing_active {
            let parsed = url::Url::parse(&next_url).map_err(|_| AppError::InvalidUrl)?;
            app.get_webview("target")
                .ok_or_else(|| AppError::Window("WebView target tidak ditemukan.".into()))?
                .navigate(parsed)
                .map_err(|e| AppError::Window(e.to_string()))?;
        }
        return broadcast_target_tabs(&app, &state);
    }

    if let Some(webview) = app.get_webview(&webview_label) {
        webview
            .close()
            .map_err(|e| AppError::Window(e.to_string()))?;
    }
    {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        target.tabs.retain(|tab| tab.id != tab_id);
        if target.active_id.as_deref() == Some(tab_id.as_str()) {
            target.active_id = Some(next_id.clone());
        }
    }
    let next_label = state
        .target
        .lock()
        .map_err(|_| AppError::State)?
        .tabs
        .iter()
        .find(|tab| tab.id == next_id)
        .map(|tab| tab.webview_label.clone())
        .ok_or_else(|| AppError::NotFound("Tab target berikutnya tidak ditemukan.".into()))?;
    activate_target_webview(&app, &next_label)?;
    broadcast_target_tabs(&app, &state)
}

#[tauri::command]
pub fn sync_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    url: String,
    title: String,
) -> Result<(), AppError> {
    if url.is_empty() {
        return Ok(());
    }
    {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        if let Some(tab) = target.tabs.iter_mut().find(|tab| tab.id == tab_id) {
            tab.url = url;
            if !title.is_empty() {
                tab.title = title;
            }
        } else {
            return Ok(());
        }
    }
    broadcast_target_tabs(&app, &state)
}

#[tauri::command]
pub fn close_target_window(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    target_platform::close_target_views(&app)?;
    *state.target.lock().map_err(|_| AppError::State)? = TargetState::default();
    state.recorder.lock().map_err(|_| AppError::State)?.stop();
    let _ = app.emit("target-closed", ());
    Ok(())
}

pub(crate) fn new_tab_id() -> String {
    format!("tab-{}", uuid::Uuid::new_v4())
}

pub(crate) fn is_target_window_label(label: &str) -> bool {
    label == "target" || label.starts_with("target-")
}

pub(crate) fn target_webviews(app: &AppHandle) -> Vec<tauri::Webview> {
    if cfg!(target_os = "macos") {
        return app
            .get_window("main")
            .map(|window| {
                window
                    .webviews()
                    .into_iter()
                    .filter(|webview| is_target_window_label(webview.label()))
                    .collect()
            })
            .unwrap_or_default();
    }

    let mut webviews = Vec::new();
    for (label, window) in app.webview_windows() {
        if is_target_window_label(&label) {
            webviews.extend(window.webviews().into_values());
        }
    }
    webviews
}

pub(crate) fn target_payload(state: &TargetState) -> serde_json::Value {
    serde_json::json!({
        "active_id": state.active_id,
        "tabs": state.tabs.iter().map(|tab| serde_json::json!({
            "id": tab.id,
            "url": tab.url,
            "title": tab.title,
        })).collect::<Vec<_>>()
    })
}

pub(crate) fn target_script(
    token: &str,
    tab_id: &str,
    state: &State<'_, AppState>,
) -> Result<String, AppError> {
    let tab_token =
        serde_json::to_string(tab_id).map_err(|e| AppError::InvalidEvent(e.to_string()))?;
    let tabs = {
        let target = state.target.lock().map_err(|_| AppError::State)?;
        serde_json::to_string(&target_payload(&target))
            .map_err(|e| AppError::InvalidEvent(e.to_string()))?
    };
    let bridge = include_str!("../../src/recorder-bridge.js");
    let target_controls = include_str!("../../src/target-controls.js");
    let target_mode = if cfg!(target_os = "windows") || cfg!(target_os = "macos") {
        "multi-window"
    } else {
        "tabbed-window"
    };
    Ok(format!(
        "window.__CVR_SESSION_TOKEN__ = {token}; window.__CVR_TARGET_TAB_ID__ = {tab_token}; window.__CVR_TARGET_TABS__ = {tabs}; window.__CVR_TARGET_MODE__ = {target_mode};\n{target_controls}\n{bridge}",
        target_mode = serde_json::to_string(target_mode)
            .map_err(|e| AppError::InvalidEvent(e.to_string()))?
    ))
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn activate_target_webview(app: &AppHandle, active_label: &str) -> Result<(), AppError> {
    for webview in target_webviews(app) {
        if webview.label() == active_label {
            webview
                .show()
                .and_then(|_| webview.set_focus())
                .map_err(|e| AppError::Window(e.to_string()))?;
        } else {
            webview
                .hide()
                .map_err(|e| AppError::Window(e.to_string()))?;
        }
    }
    Ok(())
}

pub(crate) fn broadcast_target_tabs(
    app: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<(), AppError> {
    let target_state = {
        let target = state.target.lock().map_err(|_| AppError::State)?;
        target_payload(&target)
    };
    let payload =
        serde_json::to_string(&target_state).map_err(|e| AppError::InvalidEvent(e.to_string()))?;
    let script = format!("window.__CVR_SET_TABS__ && window.__CVR_SET_TABS__({payload});");
    for webview in target_webviews(app) {
        let _ = webview.eval(&script);
    }
    let _ = app.emit("target-tabs-updated", target_state);
    Ok(())
}

#[tauri::command]
pub fn validate_license(
    app: AppHandle,
    email: String,
    license_code: String,
) -> Result<license::LicenseStatus, AppError> {
    license::validate_code(&app, &email, &license_code)
}

#[tauri::command]
pub fn activate_license(
    app: AppHandle,
    email: String,
    license_code: String,
) -> Result<license::LicenseStatus, AppError> {
    license::activate_license(&app, &email, &license_code)
}

#[tauri::command]
pub fn get_license_status(app: AppHandle) -> Result<license::LicenseStatus, AppError> {
    license::status(&app)
}
