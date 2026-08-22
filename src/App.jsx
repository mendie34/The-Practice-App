import { useState, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { exportProfileData, importProfileData } from "./storage.js";

// Every key this app stores, fetched in one parallel batch on mount rather than each section
// loading its own key one at a time. window.storage here is the real IndexedDB-backed API
// (installed by ProfileGate.jsx before this component ever renders), so unlike the Claude-artifact
// demo build, there's no proxy/race-condition layer needed — just call it directly.
const APP_DATA_KEYS = [
  "golf:sessions",
  "golf:activeSession",
  "putting:sessions",
  "putting:activeSession",
  "putting:activeRound",
  "shortgame:sessions",
  "shortgame:activeSession",
  "tee:sessions",
  "compete:sessions",
  "compete:shortgame:sessions",
  "compete:putting:sessions",
  "settings:preferences",
];

async function loadAllAppData() {
  const results = await Promise.all(
    APP_DATA_KEYS.map(async (key) => {
      try {
        const result = await window.storage.get(key, false);
        return [key, result && result.value ? result.value : null];
      } catch (e) {
        return [key, null];
      }
    })
  );
  return Object.fromEntries(results);
}

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
@media print {
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  * { color: #14291F !important; background: #ffffff !important; border-color: #ccc !important; box-shadow: none !important; }
}
.print-only { display: none; }
.home-info-tooltip { display: none; }
/* Only show the hover tooltip on devices that actually have a mouse (hover: hover) — touchscreens
   don't get a real hover state, and some mobile browsers fake one on first-tap, which is more
   confusing than helpful. Tap-to-open still works everywhere via onClick regardless. */
@media (hover: hover) and (pointer: fine) {
  .home-info-btn:hover .home-info-tooltip { display: block; }
}`;

const COLORS = {
  turfDark: "#14291F",
  turf: "#1D3A2B",
  fairway: "#2F6B4F",
  fairwayLight: "#4C8A68",
  cream: "#F1EAD6",
  creamDim: "#E4DBC2",
  flag: "#C1440E",
  sand: "#C9A66B",
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ===== Unit conversion (display layer only) =====
// Everything is stored and calculated internally in yards/feet, since that's what the sourced
// strokes-gained tables use. Metric mode converts at the edges: values typed in are converted to
// yards/feet before being stored, and stored yards/feet are converted to meters for display.
const YD_TO_M = 0.9144;
const FT_TO_M = 0.3048;

// Yard-scale distances (Range/Short Game target distances, windows) — whole-number display.
function ydsToUnitRound(yds, units) {
  return units === "metric" ? Math.round(yds * YD_TO_M) : Math.round(yds);
}
function unitToYdsRound(val, units) {
  return units === "metric" ? Math.round(val / YD_TO_M) : Math.round(val);
}
// Precise version (no rounding) for values that feed back into SG math, e.g. a typed carry distance.
function ydsToUnit(yds, units) {
  return units === "metric" ? yds * YD_TO_M : yds;
}
function unitToYds(val, units) {
  return units === "metric" ? val / YD_TO_M : val;
}

// Feet-scale distances (Putting windows/targets, short game result proximity).
function ftToUnitRound(ft, units) {
  return units === "metric" ? Math.round(ft * FT_TO_M) : Math.round(ft);
}
function unitToFtRound(val, units) {
  return units === "metric" ? Math.round(val / FT_TO_M) : Math.round(val);
}
function ftToUnit(ft, units) {
  return units === "metric" ? ft * FT_TO_M : ft;
}
function unitToFt(val, units) {
  return units === "metric" ? val / FT_TO_M : val;
}

function fmt1(v) {
  return Math.round(v * 10) / 10;
}

function longUnitLabel(units) {
  return units === "metric" ? "m" : "y";
}
function shortUnitLabel(units) {
  return units === "metric" ? "m" : "ft";
}

function randomTarget(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Green: within 5% of target. Amber: within 7%. Red: beyond that.
function ragStatus(diff, target) {
  if (!target) return "red";
  const pct = (diff / target) * 100;
  if (pct <= 5) return "green";
  if (pct <= 7) return "amber";
  return "red";
}

function ragColor(status) {
  if (status === "green") return COLORS.fairwayLight;
  if (status === "amber") return COLORS.sand;
  return COLORS.flag;
}

// Each screen's logical "parent" for the header's BACK button. A static map rather than a true
// navigation history stack — simpler and lower-risk given the app's fairly shallow, predictable
// screen hierarchy, though it means Back always returns to the same place regardless of how a
// screen was reached (e.g. Analysis always goes back to Home, even when opened via a section's
// "View analysis" link rather than the Home tile).
const BACK_MAP = {
  rangeChoose: "home",
  setup: "rangeChoose",
  practice: "setup",
  summary: "setup",
  teeaccuracy: "rangeChoose",
  teeAccuracyPractice: "teeaccuracy",
  teeAccuracySummary: "teeaccuracy",
  shortgame: "home",
  shortGamePractice: "shortgame",
  shortGameSummary: "shortgame",
  putting: "home",
  puttingPractice: "putting",
  puttingSummary: "putting",
  analysis: "home",
  settings: "home",
  competeChoose: "home",
  competeSetup: "competeChoose",
  competePlay: "competeSetup",
  competeSummary: "competeSetup",
  competeShortGameSetup: "competeChoose",
  competeShortGamePlay: "competeShortGameSetup",
  competeShortGameSummary: "competeShortGameSetup",
  competePuttingSetup: "competeChoose",
  competePuttingPlay: "competePuttingSetup",
  competePuttingSummary: "competePuttingSetup",
};

const TIMESCALES = [
  { key: "all", label: "ALL", months: null },
  { key: "12m", label: "12M", months: 12 },
  { key: "6m", label: "6M", months: 6 },
  { key: "3m", label: "3M", months: 3 },
  { key: "1m", label: "1M", months: 1 },
];

function filterByTimescale(sessions, key) {
  const scale = TIMESCALES.find((t) => t.key === key);
  if (!scale || scale.months === null) return sessions;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - scale.months);
  return sessions.filter((s) => new Date(s.date) >= cutoff);
}

// Group distances into 25y bands, e.g. "75-100"
function bucketFor(target) {
  const start = Math.floor(target / 25) * 25;
  return `${start}-${start + 25}`;
}

function bucketSortKey(label) {
  return parseInt(label.split("-")[0], 10);
}

// Flatten filtered sessions into shots tagged with date + distance bucket + miss %,
// sorted chronologically (oldest first) so we can look at trends over time.
function flattenShots(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.shots.forEach((sh) => {
        rows.push({
          date: s.date,
          target: sh.target,
          actual: sh.actual,
          signedMiss: sh.actual - sh.target, // negative = short of pin, positive = long
          diff: sh.diff,
          missPct: sh.target ? (sh.diff / sh.target) * 100 : 0,
          sg: sgForApproachShot(sh.target, sh.actual),
          bucket: bucketFor(sh.target),
        });
      });
    });
  return rows;
}

// ===== TEMP TEST DATA — remove this whole block (through generateFakeSessions) when asked =====
function generateFakeSessions(count = 18) {
  const now = new Date();
  const rangeOptions = [
    [50, 100],
    [75, 125],
    [100, 150],
    [50, 150],
    [125, 175],
    [150, 200],
  ];
  const shotCountOptions = [10, 20, 50];
  const sessions = [];
  const N = count;

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1); // 0 = oldest, 1 = newest
    const monthsAgo = 13 - progress * 13;
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    const shotCount = shotCountOptions[Math.floor(Math.random() * shotCountOptions.length)];
    const [minDist, maxDist] = rangeOptions[Math.floor(Math.random() * rangeOptions.length)];

    const shots = [];
    for (let s = 0; s < shotCount; s++) {
      const target = randomTarget(minDist, maxDist);
      let baseMissPct;
      if (target < 75) {
        baseMissPct = 4; // short game — consistently tight
      } else if (target < 125) {
        baseMissPct = 9 - progress * 4; // mid range — clear improvement over time (~9% -> ~5%)
      } else if (target < 175) {
        baseMissPct = 9.5 + progress * 1.5; // long range — slowly getting worse (~9.5% -> ~11%)
      } else {
        baseMissPct = 8.5;
      }
      const noise = (Math.random() - 0.5) * 4;
      const missPct = Math.max(0.5, baseMissPct + noise);
      const magnitude = (missPct / 100) * target;
      const sign = Math.random() < 0.5 ? -1 : 1;
      const actual = Math.max(0, Math.round(target + sign * magnitude));
      const diff = Math.abs(actual - target);
      shots.push({ target, actual, diff });
    }

    const totalDiff = shots.reduce((a, sh) => a + sh.diff, 0);
    const avgDiff = totalDiff / shots.length;

    sessions.push({
      id: uid(),
      date: date.toISOString(),
      shotCount: shots.length,
      minDist,
      maxDist,
      shots,
      totalDiff,
      avgDiff,
    });
  }

  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP TEST DATA =====

// ===== TEMP PUTTING TEST DATA — remove this whole block when asked =====
function generateFakePuttingSessions(count = 18) {
  const now = new Date();
  const rangeOptions = [
    [0, 10],
    [0, 20],
    [10, 30],
    [0, 30],
    [20, 40],
    [10, 40],
  ];
  const puttCountOptions = [10, 20, 30];
  const sessions = [];
  const N = count;

  // Draws a putt outcome (1/2/3) given a mean-strokes target, biased toward whole outcomes.
  function drawStrokes(meanStrokes) {
    const r = Math.random();
    if (meanStrokes <= 1.3) {
      // mostly 1-putts, occasional 2
      return r < 0.75 ? 1 : r < 0.98 ? 2 : 3;
    }
    if (meanStrokes <= 1.9) {
      return r < 0.35 ? 1 : r < 0.92 ? 2 : 3;
    }
    if (meanStrokes <= 2.3) {
      return r < 0.15 ? 1 : r < 0.78 ? 2 : 3;
    }
    return r < 0.08 ? 1 : r < 0.6 ? 2 : 3;
  }

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1); // 0 = oldest, 1 = newest
    const monthsAgo = 13 - progress * 13;
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    const puttCount = puttCountOptions[Math.floor(Math.random() * puttCountOptions.length)];
    const [minFt, maxFt] = rangeOptions[Math.floor(Math.random() * rangeOptions.length)];

    const putts = [];
    for (let p = 0; p < puttCount; p++) {
      const targetFt = randomTarget(minFt, maxFt);
      let meanStrokes;
      if (targetFt <= 10) {
        meanStrokes = 1.15; // short putts — consistently strong
      } else if (targetFt <= 20) {
        meanStrokes = 2.0 - progress * 0.45; // clear improvement over time (~2.0 -> ~1.55)
      } else if (targetFt <= 30) {
        meanStrokes = 2.15 + progress * 0.2; // slowly getting worse (~2.15 -> ~2.35)
      } else {
        meanStrokes = 2.3;
      }
      putts.push({ targetFt, strokes: drawStrokes(meanStrokes) });
    }

    const totalStrokes = putts.reduce((a, p) => a + p.strokes, 0);
    const avgStrokes = totalStrokes / putts.length;

    sessions.push({
      id: uid(),
      date: date.toISOString(),
      puttCount: putts.length,
      puttMinFt: minFt,
      puttMaxFt: maxFt,
      putts,
      totalStrokes,
      avgStrokes,
    });
  }

  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP PUTTING TEST DATA =====

// ===== TEMP ON-COURSE TEST DATA — remove this whole block when asked =====
function generateFakeCourseRounds(count = 10) {
  const now = new Date();
  const N = count;
  const rounds = [];

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1); // 0 = oldest, 1 = newest
    const monthsAgo = 5 - progress * 5; // spread over the last ~5 months
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    // Occasionally simulate a partially-logged round (a few holes skipped).
    const holesToLog = Math.random() < 0.15 ? 14 + Math.floor(Math.random() * 4) : 18;

    const putts = [];
    for (let h = 0; h < holesToLog; h++) {
      const r = Math.random();
      let targetFt;
      if (r < 0.25) targetFt = 2 + Math.floor(Math.random() * 6); // short, 2-8ft
      else if (r < 0.75) targetFt = 8 + Math.floor(Math.random() * 17); // mid, 8-25ft
      else targetFt = 25 + Math.floor(Math.random() * 25); // long, 25-50ft

      // Rough amateur-level make odds, gradually improving over the 5-month span.
      const baseline = pgaBaselinePutts(targetFt);
      const amateurPenalty = 0.18 - progress * 0.08;
      const missChance = Math.min(0.92, baseline - 1 + amateurPenalty);
      const rnd = Math.random();
      let strokes;
      if (rnd > missChance) strokes = 1;
      else if (rnd > missChance * 0.12) strokes = 2;
      else strokes = 3;

      // For sample data only: approximate the final putt distance so "feet made" has something
      // realistic to show — a made 1-putt is obviously from the target distance itself, and a
      // multi-putt clean-up is typically a short putt.
      const holedFromFt = strokes === 1 ? targetFt : 1 + Math.floor(Math.random() * 4);

      putts.push({ targetFt, strokes, holedFromFt });
    }

    const totalStrokes = putts.reduce((a, p) => a + p.strokes, 0);
    const avgStrokes = totalStrokes / putts.length;

    rounds.push({
      id: uid(),
      date: date.toISOString(),
      type: "course",
      puttCount: putts.length,
      puttMinFt: Math.min(...putts.map((p) => p.targetFt)),
      puttMaxFt: Math.max(...putts.map((p) => p.targetFt)),
      putts,
      totalStrokes,
      avgStrokes,
    });
  }

  return rounds.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP ON-COURSE TEST DATA =====

// ===== TEMP SHORT GAME TEST DATA — remove this whole block when asked =====
function generateFakeShortGameSessions(count = 15) {
  const now = new Date();
  const N = count;
  const sessions = [];
  const shotCountOptions = [10, 20, 30];
  const lieOptions = [
    ["fairway"],
    ["rough"],
    ["bunker"],
    ["fairway", "rough"],
    ["fairway", "rough", "bunker"],
  ];

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1);
    const monthsAgo = 6 - progress * 6;
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    const shotCount = shotCountOptions[Math.floor(Math.random() * shotCountOptions.length)];
    const lies = lieOptions[Math.floor(Math.random() * lieOptions.length)];
    const minYds = 5 + Math.floor(Math.random() * 10);
    const maxYds = minYds + 10 + Math.floor(Math.random() * 20);

    const shots = [];
    for (let s = 0; s < shotCount; s++) {
      const lie = lies[Math.floor(Math.random() * lies.length)];
      const target = randomTarget(minYds, maxYds);
      // Amateur-level proximity, gradually improving over time, worse from bunker/rough.
      const lieFactor = lie === "fairway" ? 1 : lie === "rough" ? 1.2 : 1.4;
      const baseProximityFt = target * 0.9 * lieFactor * (1.15 - progress * 0.35);
      const noise = (Math.random() - 0.3) * baseProximityFt * 0.6;
      const resultFt = Math.max(0.5, Math.round((baseProximityFt + noise) * 10) / 10);
      shots.push({ lie, target, resultFt });
    }

    sessions.push({
      id: uid(),
      date: date.toISOString(),
      shotCount: shots.length,
      minYds,
      maxYds,
      lies,
      shots,
      avgResultFt: avg(shots.map((s) => s.resultFt)),
    });
  }

  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP SHORT GAME TEST DATA =====

// ===== TEMP TEE ACCURACY TEST DATA — remove this whole block when asked =====
function generateFakeTeeSessions(count = 12) {
  const now = new Date();
  const N = count;
  const sessions = [];
  const shotCountOptions = [10, 20, 30];
  const clubSetOptions = [
    ["driver"],
    ["driver", "fairway"],
    ["driver", "fairway", "hybrid", "iron"],
  ];

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1);
    const monthsAgo = 5 - progress * 5;
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    const shotCount = shotCountOptions[Math.floor(Math.random() * shotCountOptions.length)];
    const clubs = clubSetOptions[Math.floor(Math.random() * clubSetOptions.length)];
    const fairwayWidth = 25 + Math.floor(Math.random() * 15);

    const shots = [];
    for (let s = 0; s < shotCount; s++) {
      const club = clubs[Math.floor(Math.random() * clubs.length)];
      // Amateur-level accuracy, gradually improving over time, worse with driver than irons.
      const clubMissFactor = club === "driver" ? 1.3 : club === "fairway" ? 1.1 : club === "hybrid" ? 0.95 : 0.8;
      const baseHitChance = (0.45 + progress * 0.25) / clubMissFactor;
      shots.push({ club, hit: Math.random() < Math.min(0.9, baseHitChance) });
    }

    const hitCount = shots.filter((s) => s.hit).length;
    sessions.push({
      id: uid(),
      date: date.toISOString(),
      shotCount: shots.length,
      fairwayWidth,
      clubs,
      shots,
      hitCount,
      hitPct: (hitCount / shots.length) * 100,
    });
  }

  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP TEE ACCURACY TEST DATA =====

const YARDAGE_PRESETS = [
  { label: "All", min: 0, max: 300 },
  { label: "25-50", min: 25, max: 50 },
  { label: "50-75", min: 50, max: 75 },
  { label: "75-100", min: 75, max: 100 },
  { label: "100-125", min: 100, max: 125 },
  { label: "125-150", min: 125, max: 150 },
  { label: "150-175", min: 150, max: 175 },
  { label: "175-200", min: 175, max: 200 },
  { label: "200-225", min: 200, max: 225 },
];

// Per-session average miss %, restricted to shots within [filterMin, filterMax], sorted chronologically.
function sessionTrendData(sessions, filterMin, filterMax) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => {
      const shots = s.shots.filter((sh) => sh.target >= filterMin && sh.target <= filterMax);
      if (!shots.length) return null;
      return {
        date: s.date,
        dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        avgMissPct: avg(shots.map((sh) => (sh.target ? (sh.diff / sh.target) * 100 : 0))),
        avgMissYds: avg(shots.map((sh) => sh.diff)),
        avgSG: avg(shots.map((sh) => sgForApproachShot(sh.target, sh.actual))),
        shotCount: shots.length,
      };
    })
    .filter(Boolean);
}

// Average miss % per 25y distance band, restricted to [filterMin, filterMax].
function bucketChartData(sessions, filterMin, filterMax) {
  const rows = flattenShots(sessions).filter((r) => r.target >= filterMin && r.target <= filterMax);
  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });
  return Object.entries(byBucket)
    .map(([label, rs]) => ({
      label,
      avgMissPct: avg(rs.map((r) => r.missPct)),
      avgMissYds: avg(rs.map((r) => r.diff)),
      avgSG: avg(rs.map((r) => r.sg)),
      count: rs.length,
    }))
    .sort((a, b) => bucketSortKey(a.label) - bucketSortKey(b.label));
}

// ===== Putting-specific helpers =====
// Putting distance bands are fixed, in feet, per the user's spec (note the 20/21 gap is intentional).
const PUTTING_BAND_ORDER = { "0-10": 0, "10-20": 1, "21-30": 2, "30+": 3 };

const FEET_PRESETS = [
  { label: "All", min: 0, max: 100 },
  { label: "0-10", min: 0, max: 10 },
  { label: "10-20", min: 10, max: 20 },
  { label: "21-30", min: 21, max: 30 },
  { label: "30+", min: 30, max: 100 },
];

function puttingBucketFor(ft) {
  if (ft <= 10) return "0-10";
  if (ft <= 20) return "10-20";
  if (ft <= 30) return "21-30";
  return "30+";
}

function puttingBucketSortKey(label) {
  return PUTTING_BAND_ORDER[label] ?? 99;
}

// 1-putt = green, 2-putt = amber, 3-putt = red. Same RAG language as the Range section.
function ragStatusForPutts(strokes) {
  if (strokes <= 1) return "green";
  if (strokes === 2) return "amber";
  return "red";
}

// ===== PGA Tour putting baseline (strokes gained) =====
// Source: Mark Broadie, "Putts Gained: Measuring Putting on the PGA TOUR" (Columbia University,
// 2011), Figure 1 — average number of putts to hole out by distance, computed from PGA TOUR
// ShotLink data. This is the same baseline concept the PGA Tour's own Strokes Gained: Putting
// stat is built on. It's a ~2010 snapshot, not this year's exact numbers — the Tour recomputes
// its baseline every year internally but doesn't publish the raw curve.
const PGA_PUTTING_BASELINE = [
  [2, 1.01],
  [3, 1.05],
  [4, 1.14],
  [5, 1.24],
  [6, 1.34],
  [7, 1.43],
  [8, 1.5],
  [9, 1.56],
  [10, 1.61],
  [15, 1.78],
  [20, 1.87],
  [30, 1.98],
  [40, 2.06],
  [50, 2.14],
  [60, 2.21],
  [90, 2.36],
];

// Interpolates (log-linear, matching the log-scale x-axis of Broadie's own chart) between the
// table's sparse points to estimate the baseline for any distance, e.g. 11ft or 25ft.
function pgaBaselinePutts(ft) {
  const table = PGA_PUTTING_BASELINE;
  if (ft <= 0) return 1.0;

  const [firstD, firstP] = table[0];
  if (ft <= firstD) {
    // Anchor at (0ft, 1.0 putts) since a tap-in is essentially always a single putt.
    const t = ft / firstD;
    return 1.0 + t * (firstP - 1.0);
  }

  const [lastD, lastP] = table[table.length - 1];
  if (ft >= lastD) {
    const [prevD, prevP] = table[table.length - 2];
    const t = (Math.log(ft) - Math.log(prevD)) / (Math.log(lastD) - Math.log(prevD));
    return prevP + t * (lastP - prevP); // extrapolates the final segment's slope past 90ft
  }

  for (let i = 0; i < table.length - 1; i++) {
    const [d1, p1] = table[i];
    const [d2, p2] = table[i + 1];
    if (ft >= d1 && ft <= d2) {
      const t = (Math.log(ft) - Math.log(d1)) / (Math.log(d2) - Math.log(d1));
      return p1 + t * (p2 - p1);
    }
  }
  return lastP;
}

// ===== Handicap baseline offsets =====
// Source: round-level average strokes lost per round vs PGA Tour, by category and handicap
// (Mark Broadie's research, as summarized in published strokes-gained benchmark tables). This is
// round-level data, not a full distance-by-distance curve like the tour tables above — so it's
// converted to a flat per-shot offset using standard assumptions of ~9 approach shots, ~8 short
// game shots, and ~29 putts per round. That means the offset is the same regardless of how hard
// the individual shot was, which is a real simplification: a handicap golfer's gap to tour likely
// widens on harder shots. Treat "SG vs your baseline" as a useful approximation, not a precise
// distance-calibrated model the way the tour numbers are.
const HANDICAP_STROKES_LOST_PER_ROUND = {
  tour: { approach: 0, shortgame: 0, putting: 0 },
  scratch: { approach: -1.5, shortgame: -0.5, putting: -0.4 },
  "5": { approach: -3.0, shortgame: -1.0, putting: -0.8 },
  "10": { approach: -4.5, shortgame: -1.5, putting: -1.2 },
  "15": { approach: -6.0, shortgame: -2.0, putting: -1.5 },
  "20": { approach: -7.5, shortgame: -2.5, putting: -1.8 },
  "25": { approach: -9.0, shortgame: -3.0, putting: -2.2 },
  "30": { approach: -10.5, shortgame: -3.5, putting: -2.5 },
};
const SHOTS_PER_ROUND = { approach: 9, shortgame: 8, putting: 29 };

const BASELINE_OPTIONS = [
  { key: "tour", label: "PGA TOUR" },
  { key: "scratch", label: "SCRATCH" },
  { key: "5", label: "5 HCP" },
  { key: "10", label: "10 HCP" },
  { key: "15", label: "15 HCP" },
  { key: "20", label: "20 HCP" },
  { key: "25", label: "25 HCP" },
  { key: "30", label: "30 HCP" },
];

function computeOffsets(handicapKey) {
  const perRound = HANDICAP_STROKES_LOST_PER_ROUND[handicapKey] || HANDICAP_STROKES_LOST_PER_ROUND.tour;
  return {
    approach: perRound.approach / SHOTS_PER_ROUND.approach,
    shortgame: perRound.shortgame / SHOTS_PER_ROUND.shortgame,
    putting: perRound.putting / SHOTS_PER_ROUND.putting,
  };
}

// Module-level "current baseline" — read directly by the sgFor* functions below so every call
// site in the app picks up the active baseline without needing it threaded through as a prop.
// Kept in sync with React state (which drives persistence + re-renders) via applyBaseline().
let currentOffsets = computeOffsets("tour");
function applyBaseline(handicapKey) {
  currentOffsets = computeOffsets(handicapKey);
}

// Strokes gained for a single putt: baseline expected putts from this distance, minus what was
// actually taken, adjusted for the active baseline. Positive = better than baseline, negative = worse.
function sgForPutt(targetFt, strokes) {
  return pgaBaselinePutts(targetFt) - strokes - currentOffsets.putting;
}

// ===== PGA Tour approach-shot baseline (strokes gained), fairway lie =====
// Source: Mark Broadie, "Every Shot Counts" — sampled fairway baseline values (average strokes
// to hole out by distance), the same table structure PGA Tour Strokes Gained: Approach is built
// on. Sparser than the putting table (6 points vs 16), so treat this as a rougher approximation,
// especially between 100-160yd where the sampled points are unusually flat.
const FAIRWAY_APPROACH_BASELINE = [
  [20, 2.4],
  [80, 2.75],
  [100, 2.8],
  [160, 2.85],
  [180, 3.08],
  [200, 3.19],
];

// Same log-linear interpolation approach as the putting baseline.
function pgaBaselineApproach(yds) {
  const table = FAIRWAY_APPROACH_BASELINE;
  if (yds <= 0) return 1.0;

  const [firstD, firstP] = table[0];
  if (yds <= firstD) {
    const t = yds / firstD;
    return 1.0 + t * (firstP - 1.0);
  }

  const [lastD, lastP] = table[table.length - 1];
  if (yds >= lastD) {
    const [prevD, prevP] = table[table.length - 2];
    const t = (Math.log(yds) - Math.log(prevD)) / (Math.log(lastD) - Math.log(prevD));
    return prevP + t * (lastP - prevP);
  }

  for (let i = 0; i < table.length - 1; i++) {
    const [d1, p1] = table[i];
    const [d2, p2] = table[i + 1];
    if (yds >= d1 && yds <= d2) {
      const t = (Math.log(yds) - Math.log(d1)) / (Math.log(d2) - Math.log(d1));
      return p1 + t * (p2 - p1);
    }
  }
  return lastP;
}

// Strokes gained for a single Range shot. Two simplifying assumptions for now:
// - the lie is always fairway (uses the fairway approach baseline for the starting distance)
// - the shot always ends up on the green (the miss distance is converted to feet and run through
//   the putting baseline, rather than a separate around-the-green/rough baseline)
// SG = baseline(start distance) - baseline(distance remaining) - 1
function sgForApproachShot(targetYds, actualYds) {
  const missYds = Math.abs(actualYds - targetYds);
  const missFt = missYds * 3;
  return pgaBaselineApproach(targetYds) - pgaBaselinePutts(missFt) - 1 - currentOffsets.approach;
}

// ===== PGA Tour short-game baselines (strokes gained), rough + sand lies =====
// Same source table as the fairway approach baseline (Broadie, "Every Shot Counts", sampled
// values) — this just uses the rough and sand columns instead of fairway.
const ROUGH_APPROACH_BASELINE = [
  [20, 2.59],
  [80, 2.96],
  [100, 3.02],
  [160, 3.08],
  [180, 3.31],
  [200, 3.42],
];
const SAND_APPROACH_BASELINE = [
  [20, 2.53],
  [80, 3.24],
  [100, 3.23],
  [160, 3.21],
  [180, 3.4],
  [200, 3.55],
];

// Shared log-linear interpolator (same shape as pgaBaselinePutts/pgaBaselineApproach above).
function interpolateBaseline(table, x) {
  if (x <= 0) return 1.0;
  const [firstD, firstP] = table[0];
  if (x <= firstD) {
    const t = x / firstD;
    return 1.0 + t * (firstP - 1.0);
  }
  const [lastD, lastP] = table[table.length - 1];
  if (x >= lastD) {
    const [prevD, prevP] = table[table.length - 2];
    const t = (Math.log(x) - Math.log(prevD)) / (Math.log(lastD) - Math.log(prevD));
    return prevP + t * (lastP - prevP);
  }
  for (let i = 0; i < table.length - 1; i++) {
    const [d1, p1] = table[i];
    const [d2, p2] = table[i + 1];
    if (x >= d1 && x <= d2) {
      const t = (Math.log(x) - Math.log(d1)) / (Math.log(d2) - Math.log(d1));
      return p1 + t * (p2 - p1);
    }
  }
  return lastP;
}

function pgaBaselineRough(yds) {
  return interpolateBaseline(ROUGH_APPROACH_BASELINE, yds);
}
function pgaBaselineSand(yds) {
  return interpolateBaseline(SAND_APPROACH_BASELINE, yds);
}

const LIE_LABELS = { fairway: "FAIRWAY", rough: "ROUGH", bunker: "BUNKER" };
const CLUB_LABELS = { driver: "DRIVER", fairway: "FAIRWAY WOOD", hybrid: "HYBRID", iron: "IRON" };

function shortGameBaseline(lie, yds) {
  if (lie === "rough") return pgaBaselineRough(yds);
  if (lie === "bunker") return pgaBaselineSand(yds);
  return pgaBaselineApproach(yds);
}

// Strokes gained for a short-game shot. Same assumptions as the Range: the shot is assumed to
// finish on the green, so the ending baseline always comes from the putting curve. The starting
// baseline depends on the lie the shot was played from.
function sgForShortGameShot(lie, targetYds, resultFt) {
  return shortGameBaseline(lie, targetYds) - pgaBaselinePutts(resultFt) - 1 - currentOffsets.shortgame;
}

function flattenPutts(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.putts.forEach((p) => {
        rows.push({
          date: s.date,
          targetFt: p.targetFt,
          strokes: p.strokes,
          sg: sgForPutt(p.targetFt, p.strokes),
          bucket: puttingBucketFor(p.targetFt),
        });
      });
    });
  return rows;
}

function puttingSessionTrendData(sessions, filterMin, filterMax) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => {
      const putts = s.putts.filter((p) => p.targetFt >= filterMin && p.targetFt <= filterMax);
      if (!putts.length) return null;
      return {
        date: s.date,
        dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        avgStrokes: avg(putts.map((p) => p.strokes)),
        avgSG: avg(putts.map((p) => sgForPutt(p.targetFt, p.strokes))),
        puttCount: putts.length,
      };
    })
    .filter(Boolean);
}

function puttingBucketChartData(sessions, filterMin, filterMax) {
  const rows = flattenPutts(sessions).filter((r) => r.targetFt >= filterMin && r.targetFt <= filterMax);
  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });
  return Object.entries(byBucket)
    .map(([label, rs]) => ({
      label,
      avgStrokes: avg(rs.map((r) => r.strokes)),
      avgSG: avg(rs.map((r) => r.sg)),
      count: rs.length,
    }))
    .sort((a, b) => puttingBucketSortKey(a.label) - puttingBucketSortKey(b.label));
}

// SG >= 0 = at or better than PGA Tour average from that distance. Small negative is close;
// a bigger negative gap means real strokes lost to the field.
function sgRagColor(avgSG) {
  if (avgSG >= 0) return COLORS.fairwayLight;
  if (avgSG >= -0.15) return COLORS.sand;
  return COLORS.flag;
}

// A hole is complete once its most recent putt attempt actually went in — everything before
// that in the array was a miss that needed a follow-up putt. A hole explicitly marked "no putt"
// (chipped in from off the green) is also complete, with no putt data attached at all.
function isHoleComplete(hole) {
  if (hole.noPutt) return true;
  return hole.putts && hole.putts.length > 0 && hole.putts[hole.putts.length - 1].made === true;
}

// ===== On-course round stats (kept separate from practice-session analysis) =====
function courseRoundStats(session) {
  // session.putts has one entry PER HOLE ({targetFt, strokes, holedFromFt}) — session.putts.length
  // is the number of holes played, not the number of putts taken. The actual total is the sum of
  // strokes across every hole.
  const totalPutts = session.putts.reduce((a, p) => a + p.strokes, 0);
  const ftMade = session.putts.reduce((a, p) => {
    // holedFromFt is the exact distance of whichever putt actually went in — recorded for every
    // round logged with the per-putt entry flow. Older rounds recorded before that existed only
    // have a single distance+strokes pair, so they fall back to the old approximation (only
    // counting holes that went in on the very first putt).
    if (p.holedFromFt != null) return a + p.holedFromFt;
    return a + (p.strokes === 1 ? p.targetFt : 0);
  }, 0);
  const totalSG = session.putts.reduce((a, p) => a + sgForPutt(p.targetFt, p.strokes), 0);
  const avgSG = totalPutts ? totalSG / totalPutts : 0;
  return { totalPutts, ftMade, totalSG, avgSG };
}

function courseRoundTrendData(sessions) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => {
      const stats = courseRoundStats(s);
      return {
        date: s.date,
        dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        ...stats,
      };
    });
}

function computePuttingAnalysis(sessions) {
  const rows = flattenPutts(sessions);
  if (rows.length === 0) return null;

  const overallAvgStrokes = avg(rows.map((r) => r.strokes));
  const overallAvgSG = avg(rows.map((r) => r.sg));
  const onePuttPct = (rows.filter((r) => r.strokes <= 1).length / rows.length) * 100;
  const threePuttPct = (rows.filter((r) => r.strokes >= 3).length / rows.length) * 100;

  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  // Positive trendDelta = SG improved (went up) from earlier to later putts in the period.
  const trendDelta =
    firstHalf.length && secondHalf.length ? avg(secondHalf.map((r) => r.sg)) - avg(firstHalf.map((r) => r.sg)) : 0;

  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });

  const buckets = Object.entries(byBucket).map(([label, bucketRows]) => {
    const bMid = Math.floor(bucketRows.length / 2);
    const bFirst = bucketRows.slice(0, bMid);
    const bSecond = bucketRows.slice(bMid);
    const improvement =
      bFirst.length >= 2 && bSecond.length >= 2 ? avg(bSecond.map((r) => r.sg)) - avg(bFirst.map((r) => r.sg)) : null;
    return {
      label,
      count: bucketRows.length,
      avgStrokes: avg(bucketRows.map((r) => r.strokes)),
      avgSG: avg(bucketRows.map((r) => r.sg)),
      improvement,
    };
  });

  buckets.sort((a, b) => puttingBucketSortKey(a.label) - puttingBucketSortKey(b.label));

  const withEnoughData = buckets.filter((b) => b.count >= 3);
  const strengths = [...withEnoughData].sort((a, b) => b.avgSG - a.avgSG).slice(0, 2);
  const weaknesses = [...withEnoughData].sort((a, b) => a.avgSG - b.avgSG).slice(0, 2);

  const withImprovement = buckets.filter((b) => b.improvement !== null);
  const mostImproved = [...withImprovement].sort((a, b) => b.improvement - a.improvement).filter((b) => b.improvement > 0.05).slice(0, 2);
  const regressing = [...withImprovement].sort((a, b) => a.improvement - b.improvement).filter((b) => b.improvement < -0.05).slice(0, 2);

  return {
    sessionCount: sessions.length,
    puttCount: rows.length,
    overallAvgStrokes,
    overallAvgSG,
    onePuttPct,
    threePuttPct,
    trendDelta,
    buckets,
    strengths,
    weaknesses,
    mostImproved,
    regressing,
  };
}

function computeAnalysis(sessions) {
  const rows = flattenShots(sessions);
  if (rows.length === 0) return null;

  const overallAvgMissPct = avg(rows.map((r) => r.missPct));
  const overallAvgMissYds = avg(rows.map((r) => r.diff));
  const overallAvgSG = avg(rows.map((r) => r.sg));

  // Overall trend: compare first half vs second half chronologically. Positive = SG improved.
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  const trendDelta =
    firstHalf.length && secondHalf.length ? avg(secondHalf.map((r) => r.sg)) - avg(firstHalf.map((r) => r.sg)) : 0;

  // Group by distance bucket.
  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });

  const buckets = Object.entries(byBucket).map(([label, bucketRows]) => {
    const bMid = Math.floor(bucketRows.length / 2);
    const bFirst = bucketRows.slice(0, bMid);
    const bSecond = bucketRows.slice(bMid);
    const improvement =
      bFirst.length >= 2 && bSecond.length >= 2 ? avg(bSecond.map((r) => r.sg)) - avg(bFirst.map((r) => r.sg)) : null;
    return {
      label,
      count: bucketRows.length,
      avgMissPct: avg(bucketRows.map((r) => r.missPct)),
      avgMissYds: avg(bucketRows.map((r) => r.diff)),
      avgSG: avg(bucketRows.map((r) => r.sg)),
      improvement,
    };
  });

  buckets.sort((a, b) => bucketSortKey(a.label) - bucketSortKey(b.label));

  const withEnoughData = buckets.filter((b) => b.count >= 3);
  const strengths = [...withEnoughData].sort((a, b) => b.avgSG - a.avgSG).slice(0, 2);
  const weaknesses = [...withEnoughData].sort((a, b) => a.avgSG - b.avgSG).slice(0, 2);

  const withImprovement = buckets.filter((b) => b.improvement !== null);
  const mostImproved = [...withImprovement].sort((a, b) => b.improvement - a.improvement).filter((b) => b.improvement > 0.05).slice(0, 2);
  const regressing = [...withImprovement].sort((a, b) => a.improvement - b.improvement).filter((b) => b.improvement < -0.05).slice(0, 2);

  return {
    sessionCount: sessions.length,
    shotCount: rows.length,
    overallAvgMissPct,
    overallAvgMissYds,
    overallAvgSG,
    trendDelta,
    buckets,
    strengths,
    weaknesses,
    mostImproved,
    regressing,
  };
}

// ===== Range self-rating mode (no distance measuring device) =====
// No SG or miss-distance is possible without a measured outcome, so this mirrors computeAnalysis's
// shape but ranks distance bands by average self-rating (1-5) instead of strokes gained.
function ratingRagColor(avgRating) {
  if (avgRating >= 4) return COLORS.fairwayLight;
  if (avgRating >= 2.5) return COLORS.sand;
  return COLORS.flag;
}

function flattenRatingShots(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.shots.forEach((sh) => {
        rows.push({ date: s.date, target: sh.target, rating: sh.rating, bucket: bucketFor(sh.target) });
      });
    });
  return rows;
}

function ratingSessionTrendData(sessions) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => ({
      date: s.date,
      dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      avgRating: avg(s.shots.map((sh) => sh.rating)),
      shotCount: s.shots.length,
    }));
}

function computeRangeRatingAnalysis(sessions) {
  const rows = flattenRatingShots(sessions);
  if (rows.length === 0) return null;

  const overallAvgRating = avg(rows.map((r) => r.rating));
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  const trendDelta =
    firstHalf.length && secondHalf.length ? avg(secondHalf.map((r) => r.rating)) - avg(firstHalf.map((r) => r.rating)) : 0;

  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });

  const buckets = Object.entries(byBucket).map(([label, bucketRows]) => {
    const bMid = Math.floor(bucketRows.length / 2);
    const bFirst = bucketRows.slice(0, bMid);
    const bSecond = bucketRows.slice(bMid);
    const improvement =
      bFirst.length >= 2 && bSecond.length >= 2 ? avg(bSecond.map((r) => r.rating)) - avg(bFirst.map((r) => r.rating)) : null;
    return {
      label,
      count: bucketRows.length,
      avgRating: avg(bucketRows.map((r) => r.rating)),
      improvement,
    };
  });

  buckets.sort((a, b) => bucketSortKey(a.label) - bucketSortKey(b.label));

  const withEnoughData = buckets.filter((b) => b.count >= 3);
  const strengths = [...withEnoughData].sort((a, b) => b.avgRating - a.avgRating).slice(0, 2);
  const weaknesses = [...withEnoughData].sort((a, b) => a.avgRating - b.avgRating).slice(0, 2);

  const withImprovement = buckets.filter((b) => b.improvement !== null);
  const mostImproved = [...withImprovement].sort((a, b) => b.improvement - a.improvement).filter((b) => b.improvement > 0.2).slice(0, 2);
  const regressing = [...withImprovement].sort((a, b) => a.improvement - b.improvement).filter((b) => b.improvement < -0.2).slice(0, 2);

  return {
    sessionCount: sessions.length,
    shotCount: rows.length,
    overallAvgRating,
    trendDelta,
    buckets,
    strengths,
    weaknesses,
    mostImproved,
    regressing,
  };
}

function RatingBucketRow({ bucket }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: COLORS.cream }}>{bucket.label}y</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>{bucket.count} shots</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: ratingRagColor(bucket.avgRating) }}>
          {bucket.avgRating.toFixed(1)}/5
        </div>
        {bucket.improvement !== null && bucket.improvement !== undefined && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: bucket.improvement > 0 ? COLORS.fairwayLight : COLORS.flag,
            }}
          >
            {bucket.improvement > 0 ? "▲" : "▼"} {Math.abs(bucket.improvement).toFixed(1)}
          </div>
        )}
      </div>
    </div>
  );
}

function RatingInsightCard({ title, subtitle, items, emptyText }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, padding: "6px 0" }}>
            {emptyText}
          </div>
        ) : (
          items.map((b, i) => (
            <div key={b.label} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <RatingBucketRow bucket={b} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ===== Post-session feedback ("that was your 2nd best session ever") =====
// Ranks the just-finished session against comparable past sessions on a single metric, and
// turns that ranking into a short, honest headline. Ties (equal metric values) are ranked by
// whichever comes first in the array, which is fine here since exact ties are rare with
// floating-point SG/rating averages.
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function rankSession(currentId, sessions, metricFn) {
  const withMetrics = sessions
    .map((s) => ({ id: s.id, metric: metricFn(s) }))
    .filter((s) => typeof s.metric === "number" && !isNaN(s.metric));
  if (withMetrics.length === 0) return null;

  withMetrics.sort((a, b) => b.metric - a.metric); // descending — higher metric is better throughout this app
  const rank = withMetrics.findIndex((s) => s.id === currentId) + 1;
  if (rank === 0) return null; // current session's metric was invalid/filtered out

  const current = withMetrics[rank - 1];
  const others = withMetrics.filter((s) => s.id !== currentId);
  const othersAvg = others.length ? avg(others.map((o) => o.metric)) : null;

  return { rank, total: withMetrics.length, currentMetric: current.metric, othersAvg };
}

// valueFmt formats a raw metric number for display (e.g. formatSG, or `${x.toFixed(1)}/5`).
function buildSessionFeedback(ranking, valueFmt) {
  if (!ranking) return null;
  const { rank, total, currentMetric, othersAvg } = ranking;

  if (total === 1) {
    return {
      headline: "FIRST SESSION LOGGED",
      detail: "This is your baseline — future sessions will be compared against it.",
      tone: "neutral",
    };
  }
  if (rank === 1) {
    return {
      headline: "★ BEST SESSION EVER",
      detail: `Your best of ${total} sessions — ${valueFmt(currentMetric)}.`,
      tone: "great",
    };
  }
  if (rank <= 3) {
    return {
      headline: `★ ${ordinal(rank)} BEST SESSION`,
      detail: `Out of ${total} sessions so far — ${valueFmt(currentMetric)}.`,
      tone: "great",
    };
  }
  if (othersAvg !== null && currentMetric > othersAvg) {
    return {
      headline: "BETTER THAN YOUR AVERAGE",
      detail: `${valueFmt(currentMetric)} vs your average of ${valueFmt(othersAvg)} across ${total - 1} past sessions.`,
      tone: "good",
    };
  }
  if (othersAvg !== null && Math.abs(currentMetric - othersAvg) < 1e-9) {
    return {
      headline: "RIGHT AT YOUR AVERAGE",
      detail: `${valueFmt(currentMetric)}, matching your average across ${total - 1} past sessions.`,
      tone: "neutral",
    };
  }
  return {
    headline: "SESSION LOGGED",
    detail:
      othersAvg !== null
        ? `${valueFmt(currentMetric)} vs your average of ${valueFmt(othersAvg)} — every session still adds data.`
        : "Logged and saved.",
    tone: "below",
  };
}

function SessionFeedbackBanner({ feedback }) {
  if (!feedback) return null;
  const toneColors = {
    great: { border: COLORS.fairwayLight, bg: `${COLORS.fairway}55` },
    good: { border: COLORS.fairwayLight, bg: `${COLORS.fairway}33` },
    neutral: { border: `${COLORS.creamDim}33`, bg: "transparent" },
    below: { border: `${COLORS.creamDim}33`, bg: "transparent" },
  };
  const c = toneColors[feedback.tone] || toneColors.neutral;
  return (
    <Card style={{ marginBottom: 10, border: `1px solid ${c.border}`, background: c.bg }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
        {feedback.headline}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
        {feedback.detail}
      </div>
    </Card>
  );
}

// Sums each player's points across all completed rounds of a Compete session.
function computeCompeteTotals(players, roundResults) {
  const totals = {};
  players.forEach((p) => (totals[p] = 0));
  roundResults.forEach((r) => {
    (r.standings || []).forEach((s) => {
      totals[s.player] = (totals[s.player] || 0) + s.points;
    });
  });
  return totals;
}

// Always PGA Tour baseline, ignoring whatever handicap baseline is currently selected in
// Settings — used specifically for Putting Compete's end-of-game SG summary, per explicit request.
function sgForPuttTourOnly(targetFt, strokes) {
  return pgaBaselinePutts(targetFt) - strokes;
}

// Ranks a round's entries by proximity (ascending = better) and assigns Compete's scaled points:
// with N players, 1st gets (N-1) points, 2nd gets (N-2), ..., last gets 0.
function rankCompeteByProximity(entries, valueKey) {
  const sorted = [...entries].sort((a, b) => a[valueKey] - b[valueKey]);
  const n = sorted.length;
  return sorted.map((e, i) => ({ ...e, rank: i + 1, points: n - 1 - i }));
}

// Sums each player's total putts across all holes of a Putting Compete session (lower is better).
function computePuttCompeteTallies(players, holeResults) {
  const totals = {};
  players.forEach((p) => (totals[p] = 0));
  holeResults.forEach((h) => {
    h.putts.forEach((entry) => {
      totals[entry.player] = (totals[entry.player] || 0) + entry.strokes;
    });
  });
  return totals;
}

export default function GolfPracticeApp({ onSwitchProfile, profileName, profileId, profileHandicap }) {
  const [screen, setScreen] = useState("home"); // home | setup | practice | summary | analysis | shortgame | putting | puttingPractice | puttingSummary
  const [shotCount, setShotCount] = useState(10);
  const [minDist, setMinDist] = useState(50);
  const [maxDist, setMaxDist] = useState(150);
  const [shots, setShots] = useState([]); // {target, actual, diff} or {target, rating}
  const [editingShotIndex, setEditingShotIndex] = useState(null);
  const [currentSessionMode, setCurrentSessionMode] = useState("distance"); // mode locked in when this session started
  const [rangeSessionFeedback, setRangeSessionFeedback] = useState(null);
  const [currentTarget, setCurrentTarget] = useState(null);
  const [actualInput, setActualInput] = useState("");
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [activeSaved, setActiveSaved] = useState(null); // saved in-progress session, if any
  const [analysisSection, setAnalysisSection] = useState("range"); // range | shortgame | putting

  // ===== Compete (Range) state =====
  const [competePlayers, setCompetePlayers] = useState(() => [profileName || "", ""]);
  const [competeRounds, setCompeteRounds] = useState(5);
  const [competeMinDist, setCompeteMinDist] = useState(75);
  const [competeMaxDist, setCompeteMaxDist] = useState(150);
  const [competeMode, setCompeteMode] = useState("distance"); // distance | closest
  const [competeRoundResults, setCompeteRoundResults] = useState([]); // completed rounds this competition
  const [competeCurrentTarget, setCompeteCurrentTarget] = useState(null);
  const [competeCurrentPlayerIdx, setCompeteCurrentPlayerIdx] = useState(0);
  const [competeRoundEntries, setCompeteRoundEntries] = useState([]); // {player, distance} — distance mode only
  const [competeDistanceInput, setCompeteDistanceInput] = useState("");
  const [competeRoundComplete, setCompeteRoundComplete] = useState(false);
  const [competeRoundStandings, setCompeteRoundStandings] = useState([]); // this round's ranked results, for the confirmation screen
  const [competeHistory, setCompeteHistory] = useState([]);
  const [competeLoaded, setCompeteLoaded] = useState(false);
  const [competeEditingIndex, setCompeteEditingIndex] = useState(null); // which past round is being amended, if any

  // ===== Compete (Short Game) state =====
  const [sgCompetePlayers, setSgCompetePlayers] = useState(() => [profileName || "", ""]);
  const [sgCompeteRounds, setSgCompeteRounds] = useState(5);
  const [sgCompeteMinYds, setSgCompeteMinYds] = useState(10);
  const [sgCompeteMaxYds, setSgCompeteMaxYds] = useState(30);
  const [sgCompeteLies, setSgCompeteLies] = useState(["fairway", "rough", "bunker"]);
  const [sgCompeteMode, setSgCompeteMode] = useState("distance"); // distance | closest
  const [sgCompeteRoundResults, setSgCompeteRoundResults] = useState([]);
  const [sgCompeteCurrentShot, setSgCompeteCurrentShot] = useState(null); // {lie, target}
  const [sgCompeteCurrentPlayerIdx, setSgCompeteCurrentPlayerIdx] = useState(0);
  const [sgCompeteResultInput, setSgCompeteResultInput] = useState("");
  const [sgCompeteRoundEntries, setSgCompeteRoundEntries] = useState([]); // {player, resultFt}
  const [sgCompeteRoundComplete, setSgCompeteRoundComplete] = useState(false);
  const [sgCompeteRoundStandings, setSgCompeteRoundStandings] = useState([]);
  const [sgCompeteHistory, setSgCompeteHistory] = useState([]);
  const [sgCompeteLoaded, setSgCompeteLoaded] = useState(false);
  const [sgCompeteEditingIndex, setSgCompeteEditingIndex] = useState(null);

  // ===== Compete (Putting) state — tally of putts taken, no per-hole points =====
  const [puttCompetePlayers, setPuttCompetePlayers] = useState(() => [profileName || "", ""]);
  const [puttCompeteHoles, setPuttCompeteHoles] = useState(9);
  const [puttCompeteMinFt, setPuttCompeteMinFt] = useState(3);
  const [puttCompeteMaxFt, setPuttCompeteMaxFt] = useState(20);
  const [puttCompeteHoleResults, setPuttCompeteHoleResults] = useState([]); // [{target, putts:[{player,strokes}]}]
  const [puttCompeteCurrentTarget, setPuttCompeteCurrentTarget] = useState(null);
  const [puttCompeteCurrentPlayerIdx, setPuttCompeteCurrentPlayerIdx] = useState(0);
  const [puttCompeteHoleEntries, setPuttCompeteHoleEntries] = useState([]); // {player, strokes} — this hole in progress
  const [puttCompeteHoleComplete, setPuttCompeteHoleComplete] = useState(false);
  const [puttCompeteHistory, setPuttCompeteHistory] = useState([]);
  const [puttCompeteLoaded, setPuttCompeteLoaded] = useState(false);
  const [puttCompeteEditingIndex, setPuttCompeteEditingIndex] = useState(null);
  const [baselineHandicap, setBaselineHandicapRaw] = useState("tour");
  const [units, setUnitsRaw] = useState("imperial"); // imperial | metric
  const [rangeTrackingMode, setRangeTrackingModeRaw] = useState(null); // null (unanswered) | distance | rating
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const inputRef = useRef(null);

  // ===== Putting section state =====
  const [puttCount, setPuttCount] = useState(10);
  const [puttMinFt, setPuttMinFt] = useState(3);
  const [puttMaxFt, setPuttMaxFt] = useState(20);
  const [putts, setPutts] = useState([]); // {targetFt, strokes}
  const [puttSessionFeedback, setPuttSessionFeedback] = useState(null);
  const [puttSummaryIsOnCourse, setPuttSummaryIsOnCourse] = useState(false);
  const [puttSummaryChipIns, setPuttSummaryChipIns] = useState(0);
  const [puttCurrentTarget, setPuttCurrentTarget] = useState(null);
  const [puttHistory, setPuttHistory] = useState([]);
  const [puttLoaded, setPuttLoaded] = useState(false);
  const [puttStorageError, setPuttStorageError] = useState(false);
  const [puttActiveSaved, setPuttActiveSaved] = useState(null);

  // ===== On-course putting tracker state =====
  const [onCourseHoles, setOnCourseHoles] = useState(() => Array.from({ length: 18 }, () => ({ putts: [] })));

  // ===== Short Game section state =====
  // ===== Tee Accuracy state =====
  const [teeShotCount, setTeeShotCount] = useState(10);
  const [teeFairwayWidth, setTeeFairwayWidth] = useState(30); // yds — a reasonable "average" estimate, adjustable
  const [teeClubs, setTeeClubs] = useState(["driver", "fairway", "hybrid", "iron"]);
  const [teeShots, setTeeShots] = useState([]); // {club, hit}
  const [teeCurrentClub, setTeeCurrentClub] = useState(null);
  const [teeHistory, setTeeHistory] = useState([]);
  const [teeLoaded, setTeeLoaded] = useState(false);
  const [teeStorageError, setTeeStorageError] = useState(false);

  const [shortShotCount, setShortShotCount] = useState(10);
  const [shortMinYds, setShortMinYds] = useState(10);
  const [shortMaxYds, setShortMaxYds] = useState(30);
  const [shortLies, setShortLies] = useState(["fairway", "rough", "bunker"]);
  const [shortShots, setShortShots] = useState([]); // {lie, target, resultFt}
  const [shortCurrentShot, setShortCurrentShot] = useState(null); // {lie, target}
  const [shortHistory, setShortHistory] = useState([]);
  const [shortLoaded, setShortLoaded] = useState(false);
  const [shortStorageError, setShortStorageError] = useState(false);
  const [shortActiveSaved, setShortActiveSaved] = useState(null);
  const [shortSessionFeedback, setShortSessionFeedback] = useState(null);
  const [shortResultInput, setShortResultInput] = useState("");

  // Single consolidated load — fetches every stored key for this profile in one parallel batch
  // (loadAllAppData), rather than 7 separate effects each doing their own round-trip(s).
  useEffect(() => {
    (async () => {
      const data = await loadAllAppData();

      if (data["golf:sessions"]) {
        try {
          setHistory(JSON.parse(data["golf:sessions"]));
        } catch (e) {
          // corrupt or unexpected data — ignore, start fresh
        }
      }
      if (data["golf:activeSession"]) {
        try {
          setActiveSaved(JSON.parse(data["golf:activeSession"]));
        } catch (e) {}
      }
      setLoaded(true);

      if (data["putting:sessions"]) {
        try {
          setPuttHistory(JSON.parse(data["putting:sessions"]));
        } catch (e) {}
      }
      if (data["putting:activeSession"]) {
        try {
          setPuttActiveSaved(JSON.parse(data["putting:activeSession"]));
        } catch (e) {}
      }
      if (data["putting:activeRound"]) {
        try {
          const parsed = JSON.parse(data["putting:activeRound"]);
          // Guard against stale data saved before the on-course entry format changed to
          // per-putt tracking — old rounds had {distanceFt, strokes} per hole instead of a
          // putts array. Rather than crash on the shape mismatch, just discard it: it's only
          // an in-progress round, nothing in permanent history is at risk.
          const looksCurrent = Array.isArray(parsed) && parsed.every((h) => Array.isArray(h.putts));
          if (looksCurrent) {
            setOnCourseHoles(parsed);
          } else {
            window.storage.delete("putting:activeRound", false).catch(() => {});
          }
        } catch (e) {}
      }
      setPuttLoaded(true);

      if (data["tee:sessions"]) {
        try {
          setTeeHistory(JSON.parse(data["tee:sessions"]));
        } catch (e) {}
      }
      setTeeLoaded(true);

      if (data["shortgame:sessions"]) {
        try {
          setShortHistory(JSON.parse(data["shortgame:sessions"]));
        } catch (e) {}
      }
      if (data["shortgame:activeSession"]) {
        try {
          setShortActiveSaved(JSON.parse(data["shortgame:activeSession"]));
        } catch (e) {}
      }
      setShortLoaded(true);

      if (data["settings:preferences"]) {
        try {
          const prefs = JSON.parse(data["settings:preferences"]);
          if (prefs.baselineHandicap) {
            setBaselineHandicapRaw(prefs.baselineHandicap);
            applyBaseline(prefs.baselineHandicap);
          }
          if (prefs.units) setUnitsRaw(prefs.units);
          if (prefs.rangeTrackingMode) setRangeTrackingModeRaw(prefs.rangeTrackingMode);
        } catch (e) {}
      }
      setSettingsLoaded(true);

      if (data["compete:sessions"]) {
        try {
          setCompeteHistory(JSON.parse(data["compete:sessions"]));
        } catch (e) {}
      }
      setCompeteLoaded(true);

      if (data["compete:shortgame:sessions"]) {
        try {
          setSgCompeteHistory(JSON.parse(data["compete:shortgame:sessions"]));
        } catch (e) {}
      }
      setSgCompeteLoaded(true);

      if (data["compete:putting:sessions"]) {
        try {
          setPuttCompeteHistory(JSON.parse(data["compete:putting:sessions"]));
        } catch (e) {}
      }
      setPuttCompeteLoaded(true);
    })();
  }, []);

  async function persistSettings(next) {
    try {
      await window.storage.set(
        "settings:preferences",
        JSON.stringify({ baselineHandicap, units, rangeTrackingMode, ...next }),
        false
      );
    } catch (e) {
      // non-fatal
    }
  }

  async function updateBaselineHandicap(key) {
    setBaselineHandicapRaw(key);
    applyBaseline(key);
    persistSettings({ baselineHandicap: key });
  }

  async function updateUnits(u) {
    setUnitsRaw(u);
    persistSettings({ units: u });
  }

  async function updateRangeTrackingMode(mode) {
    setRangeTrackingModeRaw(mode);
    persistSettings({ rangeTrackingMode: mode });
  }

  async function persistActiveSession(state) {
    setActiveSaved(state);
    try {
      await window.storage.set("golf:activeSession", JSON.stringify(state), false);
    } catch (e) {
      // non-fatal — practice can continue without cross-session resume
    }
  }

  async function clearActiveSession() {
    try {
      await window.storage.delete("golf:activeSession", false);
    } catch (e) {
      // nothing to clear
    }
    setActiveSaved(null);
  }

  useEffect(() => {
    if (screen === "practice" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [screen, shots.length]);

  function startSession() {
    const target = randomTarget(minDist, maxDist);
    setShots([]);
    setCurrentTarget(target);
    setActualInput("");
    setCurrentSessionMode(rangeTrackingMode);
    setScreen("practice");
    persistActiveSession({ shotCount, minDist, maxDist, shots: [], currentTarget: target, mode: rangeTrackingMode });
  }

  function resumeSession() {
    if (!activeSaved) return;
    setShotCount(activeSaved.shotCount);
    setMinDist(activeSaved.minDist);
    setMaxDist(activeSaved.maxDist);
    setShots(activeSaved.shots);
    setCurrentTarget(activeSaved.currentTarget);
    setActualInput("");
    setCurrentSessionMode(activeSaved.mode || "distance");
    setScreen("practice");
  }

  function discardSavedSession() {
    clearActiveSession();
  }

  function submitShot() {
    const actual = unitToYds(parseFloat(actualInput), units);
    if (isNaN(actual) || actual < 0) return;
    const diff = Math.abs(actual - currentTarget);
    const newShots = [...shots, { target: currentTarget, actual, diff }];
    setShots(newShots);
    setActualInput("");
    // Keep the numeric keypad open for the next shot rather than making the user tap the
    // field again every time — refocus happens synchronously within this same tap/click, which
    // is what lets mobile browsers keep the keyboard up instead of dismissing it.
    if (inputRef.current) inputRef.current.focus();

    if (newShots.length >= shotCount) {
      finishSession(newShots);
    } else {
      const nextTarget = randomTarget(minDist, maxDist);
      setCurrentTarget(nextTarget);
      persistActiveSession({ shotCount, minDist, maxDist, shots: newShots, currentTarget: nextTarget, mode: "distance" });
    }
  }

  function submitRating(rating) {
    const newShots = [...shots, { target: currentTarget, rating }];
    setShots(newShots);

    if (newShots.length >= shotCount) {
      finishSession(newShots);
    } else {
      const nextTarget = randomTarget(minDist, maxDist);
      setCurrentTarget(nextTarget);
      persistActiveSession({ shotCount, minDist, maxDist, shots: newShots, currentTarget: nextTarget, mode: "rating" });
    }
  }

  function saveShotEdit(updatedShot) {
    const newShots = shots.map((s, i) => (i === editingShotIndex ? updatedShot : s));
    setShots(newShots);
    setEditingShotIndex(null);
    persistActiveSession({
      shotCount,
      minDist,
      maxDist,
      shots: newShots,
      currentTarget,
      mode: updatedShot.rating !== undefined ? "rating" : "distance",
    });
  }

  function exitToMenu() {
    // progress is already autosaved after each shot — just leave the screen
    setScreen("setup");
  }

  async function finishSession(finalShots) {
    const isRatingMode = finalShots.length > 0 && finalShots[0].rating !== undefined;
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      mode: isRatingMode ? "rating" : "distance",
      shotCount: finalShots.length,
      minDist,
      maxDist,
      shots: finalShots,
      ...(isRatingMode
        ? { avgRating: avg(finalShots.map((s) => s.rating)) }
        : {
            totalDiff: finalShots.reduce((a, s) => a + s.diff, 0),
            avgDiff: avg(finalShots.map((s) => s.diff)),
          }),
    };
    const newHistory = [session, ...history];
    setHistory(newHistory);

    const comparable = newHistory.filter((s) => (isRatingMode ? s.mode === "rating" : s.mode !== "rating"));
    const metricFn = isRatingMode
      ? (s) => avg(s.shots.map((sh) => sh.rating))
      : (s) => avg(s.shots.map((sh) => sgForApproachShot(sh.target, sh.actual)));
    const valueFmt = isRatingMode ? (v) => `${v.toFixed(1)}/5` : formatSG;
    setRangeSessionFeedback(buildSessionFeedback(rankSession(session.id, comparable, metricFn), valueFmt));

    setScreen("summary");
    try {
      await window.storage.set("golf:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStorageError(true);
    }
    clearActiveSession();
  }

  function resetToSetup() {
    setShots([]);
    setCurrentTarget(null);
    setScreen("setup");
  }

  function goHome() {
    setScreen("home");
  }

  async function deleteRangeSession(id) {
    const newHistory = history.filter((s) => s.id !== id);
    setHistory(newHistory);
    try {
      await window.storage.set("golf:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStorageError(true);
    }
  }

  // TEMP: loads generated sample sessions for testing. Remove this handler when asked.
  async function loadTestSessions() {
    const fake = generateFakeSessions();
    const newHistory = [...fake, ...history];
    setHistory(newHistory);
    try {
      await window.storage.set("golf:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStorageError(true);
    }
  }

  async function clearAllRangeSessions() {
    setHistory([]);
    try {
      await window.storage.set("golf:sessions", JSON.stringify([]), false);
    } catch (e) {
      setStorageError(true);
    }
  }

  // ===== Putting handlers =====
  async function persistActivePutting(state) {
    setPuttActiveSaved(state);
    try {
      await window.storage.set("putting:activeSession", JSON.stringify(state), false);
    } catch (e) {
      // non-fatal
    }
  }

  async function clearActivePutting() {
    try {
      await window.storage.delete("putting:activeSession", false);
    } catch (e) {
      // nothing to clear
    }
    setPuttActiveSaved(null);
  }

  function startPuttingSession() {
    const target = randomTarget(puttMinFt, puttMaxFt);
    setPutts([]);
    setPuttCurrentTarget(target);
    setScreen("puttingPractice");
    persistActivePutting({ puttCount, puttMinFt, puttMaxFt, putts: [], puttCurrentTarget: target });
  }

  function resumePuttingSession() {
    if (!puttActiveSaved) return;
    setPuttCount(puttActiveSaved.puttCount);
    setPuttMinFt(puttActiveSaved.puttMinFt);
    setPuttMaxFt(puttActiveSaved.puttMaxFt);
    setPutts(puttActiveSaved.putts);
    setPuttCurrentTarget(puttActiveSaved.puttCurrentTarget);
    setScreen("puttingPractice");
  }

  function discardSavedPutting() {
    clearActivePutting();
  }

  function submitPutt(strokes) {
    const newPutts = [...putts, { targetFt: puttCurrentTarget, strokes }];
    setPutts(newPutts);

    if (newPutts.length >= puttCount) {
      finishPuttingSession(newPutts);
    } else {
      const nextTarget = randomTarget(puttMinFt, puttMaxFt);
      setPuttCurrentTarget(nextTarget);
      persistActivePutting({ puttCount, puttMinFt, puttMaxFt, putts: newPutts, puttCurrentTarget: nextTarget });
    }
  }

  function exitPuttingToMenu() {
    setScreen("putting");
  }

  async function finishPuttingSession(finalPutts) {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      type: "practice",
      puttCount: finalPutts.length,
      puttMinFt,
      puttMaxFt,
      putts: finalPutts,
      totalStrokes: finalPutts.reduce((a, p) => a + p.strokes, 0),
      avgStrokes: avg(finalPutts.map((p) => p.strokes)),
    };
    const newHistory = [session, ...puttHistory];
    setPuttHistory(newHistory);

    const comparable = newHistory.filter((s) => s.type !== "course");
    const metricFn = (s) => avg(s.putts.map((p) => sgForPutt(p.targetFt, p.strokes)));
    setPuttSessionFeedback(buildSessionFeedback(rankSession(session.id, comparable, metricFn), formatSG));
    setPuttSummaryIsOnCourse(false);

    setScreen("puttingSummary");
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
    clearActivePutting();
  }

  function resetToPuttingSetup() {
    setPutts([]);
    setPuttCurrentTarget(null);
    setScreen("putting");
  }

  // ===== On-course round handlers =====
  async function persistOnCourseHoles(holes) {
    try {
      await window.storage.set("putting:activeRound", JSON.stringify(holes), false);
    } catch (e) {
      // non-fatal
    }
  }

  function updateOnCourseHole(index, field, value) {
    const next = onCourseHoles.map((h, i) => (i === index ? { ...h, [field]: value } : h));
    setOnCourseHoles(next);
    persistOnCourseHoles(next);
  }

  async function clearOnCourseRound() {
    const fresh = Array.from({ length: 18 }, () => ({ putts: [] }));
    setOnCourseHoles(fresh);
    try {
      await window.storage.delete("putting:activeRound", false);
    } catch (e) {
      // nothing to clear
    }
  }

  async function finishOnCourseRound() {
    const completed = onCourseHoles.filter(isHoleComplete);
    if (completed.length === 0) return;
    const puttedHoles = completed.filter((h) => !h.noPutt);
    const chipIns = completed.filter((h) => h.noPutt).length;
    if (puttedHoles.length === 0) return; // every completed hole was a chip-in — nothing to compute putting stats from
    const finalPutts = puttedHoles.map((h) => ({
      targetFt: h.putts[0].distanceFt,
      strokes: h.putts.length,
      holedFromFt: h.putts[h.putts.length - 1].distanceFt,
    }));
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      type: "course",
      puttCount: finalPutts.length,
      puttMinFt: Math.min(...finalPutts.map((p) => p.targetFt)),
      puttMaxFt: Math.max(...finalPutts.map((p) => p.targetFt)),
      putts: finalPutts,
      totalStrokes: finalPutts.reduce((a, p) => a + p.strokes, 0),
      avgStrokes: avg(finalPutts.map((p) => p.strokes)),
      chipIns, // holes chipped in from off the green — tracked separately, not part of putt stats
      holesPlayed: completed.length, // puttedHoles + chipIns, for context
    };
    const newHistory = [session, ...puttHistory];
    setPuttHistory(newHistory);
    setPutts(finalPutts);

    const comparable = newHistory.filter((s) => s.type === "course");
    const metricFn = (s) => avg(s.putts.map((p) => sgForPutt(p.targetFt, p.strokes)));
    setPuttSessionFeedback(buildSessionFeedback(rankSession(session.id, comparable, metricFn), formatSG));
    setPuttSummaryIsOnCourse(true);
    setPuttSummaryChipIns(chipIns);

    setScreen("puttingSummary");
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
    const fresh = Array.from({ length: 18 }, () => ({ putts: [] }));
    setOnCourseHoles(fresh);
    try {
      await window.storage.delete("putting:activeRound", false);
    } catch (e) {
      // nothing to clear
    }
  }

  async function deletePuttingSession(id) {
    const newHistory = puttHistory.filter((s) => s.id !== id);
    setPuttHistory(newHistory);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  // TEMP: loads generated sample putting sessions for testing. Remove this handler when asked.
  async function loadTestPuttingSessions() {
    const fake = generateFakePuttingSessions();
    const newHistory = [...fake, ...puttHistory];
    setPuttHistory(newHistory);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  async function clearAllPuttingPracticeSessions() {
    const kept = puttHistory.filter((s) => s.type === "course");
    setPuttHistory(kept);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(kept), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  // TEMP: loads generated sample on-course rounds for testing. Remove this handler when asked.
  async function loadTestCourseRounds() {
    const fake = generateFakeCourseRounds();
    const newHistory = [...fake, ...puttHistory];
    setPuttHistory(newHistory);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  async function clearAllPuttingCourseSessions() {
    const kept = puttHistory.filter((s) => s.type !== "course");
    setPuttHistory(kept);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(kept), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  // ===== Short Game handlers =====
  function toggleShortLie(lie) {
    setShortLies((prev) => {
      if (prev.includes(lie)) return prev.filter((l) => l !== lie);
      return [...prev, lie];
    });
  }

  function randomShortShot(lies, minYds, maxYds) {
    const lie = lies[Math.floor(Math.random() * lies.length)];
    const target = randomTarget(minYds, maxYds);
    return { lie, target };
  }

  async function persistActiveShortGame(state) {
    setShortActiveSaved(state);
    try {
      await window.storage.set("shortgame:activeSession", JSON.stringify(state), false);
    } catch (e) {
      // non-fatal
    }
  }

  async function clearActiveShortGame() {
    try {
      await window.storage.delete("shortgame:activeSession", false);
    } catch (e) {
      // nothing to clear
    }
    setShortActiveSaved(null);
  }

  function startShortGameSession() {
    const first = randomShortShot(shortLies, shortMinYds, shortMaxYds);
    setShortShots([]);
    setShortCurrentShot(first);
    setShortResultInput("");
    setScreen("shortGamePractice");
    persistActiveShortGame({ shortShotCount, shortMinYds, shortMaxYds, shortLies, shortShots: [], shortCurrentShot: first });
  }

  function resumeShortGameSession() {
    if (!shortActiveSaved) return;
    setShortShotCount(shortActiveSaved.shortShotCount);
    setShortMinYds(shortActiveSaved.shortMinYds);
    setShortMaxYds(shortActiveSaved.shortMaxYds);
    setShortLies(shortActiveSaved.shortLies);
    setShortShots(shortActiveSaved.shortShots);
    setShortCurrentShot(shortActiveSaved.shortCurrentShot);
    setShortResultInput("");
    setScreen("shortGamePractice");
  }

  function discardSavedShortGame() {
    clearActiveShortGame();
  }

  function rerollShortGameShot() {
    const next = randomShortShot(shortLies, shortMinYds, shortMaxYds);
    setShortCurrentShot(next);
    persistActiveShortGame({
      shortShotCount,
      shortMinYds,
      shortMaxYds,
      shortLies,
      shortShots,
      shortCurrentShot: next,
    });
  }

  function submitShortGameShot() {
    const resultFt = unitToFt(parseFloat(shortResultInput), units);
    if (isNaN(resultFt) || resultFt < 0) return;
    const newShots = [...shortShots, { lie: shortCurrentShot.lie, target: shortCurrentShot.target, resultFt }];
    setShortShots(newShots);
    setShortResultInput("");

    if (newShots.length >= shortShotCount) {
      finishShortGameSession(newShots);
    } else {
      const next = randomShortShot(shortLies, shortMinYds, shortMaxYds);
      setShortCurrentShot(next);
      persistActiveShortGame({
        shortShotCount,
        shortMinYds,
        shortMaxYds,
        shortLies,
        shortShots: newShots,
        shortCurrentShot: next,
      });
    }
  }

  function exitShortGameToMenu() {
    setScreen("shortgame");
  }

  async function finishShortGameSession(finalShots) {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      shotCount: finalShots.length,
      minYds: shortMinYds,
      maxYds: shortMaxYds,
      lies: shortLies,
      shots: finalShots,
      avgResultFt: avg(finalShots.map((s) => s.resultFt)),
    };
    const newHistory = [session, ...shortHistory];
    setShortHistory(newHistory);

    const metricFn = (s) => avg(s.shots.map((sh) => sgForShortGameShot(sh.lie, sh.target, sh.resultFt)));
    setShortSessionFeedback(buildSessionFeedback(rankSession(session.id, newHistory, metricFn), formatSG));

    setScreen("shortGameSummary");
    try {
      await window.storage.set("shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setShortStorageError(true);
    }
    clearActiveShortGame();
  }

  function resetToShortGameSetup() {
    setShortShots([]);
    setShortCurrentShot(null);
    setScreen("shortgame");
  }

  async function deleteShortGameSession(id) {
    const newHistory = shortHistory.filter((s) => s.id !== id);
    setShortHistory(newHistory);
    try {
      await window.storage.set("shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setShortStorageError(true);
    }
  }

  // ===== Compete (Range) handlers =====
  function updateCompetePlayerName(idx, name) {
    setCompetePlayers((prev) => prev.map((p, i) => (i === idx ? name : p)));
  }

  function addCompetePlayer() {
    setCompetePlayers((prev) => (prev.length < 4 ? [...prev, ""] : prev));
  }

  function removeCompetePlayer(idx) {
    setCompetePlayers((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));
  }

  // Points per round: with N players, 1st gets (N-1) points, 2nd gets (N-2), ..., last gets 0.
  // Only meaningful in distance mode, where every player's proximity is actually measured.
  function rankCompeteEntries(entries, target) {
    const sorted = [...entries].sort((a, b) => Math.abs(a.distance - target) - Math.abs(b.distance - target));
    const n = sorted.length;
    return sorted.map((e, i) => ({ ...e, diff: Math.abs(e.distance - target), rank: i + 1, points: n - 1 - i }));
  }

  function startCompete() {
    const validPlayers = competePlayers.map((p) => p.trim()).filter(Boolean);
    if (validPlayers.length < 2) return;
    const target = randomTarget(competeMinDist, competeMaxDist);
    setCompetePlayers(validPlayers);
    setCompeteRoundResults([]);
    setCompeteCurrentTarget(target);
    setCompeteCurrentPlayerIdx(0);
    setCompeteRoundEntries([]);
    setCompeteDistanceInput("");
    setCompeteRoundComplete(false);
    setCompeteRoundStandings([]);
    setScreen("competePlay");
  }

  function submitCompeteDistance() {
    const val = unitToYds(parseFloat(competeDistanceInput), units);
    if (isNaN(val) || val < 0) return;
    const player = competePlayers[competeCurrentPlayerIdx];
    const newEntries = [...competeRoundEntries, { player, distance: val }];
    setCompeteRoundEntries(newEntries);
    setCompeteDistanceInput("");

    if (competeCurrentPlayerIdx + 1 < competePlayers.length) {
      setCompeteCurrentPlayerIdx(competeCurrentPlayerIdx + 1);
    } else {
      const standings = rankCompeteEntries(newEntries, competeCurrentTarget);
      setCompeteRoundResults((prev) => [...prev, { target: competeCurrentTarget, entries: newEntries, standings }]);
      setCompeteRoundStandings(standings);
      setCompeteRoundComplete(true);
    }
  }

  function selectClosestPlayer(player) {
    // Closest-only mode: no distances entered, so only a flat 1pt to the tapped player is possible —
    // there's no data to rank 2nd/3rd/4th the way distance mode can.
    const standings = competePlayers.map((p) => ({ player: p, points: p === player ? 1 : 0, rank: p === player ? 1 : null }));
    setCompeteRoundResults((prev) => [...prev, { target: competeCurrentTarget, winner: player, standings }]);
    setCompeteRoundStandings(standings);
    setCompeteRoundComplete(true);
  }

  function nextCompeteRound() {
    if (competeRoundResults.length >= competeRounds) {
      finishCompete();
      return;
    }
    const target = randomTarget(competeMinDist, competeMaxDist);
    setCompeteCurrentTarget(target);
    setCompeteCurrentPlayerIdx(0);
    setCompeteRoundEntries([]);
    setCompeteDistanceInput("");
    setCompeteRoundComplete(false);
    setCompeteRoundStandings([]);
  }

  async function finishCompete() {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      mode: competeMode,
      players: competePlayers,
      minDist: competeMinDist,
      maxDist: competeMaxDist,
      rounds: competeRoundResults,
    };
    const newHistory = [session, ...competeHistory];
    setCompeteHistory(newHistory);
    setScreen("competeSummary");
    try {
      await window.storage.set("compete:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal — summary still shows from local state
    }
  }

  function exitCompeteEarly() {
    finishCompete();
  }

  function resetCompeteToSetup() {
    setScreen("competeSetup");
  }

  async function deleteCompeteSession(id) {
    const newHistory = competeHistory.filter((s) => s.id !== id);
    setCompeteHistory(newHistory);
    try {
      await window.storage.set("compete:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function saveCompeteRoundEdit(updatedRound) {
    setCompeteRoundResults((prev) => prev.map((r, i) => (i === competeEditingIndex ? updatedRound : r)));
    setCompeteEditingIndex(null);
  }

  // ===== Compete (Short Game) handlers =====
  function updateSgCompetePlayerName(idx, name) {
    setSgCompetePlayers((prev) => prev.map((p, i) => (i === idx ? name : p)));
  }
  function addSgCompetePlayer() {
    setSgCompetePlayers((prev) => (prev.length < 4 ? [...prev, ""] : prev));
  }
  function removeSgCompetePlayer(idx) {
    setSgCompetePlayers((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));
  }
  function toggleSgCompeteLie(lie) {
    setSgCompeteLies((prev) => (prev.includes(lie) ? prev.filter((l) => l !== lie) : [...prev, lie]));
  }
  function randomSgCompeteShot() {
    const lie = sgCompeteLies[Math.floor(Math.random() * sgCompeteLies.length)];
    const target = randomTarget(sgCompeteMinYds, sgCompeteMaxYds);
    return { lie, target };
  }

  function startSgCompete() {
    const validPlayers = sgCompetePlayers.map((p) => p.trim()).filter(Boolean);
    if (validPlayers.length < 2) return;
    setSgCompetePlayers(validPlayers);
    setSgCompeteRoundResults([]);
    setSgCompeteCurrentShot(randomSgCompeteShot());
    setSgCompeteCurrentPlayerIdx(0);
    setSgCompeteRoundEntries([]);
    setSgCompeteResultInput("");
    setSgCompeteRoundComplete(false);
    setSgCompeteRoundStandings([]);
    setScreen("competeShortGamePlay");
  }

  function submitSgCompeteDistance() {
    const val = unitToFt(parseFloat(sgCompeteResultInput), units);
    if (isNaN(val) || val < 0) return;
    const player = sgCompetePlayers[sgCompeteCurrentPlayerIdx];
    const newEntries = [...sgCompeteRoundEntries, { player, resultFt: val }];
    setSgCompeteRoundEntries(newEntries);
    setSgCompeteResultInput("");

    if (sgCompeteCurrentPlayerIdx + 1 < sgCompetePlayers.length) {
      setSgCompeteCurrentPlayerIdx(sgCompeteCurrentPlayerIdx + 1);
    } else {
      const standings = rankCompeteByProximity(newEntries, "resultFt");
      setSgCompeteRoundResults((prev) => [...prev, { lie: sgCompeteCurrentShot.lie, target: sgCompeteCurrentShot.target, entries: newEntries, standings }]);
      setSgCompeteRoundStandings(standings);
      setSgCompeteRoundComplete(true);
    }
  }

  function selectSgCompeteClosest(player) {
    const standings = sgCompetePlayers.map((p) => ({ player: p, points: p === player ? 1 : 0, rank: p === player ? 1 : null }));
    setSgCompeteRoundResults((prev) => [...prev, { lie: sgCompeteCurrentShot.lie, target: sgCompeteCurrentShot.target, winner: player, standings }]);
    setSgCompeteRoundStandings(standings);
    setSgCompeteRoundComplete(true);
  }

  function nextSgCompeteRound() {
    if (sgCompeteRoundResults.length >= sgCompeteRounds) {
      finishSgCompete();
      return;
    }
    setSgCompeteCurrentShot(randomSgCompeteShot());
    setSgCompeteCurrentPlayerIdx(0);
    setSgCompeteRoundEntries([]);
    setSgCompeteResultInput("");
    setSgCompeteRoundComplete(false);
    setSgCompeteRoundStandings([]);
  }

  async function finishSgCompete() {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      mode: sgCompeteMode,
      players: sgCompetePlayers,
      minYds: sgCompeteMinYds,
      maxYds: sgCompeteMaxYds,
      lies: sgCompeteLies,
      rounds: sgCompeteRoundResults,
    };
    const newHistory = [session, ...sgCompeteHistory];
    setSgCompeteHistory(newHistory);
    setScreen("competeShortGameSummary");
    try {
      await window.storage.set("compete:shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function exitSgCompeteEarly() {
    finishSgCompete();
  }

  function resetSgCompeteToSetup() {
    setScreen("competeShortGameSetup");
  }

  async function deleteSgCompeteSession(id) {
    const newHistory = sgCompeteHistory.filter((s) => s.id !== id);
    setSgCompeteHistory(newHistory);
    try {
      await window.storage.set("compete:shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function saveSgCompeteRoundEdit(updatedRound) {
    setSgCompeteRoundResults((prev) => prev.map((r, i) => (i === sgCompeteEditingIndex ? updatedRound : r)));
    setSgCompeteEditingIndex(null);
  }

  // ===== Compete (Putting) handlers — tally of putts taken, SG shown only at the end =====
  function updatePuttCompetePlayerName(idx, name) {
    setPuttCompetePlayers((prev) => prev.map((p, i) => (i === idx ? name : p)));
  }
  function addPuttCompetePlayer() {
    setPuttCompetePlayers((prev) => (prev.length < 4 ? [...prev, ""] : prev));
  }
  function removePuttCompetePlayer(idx) {
    setPuttCompetePlayers((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));
  }

  function startPuttCompete() {
    const validPlayers = puttCompetePlayers.map((p) => p.trim()).filter(Boolean);
    if (validPlayers.length < 2) return;
    setPuttCompetePlayers(validPlayers);
    setPuttCompeteHoleResults([]);
    setPuttCompeteCurrentTarget(randomTarget(puttCompeteMinFt, puttCompeteMaxFt));
    setPuttCompeteCurrentPlayerIdx(0);
    setPuttCompeteHoleEntries([]);
    setPuttCompeteHoleComplete(false);
    setScreen("competePuttingPlay");
  }

  function submitPuttCompeteStrokes(n) {
    const player = puttCompetePlayers[puttCompeteCurrentPlayerIdx];
    const newEntries = [...puttCompeteHoleEntries, { player, strokes: n }];
    setPuttCompeteHoleEntries(newEntries);

    if (puttCompeteCurrentPlayerIdx + 1 < puttCompetePlayers.length) {
      setPuttCompeteCurrentPlayerIdx(puttCompeteCurrentPlayerIdx + 1);
    } else {
      setPuttCompeteHoleResults((prev) => [...prev, { target: puttCompeteCurrentTarget, putts: newEntries }]);
      setPuttCompeteHoleComplete(true);
    }
  }

  function nextPuttCompeteHole() {
    if (puttCompeteHoleResults.length >= puttCompeteHoles) {
      finishPuttCompete();
      return;
    }
    setPuttCompeteCurrentTarget(randomTarget(puttCompeteMinFt, puttCompeteMaxFt));
    setPuttCompeteCurrentPlayerIdx(0);
    setPuttCompeteHoleEntries([]);
    setPuttCompeteHoleComplete(false);
  }

  async function finishPuttCompete() {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      players: puttCompetePlayers,
      minFt: puttCompeteMinFt,
      maxFt: puttCompeteMaxFt,
      holes: puttCompeteHoleResults,
    };
    const newHistory = [session, ...puttCompeteHistory];
    setPuttCompeteHistory(newHistory);
    setScreen("competePuttingSummary");
    try {
      await window.storage.set("compete:putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function exitPuttCompeteEarly() {
    finishPuttCompete();
  }

  function resetPuttCompeteToSetup() {
    setScreen("competePuttingSetup");
  }

  async function deletePuttCompeteSession(id) {
    const newHistory = puttCompeteHistory.filter((s) => s.id !== id);
    setPuttCompeteHistory(newHistory);
    try {
      await window.storage.set("compete:putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function savePuttCompeteHoleEdit(updatedHole) {
    setPuttCompeteHoleResults((prev) => prev.map((h, i) => (i === puttCompeteEditingIndex ? updatedHole : h)));
    setPuttCompeteEditingIndex(null);
  }

  // ===== Tee Accuracy handlers =====
  function toggleTeeClub(club) {
    setTeeClubs((prev) => (prev.includes(club) ? prev.filter((c) => c !== club) : [...prev, club]));
  }

  function randomTeeClub() {
    return teeClubs[Math.floor(Math.random() * teeClubs.length)];
  }

  function startTeeSession() {
    setTeeShots([]);
    setTeeCurrentClub(randomTeeClub());
    setScreen("teeAccuracyPractice");
  }

  function submitTeeShot(hit) {
    const newShots = [...teeShots, { club: teeCurrentClub, hit }];
    setTeeShots(newShots);
    if (newShots.length >= teeShotCount) {
      finishTeeSession(newShots);
    } else {
      setTeeCurrentClub(randomTeeClub());
    }
  }

  async function finishTeeSession(finalShots) {
    const hitCount = finalShots.filter((s) => s.hit).length;
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      shotCount: finalShots.length,
      fairwayWidth: teeFairwayWidth,
      clubs: teeClubs,
      shots: finalShots,
      hitCount,
      hitPct: (hitCount / finalShots.length) * 100,
    };
    const newHistory = [session, ...teeHistory];
    setTeeHistory(newHistory);
    setScreen("teeAccuracySummary");
    try {
      await window.storage.set("tee:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setTeeStorageError(true);
    }
  }

  function resetTeeToSetup() {
    setTeeShots([]);
    setTeeCurrentClub(null);
    setScreen("teeaccuracy");
  }

  async function deleteTeeSession(id) {
    const newHistory = teeHistory.filter((s) => s.id !== id);
    setTeeHistory(newHistory);
    try {
      await window.storage.set("tee:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setTeeStorageError(true);
    }
  }

  // TEMP: loads generated sample short game sessions for testing. Remove this handler when asked.
  async function loadTestShortGameSessions() {
    const fake = generateFakeShortGameSessions();
    const newHistory = [...fake, ...shortHistory];
    setShortHistory(newHistory);
    try {
      await window.storage.set("shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setShortStorageError(true);
    }
  }

  async function clearAllShortGameSessions() {
    setShortHistory([]);
    try {
      await window.storage.set("shortgame:sessions", JSON.stringify([]), false);
    } catch (e) {
      setShortStorageError(true);
    }
  }

  // TEMP: loads generated sample tee accuracy sessions for testing. Remove this handler when asked.
  async function loadTestTeeSessions() {
    const fake = generateFakeTeeSessions();
    const newHistory = [...fake, ...teeHistory];
    setTeeHistory(newHistory);
    try {
      await window.storage.set("tee:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setTeeStorageError(true);
    }
  }

  async function clearAllTeeSessions() {
    setTeeHistory([]);
    try {
      await window.storage.set("tee:sessions", JSON.stringify([]), false);
    } catch (e) {
      setTeeStorageError(true);
    }
  }

  // Adds 10 sample sessions to every section in one go, rather than loading each area separately.
  async function loadSampleDataForAllSections() {
    const newRangeHistory = [...generateFakeSessions(10), ...history];
    setHistory(newRangeHistory);

    const newTeeHistory = [...generateFakeTeeSessions(10), ...teeHistory];
    setTeeHistory(newTeeHistory);

    const newShortHistory = [...generateFakeShortGameSessions(10), ...shortHistory];
    setShortHistory(newShortHistory);

    const newPuttHistory = [...generateFakePuttingSessions(10), ...generateFakeCourseRounds(10), ...puttHistory];
    setPuttHistory(newPuttHistory);

    try {
      await Promise.all([
        window.storage.set("golf:sessions", JSON.stringify(newRangeHistory), false),
        window.storage.set("tee:sessions", JSON.stringify(newTeeHistory), false),
        window.storage.set("shortgame:sessions", JSON.stringify(newShortHistory), false),
        window.storage.set("putting:sessions", JSON.stringify(newPuttHistory), false),
      ]);
    } catch (e) {
      // non-fatal — sessions are still shown from local state even if a write failed
    }
  }

  // Wipes every section's session history in one go — the counterpart to the "add 10 to every
  // section" button above.
  async function clearAllSampleDataForAllSections() {
    setHistory([]);
    setTeeHistory([]);
    setShortHistory([]);
    setPuttHistory([]);
    try {
      await Promise.all([
        window.storage.set("golf:sessions", JSON.stringify([]), false),
        window.storage.set("tee:sessions", JSON.stringify([]), false),
        window.storage.set("shortgame:sessions", JSON.stringify([]), false),
        window.storage.set("putting:sessions", JSON.stringify([]), false),
      ]);
    } catch (e) {
      // non-fatal
    }
  }

  const runningTotal = shots.reduce((a, s) => a + s.diff, 0);
  const runningAvg = avg(shots.map((s) => s.diff));
  const puttRunningAvg = avg(putts.map((p) => p.strokes));

  return (
    <div
      style={{
        fontFamily: "'Inter', sans-serif",
        background: `radial-gradient(circle at 20% 0%, ${COLORS.turf} 0%, ${COLORS.turfDark} 60%)`,
        minHeight: "100vh",
        color: COLORS.cream,
        display: "flex",
        justifyContent: "center",
        padding: "16px 16px",
      }}
    >
      <style>{FONT_IMPORT}</style>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <Header
          screen={screen}
          onSettings={() => setScreen("settings")}
          onHome={goHome}
          onBack={() => setScreen(BACK_MAP[screen] || "home")}
          backDestination={BACK_MAP[screen] || "home"}
        />

        {screen === "rangeChoose" && <RangeChooseScreen onNavigate={(s) => setScreen(s)} />}

        {screen === "setup" && settingsLoaded && rangeTrackingMode === null && (
          <RangeOnboardingScreen onAnswer={updateRangeTrackingMode} />
        )}

        {screen === "setup" && (!settingsLoaded || rangeTrackingMode !== null) && (
          <SetupScreen
            shotCount={shotCount}
            setShotCount={setShotCount}
            minDist={minDist}
            maxDist={maxDist}
            setMinDist={setMinDist}
            setMaxDist={setMaxDist}
            onStart={startSession}
            activeSaved={activeSaved}
            onResume={resumeSession}
            onDiscard={discardSavedSession}
            onLoadTestData={loadTestSessions}
            onViewAnalysis={() => {
              setAnalysisSection("range");
              setScreen("analysis");
            }}
            units={units}
          />
        )}

        {screen === "practice" && currentTarget !== null && (
          <PracticeScreen
            shots={shots}
            shotCount={shotCount}
            currentTarget={currentTarget}
            minDist={minDist}
            maxDist={maxDist}
            actualInput={actualInput}
            setActualInput={setActualInput}
            onSubmit={submitShot}
            onSubmitRating={submitRating}
            runningTotal={runningTotal}
            runningAvg={runningAvg}
            inputRef={inputRef}
            onExit={exitToMenu}
            units={units}
            mode={currentSessionMode}
            editingShotIndex={editingShotIndex}
            onStartEditShot={setEditingShotIndex}
            onSaveEditShot={saveShotEdit}
            onCancelEditShot={() => setEditingShotIndex(null)}
          />
        )}

        {screen === "summary" && shots.length > 0 && (
          <SummaryScreen
            shots={shots}
            minDist={minDist}
            maxDist={maxDist}
            onNewSession={resetToSetup}
            storageError={storageError}
            units={units}
            feedback={rangeSessionFeedback}
          />
        )}

        {screen === "home" && <HomeScreen onNavigate={(s) => setScreen(s)} />}

        {screen === "analysis" && (
          <AnalysisScreen
            section={analysisSection}
            onSectionChange={setAnalysisSection}
            rangeHistory={history}
            rangeLoaded={loaded}
            onDeleteRangeSession={deleteRangeSession}
            puttingHistory={puttHistory}
            puttingLoaded={puttLoaded}
            onDeletePuttingSession={deletePuttingSession}
            shortGameHistory={shortHistory}
            shortGameLoaded={shortLoaded}
            onDeleteShortGameSession={deleteShortGameSession}
            teeHistory={teeHistory}
            teeLoaded={teeLoaded}
            onDeleteTeeSession={deleteTeeSession}
            onBack={goHome}
            profileName={profileName}
            profileHandicap={profileHandicap}
            baselineHandicap={baselineHandicap}
            units={units}
          />
        )}

        {screen === "settings" && (
          <SettingsScreen
            baselineHandicap={baselineHandicap}
            onSetBaseline={updateBaselineHandicap}
            units={units}
            onSetUnits={updateUnits}
            rangeTrackingMode={rangeTrackingMode}
            onSetRangeTrackingMode={updateRangeTrackingMode}
            onBack={goHome}
            profileName={profileName}
            onSwitchProfile={onSwitchProfile}
            onExportData={() => exportProfileData(profileId, profileName || "profile")}
            onImportData={async (file) => {
              try {
                const count = await importProfileData(profileId, file);
                alert(`Imported ${count} record(s). Reloading to pick up the restored data…`);
                window.location.reload();
              } catch (e) {
                alert(e.message || "Couldn't import that file.");
              }
            }}
            sampleDataAreas={[
              { key: "range", label: "Range", count: history.length, onClear: clearAllRangeSessions },
              { key: "teeaccuracy", label: "Tee Accuracy", count: teeHistory.length, onClear: clearAllTeeSessions },
              { key: "shortgame", label: "Short Game", count: shortHistory.length, onClear: clearAllShortGameSessions },
              {
                key: "putting",
                label: "Putting — Practice",
                count: puttHistory.filter((s) => s.type !== "course").length,
                onClear: clearAllPuttingPracticeSessions,
              },
              {
                key: "puttingcourse",
                label: "Putting — On Course",
                count: puttHistory.filter((s) => s.type === "course").length,
                onClear: clearAllPuttingCourseSessions,
              },
            ]}
            onLoadAllSampleData={loadSampleDataForAllSections}
            onClearAllSampleData={clearAllSampleDataForAllSections}
          />
        )}

        {screen === "teeaccuracy" && (
          <TeeAccuracySetupScreen
            shotCount={teeShotCount}
            setShotCount={setTeeShotCount}
            fairwayWidth={teeFairwayWidth}
            setFairwayWidth={setTeeFairwayWidth}
            clubs={teeClubs}
            onToggleClub={toggleTeeClub}
            onStart={startTeeSession}
            units={units}
            history={teeHistory}
            loaded={teeLoaded}
            onDeleteSession={deleteTeeSession}
            onViewAnalysis={() => {
              setAnalysisSection("teeaccuracy");
              setScreen("analysis");
            }}
          />
        )}

        {screen === "teeAccuracyPractice" && teeCurrentClub !== null && (
          <TeeAccuracyPracticeScreen
            shots={teeShots}
            shotCount={teeShotCount}
            currentClub={teeCurrentClub}
            fairwayWidth={teeFairwayWidth}
            onSubmit={submitTeeShot}
            onExit={resetTeeToSetup}
            units={units}
          />
        )}

        {screen === "teeAccuracySummary" && teeShots.length > 0 && (
          <TeeAccuracySummaryScreen
            shots={teeShots}
            fairwayWidth={teeFairwayWidth}
            onNewSession={resetTeeToSetup}
            storageError={teeStorageError}
            units={units}
          />
        )}

        {screen === "competeChoose" && <CompeteChooseScreen onNavigate={(s) => setScreen(s)} />}

        {screen === "competeSetup" && (
          <CompeteSetupScreen
            players={competePlayers}
            onUpdatePlayerName={updateCompetePlayerName}
            onAddPlayer={addCompetePlayer}
            onRemovePlayer={removeCompetePlayer}
            rounds={competeRounds}
            setRounds={setCompeteRounds}
            minDist={competeMinDist}
            maxDist={competeMaxDist}
            setMinDist={setCompeteMinDist}
            setMaxDist={setCompeteMaxDist}
            mode={competeMode}
            setMode={setCompeteMode}
            onStart={startCompete}
            units={units}
            history={competeHistory}
            loaded={competeLoaded}
            onDeleteSession={deleteCompeteSession}
          />
        )}

        {screen === "competePlay" && competeCurrentTarget !== null && (
          <CompetePlayScreen
            players={competePlayers}
            roundResults={competeRoundResults}
            totalRounds={competeRounds}
            target={competeCurrentTarget}
            mode={competeMode}
            currentPlayerIdx={competeCurrentPlayerIdx}
            distanceInput={competeDistanceInput}
            setDistanceInput={setCompeteDistanceInput}
            onSubmitDistance={submitCompeteDistance}
            onSelectClosest={selectClosestPlayer}
            roundComplete={competeRoundComplete}
            roundStandings={competeRoundStandings}
            onNextRound={nextCompeteRound}
            onExitEarly={exitCompeteEarly}
            units={units}
            editingIndex={competeEditingIndex}
            onStartEdit={setCompeteEditingIndex}
            onSaveEdit={saveCompeteRoundEdit}
            onCancelEdit={() => setCompeteEditingIndex(null)}
          />
        )}

        {screen === "competeSummary" && competeRoundResults.length > 0 && (
          <CompeteSummaryScreen
            players={competePlayers}
            mode={competeMode}
            roundResults={competeRoundResults}
            minDist={competeMinDist}
            maxDist={competeMaxDist}
            units={units}
            onNewCompetition={resetCompeteToSetup}
          />
        )}

        {screen === "competeShortGameSetup" && (
          <ShortGameCompeteSetupScreen
            players={sgCompetePlayers}
            onUpdatePlayerName={updateSgCompetePlayerName}
            onAddPlayer={addSgCompetePlayer}
            onRemovePlayer={removeSgCompetePlayer}
            rounds={sgCompeteRounds}
            setRounds={setSgCompeteRounds}
            minYds={sgCompeteMinYds}
            maxYds={sgCompeteMaxYds}
            setMinYds={setSgCompeteMinYds}
            setMaxYds={setSgCompeteMaxYds}
            lies={sgCompeteLies}
            onToggleLie={toggleSgCompeteLie}
            mode={sgCompeteMode}
            setMode={setSgCompeteMode}
            onStart={startSgCompete}
            units={units}
            history={sgCompeteHistory}
            loaded={sgCompeteLoaded}
            onDeleteSession={deleteSgCompeteSession}
          />
        )}

        {screen === "competeShortGamePlay" && sgCompeteCurrentShot !== null && (
          <ShortGameCompetePlayScreen
            players={sgCompetePlayers}
            roundResults={sgCompeteRoundResults}
            totalRounds={sgCompeteRounds}
            currentShot={sgCompeteCurrentShot}
            mode={sgCompeteMode}
            currentPlayerIdx={sgCompeteCurrentPlayerIdx}
            resultInput={sgCompeteResultInput}
            setResultInput={setSgCompeteResultInput}
            onSubmitDistance={submitSgCompeteDistance}
            onSelectClosest={selectSgCompeteClosest}
            roundComplete={sgCompeteRoundComplete}
            roundStandings={sgCompeteRoundStandings}
            onNextRound={nextSgCompeteRound}
            onExitEarly={exitSgCompeteEarly}
            units={units}
            editingIndex={sgCompeteEditingIndex}
            onStartEdit={setSgCompeteEditingIndex}
            onSaveEdit={saveSgCompeteRoundEdit}
            onCancelEdit={() => setSgCompeteEditingIndex(null)}
          />
        )}

        {screen === "competeShortGameSummary" && sgCompeteRoundResults.length > 0 && (
          <ShortGameCompeteSummaryScreen
            players={sgCompetePlayers}
            mode={sgCompeteMode}
            roundResults={sgCompeteRoundResults}
            units={units}
            onNewCompetition={resetSgCompeteToSetup}
          />
        )}

        {screen === "competePuttingSetup" && (
          <PuttingCompeteSetupScreen
            players={puttCompetePlayers}
            onUpdatePlayerName={updatePuttCompetePlayerName}
            onAddPlayer={addPuttCompetePlayer}
            onRemovePlayer={removePuttCompetePlayer}
            holes={puttCompeteHoles}
            setHoles={setPuttCompeteHoles}
            minFt={puttCompeteMinFt}
            maxFt={puttCompeteMaxFt}
            setMinFt={setPuttCompeteMinFt}
            setMaxFt={setPuttCompeteMaxFt}
            onStart={startPuttCompete}
            units={units}
            history={puttCompeteHistory}
            loaded={puttCompeteLoaded}
            onDeleteSession={deletePuttCompeteSession}
          />
        )}

        {screen === "competePuttingPlay" && puttCompeteCurrentTarget !== null && (
          <PuttingCompetePlayScreen
            players={puttCompetePlayers}
            holeResults={puttCompeteHoleResults}
            totalHoles={puttCompeteHoles}
            target={puttCompeteCurrentTarget}
            currentPlayerIdx={puttCompeteCurrentPlayerIdx}
            holeComplete={puttCompeteHoleComplete}
            onSubmitStrokes={submitPuttCompeteStrokes}
            onNextHole={nextPuttCompeteHole}
            onExitEarly={exitPuttCompeteEarly}
            units={units}
            editingIndex={puttCompeteEditingIndex}
            onStartEdit={setPuttCompeteEditingIndex}
            onSaveEdit={savePuttCompeteHoleEdit}
            onCancelEdit={() => setPuttCompeteEditingIndex(null)}
          />
        )}

        {screen === "competePuttingSummary" && puttCompeteHoleResults.length > 0 && (
          <PuttingCompeteSummaryScreen
            players={puttCompetePlayers}
            holeResults={puttCompeteHoleResults}
            units={units}
            onNewCompetition={resetPuttCompeteToSetup}
          />
        )}

        {screen === "shortgame" && (
          <ShortGameSetupScreen
            shortShotCount={shortShotCount}
            setShortShotCount={setShortShotCount}
            shortMinYds={shortMinYds}
            shortMaxYds={shortMaxYds}
            setShortMinYds={setShortMinYds}
            setShortMaxYds={setShortMaxYds}
            shortLies={shortLies}
            onToggleLie={toggleShortLie}
            onStart={startShortGameSession}
            activeSaved={shortActiveSaved}
            onResume={resumeShortGameSession}
            onDiscard={discardSavedShortGame}
            onViewAnalysis={() => {
              setAnalysisSection("shortgame");
              setScreen("analysis");
            }}
            onLoadTestData={loadTestShortGameSessions}
            units={units}
          />
        )}

        {screen === "shortGamePractice" && shortCurrentShot !== null && (
          <ShortGamePracticeScreen
            shots={shortShots}
            shotCount={shortShotCount}
            currentShot={shortCurrentShot}
            resultInput={shortResultInput}
            setResultInput={setShortResultInput}
            onSubmit={submitShortGameShot}
            onReroll={rerollShortGameShot}
            onExit={exitShortGameToMenu}
            units={units}
          />
        )}

        {screen === "shortGameSummary" && shortShots.length > 0 && (
          <ShortGameSummaryScreen
            shots={shortShots}
            onNewSession={resetToShortGameSetup}
            storageError={shortStorageError}
            units={units}
            feedback={shortSessionFeedback}
          />
        )}

        {screen === "putting" && (
          <PuttingSetupScreen
            puttCount={puttCount}
            setPuttCount={setPuttCount}
            puttMinFt={puttMinFt}
            puttMaxFt={puttMaxFt}
            setPuttMinFt={setPuttMinFt}
            setPuttMaxFt={setPuttMaxFt}
            onStart={startPuttingSession}
            activeSaved={puttActiveSaved}
            onResume={resumePuttingSession}
            onDiscard={discardSavedPutting}
            onViewAnalysis={() => {
              setAnalysisSection("putting");
              setScreen("analysis");
            }}
            onLoadTestData={loadTestPuttingSessions}
            onCourseHoles={onCourseHoles}
            onUpdateCourseHole={updateOnCourseHole}
            onFinishOnCourse={finishOnCourseRound}
            onClearOnCourse={clearOnCourseRound}
            onLoadTestCourseData={loadTestCourseRounds}
            units={units}
          />
        )}

        {screen === "puttingPractice" && puttCurrentTarget !== null && (
          <PuttingPracticeScreen
            putts={putts}
            puttCount={puttCount}
            currentTarget={puttCurrentTarget}
            puttMinFt={puttMinFt}
            puttMaxFt={puttMaxFt}
            onSubmit={submitPutt}
            runningAvg={puttRunningAvg}
            onExit={exitPuttingToMenu}
            units={units}
          />
        )}

        {screen === "puttingSummary" && putts.length > 0 && (
          <PuttingSummaryScreen
            putts={putts}
            onNewSession={resetToPuttingSetup}
            storageError={puttStorageError}
            units={units}
            feedback={puttSessionFeedback}
            isOnCourse={puttSummaryIsOnCourse}
            chipIns={puttSummaryChipIns}
          />
        )}
      </div>
    </div>
  );
}

function Header({ screen, onSettings, onHome, onBack, backDestination }) {
  return (
    <div
      className="no-print"
      style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, gap: 8 }}
    >
      <div
        onClick={onHome}
        style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 19,
          letterSpacing: 0.5,
          lineHeight: 1,
          cursor: "pointer",
          color: COLORS.cream,
        }}
      >
        THE PRACTICE APP
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {screen !== "home" && backDestination !== "home" && (
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: `1px solid ${COLORS.creamDim}55`,
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: "4px 7px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            BACK
          </button>
        )}
        {screen !== "home" && (
          <button
            onClick={onHome}
            style={{
              background: "none",
              border: `1px solid ${COLORS.creamDim}55`,
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: "4px 7px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            HOME
          </button>
        )}
        {screen === "home" && (
          <button
            onClick={onSettings}
            style={{
              background: "none",
              border: `1px solid ${COLORS.creamDim}55`,
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: "4px 7px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            SETTINGS
          </button>
        )}
      </div>
    </div>
  );
}

function PillOption({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 0",
        borderRadius: 10,
        border: active ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
        background: active ? COLORS.fairway : "transparent",
        color: active ? COLORS.cream : COLORS.creamDim,
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 18,
        letterSpacing: 1,
        cursor: "pointer",
        transition: "all 120ms ease",
      }}
    >
      {label}
    </button>
  );
}

function RangeOnboardingScreen({ onAnswer }) {
  const [step, setStep] = useState("device"); // device | method

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>THE RANGE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          One quick question before you start
        </div>
      </div>

      {step === "device" ? (
        <Card>
          <SectionLabel>Setup</SectionLabel>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
            Do you have access to a launch monitor or distance measuring device?
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              onClick={() => onAnswer("distance")}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: COLORS.flag,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              YES
            </button>
            <button
              onClick={() => setStep("method")}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              NO
            </button>
          </div>
        </Card>
      ) : (
        <Card>
          <SectionLabel>No device? No problem</SectionLabel>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
            Would you still like to enter a distance for each shot (paced off or estimated), or rate
            your own strike out of 5 instead?
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            <button
              onClick={() => onAnswer("distance")}
              style={{
                padding: "12px 0",
                borderRadius: 10,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              ENTER A DISTANCE
            </button>
            <button
              onClick={() => onAnswer("rating")}
              style={{
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: COLORS.flag,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              RATE EACH SHOT OUT OF 5
            </button>
          </div>
          <div
            onClick={() => setStep("device")}
            style={{
              textAlign: "center",
              marginTop: 12,
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            BACK
          </div>
        </Card>
      )}

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 12, lineHeight: 1.5 }}>
        You can change this later in Settings.
      </div>
    </div>
  );
}

function SetupScreen({
  shotCount,
  setShotCount,
  minDist,
  maxDist,
  setMinDist,
  setMaxDist,
  onStart,
  activeSaved,
  onResume,
  onDiscard,
  onLoadTestData,
  onViewAnalysis,
  units,
}) {
  const invalidRange = minDist >= maxDist || minDist < 0;
  const unitLabel = longUnitLabel(units);
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>THE RANGE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Distance control practice
        </div>
      </div>

      {activeSaved && (
        <Card style={{ marginBottom: 10, border: `1px solid ${COLORS.sand}66` }}>
          <SectionLabel>Session in progress</SectionLabel>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, marginTop: 3 }}>
            Shot {activeSaved.shots.length + 1} of {activeSaved.shotCount}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
            {ydsToUnitRound(activeSaved.minDist, units)}-{ydsToUnitRound(activeSaved.maxDist, units)}
            {unitLabel} window
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={onResume}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 8,
                border: "none",
                background: COLORS.sand,
                color: COLORS.turfDark,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              RESUME
            </button>
            <button
              onClick={onDiscard}
              style={{
                padding: "9px 14px",
                borderRadius: 8,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              DISCARD
            </button>
          </div>
        </Card>
      )}

      <Card>
        <SectionLabel>Shots this session</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[10, 20, 50].map((n) => (
            <PillOption key={n} label={n} active={shotCount === n} onClick={() => setShotCount(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Distance window ({unitLabel})</SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField
            label="MIN"
            value={ydsToUnitRound(minDist, units)}
            onChange={(v) => setMinDist(unitToYdsRound(v, units))}
          />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField
            label="MAX"
            value={ydsToUnitRound(maxDist, units)}
            onChange={(v) => setMaxDist(unitToYdsRound(v, units))}
          />
        </div>
        {invalidRange && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Max must be greater than min.
          </div>
        )}
      </Card>

      <button
        onClick={onStart}
        disabled={invalidRange}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: invalidRange ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: invalidRange ? "not-allowed" : "pointer",
        }}
      >
        START SESSION
      </button>

      <div
        onClick={onViewAnalysis}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        View range analysis
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
        {label}
      </div>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
        style={{
          width: "100%",
          background: COLORS.turfDark,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 8,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          padding: "6px 10px",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function DistanceGauge({ min, max, target, actual, unit = "y" }) {
  const targetPct = ((target - min) / (max - min)) * 100;
  const actualPct = actual !== null ? Math.max(0, Math.min(100, ((actual - min) / (max - min)) * 100)) : null;
  return (
    <div style={{ margin: "12px 0 4px" }}>
      <div
        style={{
          position: "relative",
          height: 8,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${COLORS.turfDark}, ${COLORS.fairway}, ${COLORS.turfDark})`,
        }}
      >
        <div
          title="target"
          style={{
            position: "absolute",
            left: `${targetPct}%`,
            top: -10,
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "7px solid transparent",
            borderRight: "7px solid transparent",
            borderTop: `10px solid ${COLORS.flag}`,
          }}
        />
        {actualPct !== null && (
          <div
            title="your shot"
            style={{
              position: "absolute",
              left: `${actualPct}%`,
              top: 2,
              transform: "translateX(-50%)",
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: COLORS.cream,
              boxShadow: `0 0 0 5px ${COLORS.cream}22`,
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

function PracticeScreen({
  shots,
  shotCount,
  currentTarget,
  minDist,
  maxDist,
  actualInput,
  setActualInput,
  onSubmit,
  onSubmitRating,
  runningTotal,
  runningAvg,
  inputRef,
  onExit,
  units,
  mode,
  editingShotIndex,
  onStartEditShot,
  onSaveEditShot,
  onCancelEditShot,
}) {
  const shotNum = shots.length + 1;
  const unitLabel = longUnitLabel(units);
  const isRating = mode === "rating";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          SHOT {shotNum} OF {shotCount}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          SAVE &amp; EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            TARGET
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag }}>
            {ydsToUnitRound(currentTarget, units)}
            <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
          </div>
        </div>

        <DistanceGauge
          min={ydsToUnitRound(minDist, units)}
          max={ydsToUnitRound(maxDist, units)}
          target={ydsToUnitRound(currentTarget, units)}
          actual={null}
          unit={unitLabel}
        />

        {isRating ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>
              RATE THIS SHOT (5 = GREAT)
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => onSubmitRating(n)}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 10,
                    border: `2px solid ${ratingRagColor(n)}`,
                    background: "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 20,
                    cursor: "pointer",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 5 }}>
              YOUR CARRY ({unitLabel.toUpperCase()})
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                type="number"
                inputMode="decimal"
                value={actualInput}
                onChange={(e) => setActualInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSubmit()}
                placeholder="0"
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 24,
                  padding: "7px 12px",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={onSubmit}
                disabled={actualInput === ""}
                style={{
                  padding: "0 18px",
                  borderRadius: 8,
                  border: "none",
                  background: actualInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  letterSpacing: 1,
                  cursor: actualInput === "" ? "not-allowed" : "pointer",
                }}
              >
                LOG
              </button>
            </div>
          </div>
        )}
      </Card>

      {isRating ? (
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox
            label="AVG RATING"
            value={shots.length ? `${avg(shots.map((s) => s.rating)).toFixed(1)}/5` : "—"}
            valueColor={shots.length ? ratingRagColor(avg(shots.map((s) => s.rating))) : COLORS.cream}
          />
          <StatBox label="SHOTS LOGGED" value={shots.length} />
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox
            label="AVG SG / SHOT"
            value={shots.length ? formatSG(avg(shots.map((s) => sgForApproachShot(s.target, s.actual)))) : "—"}
            valueColor={shots.length ? sgRagColor(avg(shots.map((s) => sgForApproachShot(s.target, s.actual)))) : COLORS.cream}
          />
          <StatBox label="AVG MISS" value={`${fmt1(ydsToUnit(runningAvg, units))}${unitLabel}`} />
        </div>
      )}

      {shots.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>This session — tap a shot to amend</SectionLabel>
          <div style={{ marginTop: 4 }}>
            {isRating ? (
              <RatingLog shots={shots} units={units} onEditShot={onStartEditShot} />
            ) : (
              <ShotLog shots={shots} units={units} onEditShot={onStartEditShot} />
            )}
          </div>
        </div>
      )}

      {editingShotIndex !== null && (
        <ShotEditModal
          shot={shots[editingShotIndex]}
          mode={mode}
          units={units}
          onSave={onSaveEditShot}
          onCancel={onCancelEditShot}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, valueColor }) {
  return (
    <div
      style={{
        flex: 1,
        background: `${COLORS.turf}aa`,
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        padding: "9px 12px",
      }}
    >
      <div style={{ fontSize: 9, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: valueColor || COLORS.cream, marginTop: 1 }}>
        {value}
      </div>
    </div>
  );
}

