import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const QUICKCROP = path.resolve(dir, '..', 'quickcrop.js');
const QUICKCROP_CSS = path.resolve(dir, '..', 'quickcrop.css');
const THEMODAL = path.resolve(dir, '..', '..', 'hyperclayjs', 'src', 'ui', 'theModal.js');

async function load(page) {
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ path: QUICKCROP, type: 'module' });
  await page.waitForFunction(() => typeof window.quickcrop === 'function');
}

// quadrant-colored test image: red | green / blue | yellow
async function makeFile(page, { width = 400, height = 200, type = 'image/png' } = {}) {
  await page.evaluate(async ({ width, height, type }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, width / 2, height / 2);
    ctx.fillStyle = '#00ff00'; ctx.fillRect(width / 2, 0, width / 2, height / 2);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(0, height / 2, width / 2, height / 2);
    ctx.fillStyle = '#ffff00'; ctx.fillRect(width / 2, height / 2, width / 2, height / 2);
    const blob = await new Promise(r => canvas.toBlob(r, type));
    window.__file = new File([blob], type === 'image/jpeg' ? 'test.jpg' : 'test.png', { type });
  }, { width, height, type });
}

// opens the cropper; the promise's outcome lands on window.__done/__result/__error.
// opts.modal === '__adapter' is swapped for window.__adapter inside the page.
async function open(page, opts = {}) {
  await page.evaluate(opts => {
    window.__done = false;
    window.__result = undefined;
    window.__error = undefined;
    if (opts.modal === '__adapter') opts.modal = window.__adapter;
    window.quickcrop(window.__file, opts).then(
      r => {
        window.__result = r && {
          width: r.width,
          height: r.height,
          blobType: r.blob.type,
          blobSize: r.blob.size,
          dataURL: r.dataURL,
        };
        window.__done = true;
      },
      e => {
        window.__error = e.message;
        window.__done = true;
      }
    );
  }, opts);
  await page.waitForSelector('.qc-stage');
}

async function outcome(page) {
  await page.waitForFunction(() => window.__done);
  return page.evaluate(() => ({ result: window.__result ?? null, error: window.__error ?? null }));
}

// sample pixels of the result at fractional coordinates; returns [r,g,b,a][]
async function sample(page, points) {
  return page.evaluate(async points => {
    const img = new Image();
    img.src = window.__result.dataURL;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return points.map(([fx, fy]) => [
      ...ctx.getImageData(Math.round(fx * (c.width - 1)), Math.round(fy * (c.height - 1)), 1, 1).data,
    ]);
  }, points);
}

const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

// rendered [r,g,b] at a viewport point, via a 1x1 clip screenshot. The first
// pixel of a PNG's first row is filter-independent, so zlib is all we need.
async function shotPixel(page, x, y) {
  const buf = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const colorType = buf[25]; // 6 = RGBA, 2 = RGB
  const idat = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    if (buf.toString('ascii', pos + 4, pos + 8) === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return [raw[1], raw[2], raw[3], colorType];
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

test.describe('open and close', () => {
  test('opens the built-in modal with stage, box, dim overlay, and the confirm button', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page);
    await expect(page.locator('.qc-backdrop')).toBeVisible();
    await expect(page.locator('.qc-box')).toBeVisible();
    await expect(page.locator('.qc-dim')).toHaveCount(1);
    await expect(page.locator('.qc-handle')).toHaveCount(4);
    await expect(page.locator('.qc-btn')).toHaveCount(1);
    await expect(page.locator('.qc-btn-primary')).toHaveText('Crop');
  });

  test('Escape cancels and resolves null', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page);
    await page.keyboard.press('Escape');
    const { result } = await outcome(page);
    expect(result).toBe(null);
    await expect(page.locator('.qc-backdrop')).toHaveCount(0);
  });

  test('backdrop click cancels, click inside the modal does not', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page);
    await page.locator('.qc-modal').click({ position: { x: 4, y: 4 } });
    await expect(page.locator('.qc-backdrop')).toHaveCount(1);
    await page.mouse.click(5, 5);
    const { result } = await outcome(page);
    expect(result).toBe(null);
  });

  test('custom confirm label shows up', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { labels: { confirm: 'Use this' } });
    await expect(page.locator('.qc-btn-primary')).toHaveText('Use this');
    await expect(page.locator('.qc-btn')).toHaveCount(1);
    await page.keyboard.press('Escape');
  });

  test('rejects a second call while open, works again after cancel', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page);
    const msg = await page.evaluate(() =>
      window.quickcrop(window.__file).then(() => 'resolved', e => e.message)
    );
    expect(msg).toBe('quickcrop: already open');
    await page.keyboard.press('Escape');
    await outcome(page);
    await open(page);
    await expect(page.locator('.qc-backdrop')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('rejects non-File input and unknown modal values', async ({ page }) => {
    await load(page);
    await makeFile(page);
    const msg1 = await page.evaluate(() =>
      window.quickcrop('nope').then(() => 'resolved', e => e.message)
    );
    expect(msg1).toBe('quickcrop: expected a File or Blob');
    const msg2 = await page.evaluate(() =>
      window.quickcrop(window.__file, { modal: 'bogus' }).then(() => 'resolved', e => e.message)
    );
    expect(msg2).toContain('quickcrop: modal must be');
    await expect(page.locator('.qc-backdrop')).toHaveCount(0);
  });
});

