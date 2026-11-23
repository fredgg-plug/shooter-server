// Мини-шутер: сервер комнат. Запуск: node shooter-server.js   (Node 14+, без зависимостей)
// Деплой на Render/Railway/любой хостинг: Start Command = node shooter-server.js
var http = require("http");
var PORT = process.env.PORT || 3000;

// ===== ОБЩЕЕ ЯДРО (одинаковое в моде и на сервере) =====
var WEAPONS = {
  knife:   { n: "Нож",       s: "НОЖ",   dmg: 55, pel: 1, rate: 520,  mag: 0,  rel: 0,    spr: 0,     range: 1.15, price: 0,    slot: 0 },
  pistol:  { n: "Пистолет",  s: "ПИСТ",  dmg: 22, pel: 1, rate: 320,  mag: 12, rel: 1100, spr: 0.035, range: 10,   price: 0,    slot: 1 },
  shotgun: { n: "Дробовик",  s: "ДРОБ",  dmg: 12, pel: 6, rate: 850,  mag: 6,  rel: 2100, spr: 0.26,  range: 5.5,  price: 1100, slot: 2 },
  smg:     { n: "ПП",        s: "ПП",    dmg: 13, pel: 1, rate: 85,   mag: 30, rel: 1700, spr: 0.11,  range: 8,    price: 1200, slot: 2 },
  rifle:   { n: "Автомат",   s: "АК",    dmg: 27, pel: 1, rate: 125,  mag: 25, rel: 2000, spr: 0.05,  range: 13,   price: 2400, slot: 2 },
  sniper:  { n: "Снайперка", s: "СНАЙП", dmg: 95, pel: 1, rate: 1300, mag: 5,  rel: 2500, spr: 0.004, range: 30,   price: 3500, slot: 2 }
};
var GUNS = ["shotgun", "smg", "rifle", "sniper"];
var ARMOR_PRICE = 650, BUY_MS = 12000, LIVE_MS = 80000, END_MS = 4500;
var WINS = 5, START_MONEY = 1300, MAX_MONEY = 9000;
var SPAWNS = {
  a: [[1.5, 1.5], [1.5, 3.5], [1.5, 5.5], [1.5, 7.5]],
  b: [[13.5, 1.5], [13.5, 3.5], [13.5, 5.5], [13.5, 7.5]]
};

function mkPlayer(id, name, team, bot, owner) {
  return { id: id, name: name, team: team, bot: !!bot, owner: owner || id, hp: 100, armor: 0,
           money: START_MONEY, gun: null, alive: true, x: 0, y: 0, a: 0, w: "pistol", k: 0, d: 0 };
}
function newRoom(map) {
  return { map: map || 0, phase: "lobby", phaseEnd: 0, round: 0, score: { a: 0, b: 0 }, win: null, over: null, P: {}, ev: [], seq: 0 };
}
function pushEv(R, e) { e.seq = ++R.seq; R.ev.push(e); if (R.ev.length > 60) R.ev.shift(); }
function teamList(R, t) { var o = [], id; for (id in R.P) if (R.P[id].team === t) o.push(R.P[id]); return o; }
function countAlive(R, t) { var n = 0, id; for (id in R.P) if (R.P[id].team === t && R.P[id].alive) n++; return n; }

