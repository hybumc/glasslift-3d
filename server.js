import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { newGame, publicGame, drawTile, discardTile, playMelds } from "./public/game.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const staffPasswordHash = process.env.STAFF_PASSWORD_HASH || "";
const rooms = new Map();
const sockets = new Map();
const bans = new Set();
const online = new Map();
const waiting = [];
const staffSessions = new Map();
const issuedIds = new Set();
const failedStaffLogins = new Map();
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean);
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 4096) reject(new Error("İstek çok büyük."));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("Geçersiz JSON.")); }
    });
    req.on("error", reject);
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyPassword(password) {
  const parts = staffPasswordHash.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt" || parts[1] !== "16384") return false;
  try {
    const expected = Buffer.from(parts[3], "hex");
    const actual = crypto.scryptSync(password, Buffer.from(parts[2], "hex"), expected.length);
    return parts[2].length === 32 && expected.length === 64 && safeEqual(actual, expected);
  } catch {
    return false;
  }
}

function authenticate(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expires = staffSessions.get(token);
  if (!expires || expires < Date.now()) {
    staffSessions.delete(token);
    return false;
  }
  return true;
}

function getRoomSummary(room) {
  return { code: room.code, mode: room.mode, players: room.players.filter(Boolean).length, state: room.game ? room.game.phase : "lobby", names: room.players.map((player) => player ? player.name : null) };
}

function broadcastRoom(room) {
  for (const player of room.players) {
    if (player && !player.isBot && player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(JSON.stringify({ type: "state", room: getRoomSummary(room), game: room.game ? publicGame(room.game, player.seat) : null, seat: player.seat }));
    }
  }
  for (const client of wss.clients) {
    if (client.staff && client.watchCode === room.code && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type:"room-watch", room:getRoomSummary(room), game:room.game ? publicGame(room.game, -1) : null }));
    }
  }
}

