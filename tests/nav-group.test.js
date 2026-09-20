'use strict';

const {
  ROOT_NAV_UUID,
  autoOrderRootNodes,
  buildIconUpdatePayload,
  buildNavigationTree,
  flattenTreeIds,
  getNavigationPriority,
  moveNodeInTree,
  parseArgs,
  reorderRootNodes,
  resolveNode,
} = require('../lib/app/nav-group');

const fixture = [
  { id: 1, navUuid: 'NAV-SYSTEM-RUNNING-UUID', parentNavUuid: ROOT_NAV_UUID, navType: 'SYSTEM', title: { zh_CN: '待我处理' }, listOrder: 0 },
  { id: 2, navUuid: 'FORM-A', formUuid: 'FORM-A', parentNavUuid: ROOT_NAV_UUID, navType: 'PAGE', title: { zh_CN: '表单 A' }, listOrder: 1 },
  { id: 3, navUuid: 'NAV-GROUP-1', parentNavUuid: ROOT_NAV_UUID, navType: 'NAV', title: { zh_CN: '分组一', en_US: 'Group One' }, listOrder: 2 },
  { id: 4, navUuid: 'FORM-B', formUuid: 'FORM-B', parentNavUuid: 'NAV-GROUP-1', navType: 'PAGE', title: { zh_CN: '表单 B' }, listOrder: 3 },
  { id: 5, navUuid: 'NAV-GROUP-2', parentNavUuid: ROOT_NAV_UUID, navType: 'NAV', title: { zh_CN: '分组二' }, listOrder: 4 },
];

