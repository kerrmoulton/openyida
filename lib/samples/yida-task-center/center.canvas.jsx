import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Pagination, Select, Space, Spin, Table, Tabs, Timeline, Typography } from 'antd';
import { ExternalLink, Maximize2, Minimize2, X } from 'lucide-react';

// @openyida-task-center:runtime
// @openyida-task-center:drawer
// @openyida-task-center:theme
const TASK_CENTER_CONFIG = /* @openyida-task-center:config */ {};
const TASK_CENTER_TEXT = /* @openyida-task-center:text */ {};
const taskContract = createTaskCenterContract();
const workflowContract = createWorkflowContract(taskContract);

function resolveTaskBridge() {
  const bridge = window.__OPENYIDA_YIDA_API__;
  if (!bridge || !bridge.ready) {
    const error = new Error('TASK_API_UNAVAILABLE');
    error.code = 'TASK_API_UNAVAILABLE';
    throw error;
  }
  return bridge;
}
const loadTaskCenter = createTaskCenterLoader(taskContract, resolveTaskBridge);

function taskDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function taskError(error) {
  if (error?.code === 'TASK_API_UNAVAILABLE') return TASK_CENTER_TEXT.apiUnavailable;
  if (error?.code === 'NEED_LOGIN') return TASK_CENTER_TEXT.loginRequired;
  if (error?.code === 'TASK_RESPONSE_INVALID' || error?.code === 'TASK_SCOPE_MISMATCH') return TASK_CENTER_TEXT.invalidResponse;
  return TASK_CENTER_TEXT.requestFailed;
}

