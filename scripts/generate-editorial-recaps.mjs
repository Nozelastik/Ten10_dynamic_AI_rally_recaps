
/*
 * TEN10 AI EDITORIAL ENGINE
 * Node.js 20+
 *
 * Reads:
 * Nozelastik/Ten10_WRC_results_for_website
 *
 * Writes:
 * Ten10_Editorial/
 *
 * Required GitHub secret:
 * GEMINI_API_KEY
 */

import fs from "node:fs/promises";

const RESULTS_OWNER = "Nozelastik";
const RESULTS_REPO = "Ten10_WRC_results_for_website";
const RESULTS_BRANCH = "main";
const RESULTS_ROOT = "Ten10_Motorsports_WRC_Results";

const EDITORIAL_DIR = "Ten10_Editorial";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const SEASON = process.env.TEN10_SEASON || "Season 5";
const ROUND_FOLDER = process.env.TEN10_ROUND;
const FORCE = String(process.env.TEN10_FORCE).toLowerCase() === "true";

const CATEGORIES = ["WRC2", "JWRC"];

const MAIN_POINTS = {
  WRC2: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  JWRC: [
    35, 28, 25, 22, 20, 18, 16, 14, 12, 11,
    10, 9, 8, 7, 6, 5, 4, 3, 2, 1
  ]
};

const POWER_STAGE_POINTS = [5, 4, 3, 2, 1];

const ROUND_CODES = {
  "monte carlo": "MO",
  "monte-carlo": "MO",
  "sweden": "SW",
  "mexico": "ME",
  "croatia": "CR",
  "portugal": "PO",
  "kenya": "KE",
  "estonia": "ES",
  "chile": "CH",
  "greece": "GR",
  "japan": "JA",
  "finland": "FI",
  "new zealand": "NZ",
  "sardegna": "IT",
  "sardinia": "IT",
  "tour de corse": "FR",
  "central europe": "CE",
  "spain": "ES"
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeText(value) {
  return String(value ?? "").trim();
}

function parseTimeMs(value) {
  if (typeof value === "number") return value;

  const text = safeText(value);
  if (!text) return 0;

  const match = text.match(
    /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/
  );

  if (!match) return 0;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);

  const fraction = Number(
    `0.${match[4] || "0"}`
  );

  return (
    hours * 3600000 +
    minutes * 60000 +
    seconds * 1000 +
    Math.round(fraction * 1000)
  );
}

function formatTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;

  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}.` +
    `${String(millis).padStart(3, "0")}`
  );
}

function normalizeDriver(row) {
  return safeText(
    row.DisplayName ??
    row.displayName ??
    row.driver ??
    row.Driver ??
    row.name
  );
}

function normalizeStageRow(row) {
  const driver = normalizeDriver(row);

  if (!driver) return null;

  const rank = Number(row.Rank ?? row.rank ?? row.position);

  const timeMs = parseTimeMs(
    row.Time ?? row.time ?? row.stageTime
  );

  const penaltyMs = parseTimeMs(
    row.TimePenalty ?? row.timePenalty ?? row.penalty
  );

  return {
    driver,
    rank: Number.isFinite(rank) ? rank : null,
    timeMs,
    penaltyMs,
    vehicle: safeText(row.Vehicle ?? row.vehicle),
    platform: safeText(row.Platform ?? row.platform),
    isDnf: penaltyMs > 6 * 60 * 1000
  };
}

function encodeRepoPath(path) {
  return path
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
}

function normalizePath(path) {
  return String(path)
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replaceAll("//", "/");
}

function rawUrl(path) {
  const normalizedPath = normalizePath(path);

  // Stage paths from index.json may already include RESULTS_ROOT.
  // Add the prefix only when it is not already present.
  const fullPath = normalizedPath.startsWith(RESULTS_ROOT + "/")
    ? normalizedPath
    : `${RESULTS_ROOT}/${normalizedPath}`;

  return (
    `https://raw.githubusercontent.com/` +
    `${RESULTS_OWNER}/${RESULTS_REPO}/` +
    `${RESULTS_BRANCH}/${encodeRepoPath(fullPath)}`
  );
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Ten10-AI-Editorial"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Could not fetch ${url}: HTTP ${response.status}`
    );
  }

  return response.json();
}

