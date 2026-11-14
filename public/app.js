import { newGame, drawTile, discardTile, playMelds, meldScore, findMelds, COLOR_LABELS } from "./game.js?v=0.1.1";

const $ = (selector) => document.querySelector(selector);
const localHost = ["localhost", "127.0.0.1"].includes(location.hostname) && Boolean(location.port);
const serverBase = (location.protocol === "http:" || location.protocol === "https:") && (localHost || location.hostname !== "localhost") ? location.origin : "https://sefa-okey-101.onrender.com";
const socketUrl = `${serverBase.startsWith("https:") ? "wss:" : "ws:"}//${new URL(serverBase).host}`;
const state = { name: localStorage.getItem("sefa-name") || "", guestId: localStorage.getItem("sefa-guest") || crypto.randomUUID(), socket: null, connected: false, room: null, game: null, seat: -1, local: false, selection: new Set(), pendingGroups: [], queueTimer: null, queueStarted: 0, toastTimer: null, staffToken: "", watch: null, sound: true };
localStorage.setItem("sefa-guest", state.guestId);
$("#player-name").value = state.name;

function toast(message, error = false) {
  const element = $("#game-toast");
  element.textContent = message;
  element.classList.toggle("toast-error", error);
  element.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove("show"), 2800);
}

function openModal(html) {
  $("#modal-content").innerHTML = html;
  $("#modal-backdrop").hidden = false;
  $("#modal-close").focus();
}
function closeModal() { $("#modal-backdrop").hidden = true; }
$("#modal-close").addEventListener("click", closeModal);
$("#modal-backdrop").addEventListener("click", (event) => { if (event.target === $("#modal-backdrop")) closeModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

function getName() {
  const name = $("#player-name").value.trim().slice(0, 20);
  if (!name) { toast("Önce masada kullanacağın adı yaz.", true); $("#player-name").focus(); return null; }
  state.name = name;
  localStorage.setItem("sefa-name", name);
  return name;
}

function connect() {
  if (state.socket && state.socket.readyState < WebSocket.CLOSING) {
    if (state.staffToken && state.socket.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify({ type: "staff-authenticate", token: state.staffToken }));
    return state.socket;
  }
  const name = getName();
  if (!name) return null;
  const socket = new WebSocket(`${socketUrl}/ws?id=${encodeURIComponent(state.guestId)}&name=${encodeURIComponent(name)}`);
  state.socket = socket;
  socket.addEventListener("open", () => { state.connected = true; $("#status-label").textContent = "Sunucu çevrimiçi"; if (state.staffToken) socket.send(JSON.stringify({ type: "staff-authenticate", token: state.staffToken })); });
  socket.addEventListener("message", (event) => handleServerMessage(JSON.parse(event.data)));
  socket.addEventListener("close", () => { state.connected = false; $("#status-label").textContent = "Sunucuya bağlan"; if (state.room) toast("Bağlantı kesildi. Sayfayı yenileyip tekrar katıl.", true); });
  socket.addEventListener("error", () => { $("#status-label").textContent = "Sunucuya ulaşılamıyor"; });
  return socket;
}

function send(message) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return toast("Sunucu bağlantısı kuruluyor, birazdan tekrar dene.", true);
  state.socket.send(JSON.stringify(message));
}

function handleServerMessage(message) {
  if (message.type === "connected") {
    state.guestId = message.id;
    localStorage.setItem("sefa-guest", message.id);
  } else if (message.type === "state") {
    state.room = message.room; state.game = message.game; state.seat = message.seat; state.local = false;
    state.gamePlayers = message.game?.players || message.room?.names?.map((name) => name ? ({ name }) : null) || [];
    clearInterval(state.queueTimer);
    renderGame(); showView("game-view");
  } else if (message.type === "queue") {
    if (message.queued) openQueueModal();
  } else if (message.type === "queue-timeout") {
    clearInterval(state.queueTimer);
    openQueueModal("Şu an başka oyuncu bulunamadı.", true);
  } else if (message.type === "left-room" || message.type === "room-closed") {
    state.room = null; state.game = null; state.seat = -1; state.local = false; showView("home-view"); closeModal();
    toast(message.type === "room-closed" ? "Personel bu odayı kapattı." : "Masadan ayrıldın.");
  } else if (message.type === "room-watch") {
    state.watch = message; renderStaff();
  } else if (message.type === "staff-authenticated") {
    state.staffToken = message.token;
    sessionStorage.setItem("sefa-staff-token", message.token);
    send({ type: "staff-authenticate", token: message.token });
    renderStaff();
  } else if (message.type === "staff-update") {
    state.staffData = message;
    renderStaff();
  } else if (message.type === "chat") {
    toast(`${message.name}: ${message.text}`);
  } else if (message.type === "banned") {
    toast("Bu oturum oyun sunucusundan yasaklandı.", true);
  } else if (message.type === "error") {
    toast(message.message, true);
    if ($("#modal-backdrop").hidden === false && $("#modal-content").querySelector(".queue-spinner")) openQueueModal(message.message);
  }
}

function showView(id) { document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id)); }
function tileMarkup(tile, selected = false) {
  const color = tile.fake ? "tile-fake" : ({ kirmizi: "tile-red", mavi: "tile-blue", sari: "tile-yellow", siyah: "tile-black" })[tile.color];
  return `<div class="tile ${color}${selected ? " selected" : ""}" data-tile="${tile.id}" title="${tile.fake ? "Sahte okey" : `${COLOR_LABELS[tile.color]} ${tile.value}`}">${tile.fake ? "✦" : tile.value}</div>`;
}
function renderGame() {
  const lobby = $("#room-lobby");
  if (!state.game) {
    lobby.hidden = !state.room || state.local;
    $(".game-board").hidden = true; $(".hand-panel").hidden = true; $("#meld-area").hidden = true;
    if (state.room && !state.local) {
      $("#room-badge").textContent = `● ODA ${state.room.code}`;
      $("#lobby-code").textContent = state.room.code;
      $("#lobby-seats").innerHTML = state.gamePlayers?.map((player, index) => `<div class="lobby-seat">${escapeHtml(player?.name || "Boş koltuk")}<small>${player ? `KOLTUK ${index + 1}` : "BEKLENİYOR"}</small></div>`).join("") || "";
    }
    return;
  }
  lobby.hidden = true; $(".game-board").hidden = false; $(".hand-panel").hidden = false; $("#meld-area").hidden = false;
  const game = state.game, me = state.seat;
  $("#room-badge").innerHTML = state.local ? "● BOTLU MASA" : `● ${state.room?.mode === "private" ? `ODA ${state.room.code}` : "RASTGELE MASA"}`;
  const seats = [1, 2, 3].map((offset) => (me + offset) % 4);
  for (let i = 0; i < seats.length; i += 1) {
    const player = game.players[seats[i]], hand = game.hands[seats[i]], element = $(`#opponent-${i === 0 ? 1 : i === 1 ? 2 : 3}`);
    element.classList.toggle("current", game.current === seats[i] && !game.winner);
    const count = Array.isArray(hand) ? hand.length : hand.count;
    element.innerHTML = `<span class="avatar">${escapeHtml(player.name.slice(0,1).toUpperCase())}</span><span class="opponent-name">${escapeHtml(player.name)}</span><span class="opponent-count">${count} taş</span>`;
  }
  const self = game.players[me];
  $("#self-player").innerHTML = `<span class="avatar">${escapeHtml(self?.name.slice(0,1).toUpperCase() || "S")}</span><span>${escapeHtml(self?.name || state.name)}</span>`;
  const hand = game.hands[me];
  if (Array.isArray(hand)) {
    hand.sort((a,b) => a.fake ? 1 : b.fake ? -1 : a.color.localeCompare(b.color) || a.value - b.value);
    $("#hand").innerHTML = hand.map((tile) => tileMarkup(tile, state.selection.has(tile.id))).join("");
    $("#hand-count").textContent = `${hand.length} TAŞ`;
  } else $("#hand").innerHTML = "";
  $("#wall-count").textContent = `${state.local ? game.wall.length : game.wallCount} taş kaldı`;
  $("#indicator-tile").innerHTML = tileMarkup(game.indicator);
  $("#joker-label").textContent = `${COLOR_LABELS[game.joker.color]} ${game.joker.value}`;
  $("#discard-pile").innerHTML = game.discard.length ? tileMarkup(game.discard[game.discard.length - 1]) : "";
  const ownTurn = game.current === me && !game.winner, needsDraw = game.phase === "draw";
  $("#draw-pile").disabled = !ownTurn || !needsDraw || !Array.isArray(hand);
  $("#discard-button").disabled = !ownTurn || needsDraw || !state.selection.size;
  $("#meld-button").disabled = !ownTurn || needsDraw || state.selection.size < 3;
  $("#turn-message").textContent = game.winner !== null ? `${game.players[game.winner].name} kazandı!` : ownTurn ? needsDraw ? "Taş çek" : "Taşını seçip at" : `${game.players[game.current].name} oynuyor`;
  $("#meld-area").innerHTML = game.players.flatMap((player, index) => player.melds.map((group) => `<div class="meld-set" title="${escapeHtml(player.name)}">${group.map((tile) => tileMarkup(tile)).join("")}</div>`)).join("");
  $("#hand").querySelectorAll(".tile").forEach((element) => element.addEventListener("click", () => {
    const id = element.dataset.tile;
    state.selection.has(id) ? state.selection.delete(id) : state.selection.add(id);
    renderGame();
  }));
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]); }

