// @openyida-task-filters:start
function TaskFilterControls({ config, kind, values, onChange }) {
  const [choices, setChoices] = useState({});
  const [error, setError] = useState('');
  const version = useRef(0);
  const requests = useRef({});
  const controllers = useRef({});
  const fields = config.filterFields?.[kind] || [];
  const signature = fields.join(',');
  const lookup = useMemo(() => createTaskCenterLookups(), []);
  useEffect(() => {
    version.current += 1;
    setChoices({}); setError('');
    return () => { version.current += 1; Object.values(controllers.current).forEach(controller => controller.abort()); controllers.current = {}; };
  }, [kind, signature, config.appType]);
  async function loadOptions(field, keyword = '') {
    const epoch = version.current;
    const request = requests.current[field] = (requests.current[field] || 0) + 1;
    controllers.current[field]?.abort();
    const controller = new AbortController(); controllers.current[field] = controller;
    const current = () => version.current === epoch && requests.current[field] === request;
    try {
      const result = await lookup.load(field === 'originators' ? 'originators' : kind === 'created' ? 'forms' : 'processes', { appType: config.appType, keyword, signal: controller.signal }, window.fetch.bind(window));
      if (current()) { setChoices(previous => ({ ...previous, [field]: result.items.map(item => ({ value: item.value, label: item.label })) })); setError(''); }
    } catch {
      if (current()) { setError(TASK_CENTER_TEXT.requestFailed); }
    }
  }
  function localDate(value) {
    if (value === undefined || value === null) { return ''; }
    const date = new Date(value);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  return <Space wrap>
    {fields.map(field => {
      const label = TASK_CENTER_TEXT.filters[field];
      if (field === 'originators' || field === 'processCodes') {
        return <Select key={field} aria-label={label} placeholder={label} allowClear showSearch filterOption={false}
          mode={field === 'processCodes' ? 'multiple' : undefined} style={{ minWidth: 160, maxWidth: '100%' }}
          options={choices[field] || []} value={field === 'originators' ? values[field]?.[0] : values[field]}
          onSearch={keyword => loadOptions(field, keyword)} onDropdownVisibleChange={open => { if (open && field === 'processCodes') { loadOptions(field); } }}
          onChange={value => onChange(field, field === 'originators' ? value ? [value] : undefined : value?.length ? value : undefined)} />;
      }
      if (field === 'instanceStatus') {
        const schema = taskContract.filterSchema(kind, config.transport)[field];
        const options = schema.type === 'enum' ? schema.values.map(value => ({ value, label: TASK_CENTER_TEXT.statuses[schema.labels[value]] || schema.labels[value] }))
          : ['RUNNING', 'COMPLETED', 'TERMINATED', 'ERROR'].map(value => ({ value, label: TASK_CENTER_TEXT.statuses[value] || value }));
        return <Select key={field} aria-label={label} placeholder={label} allowClear style={{ minWidth: 140 }} options={options} value={values[field]} onChange={value => onChange(field, value)} />;
      }
      return <label key={field} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span>{label}</span><Input aria-label={label} type="datetime-local" step="1" value={localDate(values[field])}
          onChange={event => onChange(field, event.target.value ? new Date(event.target.value).getTime() : undefined)} />
      </label>;
    })}
    {error && <Alert type="error" message={error} />}
  </Space>;
}
// @openyida-task-filters:end
