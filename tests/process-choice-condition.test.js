'use strict';

const { buildProcessAndViewJson } = require('../lib/process/services/process-compiler');
const compileProcessDefinition = definition => buildProcessAndViewJson(definition, 'TPROC-TEST', 'FORM-TEST', 'https://www.aliwork.com', 'APP_TEST');

describe('native choice condition serialization', () => {
  test.each(['SelectField', 'RadioField'])('%s emits rule_text in execution and designer definitions', componentType => {
    const result = compileProcessDefinition({nodes: [
      {type: 'route', conditions: [
        {name: 'Yes branch', rules: [{fieldId: 'choiceField_flag', fieldName: 'Flag', op: 'Equal', value: '是', componentType}], childNodes: [
          {type: 'approval', name: 'Legal manager', approver: 'originator'},
        ]},
        {name: 'No branch', rules: [{fieldId: 'choiceField_flag', fieldName: 'Flag', op: 'Equal', value: '否', componentType}], childNodes: []},
      ]},
      {type: 'approval', name: 'Legal specialist', approver: 'originator'},
    ]}, {processCode: 'TPROC-TEST', formUuid: 'FORM-TEST', appType: 'APP_TEST', baseUrl: 'https://www.aliwork.com'});
    const route = result.processJson.nodes.find(n => n.type === 'route');
    const view = result.viewJson.schema.children.find(n => n.componentName === 'ConditionContainer');
    for (const [index, value] of ['是', '否'].entries()) {
      const expected = {id: 'choiceField_flag', componentType, opCode: 'Equal', value, ruleValue: value, ruleType: 'rule_text', valueType: 'literal'};
      expect(route.childNodes[index].props.conditions.rules[0]).toMatchObject(expected);
      expect(view.children[index].props.conditions.conditions.rules[0]).toMatchObject(expected);
    }
    expect(route.childNodes[0].childNodes).toHaveLength(1);
    expect(route.childNodes[1].childNodes).toHaveLength(0);
  });

  test('choice-based approval jump rules also emit native rule_text', () => {
    const result = compileProcessDefinition({nodes: [
      {type: 'approval', name: 'Review', approver: 'originator', routeRules: [{jumpTo: 'Finish review', fieldRules: [
        {fieldId: 'selectField_flag', fieldName: 'Flag', componentType: 'SelectField', op: 'Equal', value: '是'},
      ]}]},
      {type: 'approval', name: 'Finish review', approver: 'originator'},
    ]}, {processCode: 'TPROC-TEST', formUuid: 'FORM-TEST', appType: 'APP_TEST', baseUrl: 'https://www.aliwork.com'});
    const review = result.viewJson.schema.children.find(n => n.props?.name?.zh_CN === 'Review');
    expect(review.props.routeRule.rules[0].props.conditions.rules[0]).toMatchObject({ruleType: 'rule_text', componentType: 'SelectField'});
  });
});
