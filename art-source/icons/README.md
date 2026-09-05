# App icon derivatives

`public/assets/icons/app-icon.svg` is the canonical project-authored helmet mark. The standard 192 px and 512 px PNGs are direct raster-size derivatives of that SVG.

`app-icon-maskable.svg` preserves the same vector paths and palette, adds only a full-bleed navy background, and scales the mark to 75% around the canvas center so the artwork remains inside a maskable-icon safe zone. It is source-only; the shipped maskable and opaque Apple-touch derivatives use this source.

The checked-in PNGs were generated on macOS with `sips-316`:

```sh
sips -s format png -z 192 192 public/assets/icons/app-icon.svg --out public/assets/icons/app-icon-192.png
sips -s format png -z 512 512 public/assets/icons/app-icon.svg --out public/assets/icons/app-icon-512.png
sips -s format png -z 180 180 art-source/icons/app-icon-maskable.svg --out public/assets/icons/apple-touch-icon-180.png
sips -s format png -z 512 512 art-source/icons/app-icon-maskable.svg --out public/assets/icons/app-icon-maskable-512.png
```

Raster bytes are platform-tool output and are pinned by size, dimensions, and SHA-256 in `ASSET_LICENSES.md` and `scripts/verify-production-art.mjs`.
