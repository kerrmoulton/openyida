'use strict';

const contract = require('../lib/task-center/contract');
const { createTaskCenterLoader } = require('../lib/task-center/loader');

const context = { appType: 'APP_TEST', kind: 'todo', page: 2, pageSize: 10 };
const response = rows => ({ success: true, content: { data: rows, totalCount: 23, currentPage: 2 } });

test.each([
  ['todo', 'getTodoTasksInApp'], ['created', 'getMySubmitInApp'],
  ['submitted', 'getMySubmitInApp'], ['done', 'getDoneTasksInApp'], ['cc', 'getNotifyMeTasksInApp'],
])('%s selects the application API and server pagination', (kind, method) => {
  const request = contract.request(kind, { appType: 'APP_TEST', page: 2, pageSize: 10, keyword: 'leave' });
  expect(request.method).toBe(method);
  expect(request.params).toEqual({ appType: 'APP_TEST', currentPage: 2, pageSize: 10, keyword: 'leave' });
});

test.each(['todo', 'done', 'created'])('%s rejects unsupported filters instead of filtering the current page', kind => {
  expect(() => contract.request(kind, { appType: 'APP_TEST', processCodes: ['p'] })).toThrow('TASK_FILTER_UNSUPPORTED');
  expect(() => contract.request(kind, { appType: 'APP_TEST', instanceStatus: 'RUNNING' })).toThrow('TASK_FILTER_UNSUPPORTED');
});

test('cc serializes the supported process filter exactly once', () => {
  expect(contract.request('cc', { appType: 'APP_TEST', processCodes: '["p"]', instanceStatus: 'RUNNING' }).params)
    .toMatchObject({ processCodes: '["p"]', instanceStatus: 'RUNNING' });
  expect(() => contract.request('cc', { appType: 'APP_TEST', processCodes: 'p' })).toThrow('TASK_FILTER_INVALID');
});

test.each([0, -1, 101, 1.5, '2x', NaN, Infinity])('rejects invalid page size %s', pageSize => {
  expect(() => contract.request('todo', { appType: 'APP_TEST', pageSize })).toThrow('TASK_PAGINATION_INVALID');
});

test('normalizes both direct v1 and wrapped responses without losing totals', () => {
  const payload = response([{ taskId: 't', processInstanceId: 'p', title: '{"zh_CN":"请假"}' }]);
  const value = contract.normalize(payload, context);
  expect(value).toMatchObject({ total: 23, page: 2, pageSize: 10, items: [{ title: '请假', detailTarget: { type: 'process-detail', appType: 'APP_TEST', processInstanceId: 'p', taskId: 't' } }] });
  expect(contract.normalize(payload.content, context)).toEqual(value);
});

test('same process with multiple tasks and carbon nodes keeps separate records', () => {
  const rows = [{ processInstanceId: 'p', taskId: 't1' }, { processInstanceId: 'p', taskId: 't2' }];
  const tasks = contract.normalize(response(rows), context).items;
  expect(new Set(tasks.map(row => row.key)).size).toBe(2);
  const carbon = contract.normalize(response(rows.map((row, i) => ({ ...row, carbonActivityId: 'node-' + i }))), { ...context, kind: 'cc' }).items;
  expect(new Set(carbon.map(row => row.key)).size).toBe(2);
  expect(carbon[1].detailTarget).toMatchObject({ type: 'carbon-detail', activityId: 'node-1' });
});

test('a task keeps its key when its position changes', () => {
  const first = { taskId: 't1', processInstanceId: 'p' };
  const second = { taskId: 't2', processInstanceId: 'p' };
  const original = contract.normalize(response([first, second]), context).items;
  const reordered = contract.normalize(response([second, first]), context).items;
  expect(original[0].key).toBe(reordered[1].key);
});

