import { cp, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This template is copied to scripts/ at the Cloudflare project root.
// Only generated dependencies in dist/vendor are replaced; authored app files
// and user documents are never part of this build operation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packageDir = name => dirname(require.resolve(`${name}/package.json`));
const vendor = resolve(root, 'dist/vendor');
await stat(resolve(root, 'dist/index.html'));
const pdf = packageDir('pdfjs-dist');
const tess = packageDir('tesseract.js');
const core = packageDir('tesseract.js-core');
const english = packageDir('@tesseract.js-data/eng');
await rm(vendor, { recursive: true, force: true });
await mkdir(resolve(vendor, 'pdfjs'), { recursive: true });
await mkdir(resolve(vendor, 'ocr'), { recursive: true });
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  await copyFile(resolve(pdf, 'legacy/build', name), resolve(vendor, 'pdfjs', name));
}
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(resolve(pdf, name), resolve(vendor, 'pdfjs', name), { recursive: true });
}
await copyFile(resolve(pdf, 'LICENSE'), resolve(vendor, 'pdfjs/LICENSE'));
for (const name of ['tesseract.min.js', 'worker.min.js']) {
  await copyFile(resolve(tess, 'dist', name), resolve(vendor, 'ocr', name));
}
await copyFile(resolve(tess, 'LICENSE.md'), resolve(vendor, 'ocr/LICENSE-tesseract.md'));
await copyFile(resolve(core, 'LICENSE'), resolve(vendor, 'ocr/LICENSE-core'));
for (const name of await readdir(core)) {
  if (name.startsWith('tesseract-core') && /\.(?:js|wasm)$/.test(name)) {
    await copyFile(resolve(core, name), resolve(vendor, 'ocr', name));
  }
}
await copyFile(resolve(english, '4.0.0_best_int/eng.traineddata.gz'), resolve(vendor, 'ocr/eng.traineddata.gz'));
console.log('Prepared the PDF and scan readers. Statement processing stays in the browser.');
