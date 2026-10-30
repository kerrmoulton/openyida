'use strict';

// Protocol shared by native ConditionContainer / CycleContainer setters.
function buildParallel(node, nodeId, exitId, context, helpers) {
  const children = node.branches.map((branch, index) => {
    const id = branch._nodeId;
    const built = helpers.buildList(branch.nodes || [], exitId, context);
    const name = branch.name || `Parallel ${index + 1}`;
    const isDefault = !!(branch.default || branch.isDefault);
    const conditions = isDefault || branch.all ? null : helpers.buildConditions(branch.condition || branch.conditions || branch.rules,
      branch.logic || 'AND', context);
    require('../process/services/process-conditional-actors').nativeConditions(conditions);
    return {
      process: { nodeId: id, type: 'condition', name: { zh_CN: name, en_US: name }, description: '',
        prevId: nodeId, nextId: [built.processNodes[0]?.nodeId || exitId],
        props: { isDefault, ...(branch.all ? { calculate: 'all' } : {}), ...(conditions ? { conditions, calculate: 'condition' } : {}) },
        childNodes: built.processNodes },
      view: { componentName: 'ParallelNode', id, props: { name, conditions: {
        isDefault, ...(branch.all ? { calculate: 'all' } : {}), ...(conditions ? { conditions, calculate: 'condition' } : {}) } },
      children: built.viewNodes },
    };
  });
  return {
    processNode: { nodeId, name: { zh_CN: node.name || '并行分支', en_US: node.name || 'Parallel' },
      description: '', type: 'route', prevId: '', nextId: children.map(item => item.process.nodeId),
      props: { outgoingType: 'multiple' }, childNodes: children.map(item => item.process) },
    viewNode: { componentName: 'ConditionContainer', type: 'parallel', id: nodeId, props: {},
      title: node.name || 'Parallel', children: children.map(item => item.view) },
  };
}

function buildCycle(node, nodeId, exitId, context, helpers) {
  const built = helpers.buildList(node.nodes, nodeId, context);
  const rules = { sourceId: helpers.resolveAlias(node.source, context), blockType: node.blockType || 'continue', outputs: [] };
  return {
    processNode: { nodeId, name: { zh_CN: node.name || '循环', en_US: node.name || 'Loop' }, description: '',
      type: 'foreach', prevId: '', nextId: [built.processNodes[0].nodeId, exitId], jumpId: exitId,
      props: rules, childNodes: built.processNodes },
    viewNode: { componentName: 'CycleContainer', id: nodeId, props: { name: node.name || 'Loop', cycleContainerRules: rules },
      children: built.viewNodes },
  };
}

module.exports = { buildParallel, buildCycle };
