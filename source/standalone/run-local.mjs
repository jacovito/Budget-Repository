import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./dist/server/index.js";

const host = "127.0.0.1";
const port = Number(process.env.PAYCHECK_PORT || 4173);
const packageRoot = dirname(fileURLToPath(import.meta.url));
const assetRoot = resolve(packageRoot, "dist/client");
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json"], [".woff2", "font/woff2"],
]);

async function assetResponse(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const candidate = resolve(assetRoot, `.${pathname}`);
  if (candidate !== assetRoot && !candidate.startsWith(`${assetRoot}${sep}`)) return new Response("Forbidden", { status: 403 });
  try {
    if (!(await stat(candidate)).isFile()) return new Response("Not found", { status: 404 });
    return new Response(await readFile(candidate), {
      headers: {
        "content-type": mimeTypes.get(extname(candidate)) || "application/octet-stream",
        "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function send(nodeResponse, response, headOnly = false) {
  nodeResponse.statusCode = response.status;
  for (const [name, value] of response.headers) nodeResponse.setHeader(name, value);
  nodeResponse.end(headOnly ? undefined : Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    const webRequest = new Request(url, { method: request.method, headers: request.headers });
    const directAsset = await assetResponse(webRequest);
    if (directAsset.status !== 404) {
      await send(response, directAsset, request.method === "HEAD");
      return;
    }
    const context = { waitUntil(promise) { void Promise.resolve(promise).catch(() => {}); }, passThroughOnException() {} };
    const appResponse = await worker.fetch(webRequest, { ASSETS: { fetch: assetResponse } }, context);
    await send(response, appResponse, request.method === "HEAD");
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("Paycheck could not start this request.");
  }
});

server.listen(port, host, () => {
  console.log(`\nPaycheck is running privately on this computer:\nhttp://localhost:${port}/\n`);
  console.log("Keep this window open. Press Ctrl+C to stop Paycheck.\n");
});
