function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keywords match whole words, so "bp" matches "BP" but not "bpsports.com".
function isPriorityMerchant(merchantName, keywords) {
  const name = String(merchantName || '').toLowerCase();
  return keywords.some((keyword) => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) {
      return false;
    }
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(trimmed)}([^a-z0-9]|$)`);
    return pattern.test(name);
  });
}

module.exports = { isPriorityMerchant };
