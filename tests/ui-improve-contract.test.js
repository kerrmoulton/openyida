'use strict';

const fs = require('fs');
const path = require('path');
const { buildCommandManifest } = require('../lib/core/command-manifest');

const root = path.resolve(__dirname, '..');
const designDir = path.join(root, 'yida-skills/skills/yida-design');
const improveDir = path.join(designDir, 'sub_skill/ui-improve');
const read = file => fs.readFileSync(file, 'utf8');
const files = [path.join(improveDir, 'SKILL.md'), ...fs.readdirSync(path.join(improveDir, 'references'))
  .filter(file => file.endsWith('.md')).map(file => path.join(improveDir, 'references', file))];

describe('UI improvement discovery and CLI contracts', () => {
  test('all progressive-disclosure links resolve to packaged skill resources', () => {
    for (const file of files) {
      for (const match of read(file).matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
        const target = path.resolve(path.dirname(file), match[1]);
        expect(target.startsWith(path.join(root, 'yida-skills') + path.sep)).toBe(true);
        expect(fs.existsSync(target)).toBe(true);
      }
    }
  });

  test('human and machine skill descriptions stay identical', () => {
    const frontmatter = read(path.join(designDir, 'SKILL.md')).split('---')[1];
    const description = frontmatter.split('description: >')[1].trim().split('\n').map(line => line.trim()).join(' ');
    const entry = JSON.parse(read(path.join(root, 'yida-skills/skills-index.json'))).skills.find(skill => skill.name === 'yida-design');
    expect(entry.description).toBe(description);
  });

  test('installed instructions and page implementers point to the same workflow', () => {
    for (const file of ['scripts/postinstall.js',
      'yida-skills/skills/yida-canvas-custom-page/SKILL.md',
      'yida-skills/skills/yida-custom-page/SKILL.md',
      'yida-skills/skills/yida-publish-page/SKILL.md']) {
      expect(read(path.join(root, file))).toContain('sub_skill/ui-improve/SKILL.md');
    }
  });

  test('skill index and CLI capabilities expose the same theme recovery commands', () => {
    const entry = JSON.parse(read(path.join(root, 'yida-skills/skills-index.json'))).skills.find(skill => skill.name === 'yida-design');
    const workflow = buildCommandManifest().summary.core_workflows.existing_ui_improvement;
    expect(workflow.theme_command_ids).toEqual(entry.command_ids);
    expect(fs.existsSync(path.join(root, workflow.reference))).toBe(true);
  });

  test('CLI examples reference registered commands instead of invented snapshot/restore aliases', () => {
    const manifest = buildCommandManifest();
    const examples = files.flatMap(file => [...read(file).matchAll(/\bopenyida ([^`\n]+)/g)]
      .map(match => ({ file, argv: match[1].trim().split(/\s+/) })));
    expect(examples.length).toBeGreaterThan(0);
    for (const { file, argv } of examples) {
      const matches = manifest.commands.filter(command => command.path.every((part, index) => argv[index] === part));
      expect({ file: path.relative(root, file), command: argv[0], registered: matches.length > 0 })
        .toEqual({ file: path.relative(root, file), command: argv[0], registered: true });
    }
  });

  test('first-instinct selection policy has one owner, outside the entrypoint', () => {
    const entry = read(path.join(designDir, 'SKILL.md'));
    expect(entry).toContain('(references/theme-selection.md)');
    expect(entry).not.toMatch(/第一直觉|生成三套/);
    expect(read(path.join(designDir, 'references/theme-selection.md'))).toContain('## 拒绝第一直觉');
  });
});