function ShotLog({ shots, units, onEditShot }) {
  const unitLabel = longUnitLabel(units);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ width: 24 }}>#</div>
        <div style={{ flex: 1 }}>TARGET</div>
        <div style={{ flex: 1 }}>ACTUAL</div>
        <div style={{ width: 50, textAlign: "right" }}>MISS</div>
        <div style={{ width: 50, textAlign: "right" }}>SG</div>
      </div>
      <div style={{ maxHeight: 150, overflowY: "auto" }}>
        {shots.map((s, i) => {
          const sg = sgForApproachShot(s.target, s.actual);
          return (
            <div
              key={i}
              onClick={() => onEditShot && onEditShot(i)}
              style={{
                display: "flex",
                padding: "7px 12px",
                borderTop: `1px solid ${COLORS.creamDim}11`,
                color: COLORS.cream,
                cursor: onEditShot ? "pointer" : "default",
              }}
            >
              <div style={{ width: 24, color: COLORS.creamDim }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                {fmt1(ydsToUnit(s.target, units))}
                {unitLabel}
              </div>
              <div style={{ flex: 1 }}>
                {fmt1(ydsToUnit(s.actual, units))}
                {unitLabel}
              </div>
              <div style={{ width: 50, textAlign: "right", color: ragColor(ragStatus(s.diff, s.target)) }}>
                {fmt1(ydsToUnit(s.diff, units))}
                {unitLabel}
              </div>
              <div style={{ width: 50, textAlign: "right", color: sgRagColor(sg) }}>{formatSG(sg)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RatingLog({ shots, units, onEditShot }) {
  const unitLabel = longUnitLabel(units);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ width: 24 }}>#</div>
        <div style={{ flex: 1 }}>TARGET</div>
        <div style={{ width: 60, textAlign: "right" }}>RATING</div>
      </div>
      <div style={{ maxHeight: 150, overflowY: "auto" }}>
        {shots.map((s, i) => (
          <div
            key={i}
            onClick={() => onEditShot && onEditShot(i)}
            style={{
              display: "flex",
              padding: "7px 12px",
              borderTop: `1px solid ${COLORS.creamDim}11`,
              color: COLORS.cream,
              cursor: onEditShot ? "pointer" : "default",
            }}
          >
            <div style={{ width: 24, color: COLORS.creamDim }}>{i + 1}</div>
            <div style={{ flex: 1 }}>
              {ydsToUnitRound(s.target, units)}
              {unitLabel}
            </div>
            <div style={{ width: 60, textAlign: "right", color: ratingRagColor(s.rating) }}>{s.rating}/5</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryScreen({ shots, minDist, maxDist, onNewSession, storageError, units, feedback }) {
  const isRating = shots.length > 0 && shots[0].rating !== undefined;
  const unitLabel = longUnitLabel(units);

  if (isRating) {
    const avgRating = avg(shots.map((s) => s.rating));
    const best = shots.reduce((b, s) => (s.rating > b.rating ? s : b), shots[0]);
    const worst = shots.reduce((w, s) => (s.rating < w.rating ? s : w), shots[0]);

    return (
      <div>
        <SessionFeedbackBanner feedback={feedback} />
        <Card>
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              SESSION COMPLETE — {shots.length} SHOTS · {ydsToUnitRound(minDist, units)}-{ydsToUnitRound(maxDist, units)}
              {unitLabel.toUpperCase()}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <StatBox label="AVG RATING" value={`${avgRating.toFixed(1)}/5`} valueColor={ratingRagColor(avgRating)} />
            <StatBox label="SHOTS LOGGED" value={shots.length} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <StatBox label="BEST SHOT" value={`${best.rating}/5`} valueColor={ratingRagColor(best.rating)} />
            <StatBox label="WORST SHOT" value={`${worst.rating}/5`} valueColor={ratingRagColor(worst.rating)} />
          </div>
        </Card>

        <div style={{ marginTop: 10 }}>
          <SectionLabel>Full log</SectionLabel>
          <div style={{ marginTop: 4 }}>
            <RatingLog shots={shots} units={units} />
          </div>
        </div>

        {storageError && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Couldn't save this session to history — it's still shown above.
          </div>
        )}

        <button
          onClick={onNewSession}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "13px 0",
            borderRadius: 12,
            border: "none",
            background: COLORS.flag,
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 20,
            letterSpacing: 2,
            cursor: "pointer",
          }}
        >
          NEW SESSION
        </button>
      </div>
    );
  }

  const total = shots.reduce((a, s) => a + s.diff, 0);
  const average = avg(shots.map((s) => s.diff));
  const best = shots.reduce((b, s) => (s.diff < b.diff ? s : b), shots[0]);
  const worst = shots.reduce((w, s) => (s.diff > w.diff ? s : w), shots[0]);
  const avgSG = avg(shots.map((s) => sgForApproachShot(s.target, s.actual)));
  const totalSG = shots.reduce((a, s) => a + sgForApproachShot(s.target, s.actual), 0);

  return (
    <div>
      <SessionFeedbackBanner feedback={feedback} />
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            SESSION COMPLETE — {shots.length} SHOTS · {ydsToUnitRound(minDist, units)}-{ydsToUnitRound(maxDist, units)}
            {unitLabel.toUpperCase()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="TOTAL SG" value={formatSG(totalSG)} valueColor={sgRagColor(avgSG)} />
          <StatBox label="AVG SG / SHOT" value={formatSG(avgSG)} valueColor={sgRagColor(avgSG)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="TOTAL MISS" value={`${fmt1(ydsToUnit(total, units))}${unitLabel}`} />
          <StatBox label="AVG MISS" value={`${fmt1(ydsToUnit(average, units))}${unitLabel}`} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox
            label="BEST SHOT"
            value={`${fmt1(ydsToUnit(best.diff, units))}${unitLabel}`}
            valueColor={ragColor(ragStatus(best.diff, best.target))}
          />
          <StatBox
            label="WORST SHOT"
            value={`${fmt1(ydsToUnit(worst.diff, units))}${unitLabel}`}
            valueColor={ragColor(ragStatus(worst.diff, worst.target))}
          />
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Short vs long of the pin</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2, marginBottom: 10 }}>
          Each dot is one shot, colored by its own strokes gained
        </div>
        <ShotDispersionChart
          rows={shots.map((s) => ({ target: s.target, signedMiss: s.actual - s.target, sg: sgForApproachShot(s.target, s.actual), bucket: bucketFor(s.target) }))}
          units={units}
        />
      </Card>

      <div style={{ marginTop: 10 }}>
        <SectionLabel>Full log</SectionLabel>
        <div style={{ marginTop: 4 }}>
          <ShotLog shots={shots} units={units} />
        </div>
      </div>

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this session to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onNewSession}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW SESSION
      </button>
    </div>
  );
}

function TimescalePicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
      {TIMESCALES.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: value === t.key ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: value === t.key ? COLORS.fairway : "transparent",
            color: value === t.key ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function BucketRow({ bucket, showImprovement }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: COLORS.cream }}>{bucket.label}y</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          {bucket.count} shots · avg {bucket.avgMissYds.toFixed(1)}y off
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: sgRagColor(bucket.avgSG) }}>
          {formatSG(bucket.avgSG)}
        </div>
        {showImprovement && bucket.improvement !== null && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: bucket.improvement > 0 ? COLORS.fairwayLight : COLORS.flag,
            }}
          >
            {bucket.improvement > 0 ? "▲" : "▼"} {Math.abs(bucket.improvement).toFixed(2)} SG
          </div>
        )}
      </div>
    </div>
  );
}

