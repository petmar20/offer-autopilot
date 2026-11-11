const { launchBrowser } = require('./browser');
const { recordOfferList, recordEnrollment, rememberCard } = require('./offerStore');
const { isPriorityMerchant } = require('./priority');
const human = require('./humanize');

// Going straight to this page skips the paperless prompt Citi shows after sign-in.
const MERCHANT_OFFERS_URL = 'https://online.citi.com/US/nga/products-offers/merchantoffers';
const RETRIEVE_API = '/merchantOffers/retrieve';
const ENROLL_API = '/enrollMerchantOffer';

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;
const ASK_USER_AFTER_MS = 30 * 1000;

const CARD_SELECTOR = '#card-selector-cds-dropdown';
const SEARCH_BOX = 'input[placeholder="Search by merchant"]';
const USERNAME_INPUT = 'input[id$="_username"]';
const PASSWORD_INPUT = 'input[id$="_password"]';
const REMEMBER_ME = 'input[id$="_rememberMe"]';
const ENROLL_BUTTON = 'button[aria-label^="Enroll in Offer for"]';

// The merchant name in a button label. Citi cuts long names short with "...".
function shownNameFromLabel(label) {
  return String(label || '').replace(/^Enroll in Offer for\s*/, '');
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/(\.\.\.|…)\s*$/, '')
    .replace(/[^a-z0-9]/g, '');
}

function namesMatch(shownName, merchantName) {
  const shown = normalizeName(shownName);
  const full = normalizeName(merchantName);
  if (!shown || !full) {
    return false;
  }
  const truncated = /(\.\.\.|…)\s*$/.test(String(shownName));
  return shown === full || (truncated && shown.length >= 5 && full.startsWith(shown));
}

class StopRequested extends Error {
  constructor() {
    super('Stopped');
  }
}

async function isVisible(locator) {
  try {
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function waitUntil(condition, timeoutMs, shouldStop) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shouldStop()) {
      throw new StopRequested();
    }
    if (await condition()) {
      return true;
    }
    await human.sleep(500);
  }
  return false;
}

// Citi groups the list by category, so the same offer can appear twice.
function flattenOffers(retrieveResponse) {
  const byId = new Map();
  for (const group of retrieveResponse.merchantOffers || []) {
    for (const offer of group.offers || []) {
      byId.set(offer.offerId, offer);
    }
  }
  return [...byId.values()];
}

class CitiSession {
  constructor({ settings, password, log, notify, shouldStop }) {
    this.settings = settings;
    this.password = password;
    this.log = log;
    this.notify = notify;
    this.shouldStop = shouldStop;
    this.latestList = { count: 0, accountId: null, offers: [] };
    this.listLabel = null;
  }

  checkStop() {
    if (this.shouldStop()) {
      throw new StopRequested();
    }
  }

  watchOfferLists() {
    this.page.on('response', async (response) => {
      if (!response.url().includes(RETRIEVE_API) || response.request().method() !== 'POST') {
        return;
      }
      try {
        const body = await response.json();
        const accountId = JSON.parse(response.request().postData() || '{}').accountId;
        const offers = flattenOffers(body);
        recordOfferList(accountId, offers);
        this.latestList = { count: this.latestList.count + 1, accountId, offers };
      } catch (error) {
        this.log(`Could not read the offer list: ${error.message}`);
      }
    });
  }

  async openMerchantOffers() {
    const page = this.page;
    await page.goto(MERCHANT_OFFERS_URL, { waitUntil: 'domcontentloaded' });

    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    let signInStartedAt = null;
    let askedUser = false;
    let lastRedirectAt = 0;

    while (Date.now() < deadline) {
      this.checkStop();

      if (await isVisible(page.locator(CARD_SELECTOR))) {
        return;
      }

      const onSignInForm = await isVisible(page.locator(PASSWORD_INPUT));
      if (onSignInForm && signInStartedAt === null) {
        signInStartedAt = Date.now();
        if (this.password) {
          await this.signIn();
        }
        continue;
      }

      const waitingOnUser = signInStartedAt !== null && Date.now() - signInStartedAt > ASK_USER_AFTER_MS;
      const needsUserNow = onSignInForm && !this.password;
      if ((waitingOnUser || needsUserNow) && !askedUser) {
        askedUser = true;
        this.log('Waiting for you to finish signing in.');
        this.notify('Citi needs you to finish signing in. Use the browser window that opened.');
      }

      // Once signed in, Citi lands on the dashboard or a prompt. Go to the offers instead.
      const signedIn = await isVisible(page.getByText('Sign Off', { exact: true }));
      const onOffersPage = page.url().toLowerCase().includes('merchantoffers');
      if (signedIn && !onOffersPage && Date.now() - lastRedirectAt > 15000) {
        lastRedirectAt = Date.now();
        await human.pause(1500, 4000);
        await page.goto(MERCHANT_OFFERS_URL, { waitUntil: 'domcontentloaded' });
      }

      await human.sleep(1500);
    }
    throw new Error('Sign-in did not finish within 10 minutes.');
  }

