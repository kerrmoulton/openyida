'use strict';

jest.mock('../lib/core/utils', () => ({
  httpGet: jest.fn(),
  httpPost: jest.fn(),
  requestWithAutoLogin: jest.fn((fn, authRef) => fn(authRef)),
}));

const { httpGet } = require('../lib/core/utils');
const { createYidaClient } = require('../lib/core/yida-client');
const {
  getFormSchema,
  getLogicflowProcess,
  listFormLogicflows,
  listLogicflowLogs,
  saveProcess,
} = require('../lib/integration/integration-api');

jest.mock('../lib/core/yida-client', () => ({
  createYidaClient: jest.fn(),
}));

describe('integration api', () => {
  beforeEach(() => {
    httpGet.mockReset();
    createYidaClient.mockReset();
    createYidaClient.mockReturnValue({
      get: jest.fn(async (path, query, options) => {
        const auth = {
          baseUrl: 'https://example.com',
        };
        const resolvedQuery = typeof query === 'function' ? query(auth) : query;
        return httpGet(auth.baseUrl, path, resolvedQuery, options);
      }),
    });
  });

  test('listLogicflowLogs sends the frontend status filter for exception logs', async () => {
    httpGet.mockResolvedValue({
      success: true,
      content: {
        currentPage: 1,
        data: [{ procInstId: 'PROC-1', status: 2, exceptionEntity: 'failed' }],
        totalCount: 1,
      },
    });

    const result = await listLogicflowLogs({
      baseUrl: 'https://example.com',
    }, {
      appType: 'APP_TEST',
      processCode: 'LPROC-TEST',
      status: 2,
      pageIndex: 1,
      pageSize: 10,
    });

    expect(result.totalCount).toBe(1);
    expect(httpGet).toHaveBeenCalledTimes(1);
    const [, path, query, options] = httpGet.mock.calls[0];
    expect(path).toBe('/alibaba/web/APP_TEST/query/formLogicflowBinding/listLog.json');
    expect(query).toMatchObject({
      _api: 'Connector.listLog',
      processCode: 'LPROC-TEST',
      status: '2',
      dateType: 'modifyTime',
    });
    expect(options).toEqual({ silentStatus: true });
  });

  test('listFormLogicflows uses the form binding endpoint for grouped load-more flows', async () => {
    httpGet.mockResolvedValue({
      success: true,
      content: {
        currentPage: 1,
        data: [{ name: 'flow', processCode: 'LPROC-A' }],
        totalCount: 1,
      },
    });

    await listFormLogicflows({
      baseUrl: 'https://example.com',
    }, {
      appType: 'APP_TEST',
      formUuid: 'FORM_TEST',
      type: '1',
    });

    const [, path, query, options] = httpGet.mock.calls[0];
    expect(path).toBe('/alibaba/web/APP_TEST/query/formLogicflowBinding/listflow.json');
    expect(query).toMatchObject({
      _api: 'Connector.getTriggerList',
      formUuid: 'FORM_TEST',
    });
    expect(options).toEqual({ silentStatus: true });
  });

  test('getLogicflowProcess returns the unmodified designer response', async () => {
    const response = {
      success: true,
      content: '{"schema":{"componentName":"CanvasEngine"}}',
    };
    httpGet.mockResolvedValue(response);

    await expect(getLogicflowProcess({ baseUrl: 'https://example.com' }, {
      appType: 'APP_TEST',
      formUuid: 'FORM_TEST',
      processCode: 'LPROC_TEST',
    })).resolves.toBe(response);

    const [, requestPath, query, options] = httpGet.mock.calls[0];
    expect(requestPath).toBe('/alibaba/web/APP_TEST/query/simpleProcess/getProcess.json');
    expect(query).toMatchObject({
      _api: 'SimpleProcess.getProcess',
      formUuid: 'FORM_TEST',
      processCode: 'LPROC_TEST',
    });
    expect(options).toEqual({ silentStatus: true });
  });

  test('saveProcess sends the same form fields for draft and publish requests', async () => {
    const postForm = jest.fn().mockResolvedValue({ success: true });
    createYidaClient.mockReturnValue({ postForm });
    const processJson = { props: { processCode: 'LPROC_TEST' }, nodes: [] };
    const viewJson = { schema: { componentName: 'CanvasEngine', children: [] } };

    await saveProcess({ baseUrl: 'https://example.com' }, {
      appType: 'APP_TEST',
      formUuid: 'FORM_TEST',
      processCode: 'LPROC_TEST',
      processJson,
      viewJson,
      isOnline: true,
    });

    expect(postForm).toHaveBeenCalledWith(
      '/alibaba/web/APP_TEST/query/simpleProcess/saveProcess.json',
      {
        formUuid: 'FORM_TEST',
        isLogic: 'true',
        isOnline: 'true',
        json: JSON.stringify(processJson),
        needReportLine: 'y',
        processCode: 'LPROC_TEST',
        viewJson: JSON.stringify(viewJson),
      }
    );
  });

  test.each(['outputs', 'targetType', 'summary'])('raw saveProcess blocks incomplete %s before POST', async defect => {
    const postForm = jest.fn();
    createYidaClient.mockReturnValue({ postForm });
    const { buildSpecProcessAndViewJson } = require('../lib/integration/integration-spec-builder');
    const built = buildSpecProcessAndViewJson({
      appType: 'APP_TEST', formUuid: 'FORM_TEST',
      formMetadataByUuid: new Map([['FORM_TEST', { formType: 'process', formName: '申请单',
        fields: [{ componentName: 'SelectField', props: { fieldId: 'selectField_result', label: '意见' } }] }]]),
      spec: { events: ['activityTask'], approvalActions: ['agree'], approvalNodeIds: ['approval-1'], nodes: [
        { id: 'self', type: 'getSelf' },
        { type: 'dataUpdate', source: 'self', assignments: [{ column: 'selectField_result', valueType: 'literal', value: '同意' }] },
      ] },
    });
    if (defect === 'outputs') { built.viewJson.schema.children[1].props.getData.outputs = []; }
    if (defect === 'targetType') { built.viewJson.schema.children[1].props.getData.targetItem.formItem.formType = 'receipt'; }
    if (defect === 'summary') { delete built.viewJson.schema.children[2].props.updateDataRules.description; }
    await expect(saveProcess({}, { appType: 'APP_TEST', formUuid: 'FORM_TEST', processCode: 'LPROC_TEST',
      ...built, isOnline: true })).rejects.toThrow();
    expect(postForm).not.toHaveBeenCalled();
  });

  test('getFormSchema extracts nested field components from V5 containers only', async () => {
    const mockGet = jest.fn().mockResolvedValue({
      success: true,
      content: JSON.stringify({
        pages: [
          {
            componentsTree: [
              {
                componentName: 'Page',
                children: [
                  {
                    componentName: 'RootContent',
                    children: [
                      {
                        componentName: 'FormContainer',
                        props: {
                          fieldId: 'formContainer_wrapper',
                        },
                        children: [
                          {
                            componentName: 'TextField',
                            props: {
                              fieldId: 'textField_name',
                              label: { zh_CN: '名称' },
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    createYidaClient.mockReturnValue({ get: mockGet });

    const fields = await getFormSchema({
      baseUrl: 'https://example.com',
    }, {
      appType: 'APP_TEST',
      formUuid: 'FORM_TARGET',
    });

    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      componentName: 'TextField',
      props: { fieldId: 'textField_name' },
    });
  });
});
