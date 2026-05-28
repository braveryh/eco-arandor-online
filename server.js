const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const WORLD = { width: 2400, height: 1800 };

const players = {};
const inputs = {};
const enemies = [];
const drops = [];
const market = [];

let dropId = 1;
let enemyId = 1;
let marketId = 1;

const ITEM_INFO = {
  herb: { name: "Erva", icon: "🌿" },
  crystal: { name: "Cristal", icon: "💎" },
  fang: { name: "Presa", icon: "🦷" },
  potion: { name: "Poção", icon: "🧪" }
};

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cleanName(name) {
  return String(name || "Aventureiro")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 16) || "Aventureiro";
}

function newPlayer(id, name) {
  return {
    id,
    name: cleanName(name),
    x: rand(300, WORLD.width - 300),
    y: rand(300, WORLD.height - 300),
    vx: 0,
    vy: 0,
    size: 28,
    hp: 100,
    maxHp: 100,
    mana: 80,
    maxMana: 80,
    level: 1,
    xp: 0,
    nextXp: 100,
    gold: 50,
    kills: 0,
    attackCd: 0,
    color: randomColor(),
    inventory: {
      herb: 2,
      crystal: 0,
      fang: 0,
      potion: 3
    }
  };
}

function randomColor() {
  const colors = ["#49a6ff", "#ffd166", "#ef476f", "#06d6a0", "#b388ff", "#f78c6b"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function newEnemy() {
  const type = Math.random() > 0.35 ? "slime" : "wolf";
  return {
    id: enemyId++,
    type,
    x: rand(120, WORLD.width - 120),
    y: rand(120, WORLD.height - 120),
    size: type === "slime" ? 26 : 32,
    hp: type === "slime" ? 45 : 75,
    maxHp: type === "slime" ? 45 : 75,
    speed: type === "slime" ? 1.0 : 1.35,
    damage: type === "slime" ? 8 : 13,
    cd: 0
  };
}

function spawnEnemies() {
  while (enemies.length < 22) enemies.push(newEnemy());
}

function addXp(p, amount) {
  p.xp += amount;
  while (p.xp >= p.nextXp) {
    p.xp -= p.nextXp;
    p.level++;
    p.nextXp = Math.floor(p.nextXp * 1.45);
    p.maxHp += 15;
    p.maxMana += 10;
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

function publicState() {
  return {
    world: WORLD,
    players,
    enemies,
    drops,
    market
  };
}

function updatePlayers() {
  for (const id in players) {
    const p = players[id];
    const input = inputs[id] || {};
    const speed = 4.2;

    let dx = 0;
    let dy = 0;

    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
    }

    p.vx = dx * speed;
    p.vy = dy * speed;

    p.x = Math.max(25, Math.min(WORLD.width - 25, p.x + p.vx));
    p.y = Math.max(25, Math.min(WORLD.height - 25, p.y + p.vy));

    if (p.attackCd > 0) p.attackCd--;
    p.hp = Math.min(p.maxHp, p.hp + 0.015);
    p.mana = Math.min(p.maxMana, p.mana + 0.04);

    for (let i = drops.length - 1; i >= 0; i--) {
      if (dist(p, drops[i]) < 45) {
        const d = drops[i];
        p.inventory[d.item] = (p.inventory[d.item] || 0) + d.amount;
        drops.splice(i, 1);
        io.to(id).emit("notice", `Você coletou ${d.amount}x ${ITEM_INFO[d.item]?.name || d.item}.`);
      }
    }
  }
}

function updateEnemies() {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    let target = null;
    let best = Infinity;

    for (const id in players) {
      const p = players[id];
      const d = dist(e, p);
      if (d < best) {
        best = d;
        target = p;
      }
    }

    if (target && best < 360) {
      const dx = (target.x - e.x) / best;
      const dy = (target.y - e.y) / best;
      e.x += dx * e.speed;
      e.y += dy * e.speed;
    }

    if (e.cd > 0) e.cd--;

    if (target && best < 38 && e.cd <= 0) {
      e.cd = 45;
      target.hp -= e.damage;
      io.to(target.id).emit("notice", `${e.type === "slime" ? "Slime" : "Lobo"} causou ${e.damage} de dano.`);

      if (target.hp <= 0) {
        target.hp = target.maxHp;
        target.mana = target.maxMana;
        target.x = 300;
        target.y = 300;
        target.gold = Math.max(0, target.gold - 15);
        io.to(target.id).emit("notice", "Você caiu em combate e renasceu no acampamento.");
      }
    }
  }
}

function killEnemy(index, killer) {
  const e = enemies[index];
  if (!e) return;

  enemies.splice(index, 1);

  killer.kills++;
  killer.gold += e.type === "slime" ? 8 : 16;
  addXp(killer, e.type === "slime" ? 35 : 60);

  if (e.type === "slime") {
    addDrop(e.x, e.y, Math.random() > 0.45 ? "herb" : "crystal");
  } else {
    addDrop(e.x, e.y, Math.random() > 0.4 ? "fang" : "crystal");
  }

  setTimeout(spawnEnemies, 800);
}

io.on("connection", socket => {
  socket.on("join", data => {
    players[socket.id] = newPlayer(socket.id, data?.name);
    inputs[socket.id] = {};
    io.emit("chat", `Servidor: ${players[socket.id].name} entrou no mundo.`);
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
    if (!p || p.attackCd > 0) return;

    p.attackCd = 18;

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (dist(p, e) < 78) {
        const dmg = 18 + p.level * 6;
        e.hp -= dmg;
        io.to(socket.id).emit("notice", `Você causou ${dmg} de dano.`);

        if (e.hp <= 0) killEnemy(i, p);
        return;
      }
    }

    io.to(socket.id).emit("notice", "Você atacou, mas não acertou nenhum monstro.");
  });

  socket.on("usePotion", () => {
    const p = players[socket.id];
    if (!p) return;

    if ((p.inventory.potion || 0) <= 0) {
      io.to(socket.id).emit("notice", "Você não tem poções.");
      return;
    }

    if (p.hp >= p.maxHp) {
      io.to(socket.id).emit("notice", "Sua vida já está cheia.");
      return;
    }

    p.inventory.potion--;
    p.hp = Math.min(p.maxHp, p.hp + 45);
  });

  socket.on("shopTrade", data => {
    const p = players[socket.id];
    if (!p) return;

    const type = data?.type;

    if (type === "potion") {
      if ((p.inventory.herb || 0) >= 2) {
        p.inventory.herb -= 2;
        p.inventory.potion = (p.inventory.potion || 0) + 1;
        io.to(socket.id).emit("notice", "Troca feita: 2 Ervas por 1 Poção.");
      } else {
        io.to(socket.id).emit("notice", "Você precisa de 2 Ervas.");
      }
    }

    if (type === "gold") {
      if ((p.inventory.crystal || 0) >= 1) {
        p.inventory.crystal -= 1;
        p.gold += 25;
        io.to(socket.id).emit("notice", "Você vendeu 1 Cristal por 25 ouro.");
      } else {
        io.to(socket.id).emit("notice", "Você precisa de 1 Cristal.");
      }
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
      io.to(socket.id).emit("notice", "Você não tem quantidade suficiente desse item.");
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

    io.emit("notice", `${p.name} colocou ${amount}x ${ITEM_INFO[item].name} no mercado.`);
  });

  socket.on("marketBuy", id => {
    const buyer = players[socket.id];
    if (!buyer) return;

    const index = market.findIndex(m => m.id === Number(id));
    if (index === -1) return;

    const listing = market[index];

    if (buyer.gold < listing.price) {
      io.to(socket.id).emit("notice", "Ouro insuficiente.");
      return;
    }

    buyer.gold -= listing.price;
    buyer.inventory[listing.item] = (buyer.inventory[listing.item] || 0) + listing.amount;

    const seller = players[listing.sellerId];
    if (seller) {
      seller.gold += listing.price;
      io.to(seller.id).emit("notice", `Seu item foi vendido por ${listing.price} ouro.`);
    }

    market.splice(index, 1);
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