// One horizontal strip per distance band: every shot in that band plotted as a dot, positioned
// short (left) or long (right) of the pin at center, each dot colored by that individual shot's
// own strokes gained — so a band that's consistently red on one side reveals a real tendency,
// not just an average that could be hiding a mix of good and bad shots.
function ShotDispersionStrip({ label, rows, units }) {
  const width = 300;
  const height = 60;
  const midX = width / 2;
  const padX = 22;
  const plotCenterY = 26;
  const unitLabel = longUnitLabel(units);

  // Always show at least the 5/10/15y reference lines so the scale is readable even when every
  // shot in this band is tight — only extend further if an actual miss goes beyond 15.
  const dataMax = Math.max(0, ...rows.map((r) => Math.abs(r.signedMiss)));
  const gridMax = Math.max(15, Math.ceil(dataMax / 5) * 5);
  const gridValues = [];
  for (let g = 5; g <= gridMax; g += 5) gridValues.push(g);

  function xFor(signedMiss) {
    return midX + (signedMiss / gridMax) * (midX - padX);
  }
  // Small deterministic vertical jitter so overlapping dots at similar misses are still visible.
  function yFor(i) {
    return plotCenterY + (((i * 37) % 13) - 6);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
        {label}
        {unitLabel} · {rows.length} shot{rows.length === 1 ? "" : "s"}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height, marginTop: 4, display: "block" }}>
        <line x1={padX} y1={plotCenterY} x2={width - padX} y2={plotCenterY} stroke={COLORS.creamDim} strokeOpacity={0.25} strokeWidth={1} />
        {gridValues.map((g) => (
          <g key={g}>
            <line x1={xFor(-g)} y1={8} x2={xFor(-g)} y2={44} stroke={COLORS.creamDim} strokeOpacity={0.2} strokeWidth={1} strokeDasharray="2 2" />
            <line x1={xFor(g)} y1={8} x2={xFor(g)} y2={44} stroke={COLORS.creamDim} strokeOpacity={0.2} strokeWidth={1} strokeDasharray="2 2" />
            <text x={xFor(-g)} y={54} fontSize={7} fill={COLORS.creamDim} textAnchor="middle" fontFamily="'JetBrains Mono', monospace">
              {ydsToUnitRound(g, units)}
            </text>
            <text x={xFor(g)} y={54} fontSize={7} fill={COLORS.creamDim} textAnchor="middle" fontFamily="'JetBrains Mono', monospace">
              {ydsToUnitRound(g, units)}
            </text>
          </g>
        ))}
        <line x1={midX} y1={6} x2={midX} y2={44} stroke={COLORS.sand} strokeWidth={2} />
        {rows.map((r, i) => (
          <circle key={i} cx={xFor(r.signedMiss)} cy={yFor(i)} r={5} fill={sgRagColor(r.sg)} fillOpacity={0.88} />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 2 }}>
        <span>← SHORT</span>
        <span>PIN</span>
        <span>LONG →</span>
      </div>
    </div>
  );
}

