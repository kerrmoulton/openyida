#!/usr/bin/env node
/**
 * configure-process.js - 宜搭流程规则配置命令
 *
 * 用法：openyida configure-process <appType> <formUuid> <processDefinitionFile> [processCode]
 *
 * 功能：
 *   根据流程定义 JSON 文件，自动配置宜搭流程表单的审批流程。
 *   支持条件分支、嵌套分支、审批节点、字段权限、抄送节点、跳转规则。
 *
 * 核心流程：
 *   1. 获取 processCode（优先使用传入参数，否则通过 switchFormType + getAppPlatFormParam 自动获取）
 *   2. 查询流程版本列表，获取当前已发布版本的 processId
 *   3. 创建新流程版本草稿
 *   4. 根据流程定义 JSON 构建 processJson 和 viewJson（严格匹配宜搭真实格式）
 *   5. 调用 saveProcessById 保存流程
 *   6. 调用 publishProcessById 发布流程
 */

'use strict';

const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const {
  loadCookieData,
  triggerLogin,
  resolveBaseUrl,
  httpPost,
  httpGet,
} = require('../core/utils');
const { t } = require('../core/i18n');
const { buildYidaI18n } = require('../core/yida-i18n');
const { warn } = require('../core/chalk');

// ── 操作符映射（基于浏览器捕获的真实数据）────────────

const OP_CODE_TO_DISPLAY = {
  Equal: '等于',
  NotEqual: '不等于',
  Contains: '包含',
  NotContain: '不包含',
  IsEmpty: '为空',
  IsNotEmpty: '不为空',
  GreaterThan: '大于',
  Bigger: '大于',
  GreaterThanOrEqual: '大于等于',
  LessThan: '小于',
  LessThanOrEqual: '小于等于',
  In: '属于',
  NotIn: '不属于',
};

const COMPONENT_TO_RULE_TYPE = {
  TextField: 'rule_text',
  TextareaField: 'rule_text',
  NumberField: 'rule_number',
  SelectField: 'rule_select',
  RadioField: 'rule_radio',
  DateField: 'rule_date',
  EmployeeField: 'rule_employee',
};

// ── 辅助函数 ─────────────────────────────────────────

function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let nodeIdCounter = 1;
function generateNodeId() {
  return 'node_oc' + Date.now().toString(36) + (nodeIdCounter++).toString(36);
}

