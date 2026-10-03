import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = path.join(ROOT, 'business-dashboard', 'reports', 'clarity', 'summary.json');
const API = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';

for (const line of fs.readFileSync(path.join(import.meta.dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const index = line.indexOf('=');
  if (index > 0 && !process.env[line.slice(0, index)]) {
    process.env[line.slice(0, index)] = line.slice(index + 1);
  }
}

async function pull(dimensions = []) {
  const url = new URL(API);
  url.searchParams.set('numOfDays', '3');
  dimensions.forEach((dimension, index) => url.searchParams.set(`dimension${index + 1}`, dimension));
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.CLARITY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Clarity export failed (${response.status}): ${await response.text()}`);
  return response.json();
}

function metric(data, name) {
  return data.find((item) => item.metricName === name)?.information || [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function aggregate(rows, key, value) {
  const totals = new Map();
  for (const row of rows) {
    const label = row[key] || 'Unknown';
    totals.set(label, (totals.get(label) || 0) + number(row[value]));
  }
  return [...totals.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function aggregateHumanTraffic(rows, key) {
  const totals = new Map();
  for (const row of rows) {
    const label = row[key] || 'Unknown';
    const sessions = Math.max(0, number(row.totalSessionCount) - number(row.totalBotSessionCount));
    totals.set(label, (totals.get(label) || 0) + sessions);
  }
  return [...totals.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

function pageGroup(url) {
  const pathname = new URL(url, 'https://literacyarcade.com').pathname.toLowerCase();
  if (pathname.includes('plus-subscriptions')) return 'pricing';
  if (pathname.includes('assessment') || pathname.includes('knowledge-check') || pathname.includes('orf-fluency')) return 'assessments';
  if (pathname.includes('teacher-dashboard') || pathname.includes('teacher-tools')) return 'teacher';
  if (/(arkansas|alabama|texas|south-carolina|new-hampshire|west-virginia|georgia|utah|wyoming|louisiana|missouri)/.test(pathname)) return 'state';
  return null;
}

const [base, urls, geography, sources] = await Promise.all([
  pull(),
  pull(['URL']),
  pull(['Device', 'Country']),
  pull(['Source']),
]);

const baseTraffic = metric(base, 'Traffic')[0] || {};
const urlTraffic = metric(urls, 'Traffic');
const sourceTraffic = metric(sources, 'Traffic');
const geographyTraffic = metric(geography, 'Traffic');
const totalSessions = number(baseTraffic.totalSessionCount);
const botSessions = number(baseTraffic.totalBotSessionCount);
const humanSessions = Math.max(0, totalSessions - botSessions);

const topPages = urlTraffic
  .map((row) => ({
    url: row.Url,
    sessions: Math.max(0, number(row.totalSessionCount) - number(row.totalBotSessionCount)),
  }))
  .filter((row) => row.url)
  .sort((a, b) => b.sessions - a.sessions);

const businessAreaTraffic = { pricing: 0, assessments: 0, teacher: 0, state: 0 };
for (const page of topPages) {
  const group = pageGroup(page.url);
  if (group) businessAreaTraffic[group] += page.sessions;
}

const summary = {
  source: 'clarity-export-api',
  status: 'limited',
  generatedAt: new Date().toISOString(),
  windowDays: 3,
  limitation: 'The API only exposes the previous 1–3 days and cannot filter the tutoring-tablet Clarity user ID 1t2n1al. These figures are directional/raw and are not used for customer-behavior conclusions.',
  tutoringTablet: {
    clarityUserId: '1t2n1al',
    excludedFromConclusions: true,
    optOutDeployed: '2026-10-02',
  },
  humanSessions,
  botSessions,
  distinctUsers: number(baseTraffic.distinctUserCount),
  pagesPerSession: number(baseTraffic.pagesPerSessionPercentage),
  topPages: topPages.slice(0, 12),
  sources: aggregateHumanTraffic(sourceTraffic, 'Source').slice(0, 10),
  countries: aggregateHumanTraffic(geographyTraffic, 'Country').slice(0, 10),
  devices: aggregateHumanTraffic(geographyTraffic, 'Device'),
  businessAreaTraffic,
  friction: {
    deadClickPct: number(metric(base, 'DeadClickCount')[0]?.sessionsWithMetricPercentage),
    rageClickPct: number(metric(base, 'RageClickCount')[0]?.sessionsWithMetricPercentage),
    quickBackPct: number(metric(base, 'QuickbackClick')[0]?.sessionsWithMetricPercentage),
  },
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
