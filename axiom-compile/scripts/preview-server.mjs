/**
 * Dependency-free Axiom preview server (no bundler required).
 * Serves the vanilla HTML/CSS/JS UI and proxies /api/compile to the REAL
 * compiled @axiom/core engine (packages/axiom-core/dist). This lets us run and
 * verify the app end-to-end in environments where esbuild/Vite are unavailable.
 *
 * Usage: node scripts/preview-server.mjs [port]   (default 4173)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileIntent,
  answerQuestions,
  collectContext,
} from "../packages/axiom-core/dist/src/node.js";

// Inject deterministic repo context from the host (Node) side.
const hostContext = await collectContext(process.cwd());

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "app");
const port = Number(process.argv[2] || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveFile(res, p) {
  try {
    const data = await readFile(p);
    const ext = path.extname(p).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

function body(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  res.setHeader("access-control-allow-origin", "*");

  if (req.method === "POST" && url.pathname === "/api/compile") {
    const payload = await body(req);
    try {
      const opts = { mode: payload.mode ?? "interactive", context: hostContext };
      const res2 = payload.answers?.length
        ? await answerQuestions(payload.request, payload.answers, opts)
        : await compileIntent(payload.request, opts);
      res.writeHead(200, { "content-type": "application/json" });
      if (res2.status === "needs_answer") {
        res.end(JSON.stringify({ status: "needs_answer", questions: res2.questions }));
      } else {
        res.end(
          JSON.stringify({
            status: "ready",
            packet: {
              packet_id: res2.packet.packet_id,
              task_type: res2.packet.task_contract.task_type,
              target_area: res2.packet.task_contract.target_area,
              scope_lock: res2.packet.task_contract.scope_lock,
            },
            markup: res2.markup,
          }),
        );
      }
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "error", message: String(e?.message ?? e) }));
    }
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") return serveFile(res, path.join(appDir, "preview.html"));
  if (url.pathname === "/preview.js") return serveFile(res, path.join(appDir, "preview.js"));
  if (url.pathname === "/preview.css") return serveFile(res, path.join(appDir, "preview.css"));
  serveFile(res, path.join(appDir, url.pathname.slice(1)));
});

server.listen(port, () => {
  console.log(`Axiom preview running at http://localhost:${port}`);
  console.log(`  /api/compile -> real @axiom/core engine`);
});