function i18n(zhText, enText, jaText) {
  return buildYidaI18n(zhText, {
    en_US: enText || zhText,
    ja_JP: jaText || zhText,
  });
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeList(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function pickFirstDefined() {
  for (let i = 0; i < arguments.length; i++) {
    if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') {
      return arguments[i];
    }
  }
  return undefined;
}

function getEntityId(item) {
  if (typeof item === 'string' || typeof item === 'number') {
    return String(item);
  }
  if (!isPlainObject(item)) {
    return '';
  }
  return String(pickFirstDefined(item.id, item.userId, item.workNo, item.value, item.uuid, item.roleId, item.code) || '');
}

function getEntityLabel(item, id) {
  if (!isPlainObject(item)) {
    return id;
  }
  return String(pickFirstDefined(item.label, item.name, item.nickName, item.userName, item.title, id) || id);
}

function normalizeApprovalMode(value) {
  const mode = String(value || 'all');
  const aliases = {
    countersign: 'all',
    counterSign: 'all',
    and: 'all',
    all: 'all',
    or: 'or',
    any: 'or',
    one: 'or',
    oneByOne: 'oneByOne',
    serial: 'oneByOne',
    sequence: 'oneByOne',
  };
  return aliases[mode] || mode;
}

function createBaseApproverRules(type, description, approver) {
  return {
    type: type,
    mode: approver.mode || 'ApprovalNode_rules_only',
    approverList: approver.approverList || [{ type: 'ext_target_approval' }],
    multiApproverType: normalizeApprovalMode(approver.multiApproverType || approver.approvalMode || 'all'),
    conditionalMode: approver.conditionalMode || 'conditional',
    description: description,
  };
}

function getFriendlyApproverKind(approver) {
  if (typeof approver === 'string') {
    const text = approver.trim();
    if (!text || text === 'originator' || text === 'self' || text === 'starter' || text === '发起人') {
      return 'originator';
    }
    return null;
  }
  if (!isPlainObject(approver)) {
    return null;
  }
  const rawKind = String(approver.kind || approver.approverType || approver.type || '').trim();
  if (!rawKind || rawKind.indexOf('ext_target_') === 0) {
    return null;
  }
  const normalized = rawKind.toLowerCase().replace(/[-_\s]/g, '');
  const kindMap = {
    originator: 'originator',
    self: 'originator',
    starter: 'originator',
    user: 'user',
    users: 'user',
    member: 'user',
    members: 'user',
    person: 'user',
    employee: 'user',
    designee: 'user',
    specifiedmember: 'user',
    role: 'role',
    roles: 'role',
    deptleader: 'deptLeader',
    departmentleader: 'deptLeader',
    departmenthead: 'deptLeader',
    supervisor: 'deptLeader',
    manager: 'deptLeader',
    directleader: 'directLeader',
    directsupervisor: 'directLeader',
  };
  return kindMap[normalized] || null;
}

function normalizeUserApprovers(approver) {
  const source = normalizeList(
    pickFirstDefined(
      approver.users,
      approver.members,
      approver.employees,
      approver.userIds,
      approver.ids,
      approver.approvals,
      approver.value
    )
  );
  return source.map(function (item) {
    const id = getEntityId(item);
    if (!id) {
      throw new Error('审批人 user 配置缺少 id/userId/value');
    }
    const user = {
      id: id,
      label: getEntityLabel(item, id),
      type: isPlainObject(item) ? (item.type || 'employee') : 'employee',
      roleType: isPlainObject(item) ? (item.roleType || 'DINGTALK') : 'DINGTALK',
    };
    if (isPlainObject(item) && item.avatar) {
      user.avatar = item.avatar;
    }
    return user;
  });
}

function normalizeRoleApprovers(approver) {
  const source = normalizeList(
    pickFirstDefined(
      approver.roles,
      approver.roleIds,
      approver.ids,
      approver.approvals,
      approver.value
    )
  );
  return source.map(function (item) {
    const id = getEntityId(item);
    if (!id) {
      throw new Error('审批人 role 配置缺少 id/uuid/roleId/value');
    }
    return {
      id: id,
      label: getEntityLabel(item, id),
      type: isPlainObject(item) ? (item.type || 'role') : 'role',
      roleType: isPlainObject(item)
        ? (item.roleType || approver.roleType || 'YIDA')
        : (approver.roleType || 'YIDA'),
    };
  });
}

function buildMultiRoles(roles) {
  const grouped = {};
  roles.forEach(function (role) {
    const roleType = role.roleType || 'YIDA';
    if (!grouped[roleType]) {
      grouped[roleType] = [];
    }
    grouped[roleType].push(role.id);
  });
  return Object.keys(grouped).map(function (roleType) {
    return {
      roleId: grouped[roleType],
      roleExtType: roleType,
    };
  });
}

function getApproverSource(approver, direct) {
  const value = pickFirstDefined(
    approver.source,
    approver.originator,
    approver.userIdVar,
    direct ? approver.directSupervisorSource : approver.supervisorSource,
    'originator'
  );
  const label = pickFirstDefined(
    approver.sourceLabel,
    approver.originatorLabel,
    value === 'originator' ? '发起人' : value
  );
  return {
    value: String(value),
    label: String(label),
  };
}

function formatLevelDescription(sourceLabel, level, direct) {
  return sourceLabel + '的第' + level + '级' + (direct ? '直属主管' : '主管');
}

function buildOriginatorApproverConfig(node, approver) {
  const raw = isPlainObject(approver) ? approver : {};
  return {
    approvalType: 'ext_target_approval_originator',
    approvals: [['originator']],
    processProps: raw.processProps || raw.props || {},
    approverRules: Object.assign(
      createBaseApproverRules('ext_target_approval_originator', raw.description || '发起人本人', raw),
      raw.approverRules || {}
    ),
    description: raw.nodeDescription || node.description || '请选择审批人',
    carbonReceiver: { type: 'VARIABLE', value: [['originator']] },
  };
}

function buildUserApproverConfig(node, approver) {
  const users = normalizeUserApprovers(approver);
  if (users.length === 0) {
    throw new Error('审批人 user 配置至少需要一个 users/userIds/approvals');
  }
  const userIds = users.map(function (user) { return user.id; });
  const description = approver.description || users.map(function (user) { return user.label; }).join(', ');
  const approvalMode = normalizeApprovalMode(approver.multiApproverType || approver.approvalMode || 'all');
  const approverRules = Object.assign(
    createBaseApproverRules('ext_target_approval', description, approver),
    {
      approvals: users,
      approvalType_ext_target_approval: approvalMode,
    },
    approver.approverRules || {}
  );
  return {
    approvalType: 'ext_target_approval',
    approvals: userIds,
    processProps: Object.assign({ multiApprove: approvalMode }, approver.processProps || approver.props || {}),
    approverRules: approverRules,
    description: approver.nodeDescription || node.description || '请选择审批人',
    carbonReceiver: { type: 'NORMAL', value: userIds },
  };
}

function buildRoleApproverConfig(node, approver) {
  const roles = normalizeRoleApprovers(approver);
  if (roles.length === 0) {
    throw new Error('审批人 role 配置至少需要一个 roles/roleIds/approvals');
  }
  const roleIds = roles.map(function (role) { return role.id; });
  const description = approver.description || roles.map(function (role) { return role.label; }).join(', ');
  const approvalMode = normalizeApprovalMode(approver.multiApproverType || approver.approvalMode || 'all');
  const approverRules = Object.assign(
    createBaseApproverRules('ext_target_approval_role', description, approver),
    {
      roles: roles,
      approvalType_ext_target_approval_role: approvalMode,
    },
    approver.approverRules || {}
  );
  return {
    approvalType: 'ext_target_approval_role',
    processProps: Object.assign({
      multiRoles: buildMultiRoles(roles),
      multiApprove: approvalMode,
    }, approver.processProps || approver.props || {}),
    approverRules: approverRules,
    description: approver.nodeDescription || node.description || '请选择审批人',
    carbonReceiver: { type: 'ROLE', value: roleIds },
  };
}

function buildDeptLeaderApproverConfig(node, approver) {
  const source = getApproverSource(approver, false);
  const level = String(pickFirstDefined(approver.level, approver.supervisorLevel, 1));
  const approvalMode = normalizeApprovalMode(approver.multiApproverType || approver.approvalMode || 'all');
  const needLeaderReplace = pickFirstDefined(approver.needLeaderReplace, true);
  const ignoreNoLeaderDept = pickFirstDefined(approver.ignoreNoLeaderDept, false);
  const description = approver.description || formatLevelDescription(source.label, level, false);
  const approverRules = Object.assign(
    createBaseApproverRules('ext_target_dept_leader', description, approver),
    {
      approvalType_ext_target_dept_leader: approvalMode,
      supervisorType: source,
      supervisorLevel: level,
      ignoreNoLeaderDept: String(ignoreNoLeaderDept),
      needLeaderReplace: Boolean(needLeaderReplace),
    },
    approver.approverRules || {}
  );
  return {
    approvalType: 'ext_target_dept_leader',
    processProps: Object.assign({
      key: 'DeptLeaderApproverRule_1.0.0',
      userIdVar: source.value,
      reportLevel: Number(level),
      ignoreNoLeaderDept: String(ignoreNoLeaderDept),
      needLeaderReplace: String(Boolean(needLeaderReplace)),
      multiApprove: approvalMode,
    }, approver.processProps || approver.props || {}),
    approverRules: approverRules,
    description: approver.nodeDescription || node.description || '请选择审批人',
    carbonReceiver: {
      type: 'MANAGER',
      value: {
        originator: source.value,
        level: Number(level),
      },
    },
  };
}

function buildDirectLeaderApproverConfig(node, approver) {
  const source = getApproverSource(approver, true);
  const level = String(pickFirstDefined(approver.level, approver.directSupervisorLevel, 1));
  const approvalMode = normalizeApprovalMode(approver.multiApproverType || approver.approvalMode || 'all');
  const needDeptLeaderReplace = pickFirstDefined(approver.needDeptLeaderReplace, true);
  const description = approver.description || formatLevelDescription(source.label, level, true);
  const approverRules = Object.assign(
    createBaseApproverRules('ext_target_direct_leader', description, approver),
    {
      approvalType_ext_target_direct_leader: approvalMode,
      directSupervisorType: source,
      directSupervisorLevel: level,
      needDeptLeaderReplace: Boolean(needDeptLeaderReplace),
    },
    approver.approverRules || {}
  );
  return {
    approvalType: 'ext_target_direct_leader',
    processProps: Object.assign({
      key: 'DirectLeaderApproverRule_1.0.0',
      userIdVar: source.value,
      reportLevel: Number(level),
      needDeptLeaderReplace: String(Boolean(needDeptLeaderReplace)),
      multiApprove: approvalMode,
    }, approver.processProps || approver.props || {}),
    approverRules: approverRules,
    description: approver.nodeDescription || node.description || '请选择审批人',
  };
}

function buildFriendlyApproverConfig(node, approver) {
  const kind = getFriendlyApproverKind(approver);
  if (!kind) {
    return null;
  }
  const raw = isPlainObject(approver) ? approver : {};
  if (kind === 'originator') {
    return buildOriginatorApproverConfig(node, raw);
  }
  if (kind === 'user') {
    return buildUserApproverConfig(node, raw);
  }
  if (kind === 'role') {
    return buildRoleApproverConfig(node, raw);
  }
  if (kind === 'deptLeader') {
    return buildDeptLeaderApproverConfig(node, raw);
  }
  if (kind === 'directLeader') {
    return buildDirectLeaderApproverConfig(node, raw);
  }
  return null;
}

// ── 构建审批/抄送动作列表 ────────────────────────────

function buildActions() {
  const actionDefs = [
    { action: 'agree', zh: '同意', en: 'Agree', ja: '同意', hidden: false },
    { action: 'disagree', zh: '拒绝', en: 'Disagree', ja: '拒否', hidden: false },
    { action: 'save', zh: '保存', en: 'Save', ja: '保存', hidden: true },
    { action: 'forward', zh: '转交', en: 'Forward', ja: '転送', hidden: true },
    { action: 'append', zh: '加签', en: 'Append', ja: '承認者を追加', hidden: true },
    { action: 'return', zh: '退回', en: 'Return', ja: '差し戻し', hidden: true },
  ];

  return actionDefs.map(function (def) {
    return {
      hidden: def.hidden,
      name: i18n(def.zh, def.en, def.ja),
      action: def.action,
      text: i18n(def.zh, def.en, def.ja),
      alias: i18n(def.zh, def.en, def.ja),
    };
  });
}

// ── 构建条件规则（严格匹配宜搭真实格式）─────────────

function buildConditionRules(rules, logic) {
  const conditionCode = logic === 'OR' ? '||' : '&&';
  const groupId = 'group-' + generateUuid();

  const builtRules = rules.map(function (rule) {
    const opDisplay = OP_CODE_TO_DISPLAY[rule.op] || rule.op;
    const ruleType = COMPONENT_TO_RULE_TYPE[rule.componentType] || 'rule_text';

    const ruleObj = {
      id: rule.fieldId,
      op: opDisplay,
      operators: [],
      value: rule.value,
      componentType: rule.componentType || 'TextField',
      ruleId: 'item-' + generateUuid(),
      parentId: groupId,
      extValue: 'value',
      ruleValue: rule.value,
      name: rule.fieldName || rule.fieldId,
      valueType: 'literal',
      ruleType: ruleType,
      opCode: rule.op,
    };

    // NumberField 需要 formula 字段，宜搭服务端用它构建数字比较公式
    if (rule.componentType === 'NumberField') {
      const opSymbolMap = {
        GreaterThan: '>',
        Bigger: '>',
        GreaterThanOrEqual: '>=',
        LessThan: '<',
        LessThanOrEqual: '<=',
        Equal: '==',
        NotEqual: '!=',
      };
      const opSymbol = opSymbolMap[rule.op] || '==';
      ruleObj.formula = '${' + rule.fieldId + '}' + opSymbol + rule.value;
    }

    return ruleObj;
  });

  return {
    condition: logic === 'OR' ? 'OR' : 'AND',
    rules: builtRules,
    ruleId: groupId,
    conditionCode: conditionCode,
  };
}

// ── 构建跳转规则（routeRule）──────────────────────────

function buildRouteRule(routeRuleDefs, currentNodeId, nodeNameToIdMap) {
  if (!routeRuleDefs || routeRuleDefs.length === 0) {
    return {
      rules: [],
      triggerRule: 'n',
      ruleIfMiss: 'terminate',
      defaultNextId: [],
    };
  }

  const rules = routeRuleDefs.map(function (ruleDef, index) {
    // 解析跳转目标
    const targetNodeId = nodeNameToIdMap[ruleDef.jumpTo];
    if (!targetNodeId) {
      warn('  ⚠️ routeRule 跳转目标 "' + ruleDef.jumpTo + '" 未找到对应节点');
      return null;
    }

    // 构建条件规则
    const conditionGroupId = 'group-' + generateUuid();
    const conditionRules = [];

    if (ruleDef.when === 'disagree' || ruleDef.when === 'agree') {
      // 基于审批结果的跳转（内置虚拟字段 approvalResult）
      conditionRules.push({
        componentType: 'SelectField',
        id: 'approvalResult',
        extValue: 'value',
        name: '审批结果',
        op: '等于',
        opCode: 'Equal',
        parentId: conditionGroupId,
        ruleId: 'item-' + generateUuid(),
        ruleType: 'rule_text',
        ruleValue: ruleDef.when,
        value: ruleDef.when,
        valueType: 'literal',
      });
    } else if (ruleDef.fieldRules && ruleDef.fieldRules.length > 0) {
      // 基于表单字段的跳转条件
      ruleDef.fieldRules.forEach(function (fieldRule) {
        const opDisplay = OP_CODE_TO_DISPLAY[fieldRule.op] || fieldRule.op;
        const ruleType = COMPONENT_TO_RULE_TYPE[fieldRule.componentType] || 'rule_text';
        conditionRules.push({
          componentType: fieldRule.componentType,
          id: fieldRule.fieldId,
          extValue: 'value',
          name: fieldRule.fieldName,
          op: opDisplay,
          opCode: fieldRule.op,
          parentId: conditionGroupId,
          ruleId: 'item-' + generateUuid(),
          ruleType: ruleType,
          ruleValue: fieldRule.value,
          value: fieldRule.value,
          valueType: 'literal',
        });
      });
    }

    const conditionNodeId = generateNodeId();
    return {
      type: 'condition',
      nodeId: conditionNodeId,
      prevId: currentNodeId,
      nextId: [targetNodeId],
      props: {
        calculate: 'condition',
        isDefault: false,
        conditions: {
          condition: (ruleDef.logic || 'AND'),
          conditionCode: (ruleDef.logic === 'OR' ? '||' : '&&'),
          ruleId: conditionGroupId,
          rules: conditionRules,
        },
        priority: index + 1,
      },
    };
  }).filter(function (rule) { return rule !== null; });

  return {
    rules: rules,
    triggerRule: rules.length > 0 ? 'y' : 'n',
    ruleIfMiss: 'terminate',
    defaultNextId: [],
  };
}

// ── 递归分配 nodeId ──────────────────────────────────

function assignNodeIdsRecursive(nodes, nameToIdMap) {
  nodes.forEach(function (node) {
    if (node.type === 'route') {
      node._nodeId = generateNodeId();
      const conditions = node.conditions || [];
      conditions.forEach(function (cond) {
        cond._nodeId = generateNodeId();
        if (cond.childNodes && cond.childNodes.length > 0) {
          assignNodeIdsRecursive(cond.childNodes, nameToIdMap);
        }
      });
    } else if (node.type === 'parallel') {
      node._nodeId = generateNodeId();
      if (node.name) {
        nameToIdMap[node.name] = node._nodeId;
      }
      const branches = getParallelBranches(node);
      branches.forEach(function (branch) {
        branch._nodeId = generateNodeId();
        const childNodes = getBranchChildNodes(branch);
        if (childNodes.length > 0) {
          assignNodeIdsRecursive(childNodes, nameToIdMap);
        }
      });
    } else {
      node._nodeId = generateNodeId();
      if (node.name) {
        nameToIdMap[node.name] = node._nodeId;
      }
    }
  });
}

// ── 递归构建节点 ─────────────────────────────────────

function buildNodeListRecursive(nodes, exitNodeId, nameToIdMap) {
  const processNodes = [];
  const viewNodes = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextNodeId = i + 1 < nodes.length ? nodes[i + 1]._nodeId : exitNodeId;

    if (node.type === 'route') {
      const routeResult = buildRouteNode(node, nextNodeId, nameToIdMap);
      processNodes.push(routeResult.processNode);
      viewNodes.push(routeResult.viewNode);
    } else if (node.type === 'parallel') {
      const parallelResult = buildParallelNode(node, nextNodeId, nameToIdMap);
      processNodes.push(parallelResult.processNode);
      viewNodes.push(parallelResult.viewNode);
    } else if (node.type === 'approval') {
      const approvalResult = buildApprovalNode(node, nextNodeId, nameToIdMap);
      processNodes.push(approvalResult.processNode);
      viewNodes.push(approvalResult.viewNode);
    } else if (node.type === 'carbon') {
      const carbonResult = buildCarbonNode(node, nextNodeId);
      processNodes.push(carbonResult.processNode);
      viewNodes.push(carbonResult.viewNode);
    }
  }

  return { processNodes, viewNodes };
}

