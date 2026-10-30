'use strict';

// Repository-only audit exceptions. Project generation never reads this file.
// Updating the baseline requires review; the build cannot learn new exceptions.
function reviewPalette(reports, baseline) {
  if (!baseline || baseline.schemaVersion !== 1 || baseline.brandSeed !== '#2C73A9'
    || baseline.minimum !== 4.5 || !/^[a-f0-9]{40}$/.test(baseline.sourceCommit || '')
    || !Array.isArray(baseline.templates)) {
    throw new Error('Invalid template palette baseline');
  }
  const known = [], regressions = [];
  const samePair = (a, b) => a.role === b.role && a.foreground === b.foreground
    && a.background === b.background && a.minimum === b.minimum;
  const selectors = item => JSON.stringify(item.selectors?.map(selector => selector.replace(/\r\n/g, '\n')));
  for (const report of reports) {
    const previous = baseline.templates.find(item => item.themeId === report.themeId
      && item.sourceHash === report.sourceHash);
    const issues = report.issues.filter(item => !previous?.issues.some(old => samePair(item, old)
      && Number.isFinite(old.ratio) && item.ratio >= old.ratio));
    const unresolved = report.unresolved.filter(item => !previous?.unresolved.some(old => samePair(item, old)
      && old.reason === item.reason && selectors(old) === selectors(item)));
    if (issues.length || unresolved.length) {regressions.push({ ...report, issues, unresolved });}
    if (issues.length < report.issues.length || unresolved.length < report.unresolved.length) {known.push(report);}
  }
  return { known, regressions };
}

module.exports = { reviewPalette };
