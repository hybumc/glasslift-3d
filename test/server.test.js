import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import { WebSocket } from "ws";
import { once } from "node:events";

async function unusedPort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Server exited before becoming ready.");
    try { if ((await fetch(`${url}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not become ready.");
}

function messageOf(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message.")), 3000);
    const listener = (data) => {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", listener);
      resolve(message);
    };
    socket.on("message", listener);
  });
}

test("serves the lobby, protects staff APIs, and matches two live users with server bots", async (t) => {
  const port = await unusedPort();
  const staffPassword = "test-staff-password";
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(staffPassword, salt, 64);
  const staffPasswordHash = `scrypt$16384$${salt.toString("hex")}$${hash.toString("hex")}`;
  const child = spawn(process.execPath, ["server.js"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", STAFF_PASSWORD_HASH: staffPasswordHash, ALLOWED_ORIGIN:"https://app.example,capacitor://localhost" }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) if (client.readyState === WebSocket.OPEN) client.close();
    child.kill();
    await once(child, "exit").catch(() => {});
  });
  await waitForServer(base, child);
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/health`, { headers:{ Origin:"https://attacker.example" } })).status, 403);
  const mobileHealth = await fetch(`${base}/health`, { headers:{ Origin:"capacitor://localhost" } });
  assert.equal(mobileHealth.status, 200);
  assert.equal(mobileHealth.headers.get("access-control-allow-origin"), "capacitor://localhost");
  assert.equal((await fetch(`${base}/api/staff/overview`)).status, 401);
  assert.equal((await fetch(`${base}/api/staff/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong-password" }) })).status, 401);
  const login = await fetch(`${base}/api/staff/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: staffPassword }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.equal((await fetch(`${base}/api/staff/overview`, { headers:{ Authorization:`Bearer ${token}` } })).status, 200);

  const first = new WebSocket(`${base.replace("http", "ws")}/ws?id=first&name=Birinci`);
  const second = new WebSocket(`${base.replace("http", "ws")}/ws?id=second&name=İkinci`);
  clients.push(first, second);
  const firstConnected = messageOf(first, (message) => message.type === "connected");
  const secondConnected = messageOf(second, (message) => message.type === "connected");
  await Promise.all([once(first, "open"), once(second, "open")]);
  const [firstIdentity, secondIdentity] = await Promise.all([firstConnected, secondConnected]);
  assert.notEqual(firstIdentity.id, "first");
  first.send(JSON.stringify({ type: "queue" }));
  await messageOf(first, (message) => message.type === "queue");
  const firstStatePromise = messageOf(first, (message) => message.type === "state");
  const secondStatePromise = messageOf(second, (message) => message.type === "state");
  second.send(JSON.stringify({ type: "queue" }));
  const [firstState, secondState] = await Promise.all([firstStatePromise, secondStatePromise]);
  assert.equal(firstState.game.players.length, 4);
  assert.equal(secondState.room.players, 4);
  assert.ok(firstState.game.hands.every((hand, index) => index === firstState.seat ? Array.isArray(hand) : Number.isInteger(hand.count)));
  assert.equal(firstState.game.players.filter((player) => player.name === "Birinci" || player.name === "İkinci").length, 2);

  const staff = new WebSocket(`${base.replace("http", "ws")}/ws?id=staff&name=Personel`);
  clients.push(staff);
  const staffConnected = messageOf(staff, (message) => message.type === "connected");
  await once(staff, "open");
  await staffConnected;
  staff.send(JSON.stringify({ type:"staff-authenticate", token }));
  await messageOf(staff, (message) => message.type === "staff-update");
  const closedFirst = messageOf(first, (message) => message.type === "room-closed");
  const closedSecond = messageOf(second, (message) => message.type === "room-closed");
  staff.send(JSON.stringify({ type:"staff-action", action:"close-room", code:firstState.room.code }));
  await Promise.all([closedFirst, closedSecond]);

  const creatorRoom = messageOf(first, (message) => message.type === "state" && message.room.mode === "private");
  first.send(JSON.stringify({ type:"create-room" }));
  const created = await creatorRoom;
  assert.equal(created.game, null);
  const joinedFirst = messageOf(first, (message) => message.type === "state" && message.room.code === created.room.code);
  const joinedSecond = messageOf(second, (message) => message.type === "state" && message.room.code === created.room.code);
  second.send(JSON.stringify({ type:"join-room", code:created.room.code }));
  await Promise.all([joinedFirst, joinedSecond]);
  const started = messageOf(first, (message) => message.type === "state" && message.game);
  first.send(JSON.stringify({ type:"start-game" }));
  const gameState = await started;
  assert.equal(gameState.game.players.length, 4);
  const watched = messageOf(staff, (message) => message.type === "room-watch" && message.room.code === created.room.code);
  staff.send(JSON.stringify({ type:"staff-action", action:"watch-room", code:created.room.code }));
  assert.equal((await watched).game.players.length, 4);
  const banned = messageOf(second, (message) => message.type === "banned");
  staff.send(JSON.stringify({ type:"staff-action", action:"ban-user", userId:secondIdentity.id }));
  await banned;
});