/*
 * Walk the existing index and collect stage JSON paths.
 *
 * Supports:
 * - Nested objects
 * - Arrays
 * - String-valued file entries
 * - Objects where the filename is both the key and value
 *
 * Important:
 * When the filename is both key and value, use it only once.
 */
function collectJsonPaths(node, path = [], output = []) {
  if (typeof node === "string") {
    if (node.toLowerCase().endsWith(".json")) {
      const candidate = node.startsWith(RESULTS_ROOT + "/")
        ? node
        : [...path, node].filter(Boolean).join("/");

      output.push(candidate);
    }

    return output;
  }

  if (Array.isArray(node)) {
    node.forEach((value, index) => {
      collectJsonPaths(value, [...path, String(index)], output);
    });

    return output;
  }

  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (
        typeof value === "string" &&
        value.toLowerCase().endsWith(".json")
      ) {
        const candidate = value.startsWith(RESULTS_ROOT + "/")
          ? value
          : [...path, key].filter(Boolean).join("/");

        output.push(candidate);
      } else {
        collectJsonPaths(value, [...path, key], output);
      }
    }
  }

  return output;
}

function findStageFiles(index, category) {
  const allPaths = [
    ...new Set(
      collectJsonPaths(index).map(normalizePath)
    )
  ];

  const seasonPart = SEASON.toLowerCase();
  const categoryPart = category.toLowerCase();
  const roundPart = ROUND_FOLDER.toLowerCase();

  return allPaths
    .filter(path => {
      const segments = path.toLowerCase().split("/");

      return (
        segments.includes(seasonPart) &&
        segments.includes(categoryPart) &&
        segments.includes(roundPart) &&
        /stage[_-]?\d+.*\.json$/i.test(path)
      );
    })
    .sort((a, b) => {
      const na = Number(a.match(/stage[_-]?(\d+)/i)?.[1] || 0);
      const nb = Number(b.match(/stage[_-]?(\d+)/i)?.[1] || 0);
      return na - nb;
    });
}

function getRoundName(folder) {
  return folder.replace(/^R\d+\s*/i, "").trim() || folder;
}

function getRoundCode(folder) {
  const name = getRoundName(folder).toLowerCase();
  return ROUND_CODES[name] || "";
}

function stageNumber(path) {
  return Number(path.match(/stage[_-]?(\d+)/i)?.[1] || 0);
}

async function loadStageFiles(paths) {
  const stages = [];

  for (const path of paths) {
    const url = rawUrl(path);
    const json = await fetchJson(url);

    const rows = Array.isArray(json)
      ? json
      : (json.results || json.data || json.leaderboard || []);

    const normalized = rows
      .map(normalizeStageRow)
      .filter(Boolean);

    if (!normalized.length) continue;

    stages.push({
      number: stageNumber(path),
      file: path,
      rows: normalized
    });
  }

  return stages.sort((a, b) => a.number - b.number);
}

