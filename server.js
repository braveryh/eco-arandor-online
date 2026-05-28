const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const WORLD = {
  width: 2800,
  height: 2100,
  safeZone: {
    x: 1120,
    y: 780,
    w: 560,
    h: 420
  }
};

const players = {};
const inputs = {};
const enemies = [];
const drops = [];
const market = [];

let enemyId = 1;
let dropId = 1;
let marketId = 1;

const ITEM_INFO = {
  herb: { name: "Erva", icon: "🌿" },
  crystal: { name: "Cristal", icon: "💎" },
  fang: { name: "Presa", icon: "🦷" },
  potion: { name: "Poção", icon: "🧪" },
  manaPotion: { name: "Poção de Mana", icon: "🔷" }
};

const CLASSES = {
  swordsman: {
    label: "Espadachim",
    maxHp: 130,
    maxMana: 50,
    range: 72,
    damage: 30,
    cooldown: 16,
    projectile: false,
    color: "#49a6ff"
  },
  archer: {
    label: "Arqueiro",
    maxHp: 95,
    maxMana: 65,
    range: 260,
    damage: 23,
    cooldown: 22,
    projectile: true,
    color: "#06d6a0"
  },
  mage: {
    label: "Mago",
    maxHp: 80,
    maxMana: 130,
    range: 285,
    damage: 34,
    cooldown: 28,
    manaCost: 14,
    projectile: true,
    color: "#b388ff"
  }
};

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cleanName(name) {
  return String(name || "Aventureiro").replace(/[<>]/g, "").trim().slice(0, 16) || "Aventureiro";
}

function inSafeZone(obj) {
  const z = WORLD.safeZone;
  return obj.x >= z.x && obj.x <= z.x + z.w && obj.y >= z.y && obj.y <= z.y + z.h;
}

function spawnPoint() {
  const z = WORLD.safeZone;
  return {
    x: z.x + z.w / 2 + rand(-90, 90),
    y: z.y + z.h / 2 + rand(-70, 70)
  };
}

function enemySpawnPoint() {
  let p;
  do {
    p = { x: rand(100, WORLD.width - 100), y: rand(100, WORLD.height - 100) };
  } while (inSafeZone(p) || dist(p, { x: WORLD.safeZone.x + 280, y: WORLD.safeZone.y + 210 }) < 520);
  return p;
}

function createPlayer(id, name, classId) {
  const cls = CLASSES[classId] || CLASSES.swordsman;
  const pos = spawnPoint();

  return {
    id,
    name: cleanName(name),
    classId: CLASSES[classId] ? classId : "swordsman",
    className: cls.label,
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    size: 28,
    hp: cls.maxHp,
    maxHp: cls.maxHp,
    mana: cls.maxMana,
    maxMana: cls.maxMana,
    level: 1,
    xp: 0,
    nextXp: 100,
    gold: 80,
    kills: 0,
    attackCd: 0,
    lastDirX: 1,
    lastDirY: 0,
    color: cls.color,
    inventory: {
      herb: 2,
      crystal: 0,
      fang: 0,
      potion: 3,
      manaPotion: 1
    }
  };
}

function createEnemy() {
  const type = Math.random() > 0.35 ? "slime" : "wolf";
  const pos = enemySpawnPoint();

  return {
    id: enemyId++,
    type,
    x: pos.x,
    y: pos.y,
    size: type === "slime" ? 28 : 34,
    hp: type === "slime" ? 50 : 85,
    maxHp: type === "slime" ? 50 : 85,
    speed: type === "slime" ? 0.95 : 1.25,
    damage: type === "slime" ? 8 : 14,
    cd: 0
  };
}

function spawnEnemies() {
  while (enemies.length < 26) enemies.push(createEnemy());
}

function addXp(p, amount) {
  p.xp += amount;

  while (p.xp >= p.nextXp) {
    p.xp -= p.nextXp;
    p.level++;
    p.nextXp = Math.floor(p.nextXp * 1.45);

    p.maxHp += 12;
    p.maxMana += 8;
    p.hp = p.maxHp;
    p.mana = p.maxMana;

    io.to(p.id).emit("notice", `Level up! Você chegou ao nível ${p.level}.`);
  }
}

function addDrop(x, y, item, amount = 1) {
  drops.push({
    id: dropId++,
    x,
    y,
    item,
    amount
  });
}

