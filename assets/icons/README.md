# Tabometer icons

The design combines stacked browser tabs with a gauge: mint-green tab headers
and needle, a dark navy body, and a white gauge arc and tick marks. The PNGs have
transparent backgrounds. The imagery represents tab accumulation and measurement,
without assigning meaning to a tab count.

The replacement artwork and size variants were generated outside this repository
and supplied by the user:

- `tabometer-source.png`: 600 × 600 source artwork.
- `tabometer-{16,32,48,64,96,128}.png`: square runtime icons referenced by
  `manifest.json`. The toolbar action references the 16px and 32px versions.
- `tabometer-{256,512,1024}.png`: larger square versions retained for reuse.

The same design is used at every size; the smallest sizes necessarily lose detail.
The external generation process is not recorded here, so these supplied PNGs are
the maintained assets.

The Firefox test packager includes only the icon files referenced by the manifest,
excluding this document, the source artwork, and the 256px, 512px, and 1024px versions.