function calculateEvent(category, stages) {
  assert(stages.length > 0, `No stage data found for ${category}.`);

  const drivers = new Map();

  function getDriver(name) {
    if (!drivers.has(name)) {
      drivers.set(name, {
        driver: name,
        totalMs: 0,
        stagesStarted: 0,
        dnfStages: 0,
        missingStages: 0,
        isDNF: false,
        vehicle: "",
        stageWins: 0,
        stageResults: []
      });
    }

    return drivers.get(name);
  }

  const fastestByStage = new Map();

  for (const stage of stages) {
    const validTimes = stage.rows
      .map(row => row.timeMs)
      .filter(time => time > 0);

    fastestByStage.set(
      stage.number,
      validTimes.length ? Math.min(...validTimes) : 0
    );

    for (const row of stage.rows) {
      const driver = getDriver(row.driver);

      if (row.vehicle) driver.vehicle = row.vehicle;

      if (row.timeMs > 0) {
        driver.totalMs += row.timeMs;
        driver.stagesStarted += 1;
      }

      // A penalty greater than six minutes marks a DNF,
      // but the actual stage time remains in the total.
      if (row.isDnf) {
        driver.dnfStages += 1;
        driver.isDNF = true;
      } else if (row.penaltyMs > 0) {
        driver.totalMs += row.penaltyMs;
      }

      if (row.rank === 1) driver.stageWins += 1;

      driver.stageResults.push({
        stage: stage.number,
        rank: row.rank,
        time: row.timeMs,
        penalty: row.penaltyMs,
        dnf: row.isDnf
      });
    }
  }

  const orderedStageNumbers = stages.map(stage => stage.number);

  for (const driver of drivers.values()) {
    const startedStages = new Set(
      driver.stageResults.map(item => item.stage)
    );

    const firstStarted = Math.min(...startedStages);

    for (const stage of stages) {
      // Do not penalize a driver for stages before their first start.
      if (stage.number <= firstStarted) continue;

      if (!startedStages.has(stage.number)) {
        const fastest = fastestByStage.get(stage.number) || 0;

        if (fastest > 0) {
          driver.totalMs += fastest + 20 * 60 * 1000;
          driver.missingStages += 1;
          driver.isDNF = true;
        }
      }
    }
  }

  const standings = [...drivers.values()]
    .filter(driver => driver.stagesStarted > 0)
    .sort((a, b) =>
      a.totalMs - b.totalMs ||
      a.driver.localeCompare(b.driver)
    )
    .map((driver, index) => ({
      ...driver,
      position: index + 1,
      totalTime: formatTime(driver.totalMs)
    }));

  // The last indexed stage is treated as the Power Stage.
  const powerStage = stages[stages.length - 1];

  const powerStageOrder = [...powerStage.rows]
    .filter(row => row.rank !== null)
    .sort((a, b) =>
      (a.rank ?? 9999) - (b.rank ?? 9999)
    );

  const powerStagePoints = powerStageOrder.map((row, index) => ({
    driver: row.driver,
    position: index + 1,
    points: POWER_STAGE_POINTS[index] || 0
  })).filter(row => row.points > 0);

  const pointsTable = MAIN_POINTS[category].map((points, index) => ({
    position: index + 1,
    points
  }));

  standings.forEach(driver => {
    driver.mainPoints =
      pointsTable.find(item => item.position === driver.position)?.points || 0;

    driver.powerStagePoints =
      powerStagePoints.find(item => item.driver === driver.driver)?.points || 0;

    driver.points =
      driver.mainPoints + driver.powerStagePoints;
  });

  return {
    category,
    stages: stages.map(stage => ({
      number: stage.number,
      rows: stage.rows.length
    })),
    stageCount: stages.length,
    powerStageNumber: powerStage.number,
    standings,
    powerStagePoints,
    winner: standings[0]?.driver || null,
    podium: standings.slice(0, 3).map(driver => driver.driver),
    dnfDrivers: standings
      .filter(driver => driver.isDNF)
      .map(driver => driver.driver)
  };
}

