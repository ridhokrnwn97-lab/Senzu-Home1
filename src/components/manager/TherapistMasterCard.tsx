import React, { useState, useEffect, useMemo } from 'react';
import {
  UserCheck,
  Plus,
  Edit2,
  Search,
  Phone,
  Mail,
  Building2,
  Sparkles,
  CheckSquare,
  Square,
  AlertCircle,
  CheckCircle2,
  X,
  ExternalLink,
  Shield,
  Save,
  UserX,
  Eye,
  Info,
  Clock,
  DollarSign,
  RefreshCw,
  Award,
} from 'lucide-react';
import { Therapist, ServiceItem, Branch, StaffUser, Booking, TherapistSkill } from '../../types';
import {
  getTherapistMasterList,
  saveTherapistMasterRecord,
  toggleTherapistMasterStatus,
  checkTherapistBookingsBeforeDeactivate,
  getBranches,
  getTherapistSkills,
  DEFAULT_BRANCH_PALEMBANG,
} from '../../lib/masterDataService';
import { getServices } from '../../lib/dbService';
import {
  formatWhatsAppDisplay,
  normalizeWhatsApp,
  normalizeEmail,
  isValidWhatsApp,
  isValidEmail,
  generateNextEmployeeCode,
  getInitialsAvatar,
  getWaMeTarget,
} from '../../lib/masterDataUtils';
import { sanitizeForFirestore } from '../../lib/utils';

interface TherapistMasterCardProps {
  currentUser: StaffUser;
  services?: ServiceItem[];
  branches?: Branch[];
  bookings?: Booking[];
  onRefresh: () => void;
  isReadOnly?: boolean;
}

