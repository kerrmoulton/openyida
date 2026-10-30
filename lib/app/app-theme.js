'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');
const { httpGet, httpPost, requestWithAutoLogin } = require('../core/utils');
const { createAuthRef } = require('../core/yida-client');
const { throwCommandError, throwUsage } = require('../core/command-errors');
const { t } = require('../core/i18n');
const { parseThemeContext } = require('./upgrade-app-theme');

// Deliberately exclude business configuration, theme migration flags and app metadata.
const KEYS = ['COLOUR', 'THEME_COLOR', 'NAV_THEME', 'LAY_OUT_DIRECTION', 'NAVTYPE',
  'HIDE_APP_NAV', 'LOGO_SOURCE', 'HOMEPAGELOGO', 'CUSTOM_THEME_STYLE'];
const MODE_KEYS = ['APP_THEME_MODE', 'CREATED_WITH_MODERN_THEME'];
const MAX_BYTES = 20 * 1024 * 1024;
const fail = (code, details) => throwCommandError(t('app_theme.' + code.toLowerCase()), { code, details });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) { return '[' + value.map(canonical).join(',') + ']'; }
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
const digest = value => hash(canonical(value));
const equal = (a, b) => canonical(a) === canonical(b);
const appIdValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && equal(Object.keys(value).sort(), [...keys].sort());

function parseArgs(args = []) {
  const params = { action: args[0] };
  if (['--help', '-h'].includes(args[0])) { return { help: true }; }
  if (!['snapshot', 'restore'].includes(params.action)) { throwUsage(t('app_theme.usage')); }
  const values = { '--output-dir': 'outputDir', '--snapshot': 'snapshot', '--expected-current': 'expectedCurrent' };
  const flags = { '--json': 'json', '--help': 'help', '-h': 'help', '--check': 'check', '--confirm': 'confirm' };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const field = values[arg] || flags[arg];
    if (field && params[field] !== undefined) { throwUsage(t('cli_argument.invalid', arg)); }
    if (values[arg] && args[i + 1] && !args[i + 1].startsWith('-')) { params[field] = args[++i]; }
    else if (flags[arg]) { params[field] = true; }
    else if (!arg.startsWith('-') && !params.appType) { params.appType = arg; }
    else { throwUsage(t('cli_argument.invalid', arg)); }
  }
  if (params.help) { return params; }
  validateParams(params);
  return params;
}

function validateParams(p) {
  if (!appIdValid(p.appType) || !['snapshot', 'restore'].includes(p.action) ||
      (p.action === 'snapshot' && (!p.outputDir || p.snapshot || p.expectedCurrent || p.check || p.confirm)) ||
      (p.action === 'restore' && (!p.snapshot || !p.expectedCurrent || (p.check && p.confirm) || (p.confirm && !p.outputDir)))) {
    throwUsage(t('app_theme.usage'));
  }
}

function identity(appType, auth) {
  let url;
  try { url = new URL(auth.baseUrl); } catch (_) { fail('APP_THEME_IDENTITY_INVALID'); }
  if (!auth.corpId || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail('APP_THEME_IDENTITY_INVALID');
  }
  return { appType, corpId: auth.corpId, baseUrl: url.href.replace(/\/$/, '') };
}

async function configRequest(appType, auth, endpoint, fields, target = identity(appType, auth)) {
  return requestWithAutoLogin(current => {
    if (!equal(target, identity(appType, current))) { fail('APP_THEME_IDENTITY_INVALID'); }
    return httpPost(current.baseUrl, `/${encodeURIComponent(appType)}/query/app/${endpoint}.json`,
      querystring.stringify({ appType, ...fields, _csrf_token: current.csrfToken }));
  }, auth);
}

