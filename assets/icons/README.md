# Tabometer icons

`tabometer-source.png` is the original user-supplied artwork, moved from the
repository root without alteration. Its background is already transparent.
The runtime PNGs trim excess transparent space, center the artwork on a square
with roughly 3% padding on each side, and downsample with Lanczos filtering.
The same design is used at every size; the smallest sizes necessarily lose detail.

Firefox uses the 16/32px icons for the toolbar and the larger sizes for other
extension surfaces, including high-density displays. See MDN's
[icons](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/icons)
and [action](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/action)
references. No extension permissions are needed for packaged icons.

To regenerate with ImageMagick 7, run from the repository root:

```sh
for size in 16 32 48 64 96 128; do
  magick assets/icons/tabometer-source.png -trim +repage \
    -gravity center -background none -extent 1072x1072 \
    -filter Lanczos -resize "${size}x${size}" -strip \
    "assets/icons/tabometer-${size}.png"
done
```

The Firefox test packager includes only the icon files referenced by the manifest,
excluding this document and the full-size source artwork.
