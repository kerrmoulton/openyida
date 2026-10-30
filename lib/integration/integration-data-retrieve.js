'use strict';

const { generateRuleGroupId, generateDataRuleId } = require('./integration-node-ids');
const { buildDataRetrieveCondition } = require('./integration-process-builder');
const { resolveTableFieldLabel, listTableFieldSummaries, buildSubTableRelativeItem, buildAddDataChildList,
  buildSubTableAddDataChildList } = require('./integration-view-builder');
const { resolveDataSourceFormType, resolveDataSourceFormName, resolveDataOriginalType,
  resolveDataFormItemType, resolveDataQueryField, resolveDesignerDataQueryField,
  resolveDataQueryFieldName, toDesignerDataQueryField, normalizeDataQueryFieldName } = require('./integration-form-metadata');
const { retrieveMode, batchFields } = require('./integration-batch-data');
const { t } = require('../core/i18n');

function createRetrieveBuilders({ isSubTableRetrieve, isSubTableInsert, getSourceAlias,
  resolveAlias, normalizeDataConditions, configuredDescription, resolveSubTableParentFormUuidFromContext }) {
  function resolveRetrieveSourceId(node, context) {
    if (isSubTableRetrieve(node)) {
      return resolveAlias(getSourceAlias(node), context);
    }
    return node.formUuid || node.sourceId || (node.type === 'getSelf' ? context.formUuid : undefined);
  }

  function resolveRetrieveSourceLabel(node, context, sourceId) {
    if (isSubTableRetrieve(node)) {
      const sourceNode = context.aliasToSpecNode && context.aliasToSpecNode.get(getSourceAlias(node));
      return (sourceNode && (sourceNode.name || sourceNode.formName))
        || node.formName
        || getSourceAlias(node);
    }
    return resolveDataSourceFormName(node, context)
      || node.formName
      || (context.formNamesByUuid && context.formNamesByUuid.get(sourceId))
      || sourceId;
  }

  function isUsedAsSubTableSource(node, context) {
    const alias = node.id || node.key;
    if (!alias || !context.aliasToSpecNode) {
      return false;
    }
    for (const specNode of context.aliasToSpecNode.values()) {
      if (getSourceAlias(specNode) !== alias) {
        continue;
      }
      if (isSubTableRetrieve(specNode) || isSubTableInsert(specNode)) {
        return true;
      }
    }
    return false;
  }

  function buildDataRetrieveProcessNode(node, nodeId, nextNodeId, context) {
    const mode = retrieveMode(node);
    const sourceId = resolveRetrieveSourceId(node, context);
    const dataSourceFormType = isSubTableRetrieve(node)
      ? ''
      : resolveDataSourceFormType(node, context);
    const formName = resolveRetrieveSourceLabel(node, context, sourceId);
    const rawConditions = node.type === 'getSelf' || node.getSelf
      ? [{
        bFieldId: resolveDataQueryField(node, dataSourceFormType),
        bFieldName: resolveDataQueryFieldName(dataSourceFormType),
        aFieldId: node.triggerField || '__masterdata_form_inst_id',
        componentType: 'TextField',
        opCode: 'Equal',
        valueType: 'processVar',
      }]
      : normalizeDataConditions(node.conditions || node.dataConditions, context, dataSourceFormType);
    const conditions = rawConditions.length > 0
      ? buildDataRetrieveCondition(rawConditions, node.logic || node.conditionLogic)
      : { condition: 'AND', rules: [], ruleId: generateRuleGroupId(), conditionCode: '&&' };
    return {
      name: { zh_CN: node.name || (mode === 'batch' ? t('integration.batch_retrieve_name') : '获取单条数据'), en_US: '' },
      description: configuredDescription(node, t('integration.spec_desc_retrieve', formName, conditions.rules.length)),
      type: 'dataRetrieve',
      nodeId,
      prevId: '',
      nextId: [nextNodeId],
      props: {
        type: mode,
        filterType: node.filterType || 'condition',
        sort: node.sort || { type: 'none', column: '' },
        sourceId,
        appType: context.appType,
        originalType: isSubTableRetrieve(node)
          ? 'sub_table'
          : resolveDataOriginalType(dataSourceFormType),
        subSourceId: node.subSourceId || '',
        condition: node.filterType === 'all' ? null : conditions,
        quantity: String(node.quantity || '1'),
        dataRules: {
          rules: [
            {
              componentName: '',
              labe: '',
              name: '',
              required: false,
              ruleId: generateDataRuleId(),
              value: '',
              valueType: 'literal',
            },
          ],
        },
        assignments: [],
      },
      childNodes: [],
    };
  }

  function buildDataRetrieveViewNode(node, nodeId, context) {
    const mode = retrieveMode(node);
    const componentName = mode === 'batch' ? 'GetBatchDataNode' : 'GetSingleDataNode';
    const processNode = buildDataRetrieveProcessNode(node, nodeId, nodeId, context);
    const props = processNode.props;
    const dataSourceFormType = isSubTableRetrieve(node)
      ? ''
      : resolveDataSourceFormType(node, context);
    const dataSourceFormName = isSubTableRetrieve(node)
      ? ''
      : resolveDataSourceFormName(node, context);
    const formName = resolveRetrieveSourceLabel(node, context, props.sourceId);
    const sourceSchema = context.formSchemasByUuid.get(
      isSubTableRetrieve(node) ? resolveSubTableParentFormUuidFromContext(node, context) : props.sourceId
    );
    const outputFields = mode === 'batch'
      ? batchFields(sourceSchema, props.subSourceId)
      : isSubTableRetrieve(node)
        ? buildSubTableAddDataChildList(sourceSchema, props.subSourceId).filter(field => field.componentName !== 'TableField')
        : buildAddDataChildList(sourceSchema);
    let viewCondition;
    if (node.type === 'getSelf' || node.getSelf) {
      viewCondition = buildDataRetrieveCondition([{
        bFieldId: resolveDesignerDataQueryField(node, dataSourceFormType),
        bFieldName: resolveDataQueryFieldName(dataSourceFormType),
        aFieldId: node.triggerField || '__masterdata_form_inst_id',
        componentType: 'TextField',
        opCode: 'Equal',
        valueType: 'processVar',
      }]);
    } else if (isSubTableRetrieve(node)) {
      viewCondition = props.condition;
    } else if (props.filterType === 'all') {
      viewCondition = null;
    } else {
      viewCondition = {
        ...props.condition,
        rules: (props.condition.rules || []).map((rule) => {
          const designerFieldId = toDesignerDataQueryField(rule.id, dataSourceFormType);
          const designerFieldName = normalizeDataQueryFieldName(
            rule.id,
            dataSourceFormType,
            rule.name,
          );
          return designerFieldId === rule.id && designerFieldName === rule.name
            ? rule
            : {
              ...rule,
              id: designerFieldId,
              name: designerFieldName,
            };
        }),
      };
    }
    let targetItem;
    let relativeItem = {};
    if (isSubTableRetrieve(node)) {
      const parentFormUuid = resolveSubTableParentFormUuidFromContext(node, context);
      const schemaComponents = parentFormUuid
        ? (context.formSchemasByUuid.get(parentFormUuid) || [])
        : [];
      const subTableLabel = node.subSourceLabel
        || resolveTableFieldLabel(schemaComponents, props.subSourceId, props.subSourceId);
      targetItem = {
        deep: 0,
        value: props.sourceId,
        label: formName,
      };
      relativeItem = buildSubTableRelativeItem(props.subSourceId, subTableLabel);
    } else {
      const schemaComponents = context.formSchemasByUuid.get(props.sourceId) || [];
      const tableFields = isUsedAsSubTableSource(node, context)
        ? listTableFieldSummaries(schemaComponents)
        : [];
      targetItem = {
        appType: context.appType,
        appName: '',
        formItem: {
          formType: resolveDataFormItemType(dataSourceFormType),
          advanceProc: 'n',
          formUuid: props.sourceId,
          title: dataSourceFormName || formName,
          fields: tableFields.length > 0 ? tableFields : null,
          hasTableField: tableFields.length > 0 ? true : null,
        },
      };
    }
    return {
      componentName,
      id: nodeId,
      props: {
        nodeName: componentName,
        name: processNode.name.zh_CN,
        description: processNode.description,
        type: mode,
        getData: {
          type: mode,
          originalType: props.originalType,
          appType: context.appType,
          sourceId: props.sourceId,
          targetItem,
          subSourceId: props.subSourceId,
          relativeItem,
          filterType: props.filterType,
          condition: viewCondition,
          sort: props.sort,
          rulesFilter: [],
          outputs: outputFields.map(field => ({ value: field.fieldId, text: field.label,
            componentName: field.componentName, props: field.props })),
          quantity: Number(props.quantity || 1),
          dataRules: props.dataRules,
          assignments: [],
        },
        title: processNode.name.zh_CN,
      },
    };
  }

  return { buildDataRetrieveProcessNode, buildDataRetrieveViewNode };
}

async function preloadDataSchemas({ authRef, appType, formUuids, schemas, getFormSchema, onRead, onLoaded }) {
  for (const formUuid of new Set(formUuids)) {
    if (schemas.has(formUuid)) { continue; }
    try {
      onRead(formUuid);
      const schema = await getFormSchema(authRef, { appType, formUuid: formUuid.toString() });
      schemas.set(formUuid.toString(), schema);
      onLoaded(schema.length);
    } catch (error) {
      throw new Error(`获取 ${formUuid} 表单 Schema 失败，已停止远端写入: ${error.message}`);
    }
  }
}

module.exports = { createRetrieveBuilders, preloadDataSchemas };