function wireChildProcessNodes(childProcessNodes, parentNodeId) {
  if (childProcessNodes.length === 0) {
    return;
  }
  childProcessNodes[0].prevId = parentNodeId;
  for (let i = 1; i < childProcessNodes.length; i++) {
    childProcessNodes[i].prevId = childProcessNodes[i - 1].nodeId;
  }
}

// ── 构建审批节点 ─────────────────────────────────────

function buildApproverConfig(node) {
  const friendlyApprover = buildFriendlyApproverConfig(node, node.approverConfig || node.approver);
  if (friendlyApprover) {
    return friendlyApprover;
  }

  const rawApprover = node.approverConfig || (node.approver && typeof node.approver === 'object' ? node.approver : null);
  if (rawApprover) {
    return {
      approvalType: rawApprover.approvalType || rawApprover.type || 'ext_target_approval_originator',
      approvals: rawApprover.approvals || [['originator']],
      processProps: rawApprover.processProps || rawApprover.props || {},
      approverRules: rawApprover.approverRules || {
        type: rawApprover.approvalType || rawApprover.type || 'ext_target_approval_originator',
        mode: 'ApprovalNode_rules_only',
        approverList: rawApprover.approverList || [{ type: 'ext_target_approval' }],
        multiApproverType: rawApprover.multiApproverType || 'all',
        conditionalMode: rawApprover.conditionalMode || 'conditional',
        description: rawApprover.description || '自定义审批人',
      },
      description: rawApprover.description || node.description || '请选择审批人',
      carbonReceiver: rawApprover.carbonReceiver,
    };
  }

  if (node.approvalType || node.approvals || node.approverRules || node.processProps) {
    return {
      approvalType: node.approvalType || 'ext_target_approval_originator',
      approvals: node.approvals || [['originator']],
      processProps: node.processProps || {},
      approverRules: node.approverRules || {
        type: node.approvalType || 'ext_target_approval_originator',
        mode: 'ApprovalNode_rules_only',
        approverList: [{ type: 'ext_target_approval' }],
        multiApproverType: 'all',
        conditionalMode: 'conditional',
        description: node.description || '自定义审批人',
      },
      description: node.description || '请选择审批人',
      carbonReceiver: node.carbonReceiver,
    };
  }

  return buildOriginatorApproverConfig(node, {});
}

