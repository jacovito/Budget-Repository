import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /Paycheck/);
  assert.match(html, /Know what’s safe to spend\./);
  assert.match(html, /Safe to spend/i);
  assert.match(html, /Monthly/);
  assert.match(html, /Yearly/);
  assert.match(html, /Interactive budget category wheel/);
  assert.match(html, /Previous month/);
  assert.match(html, /Next month/);
  assert.match(html, /Private by design/);
  assert.match(html, /Saving &amp; help/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /Save &amp; restore/);
  assert.doesNotMatch(html, /Starter Project/);
});