  async signIn() {
    const page = this.page;
    this.log('Signing in.');
    await human.pause(1500, 3500);

    const username = page.locator(USERNAME_INPUT).first();
    if (this.settings.username && (await isVisible(username))) {
      const current = await username.inputValue();
      if (!current) {
        await human.typeLikeAPerson(username, this.settings.username);
        await human.pause(400, 1200);
      }
    }

    await human.typeLikeAPerson(page.locator(PASSWORD_INPUT).first(), this.password);
    await human.pause(500, 1500);

    const rememberMe = page.locator(REMEMBER_ME).first();
    try {
      if ((await isVisible(rememberMe)) && !(await rememberMe.isChecked())) {
        await rememberMe.check();
        await human.pause(300, 900);
      }
    } catch {
      // Not worth failing the run over.
    }

    const submit = page.locator(PASSWORD_INPUT).first()
      .locator('xpath=ancestor::form[1]')
      .locator('button[type="submit"]').first();
    await human.clickLikeAPerson(submit);
  }

  async listCards() {
    await this.openCardDropdown();
    const labels = await this.page.locator('[role="option"]').evaluateAll((options) =>
      options.filter((o) => o.offsetParent !== null).map((o) => o.textContent.trim()));
    await this.closeCardDropdown();
    return labels;
  }

  async currentCardLabel() {
    return (await this.page.locator(CARD_SELECTOR).innerText()).trim();
  }

  async isCardDropdownOpen() {
    const expanded = await this.page.locator(CARD_SELECTOR).getAttribute('aria-expanded');
    return expanded === 'true' && (await isVisible(this.page.getByRole('option')));
  }

