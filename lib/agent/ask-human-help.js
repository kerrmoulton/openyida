'use strict';

// Shared static help: no authentication, file access, or receipt creation.
const example = {
  title: '确认搭建方案', revision: '<confirmation.revision>',
  attachments: [{ name: '搭建方案.html', path: '<outputs.confirmationHtml>' }],
  questions: [{ id: 'plan_decision', header: '搭建方案', question: '请确认当前搭建方案',
    type: 'single_select', options: [
      { label: '确认并开始搭建', value: 'confirm_build' },
      { label: '继续调整', value: 'continue_editing' },
    ] }],
};

module.exports = {
  path: ['agent', 'ask-human'],
  usage: 'openyida agent ask-human --request-key <稳定业务键> --questions-file <相对路径> --json',
  description: '在宜搭云端发起的本地 Agent 任务中提交结构化问题并等待网页回答。',
  examples: [JSON.stringify(example)],
};
