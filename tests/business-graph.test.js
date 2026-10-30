'use strict';

const { collectGraph, renderHtml } = require('../lib/design-plan/render-html');
function collect(dataModels, graph) {
  const { nodes, relations } = collectGraph(graph, dataModels);
  const html = JSON.parse(renderHtml({ dataModels, overview: { businessGraph: graph } }, ['overview'])).overview;
  return { nodes, edges: relations, html };
}

test('six forms remain six nodes when graph labels and relation endpoints use short names', () => {
  const names = ['玩偶商品表', '库存记录表', '客户信息表', '销售订单表', '补货申请表', '售后工单表'];
  const short = ['玩偶商品', '库存记录', '客户', '销售订单', '补货申请', '售后工单'];
  const models = names.map(name => ({ name, formType: name === '补货申请表' ? '宜搭流程表单' : '宜搭表单' }));
  const graph = {
    nodes: [...names, ...short],
    relations: [
      { from: '销售订单', to: '玩偶商品', label: '购买商品' },
      { from: '库存记录', to: '玩偶商品', label: '对应商品' },
      { from: '补货申请', to: '玩偶商品', label: '补货商品' },
    ],
  };
  const { nodes, edges, html } = collect(models, graph);
  expect(nodes.map(node => node.name)).toEqual(names);
  expect(nodes[4].source).toBe('宜搭流程表单');
  expect(edges).toHaveLength(3);
  expect(edges.every(edge => edge.to === nodes[0].id)).toBe(true);
  expect(html.match(/class="object-node"/g)).toHaveLength(6);
});

test('node IDs and explicit model bindings refer to the same form without renaming it', () => {
  const { nodes, edges } = collect([{ name: '客户信息表' }, { name: '销售订单表' }], {
    nodes: [{ id: 'customer', name: '买家档案', modelName: '客户信息表' }, { id: 'order', name: '销售订单表' }],
    relations: [{ from: 'order', to: 'customer', label: '购买客户' }],
  });
  expect(nodes.map(node => node.name)).toEqual(['客户信息表', '销售订单表']);
  expect(edges).toEqual([{ from: nodes[1].id, to: nodes[0].id, label: '购买客户' }]);
});

test('exact form names stay distinct even when their short names collide', () => {
  const { nodes, edges } = collect([{ name: '商品' }, { name: '商品表' }], {
    relations: [{ from: '商品', to: '商品表', label: '对应' }],
  });
  expect(nodes).toHaveLength(2);
  expect(edges).toHaveLength(1);
});

test('ambiguous or unknown references stop rendering instead of inventing nodes', () => {
  const models = [{ name: '客户表' }, { name: '客户信息表' }];
  expect(() => collect(models, { relations: [{ from: '客户', to: '客户表' }] })).toThrow('引用不明确');
  expect(() => collect(models, { relations: [{ from: '未知对象', to: '客户表' }] })).toThrow('引用未定义的数据表');
});

test('field-relation fallback resolves the same nodes and keeps isolated forms', () => {
  const { nodes, edges } = collect([
    { name: '商品表' }, { name: '订单表', fields: [{ name: '购买商品', relation: '商品' }] }, { name: '客户表' },
  ], {});
  expect(nodes).toHaveLength(3);
  expect(edges).toEqual([{ from: nodes[0].id, to: nodes[1].id, label: '购买商品' }]);
});