test.describe('crop math', () => {
  // 400x200 source in an 800x600 viewport displays 1:1 (no scaling)

  test('free crop defaults to the whole image', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page);
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.width).toBe(400);
    expect(result.height).toBe(200);
    const [tl, tr, bl, br] = await sample(page, [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]);
    expect(tl.slice(0, 3)).toEqual([255, 0, 0]);
    expect(tr.slice(0, 3)).toEqual([0, 255, 0]);
    expect(bl.slice(0, 3)).toEqual([0, 0, 255]);
    expect(br.slice(0, 3)).toEqual([255, 255, 0]);
  });

  test('locked aspect starts with the largest centered rect', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { aspect: 1 });
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
    // centered square spans source x 100..300: still all four quadrants
    const [tl, tr] = await sample(page, [[0.1, 0.1], [0.9, 0.1]]);
    expect(tl.slice(0, 3)).toEqual([255, 0, 0]);
    expect(tr.slice(0, 3)).toEqual([0, 255, 0]);
  });

  test('dragging the box moves the crop window', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { aspect: 1 });
    const box = await page.locator('.qc-box').boundingBox();
    const c = center(box);
    await drag(page, c, { x: c.x - 150, y: c.y }); // clamps at the left edge
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.width).toBe(200);
    // box now spans source x 0..200: left half only, red over blue
    const [top, bottom] = await sample(page, [[0.5, 0.1], [0.5, 0.9]]);
    expect(top.slice(0, 3)).toEqual([255, 0, 0]);
    expect(bottom.slice(0, 3)).toEqual([0, 0, 255]);
  });

  test('corner resize keeps the aspect lock and respects minSize', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { aspect: 1 });
    const se = center(await page.locator('.qc-se').boundingBox());
    // shrink toward the anchor; dominant axis (dy=150 here) wins under the lock
    await drag(page, se, { x: se.x - 80, y: se.y - 50 });
    let box = await page.locator('.qc-box').boundingBox();
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
    expect(box.width).toBeLessThan(200);
    // collapse onto the anchor (the nw corner): minSize floor holds
    const se2 = center(await page.locator('.qc-se').boundingBox());
    const nw = center(await page.locator('.qc-nw').boundingBox());
    await drag(page, se2, { x: nw.x + 5, y: nw.y + 5 });
    box = await page.locator('.qc-box').boundingBox();
    expect(Math.round(box.width)).toBe(40);
    expect(Math.round(box.height)).toBe(40);
    await page.keyboard.press('Escape');
  });

  test('free-aspect corner resize moves both axes independently', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page);
    const stage = await page.locator('.qc-stage').boundingBox();
    const se = center(await page.locator('.qc-se').boundingBox());
    // anchor is the nw corner (stage origin); land at 150x80 from it
    await drag(page, se, { x: stage.x + 150, y: stage.y + 80 });
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.width).toBe(150);
    expect(result.height).toBe(80);
    const [px] = await sample(page, [[0.2, 0.2]]);
    expect(px.slice(0, 3)).toEqual([255, 0, 0]); // top-left region of the source
  });

  test('box movement clamps to the image bounds', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { aspect: 1 });
    const c = center(await page.locator('.qc-box').boundingBox());
    await drag(page, c, { x: c.x + 500, y: c.y + 500 });
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    // clamped at the right edge: source x 200..400, green over yellow
    const [top, bottom] = await sample(page, [[0.5, 0.1], [0.5, 0.9]]);
    expect(top.slice(0, 3)).toEqual([0, 255, 0]);
    expect(bottom.slice(0, 3)).toEqual([255, 255, 0]);
    expect(result.width).toBe(200);
  });
});

