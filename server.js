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
  safeZone: { x: 1120, y: 780, w: 560, h: 420 },
  npcShop: { x: 1400, y: 990, name: "Lia, Mercadora" }
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
  potion: { name: "Poção de Vida", icon: "🧪" },
  manaPotion: { name: "Poção de Mana", icon: "🔷" }
};

const CLASSES = {
  swordsman: {
    label: "Espadachim",
    weapon: "Espada",
    weaponIcon: "⚔️",
    maxHp: 130,
    maxMana: 50,
    range: 72,
    damage: 30,
    cooldown: 16,
    manaCost: 0,
    color: "#49a6ff"
  },
  archer: {
    label: "Arqueiro",
    weapon: "Arco",
    weaponIcon: "🏹",
    maxHp: 95,
    maxMana: 65,
    range: 260,
    damage: 23,
    cooldown: 22,
    manaCost: 0,
    color: "#06d6a0"
  },
  mage: {
    label: "Mago",
    weapon: "Cajado",
    weaponIcon: "🔮",
    maxHp: 80,
    maxMana: 130,
    range: 285,
    damage: 34,
    cooldown: 28,
    manaCost: 14,
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
  return { x: z.x + z.w / 2 + rand(-85, 85), y: z.y + z.h / 2 + rand(-60, 60) };
}

function enemySpawnPoint() {
  let p;
  do {
    p = { x: rand(100, WORLD.width - 100), y: rand(100, WORLD.height - 100) };
  } while (inSafeZone(p) || dist(p, WORLD.npcShop) < 620);
  return p;
}

function actionLog(text) {
  io.emit("actionLog", text);
}

function createPlayer(id, name, classId) {
  const cls = CLASSES[classId] || CLASSES.swordsman;
  const pos = spawnPoint();

  return {
    id,
    name: cleanName(name),
    classId: CLASSES[classId] ? classId : "swordsman",
    className: cls.label,
    weapon: cls.weapon,
    weaponIcon: cls.weaponIcon,
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
    gold: 200,
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
    name: type === "slime" ? "Slime" : "Lobo",
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
    actionLog(`${p.name} subiu para o nível ${p.level}.`);
  }
}

function addDrop(x, y, item, amount = 1) {
  drops.push({ id: dropId++, x, y, item, amount });
}

function updatePlayers() {
  for (const id in players) {
    const p = players[id];
    const input = inputs[id] || {};
    const speed = 4.3;

    let dx = 0, dy = 0;
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
        actionLog(`${p.name} coletou ${d.amount}x ${ITEM_INFO[d.item]?.name || d.item}.`);
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
      io.to(target.id).emit("notice", `${e.name} causou ${e.damage} de dano.`);

      if (target.hp <= 0) {
        const pos = spawnPoint();
        target.hp = target.maxHp;
        target.mana = target.maxMana;
        target.x = pos.x;
        target.y = pos.y;
        target.gold = Math.max(0, target.gold - 20);
        io.to(target.id).emit("notice", "Você foi derrotado e voltou para a base segura.");
        actionLog(`${target.name} foi derrotado e voltou para a base.`);
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

  if (e.type === "slime") addDrop(e.x, e.y, Math.random() > 0.45 ? "herb" : "crystal");
  else addDrop(e.x, e.y, Math.random() > 0.45 ? "fang" : "crystal");

  actionLog(`${killer.name} matou ${e.name} e recebeu ouro/XP.`);
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

  io.emit("attackEffect", {
    from: { x: player.x, y: player.y },
    to: { x: e.x, y: e.y },
    classId: player.classId,
    damage,
    targetId: e.id
  });

  io.to(player.id).emit("notice", `${cls.label}: ${damage} de dano.`);
  actionLog(`${player.name} causou ${damage} de dano em ${e.name}.`);

  if (e.hp <= 0) killEnemy(bestIndex, player);
}

function buyNpcPotion(socket, type) {
  const p = players[socket.id];
  if (!p) return;

  if (dist(p, WORLD.npcShop) > 115) {
    io.to(socket.id).emit("notice", "Chegue perto da NPC da loja para comprar.");
    return;
  }

  const item = type === "mana" ? "manaPotion" : "potion";
  const price = 15;

  if (p.gold < price) {
    io.to(socket.id).emit("notice", "Ouro insuficiente.");
    return;
  }

  p.gold -= price;
  p.inventory[item] = (p.inventory[item] || 0) + 1;

  const itemName = ITEM_INFO[item].name;
  io.to(socket.id).emit("notice", `Você comprou 1 ${itemName} por ${price} ouro.`);
  actionLog(`${p.name} comprou 1 ${itemName} por ${price} ouro na NPC Lia.`);
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
    actionLog(`${players[socket.id].name} entrou no servidor com 200 ouro.`);
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
      actionLog(`${p.name} usou uma Poção de Mana.`);
      return;
    }

    if ((p.inventory.potion || 0) <= 0) return io.to(socket.id).emit("notice", "Você não tem poções de vida.");
    if (p.hp >= p.maxHp) return io.to(socket.id).emit("notice", "Sua vida já está cheia.");

    p.inventory.potion--;
    p.hp = Math.min(p.maxHp, p.hp + 55);
    actionLog(`${p.name} usou uma Poção de Vida.`);
  });

  socket.on("buyNpcPotion", type => {
    buyNpcPotion(socket, type);
  });

  socket.on("marketSell", data => {
    const seller = players[socket.id];
    if (!seller) return;

    const item = String(data?.item || "");
    const amount = Math.max(1, Math.floor(Number(data?.amount || 1)));
    const price = Math.max(1, Math.floor(Number(data?.price || 1)));

    if (!ITEM_INFO[item]) return;

    if ((seller.inventory[item] || 0) < amount) {
      io.to(socket.id).emit("notice", "Você não tem essa quantidade no inventário.");
      return;
    }

    seller.inventory[item] -= amount;

    const listing = {
      id: marketId++,
      sellerId: seller.id,
      seller: seller.name,
      item,
      amount,
      price
    };

    market.push(listing);

    io.to(socket.id).emit("notice", `${amount}x ${ITEM_INFO[item].name} foi colocado no mercado.`);
    actionLog(`${seller.name} colocou ${amount}x ${ITEM_INFO[item].name} no mercado por ${price} ouro.`);
  });

  socket.on("marketBuy", id => {
    const buyer = players[socket.id];
    if (!buyer) return;

    const listingId = Number(id);
    const index = market.findIndex(m => Number(m.id) === listingId);

    if (index === -1) {
      io.to(socket.id).emit("notice", "Esse item já foi vendido.");
      return;
    }

    const listing = market[index];

    if (listing.sellerId === buyer.id) {
      io.to(socket.id).emit("notice", "Você não pode comprar seu próprio item.");
      return;
    }

    if (buyer.gold < listing.price) {
      io.to(socket.id).emit("notice", "Ouro insuficiente.");
      return;
    }

    const seller = players[listing.sellerId];

    buyer.gold -= listing.price;
    buyer.inventory[listing.item] = (buyer.inventory[listing.item] || 0) + listing.amount;

    if (seller) {
      seller.gold += listing.price;
    }

    market.splice(index, 1);

    io.to(socket.id).emit("notice", `Você comprou ${listing.amount}x ${ITEM_INFO[listing.item].name}.`);
    if (seller) io.to(seller.id).emit("notice", `${buyer.name} comprou seu item por ${listing.price} ouro.`);

    actionLog(`${buyer.name} comprou ${listing.amount}x ${ITEM_INFO[listing.item].name} de ${listing.seller} por ${listing.price} ouro.`);
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
      actionLog(`${players[socket.id].name} saiu do servidor.`);
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