function buildApprovalNode(node, nextNodeId, nameToIdMap) {
  const nodeId = node._nodeId;
  const routeRule = buildRouteRule(node.routeRules || [], nodeId, nameToIdMap);
  const approverConfig = buildApproverConfig(node);

  // 构建字段权限（formConfig.behaviorList）
  // 兼容两种输入格式：
  //   1. node.formConfig.behaviorList（推荐，与 SKILL.md 文档一致）
  //   2. node.fieldPermissions（旧格式，向后兼容）
  let formConfig = undefined;
  if (node.formConfig && node.formConfig.behaviorList && node.formConfig.behaviorList.length > 0) {
    const behaviorList = node.formConfig.behaviorList.map(function (fp) {
      return {
        fieldId: fp.fieldId,
        fieldBehavior: fp.fieldBehavior || fp.behavior || 'READONLY',
      };
    });
    formConfig = { behaviorList: behaviorList };
  } else if (node.fieldPermissions && node.fieldPermissions.length > 0) {
    const behaviorList = node.fieldPermissions.map(function (fp) {
      return {
        fieldId: fp.fieldId,
        fieldBehavior: fp.fieldBehavior || fp.behavior || 'READONLY',
      };
    });
    formConfig = { behaviorList: behaviorList };
  }

  const processNodeProps = {
    conditionalMode: 'conditional',
    actions: buildActions(),
    appendActions: buildActions(),
    openDigitalSign: false,
    noActionersType: 'stopProcess',
    routeRule: routeRule,
  };
  if (approverConfig.approvals !== undefined) {
    processNodeProps.approvals = approverConfig.approvals;
  }
  Object.assign(processNodeProps, approverConfig.processProps);
  if (formConfig) {
    processNodeProps.formConfig = formConfig;
  }

  const processNode = {
    name: i18n(node.name || '审批人', 'Approver', node.name || '承認者'),
    description: approverConfig.description,
    type: 'approval',
    approvalType: approverConfig.approvalType,
    nodeId: nodeId,
    prevId: '',
    nextId: [nextNodeId],
    props: processNodeProps,
    childNodes: [],
  };

  const viewNodeProps = {
    nodeName: 'ApprovalNode',
    name: i18n(node.name || '审批人', 'Approver', node.name || '承認者'),
    description: approverConfig.description,
    approverRules: approverConfig.approverRules,
    actions: {
      normalActions: buildActions(),
      appendActions: buildActions(),
    },
    routeRule: routeRule,
  };
  if (formConfig) {
    viewNodeProps.formConfig = formConfig;
  }

  const viewNode = {
    componentName: 'ApprovalNode',
    id: nodeId,
    props: viewNodeProps,
    title: i18n('审批人', 'Approver', '承認者'),
  };

  return { processNode, viewNode };
}

// ── 构建抄送节点 ─────────────────────────────────────

function buildCarbonNode(node, nextNodeId) {
  const nodeId = node._nodeId;
  const approverConfig = buildApproverConfig(node);
  const carbonReceiver = approverConfig.carbonReceiver || { type: 'VARIABLE', value: approverConfig.approvals || [['originator']] };

  const processNode = {
    name: i18n(node.name || '抄送人', 'CC', node.name || '共有先'),
    description: '',
    type: 'carbon',
    approvalType: approverConfig.approvalType,
    nodeId: nodeId,
    prevId: '',
    nextId: [nextNodeId],
    props: {
      conditionalMode: 'conditional',
      params: [
        { key: 'nodeId', value: nodeId },
        { key: 'instId', value: '#procInstId' },
        { key: 'userId', value: '#originator' },
        { key: 'receiver', value: carbonReceiver },
      ],
      ...approverConfig.processProps,
    },
    childNodes: [],
  };

  const viewNode = {
    componentName: 'CarbonNode',
    id: nodeId,
    props: {
      nodeName: 'CarbonNode',
      name: i18n(node.name || '抄送人', 'CC', node.name || '共有先'),
      description: node.description || '请选择抄送人',
      approverRules: approverConfig.approverRules,
    },
    title: i18n('抄送人', 'CC', '共有先'),
  };

  return { processNode, viewNode };
}