test.describe('output options', () => {
  test('explicit type wins and drives blob + dataURL', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { type: 'image/jpeg' });
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.blobType).toBe('image/jpeg');
    expect(result.dataURL).toMatch(/^data:image\/jpeg/);
  });

  test('smart default keeps a jpeg input as jpeg', async ({ page }) => {
    await load(page);
    await makeFile(page, { type: 'image/jpeg' });
    await open(page);
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.blobType).toBe('image/jpeg');
  });

  test('png input stays png by default', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page);
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.blobType).toBe('image/png');
  });

  test('maxWidth downscales the output proportionally', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { maxWidth: 100 });
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  test('maxHeight wins when stricter than maxWidth', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { maxWidth: 300, maxHeight: 50 });
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  test('webp output where the engine encodes it, png fallback elsewhere', async ({ page, browserName }) => {
    await load(page);
    await makeFile(page);
    await open(page, { type: 'image/webp' });
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    if (browserName === 'chromium') {
      expect(result.blobType).toBe('image/webp');
      expect(result.dataURL).toMatch(/^data:image\/webp/);
    } else {
      // engines without a webp canvas encoder fall back to png (spec behavior)
      expect(['image/webp', 'image/png']).toContain(result.blobType);
      expect(result.dataURL.split(';')[0]).toBe('data:' + result.blobType);
    }
  });

  test('output area is capped at the iOS-safe canvas limit', async ({ page }) => {
    await load(page);
    await makeFile(page, { width: 6000, height: 3000 }); // 18MP, over the 16.7MP cap
    await open(page);
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.width * result.height).toBeLessThanOrEqual(16777216);
    expect(result.width / result.height).toBeCloseTo(2, 2); // ratio preserved
    expect(result.width).toBeGreaterThan(5500); // shrunk barely, not collapsed
  });

  test('quality changes jpeg byte size', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { type: 'image/jpeg', quality: 0.1 });
    await page.locator('.qc-btn-primary').click();
    const low = (await outcome(page)).result.blobSize;
    await open(page, { type: 'image/jpeg', quality: 0.95 });
    await page.locator('.qc-btn-primary').click();
    const high = (await outcome(page)).result.blobSize;
    expect(low).toBeLessThan(high);
  });
});

test.describe('dim overlay', () => {
  test('the clip-path hole parses in this engine', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page, { aspect: 1 });
    // a rejected clip-path declaration computes to 'none', which would dim the box too
    const clip = await page.locator('.qc-dim').evaluate(n => getComputedStyle(n).clipPath);
    expect(clip).toContain('polygon');
    await page.keyboard.press('Escape');
  });

  test('the hole actually renders: dimmed outside the box, undimmed inside', async ({ page }) => {
    await load(page);
    // solid light gray so dimming is measurable per channel
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 200;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#c8c8c8';
      ctx.fillRect(0, 0, 400, 200);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      window.__file = new File([blob], 'gray.png', { type: 'image/png' });
    });
    await open(page, { aspect: 1 });
    await page.waitForTimeout(300); // let the backdrop fade-in settle
    const img = await page.locator('.qc-stage img').boundingBox();
    const box = await page.locator('.qc-box').boundingBox();
    const inside = await shotPixel(page, box.x + box.width / 2, box.y + box.height / 2);
    const outside = await shotPixel(page, img.x + 20, img.y + img.height / 2); // left strip
    expect(inside[0]).toBeGreaterThan(180); // ~200, undimmed
    expect(outside[0]).toBeLessThan(inside[0] * 0.7); // ~90 under the 55% dim
    await page.keyboard.press('Escape');
  });
});

