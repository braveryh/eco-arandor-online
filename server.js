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
  width: 6200,
  height: 4600,
  safeZone: { x: 2800, y: 2000, w: 620, h: 480 },
  npcShop: { x: 3110, y: 2250, name: "Lia, Mercadora" },
  biomes: [
    { id: "forest", name: "Floresta Viva", x: 220, y: 220, w: 1550, h: 1250 },
    { id: "ruins", name: "Ruínas Profanas", x: 2350, y: 250, w: 1500, h: 1200 },
    { id: "swamp", name: "Pântano Sombrio", x: 4450, y: 260, w: 1500, h: 1250 },
    { id: "desert", name: "Deserto Rubro", x: 240, y: 3000, w: 1550, h: 1250 },
    { id: "volcanic", name: "Campos Vulcânicos", x: 2350, y: 3050, w: 1500, h: 1200 },
    { id: "ice", name: "Tundra Cristalina", x: 4450, y: 3000, w: 1500, h: 1250 },
    { id: "base", name: "Base Segura", x: 2700, y: 1900, w: 820, h: 700 }
  ],
  bosses: [
    { id: "boss_forest", name: "Ent Corrompido", x: 790, y: 700, biome: "forest" },
    { id: "boss_ruins", name: "Arconte Profano", x: 3100, y: 730, biome: "ruins" },
    { id: "boss_swamp", name: "Hidra Putrefata", x: 5220, y: 760, biome: "swamp" },
    { id: "boss_desert", name: "Carrasco das Dunas", x: 840, y: 3710, biome: "desert" },
    { id: "boss_volcanic", name: "Behemoth de Cinzas", x: 3130, y: 3710, biome: "volcanic" },
    { id: "boss_ice", name: "Titã Glacial", x: 5200, y: 3710, biome: "ice" }
  ]
};

const SPAWN_CENTER = {
  x: WORLD.safeZone.x + WORLD.safeZone.w / 2,
  y: WORLD.safeZone.y + WORLD.safeZone.h / 2
};

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
    maxHp: 145,
    maxMana: 45,
    range: 75,
    baseDamage: 30,
    cooldown: 16,
    manaCost: 0,
    color: "#49a6ff",
    stats: { atk: 10, vigor: 16, dex: 6, int: 2 }
  },
  archer: {
    label: "Arqueiro",
    weapon: "Arco",
    weaponIcon: "🏹",
    maxHp: 105,
    maxMana: 65,
    range: 285,
    baseDamage: 22,
    cooldown: 21,
    manaCost: 0,
    color: "#06d6a0",
    stats: { atk: 8, vigor: 9, dex: 16, int: 4 }
  },
  mage: {
    label: "Mago",
    weapon: "Cajado",
    weaponIcon: "🔮",
    maxHp: 85,
    maxMana: 135,
    range: 305,
    baseDamage: 25,
    cooldown: 28,
    manaCost: 14,
    color: "#b388ff",
    stats: { atk: 4, vigor: 6, dex: 5, int: 18 }
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

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cleanName(name) {
  return String(name || "Aventureiro").replace(/[<>]/g, "").trim().slice(0, 16) || "Aventureiro";
}

function inRect(pos, rect) {
  return pos.x >= rect.x && pos.x <= rect.x + rect.w && pos.y >= rect.y && pos.y <= rect.y + rect.h;
}

function inSafeZone(pos) {
  return inRect(pos, WORLD.safeZone);
}

function biomeAt(pos) {
  for (const biome of WORLD.biomes) {
    if (inRect(pos, biome)) return biome.id;
  }
  return "meadow";
}

function spawnPoint() {
  const z = WORLD.safeZone;
  return {
    x: z.x + z.w / 2 + rand(-95, 95),
    y: z.y + z.h / 2 + rand(-70, 70)
  };
}

function enemySpawnPoint() {
  let p;
  do {
    p = {
      x: rand(100, WORLD.width - 100),
      y: rand(100, WORLD.height - 100)
    };
  } while (inSafeZone(p) || biomeAt(p) === "base" || dist(p, WORLD.npcShop) < 900);
  return p;
}

function mobLevelByPosition(pos) {
  const maxDistance = Math.hypot(WORLD.width / 2, WORLD.height / 2);
  const d = dist(pos, SPAWN_CENTER);
  return Math.max(1, Math.min(10, Math.floor((d / maxDistance) * 12) + 1));
}

function privateLog(playerId, message) {
  io.to(playerId).emit("actionLog", message);
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
    attrPoints: 0,
    color: cls.color,
    stats: { ...cls.stats },
    inventory: {
      herb: 2,
      crystal: 0,
      fang: 0,
      potion: 3,
      manaPotion: 1
    }
  };
}

