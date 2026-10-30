'use strict';

const { createYidaClient } = require('../../core/yida-client');
const { CliError } = require('../../core/cli-error');
const { t } = require('../../core/i18n');
const { readFormMode } = require('../../app/services/form-mode-service');

/** Extract real field IDs and subtable ancestry from modern and legacy schemas. */
function extractProcessFields(response) {
  if (!response || response.success !== true || !response.content) {
    throw new CliError(t('process_errors.field_source_failed'), {
      code: 'PROCESS_FORM_FIELDS_READ_FAILED', details: { errorCode: response && response.errorCode },
    });
  }
  let schema = response.content;
  try { if (typeof schema === 'string') { schema = JSON.parse(schema); } } catch {
    throw new CliError(t('process_errors.field_source_failed'), { code: 'PROCESS_FORM_SCHEMA_INVALID' });
  }
  if (!schema || !Array.isArray(schema.pages)) {
    throw new CliError(t('process_errors.field_source_failed'), { code: 'PROCESS_FORM_SCHEMA_INVALID' });
  }
  const fields = [];
  const seen = new Set();
  function visit(node, tables = []) {
    if (Array.isArray(node)) { node.forEach(child => visit(child, tables)); return; }
    if (!node || typeof node !== 'object') { return; }
    const props = node.props || {};
    const fieldId = props.fieldId || node.fieldId;
    if (/Field$/.test(node.componentName || '') && fieldId) {
      if (seen.has(fieldId)) {
        throw new CliError(t('process_errors.field_permissions_invalid'), {
          code: 'PROCESS_FORM_FIELD_DUPLICATE', details: { fieldId },
        });
      }
      seen.add(fieldId);
      const label = props.label;
      fields.push({ fieldId, componentName: node.componentName,
        label: typeof label === 'object' && label ? label.zh_CN || label.en_US || '' : label || '',
        parentFieldId: tables[tables.length - 1] || null, fieldPath: [...tables, fieldId] });
    }
    visit(node.children, node.componentName === 'TableField' && fieldId ? [...tables, fieldId] : tables);
  }
  schema.pages.forEach(page => visit(page.componentsTree || page.layout));
  return { schema, fields };
}

/** Compare form-ID and designer process-code read paths without overwriting either resource. */
async function inspectProcessFields(authRef, input, options = {}) {
  const { appType, formUuid } = input;
  const mode = options.binding || await readFormMode(authRef, { appType, formUuid });
  if (input.processCode && input.processCode !== mode.processCode) {
    throw new CliError(t('configure_process.ownership_unverified'), { code: 'CONFIGURE_PROCESS_OWNERSHIP_UNVERIFIED' });
  }
  const client = createYidaClient({ authRef });
  const form = extractProcessFields(await client.get(
    `/alibaba/web/${appType}/_view/query/formdesign/getFormSchema.json`, { formUuid, schemaVersion: 'V5' }
  ));
  if (!form.fields.length) {
    throw new CliError(t('process_errors.fields_empty'), { code: 'PROCESS_FORM_FIELDS_EMPTY', details: { formUuid } });
  }
  if (!mode.processCode) {
    return { success: true, appType, formUuid, processCode: null, fields: form.fields,
      designerVerified: false, verificationLevel: 'FORM_FIELDS_ONLY', remoteWrites: 0 };
  }
  const designer = extractProcessFields(await client.get(
    `/alibaba/web/${appType}/query/formdesign/getFormSchema.json`, { processCode: mode.processCode }
  ));
  const schemaBinding = designer.schema.formUuid || designer.schema.bindingForm;
  if (schemaBinding && schemaBinding !== formUuid) {
    throw new CliError(t('configure_process.ownership_unverified'), { code: 'PROCESS_DESIGNER_FORM_MISMATCH' });
  }
  const missing = form.fields.filter(field => !designer.fields.some(item => item.fieldId === field.fieldId));
  if (missing.length) {
    throw new CliError(t('process_errors.designer_fields_missing'), {
      code: 'PROCESS_DESIGNER_FIELDS_MISSING',
      details: { formUuid, processCode: mode.processCode, missingFieldIds: missing.map(field => field.fieldId), remoteWrites: 0 },
    });
  }
  return { success: true, appType, formUuid, processCode: mode.processCode, fields: form.fields,
    designerVerified: true, verificationLevel: 'DESIGNER_FIELD_IDS_VERIFIED', runtimeVerified: false, remoteWrites: 0 };
}

/** Stop before saving a process when permissions refer to fields missing from its bound form. */
function assertPermissionFields(flowConfig, fields) {
  const known = new Set(fields.map(field => field.fieldId));
  const missing = [...new Set(Object.values(flowConfig).flat().map(item => item.fieldId).filter(id => !known.has(id)))];
  if (missing.length) {
    throw new CliError(t('process_errors.field_not_found'), {
      code: 'PROCESS_PERMISSION_FIELD_NOT_FOUND', details: { fieldIds: missing, remoteWrites: 0 },
    });
  }
}

module.exports = { extractProcessFields, inspectProcessFields, assertPermissionFields };
