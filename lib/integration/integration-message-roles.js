'use strict';

const { isDeepStrictEqual } = require('util');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');

// SendMessageSetter uses roleCode/roleName, unlike approval roles (id/roleType).
function messageRoles(node) {
  const roles = node.toRoles === undefined ? node.roles : node.toRoles;
  if (roles === undefined) { return []; }
  if (!Array.isArray(roles) || roles.some(role => !role || typeof role !== 'object'
    || Array.isArray(role) || !['string', 'number'].includes(typeof (role.roleCode || role.id))
    || !String(role.roleCode || role.id || '').trim())) {
    throw new CliError(t('integration.message_roles_invalid'), { code: 'INTEGRATION_MESSAGE_ROLES_INVALID' });
  }
  if (roles.length && node.messageType && node.messageType !== 'NORMAL') {
    throw new CliError(t('integration.message_roles_invalid'), { code: 'INTEGRATION_MESSAGE_ROLES_INVALID' });
  }
  return roles.map(role => ({ roleCode: String(role.roleCode || role.id).trim(),
    roleName: String(role.roleName || role.name || role.label || '') }));
}

function projectMessageRoles(root) {
  const output = [];
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) { return; }
    seen.add(value);
    if (value.componentName === 'SendMessageNode') {
      const rules = value.props && value.props.sendMessageRules || {};
      output.push({ nodeId: value.id, roles: messageRoles(rules) });
    }
    Object.values(value).forEach(visit);
  }
  visit(root);
  return output.sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId)));
}

function verifyMessageRoles(detail, expected) {
  if (!expected || !expected.length) { return 'NOT_REQUESTED'; }
  if (!isDeepStrictEqual(projectMessageRoles(detail), expected)) {
    throw new CliError(t('integration.message_roles_readback_mismatch'), {
      code: 'INTEGRATION_READBACK_MESSAGE_ROLES_MISMATCH',
    });
  }
  return 'EXACT';
}

module.exports = { messageRoles, projectMessageRoles, verifyMessageRoles };
