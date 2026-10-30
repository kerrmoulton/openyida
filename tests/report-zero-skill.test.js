'use strict';

const fs = require('fs');
const path = require('path');
const skillRoot = path.join(__dirname, '../yida-skills/skills/yida-report');
const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const guide = fs.readFileSync(path.join(skillRoot, 'references/zero-values.md'), 'utf8');
const index = require('../yida-skills/skills-index.json');

test('native report skill requires explicit zero-hiding intent and retains empty/zero distinction', () => {
  expect(skill).toContain('零值隐藏默认关闭');
  expect(skill).toContain('仅当用户显式要求');
  expect(skill).toContain('均不构成开启授权');
  expect(skill).toContain('空值与数值 0 必须区分');
  expect(skill).toContain('hideZeroValues: true');
  expect(skill).toContain('--hide-zero-values true --dry-run --json');
  expect(skill).toContain('--hide-zero-values false --json');
  expect(skill).toContain('REPORT_ZERO_VALUES_CUSTOM_HOOK');
  expect(skill).toContain('通过 `ask_human` 分别确认');
  expect(skill).toContain('已有明确回答时直接执行，不重复询问');
  expect(skill).toContain('--hide-zero-categories false --hide-zero-legends false');
  expect(skill).toContain('不把未回答当作同意');
  expect(guide).toContain('后续查询该指标由全零变为非零');
  expect(guide).toContain('runtimeQueryVerified');
  expect(guide).toContain('不等同于浏览器展示验收');
  const entry = index.skills.find(item => item.name === 'yida-report');
  expect(entry.command_ids).toEqual(expect.arrayContaining(['report.inspect', 'report.configure']));
  expect(entry.description).toContain('默认关闭');
});