function broadcastStaff() {
  const message = JSON.stringify({ type: "staff-update", online: [...online.values()].map(({ id, name, room }) => ({ id, name, room: room ? room.code : null })), rooms: [...rooms.values()].map(getRoomSummary) });
  for (const client of wss.clients) {
    if (client.staff && client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function leaveRoom(player) {
  const room = player.room;
  if (!room) return;
  const seat = player.seat;
  room.players[seat] = null;
  player.room = null;
  if (room.game && room.game.winner === null) {
    room.players[seat] = { id:`bot-${room.code}-${seat}`, name:room.game.players[seat].name, seat, room, isBot:true };
  }
  if (!room.players.some((member) => member && !member.isBot)) {
    room.game = null;
    rooms.delete(room.code);
  } else {
    broadcastRoom(room);
    runBots(room);
  }
  broadcastStaff();
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(""); } while (rooms.has(code));
  return code;
}

function createRoom(mode, player) {
  const room = { code: roomCode(), mode, players: [null, null, null, null], game: null, created: Date.now() };
  room.players[0] = player;
  player.seat = 0;
  player.room = room;
  rooms.set(room.code, room);
  return room;
}

function startGame(room) {
  if (room.game || room.players.filter(Boolean).length !== 4) throw new Error("Oyun başlatmak için dört oyuncu gerekir.");
  room.game = newGame(room.players.map((player) => player.name));
}

function sendError(socket, message) {
  socket.send(JSON.stringify({ type: "error", message }));
}

function removeFromQueue(player) {
  const index = waiting.indexOf(player);
  if (index >= 0) waiting.splice(index, 1);
}

function fillBots(room) {
  let botNumber = 1;
  for (let seat = 0; seat < 4; seat += 1) {
    if (!room.players[seat]) room.players[seat] = { id: `bot-${room.code}-${seat}`, name: ["Ece", "Mert", "Selin", "Deniz", "Can"][botNumber++ % 5], seat, room, isBot: true };
  }
}

function runBots(room) {
  const game = room.game;
  if (!game || game.winner !== null) return;
  const bot = room.players[game.current];
  if (!bot?.isBot) return;
  setTimeout(() => {
    if (room.game !== game || game.winner !== null || !room.players[game.current]?.isBot) return;
    try {
      if (game.phase === "draw") drawTile(game, game.current, "wall");
      const hand = game.hands[game.current];
      discardTile(game, game.current, hand[crypto.randomInt(hand.length)].id);
      broadcastRoom(room);
      if (room.players[game.current]?.isBot) runBots(room);
    } catch (error) {
      console.error("Bot turn failed:", error.message);
    }
  }, 700);
}

function handleMessage(socket, raw) {
  let message;
  try { message = JSON.parse(raw.toString()); } catch { return sendError(socket, "Geçersiz mesaj."); }
  const player = sockets.get(socket);
  if (message.type === "staff-authenticate") {
    if (!authenticate({ headers: { authorization: `Bearer ${String(message.token || "")}` } })) return sendError(socket, "Personel oturumu geçersiz.");
    socket.staff = true;
    broadcastStaff();
    return;
  }
  if (!player) return sendError(socket, "Oyuncu oturumu bulunamadı.");
  if (message.type === "queue") {
    if (player.room) return sendError(socket, "Önce mevcut odadan ayrılın.");
    if (waiting.includes(player)) return sendError(socket, "Zaten eşleşme kuyruğundasınız.");
    waiting.push(player);
    socket.send(JSON.stringify({ type: "queue", queued: true, position: waiting.length }));
    if (waiting.length >= 2) {
      const group = waiting.splice(0, Math.min(4, waiting.length)).filter((candidate) => !candidate.room && candidate.socket.readyState === WebSocket.OPEN);
      if (group.length >= 2) {
        const room = createRoom("random", group[0]);
        for (let index = 1; index < group.length; index += 1) {
          room.players[index] = group[index];
          group[index].seat = index;
          group[index].room = room;
        }
        fillBots(room);
        startGame(room);
        broadcastRoom(room);
        broadcastStaff();
        runBots(room);
      }
    }
    setTimeout(() => {
      if (!waiting.includes(player)) return;
      removeFromQueue(player);
      if (player.socket.readyState === WebSocket.OPEN) player.socket.send(JSON.stringify({ type: "queue-timeout" }));
    }, 20000);
    return;
  }
  if (message.type === "cancel-queue") {
    removeFromQueue(player);
    socket.send(JSON.stringify({ type: "queue", queued: false }));
    return;
  }
  if (message.type === "create-room") {
    if (player.room) return sendError(socket, "Önce mevcut odadan ayrılın.");
    createRoom("private", player);
    broadcastRoom(player.room);
    broadcastStaff();
    return;
  }
  if (message.type === "join-room") {
    if (player.room) return sendError(socket, "Önce mevcut odadan ayrılın.");
    const room = rooms.get(String(message.code || "").toUpperCase());
    if (!room || room.mode !== "private" || room.game) return sendError(socket, "Oda bulunamadı veya oyun başlamış.");
    const seat = room.players.findIndex((candidate) => !candidate);
    if (seat < 0) return sendError(socket, "Oda dolu.");
    room.players[seat] = player;
    player.seat = seat;
    player.room = room;
    broadcastRoom(room);
    broadcastStaff();
    return;
  }
  if (message.type === "leave-room") {
    leaveRoom(player);
    socket.send(JSON.stringify({ type: "left-room" }));
    return;
  }
  if (message.type === "start-game") {
    try {
      if (!player.room || player.room.mode !== "private") throw new Error("Özel oda bulunamadı.");
      fillBots(player.room);
      startGame(player.room);
      broadcastRoom(player.room);
      runBots(player.room);
    } catch (error) { sendError(socket, error.message); }
    return;
  }
  if (message.type === "draw" || message.type === "discard" || message.type === "meld") {
    const room = player.room;
    if (!room || !room.game) return sendError(socket, "Şu anda oynadığınız bir oyun yok.");
    try {
      if (message.type === "draw") drawTile(room.game, player.seat, message.source === "discard" ? "discard" : "wall");
      if (message.type === "discard") discardTile(room.game, player.seat, message.tileId);
      if (message.type === "meld") playMelds(room.game, player.seat, message.groups);
      broadcastRoom(room);
      if (message.type === "discard") runBots(room);
      broadcastStaff();
    } catch (error) { sendError(socket, error.message); }
    return;
  }
  if (message.type === "chat") {
    const text = String(message.text || "").trim().slice(0, 180);
    if (text && player.room) {
      const payload = JSON.stringify({ type: "chat", name: player.name, text });
      for (const member of player.room.players) if (member && member.socket.readyState === WebSocket.OPEN) member.socket.send(payload);
    }
    return;
  }
  if (message.type === "staff-action") {
    if (!socket.staff) return sendError(socket, "Bu işlem için personel girişi gerekir.");
    const code = String(message.code || "").toUpperCase();
    if (message.action === "close-room") {
      const room = rooms.get(code);
      if (room) {
        room.players.filter((member) => member && !member.isBot).forEach((member) => { member.socket.send(JSON.stringify({ type: "room-closed" })); member.room = null; });
        room.game = null;
        rooms.delete(code);
      }
    } else if (message.action === "watch-room") {
      const room = rooms.get(code);
      if (!room) return sendError(socket, "Oda bulunamadı.");
      socket.watchCode = code;
      socket.send(JSON.stringify({ type: "room-watch", room: getRoomSummary(room), game: room.game ? publicGame(room.game, -1) : null }));
    } else if (message.action === "ban-user") {
      const target = String(message.userId || "");
      if (!target || target === player.id) return sendError(socket, "Bu kullanıcı yasaklanamaz.");
      bans.add(target);
      const targetSocket = [...sockets.keys()].find((candidate) => sockets.get(candidate).id === target);
      if (targetSocket) {
        const targetPlayer = sockets.get(targetSocket);
        targetSocket.send(JSON.stringify({ type: "banned" }));
        leaveRoom(targetPlayer);
        targetSocket.close();
      }
    } else if (message.action === "unban-user") bans.delete(String(message.userId || ""));
    broadcastStaff();
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) return json(res, 403, { error: "Origin not allowed." });
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-headers", "Authorization, Content-Type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "POST" && req.url === "/api/staff/login") {
    try {
      const body = await readBody(req);
      const forwarded = process.env.TRUST_PROXY === "true" ? String(req.headers["x-forwarded-for"] || "").split(",").pop().trim() : "";
      const address = forwarded || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      for (const [ip, attempt] of failedStaffLogins) if (attempt.expires <= now) failedStaffLogins.delete(ip);
      if (failedStaffLogins.size > 1000) failedStaffLogins.clear();
      const attempt = failedStaffLogins.get(address);
      if (attempt && attempt.count >= 10 && attempt.expires > now) return json(res, 429, { error: "Çok fazla giriş denemesi. Bir süre sonra tekrar deneyin." });
      if (!verifyPassword(String(body.password || ""))) {
        failedStaffLogins.set(address, { count: (attempt?.count || 0) + 1, expires: now + 15 * 60 * 1000 });
        return json(res, 401, { error: "Giriş başarısız." });
      }
      failedStaffLogins.delete(address);
      const token = crypto.randomBytes(32).toString("base64url");
      staffSessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
      return json(res, 200, { token, expiresIn: 28800 });
    } catch { return json(res, 400, { error: "Geçersiz istek." }); }
  }
  if (req.method === "GET" && req.url === "/api/staff/overview") {
    if (!authenticate(req)) return json(res, 401, { error: "Yetkisiz." });
    return json(res, 200, { online: [...online.values()].map(({ id, name, room }) => ({ id, name, room: room ? room.code : null, banned: bans.has(id) })), rooms: [...rooms.values()].map(getRoomSummary) });
  }
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { status: "ok", rooms: rooms.size, online: online.size });
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed." });
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { return json(res, 400, { error: "Bad path." }); }
  const target = path.resolve(publicDir, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!target.startsWith(publicDir + path.sep) && target !== path.join(publicDir, "index.html")) return json(res, 403, { error: "Forbidden." });
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) return json(res, 404, { error: "Not found." });
    const extension = path.extname(target);
    res.writeHead(200, { "content-type": MIME[extension] || "application/octet-stream", "x-content-type-options": "nosniff", "cache-control": path.basename(target) === "index.html" || extension === ".js" || extension === ".css" ? "no-cache" : "public, max-age=3600" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(target).pipe(res);
  });
});

