'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSource, validateSpec } = require('../lib/task-center/scaffold');

const { mount } = require('./helpers/task-center-renderer');

let directory;
let source;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-runtime-'));
  const designFile = path.join(directory, 'design.md');
  fs.writeFileSync(designFile, 'Use existing application theme.');
  source = buildSource(validateSpec({ appType: 'APP_TEST', designFile, customPage: { source: 'explicit-user-request', confirmed: true }, kinds: ['todo', 'cc'] }));
});
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
const payload = (title, extra = {}) => ({ data: [{ taskId: title, title, processInstanceId: 'p', ...extra }], totalCount: 40, currentPage: 1 });

test('late responses cannot replace the selected tab, and each tab keeps its search', async () => {
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  const bridge = {
    ready: true,
    getTodoTasksInApp: jest.fn().mockReturnValueOnce(old).mockResolvedValue(payload('new todo')),
    getNotifyMeTasksInApp: jest.fn().mockResolvedValue(payload('carbon', { carbonActivityId: 'node' })),
  };
  const app = mount(source, bridge);
  await app.flush();
  app.nodes('Tabs')[0].props.onChange('cc');
  await app.flush();
  expect(app.nodes('Table')[0].props.dataSource[0].title).toBe('carbon');
  resolveOld(payload('old todo'));
  await app.flush();
  expect(app.nodes('Table')[0].props.dataSource[0].title).toBe('carbon');
  app.nodes('Search')[0].props.onSearch('invoice');
  await app.flush();
  expect(bridge.getNotifyMeTasksInApp).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'invoice', currentPage: 1 }));
  app.nodes('Tabs')[0].props.onChange('todo');
  await app.flush();
  expect(app.nodes('Table')[0].props.dataSource[0].title).toBe('new todo');
  app.nodes('Tabs')[0].props.onChange('cc');
  await app.flush();
  expect(app.nodes('Search')[0].props.value).toBe('invoice');
  app.unmount();
  expect(app.window.document.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
});

test('failed refresh retains the last successful result and exposes an error', async () => {
  const bridge = { ready: true, getTodoTasksInApp: jest.fn().mockResolvedValueOnce(payload('saved')).mockRejectedValue(new Error('network')) };
  const app = mount(source, bridge);
  await app.flush();
  app.nodes('Pagination')[0].props.onChange(2);
  await app.flush();
  expect(bridge.getTodoTasksInApp).toHaveBeenLastCalledWith(expect.objectContaining({ currentPage: 2 }));
  expect(app.nodes('Table')[0].props.dataSource[0].title).toBe('saved');
  expect(app.nodes('Alert')[0].props.message).toBeTruthy();
  expect(app.nodes('Alert')[0].props.description).toBeTruthy();
  app.unmount();
});

test('advanced scaffold forwards per-kind server filters through pagination without a bridge', async () => {
  const advanced = buildSource(validateSpec({ appType: 'APP_TEST', designFile: path.join(directory, 'design.md'),
    customPage: { source: 'explicit-user-request', confirmed: true }, kinds: ['todo', 'cc'], transport: 'app-query',
    filters: { todo: { originators: ['person-a'] }, cc: { processCodes: ['process-a'] } },
  }));
  const fetch = jest.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ success: true, content: {
    values: [{ appType: 'APP_TEST', title: 'invoice', taskId: 'task-a', processInstanceId: 'instance-a' }], totalCount: 40, currentPage: 1,
  } }) }));
  const app = mount(advanced, undefined, fetch);
  await app.flush();
  const query = () => JSON.parse(new URL(fetch.mock.calls[fetch.mock.calls.length - 1][0], 'https://example.test').searchParams.get('query'));
  expect(query()).toMatchObject({ appKeys: ['APP_TEST'], page: 1, originators: ['person-a'] });
  app.nodes('Pagination')[0].props.onChange(2);
  await app.flush();
  expect(query()).toMatchObject({ appKeys: ['APP_TEST'], page: 2, originators: ['person-a'] });
  app.nodes('Tabs')[0].props.onChange('cc');
  await app.flush();
  expect(query()).toMatchObject({ appKeys: ['APP_TEST'], page: 1, processCodes: ['process-a'] });
  expect(query()).not.toHaveProperty('originators');
  expect(app.nodes('Table')[0].props.dataSource[0].title).toBe('invoice');
  app.unmount();
});
