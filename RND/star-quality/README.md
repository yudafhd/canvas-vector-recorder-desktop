# Sparkle tip regression

Source: `../aset_jpg/Creating_minimalist_silhouette_l…_2K_20261003023352.jpg` supplied by the user (2400x1792).

`source.rgba` is the 1024x765 RGBA processing raster, generated with System.Drawing HighQualityBicubic. This reproduces the defect, but the resampler is not identical to the browser canvas used by the UI.

Options: colors=6, tolerance=0.8, minArea=4, smooth=true, white removal disabled.

- `before.svg` / `after.svg`: full-image exports before and after cusp reconstruction.
- `before.bmp` / `after.bmp`: 10x magnification of the small black sparkle at processing coordinates x=119..147, y=77..105, independently rasterized from SVG paths with 64 samples per cubic. These previews are not screenshots of the live desktop application.
- `audit.mjs`: rerun from the repository root with `node RND/star-quality/audit.mjs after`. Render an existing export with `node RND/star-quality/audit.mjs before render`.
- `tests/fixtures/sparkle-source-28x28.rgba`: source crop used for automated regression.

The old corner heuristic both missed actual tips and locked two endpoints around the left tip. The correction detects short raster caps using their convergent, widening flanks, consolidates nearby corner guards, and pins a single midpoint before smoothing. It does not extend the silhouette beyond the raster cap. No shape-specific template is used.

The actual full-image sparkle now has four single-point cusps, at (132.5,84), (140,91.5), (132.5,98), and (126,91). Its formerly vertical left cap from (126,92) to (126,90) is gone. The full output retains 184 paths; segment count changes from 1765 to 1767. The rule also applies to qualifying tips elsewhere in the image.

Validation: TypeScript compile, 69 frontend tests, Vite production build, and git diff whitespace checks passed. Existing circle/tangent, sharp branch, topology, transparency, and straight-edge regressions remain passing. New tests cover the actual four-tip contour, rotation, flat stroke ends, small squares, open chains, and the source crop at detail tolerances 0.35/0.8/1.6.

## Auto pipeline audit

`node RND/star-quality/auto-audit.mjs` runs the three Auto components on the same source raster. `auto-report.json` records recommendation, selection, final options, attempts, error and runtime. `auto.svg` is the full output and `auto.bmp` is the sparkle crop, rendered with `node RND/star-quality/audit.mjs auto render`.

Auto selects colors=2, tolerance=0.2, minArea=12, resolution=1024, whiteMode=background. Preview selection keeps the detected baseline, final tracing completes in one attempt without fallback. The working raster remains 1024x765. This output deliberately differs from the manual six-color comparison above: Auto removes the white background and consolidates JPEG shade paths into the black/white palette.

## Scene quality and global stroke audit

`global-auto.svg` / `global-auto-report.json` / `global-auto.bmp` repeat the 1024 audit with scene gates and global stroke regularization. The result retains 85 paths, 1787 segments and all four sparkle tips. Three global proposals are evaluated and rejected; protected detail is accepted. Runtime was about 9 seconds after replacing the dense geometric guard with a spatial segment grid.

`global-auto-2048.svg` / `global-auto-2048-report.json` / `global-auto-2048.bmp` use the original JPEG resized to 2048x1529 with System.Drawing HighQualityBicubic. Auto recommends 2048, finishes in one attempt without fallback, and exports 85 paths / 2849 segments. Global error is 0.000267259; three global proposals are rejected. Runtime was about 10 seconds. These measurements describe this machine and resampler; the two resolutions do not share identical pixel masks or edge-error denominators.

Run an audit with `node RND/star-quality/auto-audit.mjs global-auto`; supply a different RGBA file and its width as the third/fourth arguments for high resolution. Render any existing SVG with `node RND/star-quality/audit.mjs global-auto-2048 render`; the crop coordinates scale to its viewBox. Large temporary RGBA files are not stored in this folder.