function enemyProfile(biome) {
  const profiles = {
    forest: [
      { type: "thornfiend", name: "Demônio Espinheiro", color: "#3fbf5f", hp: 70, dmg: 12, size: 34, speed: 1.08, shape: "beast" },
      { type: "direwolf", name: "Lobo Predador", color: "#7a5cff", hp: 100, dmg: 17, size: 40, speed: 1.25, shape: "wolf" },
      { type: "venomcrawler", name: "Rastejante Venenoso", color: "#65d96e", hp: 88, dmg: 15, size: 36, speed: 1.14, shape: "crawler" }
    ],
    ruins: [
      { type: "voidacolyte", name: "Acólito do Vazio", color: "#8f5bff", hp: 130, dmg: 24, size: 40, speed: 1.1, shape: "mage" },
      { type: "boneknight", name: "Cavaleiro Ósseo", color: "#d8d0bf", hp: 180, dmg: 28, size: 46, speed: 0.98, shape: "knight" },
      { type: "abyssspawn", name: "Cria Abissal", color: "#d84dff", hp: 150, dmg: 30, size: 44, speed: 1.18, shape: "demon" }
    ],
    swamp: [
      { type: "plaguemaw", name: "Boca da Praga", color: "#5f8d43", hp: 92, dmg: 16, size: 38, speed: 1.04, shape: "beast" },
      { type: "bogreaver", name: "Ceifador do Brejo", color: "#3d5b38", hp: 125, dmg: 21, size: 42, speed: 1.16, shape: "knight" },
      { type: "leechhorror", name: "Horror Sanguessuga", color: "#7e394d", hp: 112, dmg: 19, size: 40, speed: 1.12, shape: "crawler" }
    ],
    desert: [
      { type: "bonescarab", name: "Escaravelho Ósseo", color: "#d39442", hp: 95, dmg: 17, size: 37, speed: 1.14, shape: "crawler" },
      { type: "sandwraith", name: "Espectro de Areia", color: "#ce6a38", hp: 110, dmg: 22, size: 39, speed: 1.22, shape: "mage" },
      { type: "dunebutcher", name: "Carniceiro das Dunas", color: "#a94a2e", hp: 145, dmg: 25, size: 45, speed: 1.08, shape: "demon" }
    ],
    volcanic: [
      { type: "ashimp", name: "Diabrete de Cinzas", color: "#ff6b35", hp: 120, dmg: 23, size: 38, speed: 1.18, shape: "demon" },
      { type: "lavahound", name: "Cão de Lava", color: "#ff3d2e", hp: 165, dmg: 29, size: 45, speed: 1.17, shape: "wolf" },
      { type: "obsidianbrute", name: "Bruto de Obsidiana", color: "#3b2d32", hp: 220, dmg: 34, size: 52, speed: 0.9, shape: "knight" }
    ],
    ice: [
      { type: "crystalwraith", name: "Aparição Cristalina", color: "#93edff", hp: 102, dmg: 19, size: 37, speed: 1.12, shape: "mage" },
      { type: "froststalker", name: "Perseguidor Gélido", color: "#c5f4ff", hp: 135, dmg: 24, size: 43, speed: 1.2, shape: "wolf" },
      { type: "icedevourer", name: "Devorador Glacial", color: "#69b6ff", hp: 160, dmg: 27, size: 47, speed: 1.04, shape: "beast" }
    ],
    meadow: [
      { type: "slime", name: "Slime", color: "#54d66b", hp: 50, dmg: 8, size: 28, speed: 0.95, shape: "slime" },
      { type: "wolf", name: "Lobo", color: "#9b5de5", hp: 85, dmg: 14, size: 34, speed: 1.25, shape: "wolf" }
    ]
  };

  const list = profiles[biome] || profiles.meadow;
  return list[Math.floor(Math.random() * list.length)];
}