test('repeated carbon nodes keep distinct numeric record identities', () => {
  const items = contract.normalize(response([
    { id: 11, processInstanceId: 'p', carbonActivityId: 'node' },
    { id: 12, processInstanceId: 'p', carbonActivityId: 'node' },
  ]), { ...context, kind: 'cc' }).items;
  expect(items[0].key).not.toBe(items[1].key);
  expect(items.every(item => item.detailTarget?.type === 'carbon-detail')).toBe(true);
});

test('created ordinary form and process have different detail targets', () => {
  const value = contract.normalize(response([
    { dataType: 'finst', formInstId: 'new', formInstanceId: 'old', formUuid: 'FORM_A' },
    { dataType: 'pinst', processInstanceId: 'process' },
  ]), { ...context, kind: 'created' });
  expect(value.items[0].detailTarget).toEqual({ type: 'detail', appType: 'APP_TEST', formUuid: 'FORM_A', formInstId: 'new' });
  expect(value.items[1].detailTarget).toMatchObject({ type: 'process-detail', processInstanceId: 'process' });
});

test('created process records use the typed formInstanceId fallback and prefer explicit process identity', () => {
  const value = contract.normalize(response([
    { dataType: 'pinst', formInstanceId: 'process-fallback', processInstanceId: '' },
    { dataType: 'pinst', formInstanceId: 'fallback', processInstanceId: 'preferred' },
    { formInstanceId: 'unknown-type', id: 'arbitrary' },
  ]), { ...context, kind: 'created' });
  expect(value.items[0]).toMatchObject({ processInstanceId: 'process-fallback', detailTarget: { type: 'process-detail', processInstanceId: 'process-fallback' } });
  expect(value.items[1].detailTarget.processInstanceId).toBe('preferred');
  expect(value.items[2].detailTarget).toBeNull();
});

test('arbitrary row.id never becomes a form or process instance ID', () => {
  const value = contract.normalize(response([{ id: 'not-an-instance', dataType: 'finst', formUuid: 'FORM_A' }]), { ...context, kind: 'created' });
  expect(value.items[0].detailTarget).toBeNull();
  expect(contract.normalize(response([{ processInstanceId: 'p' }]), { ...context, kind: 'cc' }).items[0].detailTarget).toBeNull();
});

test('task result and process status remain distinct; timestamps use their own roles', () => {
  const item = contract.normalize(response([{ taskId: 't', processInstanceId: 'p', processInstanceStatus: 'RUNNING', outResult: 'DISAGREE', packageGmtCreate: 1, createTime: 2, activeTime: 3, finishTime: 4 }]), { ...context, kind: 'done' }).items[0];
  expect(item).toMatchObject({ instanceStatus: 'RUNNING', result: 'DISAGREE', submittedAt: 1, finishedAt: 4, arrivedAt: null });
});

test('missing total stays unknown, rather than using page length', () => {
  expect(contract.normalize({ data: [{ taskId: 't' }] }, context).total).toBeNull();
  expect(contract.normalize({ success: true, content: null }, context)).toMatchObject({ items: [], total: 0 });
});

describe.each(['todo', 'created', 'done', 'cc'])('%s empty PageDto', kind => {
  test.each([undefined, null])('accepts omitted or null data only with an explicit zero total (%j)', data => {
    const page = { idCursor: 0, currentPage: 1, totalCount: 0, ...(data === undefined ? {} : { data }) };
    const expected = { items: [], total: 0, page: 1, pageSize: 10 };
    const taskContext = { ...context, kind };
    expect(contract.normalize(page, taskContext)).toEqual(expected);
    expect(contract.normalize({ success: true, content: page, errorCode: '', errorMsg: '' }, taskContext)).toEqual(expected);
  });

  test.each([
    {}, { totalCount: 1 }, { totalCount: 1, data: null },
    { totalCount: '0' }, { totalCount: null, data: null },
    { totalCount: 0, data: {} }, { totalCount: 0, data: false },
  ])('rejects an unproven empty result or malformed data (%j)', page => {
    expect(() => contract.normalize(page, { ...context, kind })).toThrow('TASK_RESPONSE_INVALID');
    expect(() => contract.normalize({ success: true, content: page }, { ...context, kind })).toThrow('TASK_RESPONSE_INVALID');
  });
});