function spawnAll(R) {
  var n = { a: 0, b: 0 }, id, p, s;
  for (id in R.P) {
    p = R.P[id];
    s = SPAWNS[p.team][n[p.team]++ % 4];
    if (!p.alive) { p.gun = null; p.armor = 0; }
    p.x = s[0]; p.y = s[1]; p.a = p.team === "a" ? 0 : Math.PI;
    p.alive = true; p.hp = 100; p.w = p.gun || "pistol";
  }
}
function botBuy(R) {
  var id, p, opts;
  for (id in R.P) {
    p = R.P[id];
    if (!p.bot) continue;
    opts = GUNS.filter(function (g) { return WEAPONS[g].price <= p.money; });
    if (opts.length && (!p.gun || Math.random() < 0.3)) buy(R, id, opts[Math.floor(Math.random() * opts.length)]);
    if (p.money >= ARMOR_PRICE && Math.random() < 0.7) buy(R, id, "armor");
  }
}
function startRound(R, now) {
  R.round++; R.phase = "buy"; R.phaseEnd = now + BUY_MS; R.win = null;
  spawnAll(R); botBuy(R);
  pushEv(R, { type: "round", n: R.round });
}
function startMatch(R, now) {
  var id, p;
  R.round = 0; R.score = { a: 0, b: 0 }; R.over = null; R.win = null;
  for (id in R.P) { p = R.P[id]; p.money = START_MONEY; p.gun = null; p.armor = 0; p.alive = true; p.k = 0; p.d = 0; }
  startRound(R, now);
}
function endRound(R, now, winner) {
  var id, p;
  R.phase = "end"; R.phaseEnd = now + END_MS; R.win = winner || "draw";
  if (winner) R.score[winner]++;
  for (id in R.P) {
    p = R.P[id];
    p.money = Math.min(MAX_MONEY, p.money + (winner && p.team === winner ? 1700 : 1000));
  }
  pushEv(R, { type: "end", win: R.win });
}
function tick(R, now) {
  var aa, ab;
  if (R.phase === "buy" && now >= R.phaseEnd) {
    R.phase = "live"; R.phaseEnd = now + LIVE_MS; pushEv(R, { type: "live" });
  } else if (R.phase === "live") {
    aa = countAlive(R, "a"); ab = countAlive(R, "b");
    if (aa === 0 || ab === 0) endRound(R, now, aa === ab ? null : (aa ? "a" : "b"));
    else if (now >= R.phaseEnd) endRound(R, now, aa === ab ? null : (aa > ab ? "a" : "b"));
  } else if (R.phase === "end" && now >= R.phaseEnd) {
    if (R.score.a >= WINS || R.score.b >= WINS) {
      R.phase = "over"; R.over = R.score.a > R.score.b ? "a" : "b"; pushEv(R, { type: "over", win: R.over });
    } else startRound(R, now);
  }
}
function damage(R, from, to, dmg) {
  var f = R.P[from], t = R.P[to], ab;
  if (R.phase !== "live" || !f || !t || !f.alive || !t.alive || f.team === t.team) return false;
  dmg = Math.max(0, Math.min(dmg, 200));
  ab = Math.min(t.armor, dmg * 0.5); t.armor -= ab; t.hp -= dmg - ab;
  if (t.hp <= 0) {
    t.hp = 0; t.alive = false; t.d++; f.k++; f.money = Math.min(MAX_MONEY, f.money + 300);
    pushEv(R, { type: "kill", from: from, to: to, w: f.w });
  } else pushEv(R, { type: "hit", from: from, to: to });
  return true;
}
function buy(R, id, item) {
  var p = R.P[id], w = WEAPONS[item];
  if (R.phase !== "buy" || !p) return "phase";
  if (item === "armor") {
    if (p.armor >= 50) return "have";
    if (p.money < ARMOR_PRICE) return "money";
    p.money -= ARMOR_PRICE; p.armor = 50; return "ok";
  }
  if (!w || w.slot !== 2) return "item";
  if (p.gun === item) return "have";
  if (p.money < w.price) return "money";
  p.money -= w.price; p.gun = item; p.w = item; return "ok";
}
// ===== конец ядра =====

var BOT_NAMES = ["Рекс", "Тень", "Гром", "Волк", "Искра", "Ниндзя"];
var rooms = {};

