'use strict';

const SIDE_EFFECT_BASES = Object.freeze({
  local_read: Object.freeze({
    kind: 'local_read',
    mutates_yida: false,
    mutates_local: false,
  }),
  local_write: Object.freeze({
    kind: 'local_write',
    mutates_yida: false,
    mutates_local: true,
  }),
  remote_read: Object.freeze({
    kind: 'remote_read',
    mutates_yida: false,
    mutates_local: false,
  }),
  remote_write: Object.freeze({
    kind: 'remote_write',
    mutates_yida: true,
    mutates_local: false,
  }),
  mixed: Object.freeze({
    kind: 'mixed',
    mutates_yida: true,
    mutates_local: true,
  }),
});

function sideEffect(kind, overrides = {}) {
  if (!SIDE_EFFECT_BASES[kind]) {
    throw new Error('Unknown side effect kind: ' + kind);
  }
  return {
    ...SIDE_EFFECT_BASES[kind],
    ...overrides,
  };
}

function sideEffectEntries(ids, effect) {
  return ids.map(id => [id, effect]);
}

function cloneSideEffect(effect) {
  const cloned = { ...effect };
  if (Array.isArray(effect.read_actions)) {
    cloned.read_actions = [...effect.read_actions];
  }
  if (Array.isArray(effect.mutating_actions)) {
    cloned.mutating_actions = [...effect.mutating_actions];
  }
  return cloned;
}

const COMMAND_SIDE_EFFECTS = new Map([
  ...sideEffectEntries([
    'agent-capabilities',
    'check-page',
    'commands',
    'dingtalk-link',
    'env',
    'formula.evaluate',
    'integration.diagnose',
  ], sideEffect('local_read')),

  ...sideEffectEntries([
    'build-page',
    'cdn-config',
    'compile',
    'connector.gen-template',
    'connector.parse-api',
    'copy',
    'export-conversation',
    'flash-to-prd',
    'generate-page',
    'login',
    'logout',
    'sample',
    'update',
  ], sideEffect('local_write')),

  ...sideEffectEntries([
    'app-list',
    'basic-info',
    'connector.detail',
    'connector.list',
    'connector.list-actions',
    'connector.list-connections',
    'dws.contact-user-search',
    'get-page-config',
    'get-permission',
    'get-schema',
    'integration.check',
    'integration.list',
    'list-forms',
    'process.preview',
    'verify-short-url',
  ], sideEffect('remote_read')),

  ...sideEffectEntries([
    'add-validation',
    'append-chart',
    'cdn-refresh',
    'cdn-upload',
    'configure-process',
    'connector.add-action',
    'connector.create',
    'connector.create-connection',
    'connector.delete',
    'connector.delete-action',
    'connector.smart-create',
    'connector.test',
    'create-app',
    'create-form.add-option',
    'create-form.bind-datasource',
    'create-form.create',
    'create-form.patch',
    'create-form.rule',
    'create-form.update',
    'create-form.validation',
    'create-page',
    'create-process',
    'create-report',
    'externalize-form',
    'import',
    'integration.create',
    'integration.disable',
    'integration.enable',
    'publish',
    'save-permission',
    'save-share-config',
    'update-app',
    'update-form-config',
  ], sideEffect('remote_write')),

  ['ai', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['text', 'image --image-url'],
    mutating_actions: ['image --file'],
  })],
  ['ai-form-setting', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['get', 'fields', 'models'],
    mutating_actions: ['enable', 'disable', 'save'],
  })],
  ['agent-center', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['list', 'range', 'search-user'],
    mutating_actions: ['create', 'update', 'cancel'],
  })],
  ['a2a', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: ['agent-card'],
    mutating_actions: ['serve'],
  })],
  ['aggregate-table', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['list', 'inspect', 'preview', 'status'],
    mutating_actions: ['create-empty', 'save', 'publish'],
  })],
  ['app-permission', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['get', 'search-user'],
    mutating_actions: ['set', 'add', 'remove'],
  })],
  ['auth', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: ['status'],
    mutating_actions: ['login', 'refresh', 'logout'],
  })],
  ['batch.file', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: true,
    read_actions: [],
    mutating_actions: ['depends on commands in file'],
  })],
  ['batch.inline', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: true,
    read_actions: [],
    mutating_actions: ['depends on inline commands'],
  })],
  ['bridge', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: [],
    mutating_actions: ['start'],
  })],
  ['corp-efficiency', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['overview', 'details', 'detail', 'groups'],
    mutating_actions: ['notify'],
  })],
  ['corp-manager', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['search-user', 'list'],
    mutating_actions: ['add', 'remove', 'address-book'],
  })],
  ['data', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['query', 'get'],
    mutating_actions: ['create', 'update', 'delete'],
  })],
  ['db-seq-fix', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['default', '--dry-run'],
    mutating_actions: ['--fix'],
  })],
  ['doctor', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: ['default'],
    mutating_actions: ['--fix'],
  })],
  ['dws', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: ['help', 'contact user search', 'calendar event list', 'approval instance list'],
    mutating_actions: ['install', 'setup', 'todo task create', 'chat robot send', 'depends on dws command'],
  })],
  ['env-management', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: ['list', 'show'],
    mutating_actions: ['setup', 'switch', 'add', 'remove'],
  })],
  ['er', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: ['default', '--format json'],
    mutating_actions: ['--output'],
  })],
  ['export', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: ['read application schema'],
    mutating_actions: ['write export file'],
  })],
  ['feedback', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: true,
    read_actions: ['url', 'status'],
    mutating_actions: ['setup', 'dismiss'],
  })],
  ['i18n', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['overview', 'config', 'languages', 'list'],
    mutating_actions: ['upsert', 'delete', 'translate', 'translate-all', 'upgrade'],
  })],
  ['mcp', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: [],
    mutating_actions: ['start stdio server'],
  })],
  ['nav-group', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['list'],
    mutating_actions: ['create', 'rename', 'delete', 'move', 'order', 'hide', 'show'],
  })],
  ['org', sideEffect('mixed', {
    mutates_yida: false,
    mutates_local: true,
    read_actions: ['list'],
    mutating_actions: ['switch'],
  })],
  ['task-center', sideEffect('mixed', {
    mutates_yida: true,
    mutates_local: false,
    read_actions: ['todo', 'created', 'processed', 'cc'],
    mutating_actions: ['submit'],
  })],
]);

