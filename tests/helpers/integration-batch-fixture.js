'use strict';

function field(componentName, fieldId, label, parentId) {
  return { componentName, props: { fieldId, label: { zh_CN: label }, ...(parentId ? { parentId } : {}) } };
}

function batchFixture() {
  return {
    spec: { events: ['insert'], nodes: [
      { id: 'self', type: 'getSelf' },
      { id: 'lines', type: 'dataRetrieve', retrieveType: 'batch', originalType: 'sub_table',
        source: 'self', subSourceId: 'tableField_quoteLines', filterType: 'all', quantity: 100 },
      { id: 'order', type: 'dataCreate', formUuid: 'FORM-ORDER',
        assignments: [{ column: 'textField_title', valueType: 'literal', value: '测试订单' }] },
      { id: 'copy', type: 'dataCreate', createType: 'batch', insertType: 'sub_table',
        source: 'order', subFormUuid: 'tableField_orderLines', batchSource: 'lines', assignments: [
          { column: 'textField_orderProduct', valueType: 'processVar', value: '${lines}.textField_product' },
          { column: 'numberField_orderQuantity', valueType: 'processVar', value: '${lines}.numberField_quantity' },
        ] },
    ] },
    formSchemasByUuid: new Map([
      ['FORM-QUOTE', [
        field('TextField', 'textField_quoteNo', '报价单号'),
        field('TableField', 'tableField_quoteLines', '报价明细'),
        field('TextField', 'textField_product', '产品', 'tableField_quoteLines'),
        field('NumberField', 'numberField_quantity', '数量', 'tableField_quoteLines'),
      ]],
      ['FORM-ORDER', [
        field('TextField', 'textField_title', '订单名称'),
        field('TableField', 'tableField_orderLines', '订单明细'),
        field('TextField', 'textField_orderProduct', '产品', 'tableField_orderLines'),
        field('NumberField', 'numberField_orderQuantity', '数量', 'tableField_orderLines'),
      ]],
    ]),
  };
}

module.exports = { batchFixture };
