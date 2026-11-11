const fs = require('fs');
const path = require('path');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

// Write to a temp file first so a crash never leaves a half-written file.
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

module.exports = { readJson, writeJson };
