const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "database.json");

const WORLD = {
  width: 9000,
  height: 6800,
  safeZone: { x: 4190, y: 3060, w: 680, h: 520 },
  npcShop: { x: 4530, y: 3330, name: "Lia, Mercadora" },
  questNpc: { x: 4440, y: 3250, name: "Capitão Rowan" },
  biomes: [
    { id: "forest", name: "Floresta Viva", x: 260, y: 260, w: 1800, h: 1450 },
    { id: "ruins", name: "Ruínas Profanas", x: 3180, y: 350, w: 1700, h: 1400 },
    { id: "swamp", name: "Pântano Sombrio", x: 6100, y: 300, w: 1800, h: 1450 },
    { id: "desert", name: "Deserto Rubro", x: 300, y: 4450, w: 1850, h: 1450 },
    { id: "volcanic", name: "Campos Vulcânicos", x: 3150, y: 4500, w: 1750, h: 1400 },
    { id: "ice", name: "Tundra Cristalina", x: 6100, y: 4400, w: 1800, h: 1450 },
    { id: "base", name: "Base Segura", x: 3690, y: 2760, w: 820, h: 700 }
  ],
  bosses: [
    { id: "boss_forest", name: "Ent Corrompido", x: 850, y: 790, biome: "forest" },
    { id: "boss_ruins", name: "Arconte Profano", x: 4030, y: 870, biome: "ruins" },
    { id: "boss_swamp", name: "Hidra Putrefata", x: 7150, y: 850, biome: "swamp" },
    { id: "boss_desert", name: "Carrasco das Dunas", x: 900, y: 5250, biome: "desert" },
    { id: "boss_volcanic", name: "Behemoth de Cinzas", x: 4070, y: 5250, biome: "volcanic" },
    { id: "boss_ice", name: "Titã Glacial", x: 7150, y: 5250, biome: "ice" }
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

const QUESTS = {
  main_1: {
    id: "main_1",
    type: "main",
    title: "Primeiros Passos",
    description: "Derrote 5 monstros comuns para provar seu valor.",
    target: { kind: "killAny", total: 5 },
    reward: { gold: 80, xp: 120, items: { potion: 2 } }
  },
  main_2: {
    id: "main_2",
    type: "main",
    title: "Cristais de Energia",
    description: "Colete 3 Cristais para fortalecer a base.",
    target: { kind: "collect", item: "crystal", total: 3 },
    reward: { gold: 120, xp: 180, items: { manaPotion: 2 } },
    requires: "main_1"
  },
  side_1: {
    id: "side_1",
    type: "side",
    title: "Ervas Medicinais",
    description: "Colete 5 Ervas para a mercadora Lia.",
    target: { kind: "collect", item: "herb", total: 5 },
    reward: { gold: 60, xp: 80, items: { potion: 3 } }
  },
  side_2: {
    id: "side_2",
    type: "side",
    title: "Presas de Predador",
    description: "Colete 4 Presas derrotando feras.",
    target: { kind: "collect", item: "fang", total: 4 },
    reward: { gold: 100, xp: 130, items: { crystal: 1 } }
  },
  boss_1: {
    id: "boss_1",
    type: "boss",
    title: "Ameaça dos Biomas",
    description: "Derrote 1 Boss de qualquer bioma.",
    target: { kind: "killBoss", total: 1 },
    reward: { gold: 300, xp: 450, items: { crystal: 5 } }
  }
};

const players = {};
const inputs = {};
const sessions = {};
const enemies = [];
const drops = [];
const market = [];

let enemyId = 1;
let dropId = 1;
let marketId = 1;

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { users: {} };
    }
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { users: {} };
  }
}

