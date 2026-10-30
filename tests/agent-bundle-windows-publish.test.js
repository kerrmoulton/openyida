'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { materializeBundle, verifyBundle } = require('../lib/agent/frozen-bundle');
const { canonicalPath } = require('../lib/agent/runtime-package');
const { createBundleFixture, removeFixture } = require('./helpers/agent-bundle-fixture');

const windowsTest = process.platform === 'win32' ? test : test.skip;
describe('Windows bundle atomic publication', () => {
  let root;
  afterEach(() => {jest.restoreAllMocks(); if (root) {removeFixture(root);}});
  windowsTest.each([1, Infinity])('handles %s transient publication failures without replacing existing bundles', (failures) => {
    root = canonicalPath(fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-publish-')));
    const fixture = createBundleFixture(root);
    const original = fs.renameSync;
    let attempts = 0;
    jest.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (path.basename(source).startsWith('.staging-') && ++attempts <= failures) {
        throw Object.assign(new Error('temporary directory sharing conflict'), { code: 'EPERM' });
      }
      return original(source, target);
    });
    const freeze = () => materializeBundle(fixture.runtime, fixture.config);
    if (failures === Infinity) {
      expect(freeze).toThrow(expect.objectContaining({ code: 'AGENT_BUNDLE_INVALID' }));
      expect(attempts).toBe(6);
      expect(fs.readdirSync(path.join(fixture.config.stateDir, 'bundles'))).toEqual([]);
    } else {
      const frozen = freeze();
      expect(attempts).toBe(2);
      expect(verifyBundle(frozen.config.bundle.root, frozen.config.bundle.id)).toBeTruthy();
      // Elevated Windows accounts default new directory owners to Administrators;
      // the native runtime deliberately accepts only the actual current user.
      const owner = execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'
$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl=(Get-Item -LiteralPath $env:OPENYIDA_TEST_BUNDLE).GetAccessControl()
if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $current){throw 'Bundle owner mismatch'}
'owned'
`], {encoding:'utf8', windowsHide:true, timeout:15000, env:{...process.env, OPENYIDA_TEST_BUNDLE:frozen.config.bundle.root}});
      expect(owner.trim()).toBe('owned');
    }
  }, 30000);
});
