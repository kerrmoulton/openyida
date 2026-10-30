'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mockGet = jest.fn(), mockPost = jest.fn(), mockPackages = jest.fn(), mockFeature = jest.fn();
jest.mock('../lib/core/yida-client', () => ({ createAuthRef: () => ({}),
  createYidaClient: () => ({ get: mockGet, postFormOnce: mockPost }) }));
jest.mock('../lib/permission/permit-package-service', () => ({ fetchAllPermitPackages: (...args) => mockPackages(...args) }));
jest.mock('../lib/permission/matrix-availability', () => ({ queryFeature: (...args) => mockFeature(...args) }));
const permission = require('../lib/permission/permission-manage');
const matrix = require('../lib/permission/matrix-manage');
const ok = content => ({ success: true, content });
const pkg = { packageUuid: 'PKG', packageType: 'FORM_PACKAGE_VIEW', packageName: { zh_CN: 'Original' },
  roleDataComplete: false, roleData: { include: [{ roleType: 'DEFAULT', roleValue: 'ALL' }] },
  dataPermit: {}, operatePermit: { OPERATE_VIEW: 'y' }, fieldPermit: {} };

describe('permission and matrix management safety', () => {
  let dir;
  beforeEach(() => {
    jest.clearAllMocks(); mockGet.mockReset(); mockPost.mockReset(); mockPackages.mockReset(); mockFeature.mockReset();
    mockFeature.mockResolvedValue({ status: 'available' });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-matrix-'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { console.log.mockRestore(); fs.rmSync(dir, { recursive: true, force: true }); });
  test('native same-form copy delegates unreadable exclusions to the server', async () => {
    mockPackages.mockResolvedValueOnce({ packages: [pkg] }).mockResolvedValueOnce({ packages: [pkg, { ...pkg, packageUuid: 'NEW' }] });
    mockPost.mockResolvedValueOnce(ok(true));
    await expect(permission.run(['copy', 'APP', 'FORM', 'PKG'])).resolves.toMatchObject({ packageUuid: 'NEW',
      copyMode: 'native_same_form', unreadableDimensionsVerified: false });
    expect(mockPost).toHaveBeenCalledWith('/APP/permission/manage/copyPermitPkgNewToForm.json', {
      packageUuid: 'PKG', formUuids: 'FORM',
    });
  });
  test('renaming an incompletely readable package cannot overwrite hidden rules', async () => {
    mockPackages.mockResolvedValueOnce({ packages: [pkg] });
    await expect(permission.run(['rename', 'APP', 'FORM', 'PKG', '--name', 'new'])).rejects.toThrow('full package');
    expect(mockPost).not.toHaveBeenCalled();
  });
  test('matrix list exposes partial page rather than claiming all records', async () => {
    mockGet.mockResolvedValueOnce(ok({ data: [{ matrixId: 'M1' }], totalCount: 10 }));
    await expect(matrix.run(['list', '--limit', '1'])).resolves.toMatchObject({ complete: false, limit: 1 });
    expect(mockPost).not.toHaveBeenCalled();
  });
  test.each(['unavailable', 'unknown'])('matrix %s prevents all remote mutations', async status => {
    mockFeature.mockResolvedValueOnce({ status });
    await expect(matrix.run(['create', '--file', 'unused.json'])).rejects.toThrow('unavailable/unknown');
    expect(mockGet).not.toHaveBeenCalled(); expect(mockPost).not.toHaveBeenCalled();
  });
  test('a referenced matrix cannot be deleted', async () => {
    mockGet.mockResolvedValueOnce(ok({ matrixId: 'MATRIX' })).mockResolvedValueOnce(ok({ data: [{}], totalCount: 1 }));
    await expect(matrix.run(['delete', 'MATRIX', '--confirm'])).rejects.toThrow('references');
    expect(mockPost).not.toHaveBeenCalled();
  });
  test('matrix patch preview preserves unspecified columns, admins and description', async () => {
    const original = { matrixId: 'MATRIX', name: { zh_CN: 'Old' }, description: { zh_CN: 'Keep' },
      admins: [{ userId: 'REAL' }], content: { condition: [{ columnId: 'C', name: 'Department', componentType: 'DepartmentSelectField' }],
        result: [{ columnId: 'R', name: 'Owner', componentType: 'EmployeeField' }], config: { unknown: 1 } } };
    mockGet.mockResolvedValueOnce(ok(original));
    const file = path.join(dir, 'patch.json'); fs.writeFileSync(file, JSON.stringify({ name: { zh_CN: 'New' } }));
    const result = await matrix.run(['update', 'MATRIX', '--file', file, '--dry-run']);
    expect(result.remoteWrites).toBe(0);
    expect(JSON.parse(result.params.content)).toEqual(original.content);
    expect(JSON.parse(result.params.admins)).toEqual(original.admins);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
