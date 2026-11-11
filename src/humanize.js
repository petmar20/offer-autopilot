// Random timing so the session looks like a person using the site.

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pause(minMs, maxMs) {
  return sleep(randomBetween(minMs, maxMs));
}

// A short pause most of the time, with an occasional longer one.
async function pauseBetweenActions() {
  if (Math.random() < 0.08) {
    await pause(6000, 15000);
  } else {
    await pause(1500, 5000);
  }
}

// Every so often, take a real break.
function shouldTakeBreak(actionsSinceBreak) {
  const threshold = 12 + Math.floor(Math.random() * 14);
  return actionsSinceBreak >= threshold;
}

async function takeBreak() {
  await pause(20000, 60000);
}

async function typeLikeAPerson(locator, text) {
  await locator.click();
  await pause(200, 600);
  await locator.fill('');
  for (const character of text) {
    await locator.pressSequentially(character);
    await sleep(randomBetween(60, 190));
  }
}

// Click somewhere inside the element instead of its exact center.
async function clickLikeAPerson(locator) {
  await locator.scrollIntoViewIfNeeded();
  await pause(300, 900);
  const box = await locator.boundingBox();
  if (!box) {
    await locator.click();
    return;
  }
  const position = {
    x: box.width * randomBetween(0.3, 0.7),
    y: box.height * randomBetween(0.3, 0.7),
  };
  await locator.hover({ position });
  await pause(120, 400);
  await locator.click({ position });
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

module.exports = {
  randomBetween,
  sleep,
  pause,
  pauseBetweenActions,
  shouldTakeBreak,
  takeBreak,
  typeLikeAPerson,
  clickLikeAPerson,
  shuffle,
};