function buildHistoricalContext(sidecar, category) {
  const history = sidecar.categories[category]?.events || [];

  const recent = history.slice(-5);

  const wins = {};
  const podiums = {};
  const points = {};

  for (const event of history) {
    for (const driver of event.standings || []) {
      points[driver.driver] =
        (points[driver.driver] || 0) + (driver.points || 0);

      if (driver.position === 1) {
        wins[driver.driver] = (wins[driver.driver] || 0) + 1;
      }

      if (driver.position <= 3) {
        podiums[driver.driver] =
          (podiums[driver.driver] || 0) + 1;
      }
    }
  }

  return {
    processedRallies: history.length,
    recentRallies: recent.map(event => ({
      round: event.round,
      winner: event.winner,
      podium: event.podium
    })),
    careerInEditorialSystem: Object.entries(points)
      .map(([driver, totalPoints]) => ({
        driver,
        wins: wins[driver] || 0,
        podiums: podiums[driver] || 0,
        points: totalPoints
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 15),
    storylines: sidecar.categories[category]?.storylines || [],
    previousAngles: (sidecar.categories[category]?.editorialHistory || [])
      .slice(-8)
      .map(item => item.angle)
  };
}

function buildPrompt(category, round, result, context) {
  return `
You are the motorsport editor for TEN10 Motorsport WRC Championship.

Write an original rally recap for the ${category} category.

EVENT:
${JSON.stringify(round, null, 2)}

VERIFIED EVENT RESULTS:
${JSON.stringify(result, null, 2)}

EDITORIAL HISTORY:
${JSON.stringify(context, null, 2)}

RULES:
- Use only facts explicitly present in the supplied data.
- Never invent crashes, mechanical failures, weather, strategy,
  driver quotes, emotions, rivalries or team orders.
- Do not claim a driver is a championship leader unless the
  supplied historical data supports it.
- Do not invent historical achievements outside the supplied
  editorial history.
- Avoid repeating recent headlines and angles.
- Find the most interesting factual story in this rally.
- Possible angles include a close finish, a dominant win,
  a first win within the tracked period, a podium breakthrough,
  consistency, a comeback, a stage-winning performance,
  or championship points implications.
- Do not force an angle if the results do not support it.
- You may use dry, understated motorsport humour.
- Write in polished English.
- Keep the paragraph between 65 and 100 words.
- Do not include markdown or HTML.
- The headline must be original and concise.
- Keep the storylines array factual and useful for future recaps.

Return ONLY valid JSON with this structure:
{
  "headline": "A short original headline",
  "paragraph": "A 65 to 100 word recap.",
  "angle": "A short label describing the editorial angle.",
  "storylines": ["Factual storyline to remember"],
  "factsUsed": ["Verified result fact"]
}
`;
}

async function generateArticle(category, round, result, context) {
  assert(GEMINI_API_KEY, "Missing GEMINI_API_KEY secret.");

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${GEMINI_MODEL}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: buildPrompt(category, round, result, context)
        }]
      }],
      generationConfig: {
        temperature: 0.85,
        responseMimeType: "application/json"
      }
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      `Gemini API error ${response.status}: ` +
      JSON.stringify(payload)
    );
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  assert(text, `Gemini returned an empty response for ${category}.`);

  const article = JSON.parse(text);

  assert(article.headline, "Gemini article has no headline.");
  assert(article.paragraph, "Gemini article has no paragraph.");
  assert(article.angle, "Gemini article has no editorial angle.");

  const words = article.paragraph.trim().split(/\s+/);

  if (words.length > 100) {
    article.paragraph = words.slice(0, 100).join(" ")
      .replace(/[\s,;:—-]+$/, "") + ".";
  }

  return {
    category,
    headline: safeText(article.headline),
    paragraph: safeText(article.paragraph),
    angle: safeText(article.angle),
    storylines: Array.isArray(article.storylines)
      ? article.storylines.map(safeText).filter(Boolean).slice(0, 5)
      : [],
    factsUsed: Array.isArray(article.factsUsed)
      ? article.factsUsed.map(safeText).filter(Boolean).slice(0, 8)
      : [],
    generatedAt: new Date().toISOString()
  };
}

async function readSidecar() {
  const path = `${EDITORIAL_DIR}/editorial-sidecar.json`;

  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return {
      version: 1,
      updatedAt: null,
      categories: {
        WRC2: {
          events: [],
          storylines: [],
          editorialHistory: []
        },
        JWRC: {
          events: [],
          storylines: [],
          editorialHistory: []
        }
      }
    };
  }
}

async function writeJson(path, data) {
  await fs.writeFile(
    path,
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );
}

