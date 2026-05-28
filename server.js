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
  width: 7600,
  height: 5600,
  safeZone: { x: 3500, y: 2550, w: 600, h: 460 },
  npcShop: { x: 3800, y: 2780, name: "Lia, Mercadora" },
  biomes: [
    { id: "forest", name: "Floresta Verdejante", x: 250, y: 250, w: 1800, h: 1450 },
    { id: "swamp", name: "Pântano Sombrio", x: 5350, y: 300, w: 1900, h: 1500 },
    { id: "desert", name: "Deserto Rubro", x: 350, y: 3750, w: 1900, h: 1500 },
    { id: "ice", name: "Tundra Cristalina", x: 5350, y: 3700, w: 1900, h: 1500 },
    { id: "ruins", name: "Ruínas Profanas", x: 2850, y: 600, w: 1800, h: 1450 },
    { id: "volcanic", name: "Campos Vulcânicos", x: 2850, y: 3650, w: 1900, h: 1500 },
    { id: "base", name: "Base Segura", x: 3400, y: 2450, w: 800, h: 660 }
  ],
  bosses: [
    { id: "forestBoss", name: "Ent Corrompido", x: 720, y: 670, biome: "forest" },
    { id: "swampBoss", name: "Hidra Putrefata", x: 6750, y: 760, biome: "swamp" },
    { id: "desertBoss", name: "Carrasco das Dunas", x: 760, y: 4880, biome: "desert" },
    { id: "iceBoss", name: "Titã Glacial", x: 6720, y: 4880, biome: "ice" },
    { id: "ruinsBoss", name: "Arconte Profano", x: 3820, y: 1130, biome: "ruins" },
    { id: "volcanicBoss", name: "Behemoth de Cinzas", x: 3820, y: 4720, biome: "volcanic" }
  ]
};

const SPAWN_CENTER = {
  x: WORLD.safeZone.x + WORLD.safeZone.w / 2,
  y: WORLD.safeZone.y + WORLD.safeZone.h / 2
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
    maxHp: 145,
    maxMana: 45,
    range: 72,
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
    range: 270,
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
    range: 290,
    baseDamage: 24,
    cooldown: 28,
    manaCost: 14,
    color: "#b388ff",
    stats: { atk: 4, vigor: 6, dex: 5, int: 18 }
  }
};

