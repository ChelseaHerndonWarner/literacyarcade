import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT_DIR = path.join(ROOT, 'business-dashboard', 'reports', 'firebase');
const RAW_EXPORT = path.join(ROOT, 'business-dashboard', 'exports', 'user-engagement-export-2026-10-02.csv');
const EXCLUDED_EMAILS = new Set(JSON.parse(
  fs.readFileSync(path.join(ROOT, 'local-config', 'excluded-accounts.json'), 'utf8'),
).map((email) => email.trim().toLowerCase()));
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const FAMILY_PRICE_IDS = new Set(['price_1TssAC3PzX3bHrbQg4qIhxOH']);

function loadEnv(file) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0 && !process.env[line.slice(0, index)]) {
      process.env[line.slice(0, index)] = line.slice(index + 1);
    }
  }
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function priceIds(subscription) {
  const ids = new Set();
  const add = (value) => {
    const id = typeof value === 'string' ? value : value?.id;
    if (id?.startsWith('price_')) ids.add(id);
  };
  add(subscription.price);
  add(subscription.priceId);
  add(subscription.plan?.id);
  add(subscription.items?.data?.[0]?.price);
  add(subscription.items?.[0]?.price);
  for (const price of subscription.prices || []) add(price);
  return [...ids];
}

function subscriptionCategory(subscription) {
  const ids = priceIds(subscription);
  const metadataPlan = subscription.literacyArcadePlan || subscription.metadata?.literacyArcadePlan;
  const itemPrice = subscription.items?.data?.[0]?.price || subscription.items?.[0]?.price || subscription.price;
  const interval = itemPrice?.recurring?.interval || subscription.plan?.interval;
  if (metadataPlan === 'family' || ids.some((id) => FAMILY_PRICE_IDS.has(id))) return 'stripePlusFamily';
  return interval === 'month' ? 'stripePlusMonthly' : 'stripePlusAnnual';
}

async function getAllAuthUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

loadEnv(path.join(import.meta.dirname, '.env'));
admin.initializeApp({ credential: admin.credential.applicationDefault() });

const db = admin.firestore();
const auth = admin.auth();
const now = new Date();
const sevenDaysAgo = new Date(now.valueOf() - 7 * 86400000);
const fourteenDaysAgo = new Date(now.valueOf() - 14 * 86400000);
const thirtyDaysAgo = new Date(now.valueOf() - 30 * 86400000);

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com',
  'aol.com', 'live.com', 'msn.com', 'proton.me', 'protonmail.com',
]);

function emailDomainCategory(email) {
  const domain = email.split('@')[1] || '';
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return 'personal';
  if (/\.edu$|(^|\.)k12\.|school|schools|district|academy|college|university|education/.test(domain)) {
    return 'likelySchoolEducation';
  }
  return 'unknownOther';
}