function startLocal() {
  const name = getName(); if (!name) return;
  state.local = true; state.room = { mode: "local" }; state.seat = 0;
  state.game = newGame([name, "Ece", "Mert", "Selin"]);
  const dealerTile = state.game.hands[state.game.current].pop();
  state.game.hands[0].push(dealerTile);
  state.game.current = 0;
  state.game.phase = "discard";
  state.selection.clear(); showView("game-view"); renderGame(); toast("Botlu masa hazır. Taş çekerek başla.");
}
function gameAction(type, payload = {}) {
  if (!state.local) return send({ type, ...payload });
  try {
    if (type === "draw") drawTile(state.game, 0, payload.source || "wall");
    if (type === "discard") discardTile(state.game, 0, payload.tileId);
    if (type === "meld") playMelds(state.game, 0, payload.groups);
    state.selection.clear(); renderGame();
    if (state.game.winner === null) setTimeout(runLocalBots, 650);
  } catch (error) { toast(error.message, true); }
}
function runLocalBots() {
  if (!state.local || state.game.winner !== null) return;
  const game = state.game;
  while (game.current !== 0 && !game.winner) {
    try {
      if (game.phase === "draw") drawTile(game, game.current, "wall");
      let botHand = game.hands[game.current];
      const potential = findMelds(botHand, game);
      if (!game.players[game.current].opened && potential.length && potential.reduce((sum, group) => sum + meldScore(group, game), 0) >= 101 && botHand.length - potential.flat().length > 0) {
        try {
          playMelds(game, game.current, potential.map((group) => group.map((tile) => tile.id)));
          botHand = game.hands[game.current];
        } catch {}
      }
      const index = Math.floor(Math.random() * botHand.length);
      discardTile(game, game.current, botHand[index].id);
    } catch (error) { toast(error.message, true); break; }
  }
  renderGame();
}

