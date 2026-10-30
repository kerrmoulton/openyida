'use strict';

jest.mock('../lib/core/yida-client', () => ({ createYidaClient: jest.fn() }));
jest.mock('../lib/app/services/form-mode-service', () => ({ readFormMode: jest.fn() }));
const { createYidaClient } = require('../lib/core/yida-client');
const { readFormMode } = require('../lib/app/services/form-mode-service');
const { extractProcessFields, inspectProcessFields, assertPermissionFields } = require('../lib/process/services/process-form-fields');

const tree = { componentName: 'FormContainer', children: [{ componentName: 'TableField',
  props: { fieldId: 'tableField_lines', label: '明细' }, children: [{ componentName: 'NumberField',
    props: { fieldId: 'numberField_cost', label: { zh_CN: '成本' } } }] }] };
const schema = { pages: [{ componentsTree: [{ componentName: 'Page', children: [tree] }] }] };
const response = content => ({ success: true, content });

describe('process designer field loading', () => {
  let get;
  beforeEach(() => {
    jest.clearAllMocks();
    get = jest.fn();
    createYidaClient.mockReturnValue({ get });
    readFormMode.mockResolvedValue({ mode: 'process', processCode: 'TPROC_TEST' });
  });

  test.each([schema, { pages: [{ layout: tree }] }])('reads current and legacy field layouts with subtable paths', content => {
    expect(extractProcessFields(response(JSON.stringify(content))).fields).toContainEqual({
      fieldId: 'numberField_cost', componentName: 'NumberField', label: '成本',
      parentFieldId: 'tableField_lines', fieldPath: ['tableField_lines', 'numberField_cost'],
    });
  });

  test('uses the exact bound process code for the designer schema request', async () => {
    get.mockResolvedValueOnce(response(schema)).mockResolvedValueOnce(response(schema));
    expect(await inspectProcessFields({}, { appType: 'APP_TEST', formUuid: 'FORM_TEST' })).toMatchObject({
      designerVerified: true, runtimeVerified: false, remoteWrites: 0,
    });
    expect(get.mock.calls[1][1]).toEqual({ processCode: 'TPROC_TEST' });
  });

  test('reports designer-only empty fields instead of declaring permissions usable', async () => {
    get.mockResolvedValueOnce(response(schema)).mockResolvedValueOnce(response({ pages: [{ layout: { children: [] } }] }));
    await expect(inspectProcessFields({}, { appType: 'APP_TEST', formUuid: 'FORM_TEST' }))
      .rejects.toMatchObject({ code: 'PROCESS_DESIGNER_FIELDS_MISSING', details: { remoteWrites: 0 } });
  });

  test('refuses a process belonging to another form before any schema request', async () => {
    await expect(inspectProcessFields({}, { appType: 'APP_TEST', formUuid: 'FORM_TEST', processCode: 'TPROC_OTHER' }))
      .rejects.toMatchObject({ code: 'CONFIGURE_PROCESS_OWNERSHIP_UNVERIFIED' });
    expect(get).not.toHaveBeenCalled();
  });

  test.each([undefined, '{bad json', { pages: {} }])('does not silently turn an invalid schema into an empty field list', content => {
    expect(() => extractProcessFields(response(content))).toThrow();
  });

  test('refuses nonexistent permission fields', () => {
    expect(() => assertPermissionFields({ node: [{ fieldId: 'numberField_other' }] }, extractProcessFields(response(schema)).fields))
      .toThrow(expect.objectContaining({ code: 'PROCESS_PERMISSION_FIELD_NOT_FOUND' }));
  });
});
