import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, newGame, drawTile, discardTile, isMeld, playMelds, publicGame, findMelds } from "../public/game.js";

test("creates a 106-tile set and deals one extra tile to the starting player", () => {
  const game = newGame(["A", "B", "C", "D"]);
  assert.equal(createDeck().length, 106);
  assert.equal(new Set(game.hands.flat().map((tile) => tile.id)).size, 85);
  assert.equal(game.hands.reduce((total, hand) => total + hand.length, 0), 85);
  assert.equal(game.hands[game.current].length, 22);
  assert.equal(game.wall.length, 20);
});

test("draw and discard enforce turn order and advance the game", () => {
  const game = newGame(["A", "B", "C", "D"]);
  const current = game.current;
  discardTile(game, current, game.hands[current][0].id);
  assert.equal(game.current, (current + 1) % 4);
  assert.equal(game.phase, "draw");
  assert.throws(() => drawTile(game, current), /taş çekemezsiniz/);
  drawTile(game, game.current);
  assert.equal(game.hands[game.current].length, 22);
  assert.throws(() => discardTile(game, game.current, "not-in-hand"), /elinizde değil/);
});

test("opening melds requires valid groups totaling at least 101 and keeps a discard", () => {
  const game = newGame(["A", "B", "C", "D"]);
  game.current = 0;
  game.phase = "discard";
  const groups = [
    [{ id:"a", color:"kirmizi", value:10 },{ id:"b", color:"kirmizi", value:11 },{ id:"c", color:"kirmizi", value:12 }],
    [{ id:"d", color:"mavi", value:10 },{ id:"e", color:"mavi", value:11 },{ id:"f", color:"mavi", value:12 }],
    [{ id:"g", color:"kirmizi", value:13 },{ id:"h", color:"mavi", value:13 },{ id:"i", color:"sari", value:13 }]
  ];
  game.hands[0] = groups.flat().concat([{ id:"j", color:"siyah", value:1 }]);
  assert.ok(groups.every((group) => isMeld(group, game)));
  assert.throws(() => playMelds(game, 0, [groups[0].map((tile) => tile.id)]), /101/);
  assert.equal(game.hands[0].length, 10);
  playMelds(game, 0, groups.map((group) => group.map((tile) => tile.id)));
  assert.equal(game.players[0].opened, true);
  assert.equal(game.hands[0].length, 1);
});

test("public state never exposes other players' concealed tiles", () => {
  const game = newGame(["A", "B", "C", "D"]);
  const view = publicGame(game, 0);
  assert.equal(Array.isArray(view.hands[0]), true);
  assert.deepEqual(view.hands[1], { count: game.hands[1].length });
  assert.equal(JSON.stringify(view).includes(`"id":"${game.hands[1][0].id}"`), false);
});

test("last discard wins and invalid wraparound runs are rejected", () => {
  const game = newGame(["A", "B", "C", "D"]);
  game.current = 0;
  game.phase = "discard";
  game.hands[0] = [{ id:"last", color:"siyah", value:1 }];
  assert.throws(() => discardTile(game, 0, "last"), /açılış/);
  assert.equal(game.hands[0].length, 1);
  game.players[0].opened = true;
  discardTile(game, 0, "last");
  assert.equal(game.winner, 0);
  assert.equal(game.phase, "finished");
  assert.equal(isMeld([{ id:"a",color:"mavi",value:12 },{ id:"b",color:"mavi",value:13 },{ id:"c",color:"mavi",value:1 }], game), false);
});

test("opens five identical-tile pairs without mixing them into a points opening", () => {
  const game = newGame(["A", "B", "C", "D"]);
  game.current = 0;
  game.phase = "discard";
  const pairs = Array.from({ length: 5 }, (_, index) => [
    { id:`${index}-a`, color:"siyah", value:index + 1 },
    { id:`${index}-b`, color:"siyah", value:index + 1 }
  ]);
  game.hands[0] = pairs.flat().concat([{ id:"last", color:"mavi", value:13 }]);
  assert.deepEqual(findMelds(game.hands[0].slice(0, 10), game).map((pair) => pair.length), [2, 2, 2, 2, 2]);
  playMelds(game, 0, pairs.map((pair) => pair.map((tile) => tile.id)));
  assert.equal(game.players[0].opened, true);
  assert.equal(game.players[0].melds.length, 5);
  assert.equal(game.hands[0].length, 1);
});

test("finds valid same-rank sets and consecutive runs for the meld selector", () => {
  const game = newGame(["A", "B", "C", "D"]);
  const set = [
    { id:"set-r", color:"kirmizi", value:8 },
    { id:"set-b", color:"mavi", value:8 },
    { id:"set-y", color:"sari", value:8 }
  ];
  assert.ok(findMelds(set, game).some((group) => group.length === 3 && group.every((tile) => set.some((candidate) => candidate.id === tile.id))));
  const run = [
    { id:"run-1", color:"siyah", value:4 },
    { id:"run-2", color:"siyah", value:5 },
    { id:"run-3", color:"siyah", value:6 }
  ];
  assert.ok(findMelds(run, game).some((group) => group.length === 3));
});