let db = loadDb();

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, record) {
  const attempt = hashPassword(password, record.salt);
  return attempt.hash === record.hash;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cleanName(name) {
  return String(name || "Aventureiro").replace(/[<>]/g, "").trim().slice(0, 16) || "Aventureiro";
}

function cleanEmail(email) {
  return String(email || "").trim().toLowerCase().slice(0, 80);
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

function publicCharacter(character) {
  return {
    id: character.id,
    name: character.name,
    classId: character.classId,
    className: character.className,
    level: character.level || 1,
    gold: character.gold || 0,
    kills: character.kills || 0
  };
}

function userCharacters(email) {
  return Object.values(db.users[email]?.characters || {}).map(publicCharacter);
}

function defaultQuestState() {
  const state = {};
  for (const id in QUESTS) {
    state[id] = { accepted: ["main_1", "side_1", "side_2", "boss_1"].includes(id), completed: false, claimed: false, progress: 0 };
  }
  return state;
}

function createCharacterData(name, classId) {
  const cls = CLASSES[classId] || CLASSES.swordsman;
  const pos = spawnPoint();
  const id = crypto.randomUUID();

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
    isFlying: false,
    color: cls.color,
    stats: { ...cls.stats },
    inventory: { herb: 2, crystal: 0, fang: 0, potion: 3, manaPotion: 1 },
    quests: defaultQuestState()
  };
}

function createPlayerFromCharacter(socketId, email, character) {
  return {
    ...character,
    id: socketId,
    accountEmail: email,
    characterId: character.id,
    vx: 0,
    vy: 0,
    attackCd: 0,
    quests: character.quests || defaultQuestState()
  };
}

function savePlayerCharacter(player) {
  if (!player?.accountEmail || !player?.characterId) return;
  const user = db.users[player.accountEmail];
  if (!user || !user.characters[player.characterId]) return;

  const saved = { ...player };
  saved.id = player.characterId;
  delete saved.accountEmail;
  delete saved.characterId;
  delete saved.vx;
  delete saved.vy;
  delete saved.attackCd;

  user.characters[player.characterId] = saved;
  saveDb();
}

function availableQuestList(p) {
  const quests = [];

  for (const id in QUESTS) {
    const q = QUESTS[id];
    const st = p.quests?.[id] || { accepted: false, completed: false, claimed: false, progress: 0 };

    const reqOk = !q.requires || p.quests?.[q.requires]?.claimed;

    if (reqOk) {
      quests.push({ ...q, state: st });
    }
  }

  return quests;
}

function sendQuestState(p) {
  io.to(p.id).emit("quests", availableQuestList(p));
}

function updateQuestProgress(p, event) {
  if (!p.quests) p.quests = defaultQuestState();

  for (const id in QUESTS) {
    const q = QUESTS[id];
    const st = p.quests[id] || { accepted: false, completed: false, claimed: false, progress: 0 };

    if (!st.accepted || st.completed || st.claimed) continue;

    let match = false;

    if (q.target.kind === "killAny" && event.kind === "killAny") match = true;
    if (q.target.kind === "killBoss" && event.kind === "killBoss") match = true;
    if (q.target.kind === "collect" && event.kind === "collect" && q.target.item === event.item) match = true;

    if (match) {
      st.progress += event.amount || 1;
      if (st.progress >= q.target.total) {
        st.progress = q.target.total;
        st.completed = true;
        io.to(p.id).emit("notice", `Missão concluída: ${q.title}. Abra Q para receber.`);
        privateLog(p.id, `Missão concluída: ${q.title}.`);
      }
      p.quests[id] = st;
    }
  }

  sendQuestState(p);
}

function claimQuest(p, questId) {
  const q = QUESTS[questId];
  if (!q) return;

  if (!p.quests) p.quests = defaultQuestState();

  const st = p.quests[questId];

  if (!st || !st.completed || st.claimed) {
    io.to(p.id).emit("notice", "Essa missão ainda não pode ser recebida.");
    return;
  }

  st.claimed = true;
  p.gold += q.reward.gold || 0;
  addXp(p, q.reward.xp || 0);

  if (q.reward.items) {
    for (const item in q.reward.items) {
      p.inventory[item] = (p.inventory[item] || 0) + q.reward.items[item];
    }
  }

  if (questId === "main_1" && p.quests.main_2) {
    p.quests.main_2.accepted = true;
  }

  io.to(p.id).emit("notice", `Recompensa recebida: ${q.title}.`);
  privateLog(p.id, `Missão "${q.title}" entregue. +${q.reward.gold || 0} ouro e +${q.reward.xp || 0} XP.`);
  sendQuestState(p);
  savePlayerCharacter(p);
}

function enemyProfile(biome) {
  const profiles = {
    forest: [
      { type: "thornfiend", name: "Florion Espinheiro", color: "#3fbf5f", hp: 70, dmg: 12, size: 34, speed: 1.08, shape: "beast" },
      { type: "direwolf", name: "Lobo Feroz", color: "#7a5cff", hp: 100, dmg: 17, size: 40, speed: 1.25, shape: "wolf" },
      { type: "feralwolf", name: "Lobo Feroz", color: "#b23a48", hp: 130, dmg: 23, size: 44, speed: 1.34, shape: "wolf" },
      { type: "stormbird", name: "Pássaro Tempestade", color: "#9de2ff", hp: 82, dmg: 19, size: 34, speed: 1.45, shape: "bird" },
      { type: "venomcrawler", name: "Cogumelo Venenoso", color: "#65d96e", hp: 88, dmg: 15, size: 36, speed: 1.14, shape: "crawler" }
    ],
    ruins: [
      { type: "voidacolyte", name: "Mago Sombrio", color: "#8f5bff", hp: 130, dmg: 24, size: 40, speed: 1.1, shape: "mage" },
      { type: "boneknight", name: "Cavaleiro Antigo", color: "#d8d0bf", hp: 180, dmg: 28, size: 46, speed: 0.98, shape: "knight" },
      { type: "minotaur", name: "Minotauro Profano", color: "#8a4b2a", hp: 260, dmg: 38, size: 58, speed: 0.92, shape: "minotaur" },
      { type: "abyssspawn", name: "Mascote Abissal", color: "#d84dff", hp: 150, dmg: 30, size: 44, speed: 1.18, shape: "demon" }
    ],
    swamp: [
      { type: "plaguemaw", name: "Sapo Rei do Pântano", color: "#5f8d43", hp: 92, dmg: 16, size: 38, speed: 1.04, shape: "beast" },
      { type: "bogreaver", name: "Guardião do Brejo", color: "#3d5b38", hp: 125, dmg: 21, size: 42, speed: 1.16, shape: "knight" },
      { type: "leechhorror", name: "Gelatina Sombria", color: "#7e394d", hp: 112, dmg: 19, size: 40, speed: 1.12, shape: "crawler" },
      { type: "nightbat", name: "Morcego Noturno", color: "#403060", hp: 70, dmg: 16, size: 32, speed: 1.55, shape: "bird" }
    ],
    desert: [
      { type: "bonescarab", name: "Besouro Dourado", color: "#d39442", hp: 95, dmg: 17, size: 37, speed: 1.14, shape: "crawler" },
      { type: "sandwraith", name: "Fada de Areia", color: "#ce6a38", hp: 110, dmg: 22, size: 39, speed: 1.22, shape: "mage" },
      { type: "dunebutcher", name: "Minotauro das Dunas", color: "#a94a2e", hp: 145, dmg: 25, size: 45, speed: 1.08, shape: "demon" },
      { type: "sandminotaur", name: "Minotauro das Dunas", color: "#c07b3e", hp: 240, dmg: 35, size: 56, speed: 0.96, shape: "minotaur" }
    ],
    volcanic: [
      { type: "ashimp", name: "Imp de Cinzas", color: "#ff6b35", hp: 120, dmg: 23, size: 38, speed: 1.18, shape: "demon" },
      { type: "lavahound", name: "Lobo de Lava", color: "#ff3d2e", hp: 165, dmg: 29, size: 45, speed: 1.17, shape: "wolf" },
      { type: "obsidianbrute", name: "Golem de Obsidiana", color: "#3b2d32", hp: 220, dmg: 34, size: 52, speed: 0.9, shape: "knight" }
    ],
    ice: [
      { type: "crystalwraith", name: "Fada Cristalina", color: "#93edff", hp: 102, dmg: 19, size: 37, speed: 1.12, shape: "mage" },
      { type: "froststalker", name: "Lobo Glacial", color: "#c5f4ff", hp: 135, dmg: 24, size: 43, speed: 1.2, shape: "wolf" },
      { type: "icedevourer", name: "Yeti Cristalino", color: "#69b6ff", hp: 160, dmg: 27, size: 47, speed: 1.04, shape: "beast" }
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
  while (enemies.filter(e => !e.isBoss).length < 95) {
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
    const baseSpeed = 4.1 + Math.min(1.4, p.stats.dex * 0.018);
    const speed = p.isFlying ? baseSpeed * 1.55 : baseSpeed;

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
        updateQuestProgress(p, { kind: "collect", item: d.item, amount: d.amount });
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
    updateQuestProgress(killer, { kind: "killBoss", amount: 1 });
    savePlayerCharacter(killer);
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
  updateQuestProgress(killer, { kind: "killAny", amount: 1 });
  savePlayerCharacter(killer);
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
  socket.on("register", data => {
    const email = cleanEmail(data?.email);
    const password = String(data?.password || "");

    if (!email.includes("@") || password.length < 6) {
      socket.emit("authError", "Use um e-mail válido e senha com no mínimo 6 caracteres.");
      return;
    }

    if (db.users[email]) {
      socket.emit("authError", "Essa conta já existe.");
      return;
    }

    const pass = hashPassword(password);
    db.users[email] = {
      email,
      salt: pass.salt,
      hash: pass.hash,
      characters: {},
      createdAt: Date.now()
    };
    saveDb();

    const token = crypto.randomUUID();
    sessions[socket.id] = { email, token };
    socket.emit("authOk", { email, token, characters: [] });
  });

  socket.on("login", data => {
    const email = cleanEmail(data?.email);
    const password = String(data?.password || "");
    const user = db.users[email];

    if (!user || !verifyPassword(password, user)) {
      socket.emit("authError", "E-mail ou senha incorretos.");
      return;
    }

    const token = crypto.randomUUID();
    sessions[socket.id] = { email, token };
    socket.emit("authOk", { email, token, characters: userCharacters(email) });
  });

  socket.on("listCharacters", () => {
    const session = sessions[socket.id];
    if (!session) return socket.emit("authError", "Faça login primeiro.");
    socket.emit("characters", userCharacters(session.email));
  });

  socket.on("createCharacter", data => {
    const session = sessions[socket.id];
    if (!session) return socket.emit("authError", "Faça login primeiro.");

    const user = db.users[session.email];
    if (!user) return socket.emit("authError", "Conta não encontrada.");

    const count = Object.keys(user.characters || {}).length;
    if (count >= 4) {
      socket.emit("authError", "Limite de 4 personagens por conta.");
      return;
    }

    const character = createCharacterData(data?.name, data?.classId);
    user.characters[character.id] = character;
    saveDb();

    socket.emit("characters", userCharacters(session.email));
  });

  socket.on("selectCharacter", characterId => {
    const session = sessions[socket.id];
    if (!session) return socket.emit("authError", "Faça login primeiro.");

    const user = db.users[session.email];
    const character = user?.characters?.[characterId];

    if (!character) {
      socket.emit("authError", "Personagem não encontrado.");
      return;
    }

    if (players[socket.id]) {
      savePlayerCharacter(players[socket.id]);
      delete players[socket.id];
    }

    players[socket.id] = createPlayerFromCharacter(socket.id, session.email, character);
    inputs[socket.id] = {};
    socket.emit("gameStarted");
    socket.emit("quests", availableQuestList(players[socket.id]));
    io.emit("chat", `Servidor: ${players[socket.id].name} entrou como ${players[socket.id].className}.`);
    privateLog(socket.id, "Personagem carregado com sucesso.");
    forceState();
  });

  socket.on("join", data => {
    const guest = createCharacterData(data?.name || "Convidado", data?.classId || "swordsman");
    players[socket.id] = createPlayerFromCharacter(socket.id, "guest:" + socket.id, guest);
    inputs[socket.id] = {};
    socket.emit("gameStarted");
    socket.emit("quests", availableQuestList(players[socket.id]));
    io.emit("chat", `Servidor: ${players[socket.id].name} entrou como convidado.`);
    forceState();
  });

  socket.on("claimQuest", questId => {
    const p = players[socket.id];
    if (!p) return;
    claimQuest(p, questId);
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

  socket.on("rename", name => {
    const p = players[socket.id];
    if (!p) return;
    p.name = cleanName(name);
    savePlayerCharacter(p);
    forceState();
  });

  socket.on("attack", data => {
    const p = players[socket.id];
    if (!p) return;

    if (inSafeZone(p)) {
      io.to(socket.id).emit("notice", "Você está na base segura. Saia da base para lutar.");
      return;
    }

    if (data && typeof data.enemyId !== "undefined") {
      const enemy = enemies.find(e => e.id === Number(data.enemyId));
      if (!enemy) {
        io.to(socket.id).emit("notice", "Monstro não encontrado.");
        return;
      }

      const cls = CLASSES[p.classId] || CLASSES.swordsman;
      const range = cls.range + (enemy.isBoss ? 20 : 0);

      if (dist(p, enemy) > range) {
        io.to(socket.id).emit("notice", "Alvo fora do alcance.");
        return;
      }
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
      savePlayerCharacter(p);
      forceState();
      return;
    }

    if ((p.inventory.potion || 0) <= 0) return io.to(socket.id).emit("notice", "Você não tem poções de vida.");
    if (p.hp >= p.maxHp) return io.to(socket.id).emit("notice", "Sua vida já está cheia.");

    p.inventory.potion--;
    p.hp = Math.min(p.maxHp, p.hp + 55);
    privateLog(p.id, "Você usou uma Poção de Vida.");
    savePlayerCharacter(p);
    forceState();
  });

  socket.on("buyNpcPotion", type => {
    buyNpcPotion(socket, type);
    if (players[socket.id]) savePlayerCharacter(players[socket.id]);
    forceState();
  });

  socket.on("addStat", stat => {
    const p = players[socket.id];
    if (!p) return;

    if (stat === "vit") stat = "vigor";

    const allowed = ["atk", "vigor", "dex", "int"];

    if (!allowed.includes(stat)) return io.to(socket.id).emit("notice", "Atributo inválido.");
    if ((p.attrPoints || 0) <= 0) return io.to(socket.id).emit("notice", "Você não tem pontos disponíveis.");

    p.attrPoints--;
    p.stats[stat]++;
    recalcDerived(p);

    if (stat === "vigor") p.hp = Math.min(p.maxHp, p.hp + 20);
    if (stat === "int") p.mana = Math.min(p.maxMana, p.mana + 20);

    io.to(socket.id).emit("notice", `+1 em ${stat}. Pontos restantes: ${p.attrPoints}.`);
    privateLog(p.id, `Você adicionou +1 em ${stat}. Pontos restantes: ${p.attrPoints}.`);
    savePlayerCharacter(p);
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
    savePlayerCharacter(seller);
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

    if (listing.sellerId === buyer.id) return io.to(socket.id).emit("notice", "Você não pode comprar seu próprio item.");
    if (buyer.gold < listing.price) return io.to(socket.id).emit("notice", "Ouro insuficiente.");

    const seller = players[listing.sellerId];

    buyer.gold -= listing.price;
    buyer.inventory[listing.item] = (buyer.inventory[listing.item] || 0) + listing.amount;

    if (seller) {
      seller.gold += listing.price;
      io.to(seller.id).emit("notice", "Venda realizada!");
      privateLog(seller.id, `Venda realizada: ${buyer.name} comprou ${listing.amount}x ${ITEM_INFO[listing.item].name} por ${listing.price} ouro.`);
      savePlayerCharacter(seller);
    }

    listing.sold = true;
    market.splice(index, 1);

    io.to(socket.id).emit("notice", `Compra realizada: ${listing.amount}x ${ITEM_INFO[listing.item].name}.`);
    privateLog(socket.id, `Você comprou ${listing.amount}x ${ITEM_INFO[listing.item].name} de ${listing.seller} por ${listing.price} ouro.`);
    savePlayerCharacter(buyer);
    forceState();
  });

  socket.on("teleportSpawn", () => {
    const p = players[socket.id];
    if (!p) return;

    const pos = spawnPoint();
    p.x = pos.x;
    p.y = pos.y;
    p.hp = Math.min(p.maxHp, Math.max(1, p.hp));
    p.mana = Math.min(p.maxMana, p.mana + 10);

    io.to(socket.id).emit("notice", "Você voltou para o spawn.");
    privateLog(socket.id, "Você usou o menu para voltar ao spawn.");
    savePlayerCharacter(p);
    forceState();
  });

  socket.on("toggleFly", () => {
    const p = players[socket.id];
    if (!p) return;

    p.isFlying = !p.isFlying;
    io.to(socket.id).emit("notice", p.isFlying ? "Modo voo ativado. Você está usando prancha voadora." : "Modo voo desativado.");
    privateLog(socket.id, p.isFlying ? "Você subiu na prancha voadora." : "Você desceu da prancha voadora.");
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
      savePlayerCharacter(players[socket.id]);
      io.emit("chat", `Servidor: ${players[socket.id].name} saiu do mundo.`);
    }

    delete players[socket.id];
    delete inputs[socket.id];
    delete sessions[socket.id];
    forceState();
  });
});

spawnEnemies();

setInterval(() => {
  updatePlayers();
  updateEnemies();
  io.emit("state", publicState());
}, 1000 / 30);

setInterval(() => {
  for (const id in players) savePlayerCharacter(players[id]);
}, 15000);

server.listen(PORT, () => {
  console.log(`Servidor online na porta ${PORT}`);
});