// ── 构建条件分支路由节点 ─────────────────────────────

function buildRouteNode(node, exitNodeId, nameToIdMap) {
  const routeNodeId = node._nodeId;
  const conditions = node.conditions || [];

  const conditionNodeIds = [];
  const conditionProcessNodes = [];
  const conditionViewNodes = [];

  // 构建每个条件分支
  conditions.forEach(function (cond, index) {
    const condNodeId = cond._nodeId;
    conditionNodeIds.push(condNodeId);

    // 递归构建条件分支内的子节点
    let childProcessNodes = [];
    let childViewNodes = [];
    if (cond.childNodes && cond.childNodes.length > 0) {
      const childResult = buildNodeListRecursive(cond.childNodes, exitNodeId, nameToIdMap);
      childProcessNodes = childResult.processNodes;
      childViewNodes = childResult.viewNodes;
      wireChildProcessNodes(childProcessNodes, condNodeId);
    }

    // 构建条件规则
    const conditionProps = {
      priority: index + 1,
      isDefault: false,
    };

    // 构建条件规则
    const condRules = buildConditionRules(cond.rules || [], cond.logic || 'AND');
    const condDescription = cond.name || '';

    if (cond.rules && cond.rules.length > 0) {
      conditionProps.conditions = {
        condition: condRules.condition || 'AND',
        rules: condRules.rules || [],
        ruleId: condRules.ruleId || 'group-' + generateUuid(),
        conditionCode: condRules.conditionCode || '&&',
      };
      conditionProps.calculate = 'condition';
    }

    // 条件节点的 nextId：如果有子节点，指向第一个子节点；否则指向出口节点
    const condNextId = (childProcessNodes.length > 0)
      ? [childProcessNodes[0].nodeId]
      : [exitNodeId];

    const condProcessNode = {
      name: i18n(condDescription || '条件', 'Condition', condDescription || '条件'),
      description: '',
      type: 'condition',
      nodeId: condNodeId,
      prevId: routeNodeId,
      nextId: condNextId,
      props: conditionProps,
      childNodes: childProcessNodes.map(clonePlain),
    };

    conditionProcessNodes.push(condProcessNode);

    // 构建 condition viewNode（带嵌套 conditions 包装）
    const condViewNode = {
      componentName: 'ConditionNode',
      id: condNodeId,
      props: {
        name: i18n(condDescription || '条件', 'Condition', condDescription || '条件'),
        description: '',
        conditions: {
          calculate: 'condition',
          conditions: {
            condition: condRules.condition || 'AND',
            rules: condRules.rules || [],
            ruleId: condRules.ruleId || 'group-' + generateUuid(),
            conditionCode: condRules.conditionCode || '&&',
          },
          isDefault: false,
          priority: index + 1,
          description: condDescription,
        },
      },
    };

    if (childViewNodes.length > 0) {
      condViewNode.children = childViewNodes;
    }

    conditionViewNodes.push(condViewNode);
  });

  // 添加默认条件分支（"其他情况"）
  const defaultCondNodeId = generateNodeId();
  conditionNodeIds.push(defaultCondNodeId);

  const defaultCondProcessNode = {
    name: i18n('其他情况', 'Other situations', 'その他の場合'),
    description: '',
    type: 'condition',
    nodeId: defaultCondNodeId,
    prevId: routeNodeId,
    nextId: [exitNodeId],
    props: {
      priority: 2147483647,
      isDefault: true,
    },
    childNodes: [],
  };

  conditionProcessNodes.push(defaultCondProcessNode);

  const defaultCondViewNode = {
    componentName: 'ConditionNode',
    id: defaultCondNodeId,
    props: {
      isDefault: true,
      buttons: [{ name: '关闭' }],
      name: i18n('其他情况', 'Other situations', 'その他の場合'),
      description: '',
    },
  };

  conditionViewNodes.push(defaultCondViewNode);

  // 构建 route processNode
  const routeProcessNode = {
    name: i18n('ConditionNode', 'ConditionNode', '条件ノード'),
    description: '',
    type: 'route',
    nodeId: routeNodeId,
    prevId: '',
    nextId: conditionNodeIds,
    props: { outgoingType: 'priority' },
    childNodes: conditionProcessNodes,
  };

  // 构建 route viewNode（ConditionContainer）
  const routeViewNode = {
    componentName: 'ConditionContainer',
    id: routeNodeId,
    props: {},
    title: '条件分支',
    children: conditionViewNodes,
  };

  return { processNode: routeProcessNode, viewNode: routeViewNode };
}

// ── 构建并行分支节点 ────────────────────────────────

function getParallelBranches(node) {
  const branches = node.branches || node.conditions || node.parallelBranches || [];
  return Array.isArray(branches) ? branches : [];
}

function getBranchChildNodes(branch) {
  const childNodes = branch.childNodes || branch.nodes || branch.children || [];
  return Array.isArray(childNodes) ? childNodes : [];
}

function buildAllDataConditionProps(branch, priority, isDefault) {
  return {
    calculate: 'all',
    conditions: {
      condition: 'AND',
      rules: [
        {
          id: 'originator',
          op: '等于',
          operators: [],
          componentType: 'EmployeeField',
        },
      ],
    },
    isDefault: isDefault,
    priority: priority,
    description: branch.description || '所有数据均可进入',
  };
}

function buildParallelBranchConditionProps(branch, index) {
  const priority = Number(pickFirstDefined(branch.priority, index + 1));
  const isDefault = Boolean(branch.isDefault);
  const rawConditions = branch.conditionProps
    || branch.condition
    || (isPlainObject(branch.conditions) ? branch.conditions : null);

  if (isPlainObject(rawConditions) && rawConditions.calculate) {
    const props = Object.assign({}, rawConditions, {
      isDefault: isDefault,
      priority: priority,
    });
    if (!props.description && branch.description) {
      props.description = branch.description;
    }
    return props;
  }

  if (isPlainObject(rawConditions) && (rawConditions.rules || rawConditions.condition)) {
    return {
      calculate: 'condition',
      conditions: rawConditions,
      isDefault: isDefault,
      priority: priority,
      description: branch.description || branch.name || '',
    };
  }

  if (branch.rules && branch.rules.length > 0) {
    const condRules = buildConditionRules(branch.rules, branch.logic || 'AND');
    return {
      calculate: 'condition',
      conditions: {
        condition: condRules.condition || 'AND',
        rules: condRules.rules || [],
        ruleId: condRules.ruleId || 'group-' + generateUuid(),
        conditionCode: condRules.conditionCode || '&&',
      },
      isDefault: isDefault,
      priority: priority,
      description: branch.description || branch.name || '',
    };
  }

  return buildAllDataConditionProps(branch, priority, isDefault);
}

