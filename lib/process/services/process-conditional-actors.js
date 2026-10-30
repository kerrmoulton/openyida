'use strict';

const { CliError } = require('../../core/cli-error');
const { t } = require('../../core/i18n');

function nativeConditions(group) {
  for (const rule of group?.rules || []) {
    if (rule.rules) { nativeConditions(rule); continue; }
    // Native FormulaFunction consumes @numberBigger, not @numberGreaterThan;
    // rule_number is ignored by this endpoint's expression converter.
    if (rule.componentType === 'NumberField') {
      const mapping = { GreaterThan: 'Bigger', Bigger: 'Bigger', GreaterThanOrEqual: 'BiggerOrEqual',
        BiggerOrEqual: 'BiggerOrEqual', LessThan: 'Lesser', Lesser: 'Lesser', LessThanOrEqual: 'LesserOrEqual',
        LesserOrEqual: 'LesserOrEqual', Equal: 'Equal', NotEqual: 'NotEqual' };
      if (!mapping[rule.opCode] || typeof rule.value !== 'number' || !Number.isFinite(rule.value)
        || rule.valueType !== 'literal') { throw new Error('numeric condition requires a finite literal and supported comparison'); }
      rule.opCode = mapping[rule.opCode];
    }
    const operators = {
      NumberField: ['Bigger', 'BiggerOrEqual', 'Lesser', 'LesserOrEqual', 'Equal', 'NotEqual'],
      TextField: ['Equal', 'NotEqual', 'Contain', 'NotContain', 'BeginWith', 'EndWith', 'ExistValue', 'NotExistValue'],
      TextareaField: ['Equal', 'NotEqual', 'Contain', 'NotContain', 'BeginWith', 'EndWith', 'ExistValue', 'NotExistValue'],
      SelectField: ['Equal', 'NotEqual', 'EqualAny', 'NotEqualAny', 'ExistValue', 'NotExistValue'],
      RadioField: ['Equal', 'NotEqual', 'EqualAny', 'NotEqualAny', 'ExistValue', 'NotExistValue'],
      MultiSelectField: ['Equal', 'NotEqual', 'Contain', 'NotContain', 'ExistValue', 'NotExistValue'],
      CheckboxField: ['Equal', 'NotEqual', 'Contain', 'NotContain', 'ExistValue', 'NotExistValue'],
      EmployeeField: ['Equal', 'NotEqual', 'EqualAny', 'NotEqualAny', 'ExistValue', 'NotExistValue'],
      DepartmentSelectField: ['Equal', 'NotEqual', 'EqualAny', 'NotEqualAny', 'ExistValue', 'NotExistValue'],
      DateField: ['Equal', 'NotEqual', 'Before', 'After', 'InRange', 'NotInRange', 'ExistValue', 'NotExistValue'],
    };
    if (!operators[rule.componentType]?.includes(rule.opCode)) {
      throw new Error('unsupported condition field type/operator');
    }
    rule.ruleType = 'rule_text';
    delete rule.formula;
  }
  return group;
}

function buildConditionalActors(node, input, buildActor, buildConditions, nodeType) {
  const fail = reason => { throw new CliError(t('conditional_actors.invalid', reason), {
    code: 'PROCESS_CONDITIONAL_ACTORS_INVALID', details: { reason, remoteWrites: 0 },
  }); };
  if (!Array.isArray(input.cases) || !input.cases.length || input.cases.length > 20
    || !['conditional', 'parallel_conditional'].includes(input.mode || 'conditional')
    || Object.keys(input).some(key => !['kind', 'type', 'cases', 'mode', 'approvalMode'].includes(key))) {
    fail('cases / mode');
  }
  const list = input.cases.map((item, index) => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['when', 'actor'].includes(key))) {
      fail('case');
    }
    const actorKind = item.actor?.kind || item.actor?.type;
    if (!['user', 'role', 'originator', 'deptLeader', 'directLeader'].includes(actorKind)) { fail('actor kind'); }
    const actor = buildActor(node, item.actor);
    if (!actor) { fail('actor'); }
    if (nodeType === 'carbon' && !actor.carbonReceiver) { fail('unsupported carbon receiver kind'); }
    let rules;
    if (item.when === undefined) {
      if (index !== input.cases.length - 1) { fail('only last case may be fallback'); }
    } else {
      if (!item.when || !['AND', 'OR'].includes(item.when.logic) || !Array.isArray(item.when.rules)
        || !item.when.rules.length || item.when.rules.some(rule => !rule?.fieldId || !rule.op || !rule.componentType
          || !Object.hasOwn(rule, 'value'))) { fail('when'); }
      rules = nativeConditions(buildConditions(item.when.rules, item.when.logic));
    }
    return { actor, rules, priority: index + 1 };
  });
  const mode = input.mode || 'conditional';
  const multiApprove = input.approvalMode || 'all';
  if (!['all', 'or', 'oneByOne'].includes(multiApprove)) { fail('approvalMode'); }
  return {
    approvalType: 'ext_target_approval_condition',
    processProps: { conditionalMode: mode, multiApprove,
      approvals: list.map(({ actor, rules, priority }) => ({ approvalType: actor.approvalType,
        props: nodeType === 'carbon' ? { params: [
          { key: 'nodeId', value: node._nodeId },
          { key: 'instId', value: '#procInstId' },
          { key: 'userId', value: '#originator' },
          { key: 'receiver', value: actor.carbonReceiver },
        ] } : { ...actor.processProps, ...(actor.approvals ? { approvals: actor.approvals } : {}) },
        priority, ...(rules ? { conditions: rules } : {}) })) },
    approverRules: { type: 'ext_target_approval_condition', mode: 'ApprovalNode_rules_multiple',
      conditionalMode: mode, multiApproverType: multiApprove,
      approverList: list.map(({ actor, rules }) => ({ ...actor.approverRules, ...(rules ? { rules } : {}) })) },
    description: node.description || '',
  };
}

module.exports = { buildConditionalActors, nativeConditions };
