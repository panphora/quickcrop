# quickcrop

> Crop an image before upload. One function, no dependencies, returns a Blob. Uses your modal system or brings its own.

**[Live demo →](https://quickcrop.panphora.com)**

```js
const result = await quickcrop(file, { aspect: 1, maxWidth: 512 });
// result: { blob, dataURL, width, height } on confirm, null on cancel
```

## Install

### CDN, one file (simplest)

```html
<script type="module">
  import quickcrop from 'https://cdn.jsdelivr.net/npm/quickcrop@1/quickcrop.js';
</script>
```

The script injects its own styles. To theme via CSS instead, link the stylesheet (the script then skips injection):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/quickcrop@1/quickcrop.css">
```

Those URLs are served straight from npm by jsDelivr, no setup. The `@1` pin tracks the latest 1.x release, so you get patches and minor updates but never a breaking major. Pin exactly with `quickcrop@1.0.0` to freeze a version, or drop the pin (`.../npm/quickcrop/quickcrop.js`) to ride the newest major. The same files are on unpkg too: `https://unpkg.com/quickcrop@1/quickcrop.js`.

### npm (bundlers)

```bash
npm install quickcrop
```

```js
import quickcrop from 'quickcrop';
// optional, only if you want to theme via CSS:
import 'quickcrop/quickcrop.css';
```

## Quick start

```html
<input type="file" id="avatar" accept="image/*">

<script type="module">
  import quickcrop from 'https://cdn.jsdelivr.net/npm/quickcrop@1/quickcrop.js';

  document.getElementById('avatar').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // allow re-selecting the same file

    const result = await quickcrop(file, { aspect: 1, maxWidth: 512 });
    if (!result) return; // cancelled

    const form = new FormData();
    form.append('avatar', result.blob, 'avatar' + (result.blob.type === 'image/png' ? '.png' : '.jpg'));
    await fetch('/upload', { method: 'POST', body: form });
  });
</script>
```

The user picks a file, a crop modal opens, they drag/resize the crop box (rule-of-thirds grid, corner handles, aspect lock if you set one), and confirm. You get back a `Blob` ready for `FormData`.

## Result

`quickcrop()` returns a Promise that resolves to:

- `{ blob, dataURL, width, height }` when the user confirms. `blob` is the cropped image, `dataURL` is the same image as a data URL (handy for instant previews), `width`/`height` are the output dimensions in pixels.
- `null` when the user cancels (Escape, backdrop click, or themodal's close button when themodal hosts).

It rejects on a non-File/Blob argument, an undecodable image, or a second call while a cropper is already open.

## Options

| Option | Default | Meaning |
|---|---|---|
| `aspect` | `null` | Width / height lock. `null` is a free crop. `1` is square, `16/9`, `4/3`, etc. |
| `type` | smart | Output mime type. Defaults to the input file's type when it is `image/jpeg`, `image/png`, or `image/webp`, otherwise `image/png`. A photo stays a jpeg instead of ballooning into a png. |
| `quality` | `0.92` | Encoder quality (0 to 1) for jpeg/webp. Ignored for png. |
| `maxWidth` | `null` | Cap the output width in pixels; the crop is downscaled proportionally. The upload-size lever. |
| `maxHeight` | `null` | Same for height. When both are set, the stricter one wins. |
| `minSize` | `40` | Minimum crop box edge in display pixels. |
| `labels` | `{ confirm: 'Crop' }` | Confirm button text. |
| `modal` | `'auto'` | `'auto'`, `'builtin'`, a [themodal](https://github.com/hyperclay/hyperclayjs) instance, or a custom adapter (below). |

## Modal systems

quickcrop separates the crop stage from the modal that hosts it.

- **`'auto'`** (default): if `window.themodal` (from [hyperclayjs](https://www.npmjs.com/package/hyperclayjs)) is present, quickcrop renders inside it, so a Hyperclay page gets platform-consistent modals for free. Otherwise the built-in modal is used.
- **`'builtin'`**: always use the built-in modal, even when themodal is present.
- **A themodal instance**: `quickcrop(file, { modal: themodal })` for ESM users who import themodal directly without globals.
- **A custom adapter**: plug in any modal system by normalizing it to one function:

```js
const myAdapter = {
  open({ content, confirmLabel, onConfirm, onCancel }) {
    // content is a live HTMLElement (the crop stage); put it in your modal.
    // Call onConfirm() when the user accepts, onCancel() when they dismiss
    // (Esc, backdrop, a close button: dismissal affordances are yours).
    // Only call them from user interaction, never during open() itself.
    const dialog = document.createElement('dialog');
    dialog.append(content);
    // ... your confirm button wired to onConfirm, dismissal to onCancel ...
    document.body.append(dialog);
    dialog.showModal();
    return { close() { dialog.close(); dialog.remove(); } };
  },
  // optional: tell quickcrop how much room your modal has for the image
  fit() {
    return { width: window.innerWidth * 0.8, height: window.innerHeight * 0.7 };
  },
};

await quickcrop(file, { modal: myAdapter });
```

## Theming

The default look is the warm "pixel quiet" palette. Override any of the CSS variables (set them after the stylesheet loads, or just link your own `quickcrop.css`):

```css
:root {
  --qc-surface: #17191d;
  --qc-surface-hover: #1f242b;
  --qc-border: #2a2e35;
  --qc-text: #e7e9ee;
  --qc-on-dark: #0f1012;
}
```

| Variable | Default | Used for |
|---|---|---|
| `--qc-surface` | `#f7f2ea` | Modal and button background |
| `--qc-surface-hover` | `#efe7d8` | Button hover |
| `--qc-border` | `#cdbfa6` | Modal and button borders |
| `--qc-text` | `#2b241b` | Text and the primary button background |
| `--qc-text-hover` | `#463c2e` | Primary button hover |
| `--qc-on-dark` | `#efe7d8` | Text on the primary button |
| `--qc-overlay` | `rgba(43,36,27,.6)` | Backdrop |
| `--qc-dim` | `rgba(0,0,0,.55)` | Dimming outside the crop box |
| `--qc-radius` | `8px` | Modal corner radius |
| `--qc-crop-line` | `#fff` | Crop box outline, grid, and handles |
| `--qc-font` | `ui-sans-serif, system-ui, sans-serif` | Modal font |

## Browser support

All modern browsers, mouse and touch. Needs ES modules, pointer events, and `canvas.toBlob`, which everything from 2020 onward has. EXIF orientation in photos is handled by the browser itself (`image-orientation: from-image` is the default everywhere now).

Device notes:

- Output is capped at ~16.7 million pixels, the canvas area iOS Safari can reliably encode; larger crops are downscaled proportionally. Use `maxWidth`/`maxHeight` to cap lower.
- The realized format is `result.blob.type`: engines without a webp canvas encoder (older Safari) fall back to png per spec.
- Browsers generally cannot decode HEIC/HEIF in `<img>`, so quickcrop rejects those files with `could not decode image`. In practice iOS file inputs transcode camera-roll HEIC to jpeg on selection, so upload flows rarely see one.

## Develop / publish

```bash
npm run build   # syncs version + embedded CSS into quickcrop.js, README.md, llms.txt
npm test        # Playwright specs in test/
npm publish     # publishes quickcrop.js + quickcrop.css (runs build automatically)
```

## License

MIT-0 (MIT No Attribution).