// rows must include {target, signedMiss, sg, bucket} — either flattened session rows (Analysis
// screens) or a single session's raw shots mapped to that shape (post-session Summary screen).
function ShotDispersionChart({ rows, units }) {
  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });
  const bands = Object.entries(byBucket)
    .filter(([, bandRows]) => bandRows.length >= 2)
    .sort((a, b) => bucketSortKey(a[0]) - bucketSortKey(b[0]));

  if (bands.length === 0) {
    return (
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim }}>
        Need at least 2 shots in a single distance band to plot this.
      </div>
    );
  }

  return (
    <div>
      {bands.map(([label, bandRows]) => (
        <ShotDispersionStrip key={label} label={label} rows={bandRows} units={units} />
      ))}
    </div>
  );
}

function InsightCard({ title, subtitle, items, emptyText }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, padding: "6px 0" }}>
            {emptyText}
          </div>
        ) : (
          items.map((b, i) => (
            <div key={b.label} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <BucketRow bucket={b} showImprovement={b.improvement !== undefined} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function YardagePicker({ min, max, onMin, onMax, onPreset, activePresetLabel }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {YARDAGE_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onPreset(p)}
            style={{
              padding: "7px 11px",
              borderRadius: 8,
              border: activePresetLabel === p.label ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: activePresetLabel === p.label ? COLORS.fairway : "transparent",
              color: activePresetLabel === p.label ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <NumberField label="MIN YDS" value={min} onChange={onMin} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 14 }}>—</div>
        <NumberField label="MAX YDS" value={max} onChange={onMax} />
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, suffix }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: COLORS.turfDark,
        border: `1px solid ${COLORS.creamDim}33`,
        borderRadius: 8,
        padding: "8px 10px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        color: COLORS.cream,
      }}
    >
      <div style={{ color: COLORS.creamDim, marginBottom: 2 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i}>
          {p.value.toFixed(1)}
          {suffix}
        </div>
      ))}
    </div>
  );
}

const ANALYSIS_SECTIONS = [
  { key: "range", label: "RANGE" },
  { key: "teeaccuracy", label: "TEE ACC." },
  { key: "shortgame", label: "SHORT GAME" },
  { key: "putting", label: "PUTTING" },
];

function SettingsScreen({
  baselineHandicap,
  onSetBaseline,
  units,
  onSetUnits,
  rangeTrackingMode,
  onSetRangeTrackingMode,
  onBack,
  profileName,
  onSwitchProfile,
  onExportData,
  onImportData,
  sampleDataAreas,
  onLoadAllSampleData,
  onClearAllSampleData,
}) {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>SETTINGS</div>
      </div>

      <Card>
        <SectionLabel>Baseline</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Strokes gained everywhere in the app is measured against this level. Round-level data
          converted to a flat per-shot offset — a useful approximation, not a precise
          distance-calibrated model like the PGA Tour numbers.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 12 }}>
          {BASELINE_OPTIONS.map((b) => (
            <button
              key={b.key}
              onClick={() => onSetBaseline(b.key)}
              style={{
                padding: "9px 2px",
                borderRadius: 8,
                border: baselineHandicap === b.key ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                background: baselineHandicap === b.key ? COLORS.fairway : "transparent",
                color: baselineHandicap === b.key ? COLORS.cream : COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: 0.3,
                cursor: "pointer",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <SectionLabel>Units</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Distances are always calculated internally in yards/feet, then converted for display —
          switching units won't change past sessions.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => onSetUnits("imperial")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: units === "imperial" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: units === "imperial" ? COLORS.fairway : "transparent",
              color: units === "imperial" ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            IMPERIAL (YD/FT)
          </button>
          <button
            onClick={() => onSetUnits("metric")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: units === "metric" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: units === "metric" ? COLORS.fairway : "transparent",
              color: units === "metric" ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            METRIC (M)
          </button>
        </div>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <SectionLabel>Range tracking</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Without a launch monitor or distance measuring device, exact carry distances aren't
          reliable. Switch to self-rating and score each shot out of 5 instead — strokes gained and
          miss-distance stats won't apply to those sessions, but you'll still see useful trends.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => onSetRangeTrackingMode("distance")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: rangeTrackingMode === "distance" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: rangeTrackingMode === "distance" ? COLORS.fairway : "transparent",
              color: rangeTrackingMode === "distance" ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 14,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            ENTER DISTANCE
          </button>
          <button
            onClick={() => onSetRangeTrackingMode("rating")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: rangeTrackingMode === "rating" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: rangeTrackingMode === "rating" ? COLORS.fairway : "transparent",
              color: rangeTrackingMode === "rating" ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 14,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            RATE OUT OF 5
          </button>
        </div>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <SectionLabel>Profile</SectionLabel>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, marginTop: 6, color: COLORS.cream }}>
          {profileName}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Your data lives only on this device, under this profile. Export a backup before clearing
          browser data or switching devices — there's no cloud copy.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={onExportData}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 13,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            EXPORT DATA
          </button>
          <label
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 13,
              letterSpacing: 0.5,
              cursor: "pointer",
              textAlign: "center",
              display: "block",
            }}
          >
            IMPORT DATA
            <input
              type="file"
              accept="application/json"
              onChange={(e) => e.target.files[0] && onImportData(e.target.files[0])}
              style={{ display: "none" }}
            />
          </label>
        </div>
        <button
          onClick={onSwitchProfile}
          style={{
            width: "100%",
            marginTop: 8,
            padding: "10px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          SWITCH PROFILE
        </button>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <SectionLabel>Sample data</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Load 10 generated sample sessions into every section at once to try out Analysis, or
          clear all of them to start fresh. Applies only to this profile.
        </div>

        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 12 }}>
          {sampleDataAreas.reduce((a, area) => a + area.count, 0)} sample session
          {sampleDataAreas.reduce((a, area) => a + area.count, 0) === 1 ? "" : "s"} across every section
        </div>

        <button
          onClick={onLoadAllSampleData}
          style={{
            width: "100%",
            marginTop: 10,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.sand}66`,
            background: "transparent",
            color: COLORS.sand,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          + ADD 10 SAMPLE SESSIONS TO EVERY SECTION
        </button>

        <button
          onClick={onClearAllSampleData}
          disabled={sampleDataAreas.every((area) => area.count === 0)}
          style={{
            width: "100%",
            marginTop: 8,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${sampleDataAreas.every((area) => area.count === 0) ? COLORS.creamDim + "33" : COLORS.flag}`,
            background: "transparent",
            color: sampleDataAreas.every((area) => area.count === 0) ? COLORS.creamDim : COLORS.flag,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            letterSpacing: 0.5,
            cursor: sampleDataAreas.every((area) => area.count === 0) ? "not-allowed" : "pointer",
          }}
        >
          CLEAR ALL SECTIONS
        </button>
      </Card>

      <button
        onClick={onBack}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: `1px solid ${COLORS.creamDim}33`,
          background: "transparent",
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 18,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        BACK
      </button>
    </div>
  );
}

