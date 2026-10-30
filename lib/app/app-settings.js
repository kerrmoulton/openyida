'use strict';

const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');
const { createAuthRef, createYidaClient } = require('../core/yida-client');
const { buildApplicationSettingsUrls } = require('./application-entry-urls');

function parseArgs(args = []) {
  if (args.includes('--help') || args.includes('-h')) { return { help: true }; }
  const [appType, ...rest] = args;
  let section;
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json' && !json) { json = true; }
    else if (rest[i] === '--section' && section === undefined) { section = rest[++i]; }
    else { throw new CliError(t('app_settings.usage'), { code: 'CLI_USAGE_ERROR' }); }
  }
  if (!/^APP_[A-Za-z0-9_-]+$/.test(appType || '') || (rest.includes('--section') && !['theme', 'basic', 'data-card', 'cool-card'].includes(section))) {
    throw new CliError(t('app_settings.usage'), { code: 'CLI_USAGE_ERROR' });
  }
  return { appType, section };
}
async function execute({ appType, section }, client = createYidaClient({ authRef: createAuthRef() })) {
  const response = await client.get(`/${appType}/query/app/getAppIncludingAecpInfo.json`, { appKey: appType });
  if (response?.success !== true || response.__needLogin || response.__csrfExpired || !response.content
    || response.content.appType !== appType) {
    throw new CliError(t('app_settings.failed', response?.errorMsg || appType), { code: 'APP_SETTINGS_READ_FAILED' });
  }
  const urls = buildApplicationSettingsUrls({ appType, baseUrl: client.getAuthRef().baseUrl, systemLink: response.content.systemLink });
  const key = { theme: 'themeSettingsUrl', basic: 'basicSettingsUrl', 'data-card': 'dataCardManageUrl', 'cool-card': 'coolCardManageUrl' }[section];
  return { success: true, appType, urls, ...(key ? { url: urls[key] } : {}), runtimeVerified: false };
}
async function run(args = []) {
  const parsed = parseArgs(args);
  if (parsed.help) { console.log(t('app_settings.usage')); return; }
  console.log(JSON.stringify(await execute(parsed), null, 2));
}
module.exports = { run, execute, parseArgs };
