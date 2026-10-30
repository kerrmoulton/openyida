'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
jest.mock('../lib/core/utils', () => ({
  loadAuthData: jest.fn(() => ({ auth_mode: 'token', corp_id: 'corp-test', user_id: 'user-test', base_url: 'https://example.com' })),
  resolveBaseUrl: jest.fn(() => 'https://example.com'), triggerLogin: jest.fn(),
}));
jest.mock('../lib/app/form-navigation', () => ({
  fetchFormPageList: jest.fn(), resolveLocalizedText: jest.fn(value => value),
}));
jest.mock('../lib/integration/integration-api', () => ({
  getLogicflowProcess: jest.fn(),
  getFormSchema: jest.fn(), createLogicflow: jest.fn(), saveProcess: jest.fn(),
}));
jest.mock('../lib/integration/integration-readback', () => ({
  verifyLogicflowFinalState: jest.fn(), projectAddDataAssignments: jest.fn(() => []),
  projectConnectorAssignments: jest.fn(() => []), projectSystemTokenBindings: jest.fn(() => []),
}));
const { fetchFormPageList } = require('../lib/app/form-navigation');
const api = require('../lib/integration/integration-api');
const { verifyLogicflowFinalState } = require('../lib/integration/integration-readback');
const { run } = require('../lib/integration/integration-create');
const { batchFixture } = require('./helpers/integration-batch-fixture');

describe('batch nodes through integration create CLI', () => {
  let dir;
  let fixture;
  function file() {
    const specPath = path.join(dir, 'spec.json');
    fs.writeFileSync(specPath, JSON.stringify(fixture.spec));
    return specPath;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    const editorApi = require('../lib/integration/integration-api');
    editorApi.getLogicflowProcess.mockImplementation(async () => ({
      success: true, content: JSON.stringify(editorApi.saveProcess.mock.calls.at(-1)[1].viewJson),
    }));
    fixture = batchFixture();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-batch-'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    fetchFormPageList.mockResolvedValue([
      { formUuid: 'FORM-QUOTE', formType: 'receipt', title: '报价单' },
      { formUuid: 'FORM-ORDER', formType: 'receipt', title: '订单' },
    ]);
    api.getFormSchema.mockImplementation(async (_auth, { formUuid }) => fixture.formSchemasByUuid.get(formUuid));
    api.createLogicflow.mockResolvedValue('LPROC-BATCH');
    api.saveProcess.mockResolvedValue({ success: true });
    verifyLogicflowFinalState.mockResolvedValue({ verificationLevel: 'PLATFORM_LIST_EXACT_DETAIL_PRESENT', batchDataProjection: 'EXACT' });
  });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('reads both schemas before writing and requests verification of the batch controls', async () => {
    await run(['APP-TEST', 'FORM-QUOTE', '批量复制测试', '--spec', file(), '--publish']);
    expect(api.getFormSchema.mock.calls.map(call => call[1].formUuid).sort()).toEqual(['FORM-ORDER', 'FORM-QUOTE']);
    expect(Math.max(...api.getFormSchema.mock.invocationCallOrder)).toBeLessThan(api.createLogicflow.mock.invocationCallOrder[0]);
    expect(api.saveProcess).toHaveBeenCalledTimes(2);
    expect(verifyLogicflowFinalState.mock.calls[0][1].expectedBatchData).toHaveLength(2);
    const saved = api.saveProcess.mock.calls[0][1];
    expect(saved.processJson.nodes.find(node => node.props.type === 'batch' && node.type === 'dataCreate').props.sourceId)
      .toBe(saved.viewJson.schema.children.find(node => node.componentName === 'GetBatchDataNode').id);
  });

  test('rejects invalid batch references before any remote read or write', async () => {
    fixture.spec.nodes[3].batchSource = 'self';
    await expect(run(['APP-TEST', 'FORM-QUOTE', '无效批量', '--spec', file()])).rejects.toThrow();
    expect(fetchFormPageList).not.toHaveBeenCalled();
    expect(api.createLogicflow).not.toHaveBeenCalled();
    expect(api.saveProcess).not.toHaveBeenCalled();
  });

  test('rejects source columns outside the subtable before creating a remote binding', async () => {
    fixture.spec.nodes[3].assignments[0].value = '${lines}.textField_quoteNo';
    await expect(run(['APP-TEST', 'FORM-QUOTE', '错误字段', '--spec', file()])).rejects.toMatchObject({ code: 'INTEGRATION_BATCH_INVALID' });
    expect(api.createLogicflow).not.toHaveBeenCalled();
    expect(api.saveProcess).not.toHaveBeenCalled();
  });
});