function CoachSummaryScreen({ profileName, profileHandicap, baselineHandicap, rangeHistory, teeHistory, shortGameHistory, puttingHistory, units }) {
  const [timescale, setTimescale] = useState("all");
  const [printMode, triggerPrint] = usePrintMode();

  const rangeDistanceHistory = rangeHistory.filter((s) => s.mode !== "rating");
  const rangeRatingHistoryAll = rangeHistory.filter((s) => s.mode === "rating");
  const puttingPracticeHistory = puttingHistory.filter((s) => s.type !== "course");
  const puttingCourseHistory = puttingHistory.filter((s) => s.type === "course");

  const filteredRangeDistance = filterByTimescale(rangeDistanceHistory, timescale);
  const filteredRangeRating = filterByTimescale(rangeRatingHistoryAll, timescale);
  const filteredTee = filterByTimescale(teeHistory, timescale);
  const filteredShortGame = filterByTimescale(shortGameHistory, timescale);
  const filteredPuttingPractice = filterByTimescale(puttingPracticeHistory, timescale);
  const filteredPuttingCourse = filterByTimescale(puttingCourseHistory, timescale);

  const rangeAnalysis = computeAnalysis(filteredRangeDistance);
  const rangeRatingAnalysis = computeRangeRatingAnalysis(filteredRangeRating);
  const teeAnalysis = computeTeeAccuracyAnalysis(filteredTee);
  const shortGameAnalysis = computeShortGameAnalysis(filteredShortGame);
  const puttingPracticeAnalysis = computePuttingAnalysis(filteredPuttingPractice);
  const puttingCourseAnalysis = computePuttingAnalysis(filteredPuttingCourse);

  const baselineLabel = BASELINE_OPTIONS.find((b) => b.key === baselineHandicap)?.label || "PGA TOUR";

  function trendMark(delta, threshold) {
    if (Math.abs(delta) < threshold) return { icon: "◆", color: COLORS.creamDim };
    return delta > 0 ? { icon: "▲", color: COLORS.fairwayLight } : { icon: "▼", color: COLORS.flag };
  }

  const glanceRows = [];
  if (rangeAnalysis) {
    const t = trendMark(rangeAnalysis.trendDelta, 0.03);
    glanceRows.push({
      label: "Range — Distance",
      sessions: rangeAnalysis.sessionCount,
      metric: formatSG(rangeAnalysis.overallAvgSG),
      metricColor: sgRagColor(rangeAnalysis.overallAvgSG),
      trend: t,
    });
  }
  if (rangeRatingAnalysis) {
    const t = trendMark(rangeRatingAnalysis.trendDelta, 0.1);
    glanceRows.push({
      label: "Range — Self-Rated",
      sessions: rangeRatingAnalysis.sessionCount,
      metric: `${rangeRatingAnalysis.overallAvgRating.toFixed(1)}/5`,
      metricColor: ratingRagColor(rangeRatingAnalysis.overallAvgRating),
      trend: t,
    });
  }
  if (teeAnalysis) {
    const t = trendMark(teeAnalysis.trendDelta, 1);
    glanceRows.push({
      label: "Tee Accuracy",
      sessions: filteredTee.length,
      metric: `${teeAnalysis.overallHitPct.toFixed(0)}% fairways`,
      metricColor: ratingRagColor(teeAnalysis.overallHitPct / 20),
      trend: t,
    });
  }
  if (shortGameAnalysis) {
    const t = trendMark(shortGameAnalysis.trendDelta, 0.03);
    glanceRows.push({
      label: "Short Game",
      sessions: filteredShortGame.length,
      metric: formatSG(shortGameAnalysis.overallAvgSG),
      metricColor: sgRagColor(shortGameAnalysis.overallAvgSG),
      trend: t,
    });
  }
  if (puttingPracticeAnalysis) {
    const t = trendMark(puttingPracticeAnalysis.trendDelta, 0.03);
    glanceRows.push({
      label: "Putting — Practice",
      sessions: puttingPracticeAnalysis.sessionCount,
      metric: formatSG(puttingPracticeAnalysis.overallAvgSG),
      metricColor: sgRagColor(puttingPracticeAnalysis.overallAvgSG),
      trend: t,
    });
  }
  if (puttingCourseAnalysis) {
    const t = trendMark(puttingCourseAnalysis.trendDelta, 0.03);
    glanceRows.push({
      label: "Putting — On Course",
      sessions: puttingCourseAnalysis.sessionCount,
      metric: formatSG(puttingCourseAnalysis.overallAvgSG),
      metricColor: sgRagColor(puttingCourseAnalysis.overallAvgSG),
      trend: t,
    });
  }

  // One condensed strength + focus line per area that has enough data to say something useful.
  const highlightLines = [];
  if (rangeAnalysis?.strengths.length) {
    const s = rangeAnalysis.strengths[0];
    highlightLines.push({ area: "Range", type: "strength", text: `${s.label}y band (${formatSG(s.avgSG)})` });
  }
  if (rangeAnalysis?.weaknesses.length) {
    const w = rangeAnalysis.weaknesses[0];
    highlightLines.push({ area: "Range", type: "focus", text: `${w.label}y band (${formatSG(w.avgSG)})` });
  }
  if (teeAnalysis?.buckets.filter((b) => b.count >= 3).length) {
    const sorted = [...teeAnalysis.buckets].filter((b) => b.count >= 3).sort((a, b) => b.hitPct - a.hitPct);
    if (sorted.length) highlightLines.push({ area: "Tee Accuracy", type: "strength", text: `${CLUB_LABELS[sorted[0].club]} (${sorted[0].hitPct.toFixed(0)}%)` });
    if (sorted.length > 1) highlightLines.push({ area: "Tee Accuracy", type: "focus", text: `${CLUB_LABELS[sorted[sorted.length - 1].club]} (${sorted[sorted.length - 1].hitPct.toFixed(0)}%)` });
  }
  if (shortGameAnalysis?.strengths.length) {
    const s = shortGameAnalysis.strengths[0];
    highlightLines.push({ area: "Short Game", type: "strength", text: `${LIE_LABELS[s.lie]} (${formatSG(s.avgSG)})` });
  }
  if (shortGameAnalysis?.weaknesses.length) {
    const w = shortGameAnalysis.weaknesses[0];
    highlightLines.push({ area: "Short Game", type: "focus", text: `${LIE_LABELS[w.lie]} (${formatSG(w.avgSG)})` });
  }
  if (puttingPracticeAnalysis?.strengths.length) {
    const s = puttingPracticeAnalysis.strengths[0];
    highlightLines.push({ area: "Putting", type: "strength", text: `${s.label}ft band (${formatSG(s.avgSG)})` });
  }
  if (puttingPracticeAnalysis?.weaknesses.length) {
    const w = puttingPracticeAnalysis.weaknesses[0];
    highlightLines.push({ area: "Putting", type: "focus", text: `${w.label}ft band (${formatSG(w.avgSG)})` });
  }

  const totalSessions = glanceRows.reduce((a, r) => a + r.sessions, 0);
  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: `1px solid ${COLORS.creamDim}15` };

  return (
    <div>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <TimescalePicker value={timescale} onChange={setTimescale} />
      </div>

      <Card style={{ padding: "16px 16px" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1, color: COLORS.cream }}>
          THE PRACTICE APP — PLAYER SUMMARY
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 6, lineHeight: 1.6 }}>
          {profileName || "Player"}
          {profileHandicap !== null && profileHandicap !== undefined ? ` · ${profileHandicap} hcp` : ""} · SG baseline: {baselineLabel}
          <br />
          Generated {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · Period: {TIMESCALES.find((t) => t.key === timescale)?.label || "ALL"} · {totalSessions} total sessions
        </div>
      </Card>

      {!totalSessions ? (
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 14 }}>
          No sessions logged in this period yet across any section. Log a few sessions, then come back here.
        </div>
      ) : (
        <>
          <Card style={{ marginTop: 10 }}>
            <SectionLabel>At a glance</SectionLabel>
            <div style={{ marginTop: 6 }}>
              {glanceRows.map((r) => (
                <div key={r.label} style={rowStyle}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: COLORS.cream }}>
                    {r.label}
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginLeft: 6 }}>
                      {r.sessions} sess.
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: r.metricColor }}>{r.metric}</span>
                    <span style={{ color: r.trend.color, fontSize: 12 }}>{r.trend.icon}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {highlightLines.length > 0 && (
            <Card style={{ marginTop: 10 }}>
              <SectionLabel>Strengths &amp; focus areas</SectionLabel>
              <div style={{ marginTop: 6 }}>
                {highlightLines.map((h, i) => (
                  <div key={i} style={rowStyle}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>{h.area}</div>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12,
                        color: h.type === "strength" ? COLORS.fairwayLight : COLORS.flag,
                        textAlign: "right",
                      }}
                    >
                      {h.type === "strength" ? "★ " : "→ "}
                      {h.text}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 12, lineHeight: 1.5 }}>
            ▲/▼ = trending better/worse across this period · ◆ = steady · Strokes gained figures are
            approximations based on the selected baseline, not precise tour-calibrated numbers for
            every category.
          </div>
        </>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function AnalysisScreen({
  section,
  onSectionChange,
  rangeHistory,
  rangeLoaded,
  onDeleteRangeSession,
  puttingHistory,
  puttingLoaded,
  onDeletePuttingSession,
  shortGameHistory,
  shortGameLoaded,
  onDeleteShortGameSession,
  teeHistory,
  teeLoaded,
  onDeleteTeeSession,
  onBack,
  profileName,
  profileHandicap,
  baselineHandicap,
  units,
}) {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, letterSpacing: 1, lineHeight: 1 }}>ANALYSIS</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, marginTop: 2 }}>
          Track your progress across every session
        </div>
      </div>

      <button
        onClick={() => onSectionChange("coach")}
        className="no-print"
        style={{
          width: "100%",
          marginBottom: 14,
          padding: "12px 0",
          borderRadius: 10,
          border: section === "coach" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.sand}88`,
          background: section === "coach" ? COLORS.fairway : "transparent",
          color: section === "coach" ? COLORS.cream : COLORS.sand,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 16,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        ★ COACH SUMMARY — ONE-PAGE OVERVIEW
      </button>

      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {ANALYSIS_SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => onSectionChange(s.key)}
            style={{
              flex: 1,
              padding: "10px 4px",
              borderRadius: 8,
              border: section === s.key ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: section === s.key ? COLORS.fairway : "transparent",
              color: section === s.key ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "coach" && (
        <CoachSummaryScreen
          profileName={profileName}
          profileHandicap={profileHandicap}
          baselineHandicap={baselineHandicap}
          rangeHistory={rangeHistory}
          teeHistory={teeHistory}
          shortGameHistory={shortGameHistory}
          puttingHistory={puttingHistory}
          units={units}
        />
      )}

      {section === "range" && (
        <RangeAnalysisHub history={rangeHistory} loaded={rangeLoaded} onDeleteSession={onDeleteRangeSession} units={units} />
      )}

      {section === "putting" && (
        <PuttingAnalysisHub history={puttingHistory} loaded={puttingLoaded} onDeleteSession={onDeletePuttingSession} units={units} />
      )}

      {section === "shortgame" && (
        <ShortGameAnalysisBody history={shortGameHistory} loaded={shortGameLoaded} onDeleteSession={onDeleteShortGameSession} />
      )}

      {section === "teeaccuracy" && (
        <TeeAccuracyAnalysisBody history={teeHistory} loaded={teeLoaded} onDeleteSession={onDeleteTeeSession} />
      )}

      <button
        onClick={onBack}
        style={{
          width: "100%",
          marginTop: 18,
          padding: "14px 0",
          borderRadius: 12,
          border: `1px solid ${COLORS.creamDim}33`,
          background: "transparent",
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        BACK
      </button>
    </div>
  );
}

function shortGameSessionTrendData(sessions) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => ({
      date: s.date,
      dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      avgSG: avg(s.shots.map((sh) => sgForShortGameShot(sh.lie, sh.target, sh.resultFt))),
      avgResultFt: avg(s.shots.map((sh) => sh.resultFt)),
      shotCount: s.shots.length,
    }));
}

function computeShortGameAnalysis(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.shots.forEach((sh) => {
        rows.push({
          date: s.date,
          lie: sh.lie,
          target: sh.target,
          resultFt: sh.resultFt,
          sg: sgForShortGameShot(sh.lie, sh.target, sh.resultFt),
        });
      });
    });
  if (rows.length === 0) return null;

  const overallAvgSG = avg(rows.map((r) => r.sg));
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  const trendDelta =
    firstHalf.length && secondHalf.length ? avg(secondHalf.map((r) => r.sg)) - avg(firstHalf.map((r) => r.sg)) : 0;

  const byLie = {};
  rows.forEach((r) => {
    if (!byLie[r.lie]) byLie[r.lie] = [];
    byLie[r.lie].push(r);
  });

  const buckets = Object.entries(byLie).map(([lie, lieRows]) => {
    const bMid = Math.floor(lieRows.length / 2);
    const bFirst = lieRows.slice(0, bMid);
    const bSecond = lieRows.slice(bMid);
    const improvement =
      bFirst.length >= 2 && bSecond.length >= 2 ? avg(bSecond.map((r) => r.sg)) - avg(bFirst.map((r) => r.sg)) : null;
    return {
      lie,
      count: lieRows.length,
      avgSG: avg(lieRows.map((r) => r.sg)),
      avgFt: avg(lieRows.map((r) => r.resultFt)),
      improvement,
    };
  });

  const withEnoughData = buckets.filter((b) => b.count >= 3);
  const strengths = [...withEnoughData].sort((a, b) => b.avgSG - a.avgSG).slice(0, 2);
  const weaknesses = [...withEnoughData].sort((a, b) => a.avgSG - b.avgSG).slice(0, 2);

  const withImprovement = buckets.filter((b) => b.improvement !== null);
  const mostImproved = [...withImprovement].sort((a, b) => b.improvement - a.improvement).filter((b) => b.improvement > 0.05).slice(0, 2);
  const regressing = [...withImprovement].sort((a, b) => a.improvement - b.improvement).filter((b) => b.improvement < -0.05).slice(0, 2);

  return {
    shotCount: rows.length,
    overallAvgSG,
    trendDelta,
    buckets,
    strengths,
    weaknesses,
    mostImproved,
    regressing,
  };
}

function ShortGameBucketRow({ bucket }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.cream }}>{LIE_LABELS[bucket.lie]}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          {bucket.count} shots · avg {bucket.avgFt.toFixed(1)}ft
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: sgRagColor(bucket.avgSG) }}>
          {formatSG(bucket.avgSG)}
        </div>
        {bucket.improvement !== null && bucket.improvement !== undefined && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: bucket.improvement > 0 ? COLORS.fairwayLight : COLORS.flag,
            }}
          >
            {bucket.improvement > 0 ? "▲" : "▼"} {Math.abs(bucket.improvement).toFixed(2)} SG
          </div>
        )}
      </div>
    </div>
  );
}

function ShortGameInsightCard({ title, subtitle, items, emptyText }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, padding: "6px 0" }}>
            {emptyText}
          </div>
        ) : (
          items.map((b, i) => (
            <div key={b.lie} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <ShortGameBucketRow bucket={b} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// Contextualizes a raw yardage number against real-world fairway widths, so the slider means
// something rather than just being an abstract number. Tour fairways average roughly 28-32yd;
// major championship setups get narrowed well below that; recreational courses run wider.
function fairwayWidthDescriptor(yds) {
  if (yds < 20) return { label: "MAJOR CHAMPIONSHIP TIGHT", color: COLORS.flag };
  if (yds < 26) return { label: "TOUR TIGHT", color: COLORS.flag };
  if (yds < 32) return { label: "PGA TOUR AVERAGE", color: COLORS.sand };
  if (yds < 38) return { label: "AVERAGE CLUB COURSE", color: COLORS.sand };
  if (yds < 45) return { label: "GENEROUS", color: COLORS.fairwayLight };
  return { label: "VERY WIDE / FORGIVING", color: COLORS.fairwayLight };
}

function computeTeeAccuracyAnalysis(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.shots.forEach((sh) => {
        rows.push({ date: s.date, club: sh.club, hit: sh.hit });
      });
    });
  if (rows.length === 0) return null;

  const overallHitPct = (rows.filter((r) => r.hit).length / rows.length) * 100;
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  const trendDelta =
    firstHalf.length && secondHalf.length
      ? (secondHalf.filter((r) => r.hit).length / secondHalf.length) * 100 - (firstHalf.filter((r) => r.hit).length / firstHalf.length) * 100
      : 0;

  const byClub = {};
  rows.forEach((r) => {
    if (!byClub[r.club]) byClub[r.club] = [];
    byClub[r.club].push(r);
  });
  const buckets = Object.entries(byClub).map(([club, clubRows]) => ({
    club,
    count: clubRows.length,
    hitPct: (clubRows.filter((r) => r.hit).length / clubRows.length) * 100,
  }));

  return { shotCount: rows.length, overallHitPct, trendDelta, buckets };
}

function teeAccuracySessionTrendData(sessions) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => ({
      date: s.date,
      dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      hitPct: s.hitPct,
      shotCount: s.shotCount,
    }));
}

function TeeAccuracyAnalysisBody({ history, loaded, onDeleteSession }) {
  const [tab, setTab] = useState("insights"); // insights | graphs
  const [printMode, triggerPrint] = usePrintMode();
  const [timescale, setTimescale] = useState("all");

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);

  if (filtered.length === 0) {
    return (
      <div>
        <TimescalePicker value={timescale} onChange={setTimescale} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No Tee Accuracy sessions in this window yet. Log a session to see your analysis here.
        </div>
      </div>
    );
  }

  const analysis = computeTeeAccuracyAnalysis(filtered);
  const trend = teeAccuracySessionTrendData(filtered);

  return (
    <div>
      <PrintHeader title="Tee Accuracy Analysis" timescale={timescale} />
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => setTab("insights")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "insights" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "insights" ? COLORS.fairway : "transparent",
            color: tab === "insights" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          INSIGHTS
        </button>
        <button
          onClick={() => setTab("graphs")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "graphs" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "graphs" ? COLORS.fairway : "transparent",
            color: tab === "graphs" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          GRAPHS
        </button>
      </div>

      <TimescalePicker value={timescale} onChange={setTimescale} />

      {(tab === "insights" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={filtered.length} />
              <StatBox label="SHOTS" value={analysis.shotCount} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox
                label="FAIRWAYS HIT"
                value={`${analysis.overallHitPct.toFixed(0)}%`}
                valueColor={ratingRagColor(analysis.overallHitPct / 20)}
              />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 1 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — hit rate up {analysis.trendDelta.toFixed(0)}pt from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — hit rate down {Math.abs(analysis.trendDelta).toFixed(0)}pt from start to end of period
                </span>
              )}
            </div>
          </Card>

          {analysis.buckets.length > 0 && (
            <Card style={{ marginBottom: 14 }}>
              <SectionLabel>By club</SectionLabel>
              {analysis.buckets.map((c, i) => (
                <div key={c.club} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                    <div>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.cream }}>
                        {CLUB_LABELS[c.club]}
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
                        {c.count} shots
                      </div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: ratingRagColor(c.hitPct / 20) }}>
                      {c.hitPct.toFixed(0)}%
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.map((s) => (
              <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                <Card style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                    {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {"  ·  "}
                    {s.shotCount} shots · {s.clubs.map((c) => CLUB_LABELS[c]).join(", ")}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <StatBox label="FAIRWAYS HIT" value={`${s.hitPct.toFixed(0)}%`} valueColor={ratingRagColor(s.hitPct / 20)} />
                    <StatBox label="HIT / TOTAL" value={`${s.hitCount}/${s.shotCount}`} />
                  </div>
                </Card>
              </SwipeToDelete>
            ))}
          </CollapsibleSection>
        </>
      )}

      {(tab === "graphs" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Fairways hit over time</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
              Hit % per session
            </div>
            <div style={{ height: 200, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                    unit="%"
                  />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Line
                    type="monotone"
                    dataKey="hitPct"
                    stroke={COLORS.flag}
                    strokeWidth={2}
                    dot={{ fill: COLORS.flag, r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {analysis.buckets.length > 0 && (
            <Card>
              <SectionLabel>Fairways hit by club</SectionLabel>
              <div style={{ height: 180, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={analysis.buckets.map((c) => ({ label: CLUB_LABELS[c.club], hitPct: c.hitPct }))}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: COLORS.creamDim, fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: `${COLORS.creamDim}33` }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: `${COLORS.creamDim}33` }}
                      tickLine={false}
                      unit="%"
                    />
                    <Tooltip content={<ChartTooltip suffix="%" />} />
                    <Bar dataKey="hitPct" radius={[4, 4, 0, 0]}>
                      {analysis.buckets.map((c, i) => (
                        <Bar key={i} dataKey="hitPct" fill={ratingRagColor(c.hitPct / 20)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function ShortGameAnalysisBody({ history, loaded, onDeleteSession }) {
  const [tab, setTab] = useState("insights"); // insights | graphs
  const [printMode, triggerPrint] = usePrintMode();
  const [timescale, setTimescale] = useState("all");

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);

  if (filtered.length === 0) {
    return (
      <div>
        <TimescalePicker value={timescale} onChange={setTimescale} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No short game sessions in this window yet. Log a session to see your analysis here.
        </div>
      </div>
    );
  }

  const trend = shortGameSessionTrendData(filtered);
  const allShots = filtered.flatMap((s) => s.shots);
  const overallAvgFt = avg(allShots.map((sh) => sh.resultFt));
  const analysis = computeShortGameAnalysis(filtered);
  const lieStats = analysis ? analysis.buckets : [];

  return (
    <div>
      <PrintHeader title="Short Game Analysis" timescale={timescale} />
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => setTab("insights")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "insights" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "insights" ? COLORS.fairway : "transparent",
            color: tab === "insights" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          INSIGHTS
        </button>
        <button
          onClick={() => setTab("graphs")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "graphs" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "graphs" ? COLORS.fairway : "transparent",
            color: tab === "graphs" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          GRAPHS
        </button>
      </div>

      <TimescalePicker value={timescale} onChange={setTimescale} />

      {(tab === "insights" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              vs PGA Tour baseline · on-green finish assumed
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={filtered.length} />
              <StatBox label="SHOTS" value={allShots.length} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="AVG SG / SHOT" value={formatSG(analysis.overallAvgSG)} valueColor={sgRagColor(analysis.overallAvgSG)} />
              <StatBox label="AVG FT FROM HOLE" value={`${overallAvgFt.toFixed(1)}ft`} />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 0.03 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — SG up {analysis.trendDelta.toFixed(2)} from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — SG down {Math.abs(analysis.trendDelta).toFixed(2)} from start to end of period
                </span>
              )}
            </div>
          </Card>

          <ShortGameInsightCard
            title="Strengths"
            subtitle="Lies where you gain the most strokes on the PGA Tour baseline"
            items={analysis.strengths}
            emptyText="Not enough shots from any single lie yet."
          />

          <ShortGameInsightCard
            title="Focus areas"
            subtitle="Lies where you lose the most strokes to the PGA Tour baseline"
            items={analysis.weaknesses}
            emptyText="Not enough shots from any single lie yet."
          />

          <ShortGameInsightCard
            title="Biggest improvements"
            subtitle="Lies where strokes gained has risen most from earlier to later sessions"
            items={analysis.mostImproved}
            emptyText="Not enough repeat shots from a single lie to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <ShortGameInsightCard
              title="Slipping"
              subtitle="Lies where strokes gained has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}

          {lieStats.length > 0 && (
            <Card style={{ marginBottom: 14 }}>
              <SectionLabel>By lie</SectionLabel>
              {lieStats.map((l, i) => (
                <div key={l.lie} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                    <div>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.cream }}>
                        {LIE_LABELS[l.lie]}
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
                        {l.count} shots · avg {l.avgFt.toFixed(1)}ft
                      </div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: sgRagColor(l.avgSG) }}>
                      {formatSG(l.avgSG)}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.map((s) => {
              const sessionAvgSG = avg(s.shots.map((sh) => sgForShortGameShot(sh.lie, sh.target, sh.resultFt)));
              return (
                <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                  <Card style={{ marginBottom: 12 }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                      {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      {"  ·  "}
                      {s.shotCount} shots · {s.minYds}-{s.maxYds}y · {s.lies.map((l) => LIE_LABELS[l]).join("/")}
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <StatBox label="AVG SG / SHOT" value={formatSG(sessionAvgSG)} valueColor={sgRagColor(sessionAvgSG)} />
                      <StatBox label="AVG FT" value={`${s.avgResultFt.toFixed(1)}ft`} />
                    </div>
                  </Card>
                </SwipeToDelete>
              );
            })}
          </CollapsibleSection>
        </>
      )}

      {(tab === "graphs" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Strokes gained over time</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
              Average SG per shot per session
            </div>
            <div style={{ height: 200, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                  <Tooltip content={<ChartTooltip suffix=" SG" />} />
                  <Line
                    type="monotone"
                    dataKey="avgSG"
                    stroke={COLORS.flag}
                    strokeWidth={2}
                    dot={{ fill: COLORS.flag, r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {lieStats.length > 0 && (
            <Card>
              <SectionLabel>Strokes gained by lie</SectionLabel>
              <div style={{ height: 180, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={lieStats.map((l) => ({ label: LIE_LABELS[l.lie], avgSG: l.avgSG }))}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: `${COLORS.creamDim}33` }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: `${COLORS.creamDim}33` }}
                      tickLine={false}
                    />
                    <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                    <Tooltip content={<ChartTooltip suffix=" SG" />} />
                    <Bar dataKey="avgSG" radius={[4, 4, 0, 0]}>
                      {lieStats.map((l, i) => (
                        <Bar key={i} dataKey="avgSG" fill={sgRagColor(l.avgSG)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function RangeAnalysisHub({ history, loaded, onDeleteSession, units }) {
  const [subTab, setSubTab] = useState("distance"); // distance | rating

  const distanceHistory = history.filter((s) => s.mode !== "rating");
  const ratingHistory = history.filter((s) => s.mode === "rating");

  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setSubTab("distance")}
          style={{
            flex: 1,
            padding: "9px 4px",
            borderRadius: 8,
            border: subTab === "distance" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: subTab === "distance" ? COLORS.fairway : "transparent",
            color: subTab === "distance" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          DISTANCE
        </button>
        <button
          onClick={() => setSubTab("rating")}
          style={{
            flex: 1,
            padding: "9px 4px",
            borderRadius: 8,
            border: subTab === "rating" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: subTab === "rating" ? COLORS.fairway : "transparent",
            color: subTab === "rating" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          SELF-RATED
        </button>
      </div>

      {subTab === "distance" && <RangeAnalysisBody history={distanceHistory} loaded={loaded} onDeleteSession={onDeleteSession} units={units} />}
      {subTab === "rating" && <RangeRatingAnalysisBody history={ratingHistory} loaded={loaded} onDeleteSession={onDeleteSession} />}
    </div>
  );
}

function RangeRatingAnalysisBody({ history, loaded, onDeleteSession }) {
  const [timescale, setTimescale] = useState("all");
  const [printMode, triggerPrint] = usePrintMode();

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);
  const analysis = computeRangeRatingAnalysis(filtered);
  const trend = ratingSessionTrendData(filtered);

  return (
    <div>
      <PrintHeader title="Range Analysis — Self-Rated" timescale={timescale} />
      <TimescalePicker value={timescale} onChange={setTimescale} />

      {!analysis && (
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No self-rated sessions in this window yet. Switch to rating mode in Settings and log a
          session to see your analysis here.
        </div>
      )}

      {analysis && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              Self-rated shots — no distance measurement, so no strokes gained or miss stats
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={analysis.sessionCount} />
              <StatBox label="SHOTS" value={analysis.shotCount} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox
                label="AVG RATING"
                value={`${analysis.overallAvgRating.toFixed(1)}/5`}
                valueColor={ratingRagColor(analysis.overallAvgRating)}
              />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 0.1 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — rating up {analysis.trendDelta.toFixed(1)} from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — rating down {Math.abs(analysis.trendDelta).toFixed(1)} from start to end of period
                </span>
              )}
            </div>
          </Card>

          <RatingInsightCard
            title="Strengths"
            subtitle="Distance bands with your highest average self-rating"
            items={analysis.strengths}
            emptyText="Not enough shots in any single band yet."
          />

          <RatingInsightCard
            title="Focus areas"
            subtitle="Distance bands with your lowest average self-rating"
            items={analysis.weaknesses}
            emptyText="Not enough shots in any single band yet."
          />

          <RatingInsightCard
            title="Biggest improvements"
            subtitle="Bands where your rating has risen most from earlier to later sessions"
            items={analysis.mostImproved}
            emptyText="Not enough repeat shots in a single band to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <RatingInsightCard
              title="Slipping"
              subtitle="Bands where your rating has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}

          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Rating over time</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
              Average self-rating per session
            </div>
            <div style={{ height: 200, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[1, 5]}
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip suffix="/5" />} />
                  <Line
                    type="monotone"
                    dataKey="avgRating"
                    stroke={COLORS.flag}
                    strokeWidth={2}
                    dot={{ fill: COLORS.flag, r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.map((s) => {
              const sessionAvgRating = avg(s.shots.map((sh) => sh.rating));
              return (
                <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                  <Card style={{ marginBottom: 12 }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                      {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      {"  ·  "}
                      {s.shotCount} shots · {s.minDist}-{s.maxDist}y
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <StatBox
                        label="AVG RATING"
                        value={`${sessionAvgRating.toFixed(1)}/5`}
                        valueColor={ratingRagColor(sessionAvgRating)}
                      />
                    </div>
                  </Card>
                </SwipeToDelete>
              );
            })}
          </CollapsibleSection>

          <SendReportButton onClick={triggerPrint} />
        </>
      )}
    </div>
  );
}

function RangeAnalysisBody({ history, loaded, onDeleteSession, units }) {
  const [tab, setTab] = useState("insights"); // insights | graphs
  const [printMode, triggerPrint] = usePrintMode();
  const [timescale, setTimescale] = useState("all");
  const [minYds, setMinYds] = useState(0);
  const [maxYds, setMaxYds] = useState(300);
  const [activePreset, setActivePreset] = useState("All");

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);
  const analysis = computeAnalysis(filtered);
  const trend = sessionTrendData(filtered, minYds, maxYds);
  const graphBuckets = bucketChartData(filtered, minYds, maxYds);
  const hasGraphData = trend.length > 0;

  function handlePreset(p) {
    setActivePreset(p.label);
    setMinYds(p.min);
    setMaxYds(p.max);
  }

  function handleManualChange(setter) {
    return (v) => {
      setActivePreset(null);
      setter(v);
    };
  }

  return (
    <div>
      <PrintHeader title="Range Analysis" timescale={timescale} />
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => setTab("insights")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "insights" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "insights" ? COLORS.fairway : "transparent",
            color: tab === "insights" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          INSIGHTS
        </button>
        <button
          onClick={() => setTab("graphs")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "graphs" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "graphs" ? COLORS.fairway : "transparent",
            color: tab === "graphs" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          GRAPHS
        </button>
      </div>

      <TimescalePicker value={timescale} onChange={setTimescale} />

      {!analysis && (
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No sessions in this window yet. Log a session to see your analysis here.
        </div>
      )}

      {analysis && (tab === "insights" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              vs PGA Tour baseline · fairway lie, on-green finish assumed
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={analysis.sessionCount} />
              <StatBox label="SHOTS" value={analysis.shotCount} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="AVG SG / SHOT" value={formatSG(analysis.overallAvgSG)} valueColor={sgRagColor(analysis.overallAvgSG)} />
              <StatBox label="AVG MISS" value={`${analysis.overallAvgMissYds.toFixed(1)}y`} />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 0.03 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — SG up {analysis.trendDelta.toFixed(2)} from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — SG down {Math.abs(analysis.trendDelta).toFixed(2)} from start to end of period
                </span>
              )}
            </div>
          </Card>

          <InsightCard
            title="Strengths"
            subtitle="Distance bands where you gain the most strokes on the PGA Tour baseline"
            items={analysis.strengths}
            emptyText="Not enough shots in any single band yet."
          />

          <InsightCard
            title="Focus areas"
            subtitle="Distance bands where you lose the most strokes to the PGA Tour baseline"
            items={analysis.weaknesses}
            emptyText="Not enough shots in any single band yet."
          />

          <InsightCard
            title="Biggest improvements"
            subtitle="Bands where strokes gained has risen most from earlier to later sessions"
            items={analysis.mostImproved}
            emptyText="Not enough repeat shots in a single band to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <InsightCard
              title="Slipping"
              subtitle="Bands where strokes gained has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}

          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Short vs long of the pin</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2, marginBottom: 10 }}>
              Each dot is one shot, colored by its own strokes gained
            </div>
            <ShotDispersionChart rows={flattenShots(filtered)} units={units} />
          </Card>

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.length === 0 ? (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim }}>
                No sessions in this window.
              </div>
            ) : (
              filtered.map((s) => {
                const sessionAvgSG = avg(s.shots.map((sh) => sgForApproachShot(sh.target, sh.actual)));
                return (
                  <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                    <Card style={{ marginBottom: 12 }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                        {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        {"  ·  "}
                        {s.shotCount} shots · {s.minDist}-{s.maxDist}y
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                        <StatBox label="AVG SG / SHOT" value={formatSG(sessionAvgSG)} valueColor={sgRagColor(sessionAvgSG)} />
                        <StatBox label="AVG MISS" value={`${s.avgDiff.toFixed(1)}y`} />
                      </div>
                    </Card>
                  </SwipeToDelete>
                );
              })
            )}
          </CollapsibleSection>
        </>
      )}

      {analysis && (tab === "graphs" || printMode) && (
        <div>
          <YardagePicker
            min={minYds}
            max={maxYds}
            onMin={handleManualChange(setMinYds)}
            onMax={handleManualChange(setMaxYds)}
            onPreset={handlePreset}
            activePresetLabel={activePreset}
          />

          {!hasGraphData && (
            <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
              No shots match this timescale + yardage combination yet.
            </div>
          )}

          {hasGraphData && (
            <>
              <Card style={{ marginBottom: 14 }}>
                <SectionLabel>Strokes gained over time</SectionLabel>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
                  Average SG per shot per session, vs PGA Tour baseline, {minYds}-{maxYds}y shots only
                </div>
                <div style={{ height: 200, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                      <Tooltip content={<ChartTooltip suffix=" SG" />} />
                      <Line
                        type="monotone"
                        dataKey="avgSG"
                        stroke={COLORS.flag}
                        strokeWidth={2}
                        dot={{ fill: COLORS.flag, r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <SectionLabel>Strokes gained by distance band</SectionLabel>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
                  25y bands within {minYds}-{maxYds}y, this timescale
                </div>
                <div style={{ height: 220, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={graphBuckets} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                      <Tooltip content={<ChartTooltip suffix=" SG" />} />
                      <Bar dataKey="avgSG" radius={[4, 4, 0, 0]}>
                        {graphBuckets.map((b, i) => (
                          <Bar key={i} dataKey="avgSG" fill={sgRagColor(b.avgSG)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    marginTop: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: COLORS.creamDim,
                  }}
                >
                  <span>
                    <span style={{ color: COLORS.fairwayLight }}>●</span> ≥0 (tour avg or better)
                  </span>
                  <span>
                    <span style={{ color: COLORS.sand }}>●</span> ≥-0.15
                  </span>
                  <span>
                    <span style={{ color: COLORS.flag }}>●</span> &lt;-0.15
                  </span>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div
      style={{
        background: `${COLORS.turf}cc`,
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 14,
        padding: "14px 16px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: COLORS.creamDim,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: 1.5,
      }}
    >
      {children}
    </div>
  );
}

// ===== Home page: section tiles with illustrated backgrounds =====
// These are original vector illustrations standing in for real photos.
// Swap each <svg> below for an <img src="..." /> once real photos are ready —
// wrap it in the same absolutely-positioned, inset:0, cover-fit container.

function RangeIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="rangeSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E4DBC2" />
          <stop offset="100%" stopColor="#4C8A68" />
        </linearGradient>
        <linearGradient id="rangeGround" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="400" height="120" fill="url(#rangeSky)" />
      <rect x="0" y="120" width="400" height="120" fill="url(#rangeGround)" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} x={i * 65 - 40} y="120" width="32" height="120" fill="#ffffff" opacity="0.025" transform="skewX(-10)" />
      ))}
      <line x1="330" y1="150" x2="330" y2="105" stroke="#F1EAD6" strokeWidth="2" opacity="0.7" />
      <polygon points="330,105 350,113 330,121" fill="#C1440E" opacity="0.85" />
      <rect x="194" y="88" width="7" height="95" fill="#F1EAD6" />
      <circle cx="197.5" cy="82" r="24" fill="#F1EAD6" stroke="#14291F" strokeWidth="2" />
      <text x="197.5" y="90" textAnchor="middle" fontFamily="'Bebas Neue', sans-serif" fontSize="22" fill="#14291F">
        100
      </text>
    </svg>
  );
}

function ShortGameIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="sgBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1D3A2B" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#sgBg)" />
      <ellipse cx="315" cy="65" rx="95" ry="42" fill="#4C8A68" opacity="0.55" />
      <ellipse cx="110" cy="195" rx="115" ry="38" fill="#C9A66B" opacity="0.85" />
      <path d="M150,163 Q225,55 315,78" stroke="#F1EAD6" strokeWidth="2" strokeDasharray="4 6" fill="none" opacity="0.6" />
      <polygon points="108,192 148,163 166,177 128,208" fill="#E4DBC2" opacity="0.9" />
      <circle cx="150" cy="163" r="6" fill="#F1EAD6" />
      <line x1="315" y1="78" x2="315" y2="38" stroke="#F1EAD6" strokeWidth="2" opacity="0.8" />
      <polygon points="315,38 332,44 315,50" fill="#C1440E" opacity="0.9" />
    </svg>
  );
}

function PuttingIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="puttBg" cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#4C8A68" />
          <stop offset="100%" stopColor="#1B4332" />
        </radialGradient>
      </defs>
      <rect width="400" height="240" fill="url(#puttBg)" />
      <ellipse cx="210" cy="150" rx="150" ry="55" fill="none" stroke="#F1EAD6" strokeOpacity="0.08" strokeWidth="2" />
      <ellipse cx="210" cy="150" rx="100" ry="36" fill="none" stroke="#F1EAD6" strokeOpacity="0.1" strokeWidth="2" />
      <path d="M150,150 Q188,118 218,146" stroke="#F1EAD6" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="3 5" fill="none" />
      <ellipse cx="222" cy="151" rx="15" ry="7" fill="#0A160F" />
      <circle cx="150" cy="150" r="9" fill="#F1EAD6" />
      <line x1="255" y1="188" x2="305" y2="152" stroke="#F1EAD6" strokeWidth="3" opacity="0.85" />
      <polygon points="305,152 322,158 305,164" fill="#C1440E" opacity="0.9" />
    </svg>
  );
}

function AnalysisIllustration() {
  const points = [
    [30, 190],
    [90, 150],
    [150, 165],
    [210, 110],
    [270, 130],
    [330, 70],
    [380, 50],
  ];
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <rect width="400" height="240" fill="#14291F" />
      {[40, 80, 120, 160, 200].map((y) => (
        <line key={y} x1="20" y1={y} x2="380" y2={y} stroke="#F1EAD6" strokeOpacity="0.06" strokeWidth="1" />
      ))}
      <path d={path} fill="none" stroke="#C1440E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill="#C1440E" />
      ))}
    </svg>
  );
}

function CompeteIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="compBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4C3A1D" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#compBg)" />
      <circle cx="150" cy="120" r="34" fill="none" stroke="#F1EAD6" strokeOpacity="0.7" strokeWidth="3" />
      <circle cx="150" cy="120" r="10" fill="#C1440E" />
      <circle cx="250" cy="90" r="26" fill="none" stroke="#F1EAD6" strokeOpacity="0.45" strokeWidth="3" />
      <circle cx="250" cy="90" r="7" fill="#E4DBC2" />
      <circle cx="290" cy="160" r="20" fill="none" stroke="#F1EAD6" strokeOpacity="0.3" strokeWidth="3" />
      <circle cx="290" cy="160" r="6" fill="#E4DBC2" />
      <path d="M60,205 L340,205" stroke="#F1EAD6" strokeOpacity="0.15" strokeWidth="2" strokeDasharray="4 6" />
    </svg>
  );
}

function TeeAccuracyIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="teeBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#teeBg)" />
      <polygon points="140,240 260,240 220,10 180,10" fill="#4C8A68" opacity="0.55" />
      <polygon points="170,240 230,240 210,60 190,60" fill="#1D3A2B" opacity="0.5" />
      <line x1="200" y1="230" x2="200" y2="30" stroke="#F1EAD6" strokeOpacity="0.3" strokeWidth="2" strokeDasharray="3 6" />
      <circle cx="200" cy="225" r="7" fill="#F1EAD6" />
      <circle cx="185" cy="90" r="5" fill="#C1440E" opacity="0.9" />
      <circle cx="222" cy="55" r="4" fill="#E4DBC2" opacity="0.7" />
      <circle cx="150" cy="150" r="4" fill="#E4DBC2" opacity="0.5" />
    </svg>
  );
}

const TILE_META = [
  {
    key: "range",
    label: "THE RANGE",
    subtitle: "Distance control & tee accuracy",
    screen: "rangeChoose",
    available: true,
    Illustration: RangeIllustration,
  },
  {
    key: "shortgame",
    label: "SHORT GAME",
    subtitle: "Chipping & pitching",
    screen: "shortgame",
    available: true,
    Illustration: ShortGameIllustration,
  },
  { key: "putting", label: "PUTTING", subtitle: "Practice & On-Course", screen: "putting", available: true, Illustration: PuttingIllustration },
  { key: "analysis", label: "ANALYSIS", subtitle: "Track your progress", screen: "analysis", available: true, Illustration: AnalysisIllustration },
];

const COMPETE_TILE = {
  key: "compete",
  label: "COMPETE",
  subtitle: "Head-to-head — Range, Putting, Short Game",
  screen: "competeChoose",
  available: true,
  Illustration: CompeteIllustration,
};

const HOME_INFO = {
  range: {
    title: "THE RANGE",
    short: "Distance Control or Tee Accuracy — full swing practice with Strokes Gained.",
    body: "Two ways to work on your full swing: Distance Control gives you a random target yardage and tracks how close you land to it, feeding real Strokes Gained analysis. Tee Accuracy tests whether you find the fairway off the tee, by club, against a fairway width you set.",
  },
  shortgame: {
    title: "SHORT GAME",
    short: "Chip and pitch from random lies and distances, tracked by lie.",
    body: "Chip and pitch practice from a random lie (fairway, rough, or bunker) and distance within a window you choose. Log how many feet you finish from the hole, and see strokes gained broken down by lie so you know exactly which shot is costing you strokes.",
  },
  putting: {
    title: "PUTTING",
    short: "Practice random distances, or track a full round on the course.",
    body: "Practice mode gives you random distances and logs putts taken, with strokes gained per putt. On-Course mode walks you through an 18-hole round, hole by hole, so your real-round putting gets tracked the same way as practice.",
  },
  analysis: {
    title: "ANALYSIS",
    short: "Every session rolled up — strengths, trends, and full history.",
    body: "Every session you log across every section rolls up here — strengths, focus areas, trends over time, and full session history. Strokes gained is measured against whichever baseline (PGA Tour down to a 30 handicap) you've picked in Settings.",
  },
  compete: {
    title: "COMPETE",
    short: "2-4 players go head-to-head on Range, Putting, or Short Game.",
    body: "Head-to-head challenges for 2-4 players, taking turns each round on Range, Putting, or Short Game. Points scale with player count on Range/Short Game (closest wins the most); Putting tracks a simple tally of total putts, with strokes gained shown at the end.",
  },
};

function HomeInfoButton({ onClick, style, tooltipText }) {
  return (
    <div className="home-info-btn" style={{ position: "absolute", ...style }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: `1.5px solid ${COLORS.cream}`,
          background: `${COLORS.turfDark}e6`,
          color: COLORS.cream,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 700,
          fontSize: 15,
          lineHeight: 1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
        }}
      >
        i
      </button>
      {tooltipText && (
        <div
          className="home-info-tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 200,
            background: COLORS.turf,
            border: `1px solid ${COLORS.creamDim}44`,
            borderRadius: 8,
            padding: 10,
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            lineHeight: 1.5,
            color: COLORS.cream,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            zIndex: 10,
          }}
        >
          {tooltipText}
        </div>
      )}
    </div>
  );
}

function HomeInfoModal({ infoKey, onClose }) {
  if (!infoKey) return null;
  const info = HOME_INFO[infoKey];
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1, color: COLORS.cream }}>
          {info.title}
        </div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: COLORS.cream, marginTop: 10, lineHeight: 1.6 }}>
          {info.body}
        </div>
        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "11px 0",
            borderRadius: 10,
            border: "none",
            background: COLORS.fairway,
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 16,
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          GOT IT
        </button>
      </div>
    </div>
  );
}

// Lets someone correct a past Range/Short Game Compete round after the fact — same underlying
// data shape for both (distance-mode entries + ranked standings, or a flat closest-only winner),
// so one modal covers both modes.
function CompeteRoundEditModal({ round, players, mode, units, valueKind, onSave, onCancel }) {
  const isYds = valueKind === "yds";
  const unitLabel = isYds ? longUnitLabel(units) : shortUnitLabel(units);
  const valueKey = isYds ? "distance" : "resultFt";

  const [values, setValues] = useState(() => {
    const initial = {};
    players.forEach((p) => {
      const entry = (round.entries || []).find((e) => e.player === p);
      const raw = entry ? entry[valueKey] : null;
      initial[p] = raw !== null ? fmt1(isYds ? ydsToUnit(raw, units) : ftToUnit(raw, units)) : "";
    });
    return initial;
  });
  const [winner, setWinner] = useState(round.winner || null);

  function handleSave() {
    if (mode === "distance") {
      const entries = players.map((p) => ({
        player: p,
        [valueKey]: isYds ? unitToYds(parseFloat(values[p]) || 0, units) : unitToFt(parseFloat(values[p]) || 0, units),
      }));
      const standings = rankCompeteByProximity(entries, valueKey);
      onSave({ ...round, entries, standings });
    } else {
      const standings = players.map((p) => ({ player: p, points: p === winner ? 1 : 0, rank: p === winner ? 1 : null }));
      onSave({ ...round, winner, standings });
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT ROUND
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          Target {isYds ? ydsToUnitRound(round.target, units) : ftToUnitRound(round.target, units)}
          {unitLabel}
        </div>

        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "distance"
            ? players.map((p) => (
                <div key={p}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginBottom: 4 }}>
                    {p}
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={values[p]}
                    onChange={(e) => setValues({ ...values, [p]: e.target.value })}
                    style={{
                      width: "100%",
                      background: COLORS.turfDark,
                      border: `1px solid ${COLORS.creamDim}33`,
                      borderRadius: 8,
                      color: COLORS.cream,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 18,
                      padding: "8px 10px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ))
            : players.map((p) => (
                <button
                  key={p}
                  onClick={() => setWinner(p)}
                  style={{
                    padding: "10px 0",
                    borderRadius: 8,
                    border: winner === p ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                    background: winner === p ? COLORS.fairway : "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 16,
                    cursor: "pointer",
                  }}
                >
                  {p}
                </button>
              ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// Same idea for Putting Compete — just putts-taken per player instead of a distance/closest pick.
function PuttingCompeteHoleEditModal({ hole, players, units, onSave, onCancel }) {
  const [putts, setPutts] = useState(() => {
    const initial = {};
    players.forEach((p) => {
      const entry = hole.putts.find((e) => e.player === p);
      initial[p] = entry ? entry.strokes : 2;
    });
    return initial;
  });

  function handleSave() {
    const newPutts = players.map((p) => ({ player: p, strokes: putts[p] }));
    onSave({ ...hole, putts: newPutts });
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT HOLE
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          Distance {ftToUnitRound(hole.target, units)}
          {shortUnitLabel(units)}
        </div>

        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {players.map((p) => (
            <div key={p}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginBottom: 6 }}>
                {p}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPutts({ ...putts, [p]: n })}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      borderRadius: 8,
                      border: putts[p] === n ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                      background: putts[p] === n ? COLORS.fairway : "transparent",
                      color: COLORS.cream,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 16,
                      cursor: "pointer",
                    }}
                  >
                    {n === 4 ? "4+" : n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// Full detail view for a single on-course round, opened by tapping it in "All rounds" — same
// stat layout as the post-round Summary screen, plus the full hole-by-hole log.
function RoundSummaryModal({ session, units, onClose }) {
  const stats = courseRoundStats(session);
  const onePutts = session.putts.filter((p) => p.strokes <= 1).length;
  const onePuttPct = (onePutts / session.putts.length) * 100;
  const threePutts = session.putts.filter((p) => p.strokes >= 3).length;
  const avgStrokes = avg(session.putts.map((p) => p.strokes));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 380,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          ROUND SUMMARY
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          {new Date(session.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} ·{" "}
          {session.putts.length} holes putted
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <StatBox label="TOTAL SG" value={formatSG(stats.totalSG)} valueColor={sgRagColor(stats.avgSG)} />
          <StatBox label="AVG SG / PUTT" value={formatSG(stats.avgSG)} valueColor={sgRagColor(stats.avgSG)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="AVG PUTTS" value={avgStrokes.toFixed(2)} />
          <StatBox label="TOTAL PUTTS" value={stats.totalPutts} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="1-PUTTS" value={`${onePutts} (${onePuttPct.toFixed(0)}%)`} valueColor={COLORS.fairwayLight} />
          <StatBox label="3+ PUTTS" value={threePutts} valueColor={threePutts > 0 ? COLORS.flag : COLORS.cream} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="FT MADE" value={`${fmt1(ftToUnit(stats.ftMade, units))}${shortUnitLabel(units)}`} valueColor={COLORS.sand} />
        </div>
        {session.chipIns > 0 && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
            + {session.chipIns} hole{session.chipIns === 1 ? "" : "s"} chipped in, no putt taken
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <SectionLabel>Hole by hole</SectionLabel>
          <div style={{ marginTop: 6 }}>
            <PuttLog putts={session.putts} units={units} />
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

// Lets someone correct a previous Range practice shot — covers both distance-mode (re-enter the
// actual carry, recompute miss/SG) and rating-mode (re-pick the 1-5 rating).
function ShotEditModal({ shot, mode, units, onSave, onCancel }) {
  const isRating = mode === "rating";
  const unitLabel = longUnitLabel(units);
  const [actualValue, setActualValue] = useState(() => (shot.actual !== undefined ? fmt1(ydsToUnit(shot.actual, units)) : ""));
  const [ratingValue, setRatingValue] = useState(shot.rating || null);

  function handleSave() {
    if (isRating) {
      onSave({ ...shot, rating: ratingValue });
    } else {
      const actual = unitToYds(parseFloat(actualValue) || 0, units);
      const diff = Math.abs(actual - shot.target);
      onSave({ ...shot, actual, diff });
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT SHOT
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          Target {ydsToUnitRound(shot.target, units)}
          {unitLabel}
        </div>

        <div style={{ marginTop: 14 }}>
          {isRating ? (
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRatingValue(n)}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 10,
                    border: ratingValue === n ? `2px solid ${ratingRagColor(n)}` : `1px solid ${COLORS.creamDim}33`,
                    background: ratingValue === n ? COLORS.fairway : "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 18,
                    cursor: "pointer",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <input
              type="number"
              inputMode="decimal"
              value={actualValue}
              onChange={(e) => setActualValue(e.target.value)}
              style={{
                width: "100%",
                background: COLORS.turfDark,
                border: `1px solid ${COLORS.creamDim}33`,
                borderRadius: 8,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 22,
                padding: "10px 12px",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

function HomeScreen({ onNavigate }) {
  const [infoKey, setInfoKey] = useState(null);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, letterSpacing: 1.5 }}>
          WELCOME BACK
        </div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, marginTop: 2 }}>Pick a session</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {TILE_META.map((t) => (
          <div
            key={t.key}
            onClick={() => onNavigate(t.screen)}
            style={{
              position: "relative",
              height: 140,
              borderRadius: 14,
              overflow: "hidden",
              cursor: "pointer",
              border: `1px solid ${COLORS.creamDim}22`,
            }}
          >
            <t.Illustration />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(180deg, transparent 25%, ${COLORS.turfDark}dd 100%)`,
              }}
            />
            {!t.available && (
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: `${COLORS.turfDark}cc`,
                  border: `1px solid ${COLORS.creamDim}44`,
                  borderRadius: 5,
                  padding: "2px 6px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 8,
                  color: COLORS.creamDim,
                  letterSpacing: 0.5,
                }}
              >
                SOON
              </div>
            )}
            <HomeInfoButton
              onClick={() => setInfoKey(t.key)}
              style={{ top: 8, right: 8 }}
              tooltipText={HOME_INFO[t.key]?.short}
            />
            <div style={{ position: "absolute", left: 10, bottom: 8, right: 10 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 20,
                  letterSpacing: 0.5,
                  lineHeight: 1.05,
                  color: COLORS.cream,
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {t.label}
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  color: COLORS.creamDim,
                  marginTop: 2,
                  lineHeight: 1.35,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {t.subtitle}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        onClick={() => onNavigate(COMPETE_TILE.screen)}
        style={{
          position: "relative",
          height: 100,
          marginTop: 12,
          borderRadius: 14,
          overflow: "hidden",
          cursor: "pointer",
          border: `1px solid ${COLORS.creamDim}22`,
        }}
      >
        <CompeteIllustration />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(180deg, transparent 15%, ${COLORS.turfDark}dd 100%)`,
          }}
        />
        <HomeInfoButton
          onClick={() => setInfoKey("compete")}
          style={{ top: 8, right: 8 }}
          tooltipText={HOME_INFO.compete.short}
        />
        <div style={{ position: "absolute", left: 12, bottom: 8, right: 12 }}>
          <div
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 20,
              letterSpacing: 0.5,
              lineHeight: 1.05,
              color: COLORS.cream,
              textShadow: "0 2px 6px rgba(0,0,0,0.5)",
            }}
          >
            {COMPETE_TILE.label}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 2 }}>
            {COMPETE_TILE.subtitle}
          </div>
        </div>
      </div>

      <HomeInfoModal infoKey={infoKey} onClose={() => setInfoKey(null)} />
    </div>
  );
}


// ===== Tee Accuracy screens =====

function TeeAccuracySetupScreen({
  shotCount,
  setShotCount,
  fairwayWidth,
  setFairwayWidth,
  clubs,
  onToggleClub,
  onStart,
  units,
  history,
  loaded,
  onDeleteSession,
  onViewAnalysis,
}) {
  const unitLabel = longUnitLabel(units);
  const canStart = clubs.length > 0;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>TEE ACCURACY</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Fairways found off the tee
        </div>
      </div>

      <Card>
        <SectionLabel>Shots this session</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[10, 20, 30].map((n) => (
            <PillOption key={n} label={n} active={shotCount === n} onClick={() => setShotCount(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Fairway width</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          Defaults to a reasonable average fairway width — adjust for the course you're picturing.
        </div>

        <div style={{ textAlign: "center", marginTop: 14 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 40, lineHeight: 1, color: COLORS.flag }}>
            {ydsToUnitRound(fairwayWidth, units)}
            <span style={{ fontSize: 16, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              letterSpacing: 0.5,
              marginTop: 4,
              color: fairwayWidthDescriptor(fairwayWidth).color,
            }}
          >
            {fairwayWidthDescriptor(fairwayWidth).label}
          </div>
        </div>

        <input
          type="range"
          min={15}
          max={50}
          step={1}
          value={fairwayWidth}
          onChange={(e) => setFairwayWidth(parseInt(e.target.value, 10))}
          style={{
            width: "100%",
            marginTop: 14,
            accentColor: COLORS.flag,
            cursor: "pointer",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim }}>
            TIGHT ({ydsToUnitRound(15, units)}
            {unitLabel})
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim }}>
            WIDE ({ydsToUnitRound(50, units)}
            {unitLabel})
          </span>
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Clubs to test</SectionLabel>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <ClubToggle club="driver" active={clubs.includes("driver")} onClick={() => onToggleClub("driver")} />
          <ClubToggle club="fairway" active={clubs.includes("fairway")} onClick={() => onToggleClub("fairway")} />
          <ClubToggle club="hybrid" active={clubs.includes("hybrid")} onClick={() => onToggleClub("hybrid")} />
          <ClubToggle club="iron" active={clubs.includes("iron")} onClick={() => onToggleClub("iron")} />
        </div>
        {clubs.length === 0 && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Select at least one club.
          </div>
        )}
      </Card>

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START SESSION
      </button>

      <div
        onClick={onViewAnalysis}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        View tee accuracy analysis
      </div>

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past sessions" count={history.length}>
          {history.map((s) => (
            <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
              <Card style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                  {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {"  ·  "}
                  {s.shotCount} shots · {s.clubs.map((c) => CLUB_LABELS[c]).join(", ")}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <StatBox label="FAIRWAYS HIT" value={`${s.hitPct.toFixed(0)}%`} valueColor={ratingRagColor(s.hitPct / 20)} />
                  <StatBox label="HIT / TOTAL" value={`${s.hitCount}/${s.shotCount}`} />
                </div>
              </Card>
            </SwipeToDelete>
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}

function TeeAccuracyPracticeScreen({ shots, shotCount, currentClub, fairwayWidth, onSubmit, onExit, units }) {
  const shotNum = shots.length + 1;
  const unitLabel = longUnitLabel(units);
  const hitSoFar = shots.filter((s) => s.hit).length;
  const hitPctSoFar = shots.length ? (hitSoFar / shots.length) * 100 : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          SHOT {shotNum} OF {shotCount}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            CLUB
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 44, lineHeight: 1, color: COLORS.flag, marginTop: 2 }}>
            {CLUB_LABELS[currentClub]}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 6 }}>
            Aiming at a {ydsToUnitRound(fairwayWidth, units)}
            {unitLabel} wide fairway
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, textAlign: "center" }}>
            DID YOU FIND THE FAIRWAY?
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onSubmit(true)}
              style={{
                flex: 1,
                padding: "18px 0",
                borderRadius: 12,
                border: "none",
                background: COLORS.fairway,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 22,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              HIT
            </button>
            <button
              onClick={() => onSubmit(false)}
              style={{
                flex: 1,
                padding: "18px 0",
                borderRadius: 12,
                border: `2px solid ${COLORS.flag}`,
                background: "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 22,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              MISS
            </button>
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <StatBox
          label="FAIRWAYS HIT"
          value={hitPctSoFar !== null ? `${hitPctSoFar.toFixed(0)}%` : "—"}
          valueColor={hitPctSoFar !== null ? ratingRagColor(hitPctSoFar / 20) : COLORS.cream}
        />
        <StatBox label="HIT / SO FAR" value={`${hitSoFar}/${shots.length}`} />
      </div>

      {shots.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>This session</SectionLabel>
          <div
            style={{
              marginTop: 4,
              border: `1px solid ${COLORS.creamDim}22`,
              borderRadius: 10,
              overflow: "hidden",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
            }}
          >
            <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
              <div style={{ width: 24 }}>#</div>
              <div style={{ flex: 1 }}>CLUB</div>
              <div style={{ width: 60, textAlign: "right" }}>RESULT</div>
            </div>
            <div style={{ maxHeight: 150, overflowY: "auto" }}>
              {shots.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    padding: "7px 12px",
                    borderTop: `1px solid ${COLORS.creamDim}11`,
                    color: COLORS.cream,
                  }}
                >
                  <div style={{ width: 24, color: COLORS.creamDim }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>{CLUB_LABELS[s.club]}</div>
                  <div style={{ width: 60, textAlign: "right", color: s.hit ? COLORS.fairwayLight : COLORS.flag }}>
                    {s.hit ? "HIT" : "MISS"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TeeAccuracySummaryScreen({ shots, fairwayWidth, onNewSession, storageError, units }) {
  const hitCount = shots.filter((s) => s.hit).length;
  const hitPct = (hitCount / shots.length) * 100;
  const unitLabel = longUnitLabel(units);

  const byClub = {};
  shots.forEach((s) => {
    if (!byClub[s.club]) byClub[s.club] = [];
    byClub[s.club].push(s);
  });
  const clubStats = Object.entries(byClub).map(([club, shs]) => ({
    club,
    count: shs.length,
    hitPct: (shs.filter((s) => s.hit).length / shs.length) * 100,
  }));

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            SESSION COMPLETE — {shots.length} SHOTS · {ydsToUnitRound(fairwayWidth, units)}
            {unitLabel.toUpperCase()} FAIRWAY
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="FAIRWAYS HIT" value={`${hitPct.toFixed(0)}%`} valueColor={ratingRagColor(hitPct / 20)} />
          <StatBox label="HIT / TOTAL" value={`${hitCount}/${shots.length}`} />
        </div>
      </Card>

      {clubStats.length > 0 && (
        <Card style={{ marginTop: 10 }}>
          <SectionLabel>By club</SectionLabel>
          {clubStats.map((c, i) => (
            <div key={c.club} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                <div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream }}>{CLUB_LABELS[c.club]}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>{c.count} shots</div>
                </div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: ratingRagColor(c.hitPct / 20) }}>
                  {c.hitPct.toFixed(0)}%
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this session to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onNewSession}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW SESSION
      </button>
    </div>
  );
}

// ===== Compete (Range) screens =====

function CompeteSetupScreen({
  players,
  onUpdatePlayerName,
  onAddPlayer,
  onRemovePlayer,
  rounds,
  setRounds,
  minDist,
  maxDist,
  setMinDist,
  setMaxDist,
  mode,
  setMode,
  onStart,
  units,
  history,
  loaded,
  onDeleteSession,
}) {
  const validCount = players.map((p) => p.trim()).filter(Boolean).length;
  const invalidRange = minDist >= maxDist || minDist < 0;
  const canStart = validCount >= 2 && !invalidRange;
  const unitLabel = longUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>COMPETE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Head-to-head range challenge — 2 to 4 players
        </div>
      </div>

      <Card>
        <SectionLabel>Players</SectionLabel>
        <div style={{ marginTop: 8 }}>
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={p}
                onChange={(e) => onUpdatePlayerName(i, e.target.value)}
                placeholder={`Player ${i + 1}`}
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                  padding: "10px 12px",
                  boxSizing: "border-box",
                }}
              />
              {players.length > 2 && (
                <div
                  onClick={() => onRemovePlayer(i)}
                  style={{
                    color: COLORS.creamDim,
                    fontSize: 20,
                    cursor: "pointer",
                    padding: "0 6px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  ×
                </div>
              )}
            </div>
          ))}
        </div>
        {players.length < 4 && (
          <div
            onClick={onAddPlayer}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.sand,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            + ADD PLAYER
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Rounds</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[5, 10, 15].map((n) => (
            <PillOption key={n} label={n} active={rounds === n} onClick={() => setRounds(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Distance window ({unitLabel})</SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField
            label="MIN"
            value={ydsToUnitRound(minDist, units)}
            onChange={(v) => setMinDist(unitToYdsRound(v, units))}
          />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField
            label="MAX"
            value={ydsToUnitRound(maxDist, units)}
            onChange={(v) => setMaxDist(unitToYdsRound(v, units))}
          />
        </div>
        {invalidRange && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Max needs to be greater than min.
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>How to score each round</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <div
            onClick={() => setMode("distance")}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: mode === "distance" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: mode === "distance" ? COLORS.fairway : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream, letterSpacing: 0.5 }}>
              ENTER DISTANCES
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              Each player's actual distance is logged — full ranking, points scale with player count
              (e.g. 3 players: 2/1/0pts).
            </div>
          </div>
          <div
            onClick={() => setMode("closest")}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: mode === "closest" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: mode === "closest" ? COLORS.fairway : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream, letterSpacing: 0.5 }}>
              JUST PICK CLOSEST
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              No distances needed — just tap whoever was closest each round. Flat 1pt to the winner,
              0 to everyone else.
            </div>
          </div>
        </div>
      </Card>

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START COMPETITION
      </button>
      {validCount < 2 && (
        <div style={{ color: COLORS.creamDim, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}>
          Enter at least 2 player names to begin.
        </div>
      )}

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past competitions" count={history.length}>
          {history.map((s) => {
            const totals = computeCompeteTotals(s.players, s.rounds);
            const winner = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
            return (
              <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                <Card style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                    {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {"  ·  "}
                    {s.players.join(", ")} · {s.rounds.length} rounds
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, marginTop: 6, color: COLORS.sand }}>
                    ★ {winner ? winner[0] : "—"} won
                  </div>
                </Card>
              </SwipeToDelete>
            );
          })}
        </CollapsibleSection>
      )}
    </div>
  );
}

function CompetePlayScreen({
  players,
  roundResults,
  totalRounds,
  target,
  mode,
  currentPlayerIdx,
  distanceInput,
  setDistanceInput,
  onSubmitDistance,
  onSelectClosest,
  roundComplete,
  roundStandings,
  onNextRound,
  onExitEarly,
  units,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}) {
  const roundNumber = roundResults.length + 1;
  const isLastRound = roundResults.length >= totalRounds;
  const unitLabel = longUnitLabel(units);
  const totals = computeCompeteTotals(players, roundResults);
  const leaderboard = [...players].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          ROUND {Math.min(roundNumber, totalRounds)} OF {totalRounds}
        </div>
        <div
          onClick={onExitEarly}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          END COMPETITION
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          paddingBottom: 4,
          marginBottom: 10,
        }}
      >
        {leaderboard.map((p, i) => (
          <div
            key={p}
            style={{
              flex: "0 0 auto",
              padding: "6px 12px",
              borderRadius: 8,
              background: i === 0 ? `${COLORS.fairway}88` : COLORS.turf,
              border: `1px solid ${COLORS.creamDim}22`,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.cream,
              whiteSpace: "nowrap",
            }}
          >
            {i === 0 && (totals[p] || 0) > 0 ? "★ " : ""}
            {p} · {totals[p] || 0}pt{(totals[p] || 0) === 1 ? "" : "s"}
          </div>
        ))}
      </div>

      {!roundComplete ? (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              TARGET
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag }}>
              {ydsToUnitRound(target, units)}
              <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
            </div>
          </div>

          {mode === "distance" ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, marginBottom: 6 }}>
                NOW HITTING: {players[currentPlayerIdx]?.toUpperCase()}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  value={distanceInput}
                  onChange={(e) => setDistanceInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSubmitDistance()}
                  placeholder="0"
                  autoFocus
                  style={{
                    flex: 1,
                    background: COLORS.turfDark,
                    border: `1px solid ${COLORS.creamDim}33`,
                    borderRadius: 8,
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 24,
                    padding: "7px 12px",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={onSubmitDistance}
                  disabled={distanceInput === ""}
                  style={{
                    padding: "0 18px",
                    borderRadius: 8,
                    border: "none",
                    background: distanceInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 16,
                    letterSpacing: 1,
                    cursor: distanceInput === "" ? "not-allowed" : "pointer",
                  }}
                >
                  LOG
                </button>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
                Player {currentPlayerIdx + 1} of {players.length} this round
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
                WHO WAS CLOSEST?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {players.map((p) => (
                  <button
                    key={p}
                    onClick={() => onSelectClosest(p)}
                    style={{
                      padding: "14px 0",
                      borderRadius: 10,
                      border: `1px solid ${COLORS.creamDim}33`,
                      background: "transparent",
                      color: COLORS.cream,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 18,
                      letterSpacing: 0.5,
                      cursor: "pointer",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              ROUND {Math.min(roundNumber, totalRounds)} COMPLETE
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: COLORS.sand, marginTop: 4 }}>
              ★ {roundStandings.find((s) => s.rank === 1)?.player}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            {[...roundStandings]
              .sort((a, b) => (a.rank || 99) - (b.rank || 99))
              .map((s, i) => (
                <div
                  key={s.player}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "7px 0",
                    borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    color: COLORS.cream,
                  }}
                >
                  <div>
                    {s.rank ? `${s.rank}.` : ""} {s.player}
                    {s.diff !== undefined && (
                      <span style={{ color: COLORS.creamDim, fontSize: 11 }}> · {fmt1(ydsToUnit(s.diff, units))}{unitLabel} off</span>
                    )}
                  </div>
                  <div style={{ color: s.points > 0 ? COLORS.fairwayLight : COLORS.creamDim }}>+{s.points}pt</div>
                </div>
              ))}
          </div>

          <button
            onClick={onNextRound}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            {isLastRound ? "FINISH COMPETITION" : "NEXT ROUND"}
          </button>
        </Card>
      )}

      {roundResults.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, letterSpacing: 1, marginBottom: 6 }}>
            PAST ROUNDS — TAP TO AMEND
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {roundResults.map((r, i) => (
              <div
                key={i}
                onClick={() => onStartEdit(i)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: COLORS.turf,
                  border: `1px solid ${COLORS.creamDim}22`,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.cream }}>
                  Round {i + 1} · {ydsToUnitRound(r.target, units)}
                  {unitLabel} · ★ {r.standings?.find((s) => s.rank === 1)?.player}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.sand }}>EDIT</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingIndex !== null && (
        <CompeteRoundEditModal
          round={roundResults[editingIndex]}
          players={players}
          mode={mode}
          units={units}
          valueKind="yds"
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}
    </div>
  );
}

function CompeteSummaryScreen({ players, mode, roundResults, minDist, maxDist, units, onNewCompetition }) {
  const totals = computeCompeteTotals(players, roundResults);
  const leaderboard = [...players].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
  const topScore = totals[leaderboard[0]] || 0;
  const unitLabel = longUnitLabel(units);

  // Only meaningful in distance mode, where every round has real entries per player.
  const distanceStats = {};
  if (mode === "distance") {
    players.forEach((p) => {
      const diffs = [];
      roundResults.forEach((r) => {
        const entry = (r.entries || []).find((e) => e.player === p);
        if (entry) diffs.push(Math.abs(entry.distance - r.target));
      });
      distanceStats[p] = diffs.length ? avg(diffs) : null;
    });
  }

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            COMPETITION COMPLETE — {roundResults.length} ROUNDS
          </div>
        </div>
        {leaderboard.map((p, i) => (
          <div
            key={p}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 0",
              borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
            }}
          >
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: i === 0 && topScore > 0 ? COLORS.sand : COLORS.cream }}>
                {i === 0 && topScore > 0 ? "★ " : ""}
                {p}
              </div>
              {mode === "distance" && distanceStats[p] != null && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim }}>
                  avg {fmt1(ydsToUnit(distanceStats[p], units))}{unitLabel} off target
                </div>
              )}
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: COLORS.cream }}>{totals[p] || 0}pt</div>
          </div>
        ))}
      </Card>

      <CollapsibleSection title="Round by round" count={roundResults.length}>
        {roundResults.map((r, i) => (
          <Card key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
              ROUND {i + 1} · TARGET {ydsToUnitRound(r.target, units)}
              {unitLabel}
            </div>
            {[...r.standings]
              .sort((a, b) => (a.rank || 99) - (b.rank || 99))
              .map((s, j) => (
                <div
                  key={s.player}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "4px 0",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    color: COLORS.cream,
                  }}
                >
                  <div>
                    {s.rank ? `${s.rank}.` : ""} {s.player}
                  </div>
                  <div style={{ color: s.points > 0 ? COLORS.fairwayLight : COLORS.creamDim }}>+{s.points}</div>
                </div>
              ))}
          </Card>
        ))}
      </CollapsibleSection>

      <button
        onClick={onNewCompetition}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW COMPETITION
      </button>
    </div>
  );
}

function RangeChooseScreen({ onNavigate }) {
  const options = [
    {
      key: "distance",
      label: "DISTANCE CONTROL",
      subtitle: "Hit a random target distance, track how close you get",
      screen: "setup",
      Illustration: RangeIllustration,
    },
    {
      key: "teeaccuracy",
      label: "TEE ACCURACY",
      subtitle: "Fairways found off the tee, by club",
      screen: "teeaccuracy",
      Illustration: TeeAccuracyIllustration,
    },
  ];
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>THE RANGE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Choose what you're working on
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {options.map((o) => (
          <div
            key={o.key}
            onClick={() => onNavigate(o.screen)}
            style={{
              position: "relative",
              height: 120,
              borderRadius: 14,
              overflow: "hidden",
              cursor: "pointer",
              border: `1px solid ${COLORS.creamDim}22`,
            }}
          >
            <o.Illustration />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(180deg, transparent 20%, ${COLORS.turfDark}dd 100%)`,
              }}
            />
            <div style={{ position: "absolute", left: 12, bottom: 10, right: 12 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 22,
                  letterSpacing: 0.5,
                  lineHeight: 1.05,
                  color: COLORS.cream,
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {o.label}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                {o.subtitle}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompeteChooseScreen({ onNavigate }) {
  const options = [
    { key: "range", label: "RANGE", subtitle: "Closest to target wins each round", screen: "competeSetup" },
    { key: "putting", label: "PUTTING", subtitle: "Fewest putts across the round wins", screen: "competePuttingSetup" },
    { key: "shortgame", label: "SHORT GAME", subtitle: "Closest to the hole wins each round", screen: "competeShortGameSetup" },
  ];
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>COMPETE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Choose what you're playing
        </div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
          2-4 players go head-to-head, taking turns each round and racking up points for whoever
          gets closest — most points (or fewest putts in Putting) wins by the end.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {options.map((o) => (
          <div
            key={o.key}
            onClick={() => onNavigate(o.screen)}
            style={{
              padding: "16px",
              borderRadius: 12,
              border: `1px solid ${COLORS.creamDim}22`,
              background: COLORS.turf,
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 0.5, color: COLORS.cream }}>
              {o.label}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
              {o.subtitle}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== Compete (Short Game) screens =====

function ShortGameCompeteSetupScreen({
  players,
  onUpdatePlayerName,
  onAddPlayer,
  onRemovePlayer,
  rounds,
  setRounds,
  minYds,
  maxYds,
  setMinYds,
  setMaxYds,
  lies,
  onToggleLie,
  mode,
  setMode,
  onStart,
  units,
  history,
  loaded,
  onDeleteSession,
}) {
  const validCount = players.map((p) => p.trim()).filter(Boolean).length;
  const invalidRange = minYds < 5 || maxYds > 40 || minYds >= maxYds || lies.length === 0;
  const canStart = validCount >= 2 && !invalidRange;
  const unitLabel = longUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>COMPETE — SHORT GAME</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          2 to 4 players, closest to the hole
        </div>
      </div>

      <Card>
        <SectionLabel>Players</SectionLabel>
        <div style={{ marginTop: 8 }}>
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={p}
                onChange={(e) => onUpdatePlayerName(i, e.target.value)}
                placeholder={`Player ${i + 1}`}
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                  padding: "10px 12px",
                  boxSizing: "border-box",
                }}
              />
              {players.length > 2 && (
                <div
                  onClick={() => onRemovePlayer(i)}
                  style={{ color: COLORS.creamDim, fontSize: 20, cursor: "pointer", padding: "0 6px", display: "flex", alignItems: "center" }}
                >
                  ×
                </div>
              )}
            </div>
          ))}
        </div>
        {players.length < 4 && (
          <div
            onClick={onAddPlayer}
            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            + ADD PLAYER
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Rounds</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[5, 10, 15].map((n) => (
            <PillOption key={n} label={n} active={rounds === n} onClick={() => setRounds(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>
          Distance window ({unitLabel}, {ydsToUnitRound(5, units)}-{ydsToUnitRound(40, units)})
        </SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField label="MIN" value={ydsToUnitRound(minYds, units)} onChange={(v) => setMinYds(unitToYdsRound(v, units))} />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField label="MAX" value={ydsToUnitRound(maxYds, units)} onChange={(v) => setMaxYds(unitToYdsRound(v, units))} />
        </div>
        {(minYds < 5 || maxYds > 40 || minYds >= maxYds) && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Keep it between {ydsToUnitRound(5, units)} and {ydsToUnitRound(40, units)}
            {unitLabel}, with max greater than min.
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Lies to include</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <LieToggle lie="fairway" active={lies.includes("fairway")} onClick={() => onToggleLie("fairway")} />
          <LieToggle lie="rough" active={lies.includes("rough")} onClick={() => onToggleLie("rough")} />
          <LieToggle lie="bunker" active={lies.includes("bunker")} onClick={() => onToggleLie("bunker")} />
        </div>
        {lies.length === 0 && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Select at least one lie.
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>How to score each round</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <div
            onClick={() => setMode("distance")}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: mode === "distance" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: mode === "distance" ? COLORS.fairway : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream, letterSpacing: 0.5 }}>ENTER DISTANCES</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              Each player's finishing distance from the hole is logged — full ranking, points scale with player count.
            </div>
          </div>
          <div
            onClick={() => setMode("closest")}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: mode === "closest" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: mode === "closest" ? COLORS.fairway : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream, letterSpacing: 0.5 }}>JUST PICK CLOSEST</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              No distances needed — tap whoever finished closest. Flat 1pt to the winner, 0 to everyone else.
            </div>
          </div>
        </div>
      </Card>

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START COMPETITION
      </button>

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past competitions" count={history.length}>
          {history.map((s) => {
            const totals = computeCompeteTotals(s.players, s.rounds);
            const winner = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
            return (
              <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                <Card style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                    {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {"  ·  "}
                    {s.players.join(", ")} · {s.rounds.length} rounds
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, marginTop: 6, color: COLORS.sand }}>
                    ★ {winner ? winner[0] : "—"} won
                  </div>
                </Card>
              </SwipeToDelete>
            );
          })}
        </CollapsibleSection>
      )}
    </div>
  );
}

function ShortGameCompetePlayScreen({
  players,
  roundResults,
  totalRounds,
  currentShot,
  mode,
  currentPlayerIdx,
  resultInput,
  setResultInput,
  onSubmitDistance,
  onSelectClosest,
  roundComplete,
  roundStandings,
  onNextRound,
  onExitEarly,
  units,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}) {
  const roundNumber = roundResults.length + 1;
  const isLastRound = roundResults.length >= totalRounds;
  const yLabel = longUnitLabel(units);
  const shortLabel = shortUnitLabel(units);
  const totals = computeCompeteTotals(players, roundResults);
  const leaderboard = [...players].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          ROUND {Math.min(roundNumber, totalRounds)} OF {totalRounds}
        </div>
        <div
          onClick={onExitEarly}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          END COMPETITION
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
        {leaderboard.map((p, i) => (
          <div
            key={p}
            style={{
              flex: "0 0 auto",
              padding: "6px 12px",
              borderRadius: 8,
              background: i === 0 ? `${COLORS.fairway}88` : COLORS.turf,
              border: `1px solid ${COLORS.creamDim}22`,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.cream,
              whiteSpace: "nowrap",
            }}
          >
            {i === 0 && (totals[p] || 0) > 0 ? "★ " : ""}
            {p} · {totals[p] || 0}pt{(totals[p] || 0) === 1 ? "" : "s"}
          </div>
        ))}
      </div>

      {!roundComplete ? (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              {LIE_LABELS[currentShot.lie]}
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag, marginTop: 2 }}>
              {ydsToUnitRound(currentShot.target, units)}
              <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{yLabel}</span>
            </div>
          </div>

          {mode === "distance" ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, marginBottom: 6 }}>
                NOW HITTING: {players[currentPlayerIdx]?.toUpperCase()}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  value={resultInput}
                  onChange={(e) => setResultInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSubmitDistance()}
                  placeholder="0"
                  autoFocus
                  style={{
                    flex: 1,
                    background: COLORS.turfDark,
                    border: `1px solid ${COLORS.creamDim}33`,
                    borderRadius: 8,
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 24,
                    padding: "7px 12px",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={onSubmitDistance}
                  disabled={resultInput === ""}
                  style={{
                    padding: "0 18px",
                    borderRadius: 8,
                    border: "none",
                    background: resultInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 16,
                    letterSpacing: 1,
                    cursor: resultInput === "" ? "not-allowed" : "pointer",
                  }}
                >
                  LOG
                </button>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
                Result in {shortLabel} from hole · Player {currentPlayerIdx + 1} of {players.length} this round
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
                WHO WAS CLOSEST?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {players.map((p) => (
                  <button
                    key={p}
                    onClick={() => onSelectClosest(p)}
                    style={{
                      padding: "14px 0",
                      borderRadius: 10,
                      border: `1px solid ${COLORS.creamDim}33`,
                      background: "transparent",
                      color: COLORS.cream,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 18,
                      letterSpacing: 0.5,
                      cursor: "pointer",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              ROUND {Math.min(roundNumber, totalRounds)} COMPLETE
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: COLORS.sand, marginTop: 4 }}>
              ★ {roundStandings.find((s) => s.rank === 1)?.player}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            {[...roundStandings]
              .sort((a, b) => (a.rank || 99) - (b.rank || 99))
              .map((s, i) => (
                <div
                  key={s.player}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "7px 0",
                    borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    color: COLORS.cream,
                  }}
                >
                  <div>
                    {s.rank ? `${s.rank}.` : ""} {s.player}
                    {s.resultFt !== undefined && (
                      <span style={{ color: COLORS.creamDim, fontSize: 11 }}> · {fmt1(ftToUnit(s.resultFt, units))}{shortLabel}</span>
                    )}
                  </div>
                  <div style={{ color: s.points > 0 ? COLORS.fairwayLight : COLORS.creamDim }}>+{s.points}pt</div>
                </div>
              ))}
          </div>
          <button
            onClick={onNextRound}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            {isLastRound ? "FINISH COMPETITION" : "NEXT ROUND"}
          </button>
        </Card>
      )}

      {roundResults.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, letterSpacing: 1, marginBottom: 6 }}>
            PAST ROUNDS — TAP TO AMEND
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {roundResults.map((r, i) => (
              <div
                key={i}
                onClick={() => onStartEdit(i)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: COLORS.turf,
                  border: `1px solid ${COLORS.creamDim}22`,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.cream }}>
                  Round {i + 1} · {LIE_LABELS[r.lie]} · ★ {r.standings?.find((s) => s.rank === 1)?.player}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.sand }}>EDIT</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingIndex !== null && (
        <CompeteRoundEditModal
          round={roundResults[editingIndex]}
          players={players}
          mode={mode}
          units={units}
          valueKind="ft"
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}
    </div>
  );
}

