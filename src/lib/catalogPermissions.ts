// Shared UI metadata for the Phase 25 catalog permissions. The server remains
// the authority; these helpers only decide which controls may be rendered.
export const CATALOG_PERMISSION_KEYS = [
  'view', 'create', 'editInfo', 'editPrice', 'editDuration', 'manageCategories', 'toggleStatus',
] as const;
export type CatalogPermissionKey = (typeof CATALOG_PERMISSION_KEYS)[number];
export type CatalogPermissions = Record<CatalogPermissionKey, boolean>;

export const CATALOG_PERMISSION_INFO: { key: CatalogPermissionKey; label: string; hint: string }[] = [
  { key: 'view', label: 'Lihat katalog', hint: 'Membuka daftar layanan, kategori, dan riwayat perubahan.' },
  { key: 'create', label: 'Tambah layanan', hint: 'Membuat layanan baru melalui backend.' },
  { key: 'editInfo', label: 'Ubah info layanan', hint: 'Nama, deskripsi, kategori, gambar, dan informasi umum.' },
  { key: 'editPrice', label: 'Ubah harga', hint: 'Mengubah harga layanan.' },
  { key: 'editDuration', label: 'Ubah durasi', hint: 'Mengubah durasi layanan.' },
  { key: 'manageCategories', label: 'Kelola kategori', hint: 'Membuat dan mengubah data kategori.' },
  { key: 'toggleStatus', label: 'Aktif / nonaktif', hint: 'Mengubah status aktif layanan atau kategori.' },
];

export const SERVICE_FIELD_PERMISSION: Record<string, CatalogPermissionKey> = {
  name: 'editInfo', description: 'editInfo', shortDescription: 'editInfo', categoryId: 'editInfo',
  imageUrl: 'editInfo', serviceType: 'editInfo', requiredSkillIds: 'editInfo', isPopular: 'editInfo',
  sortOrder: 'editInfo', price: 'editPrice', duration: 'editDuration', isActive: 'toggleStatus',
};
export const CATEGORY_FIELD_PERMISSION: Record<string, CatalogPermissionKey> = {
  categoryName: 'manageCategories', categoryCode: 'manageCategories', description: 'manageCategories',
  sortOrder: 'manageCategories', isActive: 'toggleStatus',
};

export function catalogPermissionsFrom(value: unknown): CatalogPermissions {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return CATALOG_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = raw[key] === true;
    return acc;
  }, {} as CatalogPermissions);
}

export function catalogControls(perms: CatalogPermissions) {
  return {
    canView: perms.view === true,
    canCreate: perms.create === true,
    canEditInfo: perms.editInfo === true,
    canEditPrice: perms.editPrice === true,
    canEditDuration: perms.editDuration === true,
    canManageCategories: perms.manageCategories === true,
    canToggleStatus: perms.toggleStatus === true,
  };
}

export function requiredPermissions(fields: string[], map: Record<string, CatalogPermissionKey>): CatalogPermissionKey[] {
  return [...new Set(fields.map(field => map[field]).filter((key): key is CatalogPermissionKey => !!key))];
}

export function catalogErrorMessage(error: any): string {
  const status = Number(error?.status);
  if (status === 401) return 'Sesi login berakhir. Silakan masuk kembali sebelum mengulang.';
  if (status === 403) return 'Akses ditolak. Permission katalog Anda tidak mencakup operasi ini.';
  if (status === 404) return 'Data tidak ditemukan. Muat ulang katalog sebelum mencoba lagi.';
  if (status === 409) return 'Perubahan ditolak karena konflik data (misalnya kategori masih memiliki layanan aktif).';
  if (status >= 500) return 'Layanan katalog sedang tidak tersedia. Perubahan tidak disimpan.';
  return typeof error?.message === 'string' && error.message
    ? error.message
    : 'Permintaan katalog gagal. Perubahan tidak disimpan.';
}
