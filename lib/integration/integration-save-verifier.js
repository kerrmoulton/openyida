'use strict';

function parseViewJsonResponse(response) {
  if (!response || response.success === false) {
    throw new Error(response && response.errorMsg ? response.errorMsg : '未返回集成自动化配置');
  }
  const content = typeof response.content === 'string'
    ? JSON.parse(response.content)
    : response.content;
  if (!content || !content.schema || !Array.isArray(content.schema.children)) {
    throw new Error('回读的集成自动化 viewJson 结构无效');
  }
  return content;
}

function collectRuleIds(rules) {
  return (rules || []).flatMap(group => (group.rules || []).map(rule => rule.id)).filter(Boolean);
}

function connectorNodes(viewJson) {
  return viewJson.schema.children.filter(node => node && node.componentName === 'ConnectorNode');
}

function validateSavedConnectorView(expectedViewJson, response) {
  const actualViewJson = parseViewJsonResponse(response);
  const expectedNodes = connectorNodes(expectedViewJson);
  const actualById = new Map(connectorNodes(actualViewJson).map(node => [node.id, node]));
  const problems = [];

  for (const expectedNode of expectedNodes) {
    const expectedRules = expectedNode.props && expectedNode.props.connectorRules;
    const actualNode = actualById.get(expectedNode.id);
    const actualRules = actualNode && actualNode.props && actualNode.props.connectorRules;
    const label = expectedNode.title || expectedNode.id;
    if (!actualRules) {
      problems.push(`${label}: 连接器节点未回读`);
      continue;
    }
    for (const field of ['connectorId', 'connectionId', 'actionId', 'url', 'method', 'body', 'allStepCounts', 'currentStep']) {
      if (actualRules[field] !== expectedRules[field]) {
        problems.push(`${label}: ${field} 未按提交内容保存`);
      }
    }
    if ((actualRules.inputs || []).length !== (expectedRules.inputs || []).length) {
      problems.push(`${label}: inputs 数量不一致`);
    }
    if ((actualRules.outputs || []).length !== (expectedRules.outputs || []).length) {
      problems.push(`${label}: outputs 数量不一致`);
    }
    const expectedRuleIds = collectRuleIds(expectedRules.rules).sort();
    const actualRuleIds = collectRuleIds(actualRules.rules).sort();
    if (JSON.stringify(actualRuleIds) !== JSON.stringify(expectedRuleIds)) {
      problems.push(`${label}: 入参映射未按提交内容保存`);
    }
    const actualAssignments = new Map((actualRules.rules || []).flatMap(group => group.rules || []).map(rule => [rule.id, rule]));
    for (const rule of (expectedRules.rules || []).flatMap(group => group.rules || [])) {
      const saved = actualAssignments.get(rule.id);
      if (!saved) {
        continue;
      }
      for (const field of ['valueType', 'value', ...(rule.valueType === 'column' ? ['__source', '__display'] : [])]) {
        if (JSON.stringify(saved[field]) !== JSON.stringify(rule[field])) {
          problems.push(`${label}: ${rule.id}.${field} 未按提交内容保存`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join('；'));
  }
  return { connectorCount: expectedNodes.length };
}

module.exports = {
  collectRuleIds,
  parseViewJsonResponse,
  validateSavedConnectorView,
};
