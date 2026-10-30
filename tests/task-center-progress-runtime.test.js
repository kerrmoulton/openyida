'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSource, validateSpec } = require('../lib/task-center/scaffold');
const { mount } = require('./helpers/task-center-renderer');
let directory, designFile;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-render-'));
  designFile = path.join(directory, 'design.md'); fs.writeFileSync(designFile, 'Use the current application theme.');
});
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
const base = { appType: 'APP_TEST', customPage: { source: 'explicit-user-request', confirmed: true } };
const source = patch => buildSource(validateSpec({ ...base, designFile, ...patch }));
const detail = (id, title) => ({ success: true, content: { processInstanceId: id, title, instanceStatus: 'RUNNING' } });
const response = value => ({ ok: true, json: async () => value });

test('an unbound business progress component never invents an instance or queries tasks', async () => {
  const fetch = jest.fn();
  const app = mount(source({ view: 'progress' }), undefined, fetch, { component: 'ProcessProgressSection' });
  await app.flush();
  expect(fetch).not.toHaveBeenCalled();
  expect(app.nodes('Empty')).toHaveLength(1);
  app.unmount();
});

test('the homepage preset is a five-item preview without extra tabs or search controls', async () => {
  const bridge = { ready: true, getTodoTasksInApp: jest.fn().mockResolvedValue({ data: [{ taskId: 't', title: 'Request' }], totalCount: 30 }) };
  const app = mount(source({ pageSize: 5, showSearch: false, showPagination: false, fields: ['title', 'summary'] }), bridge);
  await app.flush();
  expect(bridge.getTodoTasksInApp).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 5 }));
  expect(app.nodes('Search')).toHaveLength(0); expect(app.nodes('Pagination')).toHaveLength(0); expect(app.nodes('Tabs')).toHaveLength(0);
  expect(app.nodes('Table')[0].props.columns.map(column => column.key)).toEqual(['title', 'summary', 'action']);
  app.unmount();
});

test('switching the business instance cancels the previous read and never displays its response', async () => {
  let resolveOld;
  const fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(response(detail('two', 'Second request')));
  const app = mount(source({ view: 'progress' }), undefined, fetch, { component: 'ProcessProgressSection', props: { processInstanceId: 'one' } });
  await app.flush();
  app.updateProps({ processInstanceId: 'two' }); await app.flush();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(app.nodes('Text').some(node => node.props.children.includes('Second request'))).toBe(true);
  resolveOld(response(detail('one', 'Old request'))); await app.flush();
  expect(app.nodes('Text').some(node => node.props.children.includes('Old request'))).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
  app.unmount();
});

test('history failures retain process details and expose a retryable partial error', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(response(detail('one', 'Purchase request'))).mockRejectedValueOnce(new Error('history offline'));
  const app = mount(source({ view: 'progress', history: true }), undefined, fetch, { component: 'ProcessProgressSection', props: { processInstanceId: 'one' } });
  await app.flush();
  expect(app.nodes('Text').some(node => node.props.children.includes('Purchase request'))).toBe(true);
  expect(app.nodes('Alert').some(node => node.props.type === 'warning')).toBe(true);
  expect(app.nodes('Timeline')).toHaveLength(0);
  fetch.mockResolvedValueOnce(response(detail('one', 'Refreshed request'))).mockResolvedValueOnce(response({ success: true, content: [] }));
  app.nodes('Button')[0].props.onClick(); await app.flush();
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(app.nodes('Alert')).toHaveLength(0);
  app.unmount();
});

test('interactive task filters reset pagination and clear the server condition', async () => {
  const fetch = jest.fn().mockResolvedValue(response({ success: true, content: { values: [{ appType: 'APP_TEST', taskId: 't', title: 'Invoice' }], totalCount: 40 } }));
  const app = mount(source({ transport: 'app-query', filterFields: { todo: ['originators'] } }), undefined, fetch);
  await app.flush();
  app.nodes('Pagination')[0].props.onChange(2); await app.flush();
  app.nodes('TaskFilterControls')[0].props.onChange('originators', ['person-a']); await app.flush();
  const query = () => JSON.parse(new URL(fetch.mock.calls[fetch.mock.calls.length - 1][0], 'https://example.test').searchParams.get('query'));
  expect(query()).toMatchObject({ page: 1, originators: ['person-a'] });
  app.nodes('TaskFilterControls')[0].props.onChange('originators', undefined); await app.flush();
  expect(query()).not.toHaveProperty('originators');
  expect(app.nodes('Tabs')).toHaveLength(0);
  expect(app.nodes('Table')[0].props.columns.map(column => column.key)).not.toContain('summary');
  app.unmount();
});

test('a late member lookup cannot overwrite the newer search result', async () => {
  let resolveOld;
  const fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(response({ success: true, content: { values: [{ staffId: 'new', displayName: 'New member' }] } }));
  const config = validateSpec({ ...base, designFile, transport: 'app-query', filterFields: { todo: ['originators'] } });
  const change = jest.fn();
  const app = mount(buildSource(config), undefined, fetch, { component: 'TaskFilterControls', props: { config, kind: 'todo', values: {}, onChange: change } });
  app.nodes('Select')[0].props.onSearch('old'); app.nodes('Select')[0].props.onSearch('new'); await app.flush();
  resolveOld(response({ success: true, content: { values: [{ staffId: 'old', displayName: 'Old member' }] } })); await app.flush();
  expect(app.nodes('Select')[0].props.options).toEqual([{ value: 'new', label: 'New member' }]);
  app.nodes('Select')[0].props.onChange('new');
  expect(change).toHaveBeenLastCalledWith('originators', ['new']);
  app.unmount();
});