function createBoss(spawn) {
  const data = {
    forest: { type: "corruptedent", icon: "🌳", color: "#2d8f46", hp: 980, dmg: 34, shape: "ent" },
    ruins: { type: "profaneArchon", icon: "👁️", color: "#9b5cff", hp: 1320, dmg: 45, shape: "mage" },
    swamp: { type: "plaguehydra", icon: "🐍", color: "#4b7f52", hp: 1180, dmg: 40, shape: "hydra" },
    desert: { type: "duneexecutioner", icon: "🦂", color: "#d07a2d", hp: 1100, dmg: 42, shape: "scorpion" },
    volcanic: { type: "ashbehemoth", icon: "🔥", color: "#ff4a2d", hp: 1450, dmg: 48, shape: "demon" },
    ice: { type: "glacialtitan", icon: "🧊", color: "#84d8ff", hp: 1250, dmg: 38, shape: "golem" }
  }[spawn.biome];

  return {
    id: enemyId++,
    bossId: spawn.id,
    isBoss: true,
    type: data.type,
    name: spawn.name,
    biome: spawn.biome,
    icon: data.icon,
    color: data.color,
    shape: data.shape,
    level: 10,
    x: spawn.x,
    y: spawn.y,
    size: 82,
    hp: data.hp,
    maxHp: data.hp,
    speed: 0.72,
    damage: data.dmg,
    cd: 0
  };
}

function createEnemy() {
  const pos = enemySpawnPoint();
  const biome = biomeAt(pos);
  const profile = enemyProfile(biome);
  const level = mobLevelByPosition(pos);
  const biomeBonus = ["ruins", "volcanic"].includes(biome) ? 1.35 : ["ice", "desert", "swamp"].includes(biome) ? 1.18 : 1;

  const hp = Math.floor((profile.hp + level * 18) * biomeBonus);

  return {
    id: enemyId++,
    isBoss: false,
    type: profile.type,
    name: profile.name,
    biome,
    color: profile.color,
    shape: profile.shape,
    level,
    x: pos.x,
    y: pos.y,
    size: profile.size + level * 0.7,
    hp,
    maxHp: hp,
    speed: profile.speed + level * 0.025,
    damage: Math.floor((profile.dmg + level * 4) * biomeBonus),
    cd: 0
  };
}

function spawnEnemies() {
  while (enemies.filter(e => !e.isBoss).length < 72) {
    enemies.push(createEnemy());
  }

  for (const boss of WORLD.bosses) {
    if (!enemies.some(e => e.bossId === boss.id)) {
      enemies.push(createBoss(boss));
    }
  }
}

function recalcDerived(p) {
  const cls = CLASSES[p.classId] || CLASSES.swordsman;
  p.maxHp = cls.maxHp + (p.level - 1) * 8 + p.stats.vigor * 7;
  p.maxMana = cls.maxMana + (p.level - 1) * 4 + p.stats.int * 5;
  p.hp = Math.min(p.hp, p.maxHp);
  p.mana = Math.min(p.mana, p.maxMana);
}

function addXp(p, amount) {
  p.xp += amount;

  while (p.xp >= p.nextXp) {
    p.xp -= p.nextXp;
    p.level++;
    p.nextXp = Math.floor(p.nextXp * 1.45);
    p.attrPoints += 5;
    recalcDerived(p);
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    io.to(p.id).emit("notice", "Level up! Você ganhou 5 pontos de atributo.");
    privateLog(p.id, `Você subiu para o nível ${p.level}. Abra H e distribua seus pontos.`);
  }
}

function addDrop(x, y, item, amount = 1) {
  drops.push({ id: dropId++, x, y, item, amount });
}