function buildParallelBranchProcessProps(conditionProps) {
  const props = {};
  if (conditionProps.isDefault !== undefined) {
    props.isDefault = conditionProps.isDefault;
  }
  if (conditionProps.conditions !== undefined) {
    props.conditions = clonePlain(conditionProps.conditions);
  }
  if (conditionProps.calculate !== undefined) {
    props.calculate = conditionProps.calculate;
  }
  if (conditionProps.expression !== undefined) {
    props.expression = conditionProps.expression;
  }
  return props;
}

function buildParallelNode(node, exitNodeId, nameToIdMap) {
  const parallelNodeId = node._nodeId;
  const branches = getParallelBranches(node);

  if (branches.length === 0) {
    throw new Error('parallel 节点至少需要一个 branches 分支');
  }

  const branchNodeIds = [];
  const branchProcessNodes = [];
  const branchViewNodes = [];

  branches.forEach(function (branch, index) {
    const branchNodeId = branch._nodeId;
    const branchName = branch.name || ('条件' + (index + 1));
    const branchConditionProps = buildParallelBranchConditionProps(branch, index);
    const childNodes = getBranchChildNodes(branch);

    branchNodeIds.push(branchNodeId);

    let childProcessNodes = [];
    let childViewNodes = [];
    if (childNodes.length > 0) {
      const childResult = buildNodeListRecursive(childNodes, exitNodeId, nameToIdMap);
      childProcessNodes = childResult.processNodes;
      childViewNodes = childResult.viewNodes;
      wireChildProcessNodes(childProcessNodes, branchNodeId);
    }

    const branchNextId = childProcessNodes.length > 0
      ? [childProcessNodes[0].nodeId]
      : [exitNodeId];

    const branchProcessNode = {
      name: i18n(branchName, 'Parallel branch', branchName),
      description: '',
      type: 'condition',
      nodeId: branchNodeId,
      prevId: parallelNodeId,
      nextId: branchNextId,
      props: buildParallelBranchProcessProps(branchConditionProps),
      childNodes: childProcessNodes.map(clonePlain),
    };

    branchProcessNodes.push(branchProcessNode);

    const branchViewNode = {
      componentName: 'ParallelNode',
      id: branchNodeId,
      props: {
        name: branchConditionProps.isDefault
          ? i18n(branchName, 'Other situations', branchName)
          : branchName,
        description: branch.description || '',
        conditions: clonePlain(branchConditionProps),
      },
    };

    if (branchConditionProps.isDefault) {
      branchViewNode.props.buttons = branch.buttons || [{ name: '关闭' }];
    }

    if (childViewNodes.length > 0) {
      branchViewNode.children = childViewNodes;
    }

    branchViewNodes.push(branchViewNode);
  });

  const parallelProcessNode = {
    name: i18n(node.name || 'ParallelNode', node.name || 'ParallelNode', node.name || 'ParallelNode'),
    description: '',
    type: 'route',
    nodeId: parallelNodeId,
    prevId: '',
    nextId: branchNodeIds,
    props: { outgoingType: 'multiple' },
    childNodes: branchProcessNodes,
  };

  const parallelViewNode = {
    componentName: 'ConditionContainer',
    id: parallelNodeId,
    props: {
      name: i18n(node.name || '并行分支', node.name || 'ParallelNode', node.name || '並行分岐'),
    },
    title: node.title || '并行分支',
    type: 'parallel',
    children: branchViewNodes,
  };

  return { processNode: parallelProcessNode, viewNode: parallelViewNode };
}

// ── 构建完整的 processJson 和 viewJson ──────────────

function buildProcessAndViewJson(definition, processCode, formUuid, baseUrl, appType) {
  const finishNodeId = generateNodeId();
  const nodes = definition.nodes || [];

  // 第一遍：递归分配 nodeId 并收集名称映射
  const nodeNameToIdMap = {};
  assignNodeIdsRecursive(nodes, nodeNameToIdMap);

  // 将结束节点加入映射
  nodeNameToIdMap['结束'] = finishNodeId;
  nodeNameToIdMap['finish'] = finishNodeId;
  nodeNameToIdMap['end'] = finishNodeId;

  // 第二遍：递归构建所有节点
  const middleResult = buildNodeListRecursive(nodes, finishNodeId, nodeNameToIdMap);

  // 设置顶层节点的 prevId
  if (middleResult.processNodes.length > 0) {
    middleResult.processNodes[0].prevId = 'sid_instStart';
    for (let mi = 1; mi < middleResult.processNodes.length; mi++) {
      middleResult.processNodes[mi].prevId = middleResult.processNodes[mi - 1].nodeId;
    }
  }

  const firstMiddleNodeId = middleResult.processNodes.length > 0
    ? middleResult.processNodes[0].nodeId
    : finishNodeId;

  // 组装发起节点
  const applyProcessNode = {
    name: i18n('发起', 'start', '開始'),
    description: '',
    type: 'apply',
    nodeId: 'sid_instStart',
    prevId: '',
    nextId: [firstMiddleNodeId],
    props: {},
    childNodes: [],
  };

  // 组装结束节点
  const finishProcessNode = {
    name: i18n('结束', 'end', '終了'),
    description: '',
    type: 'finish',
    nodeId: finishNodeId,
    prevId: '',
    nextId: [],
    props: {},
    childNodes: [],
  };

  // 组装 processJson
  const processNodes = [applyProcessNode];
  middleResult.processNodes.forEach(function (node) {
    processNodes.push(node);
  });
  processNodes.push(finishProcessNode);

  const defaultProcessDetailUrl = baseUrl + '/alibaba/web/' + appType + '/inst/taskDetail.htm';
  const defaultProcessMobileDetailUrl = baseUrl + '/alibaba/mobile/' + appType + '/inst/detail/taskDetail/';

  const processJson = {
    props: {
      allowWithdraw: true,
      allowCollaboration: true,
      allowTemporaryStorage: true,
      processCode: processCode,
      processDetailUrl: definition.processDetailUrl
        || (definition.detailUrls && (definition.detailUrls.web || definition.detailUrls.pc))
        || definition.customDetailPageUrl
        || defaultProcessDetailUrl,
      processInitUrl: baseUrl + '/alibaba/web/' + appType + '/inst/instStart.htm?processCode=' + processCode,
      processMobileDetailUrl: definition.processMobileDetailUrl
        || (definition.detailUrls && definition.detailUrls.mobile)
        || (definition.customDetailPageUrl ? definition.customDetailPageUrl + '?procInsId=' : null)
        || defaultProcessMobileDetailUrl,
      bindingForm: formUuid,
      stopAssociationRulesIfFailed: false,
      noRecordRecall: false,
      untimedRule: [],
    },
    nodes: processNodes,
    flowConfig: {},
    formulaRules: [],
    approvalSummary: [],
    nodeI18nKeyMap: {},
  };

  // 组装 viewJson
  const viewChildren = [];

  viewChildren.push({
    componentName: 'ApplyNode',
    id: generateNodeId(),
    props: {
      nodeName: 'ApplyNode',
      name: i18n('发起', 'start', '開始'),
    },
  });

  middleResult.viewNodes.forEach(function (node) {
    viewChildren.push(node);
  });

  viewChildren.push({
    componentName: 'EndNode',
    id: finishNodeId,
    props: {
      name: i18n('结束', 'end', '終了'),
    },
  });

  const viewJson = {
    schema: {
      componentName: 'CanvasEngine',
      id: generateNodeId(),
      props: {},
      children: viewChildren,
    },
    bindingForm: formUuid,
    formulaRules: [],
    globalSetting: {
      enableSignature: false,
      stopAssociationRulesIfFailed: false,
      nodeMerge: false,
      originatorMerge: false,
      allNodeMerge: false,
      behaviorList: [],
      needOpenDigitalSignNodes: [],
      approvalSummary: [],
      noRecordRecall: false,
      untimedRule: [],
    },
  };

  return { processJson, viewJson };
}