function ShortGameCompeteSummaryScreen({ players, mode, roundResults, units, onNewCompetition }) {
  const totals = computeCompeteTotals(players, roundResults);
  const leaderboard = [...players].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
  const topScore = totals[leaderboard[0]] || 0;
  const shortLabel = shortUnitLabel(units);

  const proximityStats = {};
  if (mode === "distance") {
    players.forEach((p) => {
      const dists = [];
      roundResults.forEach((r) => {
        const entry = (r.entries || []).find((e) => e.player === p);
        if (entry) dists.push(entry.resultFt);
      });
      proximityStats[p] = dists.length ? avg(dists) : null;
    });
  }

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            COMPETITION COMPLETE — {roundResults.length} ROUNDS
          </div>
        </div>
        {leaderboard.map((p, i) => (
          <div key={p} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: i === 0 && topScore > 0 ? COLORS.sand : COLORS.cream }}>
                {i === 0 && topScore > 0 ? "★ " : ""}
                {p}
              </div>
              {mode === "distance" && proximityStats[p] != null && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim }}>
                  avg {fmt1(ftToUnit(proximityStats[p], units))}{shortLabel} from hole
                </div>
              )}
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: COLORS.cream }}>{totals[p] || 0}pt</div>
          </div>
        ))}
      </Card>

      <CollapsibleSection title="Round by round" count={roundResults.length}>
        {roundResults.map((r, i) => (
          <Card key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
              ROUND {i + 1} · {LIE_LABELS[r.lie]} · {ydsToUnitRound(r.target, units)}
              {longUnitLabel(units)}
            </div>
            {[...r.standings]
              .sort((a, b) => (a.rank || 99) - (b.rank || 99))
              .map((s) => (
                <div key={s.player} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.cream }}>
                  <div>
                    {s.rank ? `${s.rank}.` : ""} {s.player}
                  </div>
                  <div style={{ color: s.points > 0 ? COLORS.fairwayLight : COLORS.creamDim }}>+{s.points}</div>
                </div>
              ))}
          </Card>
        ))}
      </CollapsibleSection>

      <button
        onClick={onNewCompetition}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW COMPETITION
      </button>
    </div>
  );
}