const wss = new WebSocketServer({
  server,
  maxPayload: 4096,
  verifyClient: ({ origin }, callback) => {
    callback(!origin || !allowedOrigins.length || allowedOrigins.includes(origin), 403, "Origin not allowed.");
  }
});
wss.on("connection", (socket, req) => {
  const url = new URL(req.url, "http://localhost");
  const requestedId = String(url.searchParams.get("id") || "");
  const id = issuedIds.has(requestedId) && !online.has(requestedId) ? requestedId : crypto.randomUUID();
  issuedIds.add(id);
  const name = String(url.searchParams.get("name") || "Misafir").trim().slice(0, 20) || "Misafir";
  if (bans.has(id)) {
    socket.send(JSON.stringify({ type: "banned" }));
    return socket.close();
  }
  const player = { id, name, socket, room: null, seat: -1 };
  sockets.set(socket, player);
  online.set(id, player);
  socket.on("message", (raw) => handleMessage(socket, raw));
  socket.on("close", () => {
    removeFromQueue(player);
    leaveRoom(player);
    sockets.delete(socket);
    online.delete(id);
    if (!bans.has(id)) issuedIds.delete(id);
    if (socket.staff) broadcastStaff();
  });
  socket.on("error", () => {});
  socket.send(JSON.stringify({ type: "connected", id, name }));
  broadcastStaff();
});

server.listen(port, host, () => {
  console.log(`Sefa Okey server listening on ${host}:${port}`);
  if (!staffPasswordHash) console.warn("STAFF_PASSWORD_HASH is not configured; staff login is disabled.");
});

export { server };