// ── API 调用函数 ─────────────────────────────────────

function queryProcessVersions(authRef, appType, processCode, status) {
  const requestPath = '/alibaba/web/' + appType + '/query/process/pageProcessVersion.json'
    + '?_api=Process.getProcessVersionInfo&_mock=false'
    + '&_csrf_token=' + encodeURIComponent(authRef.csrfToken)
    + '&_locale_time_zone_offset=28800000'
    + '&processCode=' + encodeURIComponent(processCode)
    + '&appType=' + encodeURIComponent(appType)
    + '&status=' + (status || '')
    + '&pageIndex=1&pageSize=10'
    + '&orderByModifyTime=desc'
    + '&_stamp=' + Date.now();
  return httpGet(authRef.baseUrl, requestPath, null, authRef.cookies);
}

function switchFormType(authRef, appType, formUuid) {
  const requestPath = '/' + appType + '/query/formdesign/switchFormType.json'
    + '?_api=Nav.transformForm&_mock=false&_stamp=' + Date.now();
  const postData = querystring.stringify({
    _csrf_token: authRef.csrfToken,
    _locale_time_zone_offset: '28800000',
    toFormType: 'process',
    formUuid: formUuid,
  });
  return httpPost(authRef.baseUrl, requestPath, postData, authRef.cookies);
}

function getProcessCodeFromAppParam(authRef, appType, formUuid) {
  const requestPath = '/' + appType + '/query/app/getAppPlatFormParam.json'
    + '?_api=nattyFetch&_mock=false'
    + '&_csrf_token=' + encodeURIComponent(authRef.csrfToken)
    + '&_locale_time_zone_offset=28800000'
    + '&pageIndex=1&pageSize=50'
    + '&_stamp=' + Date.now();
  return httpGet(authRef.baseUrl, requestPath, null, authRef.cookies).then(function (result) {
    if (result.success && result.content && result.content.formNavigationList) {
      const navList = result.content.formNavigationList;
      for (let i = 0; i < navList.length; i++) {
        if (navList[i].formUuid === formUuid && navList[i].processCode) {
          return navList[i].processCode;
        }
      }
    }
    return null;
  });
}

function getProcessCodeFromSchema(authRef, appType, formUuid) {
  const requestPath = '/dingtalk/web/' + appType + '/query/formdesign/getFormSchema.json'
    + '?formUuid=' + encodeURIComponent(formUuid)
    + '&schemaVersion=V5';
  return httpGet(authRef.baseUrl, requestPath, null, authRef.cookies).then(function (result) {
    if (result.success && result.content) {
      const schemaStr = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      const matches = schemaStr.match(/TPROC[A-Za-z0-9_-]+/g);
      if (matches && matches.length > 0) {
        const unique = [];
        const seen = {};
        matches.forEach(function (m) {
          if (!seen[m]) { seen[m] = true; unique.push(m); }
        });
        return unique[0];
      }
    }
    return null;
  });
}

function newDraftProcess(authRef, appType, processCode, formUuid, processId, processVersion) {
  const requestPath = '/' + appType + '/query/simpleProcess/newDraftProcess.json';
  const postObj = {
    _csrf_token: authRef.csrfToken,
    _locale_time_zone_offset: '28800000',
    formUuid: formUuid,
    processCode: processCode,
  };
  if (processId) {postObj.processId = String(processId);}
  if (processVersion !== undefined && processVersion !== null) {postObj.processVersion = String(processVersion);}
  return httpPost(authRef.baseUrl, requestPath, querystring.stringify(postObj), authRef.cookies);
}

function saveProcessById(authRef, appType, formUuid, processCode, processId, processVersion, processJsonStr, viewJsonStr) {
  const requestPath = '/alibaba/web/' + appType + '/query/simpleProcess/saveProcessById.json';
  return httpPost(authRef.baseUrl, requestPath, querystring.stringify({
    _csrf_token: authRef.csrfToken,
    formUuid: formUuid,
    isOnline: 'true',
    json: processJsonStr,
    needReportLine: 'y',
    processCode: processCode,
    processId: String(processId),
    processVersion: String(processVersion),
    viewJson: viewJsonStr,
  }), authRef.cookies);
}

function publishProcessById(authRef, appType, formUuid, processCode, processId, processVersion) {
  const requestPath = '/alibaba/web/' + appType + '/query/simpleProcess/publishProcessById.json';
  return httpPost(authRef.baseUrl, requestPath, querystring.stringify({
    _csrf_token: authRef.csrfToken,
    formUuid: formUuid,
    processCode: processCode,
    processId: String(processId),
    processVersion: String(processVersion),
  }), authRef.cookies);
}

// ── 主流程 ───────────────────────────────────────────

