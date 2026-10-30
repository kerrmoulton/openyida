'use strict';

const { CliError } = require('./cli-error');
const { t } = require('./i18n');

function invalidOption(option) {
  throw new CliError(t('query_data.approver_option_invalid', option), {
    code: 'DATA_INVALID_ARGUMENTS', details: { option },
  });
}

function positiveInteger(value, fallback, option) {
  if (value === undefined) {return fallback;}
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    invalidOption(option);
  }
  return Number(value);
}

function validateApproverOptions(options) {
  const userId = options.current_approver;
  if (typeof userId !== 'string' || !userId.trim() || /[,\s]/.test(userId)) {
    invalidOption('--current-approver <userId>');
  }
  if (options.count !== undefined && options.count !== true) {invalidOption('--count');}
  if (options.instance_status !== undefined && options.instance_status !== 'RUNNING') {
    invalidOption('--instance-status RUNNING');
  }
  for (const key of ['ids_only', 'approved_result', 'task_id', 'user_id']) {
    if (options[key] !== undefined) {invalidOption(`--${key.replace(/_/g, '-')}`);}
  }
  if (positiveInteger(options.page, 1, '--page 1') !== 1) {invalidOption('--page 1');}
  positiveInteger(options.size, 100, '--size');
  positiveInteger(options.max_pages, 1000, '--max-pages');
}

function unwrap(response) {
  if (response.result !== undefined) {return response.result;}
  if (response.content !== undefined) {return response.content;}
  return response;
}

function id(value) {
  if (typeof value === 'string' && value.trim()) {return value.trim();}
  if (typeof value === 'number' && Number.isSafeInteger(value)) {return String(value);}
  return null;
}

/** Count only server-authorized RUNNING instances, using their current TODO records. */
async function queryByCurrentApprover({ appType, formUuid, options, params, request, identity }) {
  validateApproverOptions(options);
  const userId = options.current_approver;
  const pageSize = Math.min(positiveInteger(options.size, 100, '--size'), 100);
  const maxPages = positiveInteger(options.max_pages, 1000, '--max-pages');
  const seen = new Set();
  const matches = [];
  let count = 0;
  let total = null;
  let pagesFetched = 0;
  const initialIdentity = identity();
  const target = { appType, formUuid, currentApproverUserId: userId };

  function stop(reason, invalidResponse = false) {
    throw new CliError(t(`query_data.approver_${invalidResponse ? 'response_invalid' : 'incomplete'}`), {
      code: invalidResponse ? 'DATA_PROCESS_RESPONSE_INVALID' : 'DATA_PROCESS_COUNT_INCOMPLETE',
      details: { ...target, reason, complete: false, count: null, scannedInstanceCount: seen.size, pagesFetched },
    });
  }

  async function read(endpoint, query) {
    let response;
    try {
      response = await request(`/dingtalk/web/${appType}/v1/process/${endpoint}.json`, query);
    } catch (error) {
      throw new CliError(error.message || t('query_data.approver_incomplete'), {
        code: error.code || 'DATA_PROCESS_QUERY_FAILED',
        details: { ...target, endpoint, complete: false, count: null },
      });
    }
    if (identity() !== initialIdentity) {stop('query_identity_changed');}
    const errorCode = response && response.errorCode;
    if (!response || response.success !== true ||
        (errorCode !== undefined && errorCode !== null && errorCode !== '' && errorCode !== 0 && errorCode !== '0')) {
      throw new CliError(response && response.errorMsg || t('query_data.approver_incomplete'), {
        code: 'DATA_API_ERROR',
        details: { ...target, serverErrorCode: errorCode, endpoint, complete: false, count: null },
      });
    }
    return unwrap(response);
  }

  for (let page = 1; page <= maxPages; page++) {
    const result = await read('getInstances', {
      ...params, formUuid, instanceStatus: 'RUNNING', currentPage: String(page), pageSize: String(pageSize),
    });
    pagesFetched++;
    if (!result || !Array.isArray(result.data) ||
        !['string', 'number'].includes(typeof result.totalCount) || String(result.totalCount).trim() === '' ||
        !Number.isSafeInteger(Number(result.totalCount)) || Number(result.totalCount) < 0) {
      stop('invalid_process_page', true);
    }
    if (result.currentPage !== undefined && Number(result.currentPage) !== page) {stop('unexpected_page');}
    if (total !== null && total !== Number(result.totalCount)) {stop('source_total_changed');}
    total = Number(result.totalCount);
    const previousSize = seen.size;

    for (const instance of result.data) {
      const instanceId = instance && id(instance.processInstanceId);
      if (!instanceId || (instance.formUuid !== undefined && instance.formUuid !== formUuid) ||
          (instance.instanceStatus !== undefined && instance.instanceStatus !== 'RUNNING')) {
        stop('invalid_process_instance', true);
      }
      if (seen.has(instanceId)) {continue;}
      seen.add(instanceId);
      const payload = await read('getOperationRecords', { processInstanceId: instanceId });
      const records = Array.isArray(payload) ? payload : payload && payload.data;
      if (!Array.isArray(records)) {stop('invalid_operation_records', true);}
      let matched = false;
      for (const record of records) {
        if (!record || typeof record.type !== 'string' ||
            (record.processInstanceId !== undefined && record.processInstanceId !== instanceId)) {
          stop('invalid_operation_record', true);
        }
        if (record.type !== 'TODO') {continue;}
        const operatorId = id(record.operator && typeof record.operator === 'object' ? record.operator.userId : record.operator);
        if (!operatorId) {stop('missing_todo_operator', true);}
        if (operatorId === userId) {matched = true;}
      }
      if (matched) {
        count++;
        if (!options.count) {matches.push(instance);}
      }
    }
    if (seen.size > total) {stop('source_total_mismatch');}
    if (seen.size === total) {
      return {
        success: true,
        result: {
          ...target, instanceStatus: 'RUNNING', count, totalCount: count,
          aggregation: 'distinct_process_instance', scope: 'current_user_visible',
          permissionNote: t('query_data.approver_scope_note'),
          sourceTotalCount: total, scannedInstanceCount: seen.size, pagesFetched, complete: true,
          ...(options.count ? {} : { data: matches }),
        },
      };
    }
    if (seen.size === previousSize) {stop('pagination_not_progressing');}
  }
  stop('max_pages_reached');
}

module.exports = { queryByCurrentApprover, validateApproverOptions };
