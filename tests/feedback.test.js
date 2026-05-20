'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  FIELD_LABELS,
  buildAutofillActionSource,
  buildFeedbackFields,
  buildFeedbackUrl,
  getLoginLoopStatus,
  getReminderStatus,
  parseArgs,
  recordLoginEvent,
  sanitizeMetadata,
} = require('../lib/feedback/feedback');

describe('feedback command helpers', () => {
  test('parseArgs supports setup, url, and dismiss commands', () => {
    expect(parseArgs(['setup', 'APP_XXX', '--name', '反馈', '--path', '/o/openyida-feedback'])).toMatchObject({
      command: 'setup',
      options: {
        appType: 'APP_XXX',
        formName: '反馈',
        openPath: '/o/openyida-feedback',
      },
    });

    expect(parseArgs(['url', '--tool', 'Codex', '--reason', 'login_loop'])).toMatchObject({
      command: 'url',
      options: {
        tool: 'Codex',
        reason: 'login_loop',
      },
    });

    expect(parseArgs(['dismiss', '--today'])).toMatchObject({
      command: 'dismiss',
      options: { today: true },
    });
  });

  test('buildFeedbackFields includes hidden sanitized metadata fields', () => {
    const fields = buildFeedbackFields();
    const metadataField = fields.find((field) => field.label === FIELD_LABELS.session);

    expect(fields.some((field) => field.label === FIELD_LABELS.privacy && field.required)).toBe(true);
    expect(fields).toContainEqual(expect.objectContaining({
      type: 'ImageField',
      label: FIELD_LABELS.screenshot,
    }));
    expect(metadataField).toMatchObject({
      type: 'TextField',
      behavior: 'HIDDEN',
      visibility: ['PC', 'MOBILE'],
    });
  });

  test('buildAutofillActionSource reads URL metadata without submitting secrets', () => {
    const fieldMap = {
      [FIELD_LABELS.tool]: 'textField_tool',
      [FIELD_LABELS.model]: 'textField_model',
      [FIELD_LABELS.command]: 'textField_command',
      [FIELD_LABELS.session]: 'textField_session',
      [FIELD_LABELS.version]: 'textField_version',
      [FIELD_LABELS.reason]: 'textField_reason',
      [FIELD_LABELS.diagnostics]: 'textareaField_diag',
    };
    const source = buildAutofillActionSource(fieldMap);

    expect(source).toContain('URLSearchParams');
    expect(source).toContain('oy_meta');
    expect(source).toContain(FIELD_LABELS.diagnostics);
    expect(source).not.toContain('cookie');
  });

  test('buildFeedbackUrl hashes session id and encodes metadata in one query param', () => {
    const result = buildFeedbackUrl(
      { publicUrl: 'https://www.aliwork.com/o/openyida-feedback' },
      { tool: 'Codex', session: 'thread-secret', diagnostics: 'login failed' }
    );
    const url = new URL(result.url);

    expect(url.searchParams.get('oy_meta')).toBeTruthy();
    expect(result.metadata.tool).toBe('Codex');
    expect(result.metadata.session).toMatch(/^anon_[a-f0-9]{16}$/);
    expect(result.url).not.toContain('thread-secret');
  });

  test('sanitizeMetadata truncates long diagnostics', () => {
    const metadata = sanitizeMetadata({
      session: 'abc',
      diagnostics: 'x'.repeat(3000),
    });

    expect(metadata.session).toMatch(/^anon_/);
    expect(metadata.diagnostics.length).toBeLessThanOrEqual(1803);
  });

  test('login loop status trips after repeated login events and respects reminder state', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-feedback-'));
    const configPath = path.join(tempDir, 'config.json');

    expect(getReminderStatus(configPath).shouldRemind).toBe(true);

    recordLoginEvent('trigger', { reason: 'missing_cookie' }, { configPath });
    recordLoginEvent('need_qr_scan', { reason: 'need_qr_scan' }, { configPath });
    const status = recordLoginEvent('failed', { reason: 'no_cookie_after_login' }, { configPath });

    expect(status.detected).toBe(true);
    expect(status.shouldSuggestFeedback).toBe(true);
    expect(getLoginLoopStatus(configPath).count).toBe(3);
  });
});