async function run(args) {
  if (args.length < 3) {
    warn(t('configure_process.usage'));
    process.exit(1);
  }

  const appType = args[0];
  const formUuid = args[1];
  const processDefinitionFile = path.resolve(args[2]);
  const processCodeArg = args[3] || null;

  warn('🔧 ' + t('configure_process.title'));
  warn('  ' + t('configure_process.app_id') + ': ' + appType);
  warn('  ' + t('configure_process.form_uuid') + ': ' + formUuid);
  warn('  ' + t('configure_process.definition_file') + ': ' + processDefinitionFile);
  if (processCodeArg) {
    warn('  processCode: ' + processCodeArg + ' (' + t('configure_process.from_cli') + ')');
  }
  warn('');

  // 1. 读取流程定义
  if (!fs.existsSync(processDefinitionFile)) {
    warn('  ❌ ' + t('configure_process.file_not_found') + ': ' + processDefinitionFile);
    process.exit(1);
  }

  let definition;
  try {
    definition = JSON.parse(fs.readFileSync(processDefinitionFile, 'utf-8'));
  } catch (e) {
    warn('  ❌ ' + t('configure_process.parse_failed') + ': ' + e.message);
    process.exit(1);
  }
  warn('  ✅ ' + t('configure_process.definition_loaded') + ' (' + (definition.nodes || []).length + ' ' + t('configure_process.nodes') + ')');

  // 2. 读取登录态
  warn('\n🔑 ' + t('configure_process.loading_auth') + '...');
  let cookieData = loadCookieData();
  if (!cookieData || !cookieData.cookies || cookieData.cookies.length === 0) {
    cookieData = triggerLogin();
  }

  const authRef = {
    csrfToken: cookieData.csrf_token,
    cookies: cookieData.cookies,
    baseUrl: resolveBaseUrl(cookieData),
    cookieData: cookieData,
  };
  warn('  ✅ ' + t('configure_process.auth_loaded') + ', baseUrl: ' + authRef.baseUrl);

  // 3. 获取 processCode
  warn('\n🔍 ' + t('configure_process.getting_process_code') + '...');
  let processCode = processCodeArg;

  if (!processCode) {
    // 确保表单是流程表单
    warn('  ' + t('configure_process.switching_form_type') + '...');
    const switchResult = await switchFormType(authRef, appType, formUuid);
    if (switchResult.success) {
      warn('  ✅ ' + t('configure_process.switch_success'));
    } else {
      const switchMsg = switchResult.errorMsg || '';
      if (switchMsg.indexOf('已转换') >= 0 || switchMsg.indexOf('已经是') >= 0) {
        warn('  ✅ ' + t('configure_process.already_process'));
      } else {
        warn('  ⚠️ ' + t('configure_process.switch_warning') + ': ' + switchMsg);
      }
    }

    // 方法 1: 从 getAppPlatFormParam 接口提取
    warn('  ' + t('configure_process.method1') + '...');
    processCode = await getProcessCodeFromAppParam(authRef, appType, formUuid);
    if (processCode) {
      warn('  ✅ ' + t('configure_process.got_process_code') + ': ' + processCode);
    }

    // 方法 2: 从 getFormSchema 中提取
    if (!processCode) {
      warn('  ' + t('configure_process.method2') + '...');
      processCode = await getProcessCodeFromSchema(authRef, appType, formUuid);
      if (processCode) {
        warn('  ✅ ' + t('configure_process.got_from_schema') + ': ' + processCode);
      }
    }
  }

  if (!processCode) {
    warn('  ❌ ' + t('configure_process.no_process_code'));
    warn('  💡 ' + t('configure_process.manual_hint'));
    process.exit(1);
  }
  warn('  ✅ processCode: ' + processCode);

  // 4. 查询流程版本列表
  warn('\n🔍 ' + t('configure_process.querying_versions') + '...');
  const publishedResult = await queryProcessVersions(authRef, appType, processCode, 'PUBLISHED');

  let latestProcessId = null;
  let latestVersion = 0;

  if (publishedResult.success && publishedResult.content && publishedResult.content.data && publishedResult.content.data.length > 0) {
    const publishedVersion = publishedResult.content.data[0];
    latestProcessId = publishedVersion.id;
    latestVersion = parseInt(publishedVersion.version, 10);
    warn('  ✅ ' + t('configure_process.found_published') + ': processId=' + latestProcessId + ', version=' + latestVersion);
  } else {
    warn('  ℹ️ ' + t('configure_process.no_published') + '...');
    const allVersionsResult = await queryProcessVersions(authRef, appType, processCode, '');
    if (allVersionsResult.success && allVersionsResult.content && allVersionsResult.content.data && allVersionsResult.content.data.length > 0) {
      const latestItem = allVersionsResult.content.data[0];
      latestProcessId = latestItem.id;
      latestVersion = parseInt(latestItem.version, 10);
      warn('  ✅ ' + t('configure_process.found_latest') + ': processId=' + latestProcessId + ', version=' + latestVersion);
    }
  }

  const newVersion = latestVersion + 1;

  // 5. 创建新流程版本草稿
  warn('\n📝 ' + t('configure_process.creating_draft') + '...');
  const draftResult = await newDraftProcess(authRef, appType, processCode, formUuid, latestProcessId, newVersion);

  let newProcessId = null;

  if (draftResult.success && draftResult.content && draftResult.content.processId) {
    // content 是对象，包含 processId 字段
    newProcessId = draftResult.content.processId;
    warn('  ✅ ' + t('configure_process.draft_created') + ': processId=' + newProcessId);
  } else if (draftResult.success && draftResult.content && typeof draftResult.content === 'number') {
    // content 直接是 processId 数字（宜搭 API 的另一种返回格式）
    newProcessId = draftResult.content;
    warn('  ✅ ' + t('configure_process.draft_created') + ': processId=' + newProcessId);
  } else if (draftResult.success) {
    warn('  ✅ ' + t('configure_process.draft_created_no_id'));
    const savedResult = await queryProcessVersions(authRef, appType, processCode, '');
    if (savedResult.success && savedResult.content && savedResult.content.data) {
      const savedVersions = savedResult.content.data.filter(function (item) { return item.status === 'SAVED'; });
      if (savedVersions.length > 0) {
        newProcessId = savedVersions[0].id;
      } else {
        newProcessId = savedResult.content.data[0].id;
      }
    }
  } else {
    warn('  ❌ ' + t('configure_process.draft_failed') + ': ' + (draftResult.errorMsg || JSON.stringify(draftResult)));
    process.exit(1);
  }

  if (!newProcessId) {
    warn('  ❌ ' + t('configure_process.no_draft_id'));
    process.exit(1);
  }

  // 6. 构建 processJson 和 viewJson
  warn('\n🏗️  ' + t('configure_process.building_json') + '...');
  const result = buildProcessAndViewJson(definition, processCode, formUuid, authRef.baseUrl, appType);
  const processJsonStr = JSON.stringify(result.processJson);
  const viewJsonStr = JSON.stringify(result.viewJson);
  warn('  ✅ processJson: ' + processJsonStr.length + ' chars');
  warn('  ✅ viewJson: ' + viewJsonStr.length + ' chars');

  // 7. 保存流程
  warn('\n💾 ' + t('configure_process.saving') + '...');
  const saveResult = await saveProcessById(
    authRef, appType, formUuid, processCode, newProcessId, newVersion,
    processJsonStr, viewJsonStr
  );

  if (saveResult.success) {
    warn('  ✅ ' + t('configure_process.save_success'));
  } else {
    warn('  ❌ ' + t('configure_process.save_failed') + ': ' + (saveResult.errorMsg || JSON.stringify(saveResult)));
    process.exit(1);
  }

  // 8. 发布流程
  warn('\n🚀 ' + t('configure_process.publishing') + '...');
  const publishResult = await publishProcessById(
    authRef, appType, formUuid, processCode, newProcessId, newVersion
  );

  if (publishResult.success) {
    warn('  ✅ ' + t('configure_process.publish_success'));
  } else {
    warn('  ❌ ' + t('configure_process.publish_failed') + ': ' + (publishResult.errorMsg || JSON.stringify(publishResult)));
    process.exit(1);
  }

  // 9. 输出结果
  const output = {
    success: true,
    processCode: processCode,
    processId: newProcessId,
    processVersion: newVersion,
    appType: appType,
    formUuid: formUuid,
  };

  console.log(JSON.stringify(output));
  warn('\n🎉 ' + t('configure_process.done'));
}

module.exports = {
  run,
  _private: {
    buildApproverConfig,
    buildProcessAndViewJson,
  },
};
