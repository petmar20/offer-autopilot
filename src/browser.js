const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { chromium } = require('playwright-core');

const CHROME_PATHS = [
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
  path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
];

// Use Chrome when it is installed, otherwise Edge (always present on Windows 11).
function pickBrowserChannel() {
  const hasChrome = CHROME_PATHS.some((p) => fs.existsSync(p));
  return hasChrome ? 'chrome' : 'msedge';
}

// A dedicated profile, kept between runs, so Citi recognizes the device.
async function launchBrowser() {
  const profileDir = path.join(app.getPath('userData'), 'browser-profile');
  const channel = pickBrowserChannel();
  const context = await chromium.launchPersistentContext(profileDir, {
    channel,
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--window-size=1280,900'],
  });
  return { context, channel };
}

module.exports = { launchBrowser };
