'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

describe('Codex postinstall skills', () => {
  test('installs plugin skills without a second global copy', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-postinstall-'));
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const codexDir = path.join(home, '.codex');
    fs.mkdirSync(codexDir);

    try {
      const homedir = spawnSync(process.execPath,
        ['-e', 'process.stdout.write(require("os").homedir())'], { env, encoding: 'utf8' });
      expect(homedir.status).toBe(0);
      expect(path.resolve(homedir.stdout)).toBe(path.resolve(home));

      for (let attempt = 0; attempt < 2; attempt++) {
        const result = spawnSync(process.execPath, ['scripts/postinstall.js'], {
          cwd: ROOT, env, encoding: 'utf8', timeout: 30000,
        });
        expect(result.status).toBe(0);
        expect(fs.existsSync(path.join(home, '.openyida', 'codex-plugin',
          'plugins', 'openyida', 'skills', 'yida-app', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(codexDir, 'skills', 'yida-skills'))).toBe(false);
      }

      expect(fs.existsSync(path.join(home, '.claude', 'skills', 'yida-skills', 'SKILL.md')))
        .toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
