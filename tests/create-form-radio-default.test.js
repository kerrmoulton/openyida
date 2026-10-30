'use strict';
const { _private: { buildFormSchema } } = require('../lib/app/create-form');
function findRadio(value) {
  if (!value || typeof value !== 'object') {return null;}
  if (value.componentName === 'RadioField' && value.props) {return value;}
  for (const child of Object.values(value)) { const found = findRadio(child); if (found) {return found;} }
  return null;
}
function build(dataSource) {
  return findRadio(buildFormSchema('验收', [{ type: 'RadioField', label: '状态', dataSource }], 'FORM_TEST', 'CORP_TEST', 'APP_TEST', 'single', 'default', 'top'));
}
describe('radio default in runtime form schema', () => {
  test('materializes selected option value into the runtime default', () => {
    const field = build([{ value: 'pending', text: { zh_CN: '待处理' }, defaultChecked: true }, { value: 'done', defaultChecked: false }]);
    expect(field.props.value).toBe('pending');
    expect(field.props.complexValue).toEqual({ complexType: 'custom', formula: '', value: 'pending' });
    expect(field.props.dataSource[0].defaultChecked).toBe(true);
  });
  test('preserves an explicitly selected zero value', () => {
    const field = build([{ value: 0, defaultChecked: true }, { value: 1 }]);
    expect(field.props.value).toBe(0);
    expect(field.props.complexValue.value).toBe(0);
  });
  test('keeps unselected fields empty', () => {
    const field = build([{ value: 'pending' }, { value: 'done' }]);
    expect(field.props.value).toBe('');
    expect(field.props.complexValue.value).toBe('');
  });
});
