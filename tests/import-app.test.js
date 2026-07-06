'use strict';

const querystring = require('querystring');
const { __test__ } = require('../lib/app/import-app');

describe('import-app helpers', () => {
  test('preserves page/report formType when creating imported placeholders', () => {
    expect(__test__.normalizeImportFormType('display')).toBe('display');
    expect(__test__.normalizeImportFormType('report')).toBe('report');
    expect(__test__.normalizeImportFormType('receipt')).toBe('receipt');
    expect(__test__.normalizeImportFormType('form')).toBe('receipt');
    expect(__test__.normalizeImportFormType('')).toBe('receipt');

    const displayPayload = querystring.parse(
      __test__.buildCreateFormPostData('csrf-1', 'Imported Page', 'display')
    );
    const reportPayload = querystring.parse(
      __test__.buildCreateFormPostData('csrf-1', 'Imported Report', 'report')
    );

    expect(displayPayload.formType).toBe('display');
    expect(reportPayload.formType).toBe('report');
    expect(displayPayload._csrf_token).toBe('csrf-1');
    expect(JSON.parse(displayPayload.title).zh_CN).toBe('Imported Page');
  });

  test('adapts app and form identifiers inside exported schema content', () => {
    const schema = {
      pages: [{ id: 'FORM-OLD', props: { appType: 'APP_OLD' } }],
      actions: { source: 'APP_OLD/FORM-OLD' },
    };

    expect(__test__.adaptSchemaIdentifiers(schema, 'APP_OLD', 'APP_NEW', 'FORM-OLD', 'FORM-NEW')).toEqual({
      pages: [{ id: 'FORM-NEW', props: { appType: 'APP_NEW' } }],
      actions: { source: 'APP_NEW/FORM-NEW' },
    });
  });

  test('does not corrupt plain text that merely contains the old identifier as a substring', () => {
    const schema = {
      pages: [{ id: 'FORM-OLD', props: { appType: 'APP_OLD' } }],
      fields: [
        // label / value 中包含旧标识符子串，但属于更长的字符串，不应被替换
        { label: 'APP_OLDER backup note', value: 'see FORM-OLD-archive for details' },
      ],
    };

    const result = __test__.adaptSchemaIdentifiers(schema, 'APP_OLD', 'APP_NEW', 'FORM-OLD', 'FORM-NEW');

    expect(result.pages[0].id).toBe('FORM-NEW');
    expect(result.pages[0].props.appType).toBe('APP_NEW');
    // 关键：被更长标识符包裹的子串保持原样，不被误替换
    expect(result.fields[0].label).toBe('APP_OLDER backup note');
    expect(result.fields[0].value).toBe('see FORM-OLD-archive for details');
  });
});