$("#bot-game").addEventListener("click", startLocal);
$("#random-game").addEventListener("click", () => {
  if (!getName()) return;
  const socket = connect(); if (!socket) return;
  const begin = () => { state.queueStarted = Date.now(); send({ type: "queue" }); openQueueModal(); state.queueTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - state.queueStarted) / 1000);
    const label = $("#queue-time"); if (label) label.textContent = `${seconds} sn`;
    const fallback = $("#queue-fallback"); if (fallback) fallback.hidden = seconds < 20;
  }, 500); };
  socket.readyState === WebSocket.OPEN ? begin() : socket.addEventListener("open", begin, { once: true });
});
$("#start-room").addEventListener("click", () => send({ type:"start-game" }));
$("#copy-code").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(state.room.code); toast("Oda kodu kopyalandı."); }
  catch { toast(`Oda kodun: ${state.room.code}`); }
});
function openQueueModal(error = "", timedOut = false) {
  openModal(`<div class="eyebrow">CANLI EŞLEŞME</div><h2>${timedOut ? "Masa botlarla mı?" : "Oyuncular aranıyor"}</h2><p>${timedOut ? "Şu an eşleşecek başka oyuncu yok. Botlu masa başlatabilir veya lobide kalabilirsin." : "Sunucuda seninle aynı anda masa arayan oyuncular aranıyor. Eşleşince oyun otomatik başlar."}</p><div class="queue-spinner"${timedOut ? " hidden" : ""}></div><p style="text-align:center"><span id="queue-time">0 sn</span> · bağlantı açık</p>${error ? `<p class="notice">${escapeHtml(error)}</p>` : ""}<button class="quiet-button" id="queue-cancel" style="width:100%;justify-content:center">Aramayı durdur</button><button class="primary-button" id="queue-fallback" ${timedOut ? "" : "hidden"} style="width:100%;justify-content:center;margin-top:9px">Şimdilik botlarla oyna</button>`);
  $("#queue-cancel").onclick = () => { clearInterval(state.queueTimer); send({ type: "cancel-queue" }); closeModal(); };
  $("#queue-fallback").onclick = () => { send({ type: "cancel-queue" }); closeModal(); startLocal(); };
}
$("#create-room").addEventListener("click", () => {
  if (!getName()) return;
  const socket = connect(); if (!socket) return;
  const create = () => send({ type: "create-room" });
  socket.readyState === WebSocket.OPEN ? create() : socket.addEventListener("open", create, { once: true });
});
$("#join-room").addEventListener("click", () => {
  const code = $("#room-code").value.trim().toUpperCase();
  if (code.length !== 5) return toast("Beş harfli oda kodunu gir.", true);
  if (!getName()) return;
  const socket = connect(); if (!socket) return;
  const join = () => send({ type: "join-room", code });
  socket.readyState === WebSocket.OPEN ? join() : socket.addEventListener("open", join, { once: true });
});
$("#draw-pile").addEventListener("click", () => { state.selection.clear(); gameAction("draw"); });
$("#discard-pile").addEventListener("click", () => {
  if (!state.game || state.game.phase !== "draw" || state.game.current !== state.seat) return;
  state.selection.clear(); gameAction("draw", { source: "discard" });
});
$("#discard-button").addEventListener("click", () => {
  const id = [...state.selection][0]; if (!id) return;
  gameAction("discard", { tileId: id });
});
$("#meld-button").addEventListener("click", () => {
  if (!state.game) return;
  const hand = state.game.hands[state.seat];
  const tiles = hand.filter((tile) => state.selection.has(tile.id));
  const groups = findMelds(tiles, state.game);
  if (!groups.length || groups.reduce((sum, group) => sum + group.length, 0) !== tiles.length) return toast("Seçtiğin taşlarla geçerli seri veya seriler oluştur.", true);
  if (state.local) {
    try { playMelds(state.game, state.seat, groups.map((group) => group.map((tile) => tile.id))); state.selection.clear(); renderGame(); toast("Serilerin masaya açıldı."); }
    catch (error) { toast(error.message, true); }
  } else gameAction("meld", { groups: groups.map((group) => group.map((tile) => tile.id)) });
});
$("#leave-game").addEventListener("click", () => {
  if (state.local) { state.local = false; state.room = null; state.game = null; showView("home-view"); }
  else send({ type: "leave-room" });
});