function command(id, path, usage, descriptionKey, options = {}) {
  const commandSideEffect = COMMAND_SIDE_EFFECTS.get(id);
  if (!commandSideEffect) {
    throw new Error('Missing side effect metadata for command: ' + id);
  }

  return {
    id,
    path,
    command: path[0],
    name: path.join(' '),
    usage,
    descriptionKey,
    requiresLogin: options.requiresLogin !== false,
    output: options.output || 'text',
    aliases: options.aliases || [],
    examples: options.examples || [],
    hidden: options.hidden === true,
    sideEffect: cloneSideEffect(commandSideEffect),
  };
}

const COMMAND_GROUPS = [
  {
    id: 'auth',
    titleKey: 'help.group_auth',
    commands: [
      command('login', ['login'], 'login [target-url] [--qr|--agent-qr|--codex|--browser] [--env <name>|--intl|--overseas|--global|--yidaapps|--alibaba] [--corp-id <corpId>]', 'help.cmd_login', {
        requiresLogin: false,
        output: 'json',
      }),
      command('logout', ['logout'], 'logout', 'help.cmd_logout', { requiresLogin: false }),
      command('auth', ['auth'], 'auth <status|login|refresh|logout>', 'help.cmd_auth', { requiresLogin: false }),
      command('org', ['org'], 'org <list|switch>', 'help.cmd_org'),
      command('env', ['env'], 'env [--json]', 'help.cmd_env', {
        requiresLogin: false,
        output: 'text|json',
      }),
      command('env-management', ['env'], 'env <setup|list|show|switch|add|remove>', 'help.cmd_env_management', {
        requiresLogin: false,
      }),
    ],
  },
  {
    id: 'app',
    titleKey: 'help.group_app',
    commands: [
      command('app-list', ['app-list'], 'app-list [--size N]', 'help.cmd_app_list'),
      command('corp-efficiency', ['corp-efficiency'], 'corp-efficiency [overview|details|detail|groups|notify] [options] [--open|--no-open]', 'help.cmd_corp_efficiency', {
        output: 'json',
      }),
      command('create-app', ['create-app'], 'create-app "<name>"|--name <name> [options] [--locale zh_CN|en_US|ja_JP] [--open|--no-open]', 'help.cmd_create_app'),
      command('update-app', ['update-app'], 'update-app <appType> [--name "..."] [--layout slide|ver] [--theme deepBlue]', 'help.cmd_update_app'),
      command('nav-group', ['nav-group'], 'nav-group <list|create|rename|delete|move|order|hide|show> <appType> ...', 'help.cmd_nav_group', {
        output: 'json',
        aliases: ['group'],
      }),
      command('app-permission', ['app-permission'], 'app-permission <get|set|add|remove|search-user> ...', 'help.cmd_app_permission', {
        output: 'json',
      }),
      command('i18n', ['i18n'], 'i18n <overview|config|languages|list|upsert|delete|translate|translate-all|upgrade> <appType> ...', 'help.cmd_i18n', {
        output: 'json',
      }),
      command('export', ['export'], 'export <appType> [output]', 'help.cmd_export'),
      command('import', ['import'], 'import <file> [name]', 'help.cmd_import'),
    ],
  },
  {
    id: 'form',
    titleKey: 'help.group_form',
    commands: [
      command('create-form.create', ['create-form', 'create'], 'create-form create <appType> ... [--locale zh_CN|en_US|ja_JP] [--open|--no-open]', 'help.cmd_create_form'),
      command('create-form.update', ['create-form', 'update'], 'create-form update <appType> ... [--locale zh_CN|en_US|ja_JP] [--open|--no-open]', 'help.cmd_update_form'),
      command('create-form.patch', ['create-form', 'patch'], 'create-form patch <appType> <formUuid> <patchJsonOrFile> [--open|--no-open]', 'help.cmd_update_form'),
      command('create-form.rule', ['create-form', 'rule'], 'create-form rule <appType> <formUuid> <rulesJsonOrFile> [--open|--no-open]', 'help.cmd_update_form'),
      command('create-form.validation', ['create-form', 'validation'], 'create-form validation <appType> <formUuid> <validationsJsonOrFile> [--open|--no-open]', 'help.cmd_update_form'),
      command('add-validation', ['add-validation'], 'add-validation <appType> <formUuid> --field <labelOrId> --type <phone|regex|idCard|email|...> [--message <text>]', 'help.cmd_update_form'),
      command('create-form.bind-datasource', ['create-form', 'bind-datasource'], 'create-form bind-datasource <appType> <formUuid> <fieldLabelOrId> <dataSourceJsonOrFile> [--open|--no-open]', 'help.cmd_update_form'),
      command('create-form.add-option', ['create-form', 'add-option'], 'create-form add-option <appType> <formUuid> <fieldLabel> <option1> [option2] ...', 'help.cmd_update_form'),
      command('list-forms', ['list-forms'], 'list-forms <appType> [--keyword <text>]', 'help.cmd_list_forms'),
      command('aggregate-table', ['aggregate-table'], 'aggregate-table <list|create-empty|inspect|preview|save|publish|status> <appType> ...', 'help.cmd_aggregate_table', {
        output: 'json',
      }),
      command('get-schema', ['get-schema'], 'get-schema <appType> <formUuid|--all>', 'help.cmd_get_schema'),
      command('er', ['er'], 'er <appType> [--format mermaid|json] [--output file] [--include-system] [--include-pages]', 'help.cmd_er', {
        output: 'text|json',
      }),
      command('create-page', ['create-page'], 'create-page <appType> "<name>" [--mode dashboard] [--locale zh_CN|en_US|ja_JP] [--open|--no-open]', 'help.cmd_create_page'),
      command('generate-page', ['generate-page'], 'generate-page <template>', 'help.cmd_generate_page'),
      command('build-page', ['build-page'], 'build-page <sourceFile> [--output file|--write]', 'help.cmd_build_page', { requiresLogin: false }),
      command('check-page', ['check-page'], 'check-page <src> [--compat]', 'help.cmd_check_page', { output: 'text|json' }),
      command('compile', ['compile'], 'compile <src>', 'help.cmd_compile', { requiresLogin: false }),
      command('publish', ['publish'], 'publish <src> <appType> <formUuid> [--health-check] [--force] [--canvas] [--open|--no-open]', 'help.cmd_publish'),
      command('update-form-config', ['update-form-config'], 'update-form-config <appType> ...', 'help.cmd_update_form_config'),
    ],
  },
  {
    id: 'data',
    titleKey: 'help.group_data',
    commands: [
      command('data', ['data'], 'data <action> <resource> [args]', 'help.cmd_data'),
      command('task-center', ['task-center'], 'task-center <type> [options]', 'help.cmd_task_center'),
      command('basic-info', ['basic-info'], 'basic-info <overview|commodity|grant|capacity|quota|abs-path|dataflow|i18n|domain>', 'help.cmd_basic_info', {
        output: 'json',
      }),
      command('get-permission', ['get-permission'], 'get-permission <appType> <formUuid>', 'help.cmd_get_permission'),
      command('save-permission', ['save-permission'], 'save-permission <appType> <formUuid> ...', 'help.cmd_save_permission'),
      command('corp-manager', ['corp-manager'], 'corp-manager <search-user|list|add|remove|address-book> ...', 'help.cmd_corp_manager', { output: 'json' }),
      command('agent-center', ['agent-center'], 'agent-center <list|create|update|cancel|range|search-user> ...', 'help.cmd_agent_center', { output: 'json' }),
    ],
  },
  {
    id: 'process',
    titleKey: 'help.group_process',
    commands: [
      command('configure-process', ['configure-process'], 'configure-process <appType> ...', 'help.cmd_configure_process'),
      command('create-process', ['create-process'], 'create-process <appType> ...', 'help.cmd_create_process'),
      command('ai-form-setting', ['ai-form-setting'], 'ai-form-setting <get|fields|models|enable|disable|save> <appType> ...', 'help.cmd_ai_form_setting', {
        output: 'json',
        aliases: ['ai-approve', 'aiFormSetting'],
      }),
      command('process.preview', ['process', 'preview'], 'process preview <appType> ...', 'help.cmd_process_preview'),
    ],
  },
  {
    id: 'share',
    titleKey: 'help.group_share',
    commands: [
      command('verify-short-url', ['verify-short-url'], 'verify-short-url <appType> ...', 'help.cmd_verify_url'),
      command('save-share-config', ['save-share-config'], 'save-share-config <appType> ...', 'help.cmd_save_share'),
      command('get-page-config', ['get-page-config'], 'get-page-config <appType> <formUuid>', 'help.cmd_get_page_config'),
      command('externalize-form', ['externalize-form'], 'externalize-form <appType> <formUuid> [--schema-file file]', 'help.cmd_externalize_form', {
        output: 'json|markdown',
      }),
    ],
  },
  {
    id: 'report',
    titleKey: 'help.group_report',
    commands: [
      command('create-report', ['create-report'], 'create-report <appType> "<name>" ... [--open|--no-open]', 'help.cmd_create_report'),
      command('append-chart', ['append-chart'], 'append-chart <appType> <reportId> ... [--open|--no-open]', 'help.cmd_append_chart'),
    ],
  },
  {
    id: 'connector',
    titleKey: 'help.group_connector',
    commands: [
      command('connector.list', ['connector', 'list'], 'connector list', 'help.cmd_connector_list'),
      command('connector.create', ['connector', 'create'], 'connector create "name" "domain" ...', 'help.cmd_connector_create'),
      command('connector.detail', ['connector', 'detail'], 'connector detail <id>', 'help.cmd_connector_detail'),
      command('connector.delete', ['connector', 'delete'], 'connector delete <id>', 'help.cmd_connector_delete'),
      command('connector.add-action', ['connector', 'add-action'], 'connector add-action --operations <file> --connector-id <id>', 'help.cmd_connector_add_action'),
      command('connector.list-actions', ['connector', 'list-actions'], 'connector list-actions <id>', 'help.cmd_connector_list_actions'),
      command('connector.delete-action', ['connector', 'delete-action'], 'connector delete-action <id> <operation-id>', 'help.cmd_connector_delete_action'),
      command('connector.test', ['connector', 'test'], 'connector test --connector-id <id> --action <actionId>', 'help.cmd_connector_test'),
      command('connector.list-connections', ['connector', 'list-connections'], 'connector list-connections <id>', 'help.cmd_connector_list_connections'),
      command('connector.create-connection', ['connector', 'create-connection'], 'connector create-connection <id> <name>', 'help.cmd_connector_create_connection'),
      command('connector.smart-create', ['connector', 'smart-create'], 'connector smart-create --curl "..."', 'help.cmd_connector_smart'),
      command('connector.parse-api', ['connector', 'parse-api'], 'connector parse-api [options]', 'help.cmd_connector_parse_api'),
      command('connector.gen-template', ['connector', 'gen-template'], 'connector gen-template [output]', 'help.cmd_connector_gen_template'),
    ],
  },
  {
    id: 'integration',
    titleKey: 'help.group_integration',
    commands: [
      command('integration.create', ['integration', 'create'], 'integration create <appType> ... [--spec file.json]', 'help.cmd_integration'),
      command('integration.list', ['integration', 'list'], 'integration list <appType> [--form-uuid <uuid>] [--status y|n] [--json]', 'help.cmd_integration_list', {
        output: 'json',
      }),
      command('integration.enable', ['integration', 'enable'], 'integration enable <appType> <formUuid> <processCode>', 'help.cmd_integration_enable', {
        output: 'json',
      }),
      command('integration.disable', ['integration', 'disable'], 'integration disable <appType> <formUuid> <processCode>', 'help.cmd_integration_disable', {
        output: 'json',
      }),
      command('integration.check', ['integration', 'check'], 'integration check <appType...>', 'help.cmd_integration_check'),
      command('integration.diagnose', ['integration', 'diagnose'], 'integration diagnose (--text <text>|--file <path>|--rules) [--json]', 'help.cmd_integration_diagnose', {
        requiresLogin: false,
        output: 'text|json',
      }),
      command('dws', ['dws'], 'dws <command> [args]', 'help.cmd_dws'),
      command('dws.contact-user-search', ['dws', 'contact', 'user', 'search'], 'dws contact user search --keyword <text>', 'help.cmd_dws'),
      command('dingtalk-link', ['dingtalk-link'], 'dingtalk-link <url> [--target fullScreen] [--legacy-scheme] [--json]', 'help.cmd_dingtalk_link', {
        requiresLogin: false,
        output: 'text|json',
      }),
    ],
  },
  {
    id: 'utility',
    titleKey: 'help.group_utility',
    commands: [
      command('commands', ['commands'], 'commands [--json]', 'help.cmd_commands', {
        requiresLogin: false,
        output: 'json',
      }),
      command('agent-capabilities', ['agent-capabilities'], 'agent-capabilities [--json]', 'help.cmd_agent_capabilities', {
        requiresLogin: false,
        output: 'json',
      }),
      command('mcp', ['mcp'], 'mcp', 'help.cmd_commands', {
        requiresLogin: false,
        output: 'json',
        hidden: true,
      }),
      command('a2a', ['a2a'], 'a2a <serve|agent-card> [options]', 'help.cmd_a2a', {
        requiresLogin: false,
        output: 'text|json',
      }),
      command('bridge', ['bridge'], 'bridge start [--token <pair-token>] [--port 6736] [--origin https://demo.aliwork.com] [--open|--no-open]', 'help.cmd_bridge', {
        requiresLogin: false,
        output: 'text|json',
      }),
      command('copy', ['copy'], 'copy [--force]', 'help.cmd_copy', { requiresLogin: false }),
      command('sample', ['sample'], 'sample [--list]', 'help.cmd_sample', { requiresLogin: false }),
      command('doctor', ['doctor'], 'doctor [--fix]', 'help.cmd_doctor', { requiresLogin: false }),
      command('db-seq-fix', ['db-seq-fix'], 'db-seq-fix [--fix]', 'help.cmd_db_seq_fix'),
      command('formula.evaluate', ['formula', 'evaluate'], 'formula evaluate <formula|file> [--schema file]', 'help.cmd_formula_evaluate', {
        requiresLogin: false,
        output: 'text|json',
      }),
      command('update', ['update'], 'update', 'help.cmd_update', { requiresLogin: false }),
      command('export-conversation', ['export-conversation'], 'export-conversation [options]', 'help.cmd_export_conversation', {
        requiresLogin: false,
      }),
      command('feedback', ['feedback'], 'feedback <setup|url|dismiss|status> [options]', 'help.cmd_feedback', {
        requiresLogin: false,
        output: 'text|json',
      }),
      command('batch.file', ['batch'], 'batch <file> [--stop-on-error] [--json]', 'help.cmd_batch', {
        output: 'text|json',
      }),
      command('batch.inline', ['batch'], 'batch --commands "cmd1 ; cmd2" [--stop-on-error] [--json]', 'help.cmd_batch', {
        output: 'text|json',
      }),
      command('flash-to-prd', ['flash-to-prd'], 'flash-to-prd --file <path> --name "<project>"', 'help.cmd_flash_to_prd', {
        requiresLogin: false,
      }),
      command('ai', ['ai'], 'ai <text|image> [options]', 'help.cmd_ai', {
        output: 'text|json',
      }),
      command('cdn-config', ['cdn-config'], 'cdn-config [options]', 'help.cmd_cdn_config'),
      command('cdn-upload', ['cdn-upload'], 'cdn-upload <image-path>', 'help.cmd_cdn_upload'),
      command('cdn-refresh', ['cdn-refresh'], 'cdn-refresh [options]', 'help.cmd_cdn_refresh'),
    ],
  },
];

