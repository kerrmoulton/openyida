'use strict';

const { buildProcessAndViewJson } = require('../lib/process/services/process-compiler');
const { buildFlowConfig, completeSubtablePermissions } = require('../lib/process/services/process-field-permissions');
const { verifyPlatformView } = require('../lib/process/services/process-view-verifier');

const list = [{ fieldId: 'tableField_lines', fieldBehavior: 'NORMAL' },
  { fieldId: 'numberField_cost', fieldBehavior: 'NORMAL' }];

function compile() {
  return buildProcessAndViewJson({
    startFormConfig: { behaviorList: list },
    globalSetting: { behaviorList: [{ fieldId: 'numberField_cost', fieldBehavior: 'HIDDEN' }] },
    nodes: [{ type: 'operator', name: '采购报价', approver: 'originator', formConfig: { behaviorList: list } }],
  }, 'TPROC_TEST', 'FORM_TEST', 'https://www.aliwork.com', 'APP_TEST');
}

describe('process runtime field permission contract', () => {
  test('writes node, start and detail permissions to the platform flowConfig locations', () => {
    const result = compile();
    const operator = result.viewJson.schema.children.find(node => node.componentName === 'OperatorNode');
    const config = result.processJson.flowConfig;
    expect(config[operator.id]).toEqual(expect.arrayContaining(list));
    expect(config.sid_instStart).toEqual(expect.arrayContaining(list));
    expect(config.sid_instDetail).toEqual([{ fieldId: 'numberField_cost', fieldBehavior: 'HIDDEN' }]);
    expect(result.viewJson.schema.children[0].id).toBe('sid_instStart');
  });

  test('collects permissions inside nested branches', () => {
    expect(buildFlowConfig({ schema: { children: [{ componentName: 'ConditionContainer', children: [
      { componentName: 'ConditionNode', children: [{ id: 'child', props: { formConfig: { behaviorList: list } } }] },
    ] }] } })).toEqual({ child: expect.arrayContaining(list) });
  });

  test.each(['READONLY', 'HIDDEN'])('rejects view readback that changes editable fields to %s', fieldBehavior => {
    const { viewJson } = compile();
    const actual = JSON.parse(JSON.stringify(viewJson));
    actual.schema.children[1].props.formConfig.behaviorList[0].fieldBehavior = fieldBehavior;
    expect(verifyPlatformView({ success: true, content: actual }, viewJson, 'FORM_TEST')).toMatchObject({
      valid: false, verificationLevel: 'PUBLISHED_UNVERIFIED',
      errors: expect.arrayContaining([expect.objectContaining({ code: 'PROCESS_PLATFORM_VIEW_FIELD_PERMISSIONS_MISMATCH' })]),
    });
  });

  test('accepts equivalent field ordering but rejects missing permissions', () => {
    const { viewJson } = compile();
    const actual = JSON.parse(JSON.stringify(viewJson));
    actual.schema.children[1].props.formConfig.behaviorList.reverse();
    expect(verifyPlatformView({ success: true, content: actual }, viewJson, 'FORM_TEST').valid).toBe(true);
    delete actual.schema.children[1].props.formConfig;
    expect(verifyPlatformView({ success: true, content: actual }, viewJson, 'FORM_TEST').valid).toBe(false);
  });

  test('refuses ambiguous duplicate field settings before a process can be saved', () => {
    expect(() => buildFlowConfig({ schema: { children: [{ id: 'a', props: {
      formConfig: { behaviorList: [...list, list[0]] },
    } }] } })).toThrow(expect.objectContaining({ code: 'PROCESS_FIELD_PERMISSIONS_INVALID' }));
  });

  test('adds a missing editable parent table but refuses an explicitly restricted parent', () => {
    const compiled = compile();
    const node = compiled.viewJson.schema.children[1];
    node.props.formConfig.behaviorList = [list[1]];
    const fields = [{ fieldId: 'numberField_cost', fieldPath: ['tableField_lines', 'numberField_cost'] }];
    completeSubtablePermissions(compiled, fields);
    expect(compiled.processJson.flowConfig[node.id]).toEqual(expect.arrayContaining(list));
    node.props.formConfig.behaviorList = [list[1], { fieldId: 'tableField_lines', fieldBehavior: 'HIDDEN' }];
    expect(() => completeSubtablePermissions(compiled, fields)).toThrow(expect.objectContaining({ code: 'PROCESS_PERMISSION_CONTAINER_CONFLICT' }));
  });
});