function rand(min, max) { return Math.random() * (max - min) + min; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function cleanName(name) { return String(name || "Aventureiro").replace(/[<>]/g, "").trim().slice(0, 16) || "Aventureiro"; }

function inRect(pos, r) {
  return pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h;
}

function inSafeZone(obj) {
  return inRect(obj, WORLD.safeZone);
}

function spawnPoint() {
  const z = WORLD.safeZone;
  return { x: z.x + z.w / 2 + rand(-90, 90), y: z.y + z.h / 2 + rand(-70, 70) };
}

function biomeAt(pos) {
  for (const b of WORLD.biomes) {
    if (inRect(pos, b)) return b.id;
  }
  return "meadow";
}

function mobLevelByPosition(pos) {
  const maxDist = Math.hypot(WORLD.width / 2, WORLD.height / 2);
  const d = dist(pos, SPAWN_CENTER);
  return Math.max(1, Math.min(10, Math.floor((d / maxDist) * 12) + 1));
}

function enemySpawnPoint() {
  let p;
  do {
    p = { x: rand(100, WORLD.width - 100), y: rand(100, WORLD.height - 100) };
  } while (inSafeZone(p) || dist(p, WORLD.npcShop) < 900 || biomeAt(p) === "base");
  return p;
}

function privateLog(id, text) {
  io.to(id).emit("actionLog", text);
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
    attrPoints: 0,
    lastDirX: 1,
    lastDirY: 0,
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

function enemyProfileForBiome(biome) {
  const sets = {
    forest: [
      { type: "thornfiend", name: "Demônio Espinheiro", color: "#3fbf5f", hp: 70, damage: 12, size: 34, speed: 1.08 },
      { type: "direwolf", name: "Lobo Predador", color: "#7a5cff", hp: 105, damage: 17, size: 40, speed: 1.25 },
      { type: "venomCrawler", name: "Rastejante Venenoso", color: "#65d96e", hp: 88, damage: 15, size: 36, speed: 1.14 }
    ],
    swamp: [
      { type: "plagueMaw", name: "Boca da Praga", color: "#5f8d43", hp: 92, damage: 16, size: 38, speed: 1.04 },
      { type: "bogReaver", name: "Ceifador do Brejo", color: "#3d5b38", hp: 125, damage: 21, size: 42, speed: 1.16 },
      { type: "leechHorror", name: "Horror Sanguessuga", color: "#7e394d", hp: 112, damage: 19, size: 40, speed: 1.12 }
    ],
    desert: [
      { type: "boneScarab", name: "Escaravelho Ósseo", color: "#d39442", hp: 95, damage: 17, size: 37, speed: 1.14 },
      { type: "sandWraith", name: "Espectro de Areia", color: "#ce6a38", hp: 110, damage: 22, size: 39, speed: 1.22 },
      { type: "duneButcher", name: "Carniceiro das Dunas", color: "#a94a2e", hp: 145, damage: 25, size: 45, speed: 1.08 }
    ],
    ice: [
      { type: "crystalWraith", name: "Aparição Cristalina", color: "#93edff", hp: 102, damage: 19, size: 37, speed: 1.12 },
      { type: "frostStalker", name: "Perseguidor Gélido", color: "#c5f4ff", hp: 135, damage: 24, size: 43, speed: 1.2 },
      { type: "iceDevourer", name: "Devorador Glacial", color: "#69b6ff", hp: 160, damage: 27, size: 47, speed: 1.04 }
    ],
    ruins: [
      { type: "voidAcolyte", name: "Acólito do Vazio", color: "#8f5bff", hp: 130, damage: 24, size: 40, speed: 1.1 },
      { type: "boneKnight", name: "Cavaleiro Ósseo", color: "#d8d0bf", hp: 180, damage: 28, size: 46, speed: 0.98 },
      { type: "abyssSpawn", name: "Cria Abissal", color: "#d84dff", hp: 150, damage: 30, size: 44, speed: 1.18 }
    ],
    volcanic: [
      { type: "ashImp", name: "Diabrete de Cinzas", color: "#ff6b35", hp: 120, damage: 23, size: 38, speed: 1.18 },
      { type: "lavaHound", name: "Cão de Lava", color: "#ff3d2e", hp: 165, damage: 29, size: 45, speed: 1.17 },
      { type: "obsidianBrute", name: "Bruto de Obsidiana", color: "#3b2d32", hp: 220, damage: 34, size: 52, speed: 0.9 }
    ],
    meadow: [
      { type: "slime", name: "Slime", color: "#54d66b", hp: 50, damage: 8, size: 28, speed: 0.95 },
      { type: "wolf", name: "Lobo", color: "#9b5de5", hp: 85, damage: 14, size: 34, speed: 1.25 }
    ]
  };

  const arr = sets[biome] || sets.meadow;
  return arr[Math.floor(Math.random() * arr.length)];
}

function createBoss(spawn) {
  const bossData = {
    forest: { type: "corruptedEnt", icon: "🌳", damage: 34, hp: 980, color: "#2d8f46" },
    swamp: { type: "plagueHydra", icon: "🐍", damage: 40, hp: 1180, color: "#4b7f52" },
    desert: { type: "duneExecutioner", icon: "🦂", damage: 42, hp: 1100, color: "#d07a2d" },
    ice: { type: "glacialTitan", icon: "🧊", damage: 38, hp: 1250, color: "#84d8ff" },
    ruins: { type: "profaneArchon", icon: "👁️", damage: 45, hp: 1320, color: "#9b5cff" },
    volcanic: { type: "ashBehemoth", icon: "🔥", damage: 48, hp: 1450, color: "#ff4a2d" }
  }[spawn.biome];

  return {
    id: enemyId++,
    bossId: spawn.id,
    isBoss: true,
    type: bossData.type,
    name: spawn.name,
    biome: spawn.biome,
    icon: bossData.icon,
    color: bossData.color,
    level: 10,
    x: spawn.x,
    y: spawn.y,
    size: 82,
    hp: bossData.hp,
    maxHp: bossData.hp,
    speed: 0.72,
    damage: bossData.damage,
    cd: 0
  };
}

function createEnemy() {
  const pos = enemySpawnPoint();
  const biome = biomeAt(pos);
  const profile = enemyProfileForBiome(biome);
  const lvl = mobLevelByPosition(pos);
  const biomeBonus = ["ruins", "volcanic"].includes(biome) ? 1.35 : ["ice", "desert", "swamp"].includes(biome) ? 1.18 : 1;

  return {
    id: enemyId++,
    isBoss: false,
    type: profile.type,
    name: profile.name,
    biome,
    color: profile.color,
    level: lvl,
    x: pos.x,
    y: pos.y,
    size: profile.size + lvl * 0.7,
    hp: Math.floor((profile.hp + lvl * 18) * biomeBonus),
    maxHp: Math.floor((profile.hp + lvl * 18) * biomeBonus),
    speed: profile.speed + lvl * 0.025,
    damage: Math.floor((profile.damage + lvl * 4) * biomeBonus),
    cd: 0
  };
}

function spawnEnemies() {
  while (enemies.filter(e => !e.isBoss).length < 72) enemies.push(createEnemy());

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
    io.to(p.id).emit("notice", `Level up! Você ganhou 5 pontos de atributo.`);
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
    addDrop(e.x + 22, e.y, "fang", 4);
    privateLog(killer.id, `Você derrotou o BOSS ${e.name}! +${goldGain} ouro e +${xpGain} XP.`);
    setTimeout(spawnEnemies, 20000);
    return;
  }

  const goldGain = (e.type === "slime" ? 9 : 18) + e.level * 4;
  const xpGain = (e.type === "slime" ? 36 : 65) + e.level * 12;

  killer.gold += goldGain;
  addXp(killer, xpGain);

  if (["slime", "thornfiend", "bogling", "iceSprite", "crystalWraith"].includes(e.type)) {
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
    if (players[socket.id]) io.emit("chat", `Servidor: ${players[socket.id].name} saiu do mundo.`);
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