function updatePlayers() {
  for (const id in players) {
    const p = players[id];
    const input = inputs[id] || {};
    const speed = 4.1 + Math.min(1.4, p.stats.dex * 0.018);

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
    }

    p.vx = dx * speed;
    p.vy = dy * speed;
    p.x = Math.max(25, Math.min(WORLD.width - 25, p.x + p.vx));
    p.y = Math.max(25, Math.min(WORLD.height - 25, p.y + p.vy));

    if (p.attackCd > 0) p.attackCd--;
    p.hp = Math.min(p.maxHp, p.hp + 0.018 + p.stats.vigor * 0.0009);
    p.mana = Math.min(p.maxMana, p.mana + 0.065 + p.stats.int * 0.0012);

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];

      if (dist(p, d) < 44) {
        p.inventory[d.item] = (p.inventory[d.item] || 0) + d.amount;
        drops.splice(i, 1);
        io.to(id).emit("notice", `Coletado: ${d.amount}x ${ITEM_INFO[d.item]?.name || d.item}.`);
        privateLog(id, `Você coletou ${d.amount}x ${ITEM_INFO[d.item]?.name || d.item}.`);
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

    if (target && best < (e.isBoss ? 560 : 430) && best > 0) {
      e.x += ((target.x - e.x) / best) * e.speed;
      e.y += ((target.y - e.y) / best) * e.speed;
    }

    if (e.cd > 0) e.cd--;

    if (target && best < (e.isBoss ? 58 : 40) && e.cd <= 0) {
      e.cd = e.isBoss ? 60 : 45;

      const damage = Math.max(1, e.damage - Math.floor(target.stats.vigor * 0.12));
      target.hp -= damage;

      io.to(target.id).emit("damageTaken", { x: target.x, y: target.y - 35, damage });
      io.to(target.id).emit("notice", `${e.isBoss ? "BOSS " : ""}${e.name} Nv.${e.level} causou ${damage} de dano.`);
      privateLog(target.id, `${e.isBoss ? "BOSS " : ""}${e.name} Nv.${e.level} causou ${damage} de dano em você.`);

      if (target.hp <= 0) {
        const pos = spawnPoint();
        target.hp = target.maxHp;
        target.mana = target.maxMana;
        target.x = pos.x;
        target.y = pos.y;
        target.gold = Math.max(0, target.gold - 20);
        io.to(target.id).emit("notice", "Você foi derrotado e voltou para a base segura.");
        privateLog(target.id, "Você foi derrotado e perdeu até 20 ouro.");
      }
    }
  }
}

function killEnemy(index, killer) {
  const e = enemies[index];

  if (!e) return;

  enemies.splice(index, 1);
  killer.kills++;

  if (e.isBoss) {
    const goldGain = 260;
    const xpGain = 520;

    killer.gold += goldGain;
    addXp(killer, xpGain);
    addDrop(e.x, e.y, "crystal", 6);
    addDrop(e.x + 24, e.y, "fang", 4);

    privateLog(killer.id, `Você derrotou o BOSS ${e.name}! +${goldGain} ouro e +${xpGain} XP.`);
    setTimeout(spawnEnemies, 20000);
    return;
  }

  const goldGain = 12 + e.level * 4;
  const xpGain = 38 + e.level * 12;

  killer.gold += goldGain;
  addXp(killer, xpGain);

  if (["slime", "thornfiend", "venomcrawler", "crystalwraith"].includes(e.type)) {
    addDrop(e.x, e.y, Math.random() > 0.45 ? "herb" : "crystal");
  } else {
    addDrop(e.x, e.y, Math.random() > 0.45 ? "fang" : "crystal");
  }

  privateLog(killer.id, `Você matou ${e.name} Nv.${e.level}. +${goldGain} ouro e +${xpGain} XP.`);
  setTimeout(spawnEnemies, 900);
}

function calcDamage(p, cls) {
  if (p.classId === "mage") return cls.baseDamage + p.level * 4 + Math.floor(p.stats.int * 1.35);
  if (p.classId === "archer") return cls.baseDamage + p.level * 4 + Math.floor(p.stats.dex * 1.15);
  return cls.baseDamage + p.level * 4 + Math.floor(p.stats.atk * 1.2);
}

function attackEnemy(player) {
  const cls = CLASSES[player.classId] || CLASSES.swordsman;

  if (player.attackCd > 0) return;

  if (cls.manaCost && player.mana < cls.manaCost) {
    io.to(player.id).emit("notice", "Mana insuficiente.");
    return;
  }

  player.attackCd = Math.max(8, cls.cooldown - Math.floor(player.stats.dex * 0.06));

  if (cls.manaCost) player.mana -= cls.manaCost;

  let bestIndex = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const d = dist(player, e);

    if (d <= cls.range + (e.isBoss ? 20 : 0) && d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) {
    io.to(player.id).emit("notice", "Ataque não acertou nenhum monstro.");
    return;
  }

  const e = enemies[bestIndex];
  const damage = calcDamage(player, cls);

  e.hp -= damage;

  io.emit("attackEffect", {
    from: { x: player.x, y: player.y },
    to: { x: e.x, y: e.y },
    classId: player.classId,
    damage
  });

  io.to(player.id).emit("notice", `${cls.label}: ${damage} de dano.`);
  privateLog(player.id, `Você causou ${damage} de dano em ${e.isBoss ? "BOSS " : ""}${e.name} Nv.${e.level}.`);

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

  io.to(socket.id).emit("notice", `Você comprou 1 ${ITEM_INFO[item].name} por ${price} ouro.`);
  privateLog(socket.id, `Você comprou 1 ${ITEM_INFO[item].name} por ${price} ouro na NPC Lia.`);
}