  // The dropdown sits at the top of a long page and sometimes ignores a click, so check and retry.
  async openCardDropdown() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.dismissPopups();
      await this.scrollToTop();
      if (!(await this.isCardDropdownOpen())) {
        await human.clickLikeAPerson(this.page.locator(CARD_SELECTOR));
      }
      if (await waitUntil(() => this.isCardDropdownOpen(), 5000, this.shouldStop)) {
        await human.pause(500, 1200);
        return;
      }
      await human.pause(1000, 2500);
    }
    throw new Error('The card list did not open.');
  }

  async closeCardDropdown() {
    if (await this.isCardDropdownOpen()) {
      await this.page.keyboard.press('Escape');
      await human.pause(400, 900);
    }
    if (await this.isCardDropdownOpen()) {
      await human.clickLikeAPerson(this.page.locator(CARD_SELECTOR));
      await human.pause(400, 900);
    }
  }

  async scrollToTop() {
    await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await human.pause(700, 1500);
  }

  async dismissPopups() {
    const closeButton = this.page.locator('[role="dialog"] button[aria-label="Close"]').filter({ visible: true }).first();
    if ((await closeButton.count()) > 0) {
      await human.clickLikeAPerson(closeButton).catch(() => {});
      await human.pause(500, 1200);
    }
  }

  // Load the page again and note which card it opened on.
  async reloadOffersPage() {
    const countBefore = this.latestList.count;
    this.listLabel = null;
    await this.openMerchantOffers();
    if (!(await waitUntil(() => this.latestList.count > countBefore, 45000, this.shouldStop))) {
      throw new Error('The offer list did not load.');
    }
    this.listLabel = await this.currentCardLabel();
    await human.pause(2000, 4000);
  }

  // Returns the account id and offer list for the chosen card.
  async selectCard(label) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.trySelectCard(label);
      } catch (error) {
        if (error instanceof StopRequested || attempt === 3) {
          throw error;
        }
        this.log(`Switching to ${label} didn't work (${error.message}). Trying again.`);
        await human.pause(3000, 6000);
        await this.reloadOffersPage();
      }
    }
    throw new Error(`Could not switch to ${label}.`);
  }

  async trySelectCard(label) {
    // listLabel is the card the latest offer list belongs to. Only trust it when it is known.
    if (this.listLabel === label && (await this.currentCardLabel()) === label) {
      return this.latestList;
    }

    const countBefore = this.latestList.count;
    this.listLabel = null;
    await this.openCardDropdown();
    await human.clickLikeAPerson(this.page.getByRole('option', { name: label, exact: true }));

    const switched = await waitUntil(async () => (await this.currentCardLabel()) === label, 10000, this.shouldStop);
    if (!switched) {
      throw new Error('the card did not change');
    }
    const loaded = await waitUntil(() => this.latestList.count > countBefore, 45000, this.shouldStop);
    if (!loaded) {
      throw new Error('its offers did not load');
    }
    this.listLabel = label;
    await human.pause(2000, 4000);
    return this.latestList;
  }

  async visibleEnrollButtons() {
    const buttons = this.page.locator(ENROLL_BUTTON).filter({ visible: true });
    const labels = await buttons.evaluateAll((elements) => elements.map((e) => e.getAttribute('aria-label')));
    return labels.map((label, index) => ({
      label,
      shownName: shownNameFromLabel(label),
      locator: buttons.nth(index),
    }));
  }

  async clearSearch() {
    const search = this.page.locator(SEARCH_BOX).first();
    if ((await search.inputValue()) === '') {
      return;
    }
    await search.click();
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Backspace');
    await human.pause(1200, 2500);
  }

  // Citi's response names the exact offer and card, so that is what gets saved,
  // whatever the button label said.
  async clickEnrollButton(locator) {
    const page = this.page;
    const enrollResponse = page.waitForResponse(
      (response) => response.url().includes(ENROLL_API) && response.request().method() === 'POST',
      { timeout: 30000 },
    );
    await human.clickLikeAPerson(locator);
    const response = await enrollResponse;
    if (!response.ok()) {
      return { outcome: 'failed', reason: `Citi answered ${response.status()}` };
    }
    const accountId = JSON.parse(response.request().postData() || '{}').accountId;
    const saved = recordEnrollment(accountId, await response.json());

    // Look at the popup for a moment, then close it.
    await human.pause(1000, 2500);
    const closeButton = page.locator('[role="dialog"] button[aria-label="Close"]').filter({ visible: true }).first();
    if ((await closeButton.count()) > 0) {
      await human.clickLikeAPerson(closeButton);
    } else {
      await page.keyboard.press('Escape');
    }
    return { outcome: 'enrolled', offer: saved };
  }

  async enrollBySearch(offer) {
    const search = this.page.locator(SEARCH_BOX).first();
    await human.typeLikeAPerson(search, offer.merchantName);
    await human.pause(1200, 2500);

    const buttons = await this.visibleEnrollButtons();
    let match = buttons.find((b) => namesMatch(b.shownName, offer.merchantName));
    if (!match && buttons.length === 1) {
      match = buttons[0];
    }
    if (!match) {
      const shown = buttons.slice(0, 3).map((b) => b.shownName).join(', ') || 'nothing';
      return { outcome: 'skipped', reason: `no matching enroll button (showed ${shown})` };
    }
    return this.clickEnrollButton(match.locator);
  }

  // Priority stores first so they get done even if a run is cut short.
  orderOffers(offers) {
    const available = offers.filter((o) => o.offerStatus === 'AVAILABLE');
    const keywords = this.settings.priorityKeywords;
    const priority = available.filter((o) => isPriorityMerchant(o.merchantName, keywords));
    const rest = available.filter((o) => !isPriorityMerchant(o.merchantName, keywords));
    return [...human.shuffle(priority), ...human.shuffle(rest)];
  }

  async enrollEverything(summary) {
    const cardLabels = await this.listCards();
    this.log(`Found ${cardLabels.length} card(s): ${cardLabels.join(', ')}.`);

    for (const label of human.shuffle(cardLabels)) {
      this.checkStop();
      let list;
      try {
        list = await this.selectCard(label);
      } catch (error) {
        if (error instanceof StopRequested) {
          throw error;
        }
        // Skip this card but still do the others.
        summary.cardErrors.push(`Could not open the offers for ${label}: ${error.message}.`);
        this.log(`Could not open the offers for ${label}: ${error.message}. Moving on.`);
        continue;
      }
      rememberCard(list.accountId, label);
      const available = this.orderOffers(list.offers);
      this.log(`${label}: ${available.length} offer(s) to enroll.`);
      if (available.length === 0) {
        continue;
      }

      const card = { label, enrolledIds: new Set(), summary, sinceBreak: 0 };
      const keywords = this.settings.priorityKeywords;

      // 1. Priority stores by search, so they are done first.
      const priority = available.filter((o) => isPriorityMerchant(o.merchantName, keywords));
      for (const offer of priority) {
        await this.attempt(card, offer, () => this.enrollBySearch(offer));
      }

      // 2. Everything the page shows, clicked straight from the list. This is the fast part.
      await this.clearSearch();
      await this.enrollVisibleOffers(card);

      // 3. Whatever is left, by search.
      const leftovers = available.filter((o) => !card.enrolledIds.has(o.offerId));
      if (leftovers.length > 0) {
        this.log(`${label}: searching for ${leftovers.length} offer(s) the list didn't show.`);
      }
      for (const offer of leftovers) {
        if (!card.enrolledIds.has(offer.offerId)) {
          await this.attempt(card, offer, () => this.enrollBySearch(offer));
        }
      }
      await this.clearSearch();
    }
  }

  async enrollVisibleOffers(card) {
    const keywords = this.settings.priorityKeywords;
    const attemptsByLabel = new Map();
    let scrolledForMore = false;

    while (true) {
      this.checkStop();
      const candidates = (await this.visibleEnrollButtons())
        .filter((b) => (attemptsByLabel.get(b.label) || 0) < 2);

      if (candidates.length === 0) {
        if (scrolledForMore) {
          return;
        }
        // The page may render more offers further down.
        scrolledForMore = true;
        await this.scrollThroughPage();
        continue;
      }
      scrolledForMore = false;

      const priority = candidates.filter((b) => isPriorityMerchant(b.shownName, keywords));
      const pool = priority.length > 0 ? priority : candidates.slice(0, 4);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      attemptsByLabel.set(pick.label, (attemptsByLabel.get(pick.label) || 0) + 1);

      await this.attempt(card, { merchantName: pick.shownName }, () => this.clickEnrollButton(pick.locator));
    }
  }

  async scrollThroughPage() {
    for (let step = 0; step < 12; step++) {
      await this.page.mouse.wheel(0, human.randomBetween(500, 900));
      await human.pause(300, 700);
    }
    await human.pause(1000, 2000);
    await this.scrollToTop();
  }

  // Runs one enrollment, records the outcome, then waits a random time.
  async attempt(card, offer, enroll) {
    this.checkStop();
    const { summary, label } = card;
    try {
      const result = await enroll();
      if (result.outcome === 'enrolled') {
        card.enrolledIds.add(result.offer.offerId);
        summary.enrolled.push({ card: label, merchant: result.offer.merchantName, title: result.offer.title });
        this.log(`Enrolled ${result.offer.merchantName} (${result.offer.title}) on ${label}.`);
      } else if (result.outcome === 'skipped') {
        summary.skipped.push({ card: label, merchant: offer.merchantName, reason: result.reason });
        this.log(`Skipped ${offer.merchantName}: ${result.reason}.`);
      } else {
        summary.failed.push({ card: label, merchant: offer.merchantName, reason: result.reason });
        this.log(`Could not enroll ${offer.merchantName}: ${result.reason}.`);
      }
    } catch (error) {
      if (error instanceof StopRequested) {
        throw error;
      }
      summary.failed.push({ card: label, merchant: offer.merchantName, reason: error.message });
      this.log(`Could not enroll ${offer.merchantName}: ${error.message}`);
      await this.page.keyboard.press('Escape').catch(() => {});
    }

    card.sinceBreak += 1;
    if (human.shouldTakeBreak(card.sinceBreak)) {
      card.sinceBreak = 0;
      await human.takeBreak();
    } else {
      await human.pauseBetweenActions();
    }
  }

  async run() {
    const { context, channel } = await launchBrowser();
    this.log(`Opened ${channel === 'chrome' ? 'Chrome' : 'Edge'}.`);
    const summary = { enrolled: [], skipped: [], failed: [], cardErrors: [] };
    try {
      this.page = context.pages()[0] || (await context.newPage());
      this.watchOfferLists();
      await this.openMerchantOffers();
      this.log('Merchant Offers page is open.');
      const listLoaded = await waitUntil(() => this.latestList.count > 0, 45000, this.shouldStop);
      if (!listLoaded) {
        throw new Error('The offer list did not load.');
      }
      this.listLabel = await this.currentCardLabel();
      await human.pause(2000, 5000);
      await this.enrollEverything(summary);
      if (summary.cardErrors.length > 0) {
        throw new Error(summary.cardErrors.join(' '));
      }
      return summary;
    } catch (error) {
      error.summary = summary;
      throw error;
    } finally {
      await context.close().catch(() => {});
    }
  }
}

module.exports = { CitiSession, StopRequested };
