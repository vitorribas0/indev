import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const allowedOrigins = new Set([
  "http://localhost:3001",
  "http://127.0.0.1:3001",
]);

const server = createServer((request, response) => {
  if (request.url === "/readyz") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ready: true, upstream: "ws://127.0.0.1:4501" }));
    return;
  }
  response.writeHead(404).end();
});

const browserServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  browserServer.handleUpgrade(request, socket, head, (client) => browserServer.emit("connection", client, request));
});

browserServer.on("connection", (client) => {
  const upstream = new WebSocket("ws://127.0.0.1:4501");
  const queued = [];

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else if (upstream.readyState === WebSocket.CONNECTING) queued.push([data, isBinary]);
  });
  upstream.on("open", () => {
    for (const [data, isBinary] of queued.splice(0)) upstream.send(data, { binary: isBinary });
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on("error", () => client.close(1011, "Codex App Server indisponível"));
  upstream.on("close", () => client.close());
  client.on("close", () => upstream.close());
  client.on("error", () => upstream.close());
});

server.listen(4502, "127.0.0.1", () => {
  console.log("[indev] Ponte segura do navegador: ws://127.0.0.1:4502");
});

function shutdown() {
  for (const client of browserServer.clients) client.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