function flattenCommandManifest(groups = COMMAND_GROUPS) {
  return groups.flatMap(group => group.commands.map(entry => ({ ...entry, group: group.id })));
}

function localizeCommand(entry, translate) {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    command: entry.command,
    usage: `openyida ${entry.usage}`,
    raw_usage: entry.usage,
    description: translate(entry.descriptionKey),
    description_key: entry.descriptionKey,
    group: entry.group,
    requires_login: entry.requiresLogin,
    output: entry.output,
    aliases: entry.aliases,
    examples: entry.examples,
    hidden: entry.hidden,
    side_effect: cloneSideEffect(entry.sideEffect),
  };
}

function buildCommandManifest(options = {}) {
  const translate = typeof options.t === 'function' ? options.t : key => key;
  const commands = flattenCommandManifest();

  return {
    schema_version: 1,
    name: 'openyida',
    version: options.version || null,
    aliases: ['yida'],
    command_prefix: 'openyida',
    groups: COMMAND_GROUPS.map(group => ({
      id: group.id,
      title: translate(group.titleKey),
      title_key: group.titleKey,
      commands: group.commands.map(entry => entry.id),
    })),
    commands: commands.map(entry => localizeCommand(entry, translate)),
  };
}

module.exports = {
  COMMAND_GROUPS,
  buildCommandManifest,
  flattenCommandManifest,
};
