import type { Express, Request } from 'express';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

// Catalog mutations are Admin SDK only. FAT never receives direct Firestore
// create/update rights; permission is resolved from the verified UID and the
// authoritative /staff_roles + /staff_users documents inside one transaction.
export const CATALOG_PERMISSION_KEYS = [
  'view', 'create', 'editInfo', 'editPrice', 'editDuration', 'manageCategories', 'toggleStatus',
] as const;
export type CatalogPermissionKey = (typeof CATALOG_PERMISSION_KEYS)[number];
export type CatalogPermissions = Record<CatalogPermissionKey, boolean>;

const ALL: CatalogPermissions = CATALOG_PERMISSION_KEYS.reduce((acc, key) => {
  acc[key] = true; return acc;
}, {} as CatalogPermissions);

export function resolveCatalogPermissions(roleData: unknown, roleName: unknown): CatalogPermissions | null {
  const role = typeof roleName === 'string' ? roleName.trim().toLowerCase() : '';
  if (role === 'manager' || role === 'admin') return { ...ALL };
  if (role !== 'fat') return null;
  const raw = (roleData as any)?.catalogPermissions;
  const perms = {} as CatalogPermissions;
  for (const key of CATALOG_PERMISSION_KEYS) perms[key] = raw != null && typeof raw === 'object' && raw[key] === true;
  return perms;
}

export const SERVICE_FIELD_PERMISSION: Record<string, CatalogPermissionKey> = {
  name: 'editInfo', description: 'editInfo', shortDescription: 'editInfo', categoryId: 'editInfo',
  imageUrl: 'editInfo', serviceType: 'editInfo', requiredSkillIds: 'editInfo', isPopular: 'editInfo',
  sortOrder: 'editInfo', price: 'editPrice', duration: 'editDuration', isActive: 'toggleStatus',
};
export const CATEGORY_FIELD_PERMISSION: Record<string, CatalogPermissionKey> = {
  categoryName: 'manageCategories', categoryCode: 'manageCategories', description: 'manageCategories',
  sortOrder: 'manageCategories', isActive: 'toggleStatus',
};

export function requiredPermissions(body: Record<string, unknown>, map: Record<string, CatalogPermissionKey>): CatalogPermissionKey[] {
  return [...new Set(Object.keys(body).map(key => map[key]).filter((key): key is CatalogPermissionKey => !!key))];
}

const fail = (status: number, code: string, message: string) =>
  Object.assign(new Error(message), { status, code, catalogError: true });
const ID = /^[A-Za-z0-9_-]{1,128}$/;

function text(value: unknown, max: number, label: string, required = false): string | undefined {
  if (value === undefined) {
    if (required) throw fail(400, 'INVALID_FIELD', `${label} wajib diisi.`);
    return undefined;
  }
  if (typeof value !== 'string' || /[\x00-\x1F\x7F]/.test(value)) throw fail(400, 'INVALID_FIELD', `${label} tidak valid.`);
  const out = value.trim();
  if (required && !out) throw fail(400, 'INVALID_FIELD', `${label} wajib diisi.`);
  if (out.length > max) throw fail(400, 'INVALID_FIELD', `${label} terlalu panjang.`);
  return out;
}

