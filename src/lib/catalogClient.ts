import { auth } from './firebase';
import type { CatalogPermissions } from './catalogPermissions';
import { catalogErrorMessage } from './catalogPermissions';

type RequestOptions = { method?: string; body?: unknown };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('Sesi login tidak ditemukan.'), { status: 401 });
  const token = await user.getIdToken();
  const method = options.method || 'GET';
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method, cache: 'no-store', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await res.text();
  let json: any = {};
  try { json = JSON.parse(raw); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    throw Object.assign(new Error(catalogErrorMessage({ status: res.status, ...json })), {
      status: res.status, code: json?.code,
    });
  }
  return json?.data as T;
}

export type CatalogSession = { uid: string; staffId: string; role: string; name: string; permissions: CatalogPermissions };
export type CatalogService = Record<string, any> & { id: string; name?: string; price?: number; duration?: number; categoryId?: string; isActive?: boolean };
export type CatalogCategory = Record<string, any> & { id: string; categoryName?: string; isActive?: boolean };
export type CatalogAuditRow = {
  timestamp: string; actorName: string; actorRole: string; entityType: string; entityId: string;
  targetName: string; action: string; changedFields: string[]; oldValues: Record<string, unknown>; newValues: Record<string, unknown>;
};
export type StaffCatalogPermissions = {
  staffId: string; authUid: string; name: string; employeeCode: string; isActive: boolean; permissions: CatalogPermissions;
};

export const catalogApi = {
  session: () => request<CatalogSession>('/api/catalog/session'),
  services: () => request<CatalogService[]>('/api/catalog/services'),
  categories: () => request<CatalogCategory[]>('/api/catalog/categories'),
  audit: () => request<CatalogAuditRow[]>('/api/catalog/audit'),
  createService: (body: Record<string, unknown>) => request<CatalogService>('/api/catalog/services', { method: 'POST', body }),
  updateService: (id: string, body: Record<string, unknown>) =>
    request<CatalogService>(`/api/catalog/services/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  createCategory: (body: Record<string, unknown>) => request<CatalogCategory>('/api/catalog/categories', { method: 'POST', body }),
  updateCategory: (id: string, body: Record<string, unknown>) =>
    request<CatalogCategory>(`/api/catalog/categories/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  staffPermissions: () => request<StaffCatalogPermissions[]>('/api/staff/catalog-permissions'),
  updateStaffPermissions: (staffId: string, body: Record<string, unknown>) =>
    request<StaffCatalogPermissions>(`/api/staff/${encodeURIComponent(staffId)}/catalog-permissions`, { method: 'PATCH', body }),
};
