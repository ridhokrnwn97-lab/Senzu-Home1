// Pure permission-logic tests for the FAT catalog UI controls.
// Browser/Playwright is not installed in this repo, so rendering is not asserted;
// these tests cover the logic that decides which controls and payloads are allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_PERMISSION_KEYS, catalogPermissionsFrom, catalogControls, requiredPermissions,
  SERVICE_FIELD_PERMISSION, CATEGORY_FIELD_PERMISSION, catalogErrorMessage,
} from '../src/lib/catalogPermissions.ts';

test('session permissions are strict booleans from the server, never inherited from role', () => {
  assert.deepEqual(catalogPermissionsFrom(null), Object.fromEntries(CATALOG_PERMISSION_KEYS.map(k => [k, false])));
  assert.deepEqual(catalogPermissionsFrom({ view: 1, create: 'true', editPrice: true }),
    Object.fromEntries(CATALOG_PERMISSION_KEYS.map(k => [k, k === 'editPrice'])));
  assert.deepEqual(catalogPermissionsFrom({ role: 'manager' }),
    Object.fromEntries(CATALOG_PERMISSION_KEYS.map(k => [k, false])));
});

test('mixed permissions expose only the matching controls', () => {
  const mixed = catalogControls(catalogPermissionsFrom({ view: true, editPrice: true, toggleStatus: true }));
  assert.deepEqual(mixed, {
    canView: true, canCreate: false, canEditInfo: false, canEditPrice: true,
    canEditDuration: false, canManageCategories: false, canToggleStatus: true,
  });
  const none = catalogControls(catalogPermissionsFrom({}));
  assert.equal(Object.values(none).some(Boolean), false);
  const full = catalogControls(catalogPermissionsFrom(Object.fromEntries(CATALOG_PERMISSION_KEYS.map(k => [k, true]))));
  assert.equal(Object.values(full).every(Boolean), true);
});

test('field controls map to the same permissions the backend enforces', () => {
  assert.equal(SERVICE_FIELD_PERMISSION.price, 'editPrice');
  assert.equal(SERVICE_FIELD_PERMISSION.duration, 'editDuration');
  assert.equal(SERVICE_FIELD_PERMISSION.name, 'editInfo');
  assert.equal(SERVICE_FIELD_PERMISSION.categoryId, 'editInfo');
  assert.equal(SERVICE_FIELD_PERMISSION.isActive, 'toggleStatus');
  assert.equal(CATEGORY_FIELD_PERMISSION.categoryName, 'manageCategories');
  assert.equal(CATEGORY_FIELD_PERMISSION.isActive, 'toggleStatus');
  assert.deepEqual(requiredPermissions(['price', 'isActive'], SERVICE_FIELD_PERMISSION), ['editPrice', 'toggleStatus']);
  assert.deepEqual(requiredPermissions(['categoryName', 'description'], CATEGORY_FIELD_PERMISSION), ['manageCategories']);
});

test('server errors are translated without claiming a successful mutation', () => {
  const cases = [
    [{ status: 401 }, 'login'],
    [{ status: 403 }, 'Permission'],
    [{ status: 404 }, 'tidak ditemukan'],
    [{ status: 409 }, 'konflik'],
    [{ status: 503 }, 'tidak tersedia'],
  ];
  for (const [error, needle] of cases) {
    const message = catalogErrorMessage(error);
    assert.ok(message.includes(needle), JSON.stringify({ error, message }));
    assert.ok(!/berhasil|tersimpan/i.test(message), message);
  }
});
