'use strict';

jest.mock('../lib/core/i18n', () => ({
  t: jest.fn(() => '未命名表单'),
}));

const { normalizeFormNavigationNode } = require('../lib/app/form-navigation');

describe('form navigation normalization', () => {
  test.each([
    ['y', 'n', true, false], [true, true, true, true], [undefined, undefined, null, null],
  ])('optional readback preserves known and unknown menu visibility', (hidden, mobileHidden, pc, mobile) => {
    const node = { formUuid: 'FORM-A', hidden, mobileHidden };
    expect(normalizeFormNavigationNode(node, { includeNavigation: true })).toMatchObject({ hidden: pc, mobileHidden: mobile });
    expect(normalizeFormNavigationNode(node)).not.toHaveProperty('hidden');
  });
  test.each([
    ['plain formTitle', '客户台账', '客户台账'],
    ['i18n formTitle', { type: 'i18n', zh_CN: '客户台账', en_US: 'Customer Ledger' }, '客户台账'],
  ])('preserves %s when title aliases are absent', (_label, formTitle, expected) => {
    expect(normalizeFormNavigationNode({
      navType: 'FORM',
      formUuid: 'FORM-A',
      formType: 'receipt',
      formTitle,
    })).toMatchObject({ formName: expected });
  });
});