function updatePlayers() {
  for (const id in players) {
    const p = players[id];
    const input = inputs[id] || {};
    const speed = 4.3;

    let dx = 0;
    let dy = 0;

    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      p.lastDirX = dx;
      p.lastDirY = dy;
    }

    p.vx = dx * speed;
    p.vy = dy * speed;

    p.x = Math.max(25, Math.min(WORLD.width - 25, p.x + p.vx));
    p.y = Math.max(25, Math.min(WORLD.height - 25, p.y + p.vy));

    if (p.attackCd > 0) p.attackCd--;

    p.hp = Math.min(p.maxHp, p.hp + 0.018);
    p.mana = Math.min(p.maxMana, p.mana + 0.065);

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (dist(p, d) < 44) {
        p.inventory[d.item] = (p.inventory[d.item] || 0) + d.amount;
        drops.splice(i, 1);
        io.to(id).emit("notice", `Coletado: ${d.amount}x ${ITEM_INFO[d.item]?.name || d.item}.`);
      }
    }
  }
}

function updateEnemies() {
  for (const e of enemies) {
    let target = null;
    let best = Infinity;

    for (const id in players) {
      const p = players[id];
      if (inSafeZone(p)) continue;

      const d = dist(e, p);
      if (d < best) {
        best = d;
        target = p;
      }
    }

    if (target && best < 370 && best > 0) {
      e.x += ((target.x - e.x) / best) * e.speed;
      e.y += ((target.y - e.y) / best) * e.speed;
    }

    if (e.cd > 0) e.cd--;

    if (target && best < 40 && e.cd <= 0) {
      e.cd = 45;
      target.hp -= e.damage;
      io.to(target.id).emit("notice", `${e.type === "slime" ? "Slime" : "Lobo"} causou ${e.damage} de dano.`);

      if (target.hp <= 0) {
        const pos = spawnPoint();
        target.hp = target.maxHp;
        target.mana = target.maxMana;
        target.x = pos.x;
        target.y = pos.y;
        target.gold = Math.max(0, target.gold - 20);
        io.to(target.id).emit("notice", "Você foi derrotado e voltou para a base segura.");
      }
    }
  }
}

function killEnemy(index, killer) {
  const e = enemies[index];
  if (!e) return;

  enemies.splice(index, 1);

  killer.kills++;
  killer.gold += e.type === "slime" ? 9 : 18;
  addXp(killer, e.type === "slime" ? 36 : 65);

  if (e.type === "slime") {
    addDrop(e.x, e.y, Math.random() > 0.45 ? "herb" : "crystal");
  } else {
    addDrop(e.x, e.y, Math.random() > 0.45 ? "fang" : "crystal");
  }

  setTimeout(spawnEnemies, 900);
}

function attackEnemy(player) {
  const cls = CLASSES[player.classId] || CLASSES.swordsman;

  if (player.attackCd > 0) return;
  if (cls.manaCost && player.mana < cls.manaCost) {
    io.to(player.id).emit("notice", "Mana insuficiente.");
    return;
  }

  player.attackCd = cls.cooldown;
  if (cls.manaCost) player.mana -= cls.manaCost;

  let bestIndex = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const d = dist(player, e);

    if (d <= cls.range && d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) {
    io.to(player.id).emit("notice", "Ataque não acertou nenhum monstro.");
    return;
  }

  const e = enemies[bestIndex];
  const damage = cls.damage + player.level * 5;
  e.hp -= damage;

  io.to(player.id).emit("attackEffect", {
    from: { x: player.x, y: player.y },
    to: { x: e.x, y: e.y },
    classId: player.classId
  });

  io.to(player.id).emit("notice", `${cls.label}: ${damage} de dano.`);

  if (e.hp <= 0) killEnemy(bestIndex, player);
}

function publicState() {
  return {
    world: WORLD,
    players,
    enemies,
    drops,
    market,
    serverTime: new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Campo_Grande"
    })
  };
}

