const path = require('path');
const { app } = require('electron');
const { readJson, writeJson } = require('./jsonFile');

// offers.json is the one record of every offer seen, keyed by card and offer.
// runs.json is a short history of runs for the Activity tab.

const MAX_RUNS_KEPT = 200;

function offersPath() {
  return path.join(app.getPath('userData'), 'offers.json');
}

function runsPath() {
  return path.join(app.getPath('userData'), 'runs.json');
}

function loadOffers() {
  return readJson(offersPath(), { cards: {}, offers: {} });
}

function offerKey(accountId, offerId) {
  return `${accountId}:${offerId}`;
}

function rememberCard(accountId, label) {
  const data = loadOffers();
  data.cards[accountId] = { label };
  writeJson(offersPath(), data);
}

// Called with the list Citi returns for one card.
function recordOfferList(accountId, offers) {
  const data = loadOffers();
  const now = new Date().toISOString();
  for (const offer of offers) {
    const key = offerKey(accountId, offer.offerId);
    const existing = data.offers[key] || { firstSeenAt: now };
    data.offers[key] = {
      ...existing,
      accountId,
      offerId: offer.offerId,
      merchantName: offer.merchantName,
      category: offer.merchantCategory,
      title: offer.offerTitle,
      endDate: offer.offerEndDate,
      redemptionType: offer.redemptionType,
      imageUrl: offer.merchantImageURL,
      status: offer.offerStatus,
      lastSeenAt: now,
    };
  }
  writeJson(offersPath(), data);
}

// Called with Citi's enroll response, which carries the full offer details.
function recordEnrollment(accountId, response) {
  const details = response.MerchantOfferDetails || {};
  const text = (details.merchantOfferText || []).find((t) => t.languagePreference === 'ENGLISH')
    || (details.merchantOfferText || [])[0]
    || {};
  const data = loadOffers();
  const now = new Date().toISOString();
  const key = offerKey(accountId, details.offerId);
  const existing = data.offers[key] || { firstSeenAt: now };
  data.offers[key] = {
    ...existing,
    accountId,
    offerId: details.offerId,
    merchantName: details.merchantName || existing.merchantName,
    category: details.merchantCategory || existing.category,
    title: text.offerTitle || existing.title,
    endDate: details.offerEndDate || existing.endDate,
    redemptionType: details.redemptionType || existing.redemptionType,
    imageUrl: details.merchantImageUrl || existing.imageUrl,
    status: details.offerStatus || 'ENROLLED',
    description: text.offerDescription || '',
    longDescription: text.offerLongDescription || '',
    terms: text.termsAndConditionsText || '',
    websiteUrl: details.websiteUrl || '',
    enrolledAt: now,
    lastSeenAt: now,
  };
  writeJson(offersPath(), data);
  return data.offers[key];
}

function loadRuns() {
  return readJson(runsPath(), []);
}

function saveRun(run) {
  const runs = loadRuns().filter((r) => r.id !== run.id);
  runs.unshift(run);
  writeJson(runsPath(), runs.slice(0, MAX_RUNS_KEPT));
}

module.exports = {
  loadOffers,
  rememberCard,
  recordOfferList,
  recordEnrollment,
  loadRuns,
  saveRun,
};