function num(v, d) { v = +v; return isFinite(v) ? v : d; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function clean(s, d) { s = String(s || "").replace(/[^\wА-Яа-яЁё \-]/g, "").trim().slice(0, 12); return s || d; }
function code5() { var c; do { c = String(10000 + Math.floor(Math.random() * 90000)); } while (rooms[c]); return c; }
function humans(rm) { var n = 0, id; for (id in rm.R.P) if (!rm.R.P[id].bot) n++; return n; }
function size(rm) { return Object.keys(rm.R.P).length; }
function firstHuman(rm) { var id; for (id in rm.R.P) if (!rm.R.P[id].bot) return id; return null; }
function pickTeam(R) {
  var a = teamList(R, "a").length, b = teamList(R, "b").length;
  if (a <= b && a < 2) return "a";
  if (b < 2) return "b";
  if (a < 2) return "a";
  return null;
}

function removePlayer(rm, id) {
  var R = rm.R, k, p = R.P[id];
  if (!p) return;
  delete R.P[id]; delete rm.seen[id];
  if (humans(rm) === 0) { delete rooms[rm.code]; return; }
  if (rm.host === id) rm.host = firstHuman(rm);
  for (k in R.P) if (R.P[k].bot && R.P[k].owner === id) R.P[k].owner = rm.host;
}

function snapshot(rm, since) {
  var R = rm.R, pl = [], id, p;
  for (id in R.P) {
    p = R.P[id];
    pl.push({ id: id, name: p.name, team: p.team, bot: p.bot, owner: p.owner, hp: Math.round(p.hp), armor: Math.round(p.armor),
              money: p.money, gun: p.gun, alive: p.alive, x: +p.x.toFixed(2), y: +p.y.toFixed(2), a: +p.a.toFixed(2),
              w: p.w, k: p.k, d: p.d });
  }
  return { ok: 1, now: Date.now(), phase: R.phase, phaseEnd: R.phaseEnd, round: R.round, score: R.score, win: R.win,
           over: R.over, map: R.map, host: rm.host, pub: rm.pub, players: pl,
           ev: R.ev.filter(function (e) { return e.seq > since; }), seq: R.seq };
}

function applyShots(R, p, shots) {
  if (!p || !p.alive || R.phase !== "live" || !(shots instanceof Array)) return;
  shots.slice(0, 12).forEach(function (s) {
    var w = WEAPONS[s && s.w];
    if (!w) return;
    p.w = s.w;
    pushEv(R, { type: "shot", id: p.id, w: s.w, x: num(s.x, p.x), y: num(s.y, p.y), ex: num(s.ex, p.x), ey: num(s.ey, p.y) });
    var maxd = w.dmg * w.pel + 1;
    (s.hit instanceof Array ? s.hit : []).slice(0, 4).forEach(function (h) {
      if (h instanceof Array) damage(R, p.id, String(h[0]), Math.min(num(h[1], 0), maxd));
    });
  });
}

function setPos(p, o, R) {
  if (!p.alive || R.phase !== "live") return;
  p.x = clamp(num(o.x, p.x), 0, 15); p.y = clamp(num(o.y, p.y), 0, 9); p.a = num(o.a, p.a);
  if (WEAPONS[o.w]) p.w = o.w;
}

function route(path, q, b) {
  var rm = rooms[q.room || (b && b.room)], R = rm && rm.R, id, p, team;

  if (path === "/ping") return { ok: 1 };

  if (path === "/create") {
    var c = code5();
    rm = rooms[c] = { code: c, R: newRoom(Math.floor(Math.random() * 2)), host: "p1", pub: q.pub === "1", created: Date.now(), seen: { p1: Date.now() }, n: 1 };
    rm.R.P.p1 = mkPlayer("p1", clean(q.name, "Игрок"), "a", false);
    return { ok: 1, room: c, you: "p1" };
  }
  if (path === "/list") {
    var list = [];
    for (var k in rooms) {
      var r2 = rooms[k];
      if (r2.pub && r2.R.phase === "lobby" && size(r2) < 4)
        list.push({ room: r2.code, name: r2.R.P[r2.host] ? r2.R.P[r2.host].name : "?", n: size(r2), age: Math.round((Date.now() - r2.created) / 1000) });
    }
    return { ok: 1, rooms: list.slice(0, 20) };
  }
  if (path === "/stats") {
    var pl = 0, wt = 0;
    for (var k2 in rooms) { if (rooms[k2].R.phase === "lobby") wt++; else pl += humans(rooms[k2]); }
    return { ok: 1, playing: pl, waiting: wt };
  }

  if (!rm) return { error: "none" };

  if (path === "/join") {
    if (R.phase !== "lobby") return { error: "started" };
    team = pickTeam(R);
    if (!team) return { error: "full" };
    id = "p" + (++rm.n);
    R.P[id] = mkPlayer(id, clean(q.name, "Игрок"), team, false);
    rm.seen[id] = Date.now();
    return { ok: 1, you: id };
  }

  if (path === "/sync") {
    id = b && b.you;
    p = R.P[id];
    if (!p) return { error: "none" };
    rm.seen[id] = Date.now();
    tick(R, Date.now());
    setPos(p, b, R);
    applyShots(R, p, b.shots);
    (b.bots instanceof Array ? b.bots : []).slice(0, 4).forEach(function (bb) {
      var bp = R.P[bb && bb.id];
      if (!bp || !bp.bot || bp.owner !== id) return;
      setPos(bp, bb, R);
      applyShots(R, bp, bb.shots);
    });
    tick(R, Date.now());
    return snapshot(rm, num(b.since, 0));
  }

  id = q.you; p = R.P[id];
  if (!p) return { error: "none" };
  rm.seen[id] = Date.now();

  if (path === "/leave") { removePlayer(rm, id); return { ok: 1 }; }
  if (path === "/team") {
    if (R.phase !== "lobby") return { error: "started" };
    team = q.team === "b" ? "b" : "a";
    if (p.team !== team && teamList(R, team).length < 2) p.team = team;
    return { ok: 1 };
  }
  if (path === "/bot") {
    if (rm.host !== id || R.phase !== "lobby") return { error: "host" };
    team = q.team === "b" ? "b" : "a";
    if (q.add === "1") {
      if (teamList(R, team).length >= 2) return { error: "full" };
      var bid = "b" + (++rm.n);
      R.P[bid] = mkPlayer(bid, BOT_NAMES[rm.n % BOT_NAMES.length], team, true, rm.host);
    } else {
      var bots = teamList(R, team).filter(function (x) { return x.bot; });
      if (bots.length) delete R.P[bots[bots.length - 1].id];
    }
    return { ok: 1 };
  }
  if (path === "/start") {
    if (rm.host !== id) return { error: "host" };
    if (R.phase !== "lobby" && R.phase !== "over") return { error: "phase" };
    if (!teamList(R, "a").length || !teamList(R, "b").length) return { error: "teams" };
    R.map = Math.floor(Math.random() * 2);
    startMatch(R, Date.now());
    return { ok: 1 };
  }
  if (path === "/buy") { tick(R, Date.now()); return { ok: 1, r: buy(R, id, q.item) }; }
  return { error: "path" };
}

http.createServer(function (req, res) {
  var u = new URL(req.url, "http://x"), q = {};
  u.searchParams.forEach(function (v, k) { q[k] = v; });
  function send(o) {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(o));
  }
  function run(b) { var o; try { o = route(u.pathname, q, b); } catch (e) { o = { error: "server" }; } send(o); }
  if (req.method === "OPTIONS") return send({});
  if (req.method === "POST") {
    var body = "";
    req.on("data", function (c) { body += c; if (body.length > 30000) req.destroy(); });
    req.on("end", function () { var b = {}; try { b = JSON.parse(body); } catch (e) {} run(b); });
    return;
  }
  run(null);
}).listen(PORT, function () { console.log("Шутер-сервер запущен на порту " + PORT); });

// уборка: тики фаз, отвалившиеся игроки, пустые и старые комнаты
setInterval(function () {
  var now = Date.now(), code, rm, id, R;
  for (code in rooms) {
    rm = rooms[code]; R = rm.R;
    var lim = (R.phase === "lobby" || R.phase === "over") ? 300000 : 60000;
    for (id in R.P) if (!R.P[id].bot && now - (rm.seen[id] || 0) > lim) removePlayer(rm, id);
    if (!rooms[code]) continue;
    if (R.phase !== "lobby" && R.phase !== "over") {
      tick(R, now);
      if (!teamList(R, "a").length || !teamList(R, "b").length) {
        R.phase = "over"; R.over = teamList(R, "a").length ? "a" : "b";
      }
    }
    if (now - rm.created > 4 * 3600 * 1000) delete rooms[code];
  }
}, 400);