$("#rules-open").addEventListener("click", () => openModal(`<div class="eyebrow">101 OKEY · HIZLI REHBER</div><h2>Taşları diz, 101'i bul.</h2><p>Gösterge taşından sonraki sayı aynı renkteki okeydir. Okey her taşın yerine kullanılabilir.</p><ol class="rules-list"><li>Taş çek: kapalı desteden veya senden önce atılan son taştan.</li><li>Aynı renkte ardışık en az üç taş ya da aynı sayıdan farklı renklerde en az üç taş seri olur.</li><li>İlk açılışında serilerin toplamı en az 101 olmalı; alternatif olarak beş çift açabilirsin.</li><li>Açtıktan sonra sıranı bir taş atarak bitir. Elini ilk bitiren oyunu kazanır.</li></ol><p>Bu sürüm temel 101 akışını içerir; eşli puanlama ve detaylı turnuva kuralları henüz yoktur.</p>`));

$("#staff-open").addEventListener("click", async () => {
  const token = state.staffToken || sessionStorage.getItem("sefa-staff-token") || "";
  state.staffToken = token;
  if (token) {
    const response = await fetch(`${serverBase}/api/staff/overview`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) { state.staffData = await response.json(); connect(); renderStaff(); return; }
    state.staffToken = ""; sessionStorage.removeItem("sefa-staff-token");
  }
  openModal(`<div class="eyebrow">YÖNETİCİ ERİŞİMİ</div><h2>Personel girişi</h2><p>Bu alan sadece yetkili personel içindir.</p><form id="staff-login"><label class="name-field"><span class="eyebrow">PERSONEL PAROLASI</span><input id="staff-password" class="modal-input" type="password" autocomplete="current-password" required></label><button class="primary-button">Güvenli giriş <span class="button-arrow">→</span></button><p class="notice" id="staff-error" hidden></p></form>`);
  $("#staff-login").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await fetch(`${serverBase}/api/staff/login`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ password: $("#staff-password").value }) });
      if (!response.ok) throw new Error("Giriş başarısız veya personel erişimi yapılandırılmamış.");
      const result = await response.json();
      state.staffToken = result.token; sessionStorage.setItem("sefa-staff-token", result.token);
      const overview = await fetch(`${serverBase}/api/staff/overview`, { headers:{ Authorization:`Bearer ${result.token}` } });
      state.staffData = await overview.json();
      connect(); closeModal(); renderStaff();
    } catch (error) { $("#staff-error").textContent = error.message; $("#staff-error").hidden = false; }
  });
});
function renderStaff() {
  const data = state.staffData;
  if (!data) return;
  const rooms = data.rooms || [];
  const users = data.online || [];
  openModal(`<div class="eyebrow">CANLI YÖNETİM PANELİ</div><h2>Masalar ve oyuncular</h2><p>${users.length} çevrimiçi oyuncu · ${rooms.length} açık oda</p><div class="staff-overview"><h3>Odalar</h3>${rooms.length ? `<ul class="overview-list">${rooms.map((room) => `<li><span><strong>${room.code}</strong><small>${room.players}/4 kişi · ${escapeHtml(room.state)}</small></span><span class="staff-row-actions"><button data-watch="${room.code}">İzle</button><button class="danger" data-close="${room.code}">Kapat</button></span></li>`).join("")}</ul>` : "<p>Henüz açık oda yok.</p>"}<h3>Çevrimiçi</h3>${users.length ? `<ul class="overview-list">${users.map((user) => `<li><span>${escapeHtml(user.name)}<small>${user.room ? `Oda ${escapeHtml(user.room)}` : "Lobide"} · ${escapeHtml(user.id.slice(0,8))}</small></span><span class="staff-row-actions"><button class="danger" data-ban="${escapeHtml(user.id)}">Yasakla</button></span></li>`).join("")}</ul>` : "<p>Çevrimiçi oyuncu yok.</p>"}</div><p class="notice">Misafir banları ve odalar sunucu belleğinde tutulur; sunucu yeniden başlayınca temizlenir.</p>`);
  document.querySelectorAll("[data-close]").forEach((button) => button.onclick = () => send({ type:"staff-action", action:"close-room", code:button.dataset.close }));
  document.querySelectorAll("[data-watch]").forEach((button) => button.onclick = () => send({ type:"staff-action", action:"watch-room", code:button.dataset.watch }));
  document.querySelectorAll("[data-ban]").forEach((button) => button.onclick = () => {
    if (confirm("Bu oyuncuyu mevcut sunucu oturumundan yasaklamak istiyor musun?")) send({ type:"staff-action", action:"ban-user", userId:button.dataset.ban });
  });
  if (state.watch) {
    const watch = state.watch;
    $("#modal-content").insertAdjacentHTML("beforeend", `<div class="staff-overview"><h3>${escapeHtml(watch.room.code)} · canlı izleme</h3><p>${watch.room.players}/4 kişi · ${escapeHtml(watch.room.state)} · ${watch.game ? `sıra ${escapeHtml(watch.game.players[watch.game.current]?.name || "—")}` : "Oyun henüz başlamadı"}</p>${watch.game ? `<p>${watch.game.players.map((player) => `${escapeHtml(player.name)}: ${watch.game.hands[player.seat]?.count ?? watch.game.hands[player.seat]?.length ?? 0} taş`).join(" · ")}</p><p>Gösterge: ${watch.game.indicator.value} ${escapeHtml(COLOR_LABELS[watch.game.indicator.color] || "Sahte")} · Atılan: ${watch.game.discard.map((tile) => `${tile.value || "✦"} ${escapeHtml(COLOR_LABELS[tile.color] || "")}`).join(", ") || "yok"}</p>` : ""}</div>`);
  }
}

const savedToken = sessionStorage.getItem("sefa-staff-token");
if (savedToken) state.staffToken = savedToken;
fetch(`${serverBase}/health`).then((response) => response.ok && ($("#status-label").textContent = "Sunucu çevrimiçi")).catch(() => {});