try {
  const [authUsers, userDocs, activities, collections, customerDocs] = await Promise.all([
    getAllAuthUsers(auth),
    db.collection('users').get(),
    db.collectionGroup('activities').get(),
    db.collectionGroup('collections').get(),
    db.collection('customers').get(),
  ]);

  const firestoreUsers = new Map(userDocs.docs.map((doc) => [doc.id, doc.data()]));
  const activityByUser = new Map();
  const collectionByUser = new Map();
  const activityTypes = new Map();

  for (const doc of activities.docs) {
    const data = doc.data();
    const uid = data.userId || doc.ref.parent.parent?.id;
    if (!uid) continue;
    const list = activityByUser.get(uid) || [];
    list.push(data);
    activityByUser.set(uid, list);
  }
  for (const doc of collections.docs) {
    const data = doc.data();
    const uid = data.userId || doc.ref.parent.parent?.id;
    if (!uid) continue;
    const list = collectionByUser.get(uid) || [];
    list.push(data);
    collectionByUser.set(uid, list);
  }

  const stripeByUid = new Map();
  for (const customer of customerDocs.docs) {
    const subscriptions = await customer.ref.collection('subscriptions').get();
    const active = subscriptions.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((subscription) => ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status));
    if (active.length) stripeByUid.set(customer.id, active);
  }

  const rows = authUsers.map((user) => {
    const profile = firestoreUsers.get(user.uid) || {};
    const email = (user.email || profile.email || '').trim().toLowerCase();
    const createdAt = toDate(user.metadata.creationTime || profile.createdAt);
    const lastSignInAt = toDate(user.metadata.lastSignInTime || profile.lastLoginAt);
    const lastSeenAt = toDate(profile.lastSeenAt);
    const saved = activityByUser.get(user.uid) || [];
    const userCollections = collectionByUser.get(user.uid) || [];
    const subscriptions = stripeByUid.get(user.uid) || [];
    const stripeCategory = subscriptions.length
      ? subscriptionCategory(subscriptions.sort((a, b) => Number(b.created || 0) - Number(a.created || 0))[0])
      : null;
    const plan = profile.plan === 'family' ? 'family' : profile.plan === 'plus' ? 'plus' : 'free';
    const manualCategory = !stripeCategory && plan === 'family'
      ? 'manualPlusFamily'
      : !stripeCategory && plan === 'plus' ? 'manualPlus' : null;
    const mostRecentActivity = [...saved, ...userCollections]
      .flatMap((item) => [toDate(item.updatedAt), toDate(item.createdAt)])
      .filter(Boolean)
      .sort((a, b) => b - a)[0] || null;
    const returned = Boolean(createdAt && lastSignInAt && lastSignInAt - createdAt > 5 * 60000);
    const engaged = returned || saved.length > 0 || userCollections.length > 0;
    const mostRecentMeasuredSignal = [lastSignInAt, lastSeenAt, mostRecentActivity]
      .filter(Boolean)
      .sort((a, b) => b - a)[0] || null;
    const mostRecentPostSignupSignal = [lastSignInAt, lastSeenAt, mostRecentActivity]
      .filter((date) => date && createdAt && date - createdAt > 5 * 60000)
      .sort((a, b) => b - a)[0] || null;

    return {
      uid: user.uid,
      email,
      displayName: user.displayName || profile.displayName || '',
      excluded: EXCLUDED_EMAILS.has(email),
      createdAt,
      lastSignInAt,
      lastSeenAt,
      plan,
      paidCategory: stripeCategory || manualCategory,
      savedCount: saved.length,
      collectionCount: userCollections.length,
      mostRecentActivity,
      mostRecentMeasuredSignal,
      mostRecentPostSignupSignal,
      returned,
      engaged,
      emailDomainCategory: emailDomainCategory(email),
      activityTypes: saved.map((item) => item.toolType || item.activityType || 'unknown'),
    };
  });

  const eligible = rows.filter((row) => !row.excluded);
  const recent7 = eligible.filter((row) => row.createdAt >= sevenDaysAgo);
  const recent14 = eligible.filter((row) => row.createdAt >= fourteenDaysAgo);
  const recent30 = eligible.filter((row) => row.createdAt >= thirtyDaysAgo);
  for (const row of eligible) {
    for (const type of row.activityTypes) activityTypes.set(type, (activityTypes.get(type) || 0) + 1);
  }

  const paidAccess = {
    stripePlusMonthly: eligible.filter((row) => row.paidCategory === 'stripePlusMonthly').length,
    stripePlusAnnual: eligible.filter((row) => row.paidCategory === 'stripePlusAnnual').length,
    stripePlusFamily: eligible.filter((row) => row.paidCategory === 'stripePlusFamily').length,
    manualPlus: eligible.filter((row) => row.paidCategory === 'manualPlus').length,
    manualPlusFamily: eligible.filter((row) => row.paidCategory === 'manualPlusFamily').length,
  };
  paidAccess.total = Object.values(paidAccess).reduce((sum, value) => sum + value, 0);
  const paidUsers = eligible.filter((row) => Boolean(row.paidCategory));
  const stripePaidUsers = paidUsers.filter((row) => row.paidCategory.startsWith('stripe'));
  const stateFundedPaidUsers = paidUsers.filter((row) => row.paidCategory.startsWith('manual'));
  const paidEngagementGroup = (group) => ({
    total: group.length,
    measurableEngagement: group.filter((row) => row.engaged).length,
    savedAtLeast1: group.filter((row) => row.savedCount >= 1).length,
    savedAtLeast3: group.filter((row) => row.savedCount >= 3).length,
    totalSavedActivities: group.reduce((sum, row) => sum + row.savedCount, 0),
    createdCollection: group.filter((row) => row.collectionCount >= 1).length,
    activeSignal14d: group.filter((row) => row.mostRecentPostSignupSignal >= fourteenDaysAgo).length,
    activeSignal30d: group.filter((row) => row.mostRecentPostSignupSignal >= thirtyDaysAgo).length,
    mostRecentMeasuredActivity: group.map((row) => row.mostRecentPostSignupSignal).filter(Boolean).sort((a, b) => b - a)[0]?.toISOString() || null,
  });

  const summary = {
    source: 'firebase-auth-firestore-stripe-mirror',
    status: 'ok',
    generatedAt: now.toISOString(),
    excludedInternalAccounts: EXCLUDED_EMAILS.size,
    totalAuthUsersRaw: rows.length,
    totalRealAccounts: eligible.length,
    newSignups7d: recent7.length,
    newSignups14d: recent14.length,
    newSignups30d: recent30.length,
    planMix: {
      free: eligible.filter((row) => !row.paidCategory).length,
      plus: eligible.filter((row) => ['stripePlusMonthly', 'stripePlusAnnual', 'manualPlus'].includes(row.paidCategory)).length,
      plusFamily: eligible.filter((row) => ['stripePlusFamily', 'manualPlusFamily'].includes(row.paidCategory)).length,
    },
    paidAccess,
    paidCustomerBusinessSourceOfTruth: {
      stripePlusMonthly: 3,
      stateFundingAlabamaPlusAnnual: 1,
      stateFundingTexasPlusFamily: 2,
      total: 6,
      note: 'State-funded plan/funding-source labels supplied by the business owner; Firebase stores only generic plus/family access flags.',
    },
    paidUserEngagement: {
      all: paidEngagementGroup(paidUsers),
      stripe: paidEngagementGroup(stripePaidUsers),
      stateFunded: paidEngagementGroup(stateFundedPaidUsers),
      activitySignalDefinition: 'Most recent Firebase Auth last sign-in, Firestore lastSeenAt, or saved activity/collection timestamp occurring more than five minutes after account creation.',
    },
    engagement: {
      usersWithAnyPostSignupEngagement: eligible.filter((row) => row.engaged).length,
      savedAtLeast1: eligible.filter((row) => row.savedCount >= 1).length,
      savedAtLeast3: eligible.filter((row) => row.savedCount >= 3).length,
      totalSavedActivities: eligible.reduce((sum, row) => sum + row.savedCount, 0),
      totalCollections: eligible.reduce((sum, row) => sum + row.collectionCount, 0),
      mostRecentActivity: eligible.map((row) => row.mostRecentActivity).filter(Boolean).sort((a, b) => b - a)[0]?.toISOString() || null,
      new7dEngaged: recent7.filter((row) => row.engaged).length,
      new14dEngaged: recent14.filter((row) => row.engaged).length,
      new30dEngaged: recent30.filter((row) => row.engaged).length,
      new14dReturned: recent14.filter((row) => row.returned).length,
      new30dReturned: recent30.filter((row) => row.returned).length,
      new14dSavedAtLeast1: recent14.filter((row) => row.savedCount >= 1).length,
      new30dSavedAtLeast1: recent30.filter((row) => row.savedCount >= 1).length,
      new14dSavedAtLeast3: recent14.filter((row) => row.savedCount >= 3).length,
      new30dSavedAtLeast3: recent30.filter((row) => row.savedCount >= 3).length,
      new14dWithCollections: recent14.filter((row) => row.collectionCount >= 1).length,
      new30dWithCollections: recent30.filter((row) => row.collectionCount >= 1).length,
    },
    newUserEmailDomains: {
      last14Days: {
        personal: recent14.filter((row) => row.emailDomainCategory === 'personal').length,
        likelySchoolEducation: recent14.filter((row) => row.emailDomainCategory === 'likelySchoolEducation').length,
        unknownOther: recent14.filter((row) => row.emailDomainCategory === 'unknownOther').length,
      },
      last30Days: {
        personal: recent30.filter((row) => row.emailDomainCategory === 'personal').length,
        likelySchoolEducation: recent30.filter((row) => row.emailDomainCategory === 'likelySchoolEducation').length,
        unknownOther: recent30.filter((row) => row.emailDomainCategory === 'unknownOther').length,
      },
      caveat: 'Likely school/education is a domain-pattern indicator only and does not establish the user’s role.',
    },
    newUserPlanMix: {
      last14Days: {
        free: recent14.filter((row) => !row.paidCategory).length,
        paid: recent14.filter((row) => Boolean(row.paidCategory)).length,
      },
      last30Days: {
        free: recent30.filter((row) => !row.paidCategory).length,
        paid: recent30.filter((row) => Boolean(row.paidCategory)).length,
      },
    },
    topSavedActivityTypes: [...activityTypes.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(RAW_EXPORT), { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  const headers = ['Email', 'Display Name', 'UID', 'Account Creation Date', 'Last Sign-In Date', 'Last Seen', 'Plan', 'Paid Category', 'Saved Activity Count', 'Collection Count', 'Most Recent Activity Date', 'Engaged After Signup', 'Excluded From Aggregates'];
  const csvRows = rows.map((row) => [
    row.email, row.displayName, row.uid, row.createdAt?.toISOString(), row.lastSignInAt?.toISOString(),
    row.lastSeenAt?.toISOString(), row.plan, row.paidCategory || '', row.savedCount, row.collectionCount,
    row.mostRecentActivity?.toISOString(), row.engaged ? 'Yes' : 'No', row.excluded ? 'Yes' : 'No',
  ].map(csvCell).join(','));
  fs.writeFileSync(RAW_EXPORT, `${headers.join(',')}\n${csvRows.join('\n')}\n`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await admin.app().delete();
}