async function readState(appType, auth) {
  const target = identity(appType, auth);
  const html = await requestWithAutoLogin(current => httpGet(current.baseUrl,
    `/${appType}/admin`, { _stamp: Date.now() }, { responseType: 'text' }), auth);
  const context = parseThemeContext(html, ['appType', 'corpId', 'appThemeEnable', 'appThemeMode']);
  if (context.appType !== target.appType || context.corpId !== target.corpId) { fail('APP_THEME_IDENTITY_INVALID'); }
  const response = await requestWithAutoLogin(current => httpGet(current.baseUrl,
    `/${appType}/query/app/getAppIncludingAecpInfo.json`, { appKey: appType, _stamp: Date.now() }), auth);
  const app = response?.content;
  if (response?.success !== true || !app || typeof app !== 'object' || typeof app.icon !== 'string') {
    fail('APP_THEME_SNAPSHOT_INVALID');
  }
  const config = {};
  const modes = {};
  for (const key of [...KEYS, ...MODE_KEYS]) {
    const result = await configRequest(appType, auth, 'getSingleConfig', { key });
    const empty = exactKeys(result?.content, []);
    if (result?.success !== true || (result.content !== null && typeof result.content !== 'string' && !empty)) {
      fail('APP_THEME_READ_FAILED', { key });
    }
    (KEYS.includes(key) ? config : modes)[key] = empty ? null : result.content;
  }
  if (!equal(target, identity(appType, auth))) { fail('APP_THEME_IDENTITY_INVALID'); }
  return { identity: target, config, protected: { modes, appThemeEnable: context.appThemeEnable,
    appThemeMode: context.appThemeMode, icon: app.icon } };
}

function styleOf(state) {
  const raw = state.config.CUSTOM_THEME_STYLE;
  if (raw === null || raw === '') { return null; }
  let style;
  try { style = JSON.parse(raw); } catch (_) { fail('APP_THEME_SNAPSHOT_INVALID'); }
  if (!style || Array.isArray(style) || typeof style !== 'object' ||
      Object.keys(style).some(key => !['enabled', 'iframePropagation', 'cssUrl', 'cssFileName'].includes(key)) ||
      ['enabled', 'iframePropagation'].some(key => Object.hasOwn(style, key) && typeof style[key] !== 'boolean') ||
      ['cssUrl', 'cssFileName'].some(key => Object.hasOwn(style, key) && typeof style[key] !== 'string') ||
      (style.enabled === true && !style.cssUrl)) { fail('APP_THEME_SNAPSHOT_INVALID'); }
  return style;
}

// CSS is fetched without Yida credentials. Redirects, oversized files and HTML/login bodies fail closed.
function downloadCss(url) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (_) { reject(new Error(t('app_theme.app_theme_css_unavailable'))); return; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
      reject(new Error(t('app_theme.app_theme_css_unavailable'))); return;
    }
    const request = https.get(parsed, { headers: { Accept: 'text/css' } }, response => {
      if (response.statusCode !== 200 || !/^text\/css(?:;|$)/i.test(response.headers['content-type'] || '')) {
        response.resume(); reject(new Error(t('app_theme.app_theme_css_unavailable'))); return;
      }
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > MAX_BYTES) { request.destroy(new Error(t('app_theme.app_theme_css_unavailable'))); }
        else { chunks.push(chunk); }
      });
      response.on('error', reject);
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        if (!bytes.length || /<\s*(?:!doctype|html|script)\b/i.test(bytes.toString('utf8'))) {
          reject(new Error(t('app_theme.app_theme_css_unavailable')));
        } else { resolve(bytes); }
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error(t('app_theme.app_theme_css_unavailable'))));
    request.on('error', reject);
  });
}

function newDirectory(dir) {
  const absolute = path.resolve(dir);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  try { fs.mkdirSync(absolute, { mode: 0o700 }); }
  catch (_) { fail('APP_THEME_OUTPUT_EXISTS'); }
  return absolute;
}
function writeJson(file, value, exclusive = false) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
}