test.each([
  { success: false, content: { totalCount: 0 } },
  { errorCode: '403', content: { totalCount: 0, data: null } },
  { success: true, content: { success: false, totalCount: 0 } },
])('an empty PageDto never hides request failure (%j)', payload => {
  expect(() => contract.normalize(payload, context)).toThrow('TASK_REQUEST_FAILED');
});

test.each([
  null, {}, { content: null }, { success: true }, { data: {} }, { data: [], totalCount: -1 },
  { data: [], totalCount: 'unknown' }, { success: false, content: { data: [] } },
  { errorCode: '403', content: { data: [] } }, { content: { success: false, data: [] } },
])('malformed or failed response never becomes a successful empty list (%j)', payload => {
  expect(() => contract.normalize(payload, context)).toThrow();
});

test('login failure and unexpected application are rejected', () => {
  expect(() => contract.normalize({ __needLogin: true }, context)).toThrow('NEED_LOGIN');
  expect(() => contract.normalize(response([{ appType: 'APP_OTHER' }]), context)).toThrow('TASK_SCOPE_MISMATCH');
});

test('loader uses the visitor bridge with no developer identity or credentials', async () => {
  const bridge = { availableMethods: ['getTodoTasksInApp'], getTodoTasksInApp: jest.fn().mockResolvedValue(response([])) };
  const load = createTaskCenterLoader(contract, () => bridge);
  await expect(load('todo', { appType: 'APP_TEST', page: 2, pageSize: 10 })).resolves.toMatchObject({ total: 23, page: 2 });
  expect(bridge.getTodoTasksInApp).toHaveBeenCalledWith({ appType: 'APP_TEST', currentPage: 2, pageSize: 10 });
});

test('a wrapper function without an available underlying method is not a usable API', async () => {
  const method = jest.fn();
  const load = createTaskCenterLoader(contract, () => ({ availableMethods: [], getTodoTasksInApp: method }));
  await expect(load('todo', { appType: 'APP_TEST' })).rejects.toThrow('TASK_API_UNAVAILABLE');
  expect(method).not.toHaveBeenCalled();
});

