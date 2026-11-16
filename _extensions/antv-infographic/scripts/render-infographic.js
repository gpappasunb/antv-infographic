#!/usr/bin/env node
// Renders AntV Infographic syntax to SVG, PNG or PDF files in headless Chrome.
//
// Batch mode (used by the Quarto filter): a JSON array of jobs on stdin,
//   [{ "content": "...", "format": "svg|png|pdf", "theme": "dark", "scale": 3,
//      "out": "path/to/file.svg" }, ...]
// and a JSON array of results on stdout, one per job and in the same order:
//   [{ "ok": true, "width": 640, "height": 360 } | { "ok": false, "error": "..." }]
//
// Single mode (for manual testing):
//   node render-infographic.js --content '<syntax>' --format svg --out out.svg

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const TIMEOUT = parseInt(process.env.ANTV_INFOGRAPHIC_TIMEOUT, 10) || 60000;
const FORMATS = ['svg', 'png', 'pdf'];

// The browser bundle (global `AntVInfographic`) of the locally installed package:
// pinned by package-lock.json, no CDN involved.
function loadLibrary() {
  const entry = require.resolve('@antv/infographic');
  const root = entry.slice(0, entry.lastIndexOf(path.join('@antv', 'infographic'))) +
    path.join('@antv', 'infographic');
  return fs.readFileSync(path.join(root, 'dist', 'infographic.min.js'), 'utf8');
}

// Runs inside the page.
async function renderInPage({ content, format, theme, scale, timeout }) {
  const { Infographic } = window.AntVInfographic;
  const describe = (e) => {
    if (e instanceof Error) return e.message;
    if (Array.isArray(e)) return e.map(describe).join('; ');
    if (e && typeof e === 'object') return e.message || JSON.stringify(e);
    return String(e);
  };

  const options = { container: '#container', editable: false };
  if (theme) options.theme = theme;
  const instance = new Infographic(options);

  // `rendered` fires before icons, illustrations and fonts have arrived;
  // `loaded` fires once every resource is in place.
  const warnings = [];
  instance.on('warning', (w) => warnings.push(describe(w)));
  const render = () => new Promise((resolve, reject) => {
    const fail = (message) => reject(new Error(
      [message, ...warnings].filter(Boolean).join('; ')));
    const timer = setTimeout(() => fail(`timed out after ${timeout} ms`), timeout);
    instance.on('loaded', () => { clearTimeout(timer); resolve(); });
    instance.on('error', (e) => { clearTimeout(timer); fail(describe(e)); });
    instance.render(content);
  });

  // Text is measured while rendering, but web fonts only start downloading
  // once text uses them. So render once to pull the fonts in, then render
  // again to lay the text out with the real metrics.
  await render();
  await document.fonts.ready;
  await render();
  await document.fonts.ready;

  const svgUrl = await instance.toDataURL({ type: 'svg', embedResources: true });
  const svg = decodeURIComponent(svgUrl.slice(svgUrl.indexOf(',') + 1));
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const result = {
    svg,
    width: parseFloat(root.getAttribute('width')),
    height: parseFloat(root.getAttribute('height')),
  };
  if (format === 'png') {
    result.png = await instance.toDataURL({ type: 'png', dpr: scale });
  }
  return result;
}

async function renderJob(browser, library, job) {
  const format = job.format || 'svg';
  if (!FORMATS.includes(format)) {
    throw new Error(`unknown format "${format}" (expected ${FORMATS.join(', ')})`);
  }
  if (!job.content || !job.content.trim()) throw new Error('empty infographic');
  if (!job.out) throw new Error('no output path');

  const page = await browser.newPage();
  try {
    page.on('pageerror', (err) => console.error('[infographic]', err.message));
    await page.setContent(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
      '<body style="margin:0"><div id="container"></div></body></html>');
    await page.addScriptTag({ content: library });
    const result = await page.evaluate(renderInPage, {
      content: job.content,
      format,
      theme: job.theme || null,
      scale: Number(job.scale) || 3,
      timeout: TIMEOUT,
    });

    fs.mkdirSync(path.dirname(path.resolve(job.out)), { recursive: true });
    if (format === 'svg') {
      fs.writeFileSync(job.out, result.svg);
    } else if (format === 'png') {
      fs.writeFileSync(job.out, Buffer.from(result.png.split(',')[1], 'base64'));
    } else {
      // Vector PDF: print the exported SVG on a page of exactly its own size.
      const width = Math.ceil(result.width);
      const height = Math.ceil(result.height);
      await page.setContent(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
        `@page { size: ${width}px ${height}px; margin: 0 }` +
        'html, body { margin: 0; padding: 0 } svg { display: block }' +
        `</style></head><body>${result.svg}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      fs.writeFileSync(job.out, await page.pdf({
        width: `${width}px`,
        height: `${height}px`,
        printBackground: true,
        pageRanges: '1',
      }));
    }
    return { ok: true, width: result.width, height: result.height };
  } finally {
    await page.close();
  }
}

async function renderAll(jobs) {
  const library = loadLibrary();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  const results = [];
  try {
    for (const job of jobs) {
      try {
        results.push(await renderJob(browser, library, job));
      } catch (err) {
        const message = err.message.split('\n')[0];
        results.push({
          ok: false,
          error: message.replace(/^Incomplete options/, '$& (unknown template or missing data?)'),
        });
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.content) {
    const format = args.format || 'svg';
    const out = args.out || `infographic.${format}`;
    const [result] = await renderAll([{ ...args, format, out }]);
    if (!result.ok) throw new Error(result.error);
    console.log(`${out} (${Math.round(result.width)} x ${Math.round(result.height)})`);
    return;
  }
  const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify(await renderAll(jobs)));
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
