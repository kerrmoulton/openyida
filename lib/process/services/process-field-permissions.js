'use strict';

const { CliError } = require('../../core/cli-error');
const { t } = require('../../core/i18n');

const BEHAVIORS = new Set(['NORMAL', 'READONLY', 'HIDDEN', 'DISABLED', 'ENCRYPT']);

/** Normalize a permission list without changing field identities or hiding conflicts. */
function normalizeBehaviorList(list) {
  if (!Array.isArray(list)) {
    throw new CliError(t('process_errors.field_permissions_invalid'), { code: 'PROCESS_FIELD_PERMISSIONS_INVALID' });
  }
  const seen = new Set();
  return list.map(item => {
    const fieldId = item && item.fieldId;
    const fieldBehavior = item && (item.fieldBehavior || item.behavior) || 'READONLY';
    if (typeof fieldId !== 'string' || !fieldId.trim() || seen.has(fieldId) || !BEHAVIORS.has(fieldBehavior)) {
      throw new CliError(t('process_errors.field_permissions_invalid'), {
        code: 'PROCESS_FIELD_PERMISSIONS_INVALID', details: { fieldId, fieldBehavior },
      });
    }
    seen.add(fieldId);
    return { fieldId, fieldBehavior };
  }).sort((a, b) => a.fieldId.localeCompare(b.fieldId));
}

/** Match the platform adapter: runtime permissions live in flowConfig, keyed by node ID. */
function buildFlowConfig(viewJson) {
  const flowConfig = {};
  function visit(nodes) {
    (nodes || []).forEach(node => {
      const list = node.props && node.props.formConfig && node.props.formConfig.behaviorList;
      if (list !== undefined) {
        const nodeId = node.componentName === 'ApplyNode' ? 'sid_instStart' : node.id;
        if (!nodeId || Object.prototype.hasOwnProperty.call(flowConfig, nodeId)) {
          throw new CliError(t('process_errors.field_permissions_invalid'), { code: 'PROCESS_FIELD_PERMISSION_NODE_INVALID' });
        }
        flowConfig[nodeId] = normalizeBehaviorList(list);
      }
      visit(node.children);
    });
  }
  visit(viewJson.schema.children);
  const detail = viewJson.globalSetting && viewJson.globalSetting.behaviorList;
  if (detail && detail.length) { flowConfig.sid_instDetail = normalizeBehaviorList(detail); }
  return flowConfig;
}

/** Verify the saved view's field permissions independently from graph and action checks. */
function verifyFieldPermissions(expected, actual, errors) {
  let wanted;
  let observed;
  try {
    wanted = buildFlowConfig(expected);
    observed = buildFlowConfig(actual);
  } catch (error) {
    errors.push({ code: 'PROCESS_PLATFORM_VIEW_FIELD_PERMISSIONS_INVALID', causeCode: error.code });
    return;
  }
  Object.keys(wanted).forEach(nodeId => {
    const actualFields = new Map((observed[nodeId] || []).map(item => [item.fieldId, item.fieldBehavior]));
    if (wanted[nodeId].some(item => actualFields.get(item.fieldId) !== item.fieldBehavior)) {
      errors.push({ code: 'PROCESS_PLATFORM_VIEW_FIELD_PERMISSIONS_MISMATCH', nodeId,
        expected: wanted[nodeId], actual: observed[nodeId] || null });
    }
  });
}

/** Make an explicitly editable subtable column usable while respecting explicit parent restrictions. */
function completeSubtablePermissions(compiled, fields) {
  const byId = new Map(fields.map(field => [field.fieldId, field]));
  function complete(list) {
    const configured = normalizeBehaviorList(list);
    const rules = new Map(configured.map(item => [item.fieldId, item]));
    configured.filter(item => item.fieldBehavior === 'NORMAL').forEach(item => {
      const field = byId.get(item.fieldId);
      (field ? field.fieldPath.slice(0, -1) : []).forEach(parentId => {
        const parent = rules.get(parentId);
        if (parent && parent.fieldBehavior !== 'NORMAL') {
          throw new CliError(t('process_errors.field_permissions_invalid'), {
            code: 'PROCESS_PERMISSION_CONTAINER_CONFLICT', details: { fieldId: item.fieldId, parentFieldId: parentId },
          });
        }
        rules.set(parentId, { fieldId: parentId, fieldBehavior: 'NORMAL' });
      });
    });
    return [...rules.values()];
  }
  function visit(nodes, childKey) {
    (nodes || []).forEach(node => {
      const config = node.props && node.props.formConfig;
      if (config && config.behaviorList) { config.behaviorList = complete(config.behaviorList); }
      visit(node[childKey], childKey);
    });
  }
  visit(compiled.viewJson.schema.children, 'children');
  visit(compiled.processJson.nodes, 'childNodes');
  compiled.processJson.flowConfig = buildFlowConfig(compiled.viewJson);
}

module.exports = { normalizeBehaviorList, buildFlowConfig, verifyFieldPermissions, completeSubtablePermissions };