// ===== Compete (Putting) screens — tally of putts, SG shown only at the end =====

function PuttingCompeteSetupScreen({
  players,
  onUpdatePlayerName,
  onAddPlayer,
  onRemovePlayer,
  holes,
  setHoles,
  minFt,
  maxFt,
  setMinFt,
  setMaxFt,
  onStart,
  units,
  history,
  loaded,
  onDeleteSession,
}) {
  const validCount = players.map((p) => p.trim()).filter(Boolean).length;
  const invalidRange = minFt >= maxFt || minFt < 3;
  const canStart = validCount >= 2 && !invalidRange;
  const unitLabel = shortUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>COMPETE — PUTTING</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          2 to 4 players, fewest putts wins
        </div>
      </div>

      <Card>
        <SectionLabel>Players</SectionLabel>
        <div style={{ marginTop: 8 }}>
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={p}
                onChange={(e) => onUpdatePlayerName(i, e.target.value)}
                placeholder={`Player ${i + 1}`}
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                  padding: "10px 12px",
                  boxSizing: "border-box",
                }}
              />
              {players.length > 2 && (
                <div
                  onClick={() => onRemovePlayer(i)}
                  style={{ color: COLORS.creamDim, fontSize: 20, cursor: "pointer", padding: "0 6px", display: "flex", alignItems: "center" }}
                >
                  ×
                </div>
              )}
            </div>
          ))}
        </div>
        {players.length < 4 && (
          <div
            onClick={onAddPlayer}
            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            + ADD PLAYER
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Holes</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[5, 9, 18].map((n) => (
            <PillOption key={n} label={n} active={holes === n} onClick={() => setHoles(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>
          Distance window ({unitLabel}, {ftToUnitRound(3, units)}
          {unitLabel} min)
        </SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField label="MIN" value={ftToUnitRound(minFt, units)} onChange={(v) => setMinFt(Math.max(3, unitToFtRound(v, units)))} />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField label="MAX" value={ftToUnitRound(maxFt, units)} onChange={(v) => setMaxFt(unitToFtRound(v, units))} />
        </div>
        {invalidRange && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Min can't go below {ftToUnitRound(3, units)}
            {unitLabel}, and max must be greater than min.
          </div>
        )}
      </Card>

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 10, lineHeight: 1.5 }}>
        Same target distance for everyone each hole. Enter how many putts each player took — fewest
        total putts across all holes wins. Strokes gained (vs PGA Tour) for each player shows up at
        the end.
      </div>

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START COMPETITION
      </button>

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past competitions" count={history.length}>
          {history.map((s) => {
            const tallies = computePuttCompeteTallies(s.players, s.holes);
            const winner = Object.entries(tallies).sort((a, b) => a[1] - b[1])[0];
            return (
              <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                <Card style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                    {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {"  ·  "}
                    {s.players.join(", ")} · {s.holes.length} holes
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, marginTop: 6, color: COLORS.sand }}>
                    ★ {winner ? winner[0] : "—"} won ({winner ? winner[1] : "—"} putts)
                  </div>
                </Card>
              </SwipeToDelete>
            );
          })}
        </CollapsibleSection>
      )}
    </div>
  );
}

function PuttingCompetePlayScreen({
  players,
  holeResults,
  totalHoles,
  target,
  currentPlayerIdx,
  holeComplete,
  onSubmitStrokes,
  onNextHole,
  onExitEarly,
  units,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}) {
  const holeNumber = holeResults.length + 1;
  const isLastHole = holeResults.length >= totalHoles;
  const unitLabel = shortUnitLabel(units);
  const tallies = computePuttCompeteTallies(players, holeResults);
  const leaderboard = [...players].sort((a, b) => (tallies[a] || 0) - (tallies[b] || 0)); // fewer putts is better
  const lastHole = holeResults[holeResults.length - 1];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          HOLE {Math.min(holeNumber, totalHoles)} OF {totalHoles}
        </div>
        <div
          onClick={onExitEarly}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          END COMPETITION
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
        {leaderboard.map((p, i) => (
          <div
            key={p}
            style={{
              flex: "0 0 auto",
              padding: "6px 12px",
              borderRadius: 8,
              background: i === 0 && holeResults.length > 0 ? `${COLORS.fairway}88` : COLORS.turf,
              border: `1px solid ${COLORS.creamDim}22`,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.cream,
              whiteSpace: "nowrap",
            }}
          >
            {i === 0 && holeResults.length > 0 ? "★ " : ""}
            {p} · {tallies[p] || 0} putts
          </div>
        ))}
      </div>

      {!holeComplete ? (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              DISTANCE
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag }}>
              {ftToUnitRound(target, units)}
              <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, marginBottom: 8 }}>
              NOW PUTTING: {players[currentPlayerIdx]?.toUpperCase()}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
              PUTTS TAKEN
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => onSubmitStrokes(n)}
                  style={{
                    flex: 1,
                    padding: "14px 0",
                    borderRadius: 10,
                    border: `2px solid ${ragColor(ragStatusForPutts(n))}`,
                    background: "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 22,
                    cursor: "pointer",
                  }}
                >
                  {n === 4 ? "4+" : n}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
              Player {currentPlayerIdx + 1} of {players.length} this hole
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              HOLE {Math.min(holeNumber, totalHoles)} COMPLETE
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            {lastHole &&
              [...lastHole.putts]
                .sort((a, b) => a.strokes - b.strokes)
                .map((e, i) => (
                  <div
                    key={e.player}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "7px 0",
                      borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      color: COLORS.cream,
                    }}
                  >
                    <div>{e.player}</div>
                    <div>{e.strokes} putt{e.strokes === 1 ? "" : "s"}</div>
                  </div>
                ))}
          </div>
          <button
            onClick={onNextHole}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            {isLastHole ? "FINISH COMPETITION" : "NEXT HOLE"}
          </button>
        </Card>
      )}

      {holeResults.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, letterSpacing: 1, marginBottom: 6 }}>
            PAST HOLES — TAP TO AMEND
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {holeResults.map((h, i) => (
              <div
                key={i}
                onClick={() => onStartEdit(i)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: COLORS.turf,
                  border: `1px solid ${COLORS.creamDim}22`,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.cream }}>
                  Hole {i + 1} · {ftToUnitRound(h.target, units)}
                  {unitLabel} ·{" "}
                  {h.putts.map((e) => `${e.player} ${e.strokes}`).join(", ")}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.sand }}>EDIT</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingIndex !== null && (
        <PuttingCompeteHoleEditModal
          hole={holeResults[editingIndex]}
          players={players}
          units={units}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}
    </div>
  );
}

function PuttingCompeteSummaryScreen({ players, holeResults, units, onNewCompetition }) {
  const tallies = computePuttCompeteTallies(players, holeResults);
  const leaderboard = [...players].sort((a, b) => (tallies[a] || 0) - (tallies[b] || 0));
  const bestTally = tallies[leaderboard[0]] || 0;
  const unitLabel = shortUnitLabel(units);

  // Strokes gained here is always PGA Tour baseline specifically, regardless of whatever
  // handicap baseline is selected in Settings — this is the one explicit exception in the app.
  const sgStats = {};
  players.forEach((p) => {
    let totalSG = 0;
    let count = 0;
    holeResults.forEach((h) => {
      const entry = h.putts.find((e) => e.player === p);
      if (entry) {
        totalSG += sgForPuttTourOnly(h.target, entry.strokes);
        count++;
      }
    });
    sgStats[p] = count ? { total: totalSG, avg: totalSG / count } : null;
  });

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            COMPETITION COMPLETE — {holeResults.length} HOLES
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
            Strokes gained vs PGA Tour baseline
          </div>
        </div>
        {leaderboard.map((p, i) => (
          <div key={p} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: i === 0 ? COLORS.sand : COLORS.cream }}>
                {i === 0 ? "★ " : ""}
                {p}
              </div>
              {sgStats[p] && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim }}>
                  {formatSG(sgStats[p].total)} total SG · {formatSG(sgStats[p].avg)}/putt
                </div>
              )}
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: COLORS.cream }}>{tallies[p] || 0} putts</div>
          </div>
        ))}
      </Card>

      <CollapsibleSection title="Hole by hole" count={holeResults.length}>
        {holeResults.map((h, i) => (
          <Card key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
              HOLE {i + 1} · {ftToUnitRound(h.target, units)}
              {unitLabel}
            </div>
            {[...h.putts]
              .sort((a, b) => a.strokes - b.strokes)
              .map((e) => (
                <div key={e.player} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.cream }}>
                  <div>{e.player}</div>
                  <div>{e.strokes}</div>
                </div>
              ))}
          </Card>
        ))}
      </CollapsibleSection>

      <button
        onClick={onNewCompetition}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW COMPETITION
      </button>
    </div>
  );
}

// ===== Putting section screens =====

function ShortGameLog({ shots, units }) {
  const yLabel = longUnitLabel(units);
  const shortLabel = shortUnitLabel(units);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ width: 22 }}>#</div>
        <div style={{ width: 60 }}>LIE</div>
        <div style={{ flex: 1 }}>DIST</div>
        <div style={{ width: 55, textAlign: "right" }}>{shortLabel.toUpperCase()}</div>
        <div style={{ width: 50, textAlign: "right" }}>SG</div>
      </div>
      <div style={{ maxHeight: 150, overflowY: "auto" }}>
        {shots.map((s, i) => {
          const sg = sgForShortGameShot(s.lie, s.target, s.resultFt);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                padding: "7px 12px",
                borderTop: `1px solid ${COLORS.creamDim}11`,
                color: COLORS.cream,
              }}
            >
              <div style={{ width: 22, color: COLORS.creamDim }}>{i + 1}</div>
              <div style={{ width: 60, fontSize: 10, color: COLORS.creamDim }}>{LIE_LABELS[s.lie]}</div>
              <div style={{ flex: 1 }}>
                {ydsToUnitRound(s.target, units)}
                {yLabel}
              </div>
              <div style={{ width: 55, textAlign: "right" }}>
                {fmt1(ftToUnit(s.resultFt, units))}
                {shortLabel}
              </div>
              <div style={{ width: 50, textAlign: "right", color: sgRagColor(sg) }}>{formatSG(sg)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LieToggle({ lie, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 0",
        borderRadius: 10,
        border: active ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
        background: active ? COLORS.fairway : "transparent",
        color: active ? COLORS.cream : COLORS.creamDim,
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 14,
        letterSpacing: 1,
        cursor: "pointer",
      }}
    >
      {LIE_LABELS[lie]}
    </button>
  );
}

function ClubToggle({ club, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 2px",
        borderRadius: 10,
        border: active ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
        background: active ? COLORS.fairway : "transparent",
        color: active ? COLORS.cream : COLORS.creamDim,
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 11,
        letterSpacing: 0.3,
        cursor: "pointer",
        textAlign: "center",
      }}
    >
      {CLUB_LABELS[club]}
    </button>
  );
}

function ShortGameSetupScreen({
  shortShotCount,
  setShortShotCount,
  shortMinYds,
  shortMaxYds,
  setShortMinYds,
  setShortMaxYds,
  shortLies,
  onToggleLie,
  onStart,
  activeSaved,
  onResume,
  onDiscard,
  onViewAnalysis,
  onLoadTestData,
  units,
}) {
  const invalidRange =
    shortMinYds < 5 || shortMaxYds > 40 || shortMinYds >= shortMaxYds || shortLies.length === 0;
  const unitLabel = longUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>SHORT GAME</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Chipping & pitching
        </div>
      </div>

      {activeSaved && (
        <Card style={{ marginBottom: 10, border: `1px solid ${COLORS.sand}66` }}>
          <SectionLabel>Session in progress</SectionLabel>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, marginTop: 3 }}>
            Shot {activeSaved.shortShots.length + 1} of {activeSaved.shortShotCount}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
            {ydsToUnitRound(activeSaved.shortMinYds, units)}-{ydsToUnitRound(activeSaved.shortMaxYds, units)}
            {unitLabel} window
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={onResume}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 8,
                border: "none",
                background: COLORS.sand,
                color: COLORS.turfDark,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              RESUME
            </button>
            <button
              onClick={onDiscard}
              style={{
                padding: "9px 14px",
                borderRadius: 8,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              DISCARD
            </button>
          </div>
        </Card>
      )}

      <Card>
        <SectionLabel>Shots this session</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[10, 20, 30].map((n) => (
            <PillOption key={n} label={n} active={shortShotCount === n} onClick={() => setShortShotCount(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>
          Distance window ({unitLabel}, {ydsToUnitRound(5, units)}-{ydsToUnitRound(40, units)})
        </SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField
            label="MIN"
            value={ydsToUnitRound(shortMinYds, units)}
            onChange={(v) => setShortMinYds(unitToYdsRound(v, units))}
          />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField
            label="MAX"
            value={ydsToUnitRound(shortMaxYds, units)}
            onChange={(v) => setShortMaxYds(unitToYdsRound(v, units))}
          />
        </div>
        {(shortMinYds < 5 || shortMaxYds > 40 || shortMinYds >= shortMaxYds) && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Keep it between {ydsToUnitRound(5, units)} and {ydsToUnitRound(40, units)}
            {unitLabel}, with max greater than min.
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Lies to practice</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <LieToggle lie="fairway" active={shortLies.includes("fairway")} onClick={() => onToggleLie("fairway")} />
          <LieToggle lie="rough" active={shortLies.includes("rough")} onClick={() => onToggleLie("rough")} />
          <LieToggle lie="bunker" active={shortLies.includes("bunker")} onClick={() => onToggleLie("bunker")} />
        </div>
        {shortLies.length === 0 && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Select at least one lie.
          </div>
        )}
      </Card>

      <button
        onClick={onStart}
        disabled={invalidRange}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: invalidRange ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: invalidRange ? "not-allowed" : "pointer",
        }}
      >
        START SESSION
      </button>

      <div
        onClick={onViewAnalysis}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        View short game analysis
      </div>
    </div>
  );
}

function ShortGamePracticeScreen({ shots, shotCount, currentShot, resultInput, setResultInput, onSubmit, onReroll, onExit, units }) {
  const shotNum = shots.length + 1;
  const liveAvgSG = shots.length ? avg(shots.map((s) => sgForShortGameShot(s.lie, s.target, s.resultFt))) : null;
  const liveAvgFt = shots.length ? avg(shots.map((s) => s.resultFt)) : null;
  const yLabel = longUnitLabel(units);
  const shortLabel = shortUnitLabel(units);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          SHOT {shotNum} OF {shotCount}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          SAVE &amp; EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            {LIE_LABELS[currentShot.lie]}
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag, marginTop: 2 }}>
            {ydsToUnitRound(currentShot.target, units)}
            <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{yLabel}</span>
          </div>
        </div>

        <div
          onClick={onReroll}
          style={{
            textAlign: "center",
            marginTop: 8,
            color: COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          DIFFERENT SHOT
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 5 }}>
            RESULT — {shortLabel.toUpperCase()} FROM HOLE
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              inputMode="decimal"
              value={resultInput}
              onChange={(e) => setResultInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              placeholder="0"
              style={{
                flex: 1,
                background: COLORS.turfDark,
                border: `1px solid ${COLORS.creamDim}33`,
                borderRadius: 8,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 24,
                padding: "7px 12px",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={onSubmit}
              disabled={resultInput === ""}
              style={{
                padding: "0 18px",
                borderRadius: 8,
                border: "none",
                background: resultInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: resultInput === "" ? "not-allowed" : "pointer",
              }}
            >
              LOG
            </button>
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <StatBox
          label="AVG SG / SHOT"
          value={liveAvgSG !== null ? formatSG(liveAvgSG) : "—"}
          valueColor={liveAvgSG !== null ? sgRagColor(liveAvgSG) : COLORS.cream}
        />
        <StatBox
          label={`AVG ${shortLabel.toUpperCase()}`}
          value={liveAvgFt !== null ? `${fmt1(ftToUnit(liveAvgFt, units))}${shortLabel}` : "—"}
        />
      </div>

      {shots.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>This session</SectionLabel>
          <div style={{ marginTop: 4 }}>
            <ShortGameLog shots={shots} units={units} />
          </div>
        </div>
      )}
    </div>
  );
}

function ShortGameSummaryScreen({ shots, onNewSession, storageError, units, feedback }) {
  const avgResultFt = avg(shots.map((s) => s.resultFt));
  const sgValues = shots.map((s) => ({ ...s, sg: sgForShortGameShot(s.lie, s.target, s.resultFt) }));
  const avgSG = avg(sgValues.map((s) => s.sg));
  const totalSG = sgValues.reduce((a, s) => a + s.sg, 0);
  const best = sgValues.reduce((b, s) => (s.sg > b.sg ? s : b), sgValues[0]);
  const worst = sgValues.reduce((w, s) => (s.sg < w.sg ? s : w), sgValues[0]);
  const shortLabel = shortUnitLabel(units);

  return (
    <div>
      <SessionFeedbackBanner feedback={feedback} />
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            SESSION COMPLETE — {shots.length} SHOTS
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="TOTAL SG" value={formatSG(totalSG)} valueColor={sgRagColor(avgSG)} />
          <StatBox label="AVG SG / SHOT" value={formatSG(avgSG)} valueColor={sgRagColor(avgSG)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox
            label={`AVG ${shortLabel.toUpperCase()} FROM HOLE`}
            value={`${fmt1(ftToUnit(avgResultFt, units))}${shortLabel}`}
          />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="BEST SHOT" value={formatSG(best.sg)} valueColor={sgRagColor(best.sg)} />
          <StatBox label="WORST SHOT" value={formatSG(worst.sg)} valueColor={sgRagColor(worst.sg)} />
        </div>
      </Card>

      <div style={{ marginTop: 10 }}>
        <SectionLabel>Full log</SectionLabel>
        <div style={{ marginTop: 4 }}>
          <ShortGameLog shots={shots} units={units} />
        </div>
      </div>

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this session to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onNewSession}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW SESSION
      </button>
    </div>
  );
}

function PuttingSetupScreen({
  puttCount,
  setPuttCount,
  puttMinFt,
  puttMaxFt,
  setPuttMinFt,
  setPuttMaxFt,
  onStart,
  activeSaved,
  onResume,
  onDiscard,
  onViewAnalysis,
  onLoadTestData,
  onCourseHoles,
  onUpdateCourseHole,
  onFinishOnCourse,
  onClearOnCourse,
  onLoadTestCourseData,
  units,
}) {
  const [mode, setMode] = useState("practice"); // practice | course
  const [courseDistanceInput, setCourseDistanceInput] = useState("");
  const courseInputRef = useRef(null);
  const invalidRange = puttMinFt >= puttMaxFt || puttMinFt < 3;
  const courseCompleted = onCourseHoles.filter(isHoleComplete);
  const courseCompletedWithNumbers = onCourseHoles
    .map((h, i) => ({
      hole: i + 1,
      distanceFt: h.putts[0]?.distanceFt,
      strokes: h.putts.length,
      holedFromFt: h.putts[h.putts.length - 1]?.distanceFt,
      noPutt: h.noPutt || false,
    }))
    .filter((h) => isHoleComplete(onCourseHoles[h.hole - 1]));
  const onCourseInProgress = courseCompleted.length > 0;
  const courseCurrentIndex = onCourseHoles.findIndex((h) => !isHoleComplete(h));
  const lastTouchedIndex = onCourseHoles.reduce((acc, h, i) => (h.putts.length > 0 || h.noPutt ? i : acc), -1);
  const unitLabel = shortUnitLabel(units);

  function recordPutt(made) {
    const val = unitToFt(parseFloat(courseDistanceInput), units);
    if (isNaN(val) || val < 0) return;
    const hole = onCourseHoles[courseCurrentIndex];
    const newPutts = [...hole.putts, { distanceFt: val, made }];
    onUpdateCourseHole(courseCurrentIndex, "putts", newPutts);
    setCourseDistanceInput("");
    // Keep the numeric keypad open between putts rather than making the user tap the field
    // again every time — same fix as Range practice, and just as valuable here since a full
    // round is 18+ separate entries in a row.
    if (courseInputRef.current) courseInputRef.current.focus();
  }

  // Rare case: chipped in from off the green, so there's no putt at all to record for this hole.
  function markNoPutt() {
    onUpdateCourseHole(courseCurrentIndex, "noPutt", true);
    setCourseDistanceInput("");
  }

  // Undoes the single most recent putt entry — whether that's a putt already recorded on the
  // hole currently in progress, the last (made) putt of the hole before it, or a "no putt"
  // chip-in marking — in each case, that hole reopens for continued entry.
  function undoLastPutt() {
    setCourseDistanceInput("");
    if (courseCurrentIndex !== -1 && onCourseHoles[courseCurrentIndex].putts.length > 0) {
      onUpdateCourseHole(courseCurrentIndex, "putts", onCourseHoles[courseCurrentIndex].putts.slice(0, -1));
    } else if (lastTouchedIndex !== -1) {
      const prev = onCourseHoles[lastTouchedIndex];
      if (prev.noPutt) {
        onUpdateCourseHole(lastTouchedIndex, "noPutt", false);
      } else {
        onUpdateCourseHole(lastTouchedIndex, "putts", prev.putts.slice(0, -1));
      }
    }
    if (courseInputRef.current) courseInputRef.current.focus();
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>PUTTING</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Practice & On-Course
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setMode("practice")}
          style={{
            flex: 1,
            padding: "10px 0",
            borderRadius: 10,
            border: mode === "practice" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: mode === "practice" ? COLORS.fairway : "transparent",
            color: mode === "practice" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 16,
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          PRACTICE
        </button>
        <button
          onClick={() => setMode("course")}
          style={{
            flex: 1,
            padding: "10px 0",
            borderRadius: 10,
            border: mode === "course" ? `2px solid ${COLORS.sand}` : `1px solid ${COLORS.creamDim}33`,
            background: mode === "course" ? `${COLORS.sand}22` : "transparent",
            color: mode === "course" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 16,
            letterSpacing: 1,
            cursor: "pointer",
            position: "relative",
          }}
        >
          ON COURSE
          {onCourseInProgress && (
            <span
              style={{
                position: "absolute",
                top: 5,
                right: 7,
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: COLORS.sand,
              }}
            />
          )}
        </button>
      </div>

      {mode === "course" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim }}>
              {courseCompleted.length} OF 18 HOLES LOGGED
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {lastTouchedIndex !== -1 && (
                <div
                  onClick={undoLastPutt}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: COLORS.sand,
                    cursor: "pointer",
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                  }}
                >
                  UNDO LAST PUTT
                </div>
              )}
              {onCourseInProgress && (
                <div
                  onClick={onClearOnCourse}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: COLORS.creamDim,
                    cursor: "pointer",
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                  }}
                >
                  CLEAR
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
            <StatBox
              label="TOTAL SG"
              value={formatSG(
                courseCompletedWithNumbers.filter((h) => !h.noPutt).reduce((a, h) => a + sgForPutt(h.distanceFt, h.strokes), 0)
              )}
              valueColor={sgRagColor(
                courseCompletedWithNumbers.filter((h) => !h.noPutt).length
                  ? courseCompletedWithNumbers.filter((h) => !h.noPutt).reduce((a, h) => a + sgForPutt(h.distanceFt, h.strokes), 0) /
                      courseCompletedWithNumbers.filter((h) => !h.noPutt).length
                  : 0
              )}
            />
            <StatBox label="TOTAL PUTTS" value={courseCompletedWithNumbers.reduce((a, h) => a + h.strokes, 0)} />
          </div>

          {courseCurrentIndex === -1 ? (
            <Card style={{ textAlign: "center", padding: "22px 16px" }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1 }}>
                ALL 18 HOLES LOGGED
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 6 }}>
                Tap Finish Round below to save.
              </div>
            </Card>
          ) : (
            <Card>
              <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
                HOLE {courseCurrentIndex + 1} OF 18 · PUTT {onCourseHoles[courseCurrentIndex].putts.length + 1}
              </div>
              <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginTop: 8 }}>
                {onCourseHoles[courseCurrentIndex].putts.length === 0 ? "FIRST PUTT DISTANCE" : "NEXT PUTT DISTANCE"} ({unitLabel.toUpperCase()})
              </div>
              <input
                ref={courseInputRef}
                autoFocus
                type="number"
                inputMode="decimal"
                value={courseDistanceInput}
                onChange={(e) => setCourseDistanceInput(e.target.value)}
                placeholder="0"
                style={{
                  width: "100%",
                  marginTop: 6,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 32,
                  padding: "8px 14px",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginTop: 12, marginBottom: 6, textAlign: "center" }}>
                DID IT GO IN?
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => recordPutt(true)}
                  disabled={courseDistanceInput === ""}
                  style={{
                    flex: 1,
                    padding: "16px 0",
                    borderRadius: 10,
                    border: "none",
                    background: courseDistanceInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 20,
                    letterSpacing: 1,
                    cursor: courseDistanceInput === "" ? "not-allowed" : "pointer",
                  }}
                >
                  MAKE
                </button>
                <button
                  onClick={() => recordPutt(false)}
                  disabled={courseDistanceInput === ""}
                  style={{
                    flex: 1,
                    padding: "16px 0",
                    borderRadius: 10,
                    border: `2px solid ${courseDistanceInput === "" ? COLORS.creamDim + "55" : COLORS.flag}`,
                    background: "transparent",
                    color: courseDistanceInput === "" ? COLORS.creamDim : COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 20,
                    letterSpacing: 1,
                    cursor: courseDistanceInput === "" ? "not-allowed" : "pointer",
                  }}
                >
                  MISS
                </button>
              </div>
              {onCourseHoles[courseCurrentIndex].putts.length === 0 && (
                <div
                  onClick={markNoPutt}
                  style={{
                    textAlign: "center",
                    marginTop: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: COLORS.creamDim,
                    cursor: "pointer",
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                  }}
                >
                  No putt taken (chipped in)
                </div>
              )}
            </Card>
          )}

          <button
            onClick={onFinishOnCourse}
            disabled={courseCompleted.length === 0}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "12px 0",
              borderRadius: 12,
              border: "none",
              background: courseCompleted.length === 0 ? `${COLORS.fairway}66` : COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18,
              letterSpacing: 2,
              cursor: courseCompleted.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            FINISH ROUND
          </button>

          {courseCompletedWithNumbers.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <SectionLabel>This round</SectionLabel>
              <div
                style={{
                  marginTop: 6,
                  border: `1px solid ${COLORS.creamDim}22`,
                  borderRadius: 10,
                  overflow: "hidden",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
                  <div style={{ width: 40 }}>HOLE</div>
                  <div style={{ flex: 1 }}>DIST</div>
                  <div style={{ width: 55, textAlign: "right" }}>PUTTS</div>
                  <div style={{ width: 55, textAlign: "right" }}>SG</div>
                </div>
                {courseCompletedWithNumbers.map((h, i) => {
                  if (h.noPutt) {
                    return (
                      <div
                        key={h.hole}
                        style={{
                          display: "flex",
                          padding: "7px 12px",
                          borderTop: i > 0 ? `1px solid ${COLORS.creamDim}11` : "none",
                          color: COLORS.creamDim,
                        }}
                      >
                        <div style={{ width: 40, color: COLORS.creamDim }}>{h.hole}</div>
                        <div style={{ flex: 1, fontStyle: "italic" }}>Chipped in</div>
                        <div style={{ width: 55, textAlign: "right" }}>—</div>
                        <div style={{ width: 55, textAlign: "right" }}>—</div>
                      </div>
                    );
                  }
                  const sg = sgForPutt(h.distanceFt, h.strokes);
                  return (
                    <div
                      key={h.hole}
                      style={{
                        display: "flex",
                        padding: "7px 12px",
                        borderTop: i > 0 ? `1px solid ${COLORS.creamDim}11` : "none",
                        color: COLORS.cream,
                      }}
                    >
                      <div style={{ width: 40, color: COLORS.creamDim }}>{h.hole}</div>
                      <div style={{ flex: 1 }}>
                        {fmt1(ftToUnit(h.distanceFt, units))}
                        {unitLabel}
                      </div>
                      <div style={{ width: 55, textAlign: "right", color: ragColor(ragStatusForPutts(h.strokes)) }}>
                        {h.strokes}
                      </div>
                      <div style={{ width: 55, textAlign: "right", color: sgRagColor(sg) }}>{formatSG(sg)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "practice" && (
        <div>
          {activeSaved && (
            <Card style={{ marginBottom: 10, border: `1px solid ${COLORS.sand}66` }}>
              <SectionLabel>Session in progress</SectionLabel>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, marginTop: 3 }}>
                Putt {activeSaved.putts.length + 1} of {activeSaved.puttCount}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
                {ftToUnitRound(activeSaved.puttMinFt, units)}-{ftToUnitRound(activeSaved.puttMaxFt, units)}
                {unitLabel} window
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={onResume}
                  style={{
                    flex: 1,
                    padding: "9px 0",
                    borderRadius: 8,
                    border: "none",
                    background: COLORS.sand,
                    color: COLORS.turfDark,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 16,
                    letterSpacing: 1,
                    cursor: "pointer",
                  }}
                >
                  RESUME
                </button>
                <button
                  onClick={onDiscard}
                  style={{
                    padding: "9px 14px",
                    borderRadius: 8,
                    border: `1px solid ${COLORS.creamDim}33`,
                    background: "transparent",
                    color: COLORS.creamDim,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  DISCARD
                </button>
              </div>
            </Card>
          )}

          <Card>
            <SectionLabel>Putts this session</SectionLabel>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {[10, 20, 30].map((n) => (
                <PillOption key={n} label={n} active={puttCount === n} onClick={() => setPuttCount(n)} />
              ))}
            </div>
          </Card>

          <Card style={{ marginTop: 10 }}>
            <SectionLabel>Distance window ({unitLabel}, {ftToUnitRound(3, units)}{unitLabel} min)</SectionLabel>
            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
              <NumberField
                label="MIN"
                value={ftToUnitRound(puttMinFt, units)}
                onChange={(v) => setPuttMinFt(Math.max(3, unitToFtRound(v, units)))}
              />
              <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
              <NumberField
                label="MAX"
                value={ftToUnitRound(puttMaxFt, units)}
                onChange={(v) => setPuttMaxFt(unitToFtRound(v, units))}
              />
            </div>
            {invalidRange && (
              <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
                Min can't go below {ftToUnitRound(3, units)}{unitLabel}, and max must be greater than min.
              </div>
            )}
          </Card>

          <button
            onClick={onStart}
            disabled={invalidRange}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: invalidRange ? `${COLORS.fairway}66` : COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 22,
              letterSpacing: 2,
              cursor: invalidRange ? "not-allowed" : "pointer",
            }}
          >
            START SESSION
          </button>
        </div>
      )}

      <div
        onClick={onViewAnalysis}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        View putting analysis
      </div>
    </div>
  );
}

function PuttLog({ putts, units }) {
  const unitLabel = shortUnitLabel(units);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ width: 32 }}>#</div>
        <div style={{ flex: 1 }}>DISTANCE</div>
        <div style={{ width: 55, textAlign: "right" }}>PUTTS</div>
        <div style={{ width: 55, textAlign: "right" }}>SG</div>
      </div>
      <div style={{ maxHeight: 150, overflowY: "auto" }}>
        {putts.map((p, i) => {
          const sg = sgForPutt(p.targetFt, p.strokes);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                padding: "7px 12px",
                borderTop: `1px solid ${COLORS.creamDim}11`,
                color: COLORS.cream,
              }}
            >
              <div style={{ width: 32, color: COLORS.creamDim }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                {fmt1(ftToUnit(p.targetFt, units))}
                {unitLabel}
              </div>
              <div style={{ width: 55, textAlign: "right", color: ragColor(ragStatusForPutts(p.strokes)) }}>{p.strokes}</div>
              <div style={{ width: 55, textAlign: "right", color: sgRagColor(sg) }}>{formatSG(sg)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PuttingPracticeScreen({ putts, puttCount, currentTarget, puttMinFt, puttMaxFt, onSubmit, runningAvg, onExit, units }) {
  const puttNum = putts.length + 1;
  const unitLabel = shortUnitLabel(units);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          PUTT {puttNum} OF {puttCount}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          SAVE &amp; EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            DISTANCE
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag }}>
            {ftToUnitRound(currentTarget, units)}
            <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
          </div>
        </div>

        <DistanceGauge
          min={ftToUnitRound(puttMinFt, units)}
          max={ftToUnitRound(puttMaxFt, units)}
          target={ftToUnitRound(currentTarget, units)}
          actual={null}
          unit={unitLabel}
        />

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>
            PUTTS TAKEN
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => onSubmit(n)}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 10,
                  border: `2px solid ${ragColor(ragStatusForPutts(n))}`,
                  background: "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 24,
                  cursor: "pointer",
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <StatBox
          label="AVG SG / PUTT"
          value={putts.length ? formatSG(avg(putts.map((p) => sgForPutt(p.targetFt, p.strokes)))) : "—"}
          valueColor={putts.length ? sgRagColor(avg(putts.map((p) => sgForPutt(p.targetFt, p.strokes)))) : COLORS.cream}
        />
        <StatBox label="AVG PUTTS" value={runningAvg.toFixed(2)} />
      </div>

      {putts.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>This session</SectionLabel>
          <div style={{ marginTop: 4 }}>
            <PuttLog putts={putts} units={units} />
          </div>
        </div>
      )}
    </div>
  );
}

