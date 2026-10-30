'use strict';

const { queryByCurrentApprover, validateApproverOptions } = require('../lib/core/process-approver-query');

const instance = (id, extra = {}) => ({ processInstanceId: id, formUuid: 'FORM-A', instanceStatus: 'RUNNING', ...extra });
const todo = (operator, extra = {}) => ({ type: 'TODO', operator, ...extra });
const page = (data, totalCount = data.length) => ({ success: true, result: { data, totalCount } });

function fixture(pages, records = {}, extraOptions = {}) {
  const request = jest.fn(async (endpoint, query) => {
    if (endpoint.endsWith('/getInstances.json')) {return pages[Number(query.currentPage) - 1];}
    const value = records[query.processInstanceId];
    return value && !Array.isArray(value) ? value : { success: true, content: value || [] };
  });
  const args = {
    appType: 'APP-A', formUuid: 'FORM-A',
    options: { current_approver: 'user-A', count: true, ...extraOptions },
    params: {}, request, identity: () => 'original-login',
  };
  return { args, request, run: () => queryByCurrentApprover(args) };
}

describe('current approver process queries', () => {
  test('scans every page, counts distinct instances, and excludes history, CC and proxy IDs', async () => {
    const a = instance('a', { actioners: [{ userId: 'other' }] });
    const b = instance('b', { actioners: [{ userId: 'user-A' }] });
    const f = fixture([page([a, b], 4), page([instance('c'), instance('d')], 4)], {
      a: [todo('user-A'), todo('user-A'), todo('other')],
      b: [{ type: 'HISTORY', operator: 'user-A' }, { type: 'CC', operator: 'user-A' }],
      c: [todo('other', { operatorAgentIds: ['user-A'], operatorName: 'user-A' })],
      d: [todo({ userId: 'user-A' })],
    }, { size: '2' });
    const output = await f.run();
    expect(output.result).toMatchObject({ count: 2, totalCount: 2, sourceTotalCount: 4, scannedInstanceCount: 4,
      pagesFetched: 2, complete: true, scope: 'current_user_visible', aggregation: 'distinct_process_instance' });
    expect(output.result).not.toHaveProperty('data');
    expect(f.request).toHaveBeenCalledTimes(6);
    expect(f.request.mock.calls[0][1]).toMatchObject({ instanceStatus: 'RUNNING', currentPage: '1', pageSize: '2' });
    expect(f.request.mock.calls[3][1].currentPage).toBe('2');
  });

  test('deduplicates overlapping pages and continues despite a short page when totalCount is larger', async () => {
    const f = fixture([page([instance('a')], 2), page([instance('a'), instance('b')], 2)], {
      a: [todo('user-A')], b: [todo('user-A')],
    });
    expect((await f.run()).result).toMatchObject({ count: 2, pagesFetched: 2 });
    expect(f.request.mock.calls.filter(([p]) => p.endsWith('/getOperationRecords.json'))).toHaveLength(2);
  });

  test('query mode returns matching instances and passes business filters without changing the caller', async () => {
    const a = instance('a', { data: { visibleField: 'value' } });
    const f = fixture([page([a, instance('b')])], { a: [todo('user-A')] });
    delete f.args.options.count;
    f.args.params = { searchFieldJson: '[{"key":"textField_a","value":"v"}]', originatorId: 'submitter' };
    expect((await f.run()).result.data).toEqual([a]);
    expect(f.request.mock.calls[0][1]).toMatchObject(f.args.params);
    expect(f.request.mock.calls.every(([, q]) => q.userId === undefined)).toBe(true);
  });

  test('returns an explicit scoped zero for an empty but valid server page', async () => {
    const f = fixture([{ success: true, content: { data: [], totalCount: 0, currentPage: 1 } }]);
    expect((await f.run()).result).toMatchObject({ count: 0, complete: true, scope: 'current_user_visible' });
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ success: true, data: [instance('a')], totalCount: '1' }, { success: true, result: [todo('user-A')] }],
    [page([instance('a')]), { success: true, content: { data: [todo('user-A')] } }],
  ])('accepts documented response envelopes', async (list, records) => {
    expect((await fixture([list], { a: records }).run()).result.count).toBe(1);
  });

  test.each(['list', 'records'])('propagates a server authorization failure in %s instead of returning zero', async stage => {
    const denied = { success: false, errorCode: 'TIANSHU_000006', errorMsg: '没有权限' };
    const f = fixture([stage === 'list' ? denied : page([instance('a')])], { a: denied });
    await expect(f.run()).rejects.toMatchObject({ code: 'DATA_API_ERROR', message: '没有权限',
      details: { serverErrorCode: 'TIANSHU_000006', complete: false, count: null } });
  });

  test('even success=true with an error code cannot become a count', async () => {
    await expect(fixture([{ success: true, errorCode: '403', result: { data: [], totalCount: 0 } }]).run())
      .rejects.toMatchObject({ code: 'DATA_API_ERROR' });
  });

  test.each([
    [[page([instance('a')], 2)], { max_pages: '1' }, 'max_pages_reached'],
    [[page([instance('a')], 2), page([], 2)], {}, 'pagination_not_progressing'],
    [[page([instance('a')], 2), page([instance('a')], 2)], {}, 'pagination_not_progressing'],
    [[page([instance('a')], 2), page([instance('b')], 3)], {}, 'source_total_changed'],
    [[{ success: true, result: { data: [], totalCount: 1, currentPage: 2 } }], {}, 'unexpected_page'],
    [[page([instance('a')], 0)], {}, 'source_total_mismatch'],
  ])('rejects an incomplete scan: %s', async (pages, options, reason) => {
    await expect(fixture(pages, {}, options).run()).rejects.toMatchObject({
      code: 'DATA_PROCESS_COUNT_INCOMPLETE', details: { reason, count: null, complete: false },
    });
  });

  test.each([
    [{ success: true, result: {} }, {}, 'invalid_process_page'],
    [page([], -1), {}, 'invalid_process_page'],
    [page([], false), {}, 'invalid_process_page'],
    [page([{ formInstId: 'wrong-kind' }]), {}, 'invalid_process_instance'],
    [page([instance('a', { formUuid: 'FORM-OTHER' })]), {}, 'invalid_process_instance'],
    [page([instance('a', { instanceStatus: 'COMPLETED' })]), {}, 'invalid_process_instance'],
    [page([instance('a')]), { a: { success: true, content: {} } }, 'invalid_operation_records'],
    [page([instance('a')]), { a: [todo(null)] }, 'missing_todo_operator'],
    [page([instance('a')]), { a: [todo('user-A', { processInstanceId: 'b' })] }, 'invalid_operation_record'],
  ])('does not mistake an unrecognized payload for empty data', async (list, records, reason) => {
    await expect(fixture([list], records).run()).rejects.toMatchObject({
      code: 'DATA_PROCESS_RESPONSE_INVALID', details: { reason, count: null },
    });
  });

  test('stops if automatic login changes the caller during the scan', async () => {
    const f = fixture([page([])]);
    f.args.identity = jest.fn().mockReturnValueOnce('original').mockReturnValue('different-corp-or-user');
    await expect(f.run()).rejects.toMatchObject({ details: { reason: 'query_identity_changed', count: null } });
  });

  test('network failures are not converted to a partial count', async () => {
    const f = fixture([page([instance('a')], 2)], { a: [todo('user-A')] });
    f.request.mockResolvedValueOnce(page([instance('a')], 2))
      .mockResolvedValueOnce({ success: true, content: [todo('user-A')] })
      .mockRejectedValueOnce(new Error('network unavailable'));
    await expect(f.run()).rejects.toMatchObject({ message: 'network unavailable', details: { count: null, complete: false } });
  });

  test.each([
    { current_approver: true }, { current_approver: '' }, { current_approver: 'a,b' },
    { count: 'false' }, { page: '2' }, { max_pages: '1tail' }, { size: '0' },
    { ids_only: true }, { user_id: 'other-login' }, { task_id: 'task' },
    { approved_result: 'agree' }, { instance_status: 'COMPLETED' },
  ])('validates incompatible options before network calls', options => {
    expect(() => validateApproverOptions({ current_approver: 'user-A', ...options }))
      .toThrow(expect.objectContaining({ code: 'DATA_INVALID_ARGUMENTS' }));
  });
});
