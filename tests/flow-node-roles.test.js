'use strict';

const { buildProcessAndViewJson } = require('../lib/process/services/process-compiler');
const { buildSpecProcessAndViewJson, validateIntegrationSpec } = require('../lib/integration/integration-spec-builder');
const { projectMessageRoles } = require('../lib/integration/integration-message-roles');
const { verifyLogicflowFinalState } = require('../lib/integration/integration-readback');
const { verifyPlatformView } = require('../lib/process/services/process-view-verifier');

describe('role recipients across process and integration nodes', () => {
  const actor = { type: 'role', roles: [{ id: 'ROLE-FINANCE', name: '财务', roleType: 'YIDA' }] };
  test.each([['approval', 'approver', 'ApprovalNode'], ['operator', 'executor', 'OperatorNode'],
    ['carbon', 'receiver', 'CarbonNode'], ['multiApproval', 'approver', 'MultiApprovalNode']])(
    'keeps role selection in runtime and designer for %s', (type, property, componentName) => {
      const built = buildProcessAndViewJson({ nodes: [{ type, name: type, [property]: actor }] },
        'TPROC-TEST', 'FORM-TEST', 'https://www.aliwork.com', 'APP-TEST');
      const runtime = built.processJson.nodes.find(node => node.type === (type === 'carbon' ? 'carbon' : 'approval'));
      const view = built.viewJson.schema.children.find(node => node.componentName === componentName);
      const changed = JSON.parse(JSON.stringify(built.viewJson));
      const changedNode = changed.schema.children.find(node => node.componentName === componentName);
      const roleRule = type === 'multiApproval' ? changedNode.props.multiApproverRules.multiRules[0] : changedNode.props.approverRules;
      roleRule.roles = [];
      expect(verifyPlatformView({ success: true, content: changed }, built.viewJson, 'FORM-TEST'))
        .toMatchObject({ valid: false, errors: [expect.objectContaining({ code: 'PROCESS_PLATFORM_VIEW_ACTOR_ROLES_MISMATCH' })] });
      if (type === 'multiApproval') {
        expect(runtime.approvalType).toBe('ext_target_activity');
        expect(runtime.props.multiRules[0].rules[0]).toMatchObject({ type: 'ext_target_approval_role',
          multiRoles: [{ roleId: ['ROLE-FINANCE'], roleExtType: 'YIDA' }] });
        expect(view.props.multiApproverRules.multiRules[0]).toMatchObject({
          type: 'ext_target_approval_role', roles: [{ id: 'ROLE-FINANCE', label: '财务' }] });
      } else {
        expect(view.props.approverRules).toMatchObject({ type: 'ext_target_approval_role',
          roles: [{ id: 'ROLE-FINANCE', label: '财务' }] });
        if (type === 'carbon') {
          expect(runtime.props.params.find(param => param.key === 'receiver').value)
            .toEqual({ type: 'ROLE', value: ['ROLE-FINANCE'] });
        } else {
          expect(runtime.props.multiRoles).toEqual([{ roleId: ['ROLE-FINANCE'], roleExtType: 'YIDA' }]);
        }
      }
    });

  const notification = { id: 'notice', type: 'sendMessage', content: '查看申请',
    toRoles: [{ roleCode: 'ROLE-FINANCE', roleName: '财务' }] };
  const buildMessage = node => buildSpecProcessAndViewJson({ spec: { nodes: [node] },
    appType: 'APP-TEST', formUuid: 'FORM-TEST', processCode: 'LPROC-TEST', flowName: 'Role test' });

  test('supports role-only notification and mixed recipients without dropping roles', () => {
    for (const extra of [{}, { toUsers: [{ userId: 'USER-1', userName: '负责人' }], userFields: ['employeeField_owner'] }]) {
      const built = buildMessage({ ...notification, ...extra });
      expect(built.processJson.nodes.find(node => node.type === 'sendMessage').props.toRoles).toEqual(notification.toRoles);
      expect(built.viewJson.schema.children.find(node => node.componentName === 'SendMessageNode')
        .props.sendMessageRules.toRoles).toEqual(notification.toRoles);
    }
    const alias = buildMessage({ ...notification, toRoles: undefined, roles: [{ id: 'ROLE-FINANCE', name: '财务' }] });
    expect(projectMessageRoles(alias.viewJson)[0].roles).toEqual(notification.toRoles);
  });

  test.each([{}, { roles: '财务' }, { roles: [{}] }, { roles: [{ id: {} }] },
    { toRoles: notification.toRoles, messageType: 'GROUP' }])('rejects invalid role config before writing: %j', patch => {
    if (!Object.keys(patch).length) {
      expect(() => buildMessage({ ...notification, toRoles: [] })).toThrow('recipient');
    } else {
      expect(() => validateIntegrationSpec({ nodes: [{ ...notification, toRoles: undefined, ...patch }] }))
        .toThrow(expect.objectContaining({ code: 'INTEGRATION_MESSAGE_ROLES_INVALID' }));
    }
  });

  test('does not report role notification verified when platform drops or replaces the role', async () => {
    const built = buildMessage(notification);
    const detail = JSON.parse(JSON.stringify(built.viewJson));
    const input = { appType: 'APP-TEST', formUuid: 'FORM-TEST', processCode: 'LPROC-TEST',
      expectedMessageRoles: projectMessageRoles(built.viewJson) };
    const dependencies = { listAllLogicflows: async () => [{ formUuid: 'FORM-TEST', processCode: 'LPROC-TEST', status: 'y' }],
      getLogicflowDetail: async () => ({ success: true, content: detail }) };
    expect(await verifyLogicflowFinalState({}, input, dependencies)).toMatchObject({ messageRoleProjection: 'EXACT' });
    const rules = detail.schema.children.find(node => node.componentName === 'SendMessageNode').props.sendMessageRules;
    for (const roles of [[], [{ roleCode: 'ROLE-OTHER', roleName: '其他' }]]) {
      rules.toRoles = roles;
      await expect(verifyLogicflowFinalState({}, input, dependencies)).rejects
        .toMatchObject({ code: 'INTEGRATION_READBACK_MESSAGE_ROLES_MISMATCH' });
    }
  });
});