function PuttingSummaryScreen({ putts, onNewSession, storageError, units, feedback, isOnCourse, chipIns }) {
  const avgStrokes = avg(putts.map((p) => p.strokes));
  const avgSG = avg(putts.map((p) => sgForPutt(p.targetFt, p.strokes)));
  const totalSG = putts.reduce((a, p) => a + sgForPutt(p.targetFt, p.strokes), 0);
  const onePutts = putts.filter((p) => p.strokes <= 1).length;
  const onePuttPct = (onePutts / putts.length) * 100;
  const threePutts = putts.filter((p) => p.strokes >= 3).length;
  const ftMade = putts.reduce((a, p) => {
    if (p.holedFromFt != null) return a + p.holedFromFt;
    return a + (p.strokes === 1 ? p.targetFt : 0);
  }, 0);
  const distMin = Math.min(...putts.map((p) => p.targetFt));
  const distMax = Math.max(...putts.map((p) => p.targetFt));
  const unitLabel = shortUnitLabel(units);

  return (
    <div>
      <SessionFeedbackBanner feedback={feedback} />
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            {isOnCourse ? "ROUND COMPLETE" : "SESSION COMPLETE"} — {putts.length} PUTTS · {ftToUnitRound(distMin, units)}-{ftToUnitRound(distMax, units)}
            {unitLabel.toUpperCase()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="TOTAL SG" value={formatSG(totalSG)} valueColor={sgRagColor(avgSG)} />
          <StatBox label="AVG SG / PUTT" value={formatSG(avgSG)} valueColor={sgRagColor(avgSG)} />
        </div>
        {isOnCourse ? (
          <>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="AVG PUTTS" value={avgStrokes.toFixed(2)} />
              <StatBox label="TOTAL PUTTS" value={putts.reduce((a, p) => a + p.strokes, 0)} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="1-PUTTS" value={`${onePutts} (${onePuttPct.toFixed(0)}%)`} valueColor={COLORS.fairwayLight} />
              <StatBox label="3+ PUTTS" value={threePutts} valueColor={threePutts > 0 ? COLORS.flag : COLORS.cream} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="FT MADE" value={`${fmt1(ftToUnit(ftMade, units))}${unitLabel}`} valueColor={COLORS.sand} />
            </div>
            {chipIns > 0 && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
                + {chipIns} hole{chipIns === 1 ? "" : "s"} chipped in, no putt taken
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="AVG PUTTS" value={avgStrokes.toFixed(2)} />
              <StatBox label="1-PUTT %" value={`${onePuttPct.toFixed(0)}%`} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="1-PUTTS" value={onePutts} valueColor={COLORS.fairwayLight} />
              <StatBox label="3+ PUTTS" value={threePutts} valueColor={threePutts > 0 ? COLORS.flag : COLORS.cream} />
            </div>
          </>
        )}
      </Card>

      <div style={{ marginTop: 10 }}>
        <SectionLabel>Full log</SectionLabel>
        <div style={{ marginTop: 4 }}>
          <PuttLog putts={putts} units={units} />
        </div>
      </div>

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this session to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onNewSession}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW SESSION
      </button>
    </div>
  );
}

function formatSG(sg) {
  const sign = sg > 0 ? "+" : "";
  return `${sign}${sg.toFixed(2)}`;
}

function CollapsibleSection({ title, count, children }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <SectionLabel>{title}</SectionLabel>
        <div
          onClick={() => setExpanded(!expanded)}
          className="no-print"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: COLORS.sand,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          {expanded ? "COLLAPSE" : `EXPAND (${count})`}
        </div>
      </div>
      {/* Always rendered for print (so a printed report includes full history), just visually hidden on screen until expanded. */}
      <div style={{ marginTop: 8, display: expanded ? "block" : "none" }} className={expanded ? "" : "print-only"}>
        {children}
      </div>
    </div>
  );
}

function SendReportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="no-print"
      style={{
        width: "100%",
        marginTop: 18,
        padding: "13px 0",
        borderRadius: 12,
        border: `1px solid ${COLORS.sand}66`,
        background: "transparent",
        color: COLORS.sand,
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 18,
        letterSpacing: 1.5,
        cursor: "pointer",
      }}
    >
      SEND REPORT
    </button>
  );
}

function PrintHeader({ title, timescale }) {
  const scaleLabel = TIMESCALES.find((t) => t.key === timescale)?.label || "ALL";
  return (
    <div className="print-only" style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24 }}>THE PRACTICE APP</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, marginTop: 2 }}>
        {title} — {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} — Period: {scaleLabel}
      </div>
    </div>
  );
}

// Print flow: rather than relying on window.print() capturing whatever's currently visible,
// this flips a "printMode" flag that makes the component render BOTH Insights and Graphs
// content together (not just whichever tab is selected), waits two animation frames for the
// browser to actually lay that out, then prints. The double-wait matters — Recharts measures its
// own container size to draw a chart, and a chart that was never actually visible on screen
// (e.g. sitting in a display:none block waiting for print) reports zero size and renders blank.
// Making the content genuinely visible first, even briefly, avoids that entirely.
function usePrintMode() {
  const [printMode, setPrintMode] = useState(false);
  useEffect(() => {
    if (!printMode) return;
    let raf2;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.print();
        setPrintMode(false);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [printMode]);
  return [printMode, () => setPrintMode(true)];
}

function DeleteConfirmBar({ onConfirm, onCancel, style }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        borderRadius: 8,
        background: `${COLORS.flag}1a`,
        border: `1px solid ${COLORS.flag}55`,
        ...style,
      }}
    >
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.cream }}>Delete this session?</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onConfirm}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: COLORS.flag,
            color: COLORS.cream,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          DELETE
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}

// Wraps a card-style row so it can be deleted either by tapping the × control or by
// swiping left on touch devices. Either path reveals an inline confirm step —
// nothing is deleted until the person explicitly confirms.
function SwipeToDelete({ onDelete, children, style }) {
  const [confirming, setConfirming] = useState(false);
  const touchStartX = useRef(null);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -40) setConfirming(true);
    touchStartX.current = null;
  }

  if (confirming) {
    return (
      <DeleteConfirmBar
        onConfirm={() => {
          setConfirming(false);
          onDelete();
        }}
        onCancel={() => setConfirming(false)}
        style={{ marginBottom: 12, ...style }}
      />
    );
  }

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={{ position: "relative" }}>
      {children}
      <div
        onClick={() => setConfirming(true)}
        title="Delete"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          width: 20,
          height: 20,
          borderRadius: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ×
      </div>
    </div>
  );
}

// ===== On-course putting tracker =====

function CourseRoundRow({ session, isFirst, onDelete, onView }) {
  const [confirming, setConfirming] = useState(false);
  const touchStartX = useRef(null);
  const stats = courseRoundStats(session);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -40) setConfirming(true);
    touchStartX.current = null;
  }

  if (confirming) {
    return (
      <div style={{ padding: "6px 8px" }}>
        <DeleteConfirmBar
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          onCancel={() => setConfirming(false)}
        />
      </div>
    );
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={onView}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "7px 12px",
        borderTop: isFirst ? "none" : `1px solid ${COLORS.creamDim}11`,
        color: COLORS.cream,
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1.3, color: COLORS.creamDim }}>
        {new Date(session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
      </div>
      <div style={{ width: 60, textAlign: "right", color: sgRagColor(stats.avgSG) }}>{formatSG(stats.totalSG)}</div>
      <div style={{ width: 55, textAlign: "right" }}>{stats.totalPutts}</div>
      <div style={{ width: 60, textAlign: "right" }}>{stats.ftMade}ft</div>
      <div
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        title="Delete"
        style={{
          width: 20,
          textAlign: "right",
          cursor: "pointer",
          color: COLORS.creamDim,
          fontSize: 14,
        }}
      >
        ×
      </div>
    </div>
  );
}

function PuttBucketRow({ bucket }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: COLORS.cream }}>{bucket.label}ft</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          {bucket.count} putts · {bucket.avgStrokes.toFixed(2)} avg
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: sgRagColor(bucket.avgSG) }}>
          {formatSG(bucket.avgSG)}
        </div>
        {bucket.improvement !== null && bucket.improvement !== undefined && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: bucket.improvement > 0 ? COLORS.fairwayLight : COLORS.flag,
            }}
          >
            {bucket.improvement > 0 ? "▲" : "▼"} {Math.abs(bucket.improvement).toFixed(2)} SG
          </div>
        )}
      </div>
    </div>
  );
}

function PuttInsightCard({ title, subtitle, items, emptyText }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, padding: "6px 0" }}>
            {emptyText}
          </div>
        ) : (
          items.map((b, i) => (
            <div key={b.label} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <PuttBucketRow bucket={b} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function FeetPicker({ min, max, onMin, onMax, onPreset, activePresetLabel }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {FEET_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onPreset(p)}
            style={{
              padding: "7px 11px",
              borderRadius: 8,
              border: activePresetLabel === p.label ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: activePresetLabel === p.label ? COLORS.fairway : "transparent",
              color: activePresetLabel === p.label ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <NumberField label="MIN FT" value={min} onChange={onMin} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 14 }}>—</div>
        <NumberField label="MAX FT" value={max} onChange={onMax} />
      </div>
    </div>
  );
}

function PuttingAnalysisHub({ history, loaded, onDeleteSession, units }) {
  const [subTab, setSubTab] = useState("practice"); // practice | course

  const practiceHistory = history.filter((s) => s.type !== "course");
  const courseHistory = history.filter((s) => s.type === "course");

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setSubTab("practice")}
          style={{
            flex: 1,
            padding: "9px 4px",
            borderRadius: 8,
            border: subTab === "practice" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: subTab === "practice" ? COLORS.fairway : "transparent",
            color: subTab === "practice" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          PRACTICE
        </button>
        <button
          onClick={() => setSubTab("course")}
          style={{
            flex: 1,
            padding: "9px 4px",
            borderRadius: 8,
            border: subTab === "course" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: subTab === "course" ? COLORS.fairway : "transparent",
            color: subTab === "course" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          ON COURSE
        </button>
      </div>

      {subTab === "practice" && <PuttingAnalysisBody history={practiceHistory} loaded={loaded} onDeleteSession={onDeleteSession} units={units} />}
      {subTab === "course" && <OnCourseAnalysisBody history={courseHistory} loaded={loaded} onDeleteSession={onDeleteSession} units={units} />}
    </div>
  );
}

function OnCourseAnalysisBody({ history, loaded, onDeleteSession, units }) {
  const [timescale, setTimescale] = useState("all");
  const [printMode, triggerPrint] = usePrintMode();
  const [selectedRound, setSelectedRound] = useState(null);

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading rounds…</div>;
  }

  const filtered = filterByTimescale(history, timescale);

  if (filtered.length === 0) {
    return (
      <div>
        <TimescalePicker value={timescale} onChange={setTimescale} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No on-course rounds in this window yet. Track a round to see it here.
        </div>
      </div>
    );
  }

  const trend = courseRoundTrendData(filtered);
  const totalPutts = trend.reduce((a, r) => a + r.totalPutts, 0);
  const totalFtMade = trend.reduce((a, r) => a + r.ftMade, 0);
  const totalSG = trend.reduce((a, r) => a + r.totalSG, 0);
  const avgSGPerRound = totalSG / trend.length;
  const avgSGPerPutt = totalSG / totalPutts;
  const analysis = computePuttingAnalysis(filtered);

  return (
    <div>
      <PrintHeader title="Putting Analysis — On Course" timescale={timescale} />
      <TimescalePicker value={timescale} onChange={setTimescale} />

      <Card style={{ marginBottom: 14 }}>
        <SectionLabel>Overview</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
          vs PGA Tour baseline
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="ROUNDS" value={trend.length} />
          <StatBox label="TOTAL PUTTS" value={totalPutts} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="AVG SG / ROUND" value={formatSG(avgSGPerRound)} valueColor={sgRagColor(avgSGPerPutt)} />
          <StatBox label="AVG SG / PUTT" value={formatSG(avgSGPerPutt)} valueColor={sgRagColor(avgSGPerPutt)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="AVG FT MADE / ROUND" value={`${(totalFtMade / trend.length).toFixed(0)}ft`} />
        </div>
        {analysis && (
          <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
            {Math.abs(analysis.trendDelta) < 0.03 ? (
              <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
            ) : analysis.trendDelta > 0 ? (
              <span style={{ color: COLORS.fairwayLight }}>
                ▲ Trending better — SG up {analysis.trendDelta.toFixed(2)} from start to end of period
              </span>
            ) : (
              <span style={{ color: COLORS.flag }}>
                ▼ Trending worse — SG down {Math.abs(analysis.trendDelta).toFixed(2)} from start to end of period
              </span>
            )}
          </div>
        )}
      </Card>

      {analysis && (
        <>
          <PuttInsightCard
            title="Strengths"
            subtitle="Distance bands where you gain the most strokes on the PGA Tour baseline"
            items={analysis.strengths}
            emptyText="Not enough putts in any single band yet."
          />

          <PuttInsightCard
            title="Focus areas"
            subtitle="Distance bands where you lose the most strokes to the PGA Tour baseline"
            items={analysis.weaknesses}
            emptyText="Not enough putts in any single band yet."
          />

          <PuttInsightCard
            title="Biggest improvements"
            subtitle="Bands where strokes gained has risen most from earlier to later rounds"
            items={analysis.mostImproved}
            emptyText="Not enough repeat putts in a single band to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <PuttInsightCard
              title="Slipping"
              subtitle="Bands where strokes gained has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}
        </>
      )}

      <Card style={{ marginBottom: 14 }}>
        <SectionLabel>Strokes gained per round</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Total SG for each round, vs PGA Tour baseline
        </div>
        <div style={{ height: 200, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: `${COLORS.creamDim}33` }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: `${COLORS.creamDim}33` }}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
              <Tooltip content={<ChartTooltip suffix=" SG" />} />
              <Line
                type="monotone"
                dataKey="totalSG"
                stroke={COLORS.flag}
                strokeWidth={2}
                dot={{ fill: COLORS.flag, r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <SectionLabel>Feet of putts made per round</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Combined distance of every putt holed
        </div>
        <div style={{ height: 200, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: `${COLORS.creamDim}33` }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: `${COLORS.creamDim}33` }}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip suffix="ft" />} />
              <Bar dataKey="ftMade" radius={[4, 4, 0, 0]} fill={COLORS.sand} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <CollapsibleSection title="All rounds" count={filtered.length}>
        <div
          style={{
            border: `1px solid ${COLORS.creamDim}22`,
            borderRadius: 10,
            overflow: "hidden",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
            <div style={{ flex: 1.3 }}>DATE</div>
            <div style={{ width: 60, textAlign: "right" }}>SG</div>
            <div style={{ width: 55, textAlign: "right" }}>PUTTS</div>
            <div style={{ width: 60, textAlign: "right" }}>FT MADE</div>
            <div style={{ width: 20 }} />
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {[...filtered]
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map((s, i) => (
                <CourseRoundRow key={s.id} session={s} isFirst={i === 0} onDelete={() => onDeleteSession(s.id)} onView={() => setSelectedRound(s)} />
              ))}
          </div>
        </div>
      </CollapsibleSection>

      <SendReportButton onClick={triggerPrint} />

      {selectedRound && (
        <RoundSummaryModal session={selectedRound} units={units} onClose={() => setSelectedRound(null)} />
      )}
    </div>
  );
}

function PuttingAnalysisBody({ history, loaded, onDeleteSession }) {
  const [tab, setTab] = useState("insights");
  const [printMode, triggerPrint] = usePrintMode();
  const [timescale, setTimescale] = useState("all");
  const [minFt, setMinFt] = useState(0);
  const [maxFt, setMaxFt] = useState(100);
  const [activePreset, setActivePreset] = useState("All");

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);
  const analysis = computePuttingAnalysis(filtered);
  const trend = puttingSessionTrendData(filtered, minFt, maxFt);
  const graphBuckets = puttingBucketChartData(filtered, minFt, maxFt);
  const hasGraphData = trend.length > 0;

  function handlePreset(p) {
    setActivePreset(p.label);
    setMinFt(p.min);
    setMaxFt(p.max);
  }

  function handleManualChange(setter) {
    return (v) => {
      setActivePreset(null);
      setter(v);
    };
  }

  return (
    <div>
      <PrintHeader title="Putting Analysis — Practice" timescale={timescale} />
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => setTab("insights")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "insights" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "insights" ? COLORS.fairway : "transparent",
            color: tab === "insights" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          INSIGHTS
        </button>
        <button
          onClick={() => setTab("graphs")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "graphs" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "graphs" ? COLORS.fairway : "transparent",
            color: tab === "graphs" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          GRAPHS
        </button>
      </div>

      <TimescalePicker value={timescale} onChange={setTimescale} />


      {!analysis && (
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No sessions in this window yet. Log a putting session to see your analysis here.
        </div>
      )}

      {analysis && (tab === "insights" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              vs PGA Tour baseline
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={analysis.sessionCount} />
              <StatBox label="PUTTS" value={analysis.puttCount} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="AVG SG / PUTT" value={formatSG(analysis.overallAvgSG)} valueColor={sgRagColor(analysis.overallAvgSG)} />
              <StatBox label="AVG PUTTS" value={analysis.overallAvgStrokes.toFixed(2)} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="1-PUTT %" value={`${analysis.onePuttPct.toFixed(0)}%`} />
              <StatBox label="3+ PUTT %" value={`${analysis.threePuttPct.toFixed(0)}%`} valueColor={analysis.threePuttPct > 0 ? COLORS.flag : COLORS.cream} />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 0.03 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — SG up {analysis.trendDelta.toFixed(2)} from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — SG down {Math.abs(analysis.trendDelta).toFixed(2)} from start to end of period
                </span>
              )}
            </div>
          </Card>

          <PuttInsightCard
            title="Strengths"
            subtitle="Distance bands where you gain the most strokes on the PGA Tour baseline"
            items={analysis.strengths}
            emptyText="Not enough putts in any single band yet."
          />

          <PuttInsightCard
            title="Focus areas"
            subtitle="Distance bands where you lose the most strokes to the PGA Tour baseline"
            items={analysis.weaknesses}
            emptyText="Not enough putts in any single band yet."
          />

          <PuttInsightCard
            title="Biggest improvements"
            subtitle="Bands where strokes gained has risen most from earlier to later sessions"
            items={analysis.mostImproved}
            emptyText="Not enough repeat putts in a single band to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <PuttInsightCard
              title="Slipping"
              subtitle="Bands where strokes gained has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.length === 0 ? (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim }}>
                No sessions in this window.
              </div>
            ) : (
              filtered.map((s) => {
                const sessionAvgSG = avg(s.putts.map((p) => sgForPutt(p.targetFt, p.strokes)));
                return (
                  <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                    <Card style={{ marginBottom: 12 }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                        {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        {"  ·  "}
                        {s.puttCount} putts · {s.puttMinFt}-{s.puttMaxFt}ft
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                        <StatBox label="AVG SG / PUTT" value={formatSG(sessionAvgSG)} valueColor={sgRagColor(sessionAvgSG)} />
                        <StatBox label="AVG PUTTS" value={s.avgStrokes.toFixed(2)} />
                      </div>
                    </Card>
                  </SwipeToDelete>
                );
              })
            )}
          </CollapsibleSection>
        </>
      )}

      {analysis && (tab === "graphs" || printMode) && (
        <div>
          <FeetPicker
            min={minFt}
            max={maxFt}
            onMin={handleManualChange(setMinFt)}
            onMax={handleManualChange(setMaxFt)}
            onPreset={handlePreset}
            activePresetLabel={activePreset}
          />

          {!hasGraphData && (
            <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
              No putts match this timescale + distance combination yet.
            </div>
          )}

          {hasGraphData && (
            <>
              <Card style={{ marginBottom: 14 }}>
                <SectionLabel>Strokes gained over time</SectionLabel>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
                  Average SG per putt per session, vs PGA Tour baseline, {minFt}-{maxFt}ft putts only
                </div>
                <div style={{ height: 200, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                      <Tooltip content={<ChartTooltip suffix=" SG" />} />
                      <Line
                        type="monotone"
                        dataKey="avgSG"
                        stroke={COLORS.flag}
                        strokeWidth={2}
                        dot={{ fill: COLORS.flag, r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <SectionLabel>Strokes gained by distance band</SectionLabel>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
                  Bands within {minFt}-{maxFt}ft, this timescale
                </div>
                <div style={{ height: 220, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={graphBuckets} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                      <Tooltip content={<ChartTooltip suffix=" SG" />} />
                      <Bar dataKey="avgSG" radius={[4, 4, 0, 0]}>
                        {graphBuckets.map((b, i) => (
                          <Bar key={i} dataKey="avgSG" fill={sgRagColor(b.avgSG)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    marginTop: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: COLORS.creamDim,
                  }}
                >
                  <span>
                    <span style={{ color: COLORS.fairwayLight }}>●</span> ≥0 (tour avg or better)
                  </span>
                  <span>
                    <span style={{ color: COLORS.sand }}>●</span> ≥-0.15
                  </span>
                  <span>
                    <span style={{ color: COLORS.flag }}>●</span> &lt;-0.15
                  </span>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function InfoToggle({ label, text }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: COLORS.sand,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
          display: "inline-block",
        }}
      >
        ⓘ {label}
      </div>
      {open && (
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: COLORS.creamDim,
            marginTop: 6,
            lineHeight: 1.6,
            background: COLORS.turfDark,
            border: `1px solid ${COLORS.creamDim}22`,
            borderRadius: 8,
            padding: 10,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

const BASELINE_SKILL_ORDER = ["tour", "scratch", "5", "10", "15", "20", "25", "30"]; // best to worst

function suggestBaselineFromHandicap(handicap) {
  const n = parseFloat(handicap);
  if (isNaN(n)) return "tour";
  let natural;
  if (n <= 0) natural = "scratch";
  else if (n <= 7) natural = "5";
  else if (n <= 12) natural = "10";
  else if (n <= 17) natural = "15";
  else if (n <= 22) natural = "20";
  else if (n <= 27) natural = "25";
  else natural = "30";
  // Suggest the next tier up from where the handicap actually sits — a small aspirational nudge
  // rather than a dead-on match. Clamped at "tour" for scratch/plus players since there's nothing better.
  const idx = BASELINE_SKILL_ORDER.indexOf(natural);
  return BASELINE_SKILL_ORDER[Math.max(0, idx - 1)];
}

export function ProfileSetupWizard({ onComplete }) {
  const [step, setStep] = useState("name"); // name | handicap | device | device-method | baseline
  const [name, setName] = useState("");
  const [handicap, setHandicap] = useState("");
  const [device, setDevice] = useState(null); // "yes" | "no"
  const [deviceMethod, setDeviceMethod] = useState(null); // "distance" | "rating"
  const [baseline, setBaseline] = useState("tour");

  function handleNameNext() {
    if (!name.trim()) return;
    setStep("handicap");
  }

  function handleHandicapNext() {
    setBaseline(suggestBaselineFromHandicap(handicap));
    setStep("device");
  }

  function handleDeviceYes() {
    setDevice("yes");
    setStep("baseline");
  }

  function handleDeviceNo() {
    setDevice("no");
    setStep("device-method");
  }

  function handleDeviceMethod(method) {
    setDeviceMethod(method);
    setStep("baseline");
  }

  function handleBaselineConfirm() {
    const rangeTrackingMode = device === "yes" ? "distance" : deviceMethod;
    onComplete({
      name,
      handicap: handicap.trim() === "" ? null : handicap,
      rangeTrackingMode,
      baselineHandicap: baseline,
    });
  }

  const cardStyle = { maxWidth: 420, margin: "0 auto" };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.turfDark,
        color: COLORS.cream,
        padding: "40px 16px",
        boxSizing: "border-box",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <style>{FONT_IMPORT}</style>
      <div style={cardStyle}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 14 }}>
          {{ name: "STEP 1 OF 4", handicap: "STEP 2 OF 4", device: "STEP 3 OF 4", "device-method": "STEP 3 OF 4", baseline: "STEP 4 OF 4" }[step]}
        </div>

        {step === "name" && (
          <Card>
            <SectionLabel>What's your name?</SectionLabel>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleNameNext()}
              placeholder="Your name"
              autoFocus
              style={{
                width: "100%",
                marginTop: 10,
                background: COLORS.turfDark,
                border: `1px solid ${COLORS.creamDim}33`,
                borderRadius: 8,
                color: COLORS.cream,
                fontFamily: "'Inter', sans-serif",
                fontSize: 16,
                padding: "10px 12px",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={handleNameNext}
              disabled={!name.trim()}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: !name.trim() ? `${COLORS.fairway}66` : COLORS.fairway,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: !name.trim() ? "not-allowed" : "pointer",
              }}
            >
              CONTINUE
            </button>
          </Card>
        )}

        {step === "handicap" && (
          <Card>
            <SectionLabel>What's your handicap?</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
              Helps suggest a sensible starting point on the next screen — you can leave this blank.
            </div>
            <input
              type="number"
              inputMode="decimal"
              value={handicap}
              onChange={(e) => setHandicap(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleHandicapNext()}
              placeholder="e.g. 14"
              autoFocus
              style={{
                width: "100%",
                marginTop: 10,
                background: COLORS.turfDark,
                border: `1px solid ${COLORS.creamDim}33`,
                borderRadius: 8,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 20,
                padding: "10px 12px",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={handleHandicapNext}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: COLORS.fairway,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              {handicap.trim() ? "CONTINUE" : "SKIP — I DON'T TRACK ONE"}
            </button>
          </Card>
        )}

        {step === "device" && (
          <Card>
            <SectionLabel>Setup</SectionLabel>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
              Do you have access to a launch monitor or distance measuring device?
            </div>
            <InfoToggle
              label="What counts?"
              text="This can also include range tracking facilities such as TopTracer or Trackman Range."
            />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                onClick={handleDeviceYes}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 10,
                  border: "none",
                  background: COLORS.flag,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 18,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                YES
              </button>
              <button
                onClick={handleDeviceNo}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.creamDim}33`,
                  background: "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 18,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                NO
              </button>
            </div>
          </Card>
        )}

        {step === "device-method" && (
          <Card>
            <SectionLabel>No device? No problem</SectionLabel>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
              Would you still like to enter a distance for each shot (paced off or estimated), or rate
              your own strike out of 5 instead?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              <button
                onClick={() => handleDeviceMethod("distance")}
                style={{
                  padding: "12px 0",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.creamDim}33`,
                  background: "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                ENTER A DISTANCE
              </button>
              <button
                onClick={() => handleDeviceMethod("rating")}
                style={{
                  padding: "12px 0",
                  borderRadius: 10,
                  border: "none",
                  background: COLORS.flag,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                RATE EACH SHOT OUT OF 5
              </button>
            </div>
            <div
              onClick={() => setStep("device")}
              style={{
                textAlign: "center",
                marginTop: 12,
                color: COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              BACK
            </div>
          </Card>
        )}

        {step === "baseline" && (
          <Card>
            <SectionLabel>Choose your strokes gained baseline</SectionLabel>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
              Every shot you log gets compared to this skill level.
            </div>
            <InfoToggle
              label="What's this?"
              text="Strokes gained measures each shot against how a player at your chosen level would be expected to do from the same spot. Pick PGA Tour to compare yourself against professionals, or a handicap level to compare against golfers closer to your own game — your numbers will look very different depending on which you pick, but neither is 'more correct,' just a different yardstick."
            />
            {handicap.trim() && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand, marginTop: 10 }}>
                Based on the handicap you entered, we've suggested {BASELINE_OPTIONS.find((b) => b.key === baseline)?.label} below — tap any option to change it, then confirm.
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 14 }}>
              {BASELINE_OPTIONS.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setBaseline(b.key)}
                  style={{
                    padding: "9px 2px",
                    borderRadius: 8,
                    border: baseline === b.key ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                    background: baseline === b.key ? COLORS.fairway : "transparent",
                    color: baseline === b.key ? COLORS.cream : COLORS.creamDim,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    letterSpacing: 0.3,
                    cursor: "pointer",
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleBaselineConfirm}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: COLORS.flag,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              CONFIRM — {BASELINE_OPTIONS.find((b) => b.key === baseline)?.label}
            </button>
          </Card>
        )}

        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 12, lineHeight: 1.5 }}>
          Everything here can be changed later in Settings.
        </div>
      </div>
    </div>
  );
}
