import test from 'node:test';
import assert from 'node:assert/strict';
import { readPageText } from '../dist/pdf-text.mjs';

function pageWithStream(start) {
  const stream = new ReadableStream({ start });
  // Reproduce browsers that have getReader but no async iterator.
  Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });
  return { stream, page: { streamTextContent: () => stream } };
}

test('reads all PDF text chunks without ReadableStream async iteration', async () => {
  const first = { str: '08/03 Publix', transform: [1, 0, 0, 1, 20, 40], width: 80, height: 12 };
  const second = { str: '87.42', transform: [1, 0, 0, 1, 140, 40], width: 30, height: 12 };
  const { stream, page } = pageWithStream(controller => {
    controller.enqueue({ items: [first], styles: { font1: { ascent: 1 } }, lang: null });
    controller.enqueue({ items: [second], styles: { font2: { ascent: 2 } }, lang: 'en' });
    controller.enqueue({ items: [], styles: {}, lang: 'fr' });
    controller.close();
  });
  await assert.rejects(async () => { for await (const value of stream) void value; }, TypeError);
  const content = await readPageText(page);
  assert.deepEqual(content.items, [first, second]);
  assert.deepEqual({ ...content.styles }, { font1: { ascent: 1 }, font2: { ascent: 2 } });
  assert.equal(Object.getPrototypeOf(content.styles), null);
  assert.equal(content.lang, 'en');
  assert.equal(stream.locked, false);
});

test('an image-only page returns empty text so OCR can run', async () => {
  const { stream, page } = pageWithStream(controller => controller.close());
  const content = await readPageText(page);
  assert.deepEqual(content.items, []);
  assert.deepEqual(Object.keys(content.styles), []);
  assert.equal(content.lang, null);
  assert.equal(stream.locked, false);
});

test('preserves read errors and releases the stream on failure', async () => {
  const error = new Error('PDF reading cancelled');
  const { stream, page } = pageWithStream(controller => controller.error(error));
  await assert.rejects(readPageText(page), value => value === error);
  assert.equal(stream.locked, false);
});
