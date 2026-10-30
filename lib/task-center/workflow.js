'use strict';

// Portable, read-only process semantics shared by CLI commands and Canvas output.
function createWorkflowContract(tasks) {
  const text = tasks.text;
  function fail(code, field) {
    const error = new Error(code + (field ? ': ' + field : ''));
    error.code = code;
    error.field = field || '';
    throw error;
  }
  function identifier(value, field) {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 256 || Array.from(value).some(character => character.charCodeAt(0) <= 32)) {
      fail('WORKFLOW_INPUT_INVALID', field);
    }
    return value;
  }
  function options(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) { fail('WORKFLOW_INPUT_INVALID', 'options'); }
    for (const key of Object.keys(input)) {
      if (!['appType', 'processInstanceId', 'formUuid', 'taskId', 'history'].includes(key)) { fail('WORKFLOW_INPUT_INVALID', key); }
    }
    const result = { appType: tasks.appOf(input.appType), processInstanceId: identifier(input.processInstanceId, 'processInstanceId'), history: input.history === true };
    if (input.history !== undefined && typeof input.history !== 'boolean') { fail('WORKFLOW_INPUT_INVALID', 'history'); }
    for (const key of ['formUuid', 'taskId']) { if (input[key] !== undefined) { result[key] = identifier(input[key], key); } }
    if (result.taskId && !result.history) { fail('WORKFLOW_INPUT_INVALID', 'taskId requires history'); }
    return result;
  }
  function request(kind, input) {
    const target = options(input);
    if (!['detail', 'history'].includes(kind)) { fail('WORKFLOW_INPUT_INVALID', 'kind'); }
    return { appType: target.appType, method: kind === 'detail' ? 'getProcessInstanceById' : 'getOperationRecords',
      path: '/dingtalk/web/' + target.appType + '/v1/process/' + (kind === 'detail' ? 'getInstanceById' : 'getOperationRecords') + '.json', params: { processInstanceId: target.processInstanceId } };
  }
  function unwrap(payload) {
    tasks.checkFailure(payload);
    if (payload.success !== true) { fail('WORKFLOW_RESPONSE_INVALID', 'success'); }
    const value = Object.prototype.hasOwnProperty.call(payload, 'content') ? payload.content : payload.result;
    if (value && !Array.isArray(value)) { tasks.checkFailure(value); }
    return value;
  }
  function scope(row, target, requireInstance = false) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { fail('WORKFLOW_RESPONSE_INVALID', 'record'); }
    if (row.appType !== undefined && row.appType !== target.appType) { fail('WORKFLOW_SCOPE_MISMATCH', 'appType'); }
    if ((requireInstance || row.processInstanceId !== undefined) && row.processInstanceId !== target.processInstanceId) {
      fail('WORKFLOW_SCOPE_MISMATCH', 'processInstanceId');
    }
    if (target.formUuid && row.formUuid !== undefined && row.formUuid !== target.formUuid) { fail('WORKFLOW_SCOPE_MISMATCH', 'formUuid'); }
  }
  function time(value) {
    if (value === undefined || value === null || value === '') { return null; }
    const number = /^\d+$/.test(String(value)) ? Number(value)
      : typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
    return Number.isSafeInteger(number) && number > 0 && number <= 8640000000000000 ? number : null;
  }
  function person(value, fallbackName) {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return { id: text(row.userId || row.emplId || (typeof value === 'string' ? value : '')), name: text(row.displayName || row.name || fallbackName) };
  }
  function detail(payload, input) {
    const target = options(input), row = unwrap(payload);
    scope(row, target, true);
    if (target.formUuid && row.formUuid !== target.formUuid) { fail('WORKFLOW_SCOPE_MISMATCH', 'formUuid'); }
    const status = text(row.instanceStatus || row.processInstanceStatus || row.status).toUpperCase();
    const instanceStatus = ['RUNNING', 'COMPLETED', 'TERMINATED', 'ERROR'].includes(status) ? status : 'UNKNOWN';
    if (row.tasks !== undefined && (!Array.isArray(row.tasks) || row.tasks.some(task => !task || typeof task !== 'object' || Array.isArray(task)))) { fail('WORKFLOW_RESPONSE_INVALID', 'tasks'); }
    const current = row.currentTasks || row.currentTaskList || (row.tasks && row.tasks.filter(task => task && ['RUNNING', 'NEW'].includes(text(task.status || task.taskStatus).toUpperCase())));
    if (current !== undefined && !Array.isArray(current)) { fail('WORKFLOW_RESPONSE_INVALID', 'currentTasks'); }
    const currentNodes = (instanceStatus === 'RUNNING' && current || []).map(task => {
      scope(task, target);
      return { taskId: text(task.taskId), activityId: text(task.activityId), name: text(task.activityName || task.taskName), assignees: [person(task.operator || task.assignee, task.operatorName)].filter(item => item.id || item.name) };
    });
    return {
      appType: target.appType, processInstanceId: target.processInstanceId, formUuid: text(row.formUuid) || null,
      title: text(row.title || row.processInstanceTitle), instanceStatus,
      processResult: tasks.outcome(row.processApprovedResult || row.approvedResult, row.processApprovedResultText),
      submittedAt: time(row.startTime || row.processStartTime || row.gmtCreate),
      processFinishedAt: time(row.endTime || row.processFinishTime),
      summary: tasks.summary(row.approvalSummary), currentNodes,
      progressAvailable: current !== undefined || ['COMPLETED', 'TERMINATED'].includes(instanceStatus),
      detailTarget: { type: 'process-detail', appType: target.appType, processInstanceId: target.processInstanceId },
    };
  }
  function history(payload, input) {
    const target = options(input), data = unwrap(payload);
    const rows = Array.isArray(data) ? data : data && data.data;
    if (!Array.isArray(rows)) { fail('WORKFLOW_RESPONSE_INVALID', 'history'); }
    return rows.map((row, index) => {
      scope(row, target);
      const type = text(row.type).toUpperCase();
      return {
        key: row.id === undefined ? String(index) : text(row.id), taskId: text(row.taskId), activityId: text(row.activityId),
        type: ['TODO', 'HISTORY'].includes(type) ? type : 'UNKNOWN',
        name: text(row.activityName || row.taskName), actor: person(row.operator, row.operatorName),
        action: text(row.action), result: type === 'HISTORY' ? tasks.outcome(row.actionExt || row.outResult, row.action || row.outResultName) : 'UNKNOWN',
        operatedAt: type === 'HISTORY' ? time(row.operateTime || row.gmtCreate) : null,
        comment: text(row.remark || row.comment),
      };
    });
  }
  function combine(value, historyState, input) {
    const target = options(input), items = historyState.items;
    const result = { ...value, history: historyState, taskResult: null };
    if (value.instanceStatus === 'RUNNING' && !value.progressAvailable && historyState.state === 'ready') {
      result.currentNodes = items.filter(row => row.type === 'TODO').map(row => ({ taskId: row.taskId, activityId: row.activityId, name: row.name, assignees: row.actor.id || row.actor.name ? [row.actor] : [] }));
      result.progressAvailable = result.currentNodes.length > 0;
    }
    if (target.taskId) {
      const matching = items.filter(row => row.type === 'HISTORY' && row.taskId === target.taskId);
      const outcomes = matching.map(row => row.result);
      result.taskResult = { taskId: target.taskId, result: historyState.state === 'ready' && outcomes.length && outcomes.every(value => value === outcomes[0]) ? outcomes[0] : 'UNKNOWN' };
    }
    return result;
  }
  return { options, request, detail, history, combine, fail };
}

module.exports = { createWorkflowContract };