function integer(value: unknown, min: number, max: number, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw fail(400, 'INVALID_FIELD', `${label} tidak valid.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw fail(400, 'INVALID_FIELD', `${label} tidak valid.`);
  return value;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function allowOnly(body: unknown, map: Record<string, CatalogPermissionKey>): Record<string, unknown> {
  if (!plainObject(body) || Object.keys(body).some(key => !(key in map) || key === '__proto__' || key === 'constructor')) {
    throw fail(400, 'INVALID_PAYLOAD', 'Payload katalog tidak valid.');
  }
  return body;
}

export function validateServicePayload(body: unknown, isNew: boolean): Record<string, unknown> {
  const input = allowOnly(body, SERVICE_FIELD_PERMISSION);
  const out: Record<string, unknown> = {};
  const name = text(input.name, 120, 'Nama layanan', isNew);
  if (name !== undefined) out.name = name;
  for (const [key, label, max] of [['description', 'Deskripsi', 2000], ['shortDescription', 'Deskripsi singkat', 500],
    ['imageUrl', 'URL gambar', 500]] as const) {
    const value = text(input[key], max, label);
    if (value !== undefined) out[key] = value;
  }
  const categoryId = text(input.categoryId, 128, 'Kategori', isNew);
  if (categoryId !== undefined) {
    if (!ID.test(categoryId)) throw fail(400, 'INVALID_FIELD', 'Kategori tidak valid.');
    out.categoryId = categoryId;
  }
  const serviceType = input.serviceType;
  if (serviceType !== undefined) {
    if (serviceType !== 'HOME_SERVICE' && serviceType !== 'OUTLET' && serviceType !== 'BOTH') {
      throw fail(400, 'INVALID_FIELD', 'Jenis layanan tidak valid.');
    }
    out.serviceType = serviceType;
  }
  if (input.requiredSkillIds !== undefined) {
    if (!Array.isArray(input.requiredSkillIds) || input.requiredSkillIds.length > 50 ||
        input.requiredSkillIds.some(id => typeof id !== 'string' || !ID.test(id))) {
      throw fail(400, 'INVALID_FIELD', 'Keahlian yang dibutuhkan tidak valid.');
    }
    out.requiredSkillIds = [...input.requiredSkillIds];
  }
  const price = integer(input.price, 0, 100_000_000, 'Harga');
  if (price !== undefined) out.price = price;
  else if (isNew) throw fail(400, 'INVALID_FIELD', 'Harga wajib diisi.');
  const duration = integer(input.duration, 1, 1440, 'Durasi');
  if (duration !== undefined) out.duration = duration;
  else if (isNew) throw fail(400, 'INVALID_FIELD', 'Durasi wajib diisi.');
  const sortOrder = integer(input.sortOrder, 0, 10_000, 'Urutan');
  if (sortOrder !== undefined) out.sortOrder = sortOrder;
  for (const key of ['isPopular', 'isActive'] as const) {
    const value = boolean(input[key], key);
    if (value !== undefined) out[key] = value;
  }
  if (isNew && out.isActive === undefined) out.isActive = true;
  return out;
}

export function validateCategoryPayload(body: unknown, isNew: boolean): Record<string, unknown> {
  const input = allowOnly(body, CATEGORY_FIELD_PERMISSION);
  const out: Record<string, unknown> = {};
  const categoryName = text(input.categoryName, 120, 'Nama kategori', isNew);
  if (categoryName !== undefined) out.categoryName = categoryName;
  const description = text(input.description, 2000, 'Deskripsi');
  if (description !== undefined) out.description = description;
  const code = text(input.categoryCode, 40, 'Kode kategori');
  if (code !== undefined) out.categoryCode = code;
  const sortOrder = integer(input.sortOrder, 0, 10_000, 'Urutan');
  if (sortOrder !== undefined) out.sortOrder = sortOrder;
  const isActive = boolean(input.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  if (isNew && out.isActive === undefined) out.isActive = true;
  return out;
}

type Dependencies = {
  db: Firestore | null;
  verify: (token: string) => Promise<{ uid: string }>;
  now?: () => number;
};

type Actor = { uid: string; staffId: string; role: string; name: string; perms: CatalogPermissions };

const disabled = (record: any) => record?.isActive === false || record?.loginEnabled === false ||
  ['INACTIVE', 'DISABLED', 'ARCHIVED', 'DINONAKTIFKAN', 'DELETED', 'TERMINATED']
    .includes(String(record?.status ?? '').trim().toUpperCase()) ||
  String(record?.loginAccountStatus ?? '').trim().toUpperCase() === 'DINONAKTIFKAN';

const uidConflict = (record: any, uid: string) => [record?.authUserId, record?.authUid].some(value =>
  value != null && value !== '' && (typeof value !== 'string' || value.trim() !== uid));

async function resolveActor(db: Firestore, t: Transaction, uid: string): Promise<Actor> {
  const [roleSnap, canonical, legacy, direct] = await Promise.all([
    t.get(db.collection('staff_roles').doc(uid)),
    t.get(db.collection('staff_users').where('authUserId', '==', uid).limit(2)),
    t.get(db.collection('staff_users').where('authUid', '==', uid).limit(2)),
    t.get(db.collection('staff_users').doc(uid)),
  ]);
  const matches = new Map<string, any>();
  for (const snap of [...canonical.docs, ...legacy.docs]) matches.set(snap.id, snap);
  if (direct.exists) matches.set(direct.id, direct);
  if (matches.size !== 1) throw fail(403, 'AMBIGUOUS_STAFF', 'Identitas staf tidak dapat diverifikasi secara unik.');
  const staffSnap = [...matches.values()][0];
  const staff = staffSnap.data() || {};
  if (uidConflict(staff, uid) || (staffSnap.id !== uid &&
      staff.authUserId !== uid && staff.authUid !== uid)) {
    throw fail(403, 'STAFF_MISMATCH', 'Identitas staf tidak sesuai dengan sesi.');
  }
  if (disabled(staff)) throw fail(403, 'STAFF_INACTIVE', 'Akun staf sedang dinonaktifkan.');
  if (!roleSnap.exists) throw fail(403, 'ROLE_REQUIRED', 'Data peran aktif tidak ditemukan.');
  const roleData = roleSnap.data() || {};
  if (roleData.isActive !== true || disabled(roleData) || uidConflict(roleData, uid)) {
    throw fail(403, 'ROLE_INACTIVE', 'Akun staf sedang dinonaktifkan.');
  }
  const roleName = String(roleData.role ?? '').trim().toLowerCase();
  if (roleName !== String(staff.role ?? '').trim().toLowerCase()) {
    throw fail(403, 'ROLE_MISMATCH', 'Peran staf tidak sesuai dengan Staff Master.');
  }
  for (const linked of [roleData.staffId, roleData.staffUserId]) {
    if (linked != null && linked !== '' && (typeof linked !== 'string' ||
        ![uid, staffSnap.id, staff.uid, staff.id].includes(linked))) {
      throw fail(403, 'STAFF_MISMATCH', 'Referensi Staff Master tidak sesuai.');
    }
  }
  const perms = resolveCatalogPermissions(roleData, roleName);
  if (!perms) throw fail(403, 'ROLE_REQUIRED', 'Akses katalog tidak tersedia untuk peran ini.');
  return {
    uid, staffId: staffSnap.id, role: roleName,
    name: String(staff.name || staff.fullName || 'Staf Senzu'), perms,
  };
}

function need(actor: Actor, keys: CatalogPermissionKey[]): void {
  if (keys.some(key => actor.perms[key] !== true)) {
    throw fail(403, 'PERMISSION_REQUIRED', 'Permission katalog tidak memadai untuk permintaan ini.');
  }
}

function audit(entityType: 'service' | 'service_category',
  isNew: boolean, before: Record<string, any>, after: Record<string, any>,
  changed: string[], actor: Actor, requestId: string, nowIso: string) {
  const statusChanged = changed.length === 1 && changed[0] === 'isActive';
  const isActive = after.isActive;
  const action = isNew
    ? `${entityType}.created`
    : statusChanged
      ? `${entityType}.${isActive ? 'activated' : 'deactivated'}`
      : `${entityType}.updated`;
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of changed) {
    oldValues[key] = before[key] ?? null;
    newValues[key] = after[key] ?? null;
  }
  return {
    id: `adm_audit_${nowIso.replace(/[-:.TZ]/g, '')}_${Math.random().toString(36).slice(2, 10)}`,
    actorId: actor.uid, actorRole: actor.role, actorName: actor.name,
    action, entityType, entityId: after.id,
    changedFields: [...changed].sort(), oldValues, newValues,
    summary: `${isNew ? 'Menambahkan' : 'Memperbarui'} ${entityType} "${after.name || after.categoryName || after.id}"`,
    timestamp: nowIso, requestId,
  };
}

export function createCatalogApi(deps: Dependencies) {
  if (!deps.db || !deps.verify) throw new Error('Catalog API dependencies missing');
  const db = deps.db;
  const clock = deps.now || Date.now;

  async function actorFor(req: Request): Promise<string> {
    const header = String(req.headers?.authorization || '');
    if (!header.startsWith('Bearer ')) throw fail(401, 'AUTH_REQUIRED', 'Sesi autentikasi diperlukan.');
    const token = header.slice(7).trim();
    const verified = await deps.verify(token).catch(() => null);
    if (!verified?.uid || !ID.test(verified.uid)) throw fail(401, 'AUTH_INVALID', 'Sesi login tidak valid.');
    return verified.uid;
  }

  function requestIdOf(req: Request): string {
    const value = (req as any).id;
    return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value) ? value : '';
  }

  async function list(kind: 'services' | 'service_categories', req: Request) {
    const uid = await actorFor(req);
    return db.runTransaction(async (t: Transaction) => {
      const actor = await resolveActor(db, t, uid);
      need(actor, ['view']);
      const snap = await t.get(db.collection(kind));
      return snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    });
  }

  async function createService(req: Request) {
    const uid = await actorFor(req);
    const values = validateServicePayload(req.body, true);
    return db.runTransaction(async (t: Transaction) => {
      const actor = await resolveActor(db, t, uid);
      need(actor, ['create']);
      const category = await t.get(db.collection('service_categories').doc(values.categoryId as string));
      if (!category.exists || category.data()?.isActive === false) throw fail(400, 'INVALID_CATEGORY', 'Kategori tidak valid atau tidak aktif.');
      const nowIso = new Date(clock()).toISOString();
      const record = { ...values, id: `svc_${nowIso.replace(/[-:.TZ]/g, '')}_${Math.random().toString(36).slice(2, 8)}`,
        category: category.data()?.categoryName || '', categoryCode: category.data()?.categoryCode || '',
        createdAt: nowIso, updatedAt: nowIso, updatedBy: actor.name };
      const ref = db.collection('services').doc(record.id);
      if ((await t.get(ref)).exists) throw fail(409, 'ALREADY_EXISTS', 'Layanan sudah ada.');
      const log = audit('service', true, {}, record, Object.keys(values), actor, requestIdOf(req), nowIso);
      t.create(ref, record);
      t.create(db.collection('admin_audit_logs').doc(log.id), log);
      return record;
    });
  }

  async function updateService(req: Request, serviceId: string) {
    if (!ID.test(serviceId)) throw fail(400, 'INVALID_ID', 'ID layanan tidak valid.');
    const uid = await actorFor(req);
    const values = validateServicePayload(req.body, false);
    if (!Object.keys(values).length) throw fail(400, 'INVALID_PAYLOAD', 'Tidak ada field yang diubah.');
    return db.runTransaction(async (t: Transaction) => {
      const actor = await resolveActor(db, t, uid);
      need(actor, requiredPermissions(values, SERVICE_FIELD_PERMISSION));
      const ref = db.collection('services').doc(serviceId);
      const snap = await t.get(ref);
      if (!snap.exists) throw fail(404, 'NOT_FOUND', 'Layanan tidak ditemukan.');
      const before = snap.data() || {};
      if (values.categoryId !== undefined && values.categoryId !== before.categoryId) {
        const category = await t.get(db.collection('service_categories').doc(values.categoryId as string));
        if (!category.exists || category.data()?.isActive === false) throw fail(400, 'INVALID_CATEGORY', 'Kategori tidak valid atau tidak aktif.');
        values.category = category.data()?.categoryName || '';
      }
      const nowIso = new Date(clock()).toISOString();
      const after = { ...before, ...values, id: serviceId, updatedAt: nowIso, updatedBy: actor.name };
      const changed = Object.keys(values);
      const log = audit('service', false, before, after, changed, actor, requestIdOf(req), nowIso);
      t.set(ref, after);
      t.create(db.collection('admin_audit_logs').doc(log.id), log);
      return after;
    });
  }

  async function createCategory(req: Request) {
    const uid = await actorFor(req);
    const values = validateCategoryPayload(req.body, true);
    return db.runTransaction(async (t: Transaction) => {
      const actor = await resolveActor(db, t, uid);
      need(actor, ['manageCategories']);
      const id = `cat_${String(values.categoryName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || Math.random().toString(36).slice(2, 10)}`;
      const ref = db.collection('service_categories').doc(id);
      if ((await t.get(ref)).exists) throw fail(409, 'ALREADY_EXISTS', 'Kategori sudah ada.');
      const duplicate = await t.get(db.collection('service_categories'));
      if (duplicate.docs.some((doc: any) => String(doc.data()?.categoryName || '').trim().toLowerCase() === String(values.categoryName).toLowerCase())) {
        throw fail(409, 'DUPLICATE_CATEGORY', 'Nama kategori sudah ada.');
      }
      const nowIso = new Date(clock()).toISOString();
      const record = { ...values, id, categoryId: id, name: values.categoryName,
        activeStatus: values.isActive ? 'ACTIVE' : 'INACTIVE', createdAt: nowIso, updatedAt: nowIso, updatedBy: actor.name };
      const log = audit('service_category', true, {}, record, Object.keys(values), actor, requestIdOf(req), nowIso);
      t.create(ref, record);
      t.create(db.collection('admin_audit_logs').doc(log.id), log);
      return record;
    });
  }

  async function updateCategory(req: Request, categoryId: string) {
    if (!ID.test(categoryId)) throw fail(400, 'INVALID_ID', 'ID kategori tidak valid.');
    const uid = await actorFor(req);
    const values = validateCategoryPayload(req.body, false);
    if (!Object.keys(values).length) throw fail(400, 'INVALID_PAYLOAD', 'Tidak ada field yang diubah.');
    return db.runTransaction(async (t: Transaction) => {
      const actor = await resolveActor(db, t, uid);
      need(actor, requiredPermissions(values, CATEGORY_FIELD_PERMISSION));
      const ref = db.collection('service_categories').doc(categoryId);
      const snap = await t.get(ref);
      if (!snap.exists) throw fail(404, 'NOT_FOUND', 'Kategori tidak ditemukan.');
      const before = snap.data() || {};
      if (values.isActive === false && before.isActive !== false) {
        const linked = await t.get(db.collection('services').where('categoryId', '==', categoryId).limit(1));
        if (linked.docs.some((doc: any) => doc.data()?.isActive !== false)) {
          throw fail(409, 'CATEGORY_IN_USE', 'Kategori masih memiliki layanan aktif dan tidak dapat dinonaktifkan.');
        }
      }
      if (values.categoryName !== undefined) values.name = values.categoryName;
      if (values.isActive !== undefined) values.activeStatus = values.isActive ? 'ACTIVE' : 'INACTIVE';
      const nowIso = new Date(clock()).toISOString();
      const after = { ...before, ...values, id: categoryId, categoryId, updatedAt: nowIso, updatedBy: actor.name };
      const changed = Object.keys(values).filter(key => key !== 'name' && key !== 'activeStatus');
      const log = audit('service_category', false, before, after, changed, actor, requestIdOf(req), nowIso);
      t.set(ref, after);
      t.create(db.collection('admin_audit_logs').doc(log.id), log);
      return after;
    });
  }

  return { listServices: (req: Request) => list('services', req), listCategories: (req: Request) => list('service_categories', req),
    createService, updateService, createCategory, updateCategory };
}

export function registerCatalogApi(app: Express, deps: Dependencies) {
  const api = createCatalogApi(deps);
  const route = (handler: (req: Request, id?: string) => Promise<unknown>, withId = false) =>
    async (req: Request, res: any) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json({ success: true, data: await handler(req, withId ? req.params.id : undefined) });
      } catch (error: any) {
        const safe = error?.catalogError === true && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599;
        res.status(safe ? error.status : 503).json({ success: false,
          code: safe ? error.code : 'CATALOG_UNAVAILABLE',
          message: safe ? error.message : 'Layanan katalog sedang tidak tersedia.' });
      }
    };
  app.get('/api/catalog/services', route(api.listServices));
  app.get('/api/catalog/categories', route(api.listCategories));
  app.post('/api/catalog/services', route(api.createService));
  app.patch('/api/catalog/services/:id', route(api.updateService, true));
  app.post('/api/catalog/categories', route(api.createCategory));
  app.patch('/api/catalog/categories/:id', route(api.updateCategory, true));
}