export const TherapistMasterCard: React.FC<TherapistMasterCardProps> = ({
  currentUser,
  services: initialServices,
  branches: initialBranches,
  bookings = [],
  onRefresh,
  isReadOnly = false,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [servicesList, setServicesList] = useState<ServiceItem[]>(initialServices || []);
  const [skillsList, setSkillsList] = useState<TherapistSkill[]>([]);
  const [branches, setBranches] = useState<Branch[]>(initialBranches || [DEFAULT_BRANCH_PALEMBANG]);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [genderFilter, setGenderFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [serviceSkillFilter, setServiceSkillFilter] = useState<string>('ALL');

  // Modal Add/Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTherapist, setEditingTherapist] = useState<Therapist | null>(null);

  // Detail Modal
  const [detailTherapist, setDetailTherapist] = useState<Therapist | null>(null);

  // Soft Deactivate / Archive Modal State
  const [deactivatingTherapist, setDeactivatingTherapist] = useState<Therapist | null>(null);
  const [deactivateReasonCategory, setDeactivateReasonCategory] = useState<string>('Resign');
  const [deactivateCustomReason, setDeactivateCustomReason] = useState<string>('');
  const [deactivateCheckLoading, setDeactivateCheckLoading] = useState<boolean>(false);
  const [deactivateBookingBlock, setDeactivateBookingBlock] = useState<{
    blocked: boolean;
    reason?: string;
    upcomingCount: number;
  }>({ blocked: false, upcomingCount: 0 });
  const [deactivateError, setDeactivateError] = useState<string>('');

  // Reactivation Modal State
  const [reactivatingTherapist, setReactivatingTherapist] = useState<Therapist | null>(null);
  const [reactivateError, setReactivateError] = useState<string>('');

  // Form State
  const [formData, setFormData] = useState<{
    id: string;
    staffId: string;
    employeeCode: string;
    name: string;
    displayName: string;
    gender: 'Perempuan' | 'Laki-laki';
    phone: string;
    email: string;
    branchId: string;
    branchName: string;
    skillIds: string[];
    serviceIds: string[];
    customerDisplayEnabled: boolean;
    isActive: boolean;
    internalNotes: string;
  }>({
    id: '',
    staffId: '',
    employeeCode: '',
    name: '',
    displayName: '',
    gender: 'Perempuan',
    phone: '',
    email: '',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    skillIds: [],
    serviceIds: [],
    customerDisplayEnabled: true,
    isActive: true,
    internalNotes: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [thData, srvData, brData, skData] = await Promise.all([
        getTherapistMasterList(),
        initialServices && initialServices.length > 0 ? Promise.resolve(initialServices) : getServices(),
        initialBranches && initialBranches.length > 0 ? Promise.resolve(initialBranches) : getBranches(),
        getTherapistSkills(),
      ]);
      setTherapists(thData);
      if (srvData && srvData.length > 0) setServicesList(srvData);
      if (brData && brData.length > 0) setBranches(brData);
      if (skData && skData.length > 0) setSkillsList(skData);
    } catch (err) {
      console.error('Error loading therapist master:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingTherapist(null);
    const suggestedCode = generateNextEmployeeCode(
      'therapist',
      (therapists || []).map((t) => t.employeeCode)
    );
    const newId = `th_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    const defaultBranch = branches[0] || DEFAULT_BRANCH_PALEMBANG;

    // Default select active skills and services
    const defaultSkills = skillsList.filter((s) => s.isActive).slice(0, 3).map((s) => s.id);
    const defaultSelectedServices = servicesList
      .filter((s) => s.isActive !== false)
      .slice(0, 3)
      .map((s) => s.id);

    setFormData({
      id: newId,
      staffId: `staff-${newId}`,
      employeeCode: suggestedCode,
      name: '',
      displayName: '',
      gender: 'Perempuan',
      phone: '',
      email: '',
      branchId: defaultBranch.id,
      branchName: defaultBranch.name,
      skillIds: defaultSkills,
      serviceIds: defaultSelectedServices,
      customerDisplayEnabled: true,
      isActive: true,
      internalNotes: '',
    });
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (th: Therapist) => {
    setEditingTherapist(th);
    setFormData({
      id: th.id,
      staffId: th.staffId || `staff-${th.id}`,
      employeeCode: th.employeeCode || '',
      name: th.name,
      displayName: th.displayName || th.name,
      gender: th.gender || 'Perempuan',
      phone: th.phone ? formatWhatsAppDisplay(th.phone).replace('+62 ', '0') : '',
      email: th.email || '',
      branchId: th.branchId || branches[0]?.id || 'PLG001',
      branchName: th.branchName || branches[0]?.name || 'Senzu Home Palembang R-01',
      skillIds: th.skillIds || [],
      serviceIds: th.serviceIds || [],
      customerDisplayEnabled: th.customerDisplayEnabled !== false,
      isActive: th.isActive !== false,
      internalNotes: th.internalNotes || '',
    });
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleToggleSkill = (skillId: string) => {
    setFormData((prev) => {
      const exists = prev.skillIds.includes(skillId);
      const newSkills = exists
        ? prev.skillIds.filter((id) => id !== skillId)
        : [...prev.skillIds, skillId];
      return { ...prev, skillIds: newSkills };
    });
  };

  const handleAutoSelectServicesBySkills = () => {
    if (formData.skillIds.length === 0) {
      alert('Pilih minimal satu keahlian terapis terlebih dahulu.');
      return;
    }
    // Match services that require any of the therapist's skills
    const qualifiedServices = servicesList
      .filter((s) => s.isActive !== false)
      .filter((s) => {
        if (!s.requiredSkillIds || s.requiredSkillIds.length === 0) return true;
        // Check if at least one or all required skills match
        return s.requiredSkillIds.some((req) => formData.skillIds.includes(req));
      })
      .map((s) => s.id);

    setFormData((prev) => ({
      ...prev,
      serviceIds: Array.from(new Set([...prev.serviceIds, ...qualifiedServices])),
    }));
  };

  const handleToggleServiceSkill = (serviceId: string) => {
    setFormData((prev) => {
      const exists = prev.serviceIds.includes(serviceId);
      const newIds = exists
        ? prev.serviceIds.filter((id) => id !== serviceId)
        : [...prev.serviceIds, serviceId];
      return { ...prev, serviceIds: newIds };
    });
  };

  const handleSelectAllServices = () => {
    const allActiveIds = servicesList.filter((s) => s.isActive !== false).map((s) => s.id);
    setFormData((prev) => ({ ...prev, serviceIds: allActiveIds }));
  };

  const handleClearAllServices = () => {
    setFormData((prev) => ({ ...prev, serviceIds: [] }));
  };

  // 1. INITIATE DEACTIVATE THERAPIST
  const handleInitiateDeactivate = async (th: Therapist) => {
    if (isReadOnly) return;
    setErrorMsg('');
    setDeactivateError('');

    setDeactivatingTherapist(th);
    setDeactivateReasonCategory('Resign');
    setDeactivateCustomReason('');
    setDeactivateBookingBlock({ blocked: false, upcomingCount: 0 });

    // Check active ongoing bookings before deactivating
    setDeactivateCheckLoading(true);
    try {
      const check = await checkTherapistBookingsBeforeDeactivate(th.id, th.name);
      if (!check.canDeactivate) {
        setDeactivateBookingBlock({
          blocked: true,
          reason: check.blockReason,
          upcomingCount: check.upcomingCount,
        });
      } else {
        setDeactivateBookingBlock({
          blocked: false,
          reason: undefined,
          upcomingCount: check.upcomingCount,
        });
      }
    } catch (checkErr) {
      console.warn('Therapist booking check error:', checkErr);
    } finally {
      setDeactivateCheckLoading(false);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivatingTherapist) return;
    if (deactivateBookingBlock.blocked) {
      setDeactivateError(deactivateBookingBlock.reason || 'Terapis masih memiliki layanan aktif.');
      return;
    }

    const finalReason =
      deactivateReasonCategory === 'Lainnya'
        ? deactivateCustomReason.trim() || 'Lainnya'
        : deactivateReasonCategory;

    setSaving(true);
    setDeactivateError('');
    try {
      await toggleTherapistMasterStatus(
        deactivatingTherapist,
        {
          id: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role as 'admin' | 'manager' | 'supervisor',
        },
        finalReason
      );
      setSuccessMsg(
        `Master Terapis "${deactivatingTherapist.name}" (${deactivatingTherapist.employeeCode || deactivatingTherapist.id}) berhasil dinonaktifkan. Seluruh riwayat transaksi tetap tersimpan.`
      );
      setDeactivatingTherapist(null);
      await loadData();
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: any) {
      setDeactivateError(err.message || 'Gagal menonaktifkan terapis.');
    } finally {
      setSaving(false);
    }
  };

  // 2. INITIATE REACTIVATE THERAPIST
  const handleInitiateReactivate = (th: Therapist) => {
    if (isReadOnly) return;
    setErrorMsg('');
    setReactivateError('');
    setReactivatingTherapist(th);
  };

  const handleConfirmReactivate = async () => {
    if (!reactivatingTherapist) return;
    setSaving(true);
    setReactivateError('');
    try {
      await toggleTherapistMasterStatus(reactivatingTherapist, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager' | 'supervisor',
      });
      setSuccessMsg(
        `Master Terapis "${reactivatingTherapist.name}" (${reactivatingTherapist.employeeCode || reactivatingTherapist.id}) berhasil diaktifkan kembali untuk penugasan operasional.`
      );
      setReactivatingTherapist(null);
      await loadData();
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: any) {
      setReactivateError(err.message || 'Gagal mengaktifkan kembali terapis.');
    } finally {
      setSaving(false);
    }
  };

  const validateForm = (): { isValid: boolean; error?: string } => {
    if (!formData.name.trim()) {
      return { isValid: false, error: 'Nama Lengkap Terapis wajib diisi.' };
    }
    if (!formData.gender) {
      return { isValid: false, error: 'Jenis Kelamin (Wanita / Pria) wajib dipilih.' };
    }
    if (!formData.phone.trim() || !isValidWhatsApp(formData.phone)) {
      return {
        isValid: false,
        error: 'Nomor WhatsApp wajib valid format Indonesia (contoh: 08123456789 atau +628123456789).',
      };
    }
    if (formData.email.trim() && !isValidEmail(formData.email)) {
      return { isValid: false, error: 'Format email tidak valid.' };
    }
    if (formData.serviceIds.length === 0) {
      return {
        isValid: false,
        error: 'Pilih minimal satu kualifikasi layanan dari Service Master yang dapat dilakukan oleh terapis ini.',
      };
    }

    // Check Employee Code Uniqueness
    const code = formData.employeeCode.trim().toUpperCase();
    if (code) {
      const duplicateCode = therapists.find(
        (t) => t.id !== formData.id && t.employeeCode?.trim().toUpperCase() === code
      );
      if (duplicateCode) {
        return {
          isValid: false,
          error: `Kode Terapis "${code}" sudah digunakan oleh "${duplicateCode.name}". Gunakan kode unik lain.`,
        };
      }
    }

    // Check WhatsApp Uniqueness across active therapists
    const normalizedPhone = normalizeWhatsApp(formData.phone);
    const duplicatePhone = therapists.find(
      (t) => t.id !== formData.id && t.isActive !== false && t.phone && normalizeWhatsApp(t.phone) === normalizedPhone
    );
    if (duplicatePhone) {
      return {
        isValid: false,
        error: `Nomor WhatsApp sudah digunakan oleh staff lain ("${duplicatePhone.name}").`,
      };
    }

    // Check Email Uniqueness if provided
    if (formData.email.trim()) {
      const normalizedEmail = normalizeEmail(formData.email);
      const duplicateEmail = therapists.find(
        (t) => t.id !== formData.id && t.email && normalizeEmail(t.email) === normalizedEmail
      );
      if (duplicateEmail) {
        return {
          isValid: false,
          error: `Email sudah digunakan oleh staff lain ("${duplicateEmail.name}").`,
        };
      }
    }

    return { isValid: true };
  };

  const handleSaveInternal = async (closeModalAfter: boolean) => {
    if (isReadOnly) return;
    setErrorMsg('');
    setSuccessMsg('');

    const validation = validateForm();
    if (!validation.isValid) {
      setErrorMsg(validation.error || 'Mohon periksa kembali formulir.');
      return;
    }

    setSaving(true);
    try {
      const isNew = !editingTherapist;
      const normalizedPhone = normalizeWhatsApp(formData.phone);

      // Derive readable specialties from selected service titles
      const selectedServiceTitles = servicesList
        .filter((s) => formData.serviceIds.includes(s.id))
        .map((s) => s.name);

      const target: Therapist = {
        id: formData.id,
        staffId: formData.staffId || `staff-${formData.id}`,
        employeeCode: formData.employeeCode.trim().toUpperCase(),
        name: formData.name.trim(),
        displayName: (formData.displayName.trim() || formData.name.trim()),
        gender: formData.gender,
        phone: normalizedPhone,
        email: formData.email.trim()
          ? normalizeEmail(formData.email)
          : `${(formData.id || '').toLowerCase()}@senzuhome.com`,
        branchId: formData.branchId,
        branchName: formData.branchName,
        skillIds: formData.skillIds || [],
        serviceIds: formData.serviceIds,
        specialties: selectedServiceTitles.length > 0 ? selectedServiceTitles : ['Reflexology Keluarga'],
        rating: editingTherapist ? editingTherapist.rating : 5.0,
        totalCompleted: editingTherapist ? editingTherapist.totalCompleted : 0,
        status: editingTherapist ? editingTherapist.status : 'available',
        isActive: formData.isActive,
        customerDisplayEnabled: formData.customerDisplayEnabled,
        internalNotes: formData.internalNotes.trim() ? formData.internalNotes.trim() : '',
      };

      await saveTherapistMasterRecord(
        sanitizeForFirestore(target),
        {
          id: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role as 'admin' | 'manager' | 'supervisor',
        },
        isNew
      );

      setSuccessMsg(
        isNew
          ? `Master Terapis baru "${target.name}" (${target.employeeCode || target.id}) berhasil didaftarkan.`
          : `Data Master Terapis "${target.name}" berhasil diperbarui.`
      );

      await loadData();
      onRefresh();

      if (closeModalAfter) {
        setIsModalOpen(false);
      } else {
        // Quick add another therapist
        const nextCode = generateNextEmployeeCode('therapist', [
          ...(therapists || []).map((t) => t.employeeCode),
          target.employeeCode,
        ]);
        const newId = `th_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
        setFormData({
          id: newId,
          staffId: `staff-${newId}`,
          employeeCode: nextCode,
          name: '',
          displayName: '',
          gender: 'Perempuan',
          phone: '',
          email: '',
          branchId: formData.branchId,
          branchName: formData.branchName,
          skillIds: formData.skillIds,
          serviceIds: formData.serviceIds, // retain service skills for fast input
          customerDisplayEnabled: true,
          isActive: true,
          internalNotes: '',
        });
      }
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      console.error('Save therapist error:', err);
      if (err instanceof Error) {
        if (
          err.message.includes('Function setDoc') ||
          err.message.includes('Unsupported field value') ||
          err.message.includes('FirebaseError') ||
          err.message.includes('undefined')
        ) {
          setErrorMsg('Data staff belum berhasil disimpan. Silakan periksa data dan coba lagi.');
        } else {
          setErrorMsg(err.message || 'Data staff belum berhasil disimpan. Silakan periksa data dan coba lagi.');
        }
      } else {
        setErrorMsg('Data staff belum berhasil disimpan. Silakan periksa data dan coba lagi.');
      }
    } finally {
      setSaving(false);
    }
  };

  // Filtered Therapists
  const filteredTherapists = useMemo(() => {
    return therapists.filter((th) => {
      // Gender
      if (genderFilter !== 'ALL' && th.gender !== genderFilter) return false;
      // Status
      if (statusFilter === 'ACTIVE' && th.isActive === false) return false;
      if (statusFilter === 'INACTIVE' && th.isActive !== false) return false;
      // Branch
      if (branchFilter !== 'ALL' && th.branchId !== branchFilter) return false;
      // Service Skill Filter
      if (serviceSkillFilter !== 'ALL') {
        const hasSkill = th.serviceIds && th.serviceIds.includes(serviceSkillFilter);
        if (!hasSkill) return false;
      }
      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (th.name || '').toLowerCase().includes(q);
        const matchDisplay = (th.displayName || '').toLowerCase().includes(q);
        const matchCode = (th.employeeCode || '').toLowerCase().includes(q);
        const matchPhone = (th.phone || '').includes(q);
        const matchEmail = (th.email || '').toLowerCase().includes(q);
        const matchSpecialty = (th.specialties || []).some((s) => (s || '').toLowerCase().includes(q));
        if (!matchName && !matchDisplay && !matchCode && !matchPhone && !matchEmail && !matchSpecialty) {
          return false;
        }
      }
      return true;
    });
  }, [therapists, genderFilter, statusFilter, branchFilter, serviceSkillFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = therapists.length;
    const active = therapists.filter((t) => t.isActive !== false).length;
    const inactive = total - active;
    const female = therapists.filter((t) => t.gender === 'Perempuan' && t.isActive !== false).length;
    const male = therapists.filter((t) => t.gender === 'Laki-laki' && t.isActive !== false).length;
    const fullSkills = therapists.filter(
      (t) => t.serviceIds && t.serviceIds.length >= servicesList.length && t.isActive !== false
    ).length;
    return { total, active, inactive, female, male, fullSkills };
  }, [therapists, servicesList]);

  // Helper to map serviceIds to service items
  const getQualifiedServices = (serviceIds?: string[]): ServiceItem[] => {
    if (!serviceIds || serviceIds.length === 0) return [];
    return servicesList.filter((s) => serviceIds.includes(s.id));
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">
        <div className="inline-block animate-spin w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full mb-2"></div>
        <p className="text-sm">Memuat Master Data Terapis...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50/50 via-white to-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-600/10 text-amber-800 flex items-center justify-center font-bold">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-900">Master Data Terapis</h3>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                {therapists.length} Terapis Terdaftar
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Single Source of Truth profil terapis, kualifikasi layanan dari Service Master, dan kelayakan penugasan di Control Room
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            title="Muat Ulang Data"
            className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" />
              Tambah Terapis Baru
            </button>
          )}
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-4 bg-slate-50/60 border-b border-slate-100 text-xs">
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-slate-500 text-[11px]">Total Terapis</span>
          <span className="text-base font-bold text-slate-900">{stats.total}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-emerald-700 text-[11px] font-medium">Terapis Aktif</span>
          <span className="text-base font-bold text-emerald-800">{stats.active}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-slate-500 text-[11px]">Non-Aktif</span>
          <span className="text-base font-bold text-slate-600">{stats.inactive}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-pink-700 text-[11px] font-medium">Terapis Wanita</span>
          <span className="text-base font-bold text-pink-800">{stats.female}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-blue-700 text-[11px] font-medium">Terapis Pria</span>
          <span className="text-base font-bold text-blue-800">{stats.male}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-amber-700 text-[11px] font-medium">Kualifikasi Penuh</span>
          <span className="text-base font-bold text-amber-800">{stats.fullSkills}</span>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2 animate-fadeIn">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari nama, kode terapis, WhatsApp, keahlian..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 bg-slate-50/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Gender Filter */}
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          >
            <option value="ALL">Semua Gender</option>
            <option value="Perempuan">Wanita Saja</option>
            <option value="Laki-laki">Pria Saja</option>
          </select>

          {/* Service / Skill Filter from Service Master */}
          <select
            value={serviceSkillFilter}
            onChange={(e) => setServiceSkillFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 max-w-[200px]"
          >
            <option value="ALL">Semua Kualifikasi Layanan</option>
            {(servicesList || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          >
            <option value="ALL">Semua Status</option>
            <option value="ACTIVE">Aktif Saja</option>
            <option value="INACTIVE">Non-Aktif Saja</option>
          </select>
        </div>
      </div>

      {/* Therapist Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="bg-slate-50/80 text-slate-700 font-semibold border-b border-slate-200 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="py-3 px-4">Identitas Terapis</th>
              <th className="py-3 px-4">Gender</th>
              <th className="py-3 px-4">Kontak WhatsApp</th>
              <th className="py-3 px-4">Kualifikasi Layanan (Service Master)</th>
              <th className="py-3 px-4">Status Operasional</th>
              <th className="py-3 px-4">Status Master</th>
              <th className="py-3 px-4 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTherapists.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <UserCheck className="w-8 h-8 text-slate-300 stroke-[1.5]" />
                    <p className="font-medium text-slate-600">Tidak ada terapis yang sesuai</p>
                    <p className="text-[11px] text-slate-400">
                      Coba sesuaikan kata kunci pencarian atau filter layanan
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              (filteredTherapists || []).map((th) => {
                const qualifiedServices = getQualifiedServices(th.serviceIds);
                const isComplete =
                  th.name &&
                  th.gender &&
                  th.phone &&
                  th.serviceIds &&
                  th.serviceIds.length > 0;

                return (
                  <tr
                    key={th.id}
                    className={`hover:bg-amber-50/20 transition ${
                      th.isActive === false ? 'bg-slate-50/60 opacity-75' : ''
                    }`}
                  >
                    {/* Identity */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                            th.gender === 'Perempuan'
                              ? 'bg-pink-100 text-pink-900 border border-pink-200'
                              : 'bg-blue-100 text-blue-900 border border-blue-200'
                          }`}
                        >
                          {getInitialsAvatar(th.name)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900 text-xs">{th.name}</span>
                            {th.customerDisplayEnabled === false && (
                              <span
                                title="Tidak ditampilkan di katalog pelanggan"
                                className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-200 text-slate-600"
                              >
                                Hidden
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            {th.employeeCode && (
                              <span className="font-mono font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.2 rounded text-[10px]">
                                {th.employeeCode}
                              </span>
                            )}
                            {th.displayName && th.displayName !== th.name && (
                              <span>• Display: &quot;{th.displayName}&quot;</span>
                            )}
                            <span>• {th.branchName || 'Palembang R-01'}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Gender */}
                    <td className="py-3 px-4">
                      {th.gender === 'Perempuan' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-pink-50 text-pink-700 border border-pink-200">
                          Wanita
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          Pria
                        </span>
                      )}
                    </td>

                    {/* WhatsApp */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 text-slate-700">
                        <Phone className="w-3 h-3 text-emerald-600 shrink-0" />
                        <span className="font-medium font-mono text-[11px]">
                          {formatWhatsAppDisplay(th.phone || '')}
                        </span>
                        {th.phone && (
                          <a
                            href={`https://wa.me/${getWaMeTarget(th.phone)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Chat WhatsApp Terapis"
                            className="text-emerald-600 hover:text-emerald-700 inline-flex items-center"
                          >
                            <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                          </a>
                        )}
                      </div>
                    </td>

                    {/* Service Skills Badges */}
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1 max-w-[280px]">
                        {qualifiedServices.length > 0 ? (
                          <>
                            {qualifiedServices.slice(0, 2).map((s) => (
                              <span
                                key={s.id}
                                className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-200/80 truncate max-w-[130px]"
                                title={s.name}
                              >
                                {s.name}
                              </span>
                            ))}
                            {qualifiedServices.length > 2 && (
                              <span
                                className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 cursor-pointer"
                                title={(qualifiedServices || []).map((s) => s.name).join(', ')}
                                onClick={() => setDetailTherapist(th)}
                              >
                                +{qualifiedServices.length - 2} lagi
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-amber-600 italic font-medium flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Belum Ada Layanan
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Operational Status in Control Room */}
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          th.status === 'available'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : th.status === 'busy' || th.status === 'on_duty'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            th.status === 'available'
                              ? 'bg-emerald-500'
                              : th.status === 'busy' || th.status === 'on_duty'
                              ? 'bg-amber-500'
                              : 'bg-slate-400'
                          }`}
                        ></span>
                        {th.status === 'available'
                          ? 'Available'
                          : th.status === 'busy' || th.status === 'on_duty'
                          ? 'On Duty'
                          : th.status === 'break'
                          ? 'Break'
                          : 'Off / Shift Selesai'}
                      </span>
                    </td>

                    {/* Active Status */}
                    <td className="py-3 px-4">
                      {th.isActive !== false ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                          AKTIF
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          NONAKTIF / ARSIP
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailTherapist(th)}
                          title="Lihat Detail Profil & Skill Layanan"
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {!isReadOnly && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(th)}
                              title="Edit Profil & Kualifikasi Layanan"
                              className="p-1.5 rounded-lg border border-slate-200 text-amber-800 hover:bg-amber-50 transition cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => {
                                if (th.isActive !== false) {
                                  handleInitiateDeactivate(th);
                                } else {
                                  handleInitiateReactivate(th);
                                }
                              }}
                              title={
                                th.isActive !== false
                                  ? 'Nonaktifkan Terapis'
                                  : 'Aktifkan Kembali Terapis'
                              }
                              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                th.isActive !== false
                                  ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                                  : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              {th.isActive !== false ? (
                                <UserX className="w-3.5 h-3.5" />
                              ) : (
                                <UserCheck className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 gap-2">
        <div className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-amber-700" />
          <span>
            Hanya Manager & Admin yang berhak menentukan kualifikasi layanan terapis. Supervisor membaca data ini untuk validasi penugasan.
          </span>
        </div>
        <div>
          Menampilkan <span className="font-semibold text-slate-700">{filteredTherapists.length}</span> dari{' '}
          <span className="font-semibold text-slate-700">{therapists.length}</span> total terapis
        </div>
      </div>

      {/* MODAL: ADD / EDIT THERAPIST */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div>
                <h4 className="text-base font-bold text-slate-900">
                  {editingTherapist ? 'Edit Master Terapis' : 'Tambah Master Terapis Baru'}
                </h4>
                <p className="text-xs text-slate-500">
                  {editingTherapist
                    ? `Kelola kualifikasi layanan dan profil ${editingTherapist.name}`
                    : 'Daftarkan terapis baru beserta kualifikasi layanan dari Service Master'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveInternal(true);
              }}
              className="space-y-4 text-xs"
            >
              {/* Employee Code & Gender */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kode Terapis <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.employeeCode}
                    onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value.toUpperCase() })}
                    placeholder="Contoh: TRP001"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Kode unik identitas terapis</p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Jenis Kelamin (Gender) <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, gender: 'Perempuan' })}
                      className={`py-2 px-3 rounded-xl border text-center font-medium text-xs transition cursor-pointer ${
                        formData.gender === 'Perempuan'
                          ? 'border-pink-500 bg-pink-50 text-pink-900 font-bold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Wanita
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, gender: 'Laki-laki' })}
                      className={`py-2 px-3 rounded-xl border text-center font-medium text-xs transition cursor-pointer ${
                        formData.gender === 'Laki-laki'
                          ? 'border-blue-500 bg-blue-50 text-blue-900 font-bold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Pria
                    </button>
                  </div>
                </div>
              </div>

              {/* Full Name & Display Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nama Lengkap (KTP) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Contoh: Rina Anggraini"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nama Panggilan (Display)
                  </label>
                  <input
                    type="text"
                    value={formData.displayName}
                    onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                    placeholder="Contoh: Rina A."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Nama ramah yang dilihat oleh pelanggan</p>
                </div>
              </div>

              {/* WhatsApp & Cabang */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nomor WhatsApp Resmi <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="Contoh: 081273445501"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Cabang Home Base <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.branchId}
                    onChange={(e) => {
                      const sel = branches.find((b) => b.id === e.target.value);
                      setFormData({
                        ...formData,
                        branchId: e.target.value,
                        branchName: sel ? sel.name : formData.branchName,
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 bg-white"
                  >
                    {(branches || []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.city})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Master Keahlian & Sertifikasi Terapis */}
              <div className="pt-2 p-3 bg-blue-50/50 rounded-xl border border-blue-200">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <label className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-blue-700" />
                      Keahlian &amp; Sertifikasi Terapis 
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Pilih keahlian resmi yang dikuasai terapis berdasarkan standar SOP Senzu Home.
                    </p>
                  </div>
                  {skillsList.length > 0 && (
                    <button
                      type="button"
                      onClick={handleAutoSelectServicesBySkills}
                      className="px-2 py-1 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                      title="Otomatis pilih layanan yang memerlukan keahlian terpilih di bawah"
                    >
                      <Sparkles className="w-3 h-3" />
                      Auto-Pilih Layanan
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2 max-h-36 overflow-y-auto">
                  {skillsList.length === 0 ? (
                    <div className="col-span-2 text-center py-2 text-slate-400 text-xs">
                      Belum ada master keahlian terapis terdaftar.
                    </div>
                  ) : (
                    (skillsList || []).map((sk) => {
                      const isChecked = formData.skillIds.includes(sk.id);
                      return (
                        <div
                          key={sk.id}
                          onClick={() => handleToggleSkill(sk.id)}
                          className={`p-2 rounded-lg border flex items-center justify-between cursor-pointer transition ${
                            isChecked
                              ? 'bg-blue-50 border-blue-400 text-blue-900 font-semibold'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <span className="text-[11px] leading-tight">
                            {sk.skillName} {!sk.isActive ? '(Nonaktif)' : ''}
                          </span>
                          {isChecked ? (
                            <CheckSquare className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Service Master Qualification Matrix (CRITICAL PROMPT 15C RULE) */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <label className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                      Kualifikasi Layanan (Service Master Prompt 15A) <span className="text-rose-500">*</span>
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Tentukan layanan apa saja yang kompeten dilakukan oleh terapis ini. Supervisor hanya dapat menugaskan order sesuai kualifikasi ini.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAllServices}
                      className="text-[11px] text-amber-800 hover:underline font-semibold cursor-pointer"
                    >
                      Pilih Semua
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={handleClearAllServices}
                      className="text-[11px] text-slate-500 hover:underline font-semibold cursor-pointer"
                    >
                      Hapus
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200 space-y-2 max-h-48 overflow-y-auto">
                  {servicesList.length === 0 ? (
                    <p className="text-slate-400 text-center py-2">Belum ada layanan di Service Master.</p>
                  ) : (
                    (servicesList || []).map((service) => {
                      const isSelected = formData.serviceIds.includes(service.id);
                      return (
                        <div
                          key={service.id}
                          onClick={() => handleToggleServiceSkill(service.id)}
                          className={`p-2 rounded-lg border flex items-center justify-between cursor-pointer transition ${
                            isSelected
                              ? 'bg-amber-50/80 border-amber-300 text-slate-900 shadow-2xs'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100/50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-amber-700 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <div>
                              <span className="font-bold text-xs block">{service.name}</span>
                              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                <span className="flex items-center gap-0.5">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  {service.duration} menit
                                </span>
                                <span>•</span>
                                <span className="font-mono">
                                  Rp {service.price.toLocaleString('id-ID')}
                                </span>
                              </div>
                            </div>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isSelected
                                ? 'bg-amber-200/80 text-amber-900'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {isSelected ? 'Kompeten' : 'Tidak'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                  <span>
                    Terpilih: <strong className="text-amber-900 font-bold">{formData.serviceIds.length}</strong>{' '}
                    dari {servicesList.length} layanan
                  </span>
                  {formData.serviceIds.length === 0 && (
                    <span className="text-rose-600 font-medium">Wajib memilih minimal 1 layanan!</span>
                  )}
                </div>
              </div>

              {/* Customer Display Checkbox */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800 block text-xs">
                    Tampilkan di Katalog Pelanggan
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Bila aktif, foto dan profil terapis dapat dilihat pelanggan saat memilih preferensi
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.customerDisplayEnabled}
                    onChange={(e) => setFormData({ ...formData, customerDisplayEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>

              {/* Active Status Checkbox */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800 block text-xs">Status Master Terapis</span>
                  <span className="text-[11px] text-slate-500">
                    {formData.isActive
                      ? 'Terapis aktif dan dapat dijadwalkan oleh Supervisor'
                      : 'Terapis non-aktif dan disembunyikan dari penugasan harian'}
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Internal Notes */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Catatan Internal Terapis</label>
                <textarea
                  rows={2}
                  value={formData.internalNotes}
                  onChange={(e) => setFormData({ ...formData, internalNotes: e.target.value })}
                  placeholder="Catatan sertifikasi pijat, preferensi area rute, atau riwayat kerja..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                {!editingTherapist && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleSaveInternal(false)}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold border border-slate-200 transition cursor-pointer"
                  >
                    Simpan & Tambah Baru
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full sm:w-auto px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{editingTherapist ? 'Simpan Perubahan' : 'Daftarkan Terapis'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL THERAPIST & QUALIFICATION MATRIX */}
      {detailTherapist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm ${
                    detailTherapist.gender === 'Perempuan'
                      ? 'bg-pink-100 text-pink-900'
                      : 'bg-blue-100 text-blue-900'
                  }`}
                >
                  {getInitialsAvatar(detailTherapist.name)}
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">{detailTherapist.name}</h4>
                  <p className="text-xs text-slate-500 font-mono">
                    {detailTherapist.employeeCode || detailTherapist.id}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailTherapist(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-500 block text-[11px]">Jenis Kelamin:</span>
                  <span className="font-bold text-slate-800">{detailTherapist.gender}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-500 block text-[11px]">Cabang:</span>
                  <span className="font-bold text-slate-800">
                    {detailTherapist.branchName || 'Palembang R-01'}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Nomor WhatsApp:</span>
                  <a
                    href={`https://wa.me/${getWaMeTarget(detailTherapist.phone || '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono font-bold text-emerald-700 hover:underline flex items-center gap-1"
                  >
                    {formatWhatsAppDisplay(detailTherapist.phone || '')}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Rating & Jam Terbang:</span>
                  <span className="font-semibold text-slate-800">
                    ★ {detailTherapist.rating || 5.0} ({detailTherapist.totalCompleted || 0} order selesai)
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Status Master:</span>
                  <span
                    className={`font-bold px-2 py-0.5 rounded-full text-[11px] ${
                      detailTherapist.isActive !== false
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {detailTherapist.isActive !== false ? 'AKTIF' : 'NON-AKTIF'}
                  </span>
                </div>
              </div>

              {/* Master Keahlian & Sertifikasi */}
              <div>
                <span className="font-bold text-slate-900 block mb-1.5 flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-blue-700" />
                  Keahlian &amp; Sertifikasi Terapis :
                </span>
                <div className="flex flex-wrap gap-1.5 p-2.5 bg-blue-50/50 rounded-xl border border-blue-200">
                  {(!detailTherapist.skillIds || detailTherapist.skillIds.length === 0) ? (
                    <span className="text-slate-400 italic text-[11px]">Belum ada keahlian terapis yang ditandai.</span>
                  ) : (
                    (detailTherapist.skillIds || []).map((skId) => {
                      const skl = skillsList.find((s) => s.id === skId);
                      return (
                        <span
                          key={skId}
                          className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 inline-flex items-center gap-1"
                        >
                          <Award className="w-2.5 h-2.5 text-blue-600" />
                          {skl?.skillName || skId}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Skills Matrix */}
              <div>
                <span className="font-bold text-slate-900 block mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  Kualifikasi Layanan Terdaftar ({(getQualifiedServices(detailTherapist.serviceIds) || []).length} Layanan):
                </span>
                <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-200/80 space-y-1.5 max-h-48 overflow-y-auto">
                  {(getQualifiedServices(detailTherapist.serviceIds) || []).length === 0 ? (
                    <p className="text-slate-400 italic">Belum ada kualifikasi layanan yang dipilih.</p>
                  ) : (
                    (getQualifiedServices(detailTherapist.serviceIds) || []).map((s) => (
                      <div
                        key={s.id}
                        className="p-2 rounded-lg bg-white border border-amber-200 flex items-center justify-between"
                      >
                        <div className="font-semibold text-slate-800">{s.name}</div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span>{s.duration} menit</span>
                          <span>•</span>
                          <span className="font-mono">Rp {s.price.toLocaleString('id-ID')}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {detailTherapist.internalNotes && (
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="font-semibold text-slate-700 block mb-0.5">Catatan Internal:</span>
                  <p className="text-slate-600">{detailTherapist.internalNotes}</p>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end gap-2">
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => {
                    const th = detailTherapist;
                    setDetailTherapist(null);
                    handleOpenEdit(th);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit Terapis
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetailTherapist(null)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL NONAKTIFKAN TERAPIS (SOFT DELETE / ARCHIVE) */}
      {deactivatingTherapist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-scaleUp">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <UserX className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900">
                  Konfirmasi Penonaktifan Terapis
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Arsipkan terapis tanpa menghapus riwayat komisi dan layanan
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeactivatingTherapist(null)}
                disabled={saving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Therapist Summary Card */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Nama Terapis:</span>
                <span className="font-bold text-slate-900">{deactivatingTherapist.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Kode Staf / Terapis:</span>
                <span className="font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {deactivatingTherapist.employeeCode || deactivatingTherapist.id}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Jenis Kelamin:</span>
                <span className="font-medium text-slate-700">{deactivatingTherapist.gender}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Cabang:</span>
                <span className="font-medium text-slate-700">{deactivatingTherapist.branchName || 'Palembang'}</span>
              </div>
            </div>

            {/* Soft Delete Notice */}
            <div className="mt-3 p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" />
              <div className="space-y-1 text-[11px] leading-relaxed">
                <p className="font-semibold text-amber-950">Aman & Terarsip:</p>
                <p>
                  Terapis yang dinonaktifkan tidak dapat menerima penugasan baru dari Supervisor,
                  namun seluruh riwayat order, komisi, dan rating tetap tersimpan permanen.
                </p>
              </div>
            </div>

            {/* Active Booking Check Status */}
            {deactivateCheckLoading && (
              <div className="mt-3 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                <span>Memeriksa status jadwal & order aktif terapis...</span>
              </div>
            )}

            {deactivateBookingBlock.blocked && (
              <div className="mt-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-rose-950">Penonaktifan Tidak Diizinkan:</p>
                  <p className="text-[11px] leading-relaxed text-rose-800">
                    {deactivateBookingBlock.reason}
                  </p>
                  <p className="text-[10px] text-rose-700 italic">
                    Selesaikan atau serah-terimakan layanan yang sedang berlangsung terlebih dahulu.
                  </p>
                </div>
              </div>
            )}

            {!deactivateBookingBlock.blocked && deactivateBookingBlock.upcomingCount > 0 && (
              <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <span className="font-bold">Perhatian: </span>
                  Terapis ini memiliki {deactivateBookingBlock.upcomingCount} order mendatang.
                  Pastikan Supervisor segera menugaskan ulang jadwal tersebut ke terapis lain.
                </div>
              </div>
            )}

            {/* Deactivation Reason Form */}
            <div className="mt-4 space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Alasan Penonaktifan:
              </label>
              <select
                value={deactivateReasonCategory}
                onChange={(e) => setDeactivateReasonCategory(e.target.value)}
                disabled={saving || deactivateBookingBlock.blocked}
                className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600"
              >
                <option value="Resign">Resign / Mengundurkan Diri</option>
                <option value="Kontrak Berakhir">Kontrak Berakhir</option>
                <option value="Mutasi">Mutasi / Pindah Cabang</option>
                <option value="Nonaktif Sementara">Nonaktif Sementara (Cuti Panjang)</option>
                <option value="Lainnya">Lainnya (Tuliskan secara spesifik)</option>
              </select>

              {deactivateReasonCategory === 'Lainnya' && (
                <input
                  type="text"
                  placeholder="Ketikkan alasan penonaktifan..."
                  value={deactivateCustomReason}
                  onChange={(e) => setDeactivateCustomReason(e.target.value)}
                  disabled={saving || deactivateBookingBlock.blocked}
                  className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600"
                />
              )}
            </div>

            {/* Error Message */}
            {deactivateError && (
              <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{deactivateError}</span>
              </div>
            )}

            {/* Modal Actions */}
            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeactivatingTherapist(null)}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeactivate}
                disabled={saving || deactivateCheckLoading || deactivateBookingBlock.blocked}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                  saving || deactivateCheckLoading || deactivateBookingBlock.blocked
                    ? 'bg-rose-300 cursor-not-allowed'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Menonaktifkan...
                  </>
                ) : (
                  <>
                    <UserX className="w-3.5 h-3.5" />
                    Nonaktifkan Terapis
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL AKTIFKAN KEMBALI TERAPIS (REACTIVATION) */}
      {reactivatingTherapist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-scaleUp">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900">
                  Aktifkan Kembali Terapis?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pulihkan ketersediaan terapis untuk penugasan operasional
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReactivatingTherapist(null)}
                disabled={saving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Therapist Summary Card */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Nama Terapis:</span>
                <span className="font-bold text-slate-900">{reactivatingTherapist.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Kode Staf / Terapis:</span>
                <span className="font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {reactivatingTherapist.employeeCode || reactivatingTherapist.id}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Jenis Kelamin:</span>
                <span className="font-medium text-slate-700">{reactivatingTherapist.gender}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Cabang:</span>
                <span className="font-medium text-slate-700">{reactivatingTherapist.branchName || 'Palembang'}</span>
              </div>
            </div>

            {/* Reactivation Notice */}
            <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
              <div className="space-y-1 text-[11px] leading-relaxed">
                <p className="font-semibold text-emerald-950">Ketersediaan Dipulihkan:</p>
                <p>
                  Terapis akan kembali aktif (Available) dan dapat ditugaskan pada order layanan.
                  Seluruh keahlian layanan (skills) dan data transaksi sebelumnya tetap terhubung.
                </p>
              </div>
            </div>

            {/* Error Message */}
            {reactivateError && (
              <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{reactivateError}</span>
              </div>
            )}

            {/* Modal Actions */}
            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setReactivatingTherapist(null)}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmReactivate}
                disabled={saving}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                  saving
                    ? 'bg-emerald-300 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Mengaktifkan...
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5" />
                    Aktifkan Kembali Terapis
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
