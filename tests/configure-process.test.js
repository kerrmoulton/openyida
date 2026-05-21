'use strict';

const { _private } = require('../lib/process/configure-process');

function getApprovalNodes(result) {
  return result.processJson.nodes.filter(function (node) {
    return node.type === 'approval';
  });
}

function getViewApprovalNode(result) {
  return result.viewJson.schema.children.find(function (node) {
    return node.componentName === 'ApprovalNode';
  });
}

describe('configure-process approver DSL', () => {
  test('builds specified member approver from users', () => {
    const result = _private.buildProcessAndViewJson({
      nodes: [
        {
          type: 'approval',
          name: '主管审批',
          approver: {
            type: 'user',
            users: [{ id: 'manager7350', name: '九神' }],
          },
        },
      ],
    }, 'TPROC-TEST', 'FORM-TEST', 'https://www.aliwork.com', 'APP_TEST');

    const approvalNode = getApprovalNodes(result)[0];
    expect(approvalNode.approvalType).toBe('ext_target_approval');
    expect(approvalNode.props.approvals).toEqual(['manager7350']);
    expect(approvalNode.props.multiApprove).toBe('all');

    const approverRules = getViewApprovalNode(result).props.approverRules;
    expect(approverRules.type).toBe('ext_target_approval');
    expect(approverRules.approvals).toEqual([
      {
        id: 'manager7350',
        label: '九神',
        type: 'employee',
        roleType: 'DINGTALK',
      },
    ]);
    expect(approverRules.description).toBe('九神');
  });

  test('builds role approver with multiRoles grouped by roleType', () => {
    const result = _private.buildProcessAndViewJson({
      nodes: [
        {
          type: 'approval',
          name: '财务审批',
          approver: {
            type: 'role',
            roles: [
              { id: 'ROLE-FINANCE', label: '财务', roleType: 'YIDA' },
              { id: 'ROLE-DING', label: '钉钉角色', roleType: 'DINGTALK' },
            ],
            multiApproverType: 'or',
          },
        },
      ],
    }, 'TPROC-TEST', 'FORM-TEST', 'https://www.aliwork.com', 'APP_TEST');

    const approvalNode = getApprovalNodes(result)[0];
    expect(approvalNode.approvalType).toBe('ext_target_approval_role');
    expect(approvalNode.props.approvals).toBeUndefined();
    expect(approvalNode.props.multiApprove).toBe('or');
    expect(approvalNode.props.multiRoles).toEqual([
      { roleId: ['ROLE-FINANCE'], roleExtType: 'YIDA' },
      { roleId: ['ROLE-DING'], roleExtType: 'DINGTALK' },
    ]);

    const approverRules = getViewApprovalNode(result).props.approverRules;
    expect(approverRules.type).toBe('ext_target_approval_role');
    expect(approverRules.approvalType_ext_target_approval_role).toBe('or');
    expect(approverRules.roles[0]).toEqual({
      id: 'ROLE-FINANCE',
      label: '财务',
      type: 'role',
      roleType: 'YIDA',
    });
  });

  test('builds department leader approver from originator source', () => {
    const result = _private.buildProcessAndViewJson({
      nodes: [
        {
          type: 'approval',
          name: '部门主管审批',
          approver: {
            type: 'deptLeader',
            source: 'originator',
            level: 2,
            needLeaderReplace: true,
            ignoreNoLeaderDept: false,
          },
        },
      ],
    }, 'TPROC-TEST', 'FORM-TEST', 'https://www.aliwork.com', 'APP_TEST');

    const approvalNode = getApprovalNodes(result)[0];
    expect(approvalNode.approvalType).toBe('ext_target_dept_leader');
    expect(approvalNode.props.approvals).toBeUndefined();
    expect(approvalNode.props).toMatchObject({
      key: 'DeptLeaderApproverRule_1.0.0',
      userIdVar: 'originator',
      reportLevel: 2,
      ignoreNoLeaderDept: 'false',
      needLeaderReplace: 'true',
      multiApprove: 'all',
    });

    const approverRules = getViewApprovalNode(result).props.approverRules;
    expect(approverRules.type).toBe('ext_target_dept_leader');
    expect(approverRules.supervisorType).toEqual({ value: 'originator', label: '发起人' });
    expect(approverRules.supervisorLevel).toBe('2');
    expect(approverRules.description).toBe('发起人的第2级主管');
  });
});

