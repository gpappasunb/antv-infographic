# AntV Infographic Quarto Extension

A Quarto filter that renders [AntV Infographic](https://github.com/antvis/infographic)
code blocks to images. It works in HTML, Reveal.js, PDF (LaTeX and Typst) and
Word output.

## Installation

Install from the zip file, in the folder of your document or project:

```bash
quarto add /path/to/antv-infographic.zip
```

This creates `_extensions/antv-infographic/`. Unzipping the file in that folder
does the same:

```bash
unzip /path/to/antv-infographic.zip
```

Then enable the filter in the document header or in `_quarto.yml`:

```yaml
filters:
  - antv-infographic
```

The zip file does not contain the Node packages. The first render installs
them, which takes a minute or two and needs internet access. To install them
ahead of time:

```bash
cd _extensions/antv-infographic/scripts
npm install
```

To update the extension, run `quarto add` again with the new zip file.

Requirements:

- Quarto 1.5 or later.
- Node.js 18 or later, with npm.
- Chrome: Puppeteer downloads its own copy during `npm install`. To use
  another browser, set `PUPPETEER_EXECUTABLE_PATH`.
- Internet access while rendering: the library fetches its fonts from
  `assets.antv.antgroup.com` and looks icons up at `www.weavefox.cn`. The
  results are embedded in the image, so the finished document works offline.

## Usage

Write the infographic syntax in a code block with the class `infographic`
(`antv` also works):

````markdown
```infographic
infographic list-row-horizontal-icon-arrow
data
  title Customer Growth Engine
  desc Multi-channel reach and repeat purchases
  lists
    - label Acquire
      desc Paid channels and content marketing
      icon megaphone
    - label Convert
      desc Lead scoring and automated follow-up
      icon filter
```
````

Use a code block, not a `:::` div: the syntax depends on line breaks and
indentation, and Markdown does not keep those inside a div.

Add attributes for a caption, a cross-reference label or a size:

````markdown
```{.infographic #fig-growth fig-cap="The growth engine." width="80%"}
infographic list-row-horizontal-icon-arrow
...
```

See @fig-growth.
````

### Attributes

| Attribute | Description | Default |
|-----------|-------------|---------|
| `theme` | `light`, `dark` or `hand-drawn` | `light` |
| `format` | Image format: `svg`, `png` or `pdf` | by output format, see below |
| `scale` | Pixel ratio of PNG images | `3` |
| `width`, `height` | Display size, in any unit Pandoc accepts (`80%`, `12cm`, `400px`) | natural size |
| `fig-cap` | Caption (Markdown) | none |
| `#fig-…` | Label for cross-references; needs `fig-cap` | none |

Every other attribute, such as `fig-alt` or `fig-align`, is passed on to the
image.

### Image formats

The exported SVG keeps its text in `<foreignObject>` elements, which only web
browsers draw. The filter therefore picks the image format from the output
format:

| Output | Image |
|--------|-------|
| HTML, Reveal.js | SVG with embedded fonts |
| PDF through LaTeX or Typst | vector PDF with embedded fonts |
| Word and everything else | PNG at 3× resolution |

## Caching

Images are cached in `.antv-cache/`, next to the document. The file name is a
hash of the syntax, format, theme and scale, so an infographic is rendered
again only when one of those changes. Delete the folder to force a re-render.
All infographics of a document that are not in the cache are rendered in one
browser session.

If an infographic cannot be rendered, the filter prints a warning and leaves
the code block in the document.

## Infographic syntax

See the [syntax documentation](https://infographic.antv.vision/learn/infographic-syntax)
and the [template gallery](https://infographic.antv.vision/gallery).

## Rebuilding the zip file

After changing the extension, rebuild `antv-infographic.zip` from the folder
that contains `_extensions/`:

```bash
rm -f antv-infographic.zip
zip -r antv-infographic.zip _extensions \
  -x '*/node_modules/*' '*/.antv-cache/*' '*/test_files/*' \
     '*/test.qmd' '*/test.html' '*/test-module.html' '*/test-output.svg'
```

The `-x` patterns leave out the Node packages, the image cache and test files.

## License

MIT