describe('explicit application query transport', () => {
  test('capabilities and filter schemas keep the compatible default separate', () => {
    expect(contract.capabilities()).toMatchObject({ defaultTransport: 'app-v1', scope: 'app' });
    expect(Object.keys(contract.filterSchema('todo'))).toEqual(['keyword']);
    expect(contract.filterSchema('todo', 'app-query')).toMatchObject({ originators: { maxItems: 1 }, instanceCreateFrom: { format: 'unix-ms' } });
    expect(contract.filterSchema('done', 'app-query')).not.toHaveProperty('taskCreateFrom');
    expect(() => contract.filterSchema('todo', 'automatic')).toThrow('TASK_TRANSPORT_INVALID');
  });

  test.each(['todo', 'created', 'done', 'cc'])('%s always fixes a single application before server pagination', kind => {
    const request = contract.request(kind, { appType: 'APP_TEST', transport: 'app-query', page: 3, pageSize: 8, keyword: 'invoice', instanceCreateFrom: '1792195200000', instanceCreateTo: 1792281599999 });
    expect(request.transport).toBe('app-query');
    expect(request.path).toMatch(/^\/query\/task\/get[A-Za-z]+InCorp\.json$/);
    expect(JSON.parse(request.params.query)).toEqual({ appKeys: ['APP_TEST'], page: 3, limit: 8, keyword: 'invoice', instanceCreateFrom: 1792195200000, instanceCreateTo: 1792281599999 });
  });

  test.each(['appKeys', 'userId', 'corpId', 'query', 'endpoint', 'headers', 'dataType', 'result'])('never forwards a scope, identity or unsupported override (%s)', field => {
    expect(() => contract.request('todo', { appType: 'APP_TEST', transport: 'app-query', [field]: 'other' })).toThrow('TASK_FILTER_UNSUPPORTED');
    expect(() => contract.normalizeFilters('todo', { [field]: 'other' }, 'app-query')).toThrow('TASK_FILTER_UNSUPPORTED');
  });

  test('normalizes arrays once and rejects multi-person semantics or invalid ranges', () => {
    const value = contract.normalizeFilters('todo', { originators: '["user-a"]', processCodes: ['process-a'], taskCreateFrom: '1792195200000' }, 'app-query');
    expect(value).toEqual({ originators: ['user-a'], processCodes: ['process-a'], taskCreateFrom: 1792195200000 });
    expect(JSON.parse(contract.request('todo', { appType: 'APP_TEST', transport: 'app-query', ...value }).params.query)).toMatchObject(value);
    for (const filters of [{ originators: ['a', 'b'] }, { originators: 'a' }, { processCodes: [false] }, { instanceCreateFrom: -1 }, { taskCreateFrom: Infinity }, { taskCreateTo: 'tomorrow' }, { instanceCreateFrom: 20, instanceCreateTo: 10 }]) {
      expect(() => contract.normalizeFilters('todo', filters, 'app-query')).toThrow('TASK_FILTER_INVALID');
    }
    expect(() => contract.request('todo', { appType: 'APP_TEST', taskCreateFrom: 1792195200000 })).toThrow('TASK_FILTER_UNSUPPORTED');
    expect(() => contract.request('cc', { appType: 'APP_TEST', transport: 'app-query', taskFinishFrom: 1792195200000 })).toThrow('TASK_FILTER_UNSUPPORTED');
  });

  test('carbon status uses the declared numeric query values while legacy status stays compatible', () => {
    expect(contract.filterSchema('cc', 'app-query').instanceStatus).toEqual({ type: 'enum', values: [0, 1, 2, 3], labels: { 0: 'RUNNING', 1: 'TERMINATED', 2: 'COMPLETED', 3: 'ERROR' } });
    expect(contract.normalizeFilters('cc', { instanceStatus: '2' }, 'app-query')).toEqual({ instanceStatus: 2 });
    expect(JSON.parse(contract.request('cc', { appType: 'APP_TEST', transport: 'app-query', instanceStatus: 2 }).params.query).instanceStatus).toBe(2);
    for (const status of [0, 1, 2, 3]) {
      expect(contract.normalizeFilters('cc', { instanceStatus: String(status) }, 'app-query').instanceStatus).toBe(status);
    }
    for (const status of ['RUNNING', 'COMPLETED', 'TERMINATED', 4, 99, -1, false]) {
      expect(() => contract.request('cc', { appType: 'APP_TEST', transport: 'app-query', instanceStatus: status })).toThrow('TASK_FILTER_INVALID');
    }
    expect(contract.request('cc', { appType: 'APP_TEST', instanceStatus: 'RUNNING' }).params.instanceStatus).toBe('RUNNING');
    expect(() => contract.request('created', { appType: 'APP_TEST', transport: 'app-query', instanceStatus: 2 })).toThrow('TASK_FILTER_UNSUPPORTED');
  });

  test('scoped normalization uses server values and total, preserving native detail', () => {
    const normalized = contract.normalize({ success: true, content: { values: [{ appType: 'APP_TEST', taskId: 'task-a', processInstanceId: 'instance-a' }], totalCount: 18, currentPage: 2 } }, { ...context, transport: 'app-query' });
    expect(normalized).toMatchObject({ total: 18, page: 2, pageSize: 10, items: [{ appType: 'APP_TEST', detailTarget: { type: 'process-detail', taskId: 'task-a' } }] });
    expect(contract.normalize({ success: true, content: null }, { ...context, transport: 'app-query' })).toMatchObject({ items: [], total: 0 });
    expect(contract.normalize({ success: true, content: { values: [], totalCount: 0 } }, { ...context, transport: 'app-query' }).items).toEqual([]);
  });

  test.each([{ taskId: 'missing-app' }, { appType: 'APP_OTHER', taskId: 'other' }])('a missing or different application fails the entire page (%j)', row => {
    expect(() => contract.normalize({ success: true, content: { values: [row], totalCount: 1 } }, { ...context, transport: 'app-query' })).toThrow('TASK_SCOPE_MISMATCH');
  });

  test.each([{}, { success: true }, { success: true, content: {} }, { success: true, content: { values: null, totalCount: 2 } }, { success: false, content: null }])('never disguises malformed or failed advanced queries as empty (%j)', payload => {
    expect(() => contract.normalize(payload, { ...context, transport: 'app-query' })).toThrow();
  });

  test.each(['todo', 'created', 'done', 'cc'])('%s keeps the requested page for a proven empty zero-page response', kind => {
    const page = { currentPage: 0, limit: 10, start: 0, totalCount: 0, values: null };
    const ctx = { ...context, kind, transport: 'app-query', page: 3 };
    expect(contract.normalize({ success: true, content: page }, ctx)).toEqual({ items: [], total: 0, page: 3, pageSize: 10 });
    expect(contract.normalize({ ...page, values: [] }, ctx)).toEqual({ items: [], total: 0, page: 3, pageSize: 10 });
    for (const invalid of [
      { ...page, currentPage: -1 },
      { ...page, values: [{ appType: 'APP_TEST', taskId: 'task-a' }] },
      { currentPage: 0, values: [] },
      { ...page, totalCount: 2, values: [] },
    ]) { expect(() => contract.normalize({ success: true, content: invalid }, ctx)).toThrow('TASK_PAGINATION_INVALID'); }
  });

  test('the loader selects the explicit request transport without consulting or falling back to the bridge', async () => {
    const bridge = jest.fn();
    const requestJson = jest.fn().mockResolvedValue({ success: true, content: { values: [], totalCount: 0 } });
    const load = createTaskCenterLoader(contract, bridge, requestJson);
    await expect(load('todo', { appType: 'APP_TEST', transport: 'app-query', originators: ['person'] })).resolves.toMatchObject({ items: [], total: 0 });
    expect(bridge).not.toHaveBeenCalled();
    expect(JSON.parse(requestJson.mock.calls[0][0].params.query)).toMatchObject({ appKeys: ['APP_TEST'], originators: ['person'] });
    requestJson.mockRejectedValue(new Error('read unavailable'));
    await expect(load('todo', { appType: 'APP_TEST', transport: 'app-query' })).rejects.toThrow('read unavailable');
    expect(bridge).not.toHaveBeenCalled();
  });

  test('the default browser loader makes only an authenticated same-origin read', async () => {
    const previous = global.window;
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, content: { values: [], totalCount: 0 } }) });
    global.window = { fetch };
    try {
      const bridge = jest.fn();
      const load = createTaskCenterLoader(contract, bridge);
      await load('todo', { appType: 'APP_TEST', transport: 'app-query' });
      expect(fetch.mock.calls[0][0]).toMatch(/^\/query\/task\/getTodoTasksInCorp\.json\?/);
      expect(fetch.mock.calls[0][1]).toEqual({ method: 'GET', credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      expect(bridge).not.toHaveBeenCalled();
      fetch.mockResolvedValue({ ok: false });
      await expect(load('todo', { appType: 'APP_TEST', transport: 'app-query' })).rejects.toHaveProperty('code', 'TASK_REQUEST_FAILED');
      fetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('not JSON'); } });
      await expect(load('todo', { appType: 'APP_TEST', transport: 'app-query' })).rejects.toHaveProperty('code', 'TASK_RESPONSE_INVALID');
    } finally {
      if (previous === undefined) { delete global.window; } else { global.window = previous; }
    }
  });
});