io.on("connection", socket => {
  socket.on("join", data => {
    const classId = data?.classId || "swordsman";
    players[socket.id] = createPlayer(socket.id, data?.name, classId);
    inputs[socket.id] = {};

    io.emit("chat", `Servidor: ${players[socket.id].name} entrou como ${players[socket.id].className}.`);
  });

  socket.on("rename", name => {
    const p = players[socket.id];
    if (!p) return;
    p.name = cleanName(name);
  });

  socket.on("input", input => {
    if (!players[socket.id]) return;
    inputs[socket.id] = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right
    };
  });

  socket.on("attack", () => {
    const p = players[socket.id];
    if (!p) return;

    if (inSafeZone(p)) {
      io.to(socket.id).emit("notice", "Você está na base segura. Saia da base para lutar.");
      return;
    }

    attackEnemy(p);
  });

  socket.on("usePotion", type => {
    const p = players[socket.id];
    if (!p) return;

    if (type === "mana") {
      if ((p.inventory.manaPotion || 0) <= 0) return io.to(socket.id).emit("notice", "Você não tem poção de mana.");
      if (p.mana >= p.maxMana) return io.to(socket.id).emit("notice", "Sua mana já está cheia.");
      p.inventory.manaPotion--;
      p.mana = Math.min(p.maxMana, p.mana + 55);
      return;
    }

    if ((p.inventory.potion || 0) <= 0) return io.to(socket.id).emit("notice", "Você não tem poções.");
    if (p.hp >= p.maxHp) return io.to(socket.id).emit("notice", "Sua vida já está cheia.");

    p.inventory.potion--;
    p.hp = Math.min(p.maxHp, p.hp + 55);
  });

  socket.on("shopTrade", data => {
    const p = players[socket.id];
    if (!p) return;

    const type = data?.type;

    if (type === "potion") {
      if ((p.inventory.herb || 0) < 2) return io.to(socket.id).emit("notice", "Você precisa de 2 Ervas.");
      p.inventory.herb -= 2;
      p.inventory.potion = (p.inventory.potion || 0) + 1;
      io.to(socket.id).emit("notice", "Troca feita: 2 Ervas por 1 Poção.");
    }

    if (type === "manaPotion") {
      if ((p.inventory.crystal || 0) < 1) return io.to(socket.id).emit("notice", "Você precisa de 1 Cristal.");
      p.inventory.crystal -= 1;
      p.inventory.manaPotion = (p.inventory.manaPotion || 0) + 1;
      io.to(socket.id).emit("notice", "Troca feita: 1 Cristal por 1 Poção de Mana.");
    }

    if (type === "gold") {
      if ((p.inventory.fang || 0) < 1) return io.to(socket.id).emit("notice", "Você precisa de 1 Presa.");
      p.inventory.fang -= 1;
      p.gold += 35;
      io.to(socket.id).emit("notice", "Você vendeu 1 Presa por 35 ouro.");
    }
  });

  socket.on("marketSell", data => {
    const p = players[socket.id];
    if (!p) return;

    const item = String(data?.item || "");
    const amount = Math.max(1, Math.floor(Number(data?.amount || 1)));
    const price = Math.max(1, Math.floor(Number(data?.price || 1)));

    if (!ITEM_INFO[item]) return;

    if ((p.inventory[item] || 0) < amount) {
      io.to(socket.id).emit("notice", "Você não tem essa quantidade no inventário.");
      return;
    }

    p.inventory[item] -= amount;

    market.push({
      id: marketId++,
      sellerId: p.id,
      seller: p.name,
      item,
      amount,
      price
    });

    io.emit("notice", `${p.name} anunciou ${amount}x ${ITEM_INFO[item].name} por ${price} ouro.`);
  });

  socket.on("marketBuy", id => {
    const buyer = players[socket.id];
    if (!buyer) return;

    const listingId = Number(id);
    const index = market.findIndex(m => m.id === listingId);
    if (index === -1) {
      io.to(socket.id).emit("notice", "Esse item já foi vendido ou removido.");
      return;
    }

    const item = market[index];

    if (item.sellerId === buyer.id) {
      io.to(socket.id).emit("notice", "Você não pode comprar seu próprio item.");
      return;
    }

    if (buyer.gold < item.price) {
      io.to(socket.id).emit("notice", "Ouro insuficiente.");
      return;
    }

    buyer.gold -= item.price;
    buyer.inventory[item.item] = (buyer.inventory[item.item] || 0) + item.amount;

    const seller = players[item.sellerId];
    if (seller) {
      seller.gold += item.price;
      io.to(seller.id).emit("notice", `Seu item foi vendido por ${item.price} ouro.`);
    }

    market.splice(index, 1);
    io.to(socket.id).emit("notice", `Compra feita: ${item.amount}x ${ITEM_INFO[item.item].name}.`);
  });

  socket.on("chat", msg => {
    const p = players[socket.id];
    if (!p) return;

    const clean = String(msg || "").replace(/[<>]/g, "").trim().slice(0, 90);
    if (clean) io.emit("chat", `${p.name}: ${clean}`);
  });

  socket.on("disconnect", () => {
    if (players[socket.id]) {
      io.emit("chat", `Servidor: ${players[socket.id].name} saiu do mundo.`);
    }

    delete players[socket.id];
    delete inputs[socket.id];
  });
});

spawnEnemies();

setInterval(() => {
  updatePlayers();
  updateEnemies();
  io.emit("state", publicState());
}, 1000 / 30);

server.listen(PORT, () => {
  console.log(`Servidor online na porta ${PORT}`);
});
