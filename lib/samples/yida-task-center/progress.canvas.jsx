import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Space, Spin, Timeline, Typography } from 'antd';
import { ExternalLink, Maximize2, Minimize2, X } from 'lucide-react';

// @openyida-task-center:runtime
// @openyida-task-center:drawer
// @openyida-task-center:theme
const TASK_CENTER_CONFIG = /* @openyida-task-center:config */ {};
const TASK_CENTER_TEXT = /* @openyida-task-center:text */ {};
const taskContract = createTaskCenterContract();
const workflowContract = createWorkflowContract(taskContract);

// @openyida-workflow-section:start
function ProcessProgressSection({ config = TASK_CENTER_CONFIG, processInstanceId = config.processInstanceId, formUuid = config.formUuid, taskId = config.taskId, onOpen, refreshKey = 0 }) {
  const [state, setState] = useState({});
  const [revision, setRevision] = useState(0);
  const requestVersion = useRef(0);
  const loader = useMemo(() => createWorkflowLoader(workflowContract, undefined, () => {
    const userId = window.loginUser?.userId;
    return typeof userId === 'string' && userId && userId !== 'FREEUSER' ? userId : null;
  }), [config.appType]);
  const history = config.history === true;
  const requestKey = JSON.stringify([config.appType, processInstanceId, formUuid, taskId, history]);
  const refresh = () => { loader.clear(); setRevision(value => value + 1); };
  const { openForm, formOpenContainer: nativeContainer } = useYidaFormOpen(config.appType, refresh);
  const formOpenContainer = onOpen ? null : nativeContainer;
  const current = state.key === requestKey ? state : {};
  const value = current.value;
  useEffect(() => {
    const version = ++requestVersion.current;
    if (!processInstanceId) { setState({ key: requestKey }); return undefined; }
    const controller = new AbortController();
    setState(previous => ({ key: requestKey, value: previous.key === requestKey ? previous.value : undefined, loading: true }));
    loader({ appType: config.appType, processInstanceId, ...(formUuid ? { formUuid } : {}), ...(taskId && history ? { taskId } : {}), history }, { signal: controller.signal, refresh: revision > 0 || refreshKey > 0 }).then(result => {
      if (!controller.signal.aborted && requestVersion.current === version) { setState({ key: requestKey, value: result, loading: false }); }
    }).catch(error => {
      const message = error.code === 'NEED_LOGIN' ? TASK_CENTER_TEXT.loginRequired
        : ['WORKFLOW_SCOPE_MISMATCH', 'WORKFLOW_RESPONSE_INVALID'].includes(error.code) ? TASK_CENTER_TEXT.invalidResponse : TASK_CENTER_TEXT.requestFailed;
      if (!controller.signal.aborted && requestVersion.current === version) { setState(previous => ({ ...previous, loading: false, error: message })); }
    });
    return () => controller.abort();
  }, [requestKey, revision, refreshKey, loader]);
  useEffect(() => {
    const visible = () => { if (!window.document.hidden) { refresh(); } };
    window.document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', visible);
    return () => { window.document.removeEventListener('visibilitychange', visible); window.removeEventListener('pageshow', visible); };
  }, [loader]);
  const date = input => input ? new Date(input).toLocaleString() : '—';
  const status = input => TASK_CENTER_TEXT.statuses[input] || input || TASK_CENTER_TEXT.unknown;
  if (!processInstanceId) { return <Empty description={TASK_CENTER_TEXT.instanceRequired} />; }
  return <section style={{ color: 'var(--color-text1-4, inherit)', minWidth: 0 }}>
    <Space wrap style={{ marginBottom: 12 }}>
      <Typography.Text strong>{value?.title || config.title || TASK_CENTER_TEXT.progress}</Typography.Text>
      <Button onClick={refresh} loading={current.loading}>{TASK_CENTER_TEXT.refresh}</Button>
      {value && <Button onClick={() => {
        const target = { ...value.detailTarget, title: value.title || TASK_CENTER_TEXT.detail };
        if (onOpen) { onOpen(target); } else { openForm(target); }
      }}>{TASK_CENTER_TEXT.view}</Button>}
    </Space>
    {current.error && <Alert type="error" showIcon message={current.error} description={value ? TASK_CENTER_TEXT.stale : undefined} />}
    <Spin spinning={!!current.loading}>
      {value && <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text>{TASK_CENTER_TEXT.status}: {status(value.instanceStatus)}</Typography.Text>
        <Typography.Text>{TASK_CENTER_TEXT.processResult}: {status(value.processResult)}</Typography.Text>
        <Typography.Text>{TASK_CENTER_TEXT.submittedAt}: {date(value.submittedAt)} · {TASK_CENTER_TEXT.processFinishedAt}: {date(value.processFinishedAt)}</Typography.Text>
        {value.summary.map((item, index) => <Typography.Text key={index}>{item.label ? `${item.label}: ` : ''}{item.value}</Typography.Text>)}
        {!value.progressAvailable && <Typography.Text type="secondary">{TASK_CENTER_TEXT.progressUnknown}</Typography.Text>}
        {value.currentNodes.map((node, index) => <Typography.Text key={`${node.taskId}-${index}`}>
          {node.name || TASK_CENTER_TEXT.unknown} · {node.assignees.map(person => person.name || person.id).join(', ') || TASK_CENTER_TEXT.unknown}
        </Typography.Text>)}
        {value.taskResult && <Typography.Text>{TASK_CENTER_TEXT.taskResult}: {status(value.taskResult.result)}</Typography.Text>}
        {value.history.state === 'error' && <Alert type="warning" showIcon message={TASK_CENTER_TEXT.historyUnavailable} action={<Button onClick={refresh}>{TASK_CENTER_TEXT.retry}</Button>} />}
        {value.history.state === 'ready' && (value.history.items.length ? <Timeline items={value.history.items.map(item => ({
          key: item.key, label: item.type === 'HISTORY' ? date(item.operatedAt) : undefined,
          children: <Space direction="vertical" size={0}>
            <Typography.Text>{item.name || TASK_CENTER_TEXT.unknown} · {item.actor.name || item.actor.id || TASK_CENTER_TEXT.unknown}</Typography.Text>
            <Typography.Text>{item.action || status(item.result)}</Typography.Text>
            {item.comment && <Typography.Text type="secondary">{item.comment}</Typography.Text>}
          </Space>,
        }))} /> : <Empty description={TASK_CENTER_TEXT.noHistory} />)}
      </Space>}
    </Spin>
    {formOpenContainer}
  </section>;
}
// @openyida-workflow-section:end

export default function YidaComp() {
  return <CanvasThemeProvider><ProcessProgressSection /></CanvasThemeProvider>;
}