async function main() {
  assert(ROUND_FOLDER, "Missing TEN10_ROUND workflow input.");

  await fs.mkdir(EDITORIAL_DIR, { recursive: true });

  console.log(`Season: ${SEASON}`);
  console.log(`Round: ${ROUND_FOLDER}`);
  console.log(`Force: ${FORCE}`);

  const indexPath = `${RESULTS_ROOT}/index.json`;
  const index = await fetchJson(rawUrl(indexPath));

  const sidecar = await readSidecar();

  const roundName = getRoundName(ROUND_FOLDER);
  const roundCode = getRoundCode(ROUND_FOLDER);

  const round = {
    season: SEASON,
    folder: ROUND_FOLDER,
    name: roundName,
    code: roundCode
  };

  const pending = [];

  for (const category of CATEGORIES) {
    console.log(`\nProcessing ${category}...`);

    const categoryMemory = sidecar.categories[category];

    const existing = categoryMemory.events.find(
      event =>
        event.season === SEASON &&
        event.folder === ROUND_FOLDER
    );

    if (existing && !FORCE) {
      throw new Error(
        `${category} ${ROUND_FOLDER} has already been processed. ` +
        `Use force=true to regenerate it.`
      );
    }

    const stagePaths = findStageFiles(index, category);

    assert(
      stagePaths.length > 0,
      `No stage JSON files found for ${SEASON}/${category}/${ROUND_FOLDER}.`
    );

    console.log(`Found ${stagePaths.length} stage files.`);

    const stages = await loadStageFiles(stagePaths);

    assert(
      stages.length > 0,
      `Stage files were found, but contained no usable rows for ${category}.`
    );

    const result = calculateEvent(category, stages);

    assert(result.standings.length > 0, `No standings for ${category}.`);

    const context = buildHistoricalContext(sidecar, category);

    const article = await generateArticle(
      category,
      round,
      result,
      context
    );

    const eventRecord = {
      season: SEASON,
      folder: ROUND_FOLDER,
      round: roundName,
      roundCode,
      processedAt: new Date().toISOString(),
      winner: result.winner,
      podium: result.podium,
      stageCount: result.stageCount,
      standings: result.standings.map(driver => ({
        driver: driver.driver,
        position: driver.position,
        totalTime: driver.totalTime,
        points: driver.points,
        mainPoints: driver.mainPoints,
        powerStagePoints: driver.powerStagePoints,
        stageWins: driver.stageWins,
        dnfStages: driver.dnfStages,
        missingStages: driver.missingStages,
        isDNF: driver.isDNF
      }))
    };

    pending.push({
      category,
      result,
      article,
      eventRecord
    });
  }

  // Only update the persistent files after BOTH AI articles succeed.
  for (const item of pending) {
    const memory = sidecar.categories[item.category];

    memory.events = memory.events.filter(
      event => !(
        event.season === SEASON &&
        event.folder === ROUND_FOLDER
      )
    );

    memory.events.push(item.eventRecord);

    memory.storylines = [
      ...item.article.storylines,
      ...memory.storylines
    ].filter((value, index, array) =>
      array.indexOf(value) === index
    ).slice(0, 30);

    memory.editorialHistory = [
      ...memory.editorialHistory.filter(
        entry => !(
          entry.season === SEASON &&
          entry.folder === ROUND_FOLDER
        )
      ),
      {
        season: SEASON,
        round: ROUND_FOLDER,
        headline: item.article.headline,
        angle: item.article.angle,
        generatedAt: item.article.generatedAt
      }
    ].slice(-40);

    const output = {
      version: 1,
      latest: {
        season: SEASON,
        round: ROUND_FOLDER,
        roundName,
        roundCode,
        category: item.category,
        headline: item.article.headline,
        paragraph: item.article.paragraph,
        angle: item.article.angle,
        generatedAt: item.article.generatedAt,
        winner: item.result.winner,
        podium: item.result.podium
      }
    };

    await writeJson(
      `${EDITORIAL_DIR}/${item.category}-recaps.json`,
      output
    );

    console.log(`Generated ${item.category}: ${item.article.headline}`);
  }

  sidecar.updatedAt = new Date().toISOString();

  await writeJson(
    `${EDITORIAL_DIR}/editorial-sidecar.json`,
    sidecar
  );

  console.log("\nBoth category recaps generated successfully.");
}

main().catch(error => {
  console.error("\nEDITORIAL GENERATION FAILED");
  console.error(error);
  process.exitCode = 1;
});
