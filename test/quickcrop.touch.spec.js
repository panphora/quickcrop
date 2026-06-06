// Touch-device pass: runs in the mobile-touch project (Pixel 7 emulation).
// Drags are dispatched as real CDP touch events so they travel the full
// touch-action -> pointer-event -> pointer-capture pipeline.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const QUICKCROP = path.resolve(dir, '..', 'quickcrop.js');

async function load(page) {
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ path: QUICKCROP, type: 'module' });
  await page.waitForFunction(() => typeof window.quickcrop === 'function');
}

async function makeFile(page, { width = 400, height = 200 } = {}) {
  await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3d405b';
    ctx.fillRect(0, 0, width, height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    window.__file = new File([blob], 'test.png', { type: 'image/png' });
  }, { width, height });
}

async function open(page, opts = {}) {
  await page.evaluate(opts => {
    window.__done = false;
    window.__result = undefined;
    window.quickcrop(window.__file, opts).then(
      r => {
        window.__result = r && { width: r.width, height: r.height, blobType: r.blob.type };
        window.__done = true;
      },
      () => { window.__done = true; }
    );
  }, opts);
  await page.waitForSelector('.qc-stage');
}

async function outcome(page) {
  await page.waitForFunction(() => window.__done);
  return page.evaluate(() => window.__result ?? null);
}

const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

async function touchDrag(page, from, to, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        id: 1,
      }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('touch-dragging the box moves the crop window', async ({ page }) => {
  await load(page);
  await makeFile(page);
  await open(page, { aspect: 1 });
  const before = await page.locator('.qc-box').boundingBox();
  await touchDrag(page, center(before), { x: center(before).x - 60, y: center(before).y });
  const after = await page.locator('.qc-box').boundingBox();
  expect(before.x - after.x).toBeGreaterThan(40);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
});

test('touch-dragging a corner handle resizes under the aspect lock', async ({ page }) => {
  await load(page);
  await makeFile(page);
  await open(page, { aspect: 1 });
  const before = await page.locator('.qc-box').boundingBox();
  const se = center(await page.locator('.qc-se').boundingBox());
  await touchDrag(page, se, { x: se.x - 50, y: se.y - 50 });
  const after = await page.locator('.qc-box').boundingBox();
  expect(after.width).toBeLessThan(before.width - 30);
  expect(Math.abs(after.width - after.height)).toBeLessThanOrEqual(1);
});

test('tapping Crop confirms and returns the cropped result', async ({ page }) => {
  await load(page);
  await makeFile(page);
  await open(page, { aspect: 1 });
  await page.locator('.qc-btn-primary').tap();
  const result = await outcome(page);
  expect(result).not.toBe(null);
  expect(result.width).toBeGreaterThan(0);
  expect(result.width).toBe(result.height);
  expect(result.blobType).toBe('image/png');
});

test('vertical touch drag moves the box, never scrolls the page (touch-action: none)', async ({ page }) => {
  await load(page);
  // give the page something to scroll, so a broken touch-action would show up as scroll
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.body.append(spacer);
  });
  await makeFile(page, { width: 200, height: 400 }); // tall image, vertical room for the box
  await open(page, { aspect: 1 });
  const before = await page.locator('.qc-box').boundingBox();
  const c = center(before);
  await touchDrag(page, c, { x: c.x, y: c.y + 60 });
  const after = await page.locator('.qc-box').boundingBox();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(after.y - before.y).toBeGreaterThan(40);
});

test('tapping the backdrop cancels', async ({ page }) => {
  await load(page);
  await makeFile(page);
  await open(page);
  await page.touchscreen.tap(8, 8);
  const result = await outcome(page);
  expect(result).toBe(null);
  await expect(page.locator('.qc-backdrop')).toHaveCount(0);
});