test.describe('CSS self-injection', () => {
  test('injects its styles when the stylesheet is not linked', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page);
    await expect(page.locator('style[data-quickcrop]')).toHaveCount(1);
    await page.keyboard.press('Escape');
  });

  test('skips injection when quickcrop.css is present', async ({ page }) => {
    await load(page);
    await page.addStyleTag({ path: QUICKCROP_CSS });
    await makeFile(page);
    await open(page);
    await expect(page.locator('style[data-quickcrop]')).toHaveCount(0);
    await expect(page.locator('.qc-backdrop')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

test.describe('modal adapters', () => {
  test('a custom adapter receives the stage and label, and its close() runs', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await page.evaluate(() => {
      window.__calls = [];
      window.__adapter = {
        open({ content, confirmLabel, onConfirm, onCancel }) {
          window.__calls.push(['open', confirmLabel]);
          const host = document.createElement('div');
          host.id = 'fake-host';
          host.append(content);
          document.body.append(host);
          window.__fakeConfirm = onConfirm;
          window.__fakeCancel = onCancel;
          return { close: () => { window.__calls.push(['close']); host.remove(); } };
        },
      };
    });
    await open(page, { modal: '__adapter' });
    await expect(page.locator('#fake-host .qc-stage')).toBeVisible();
    await page.evaluate(() => window.__fakeConfirm());
    const { result } = await outcome(page);
    expect(result.width).toBe(400);
    const calls = await page.evaluate(() => window.__calls);
    expect(calls).toEqual([['open', 'Crop'], ['close']]);
  });

  test("modal: 'builtin' ignores a present window.themodal", async ({ page }) => {
    await load(page);
    await makeFile(page);
    await page.evaluate(() => {
      window.__tmOpened = false;
      window.themodal = {
        html: '', yes: '', no: '', closeHtml: '', disableFocus: false,
        open() { window.__tmOpened = true; },
        close() {},
        onYes() {}, onNo() {}, onOpen() {},
      };
    });
    await open(page, { modal: 'builtin' });
    await expect(page.locator('.qc-backdrop')).toBeVisible();
    expect(await page.evaluate(() => window.__tmOpened)).toBe(false);
    await page.keyboard.press('Escape');
  });
});

test.describe('failure handling', () => {
  test('tall skinny image crops at exact source size (per-axis scales)', async ({ page }) => {
    await load(page);
    await makeFile(page, { width: 20, height: 1923 });
    await open(page);
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.width).toBe(20);
    expect(result.height).toBe(1923);
    // bottom of the image is real pixels, not a transparent overrun
    const [bottom] = await sample(page, [[0.9, 0.99]]);
    expect(bottom).toEqual([255, 255, 0, 255]);
  });

  test('an adapter whose open() throws rejects and the cropper stays usable', async ({ page }) => {
    await load(page);
    await makeFile(page);
    const msg = await page.evaluate(() =>
      window.quickcrop(window.__file, { modal: { open() { throw new Error('boom'); } } })
        .then(() => 'resolved', e => e.message)
    );
    expect(msg).toBe('boom');
    await open(page);
    await expect(page.locator('.qc-backdrop')).toBeVisible();
    await page.keyboard.press('Escape');
    const { result } = await outcome(page);
    expect(result).toBe(null);
  });

  test('an encoding failure rejects, closes the modal, and the cropper stays usable', async ({ page }) => {
    await load(page);
    await makeFile(page);
    await open(page);
    await page.evaluate(() => {
      window.__origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function () { throw new Error('encode-fail'); };
    });
    await page.locator('.qc-btn-primary').click();
    const { error } = await outcome(page);
    expect(error).toBe('encode-fail');
    await expect(page.locator('.qc-backdrop')).toHaveCount(0);
    await page.evaluate(() => { HTMLCanvasElement.prototype.toDataURL = window.__origToDataURL; });
    await open(page);
    await page.locator('.qc-btn-primary').click();
    const { result } = await outcome(page);
    expect(result.width).toBe(400);
  });
});

test.describe('themodal integration (real theModal.js)', () => {
  test.skip(!fs.existsSync(THEMODAL), 'hyperclayjs repo not present next to quickcrop');

  async function loadWithThemodal(page) {
    await load(page);
    await page.addScriptTag({ path: THEMODAL, type: 'module' });
    await page.waitForFunction(() => !!window.themodal);
  }

  test("modal: 'auto' detects themodal and mounts the stage inside it", async ({ page }) => {
    await loadWithThemodal(page);
    await makeFile(page);
    await open(page);
    await expect(page.locator('.micromodal__content .qc-mount .qc-stage')).toBeVisible();
    await expect(page.locator('.qc-backdrop')).toHaveCount(0);
    await expect(page.locator('.micromodal__yes')).toHaveText('Crop');
    await expect(page.locator('.micromodal__no')).toBeHidden();
    await page.locator('.micromodal__yes').click();
    const { result } = await outcome(page);
    expect(result.width).toBeGreaterThan(0);
    await expect(page.locator('.micromodal-parent')).toHaveCount(0);
  });

  test('cancel via the close button resolves null and closes themodal', async ({ page }) => {
    await loadWithThemodal(page);
    await makeFile(page);
    await open(page);
    await page.locator('.micromodal__close').click();
    const { result } = await outcome(page);
    expect(result).toBe(null);
    await expect(page.locator('.micromodal-parent')).toHaveCount(0);
  });

  test('Escape resolves null even though themodal skips onNo for it', async ({ page }) => {
    await loadWithThemodal(page);
    await makeFile(page);
    await open(page);
    await page.keyboard.press('Escape');
    const { result } = await outcome(page);
    expect(result).toBe(null);
    await expect(page.locator('.micromodal-parent')).toHaveCount(0);
  });

  test('falls back to the built-in modal when themodal is already showing', async ({ page }) => {
    await loadWithThemodal(page);
    await makeFile(page);
    await page.evaluate(() => {
      window.themodal.html = '<div id="host-dialog">busy dialog</div>';
      window.themodal.yes = 'OK';
      window.themodal.open();
    });
    await expect(page.locator('#host-dialog')).toBeVisible();
    await open(page);
    await expect(page.locator('.qc-backdrop')).toBeVisible();
    await expect(page.locator('#host-dialog')).toBeVisible();
    await page.mouse.click(5, 5); // builtin backdrop, outside themodal's overlay
    const { result } = await outcome(page);
    expect(result).toBe(null);
    // the host dialog survives the whole cropper lifecycle untouched
    await expect(page.locator('#host-dialog')).toBeVisible();
  });

  test('short viewports keep the themodal-hosted stage usable (fit floor)', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 180 });
    await loadWithThemodal(page);
    await makeFile(page);
    await open(page);
    const img = await page.locator('.qc-stage img').boundingBox();
    expect(img.height).toBeGreaterThanOrEqual(100);
    await page.keyboard.press('Escape');
    const { result } = await outcome(page);
    expect(result).toBe(null);
  });

  test('reopening after a confirm works (no stale singleton state)', async ({ page }) => {
    await loadWithThemodal(page);
    await makeFile(page);
    await open(page);
    await page.locator('.micromodal__yes').click();
    await outcome(page);
    await open(page);
    await expect(page.locator('.micromodal__content .qc-stage')).toBeVisible();
    await page.locator('.micromodal__close').click();
    const { result } = await outcome(page);
    expect(result).toBe(null);
  });
});
