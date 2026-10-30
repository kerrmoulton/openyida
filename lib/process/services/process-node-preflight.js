'use strict';

const { createYidaClient } = require('../../core/yida-client');
const { CliError } = require('../../core/cli-error');
const { t } = require('../../core/i18n');
const { visitNodes, validateProcessNodes, invalid } = require('./process-node-contract');

// Factory discovery/invokeService success does not establish that an action
// can be loaded by the application's workflow designer. This probe is read-only.
async function preflightProcessNodes(authRef, appType, view, process) {
  validateProcessNodes(view, process);
  const actions = new Map();
  visitNodes(view.schema.children, 'children', node => {
    if (node.componentName !== 'ConnectorNode') { return; }
    const rules = node.props.connectorRules || {}, mode = Number(rules.connector?.mode ?? rules.mode ?? 5);
    if (![1, 3, 5, 9].includes(mode)) { invalid('connectorRules.connector.mode', '1 | 3 | 5 | 9'); }
    for (const key of ['connectorId', 'actionId']) {
      if (typeof rules[key] !== 'string' || !rules[key].trim()) { invalid('connectorRules.' + key, 'String'); }
    }
    const action = { connectorId: rules.connectorId, actionId: rules.actionId, mode };
    actions.set(JSON.stringify(action), action);
  });
  if (!actions.size) { return; }
  const client = createYidaClient({ authRef });
  for (const action of actions.values()) {
    let response;
    try {
      response = await client.get('/alibaba/web/' + encodeURIComponent(appType) + '/connector/getAction.json', action);
    } catch {
      response = null;
    }
    let content = response?.content;
    if (typeof content === 'string') { try { content = JSON.parse(content); } catch { content = null; } }
    if (response?.success !== true || !content || content.actionId !== action.actionId || content.connectorId !== action.connectorId) {
      throw new CliError(t('process_node.connector_unavailable', action.connectorId, action.actionId), {
        code: 'PROCESS_CONNECTOR_ACTION_UNAVAILABLE', details: { ...action, appType, remoteWrites: 0,
          platformErrorCode: response?.errorCode, verification: 'application_designer_action' },
      });
    }
  }
}

module.exports = { preflightProcessNodes };