function capabilities(state) {
  return { restorableKeys: KEYS.filter(key => typeof state.config[key] === 'string' && state.config[key].trim()),
    cannotClearKeys: KEYS.filter(key => !state.config[key]?.trim()),
    protectedFields: ['icon', 'appThemeEnable', 'appThemeMode', ...MODE_KEYS],
    scope: 'application-theme-config', supportsPageRestore: false, supportsIconRestore: false };
}

async function snapshot(p, auth, fetchCss = downloadCss) {
  validateParams({ ...p, action: 'snapshot' });
  const dir = newDirectory(p.outputDir);
  const state = await readState(p.appType, auth);
  const style = styleOf(state);
  let css = null;
  if (style?.cssUrl) {
    const bytes = await fetchCss(style.cssUrl);
    fs.writeFileSync(path.join(dir, 'theme.css'), bytes, { mode: 0o600, flag: 'wx' });
    css = { file: 'theme.css', sha256: hash(bytes), bytes: bytes.length };
  }
  if (!equal(state, await readState(p.appType, auth))) { fail('APP_THEME_CONFLICT'); }
  const data = { version: 1, createdAt: new Date().toISOString(), state, css };
  const document = { ...data, sha256: digest(data) };
  const file = path.join(dir, 'snapshot.json');
  writeJson(file, document, true);
  loadSnapshot(file); // Re-read actual local bytes before claiming a usable backup.
  return { success: true, snapshot: file, fingerprint: digest(state), ...capabilities(state), runtimeVerified: false };
}

function loadSnapshot(file) {
  try {
    if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > MAX_BYTES) { throw new Error(); }
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { sha256, ...data } = doc;
    const state = data.state;
    if (!exactKeys(doc, ['version', 'createdAt', 'state', 'css', 'sha256']) || data.version !== 1 ||
        typeof data.createdAt !== 'string' || sha256 !== digest(data) ||
        !exactKeys(state, ['identity', 'config', 'protected']) ||
        !exactKeys(state.identity, ['appType', 'corpId', 'baseUrl']) || !appIdValid(state.identity.appType) ||
        !equal(state.identity, identity(state.identity.appType, state.identity)) ||
        !exactKeys(state.config, KEYS) || !exactKeys(state.protected, ['modes', 'appThemeEnable', 'appThemeMode', 'icon']) ||
        !exactKeys(state.protected.modes, MODE_KEYS) ||
        Object.values({ ...state.config, ...state.protected.modes }).some(v => v !== null && typeof v !== 'string') ||
        ['icon', 'appThemeEnable', 'appThemeMode'].some(k => typeof state.protected[k] !== 'string')) { throw new Error(); }
    const style = styleOf(state);
    if (style?.cssUrl) {
      if (!exactKeys(data.css, ['file', 'sha256', 'bytes']) || data.css.file !== 'theme.css') { throw new Error(); }
      const cssFile = path.join(path.dirname(file), 'theme.css');
      if (!fs.lstatSync(cssFile).isFile() || fs.statSync(cssFile).size > MAX_BYTES) { throw new Error(); }
      const bytes = fs.readFileSync(cssFile);
      if (!bytes.length || hash(bytes) !== data.css.sha256 || bytes.length !== data.css.bytes) { throw new Error(); }
    } else if (data.css !== null) { throw new Error(); }
    return doc;
  } catch (_) { fail('APP_THEME_SNAPSHOT_INVALID'); }
}

function planRestore(before, after) {
  const blockers = [];
  if (!equal(before.identity, after.identity)) { blockers.push({ reason: 'identity_mismatch' }); }
  if (!equal(before.protected, after.protected)) { blockers.push({ reason: 'protected_fields_changed' }); }
  const changes = KEYS.filter(key => before.config[key] !== after.config[key]).map(key => ({ key, value: before.config[key] }));
  for (const { key, value } of changes) {
    if (value === null || !value.trim()) { blockers.push({ key, reason: 'cannot_restore_absent_or_empty_value' }); }
  }
  return { changes, blockers };
}

