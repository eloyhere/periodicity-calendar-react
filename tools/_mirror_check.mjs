// 临时校验脚本：用 JS 镜像 christmas_tree.py 的构图算法，检查 ASCII 排版是否对齐。
const LEAF = "*";
const TRUNK = "|";
const ORNAMENTS = ["o", "O", "@", "+"];
const SNOW = "=";

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCanvas(height, tiers) {
  const rand = mulberry32(20251225);
  const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  height = Math.max(3, height);
  tiers = Math.max(1, Math.min(tiers, Math.max(1, Math.floor(height / 2))));
  const tierH = Math.max(1, Math.floor(height / tiers));
  const growth = Math.max(1, Math.floor(tierH / 2));

  const halves = [];
  for (let t = 0; t < tiers; t++) for (let j = 0; j < tierH; j++) halves.push(t * growth + j);
  const maxHalf = halves[halves.length - 1];
  const center = maxHalf;
  const width = 2 * maxHalf + 1;

  const grid = halves.map(() => Array.from({ length: width }, () => [" ", "space"]));
  halves.forEach((half, r) => {
    for (let c = center - half; c <= center + half; c++) grid[r][c] = [LEAF, "leaf"];
  });

  halves.forEach((half, r) => {
    if (half < 2) return;
    const count = [0, 1, 1, 2][randInt(0, 3)];
    for (let k = 0; k < count; k++) {
      const c = randInt(center - half + 1, center + half - 1);
      if (grid[r][c][0] === LEAF) grid[r][c] = [ORNAMENTS[randInt(0, 3)], "ornament"];
    }
  });

  const trunkH = Math.max(2, Math.floor(halves.length / 4));
  const trunkHalf = width >= 7 ? 1 : 0;
  for (let i = 0; i < trunkH; i++) {
    const row = Array.from({ length: width }, () => [" ", "space"]);
    for (let c = center - trunkHalf; c <= center + trunkHalf; c++) row[c] = [TRUNK, "trunk"];
    grid.push(row);
  }
  grid.push(Array.from({ length: width }, () => [SNOW, "snow"]));

  const starRows = halves.length >= 6 ? [[["*", "star"]], [["*", "star"], ["*", "star"], ["*", "star"]]] : [[["*", "star"]]];
  const top = starRows.map((starRow) => {
    const line = Array.from({ length: width }, () => [" ", "space"]);
    const offset = center - Math.floor(starRow.length / 2);
    starRow.forEach((cell, i) => (line[offset + i] = cell));
    return line;
  });

  return { grid: [...top, ...grid], width };
}

for (const height of [11, 16, 24]) {
  const { grid, width } = buildCanvas(height, 3);
  console.log(`=== height=${height} width=${width} rows=${grid.length} ===`);
  for (const row of grid) {
    const line = row.map(([ch]) => ch).join("");
    console.log("|" + line.replace(/\s+$/, "").padEnd(width, " ") + "|" + line.replace(/\s+$/, "").length);
  }
}