function ranking() {
  return Object.values(players)
    .sort((a, b) => b.level - a.level || b.xp - a.xp || b.kills - a.kills)
    .map((p, i) => ({
      pos: i + 1,
      name: p.name,
      className: p.className,
      level: p.level,
      xp: p.xp,
      kills: p.kills
    }));
}

function publicState() {
  return {
    world: WORLD,
    players,
    enemies,
    drops,
    market,
    ranking: ranking(),
    serverTime: new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Campo_Grande"
    })
  };
}

function forceState() {
  io.emit("state", publicState());
}

io.on("connection", socket => {
  socket.on("join", data => {
    const classId = data?.classId || "swordsman";
    players[socket.id] = createPlayer(socket.id, data?.name, classId);
    inputs[socket.id] = {};

    io.emit("chat", `Servidor: ${players[socket.id].name} entrou como ${players[socket.id].className}.`);
    privateLog(socket.id, "Você entrou no servidor com 200 ouro.");
    forceState();
  });

  socket.on("rename", name => {
    const p = players[socket.id];

    if (!p) return;

    p.name = cleanName(name);
    forceState();
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
      privateLog(p.id, "Você usou uma Poção de Mana.");
      forceState();
      return;
    }

    if ((p.inventory.potion || 0) <= 0) return io.to(socket.id).emit("notice", "Você não tem poções de vida.");
    if (p.hp >= p.maxHp) return io.to(socket.id).emit("notice", "Sua vida já está cheia.");

    p.inventory.potion--;
    p.hp = Math.min(p.maxHp, p.hp + 55);
    privateLog(p.id, "Você usou uma Poção de Vida.");
    forceState();
  });

  socket.on("buyNpcPotion", type => {
    buyNpcPotion(socket, type);
    forceState();
  });

  socket.on("addStat", stat => {
    const p = players[socket.id];

    if (!p) return;

    if (stat === "vit") stat = "vigor";

    const allowed = ["atk", "vigor", "dex", "int"];

    if (!allowed.includes(stat)) {
      io.to(socket.id).emit("notice", "Atributo inválido.");
      return;
    }

    if ((p.attrPoints || 0) <= 0) {
      io.to(socket.id).emit("notice", "Você não tem pontos disponíveis.");
      return;
    }

    p.attrPoints--;
    p.stats[stat]++;
    recalcDerived(p);

    if (stat === "vigor") p.hp = Math.min(p.maxHp, p.hp + 20);
    if (stat === "int") p.mana = Math.min(p.maxMana, p.mana + 20);

    io.to(socket.id).emit("notice", `+1 em ${stat}. Pontos restantes: ${p.attrPoints}.`);
    privateLog(p.id, `Você adicionou +1 em ${stat}. Pontos restantes: ${p.attrPoints}.`);
    forceState();
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

    market.push({
      id: marketId++,
      sellerId: seller.id,
      seller: seller.name,
      item,
      amount,
      price,
      sold: false
    });

    io.to(socket.id).emit("notice", `${amount}x ${ITEM_INFO[item].name} foi colocado no mercado.`);
    privateLog(socket.id, `Você anunciou ${amount}x ${ITEM_INFO[item].name} por ${price} ouro.`);
    forceState();
  });

  socket.on("marketBuy", rawId => {
    const buyer = players[socket.id];

    if (!buyer) return;

    const listingId = Number(rawId);
    const index = market.findIndex(m => Number(m.id) === listingId && !m.sold);

    if (index === -1) {
      io.to(socket.id).emit("notice", "Esse item já foi vendido ou não existe.");
      forceState();
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
      io.to(seller.id).emit("notice", "Venda realizada!");
      privateLog(seller.id, `Venda realizada: ${buyer.name} comprou ${listing.amount}x ${ITEM_INFO[listing.item].name} por ${listing.price} ouro.`);
    }

    listing.sold = true;
    market.splice(index, 1);

    io.to(socket.id).emit("notice", `Compra realizada: ${listing.amount}x ${ITEM_INFO[listing.item].name}.`);
    privateLog(socket.id, `Você comprou ${listing.amount}x ${ITEM_INFO[listing.item].name} de ${listing.seller} por ${listing.price} ouro.`);
    forceState();
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
    forceState();
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
