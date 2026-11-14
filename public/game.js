export const COLORS = ["kirmizi", "mavi", "sari", "siyah"];
export const COLOR_LABELS = { kirmizi: "Kırmızı", mavi: "Mavi", sari: "Sarı", siyah: "Siyah" };

export function createDeck(random = Math.random) {
  const tiles = [];
  let id = 0;
  for (const color of COLORS) {
    for (let value = 1; value <= 13; value += 1) {
      tiles.push({ id: String(id++), color, value, fake: false });
      tiles.push({ id: String(id++), color, value, fake: false });
    }
  }
  tiles.push({ id: String(id++), color: "sahte", value: 0, fake: true });
  tiles.push({ id: String(id), color: "sahte", value: 0, fake: true });
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

export function newGame(names, random = Math.random) {
  if (!Array.isArray(names) || names.length !== 4) throw new Error("Oyun için dört oyuncu gerekir.");
  const wall = createDeck(random);
  const indicatorIndex = wall.findIndex((tile) => !tile.fake);
  const [indicator] = wall.splice(indicatorIndex, 1);
  const jokerValue = indicator.value === 13 ? 1 : indicator.value + 1;
  const hands = names.map(() => []);
  for (let round = 0; round < 21; round += 1) {
    for (const hand of hands) hand.push(wall.pop());
  }
  const dealer = Math.floor(random() * 4);
  hands[dealer].push(wall.pop());
  return {
    players: names.map((name, seat) => ({ id: String(seat), name, seat, opened: false, score: 0, melds: [] })),
    hands, wall, indicator, joker: { color: indicator.color, value: jokerValue }, discard: [],
    current: dealer, phase: "discard", turn: 1, winner: null, lastDiscarder: null
  };
}

export function isJoker(tile, game) {
  return !tile.fake && tile.color === game.joker.color && tile.value === game.joker.value;
}

function ordinaryTiles(group, game) {
  const naturals = group.filter((tile) => !isJoker(tile, game));
  return { naturals, jokers: group.length - naturals.length };
}

export function isMeld(group, game) {
  if (!Array.isArray(group) || group.length < 3 || new Set(group.map((tile) => tile.id)).size !== group.length) return false;
  const { naturals, jokers } = ordinaryTiles(group, game);
  if (!naturals.length) return group.length <= 13;
  const set = naturals.every((tile) => tile.value === naturals[0].value) &&
    new Set(naturals.map((tile) => tile.color)).size === naturals.length;
  if (set && naturals.length + jokers <= 4) return true;
  if (!naturals.every((tile) => tile.color === naturals[0].color)) return false;
  const values = naturals.map((tile) => tile.value).sort((a, b) => a - b);
  if (new Set(values).size !== values.length) return false;
  for (let start = 1; start <= 14 - group.length; start += 1) {
    if (values.every((value) => value >= start && value < start + group.length) &&
        group.length - values.length === group.length - new Set(values).size &&
        start + group.length - 1 <= 13) return true;
  }
  return false;
}

export function isPair(group, game) {
  if (!Array.isArray(group) || group.length !== 2 || group[0].id === group[1].id) return false;
  const [first, second] = group;
  return isJoker(first, game) || isJoker(second, game) ||
    (first.value === second.value && first.color === second.color);
}

export function meldScore(group, game) {
  const { naturals, jokers } = ordinaryTiles(group, game);
  if (!naturals.length) return 0;
  if (naturals.every((tile) => tile.value === naturals[0].value)) return naturals[0].value * group.length;
  let score = 0;
  for (let start = 1; start <= 14 - group.length; start += 1) {
    if (naturals.every((tile) => tile.value >= start && tile.value < start + group.length)) {
      score = Math.max(score, Array.from({ length: group.length }, (_, index) => start + index).reduce((sum, value) => sum + value, 0));
    }
  }
  return score || naturals.reduce((sum, tile) => sum + tile.value, 0) + jokers;
}

export function drawTile(game, playerIndex, source = "wall") {
  if (game.winner || game.phase !== "draw" || playerIndex !== game.current) throw new Error("Şimdi taş çekemezsiniz.");
  const pile = source === "discard" ? game.discard : game.wall;
  if (!pile.length) throw new Error("Çekilecek taş kalmadı.");
  const tile = pile.pop();
  game.hands[playerIndex].push(tile);
  game.phase = "discard";
  return tile;
}

export function discardTile(game, playerIndex, tileId) {
  if (game.winner || game.phase !== "discard" || playerIndex !== game.current) throw new Error("Şimdi taş atamazsınız.");
  const hand = game.hands[playerIndex];
  if (hand.length < 1) throw new Error("Elinizde taş yok.");
  if (hand.length === 1 && !game.players[playerIndex].opened) throw new Error("Bitmek için önce açılış yapmalısınız.");
  const index = hand.findIndex((tile) => tile.id === String(tileId));
  if (index < 0) throw new Error("Bu taş elinizde değil.");
  const [tile] = hand.splice(index, 1);
  game.discard.push(tile);
  game.lastDiscarder = playerIndex;
  if (!hand.length) {
    game.winner = playerIndex;
    game.phase = "finished";
    return tile;
  }
  game.current = (playerIndex + 1) % 4;
  game.turn += 1;
  game.phase = "draw";
  return tile;
}

export function playMelds(game, playerIndex, groups) {
  if (game.winner || game.phase !== "discard" || playerIndex !== game.current) throw new Error("Bu turda seri açamazsınız.");
  if (!Array.isArray(groups) || !groups.length) throw new Error("En az bir seri seçin.");
  const hand = game.hands[playerIndex];
  const remaining = hand.slice();
  const played = [];
  for (const ids of groups) {
    if (!Array.isArray(ids) || ids.length < 2) throw new Error("Her seri veya çift en az iki taş olmalı.");
    const group = ids.map((id) => {
      const index = remaining.findIndex((tile) => tile.id === String(id));
      if (index < 0) throw new Error("Bir taş birden fazla kez seçilmiş veya elinizde değil.");
      return remaining.splice(index, 1)[0];
    });
    if (!isMeld(group, game) && !isPair(group, game)) throw new Error("Seçilen taşlar geçerli bir seri veya çift oluşturmuyor.");
    played.push(group);
  }
  if (!remaining.length) throw new Error("Seri açtıktan sonra atmak için elinizde en az bir taş kalmalı.");
  if (!game.players[playerIndex].opened) {
    const pairs = played.every((group) => group.length === 2);
    const melds = played.every((group) => group.length >= 3);
    const total = played.reduce((sum, group) => sum + meldScore(group, game), 0);
    if (!((pairs && played.length >= 5) || (melds && total >= 101))) throw new Error("İlk açılış için en az 101 puanlık seri ya da beş çift gerekir.");
    game.players[playerIndex].opened = true;
  }
  game.hands[playerIndex] = remaining;
  game.players[playerIndex].melds.push(...played);
  return played;
}

export function publicGame(game, viewerIndex) {
  return {
    players: game.players.map((player) => ({ ...player })),
    hands: game.hands.map((hand, index) => index === viewerIndex ? hand : { count: hand.length }),
    wallCount: game.wall.length, indicator: game.indicator, joker: game.joker,
    discard: game.discard.slice(-1), current: game.current, phase: game.phase,
    turn: game.turn, winner: game.winner, lastDiscarder: game.lastDiscarder
  };
}

export function findMelds(hand, game) {
  const candidates = [];
  const byValue = new Map();
  const byColor = new Map();
  for (const tile of hand) {
    if (isJoker(tile, game)) continue;
    const key = `${tile.color}:${tile.value}`;
    if (!byValue.has(tile.value)) byValue.set(tile.value, []);
    byValue.get(tile.value).push(tile);
    if (!byColor.has(tile.color)) byColor.set(tile.color, []);
    byColor.get(tile.color).push(tile);
  }
  for (const tiles of byValue.values()) {
    const choices = COLORS.map((color) => tiles.filter((tile) => tile.color === color)).filter((group) => group.length);
    for (const size of [3, 4]) {
      if (choices.length < size) continue;
      const chooseColors = (start, groups) => {
        if (groups.length === size) {
          const chooseTiles = (index, selected) => {
            if (index === groups.length) { candidates.push(selected); return; }
            for (const tile of groups[index]) chooseTiles(index + 1, selected.concat(tile));
          };
          chooseTiles(0, []);
          return;
        }
        for (let index = start; index <= choices.length - (size - groups.length); index += 1) chooseColors(index + 1, groups.concat([choices[index]]));
      };
      chooseColors(0, []);
    }
  }
  for (const tile of hand.filter((item) => !isJoker(item, game))) {
    const duplicates = hand.filter((other) => other.id > tile.id && other.color === tile.color && other.value === tile.value && !isJoker(other, game));
    for (const other of duplicates) candidates.push([tile, other]);
  }
  const jokers = hand.filter((tile) => isJoker(tile, game));
  for (const joker of jokers) for (const tile of hand) if (!isJoker(tile, game)) candidates.push([joker, tile]);
  for (let index = 0; index + 1 < jokers.length; index += 1) candidates.push([jokers[index], jokers[index + 1]]);
  for (const [color, tiles] of byColor) {
    const sorted = tiles.slice().sort((a, b) => a.value - b.value);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 2; j < sorted.length; j += 1) {
        const group = sorted.slice(i, j + 1);
        const gaps = group[group.length - 1].value - group[0].value + 1 - group.length;
        const jokerTiles = hand.filter((tile) => isJoker(tile, game));
        if (gaps <= jokerTiles.length && group.every((tile, index) => index === 0 || tile.value > group[index - 1].value) &&
            isMeld(group.concat(jokerTiles.slice(0, gaps)), game)) candidates.push(group.concat(jokerTiles.slice(0, gaps)));
      }
    }
  }
  if (hand.length >= 10 && hand.length % 2 === 0) {
    const pairAll = (remaining) => {
      if (!remaining.length) return [];
      const first = remaining[0];
      for (let index = 1; index < remaining.length; index += 1) {
        const second = remaining[index];
        if (!isPair([first, second], game)) continue;
        const rest = remaining.filter((_, tileIndex) => tileIndex !== 0 && tileIndex !== index);
        const result = pairAll(rest);
        if (result) return [[first, second], ...result];
      }
      return null;
    };
    const pairs = pairAll(hand);
    if (pairs && pairs.length >= 5) return pairs;
  }
  const result = [];
  const used = new Set();
  for (const candidate of candidates.sort((a, b) => b.length - a.length)) {
    if (!candidate.some((tile) => used.has(tile.id))) {
      result.push(candidate);
      candidate.forEach((tile) => used.add(tile.id));
    }
  }
  return result;
}