describe('configure-process parallel DSL', () => {
  test('builds parallel branches that rejoin the following node', () => {
    const result = _private.buildProcessAndViewJson({
      nodes: [
        {
          type: 'parallel',
          name: '并行审批',
          branches: [
            {
              name: '产管审批',
              childNodes: [
                {
                  type: 'approval',
                  name: '产管审批',
                  approver: 'originator',
                },
              ],
            },
            {
              name: '价管审批',
              childNodes: [
                {
                  type: 'approval',
                  name: '价管审批',
                  approver: 'originator',
                },
              ],
            },
          ],
        },
        {
          type: 'carbon',
          name: '抄送销售和BI',
          approver: 'originator',
        },
      ],
    }, 'TPROC-TEST', 'FORM-TEST', 'https://www.aliwork.com', 'APP_TEST');

    const middleNodes = result.processJson.nodes.slice(1, -1);
    const parallelNode = middleNodes[0];
    const carbonNode = middleNodes[1];

    expect(parallelNode.type).toBe('route');
    expect(parallelNode.props.outgoingType).toBe('multiple');
    expect(parallelNode.nextId).toHaveLength(2);
    expect(parallelNode.childNodes).toHaveLength(2);
    expect(carbonNode.type).toBe('carbon');
    expect(carbonNode.prevId).toBe(parallelNode.nodeId);

    parallelNode.childNodes.forEach(function (branchNode) {
      expect(branchNode.type).toBe('condition');
      expect(branchNode.prevId).toBe(parallelNode.nodeId);
      expect(branchNode.props.calculate).toBe('all');
      expect(branchNode.childNodes).toHaveLength(1);

      const approvalNode = branchNode.childNodes[0];
      expect(branchNode.nextId).toEqual([approvalNode.nodeId]);
      expect(approvalNode.type).toBe('approval');
      expect(approvalNode.prevId).toBe(branchNode.nodeId);
      expect(approvalNode.nextId).toEqual([carbonNode.nodeId]);
    });

    const viewParallelNode = result.viewJson.schema.children.find(function (node) {
      return node.componentName === 'ConditionContainer' && node.type === 'parallel';
    });
    expect(viewParallelNode).toBeTruthy();
    expect(viewParallelNode.children).toHaveLength(2);
    expect(viewParallelNode.children.map(function (node) { return node.componentName; })).toEqual([
      'ParallelNode',
      'ParallelNode',
    ]);
    expect(viewParallelNode.children[0].children[0].componentName).toBe('ApprovalNode');
  });

  test('builds route-style rules for conditional parallel branches', () => {
    const result = _private.buildProcessAndViewJson({
      nodes: [
        {
          type: 'parallel',
          branches: [
            {
              name: '大额审批',
              logic: 'OR',
              rules: [
                {
                  fieldId: 'numberField_amount',
                  fieldName: '金额',
                  componentType: 'NumberField',
                  op: 'GreaterThan',
                  value: 1000,
                },
              ],
              childNodes: [
                {
                  type: 'approval',
                  name: '大额审批',
                  approver: 'originator',
                },
              ],
            },
          ],
        },
      ],
    }, 'TPROC-TEST', 'FORM-TEST', 'https://www.aliwork.com', 'APP_TEST');

    const parallelNode = result.processJson.nodes.find(function (node) {
      return node.type === 'route' && node.props.outgoingType === 'multiple';
    });
    const branchNode = parallelNode.childNodes[0];

    expect(branchNode.props.calculate).toBe('condition');
    expect(branchNode.props.conditions.condition).toBe('OR');
    expect(branchNode.props.conditions.conditionCode).toBe('||');
    expect(branchNode.props.conditions.rules[0].formula).toBe('${numberField_amount}>1000');
  });
});
