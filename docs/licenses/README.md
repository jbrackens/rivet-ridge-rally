# Vendored license sources

License evidence for shipped runtime components that are not installed npm packages belongs here. Installed package licenses remain authoritative in `node_modules` and are read directly by the distribution-notice generator.

| Component | Version | Upstream package | Registry archive SHA-256 | Upstream file | Local file SHA-256 |
|---|---:|---|---|---|---|
| zstddec | 0.2.0 | `https://registry.npmjs.org/zstddec/-/zstddec-0.2.0.tgz` | `4708fc2e97b5ae6e8c2545ceabdd965bfe8858a5064fce30380eeb4c6ba3f41d` | `package/LICENSE` | `8d078b49fc02bd63c1beaf4ddc629a8b48e4ba6a435415408c8209e2a5c3aacf` |

The local file is an exact byte-for-byte copy of the upstream archive member. `zstddec` is embedded in Three.js's KTX2 loader; it is intentionally not added as a project runtime dependency.

## Bundled font license

| Component | Distributed source | Upstream license source | Local license | Local SHA-256 |
|---|---|---|---|---|
| Barlow Condensed, Google Fonts v13 Latin WOFF2 subsets (700/900) | Versioned `fonts.gstatic.com/s/barlowcondensed/v13/` files recorded in `ASSET_LICENSES.md` | `google/fonts` `ofl/barlowcondensed/OFL.txt`, last changed at commit `a9741353ee641360301367de69a23234c0843ed9` | `docs/licenses/barlow-condensed-OFL-1.1.txt` | `186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f` |

The local OFL file is byte-identical to the official Google Fonts copy retrieved on 2026-07-15. The build-time verifier pins both WOFF2 files and this license by byte count, signature, and SHA-256; the distribution-notice generator includes the complete license text.
