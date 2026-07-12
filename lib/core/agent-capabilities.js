'use strict';

const path = require('path');
const { version } = require('../../package.json');
const { t } = require('./i18n');
const { buildCommandManifest } = require('./command-manifest');
const { buildEnvironmentSnapshot } = require('./env');
const { checkLoginOnly } = require('../auth/login');

function redactLogin(login) {
  const redacted = { ...login };
  delete redacted.csrf_token;
  delete redacted.cookies;
  return redacted;
}

function buildAgentCapabilities() {
  const envSnapshot = buildEnvironmentSnapshot();
  const loginStatus = redactLogin(checkLoginOnly({ includeSecrets: false }));
  const manifest = buildCommandManifest({ t, version });
  const projectRoot = envSnapshot.active.projectRoot;

  return {
    schema_version: 1,
    name: 'openyida-agent-capabilities',
    openyida: {
      version,
      aliases: manifest.aliases,
      command_prefix: manifest.command_prefix,
    },
    system: envSnapshot.system,
    active: envSnapshot.active,
    login: loginStatus,
    recommended: {
      preflight_command: 'openyida agent-capabilities --json',
      mutation_guard: 'Run mutating commands only when login.status is ok or after a successful openyida login.',
      workdir: projectRoot,
      cache_dir: path.join(projectRoot, '.cache'),
      openyida_task_cache_dir: path.join(projectRoot, '.cache', 'openyida'),
    },
    skills: {
      index_file: 'skills-index.json',
      entry: 'openyida',
      note: 'Use host use_skill/search_skills when available; otherwise load only the current-stage SKILL.md selected by the root routing table.',
    },
    sideEffects: {
      read_only_preflight: [
        'openyida agent-capabilities --json',
        'openyida env --json',
        'openyida login --check-only --json',
        'openyida commands --json',
      ],
      retry_policy: 'Do not repeat the same failed command without changing login state, organization, parameters, files, or field IDs.',
      completion_contracts: {
        full_app: 'Publishing the primary page successfully and returning an access URL completes the default build.',
      },
    },
    command_manifest: {
      schema_version: manifest.schema_version,
      groups: manifest.groups,
      commands: manifest.commands,
    },
  };
}

async function run() {
  console.log(JSON.stringify(buildAgentCapabilities(), null, 2));
}

module.exports = {
  buildAgentCapabilities,
  run,
};