function TaskInboxSection({ config = TASK_CENTER_CONFIG }) {
  const [kind, setKind] = useState(config.defaultKind);
  const [views, setViews] = useState({});
  const [results, setResults] = useState({});
  const [revision, setRevision] = useState(0);
  const requestVersion = useRef(0);
  const scrollPositions = useRef({});
  const rootRef = useRef(null);
  const filterKey = JSON.stringify(config.filters?.[kind] || {});
  const configuredFilters = JSON.parse(filterKey);
  const view = views[kind] || { page: 1, keyword: configuredFilters.keyword || '', query: configuredFilters.keyword || '', filters: {} };
  const result = results[kind] || { items: [], total: null, loading: true, error: '', loaded: false };
  const refresh = () => setRevision(value => value + 1);
  const { openForm, formOpenContainer } = useYidaFormOpen(config.appType, refresh);
  function patchView(patch) {
    setViews(previous => ({ ...previous, [kind]: { ...view, ...patch } }));
  }
  const appliedFilters = { ...configuredFilters, ...view.filters };
  const appliedFilterKey = JSON.stringify(appliedFilters);
  useEffect(() => {
    const version = ++requestVersion.current;
    let cancelled = false;
    setResults(previous => ({ ...previous, [kind]: { ...previous[kind], loading: true, error: '' } }));
    const waitForBridge = async () => {
      if (config.transport === 'app-query') return;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        if (cancelled) return;
        if (window.__OPENYIDA_YIDA_API__?.ready) return;
        await new Promise(resolve => window.setTimeout(resolve, 200));
      }
    };
    waitForBridge().then(() => cancelled ? null : loadTaskCenter(kind, {
      ...appliedFilters, appType: config.appType, transport: config.transport,
      page: view.page, pageSize: config.pageSize, keyword: view.query,
    })).then(data => {
      if (cancelled || version !== requestVersion.current || !data) return;
      if (data.total !== null && view.page > 1 && !data.items.length && (view.page - 1) * config.pageSize >= data.total) {
        setViews(previous => ({ ...previous, [kind]: { ...previous[kind], page: Math.max(1, view.page - 1) } }));
        return;
      }
      setResults(previous => ({ ...previous, [kind]: { ...data, loading: false, error: '', loaded: true, updatedAt: Date.now() } }));
    }).catch(error => {
      if (cancelled || version !== requestVersion.current) return;
      setResults(previous => ({ ...previous, [kind]: { ...previous[kind], loading: false, error: taskError(error) } }));
    });
    return () => { cancelled = true; };
  }, [kind, view.page, view.query, config.appType, config.pageSize, config.transport, filterKey, appliedFilterKey, revision]);

  useEffect(() => {
    const onVisible = () => { if (!window.document.hidden) refresh(); };
    window.document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      window.document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, []);

  useEffect(() => {
    if (rootRef.current) rootRef.current.scrollTop = scrollPositions.current[kind] || 0;
  }, [kind]);

  const statusText = value => TASK_CENTER_TEXT.statuses[value] || value || '—';
  const availableColumns = [
    { title: TASK_CENTER_TEXT.title, dataIndex: 'title', key: 'title', render: (value, item) => (
      <Button type="link" disabled={!item.detailTarget} title={item.detailTarget ? undefined : TASK_CENTER_TEXT.missingDetail}
        onClick={() => openForm({ ...item.detailTarget, title: value || TASK_CENTER_TEXT.detail })}>
        <span style={{ whiteSpace: 'normal', textAlign: 'left' }}>{value || TASK_CENTER_TEXT.untitled}</span>
      </Button>
    ) },
    { title: TASK_CENTER_TEXT.originator, dataIndex: 'originator', key: 'originator', render: value => value || '—' },
    { title: TASK_CENTER_TEXT.summary, key: 'summary', render: (_, item) => (item.summary || []).map(entry => `${entry.label ? entry.label + ': ' : ''}${entry.value}`).join(' · ') || '—' },
    { title: kind === 'done' ? TASK_CENTER_TEXT.result : TASK_CENTER_TEXT.status, key: 'status', render: (_, item) => (
      <span>{statusText(kind === 'done' ? item.result : item.instanceStatus)}</span>
    ) },
    { title: TASK_CENTER_TEXT.times[kind], key: 'time', render: (_, item) => taskDate(
      kind === 'todo' ? item.arrivedAt : kind === 'done' ? item.finishedAt : kind === 'cc' ? item.notifiedAt : item.submittedAt,
    ) },
    { title: TASK_CENTER_TEXT.action, key: 'action', render: (_, item) => (
      <Button disabled={!item.detailTarget} title={item.detailTarget ? undefined : TASK_CENTER_TEXT.missingDetail}
        onClick={() => openForm({ ...item.detailTarget, title: item.title || TASK_CENTER_TEXT.detail })}>
        {kind === 'todo' ? TASK_CENTER_TEXT.handle : TASK_CENTER_TEXT.view}
      </Button>
    ) },
  ];
  const columns = config.fields.map(key => availableColumns.find(column => column.key === key)).concat(availableColumns.find(column => column.key === 'action'));

  return (
    <section ref={rootRef} style={{ color: 'var(--color-text1-4)', background: config.mode === 'embedded' ? 'transparent' : 'var(--pod-page-bg-color)', minWidth: 0 }}>
      {config.mode === 'page' && <Typography.Title level={3}>{config.title}</Typography.Title>}
      {config.kinds.length > 1 && <Tabs activeKey={kind} items={config.kinds.map(key => ({ key, label: TASK_CENTER_TEXT.kinds[key] }))}
        onChange={next => {
          scrollPositions.current[kind] = rootRef.current?.scrollTop || 0;
          setKind(next);
        }} />}
      <Space wrap style={{ marginBottom: 16, width: '100%' }}>
        {config.showSearch && <Input.Search aria-label={TASK_CENTER_TEXT.search} placeholder={TASK_CENTER_TEXT.search}
          value={view.keyword} allowClear onChange={event => patchView({ keyword: event.target.value })}
          onSearch={value => patchView({ page: 1, keyword: value, query: value })} />}
        <Button onClick={refresh} loading={result.loading}>{TASK_CENTER_TEXT.refresh}</Button>
        <TaskFilterControls config={config} kind={kind} values={appliedFilters} onChange={(field, value) => patchView({ page: 1, filters: { ...view.filters, [field]: value } })} />
      </Space>
      {result.error && <Alert type="error" showIcon message={result.error} description={result.loaded ? TASK_CENTER_TEXT.stale : undefined} style={{ marginBottom: 12 }}
        action={<Button size="small" onClick={refresh}>{TASK_CENTER_TEXT.retry}</Button>} />}
      <Spin spinning={!!result.loading}>
        <Table rowKey="key" size="small" columns={columns} dataSource={result.items || []} pagination={false}
          expandable={config.expandProcess ? { rowExpandable: item => !!item.processInstanceId,
            expandedRowRender: item => <ProcessProgressSection config={config} processInstanceId={item.processInstanceId} formUuid={item.formUuid || undefined} taskId={kind === 'done' ? item.taskId : undefined} onOpen={openForm} refreshKey={revision} /> } : undefined}
          scroll={{ x: 680 }} locale={{ emptyText: result.error ? TASK_CENTER_TEXT.unavailable :
            <Empty description={TASK_CENTER_TEXT.empty} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
      </Spin>
      <Space wrap style={{ marginTop: 16 }}>
        {config.showPagination && (result.total !== null && result.total !== undefined ? <Pagination current={view.page} pageSize={config.pageSize}
          total={result.total} showSizeChanger={false} disabled={result.loading} onChange={page => patchView({ page })} /> : (
          <><Button disabled={view.page <= 1 || result.loading} onClick={() => patchView({ page: view.page - 1 })}>{TASK_CENTER_TEXT.previous}</Button>
            <span>{view.page}</span>
            <Button disabled={result.loading || !result.loaded || (result.items || []).length < config.pageSize}
              onClick={() => patchView({ page: view.page + 1 })}>{TASK_CENTER_TEXT.next}</Button></>
        ))}
        <Typography.Text type="secondary">{result.total === null || result.total === undefined
          ? TASK_CENTER_TEXT.totalUnknown : `${TASK_CENTER_TEXT.total}: ${result.total}`}</Typography.Text>
        {result.updatedAt && <Typography.Text type="secondary">{TASK_CENTER_TEXT.updated}: {taskDate(result.updatedAt)}</Typography.Text>}
      </Space>
      {formOpenContainer}
    </section>
  );
}

// @openyida-task-center:sections

export default function YidaComp() {
  return <CanvasThemeProvider><TaskInboxSection /></CanvasThemeProvider>;
}