async function restore(p, auth, fetchCss = downloadCss) {
  validateParams({ ...p, action: 'restore' });
  const before = loadSnapshot(p.snapshot);
  const after = loadSnapshot(p.expectedCurrent);
  if (!equal(before.state.identity, identity(p.appType, auth)) || !equal(after.state.identity, identity(p.appType, auth))) {
    fail('APP_THEME_IDENTITY_INVALID');
  }
  const plan = planRestore(before.state, after.state);
  const current = await readState(p.appType, auth);
  if (!equal(current, after.state)) { fail('APP_THEME_CONFLICT'); }
  if (plan.changes.some(({ key }) => key === 'CUSTOM_THEME_STYLE') && before.css) {
    try {
      if (hash(await fetchCss(styleOf(before.state).cssUrl)) !== before.css.sha256) { throw new Error(); }
    } catch (_) { plan.blockers.push({ reason: 'original_css_unavailable_or_changed' }); }
  }
  const report = { success: true, canRestore: !plan.blockers.length, changes: plan.changes.map(({ key }) => key),
    blockers: plan.blockers, verificationScope: 'application-theme-config', runtimeVerified: false };
  if (p.confirm !== true) { return { ...report, checkOnly: true }; }
  if (plan.blockers.length) { fail('APP_THEME_RESTORE_BLOCKED', report); }
  const dir = newDirectory(p.outputDir);
  const journalFile = path.join(dir, 'restore.json');
  const journal = { version: 1, identity: current.identity, targetFingerprint: digest(before.state),
    expectedFingerprint: digest(after.state), status: 'prepared', attemptedKey: null, verifiedWrites: [] };
  writeJson(journalFile, journal, true);
  let expected = current;
  try {
    for (const change of plan.changes) {
      // No server-side compare-and-swap exists. Check the complete tracked state before every write.
      if (!equal(expected, await readState(p.appType, auth))) { fail('APP_THEME_CONFLICT'); }
      journal.status = 'writing';
      journal.attemptedKey = change.key;
      writeJson(journalFile, journal);
      const response = await configRequest(p.appType, auth, 'updateSingleConfig', change, before.state.identity);
      if (response?.success !== true || response.content !== true) { fail('APP_THEME_WRITE_FAILED'); }
      expected = { ...expected, config: { ...expected.config, [change.key]: change.value } };
      if (!equal(expected, await readState(p.appType, auth))) { fail('APP_THEME_VERIFY_FAILED'); }
      journal.verifiedWrites.push(change.key);
      journal.attemptedKey = null;
      writeJson(journalFile, journal);
    }
    if (!equal(before.state, await readState(p.appType, auth))) { fail('APP_THEME_VERIFY_FAILED'); }
    journal.status = 'restored';
    writeJson(journalFile, journal);
    return { ...report, changed: plan.changes.length > 0, verified: true, journal: journalFile };
  } catch (error) {
    journal.status = 'failed_or_unknown';
    journal.errorCode = error.code || 'APP_THEME_WRITE_FAILED';
    try { journal.observedState = await readState(p.appType, auth); } catch (_) { journal.readbackFailed = true; }
    try { writeJson(journalFile, journal); } catch (_) { /* The pre-write journal remains available. */ }
    fail('APP_THEME_RESTORE_INCOMPLETE', { journal: journalFile, attemptedKey: journal.attemptedKey,
      verifiedWrites: journal.verifiedWrites, cause: journal.errorCode });
  }
}

async function run(args) {
  const params = parseArgs(args);
  if (params.help) { console.log(t('app_theme.usage')); return; }
  const auth = createAuthRef();
  const result = await (params.action === 'snapshot' ? snapshot(params, auth) : restore(params, auth));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run, parseArgs, snapshot, restore, loadSnapshot, planRestore, downloadCss, KEYS, MODE_KEYS };