describe('nav-group helpers', () => {
  test('parseArgs separates positionals and flags', () => {
    expect(parseArgs(['APP_XXX', 'FORM-A', '--to', '分组一', '--after', 'FORM-B', '--force'])).toEqual({
      positional: ['APP_XXX', 'FORM-A'],
      flags: {
        to: '分组一',
        after: 'FORM-B',
        force: true,
      },
    });
  });

  test('buildNavigationTree returns groups and pages without system nodes by default', () => {
    const tree = buildNavigationTree(fixture);

    expect(tree.map((node) => node.name)).toEqual(['表单 A', '分组一', '分组二']);
    expect(tree[1]).toMatchObject({
      navUuid: 'NAV-GROUP-1',
      type: 'group',
      childrenCount: 1,
    });
    expect(tree[1].children[0]).toMatchObject({
      navUuid: 'FORM-B',
      type: 'page',
    });
  });

  test('resolveNode resolves by navUuid, formUuid, and display name', () => {
    expect(resolveNode(fixture, 'FORM-A').navUuid).toBe('FORM-A');
    expect(resolveNode(fixture, '分组一', { groupOnly: true }).navUuid).toBe('NAV-GROUP-1');
    expect(resolveNode(fixture, 'root').navUuid).toBe(ROOT_NAV_UUID);
  });

  test('resolveNode prefers an exact page ID over a group related form ID', () => {
    const related = fixture.map((node) => node.navUuid === 'NAV-GROUP-1'
      ? { ...node, relateFormUuid: 'FORM-B' }
      : node);
    expect(resolveNode(related, 'FORM-B').navUuid).toBe('FORM-B');
  });

  test('buildIconUpdatePayload preserves navigation fields and sets a named icon', () => {
    const payload = buildIconUpdatePayload({ ...fixture[1], hidden: 'y', icon: null }, 'custom-column');
    expect(payload).toMatchObject({
      navUuid: 'FORM-A',
      formUuid: 'FORM-A',
      hidden: 'y',
      icon: 'custom-column',
      title: JSON.stringify({ zh_CN: '表单 A' }),
    });
  });

  test('buildIconUpdatePayload supports group icons and restoring the default', () => {
    const group = fixture[2];
    expect(buildIconUpdatePayload(group, 'dashboard')).toMatchObject({
      navUuid: 'NAV-GROUP-1',
      navType: 'NAV',
      icon: 'dashboard',
    });
    expect(buildIconUpdatePayload({ ...group, icon: 'dashboard' }, '').icon).toBe('');
  });

  test('buildIconUpdatePayload rejects unsafe icon names and system nodes', () => {
    expect(() => buildIconUpdatePayload(fixture[1], 'bad icon')).toThrow('Icon name');
    expect(() => buildIconUpdatePayload(fixture[0], 'custom-column')).toThrow('Only application');
  });

  test('moveNodeInTree moves a page into a target group and returns flattened ids', () => {
    const moved = moveNodeInTree(fixture, 'FORM-A', 'NAV-GROUP-2');
    const flatNodes = [];
    const walk = (nodes) => nodes.forEach((node) => {
      flatNodes.push([node.navUuid, node.parentNavUuid]);
      walk(node.children || []);
    });
    walk(moved.roots);

    expect(flatNodes).toContainEqual(['FORM-A', 'NAV-GROUP-2']);
    expect(flattenTreeIds(moved.roots)).toEqual([1, 3, 4, 5, 2]);
    expect(moved.ids).toEqual([1, 3, 4, 5, 2]);
  });

  test('reorderRootNodes places selected dashboards and forms before the remaining root items', () => {
    const withDashboards = fixture.concat([
      { id: 6, navUuid: 'PAGE-HOME', formUuid: 'PAGE-HOME', parentNavUuid: ROOT_NAV_UUID, navType: 'PAGE', title: { zh_CN: '首页看板' }, listOrder: 5 },
      { id: 7, navUuid: 'PAGE-618', formUuid: 'PAGE-618', parentNavUuid: ROOT_NAV_UUID, navType: 'PAGE', title: { zh_CN: '618看板' }, listOrder: 6 },
      { id: 8, navUuid: 'FORM-ORDER', formUuid: 'FORM-ORDER', parentNavUuid: ROOT_NAV_UUID, navType: 'PAGE', title: { zh_CN: '订单表' }, listOrder: 7 },
    ]);
    const moved = reorderRootNodes(withDashboards, ['PAGE-HOME', 'FORM-ORDER', 'PAGE-618']);
    const visibleRootOrder = moved.roots
      .filter((node) => node.parentNavUuid === ROOT_NAV_UUID && node.navType !== 'SYSTEM')
      .map((node) => node.navUuid);

    expect(visibleRootOrder).toEqual(['PAGE-HOME', 'FORM-ORDER', 'PAGE-618', 'FORM-A', 'NAV-GROUP-1', 'NAV-GROUP-2']);
    expect(moved.orderedNavUuids).toEqual(['PAGE-HOME', 'FORM-ORDER', 'PAGE-618']);
    expect(moved.ids).toEqual([1, 6, 8, 7, 2, 3, 4, 5]);
  });

  test('reorderRootNodes rejects duplicate items', () => {
    expect(() => reorderRootNodes(fixture, ['FORM-A', 'FORM-A']))
      .toThrow('Duplicate navigation item: FORM-A');
  });

  test('autoOrderRootNodes ranks portal, custom pages, process forms, then forms', () => {
    const mixed = [
      { id: 1, navUuid: 'NAV-SYSTEM-RUNNING-UUID', parentNavUuid: ROOT_NAV_UUID, navType: 'SYSTEM', title: { zh_CN: '待我处理' }, listOrder: 0 },
      { id: 2, navUuid: 'FORM-RECEIPT', formUuid: 'FORM-RECEIPT', parentNavUuid: ROOT_NAV_UUID, navType: 'PAGE', formType: 'receipt', title: { zh_CN: '访客登记表' }, listOrder: 1 },
      { id: 3, navUuid: 'PAGE-DASHBOARD', formUuid: 'PAGE-DASHBOARD', parentNavUuid: ROOT_NAV_UUID, navType: 'PAGE', formType: 'display', title: { zh_CN: '数据看板' }, listOrder: 2 },
      { id: 4, navUuid: 'FORM-PROCESS', formUuid: 'FORM-PROCESS', parentNavUuid: ROOT_NAV_UUID, navType: 'PAGE', formType: 'process', title: { zh_CN: '访客审批表' }, listOrder: 3 },
      { id: 5, navUuid: 'PAGE-PORTAL', formUuid: 'PAGE-PORTAL', parentNavUuid: ROOT_NAV_UUID, navType: 'PAGE', formType: 'display', title: { zh_CN: '访客管理首页' }, listOrder: 4 },
      { id: 6, navUuid: 'NAV-GROUP-1', parentNavUuid: ROOT_NAV_UUID, navType: 'NAV', title: { zh_CN: '配置分组' }, listOrder: 5 },
    ];

    const ordered = autoOrderRootNodes(mixed);
    const visibleRootOrder = ordered.roots
      .filter((node) => node.parentNavUuid === ROOT_NAV_UUID && node.navType !== 'SYSTEM')
      .map((node) => node.navUuid);

    expect(visibleRootOrder).toEqual([
      'PAGE-PORTAL',
      'PAGE-DASHBOARD',
      'FORM-PROCESS',
      'FORM-RECEIPT',
      'NAV-GROUP-1',
    ]);
    expect(ordered.ids).toEqual([1, 5, 3, 4, 2, 6]);
    expect(getNavigationPriority(mixed[4])).toBe(0);
    expect(getNavigationPriority(mixed[2])).toBe(1);
    expect(getNavigationPriority(mixed[3])).toBe(2);
    expect(getNavigationPriority(mixed[1])).toBe(3);
  });

  test('moveNodeInTree rejects moving a system node', () => {
    expect(() => moveNodeInTree(fixture, 'NAV-SYSTEM-RUNNING-UUID', ROOT_NAV_UUID))
      .toThrow('System navigation nodes cannot be moved');
  });
});
