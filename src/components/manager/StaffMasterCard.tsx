import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  CheckCircle2,
  AlertCircle,
  Save,
  Edit2,
  UserX,
  UserCheck,
  Search,
  Phone,
  Mail,
  Building2,
  Eye,
  X,
  ExternalLink,
  Info,
  RefreshCw,
  KeyRound,
  Send,
  Lock,
  Unlock,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { StaffUser, UserRole, Branch, Booking, Therapist, TherapistSkill } from '../../types';
import {
  getStaffMasterUsers,
  saveStaffMasterUser,
  toggleStaffMasterStatus,
  checkTherapistBookingsBeforeDeactivate,
  getBranches,
  DEFAULT_BRANCH_PALEMBANG,
  getActiveTherapistSkills,
  getTherapistMasterList,
  DEFAULT_THERAPIST_SKILLS,
} from '../../lib/masterDataService';
import {
  formatWhatsAppDisplay,
  normalizeWhatsApp,
  normalizeEmail,
  isValidWhatsApp,
  isValidEmail,
  generateNextEmployeeCode,
  getRoleDisplayLabel,
  getInitialsAvatar,
  getWaMeTarget,
  STAFF_ROLE_LABELS,
} from '../../lib/masterDataUtils';
import { sanitizeForFirestore } from '../../lib/utils';
import { ProvisionAccountModal } from './ProvisionAccountModal';
import {
  sendStaffPasswordReset,
  disableStaffLoginAccount,
  enableStaffLoginAccount,
} from '../../lib/staffAuthService';

interface StaffMasterCardProps {
  currentUser: StaffUser;
  branches?: Branch[];
  bookings?: Booking[];
  onRefresh: () => void;
  isReadOnly?: boolean;
}

export const StaffMasterCard: React.FC<StaffMasterCardProps> = ({
  currentUser,
  branches: initialBranches,
  bookings = [],
  onRefresh,
  isReadOnly = false,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>(initialBranches || [DEFAULT_BRANCH_PALEMBANG]);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Filters and Search
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');

  // Modal Add / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffUser | null>(null);

  // Detail View Drawer
  const [detailStaff, setDetailStaff] = useState<StaffUser | null>(null);

  // Soft Deactivate / Archive Modal State
  const [deactivatingStaff, setDeactivatingStaff] = useState<StaffUser | null>(null);
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
  const [reactivatingStaff, setReactivatingStaff] = useState<StaffUser | null>(null);
  const [reactivateError, setReactivateError] = useState<string>('');

  // Auth Provisioning Modal (Prompt 15E)
  const [provisioningStaff, setProvisioningStaff] = useState<StaffUser | null>(null);
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [authActionLoadingId, setAuthActionLoadingId] = useState<string | null>(null);

  const handleOpenProvision = (staff: StaffUser) => {
    setProvisioningStaff(staff);
    setIsProvisionModalOpen(true);
  };

  const handleSendResetLink = async (staff: StaffUser) => {
    if (!staff.email) {
      setErrorMsg('Staf ini belum memiliki email resmi.');
      return;
    }
    const confirmed = window.confirm(
      `Kirimkan tautan reset kata sandi resmi ke email ${staff.email} untuk ${staff.name}?`
    );
    if (!confirmed) return;

    setAuthActionLoadingId(staff.uid);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await sendStaffPasswordReset(staff, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager',
      });
      setSuccessMsg(res.message);
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengirim link reset kata sandi.');
    } finally {
      setAuthActionLoadingId(null);
    }
  };

  const handleToggleLoginStatus = async (staff: StaffUser) => {
    const isCurrentlyDisabled =
      staff.isActive === false || staff.loginAccountStatus === 'DINONAKTIFKAN';

    setAuthActionLoadingId(staff.uid);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (isCurrentlyDisabled) {
        const res = await enableStaffLoginAccount(staff, {
          id: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role as 'admin' | 'manager',
        });
        setSuccessMsg(res.message);
      } else {
        const res = await disableStaffLoginAccount(
          staff,
          {
            id: currentUser.uid,
            name: currentUser.name,
            role: currentUser.role as 'admin' | 'manager',
          },
          staffList,
          bookings
        );
        setSuccessMsg(res.message);
      }
      loadData();
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengubah status akun staf.');
    } finally {
      setAuthActionLoadingId(null);
    }
  };

  // Form State
  const [formData, setFormData] = useState<{
    uid: string;
    employeeCode: string;
    name: string;
    displayName: string;
    email: string;
    phone: string;
    role: UserRole;
    gender: 'Perempuan' | 'Laki-laki' | '';
    branchId: string;
    branchName: string;
    isActive: boolean;
    internalNotes: string;
    skillIds: string[];
  }>({
    uid: '',
    employeeCode: '',
    name: '',
    displayName: '',
    email: '',
    phone: '',
    role: 'css',
    gender: '',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    isActive: true,
    internalNotes: '',
    skillIds: [],
  });

  const [availableSkills, setAvailableSkills] = useState<TherapistSkill[]>(DEFAULT_THERAPIST_SKILLS);
  const [therapistMap, setTherapistMap] = useState<Record<string, Therapist>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [staffData, branchData, skillsData, therapistsData] = await Promise.all([
        getStaffMasterUsers(),
        initialBranches && initialBranches.length > 0 ? Promise.resolve(initialBranches) : getBranches(),
        getActiveTherapistSkills().catch(() => DEFAULT_THERAPIST_SKILLS),
        getTherapistMasterList().catch(() => []),
      ]);
      setStaffList(staffData);
      if (branchData && branchData.length > 0) {
        setBranches(branchData);
      }
      setAvailableSkills(skillsData && skillsData.length > 0 ? skillsData : DEFAULT_THERAPIST_SKILLS);
      const tMap: Record<string, Therapist> = {};
      (therapistsData || []).forEach((t) => {
        if (t.staffId) tMap[t.staffId] = t;
        if (t.id) tMap[t.id] = t;
      });
      setTherapistMap(tMap);
    } catch (err) {
      console.error('Error loading staff master:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingStaff(null);
    const suggestedRole: UserRole = 'css';
    const suggestedCode = generateNextEmployeeCode(
      suggestedRole,
      (staffList || []).map((s) => s.employeeCode)
    );
    const defaultBranch = branches[0] || DEFAULT_BRANCH_PALEMBANG;

    setFormData({
      uid: `staff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      employeeCode: suggestedCode,
      name: '',
      displayName: '',
      email: '',
      phone: '',
      role: suggestedRole,
      gender: '',
      branchId: defaultBranch.id,
      branchName: defaultBranch.name,
      isActive: true,
      internalNotes: '',
      skillIds: [],
    });
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (st: StaffUser) => {
    setEditingStaff(st);
    const th = therapistMap[st.uid] || (st.therapistId ? therapistMap[st.therapistId] : undefined);
    setFormData({
      uid: st.uid,
      employeeCode: st.employeeCode || '',
      name: st.name,
      displayName: st.displayName || st.name,
      email: st.email,
      phone: st.phone ? formatWhatsAppDisplay(st.phone).replace('+62 ', '0') : '',
      role: st.role,
      gender: (st.gender as 'Perempuan' | 'Laki-laki') || '',
      branchId: st.branchId || branches[0]?.id || 'PLG001',
      branchName: st.branchName || branches[0]?.name || 'Senzu Home Palembang R-01',
      isActive: st.isActive !== false,
      internalNotes: st.internalNotes || '',
      skillIds: th?.skillIds || (st as any).skillIds || [],
    });
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleRoleChange = (newRole: UserRole) => {
    const isNew = !editingStaff;
    let newCode = formData.employeeCode;
    if (isNew) {
      newCode = generateNextEmployeeCode(
        newRole,
        (staffList || []).map((s) => s.employeeCode)
      );
    }
    setFormData((prev) => ({
      ...prev,
      role: newRole,
      employeeCode: newCode,
      gender: newRole === 'therapist' && !prev.gender ? 'Perempuan' : prev.gender,
    }));
  };

  const handleBranchChange = (branchId: string) => {
    const selected = branches.find((b) => b.id === branchId);
    setFormData((prev) => ({
      ...prev,
      branchId,
      branchName: selected ? selected.name : prev.branchName,
    }));
  };

  // 1. INITIATE DEACTIVATION (Prompt 18D & Soft Delete Architecture)
  const handleInitiateDeactivate = async (st: StaffUser) => {
    if (isReadOnly) return;
    setErrorMsg('');
    setDeactivateError('');

    // Manager Self-Protection
    if (
      st.uid === currentUser.uid ||
      (st.authUserId && st.authUserId === currentUser.uid) ||
      ((st as any).authUid && (st as any).authUid === currentUser.uid)
    ) {
      setErrorMsg('Anda tidak dapat menonaktifkan akun Anda sendiri.');
      return;
    }

    // Last Manager Protection
    if (st.role === 'manager' || st.role === 'admin') {
      const activeManagers = staffList.filter(
        (s) => (s.role === 'manager' || s.role === 'admin') && s.isActive !== false && s.status !== 'INACTIVE'
      );
      if (activeManagers.length <= 1) {
        setErrorMsg('Minimal satu akun Manager aktif harus tersedia di sistem.');
        return;
      }
    }

    setDeactivatingStaff(st);
    setDeactivateReasonCategory('Resign');
    setDeactivateCustomReason('');
    setDeactivateBookingBlock({ blocked: false, upcomingCount: 0 });

    // Therapist Active Order Protection Check
    if (st.role === 'therapist' || st.therapistId) {
      setDeactivateCheckLoading(true);
      const thId = st.therapistId || st.uid.replace('staff-', '');
      try {
        const check = await checkTherapistBookingsBeforeDeactivate(thId, st.name);
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
        console.warn('Booking check error:', checkErr);
      } finally {
        setDeactivateCheckLoading(false);
      }
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivatingStaff) return;
    if (deactivateBookingBlock.blocked) {
      setDeactivateError(deactivateBookingBlock.reason || 'Terapis masih memiliki pesanan aktif.');
      return;
    }

    const finalReason =
      deactivateReasonCategory === 'Lainnya'
        ? deactivateCustomReason.trim() || 'Lainnya'
        : deactivateReasonCategory;

    setSaving(true);
    setDeactivateError('');
    try {
      await toggleStaffMasterStatus(
        deactivatingStaff,
        {
          id: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role as 'admin' | 'manager' | 'supervisor',
        },
        finalReason
      );
      setSuccessMsg(
        `Akun staf "${deactivatingStaff.name}" (${deactivatingStaff.employeeCode || deactivatingStaff.role.toUpperCase()}) berhasil dinonaktifkan. Akses login dan penugasan operasional telah dicabut.`
      );
      setDeactivatingStaff(null);
      await loadData();
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: any) {
      setDeactivateError(err.message || 'Gagal menonaktifkan akun staf.');
    } finally {
      setSaving(false);
    }
  };

  // 2. INITIATE REACTIVATION
  const handleInitiateReactivate = (st: StaffUser) => {
    if (isReadOnly) return;
    setErrorMsg('');
    setReactivateError('');
    setReactivatingStaff(st);
  };

  const handleConfirmReactivate = async () => {
    if (!reactivatingStaff) return;
    setSaving(true);
    setReactivateError('');
    try {
      await toggleStaffMasterStatus(reactivatingStaff, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager' | 'supervisor',
      });
      setSuccessMsg(
        `Akun staf "${reactivatingStaff.name}" (${reactivatingStaff.employeeCode || reactivatingStaff.role.toUpperCase()}) berhasil diaktifkan kembali. Akses login dan penugasan operasional telah dipulihkan.`
      );
      setReactivatingStaff(null);
      await loadData();
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: any) {
      setReactivateError(err.message || 'Gagal mengaktifkan kembali akun staf.');
    } finally {
      setSaving(false);
    }
  };

  const validateForm = (): { isValid: boolean; error?: string } => {
    if (!formData.name.trim()) {
      return { isValid: false, error: 'Nama Lengkap staf wajib diisi.' };
    }
    if (!formData.email.trim() || !isValidEmail(formData.email)) {
      return { isValid: false, error: 'Format email resmi staf tidak valid.' };
    }
    if (!formData.phone.trim() || !isValidWhatsApp(formData.phone)) {
      return { isValid: false, error: 'Nomor WhatsApp wajib valid format Indonesia (contoh: 08123456789 atau +628123456789).' };
    }
    if (formData.role === 'therapist' && !formData.gender) {
      return { isValid: false, error: 'Gender (Wanita / Pria) wajib dipilih untuk staf dengan role Terapis.' };
    }

    // Check Employee Code Uniqueness
    const code = formData.employeeCode.trim().toUpperCase();
    if (code) {
      const duplicateCode = staffList.find(
        (s) => s.uid !== formData.uid && s.employeeCode?.trim().toUpperCase() === code
      );
      if (duplicateCode) {
        return { isValid: false, error: `Kode Staf "${code}" sudah digunakan oleh staf "${duplicateCode.name}". Gunakan kode unik lain.` };
      }
    }

    // Check WhatsApp Uniqueness across other active staff
    const normalizedPhone = normalizeWhatsApp(formData.phone);
    const duplicatePhone = staffList.find(
      (s) => s.uid !== formData.uid && s.isActive !== false && s.phone && normalizeWhatsApp(s.phone) === normalizedPhone
    );
    if (duplicatePhone) {
      return {
        isValid: false,
        error: `Nomor WhatsApp sudah digunakan oleh staff lain ("${duplicatePhone.name}").`,
      };
    }

    // Check Email Uniqueness
    const normalizedEmail = normalizeEmail(formData.email);
    if (normalizedEmail) {
      const duplicateEmail = staffList.find(
        (s) => s.uid !== formData.uid && s.email && normalizeEmail(s.email) === normalizedEmail
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
      setErrorMsg(validation.error || 'Mohon periksa kembali isian formulir.');
      return;
    }

    setSaving(true);
    try {
      const isNew = !editingStaff;
      const normalizedPhone = normalizeWhatsApp(formData.phone);
      const targetUser: StaffUser = {
        uid: formData.uid,
        employeeCode: formData.employeeCode.trim().toUpperCase(),
        name: formData.name.trim(),
        displayName: (formData.displayName.trim() || formData.name.trim()),
        email: normalizeEmail(formData.email),
        phone: normalizedPhone,
        role: formData.role,
        gender: formData.gender || (formData.role === 'therapist' ? 'Perempuan' : undefined),
        branchId: formData.branchId,
        branchName: formData.branchName,
        isActive: formData.isActive,
        status: formData.isActive ? 'ACTIVE' : 'INACTIVE',
        internalNotes: formData.internalNotes.trim() ? formData.internalNotes.trim() : '',
      };

      await saveStaffMasterUser(
        sanitizeForFirestore(targetUser),
        {
          id: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role as 'admin' | 'manager' | 'supervisor',
        },
        isNew,
        formData.role === 'therapist' ? { skillIds: formData.skillIds } : undefined
      );

      setSuccessMsg(
        isNew
          ? `Staf baru "${targetUser.name}" (${targetUser.employeeCode || targetUser.role.toUpperCase()}) berhasil didaftarkan.`
          : `Profil staf "${targetUser.name}" berhasil diperbarui.`
      );

      await loadData();
      onRefresh();

      if (closeModalAfter) {
        setIsModalOpen(false);
      } else {
        // Quick add another staff
        const nextCode = generateNextEmployeeCode(
          formData.role,
          [...(staffList || []).map((s) => s.employeeCode), targetUser.employeeCode]
        );
        setFormData({
          uid: `staff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          employeeCode: nextCode,
          name: '',
          displayName: '',
          email: '',
          phone: '',
          role: formData.role,
          gender: formData.role === 'therapist' ? 'Perempuan' : '',
          branchId: formData.branchId,
          branchName: formData.branchName,
          isActive: true,
          internalNotes: '',
          skillIds: [],
        });
      }
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      console.error('Save staff error:', err);
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

  // Filtered staff list
  const filteredStaff = useMemo(() => {
    return staffList.filter((st) => {
      // Role Filter
      if (roleFilter !== 'ALL' && st.role !== roleFilter) return false;
      // Status Filter
      if (statusFilter === 'ACTIVE' && st.isActive === false) return false;
      if (statusFilter === 'INACTIVE' && st.isActive !== false) return false;
      // Branch Filter
      if (branchFilter !== 'ALL' && st.branchId !== branchFilter) return false;
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (st.name || '').toLowerCase().includes(q);
        const matchDisplay = (st.displayName || '').toLowerCase().includes(q);
        const matchCode = (st.employeeCode || '').toLowerCase().includes(q);
        const matchEmail = (st.email || '').toLowerCase().includes(q);
        const matchPhone = (st.phone || '').includes(q);
        const matchRole = (st.role || '').toLowerCase().includes(q);
        if (!matchName && !matchDisplay && !matchCode && !matchEmail && !matchPhone && !matchRole) {
          return false;
        }
      }
      return true;
    });
  }, [staffList, roleFilter, statusFilter, branchFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = staffList.length;
    const active = staffList.filter((s) => s.isActive !== false).length;
    const inactive = total - active;
    const managers = staffList.filter((s) => s.role === 'manager' && s.isActive !== false).length;
    const supervisors = staffList.filter((s) => s.role === 'supervisor' && s.isActive !== false).length;
    const css = staffList.filter((s) => s.role === 'css' && s.isActive !== false).length;
    const therapists = staffList.filter((s) => s.role === 'therapist' && s.isActive !== false).length;
    return { total, active, inactive, managers, supervisors, css, therapists };
  }, [staffList]);

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">Admin</span>;
      case 'manager':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-200">Manager</span>;
      case 'supervisor':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-900 border border-blue-200">Supervisor</span>;
      case 'css':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-teal-100 text-teal-900 border border-teal-200">CSS</span>;
      case 'therapist':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-200">Terapis</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800">{role}</span>;
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">
        <div className="inline-block animate-spin w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full mb-2"></div>
        <p className="text-sm">Memuat Master Data Staf...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50/50 via-white to-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-600/10 text-amber-800 flex items-center justify-center font-bold">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-900">Master Data Staf</h3>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                {staffList.length} Staf Terdaftar
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Single Source of Truth identitas staf, peran operasional, kontak resmi, dan status akses perusahaan
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
              <UserPlus className="w-4 h-4" />
              + Tambah Staff
            </button>
          )}
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 p-4 bg-slate-50/60 border-b border-slate-100 text-xs">
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-slate-500 text-[11px]">Total Staf</span>
          <span className="text-base font-bold text-slate-900">{stats.total}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-emerald-700 text-[11px] font-medium">Staf Aktif</span>
          <span className="text-base font-bold text-emerald-800">{stats.active}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-slate-500 text-[11px]">Non-Aktif</span>
          <span className="text-base font-bold text-slate-600">{stats.inactive}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-amber-800 text-[11px] font-medium">Manager</span>
          <span className="text-base font-bold text-amber-900">{stats.managers}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-blue-800 text-[11px] font-medium">Supervisor</span>
          <span className="text-base font-bold text-blue-900">{stats.supervisors}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col">
          <span className="text-teal-800 text-[11px] font-medium">CSS</span>
          <span className="text-base font-bold text-teal-900">{stats.css}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex flex-col col-span-2 sm:col-span-1">
          <span className="text-emerald-800 text-[11px] font-medium">Terapis</span>
          <span className="text-base font-bold text-emerald-900">{stats.therapists}</span>
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
            placeholder="Cari nama, kode staf, WA, email..."
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
          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          >
            <option value="ALL">Semua Peran (Role)</option>
            <option value="manager">Manager</option>
            <option value="supervisor">Supervisor</option>
            <option value="css">CSS</option>
            <option value="therapist">Terapis</option>
            <option value="admin">Admin</option>
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

          {/* Branch Filter */}
          {branches.length > 1 && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            >
              <option value="ALL">Semua Cabang</option>
              {(branches || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Staff Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="bg-slate-50/80 text-slate-700 font-semibold border-b border-slate-200 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="py-3 px-4">Identitas Staf</th>
              <th className="py-3 px-4">Peran (Role)</th>
              <th className="py-3 px-4">Kontak Resmi</th>
              <th className="py-3 px-4">Cabang</th>
              <th className="py-3 px-4">Akun Login</th>
              <th className="py-3 px-4">Status Master</th>
              <th className="py-3 px-4 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredStaff.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <Users className="w-8 h-8 text-slate-300 stroke-[1.5]" />
                    <p className="font-medium text-slate-600">Tidak ada data staf yang sesuai</p>
                    <p className="text-[11px] text-slate-400">
                      Coba sesuaikan kata kunci pencarian atau filter status peran
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              (filteredStaff || []).map((st) => {
                const isCurrentLoggedIn = st.uid === currentUser.uid;
                const isTherapist = st.role === 'therapist';

                return (
                  <tr
                    key={st.uid}
                    className={`hover:bg-amber-50/20 transition ${
                      st.isActive === false ? 'bg-slate-50/60 opacity-75' : ''
                    }`}
                  >
                    {/* Identity */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                            st.role === 'manager'
                              ? 'bg-amber-100 text-amber-900 border border-amber-200'
                              : st.role === 'supervisor'
                              ? 'bg-blue-100 text-blue-900 border border-blue-200'
                              : st.role === 'css'
                              ? 'bg-teal-100 text-teal-900 border border-teal-200'
                              : st.role === 'therapist'
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                              : 'bg-purple-100 text-purple-900 border border-purple-200'
                          }`}
                        >
                          {getInitialsAvatar(st.name)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900 text-xs">{st.name}</span>
                            {isCurrentLoggedIn && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-200/80 text-amber-900">
                                Anda
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            {st.employeeCode && (
                              <span className="font-mono font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.2 rounded text-[10px]">
                                {st.employeeCode}
                              </span>
                            )}
                            {st.gender && (
                              <span>• {st.gender === 'Perempuan' ? 'Wanita' : 'Pria'}</span>
                            )}
                            {st.displayName && st.displayName !== st.name && (
                              <span>• Display: &quot;{st.displayName}&quot;</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td className="py-3 px-4">
                      {getRoleBadge(st.role)}
                    </td>

                    {/* Contact */}
                    <td className="py-3 px-4">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-slate-700">
                          <Phone className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span className="font-medium font-mono text-[11px]">
                            {formatWhatsAppDisplay(st.phone || '')}
                          </span>
                          {st.phone && (
                            <a
                              href={`https://wa.me/${getWaMeTarget(st.phone)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Chat WhatsApp"
                              className="text-emerald-600 hover:text-emerald-700 inline-flex items-center"
                            >
                              <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-slate-500 text-[11px]">
                          <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[170px]">{st.email}</span>
                        </div>
                      </div>
                    </td>

                    {/* Branch */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 text-slate-700">
                        <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[130px]">{st.branchName || 'Palembang R-01'}</span>
                      </div>
                    </td>

                    {/* Login Account Link Status (Prompt 15E) */}
                    <td className="py-3 px-4">
                      <div className="space-y-1">
                        {st.loginAccountStatus === 'AKTIF' || (!st.loginAccountStatus && st.authUserId) ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            Aktif
                          </span>
                        ) : st.loginAccountStatus === 'WAJIB_GANTI_PASSWORD' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            <Lock className="w-3 h-3" />
                            Wajib Ganti Sandi
                          </span>
                        ) : st.loginAccountStatus === 'UNDANGAN_TERKIRIM' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                            <Send className="w-3 h-3" />
                            Undangan Terkirim
                          </span>
                        ) : st.loginAccountStatus === 'PASSWORD_AWAL_DIBUAT' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-200">
                            <KeyRound className="w-3 h-3" />
                            Password Awal
                          </span>
                        ) : st.loginAccountStatus === 'DINONAKTIFKAN' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <UserX className="w-3 h-3" />
                            Dinonaktifkan
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                              <Info className="w-3 h-3 text-slate-400" />
                              Belum Dibuat
                            </span>
                            {!isReadOnly && (
                              <button
                                type="button"
                                onClick={() => handleOpenProvision(st)}
                                className="text-[10px] text-[#082A4F] hover:underline font-bold cursor-pointer"
                              >
                                Buat
                              </button>
                            )}
                          </div>
                        )}

                        {st.isDemoAccount && (
                          <div className="text-[9px] text-amber-700 font-semibold">
                            (Akun Demo)
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Active Status */}
                    <td className="py-3 px-4">
                      {st.isActive !== false ? (
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
                          onClick={() => setDetailStaff(st)}
                          title="Lihat Detail Profil & Keamanan Akun"
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {!isReadOnly && (
                          <>
                            {!st.authUserId && st.loginAccountStatus !== 'AKTIF' ? (
                              <button
                                type="button"
                                onClick={() => handleOpenProvision(st)}
                                title="Buat Akun Login Staf"
                                className="p-1.5 rounded-lg border border-[#082A4F]/30 text-[#082A4F] bg-[#082A4F]/5 hover:bg-[#082A4F]/15 transition cursor-pointer"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={authActionLoadingId === st.uid}
                                onClick={() => handleSendResetLink(st)}
                                title="Reset Password / Kirim Ulang Link Kata Sandi"
                                className="p-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-100 transition cursor-pointer"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${authActionLoadingId === st.uid ? 'animate-spin' : ''}`} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(st)}
                              title="Edit Profil Staf"
                              className="p-1.5 rounded-lg border border-slate-200 text-amber-800 hover:bg-amber-50 transition cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={saving || isCurrentLoggedIn || authActionLoadingId === st.uid}
                              onClick={() => {
                                if (st.isActive !== false) {
                                  handleInitiateDeactivate(st);
                                } else {
                                  handleInitiateReactivate(st);
                                }
                              }}
                              title={
                                isCurrentLoggedIn
                                  ? 'Tidak dapat menonaktifkan akun sendiri (sedang login)'
                                  : st.isActive !== false
                                  ? 'Nonaktifkan Staff'
                                  : 'Aktifkan Kembali Staff'
                              }
                              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                isCurrentLoggedIn
                                  ? 'opacity-30 cursor-not-allowed border-slate-200 text-slate-400'
                                  : st.isActive !== false
                                  ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                                  : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              {st.isActive !== false ? (
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
          <span>Hanya Manager & Admin yang memiliki otoritas membuat & mengubah Master Data Staf.</span>
        </div>
        <div>
          Menampilkan <span className="font-semibold text-slate-700">{filteredStaff.length}</span> dari{' '}
          <span className="font-semibold text-slate-700">{staffList.length}</span> total staf
        </div>
      </div>

      {/* MODAL: ADD / EDIT STAFF */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div>
                <h4 className="text-base font-bold text-slate-900">
                  {editingStaff ? 'Edit Data Staf' : 'Tambah Staf Baru'}
                </h4>
                <p className="text-xs text-slate-500">
                  {editingStaff
                    ? `Perbarui informasi Master Staf ${editingStaff.name}`
                    : 'Daftarkan personel staf baru ke dalam Master Data Senzu Home'}
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
              {/* Role Selection */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">
                  Peran Organisasi (Role) <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['manager', 'supervisor', 'css', 'therapist'] as UserRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleRoleChange(r)}
                      className={`p-2 rounded-xl border text-center font-bold text-xs transition cursor-pointer ${
                        formData.role === r
                          ? 'border-amber-600 bg-amber-50/80 text-amber-900 shadow-xs'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {getRoleDisplayLabel(r)}
                    </button>
                  ))}
                </div>
                {formData.role === 'therapist' && (
                  <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
                    <Info className="w-3 h-3 shrink-0" />
                    Staf terapis akan otomatis terhubung ke Master Terapis untuk pengaturan kualifikasi layanan.
                  </p>
                )}
              </div>

              {/* Employee Code & Branch */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kode Karyawan (Staff Code) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.employeeCode}
                    onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value.toUpperCase() })}
                    placeholder="Contoh: MGR001, SPV001..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Kode unik identitas karyawan</p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Cabang Operasional <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.branchId}
                    onChange={(e) => handleBranchChange(e.target.value)}
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

              {/* Full Name & Display Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nama Lengkap (KTP / Legal) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Contoh: Hendra Wijaya"
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
                    placeholder="Contoh: Hendra W."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Nama ramah untuk tampilan operasional</p>
                </div>
              </div>

              {/* WhatsApp & Email */}
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
                    placeholder="Contoh: 081273445500"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Otomatis dinormalisasi ke format internasional (+628...)</p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Email Staf <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="Contoh: hendra@senzuhome.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                  />
                </div>
              </div>

              {/* Gender */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Jenis Kelamin (Gender){' '}
                  {formData.role === 'therapist' ? (
                    <span className="text-rose-500">* (Wajib untuk Terapis)</span>
                  ) : (
                    <span className="text-slate-400 font-normal">(Opsional)</span>
                  )}
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
                    Wanita (Perempuan)
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
                    Pria (Laki-laki)
                  </button>
                </div>
              </div>

              {/* Therapist Skill Matrix (When role is therapist) */}
              {formData.role === 'therapist' && (
                <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block font-bold text-emerald-900 text-xs">
                      Keahlian Layanan Terapis (Skill Matrix)
                    </label>
                    <span className="text-[10px] text-emerald-700 font-semibold px-2 py-0.5 rounded-full bg-emerald-100/80">
                      {formData.skillIds?.length || 0} Keahlian Dipilih
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    Pilih jenis layanan pijat dan reflexology yang dikuasai terapis ini. Sinkronisasi langsung diterapkan ke profil Master Terapis untuk penjadwalan & penugasan reservasi.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                    {availableSkills.map((sk) => {
                      const sid = sk.skillId || sk.id;
                      const isSelected = (formData.skillIds || []).includes(sid);
                      return (
                        <button
                          key={sk.id}
                          type="button"
                          onClick={() => {
                            const cur = formData.skillIds || [];
                            const updated = cur.includes(sid)
                              ? cur.filter((x) => x !== sid)
                              : [...cur, sid];
                            setFormData((prev) => ({ ...prev, skillIds: updated }));
                          }}
                          className={`px-2.5 py-2 rounded-lg border text-left text-xs font-medium transition cursor-pointer flex items-center justify-between ${
                            isSelected
                              ? 'bg-emerald-700 border-emerald-700 text-white shadow-xs'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-emerald-50/60'
                          }`}
                        >
                          <span className="truncate">{sk.skillName || sk.name}</span>
                          {isSelected ? (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 ml-1 text-white" />
                          ) : (
                            <span className="w-3.5 h-3.5 rounded border border-slate-300 shrink-0 ml-1"></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Internal Notes */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Catatan Internal Perusahaan</label>
                <textarea
                  rows={2}
                  value={formData.internalNotes}
                  onChange={(e) => setFormData({ ...formData, internalNotes: e.target.value })}
                  placeholder="Catatan penugasan, riwayat kontrak, atau info khusus staf..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
                />
              </div>

              {/* Active Status Checkbox */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800 block text-xs">Status Akses Operasional</span>
                  <span className="text-[11px] text-slate-500">
                    {formData.isActive ? 'Staf aktif dan memiliki hak akses ke sistem' : 'Akses operasional dinonaktifkan'}
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

              {/* Action Buttons */}
              <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                {!editingStaff && (
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
                  <span>{editingStaff ? 'Simpan Perubahan' : 'Daftarkan Staf'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL DRAWER */}
      {detailStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center font-bold text-sm">
                  {getInitialsAvatar(detailStaff.name)}
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">{detailStaff.name}</h4>
                  <p className="text-xs text-slate-500 font-mono">
                    {detailStaff.employeeCode || detailStaff.uid}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailStaff(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Peran Organisasi:</span>
                <div>{getRoleBadge(detailStaff.role)}</div>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Status Master:</span>
                <span
                  className={`font-bold px-2 py-0.5 rounded-full text-[11px] ${
                    detailStaff.isActive !== false
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {detailStaff.isActive !== false ? 'AKTIF' : 'NON-AKTIF'}
                </span>
              </div>

              {/* Authentication & Account Security (Prompt 15E) */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#D4AF37]" />
                    Keamanan &amp; Akun Login
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      detailStaff.loginAccountStatus === 'AKTIF' || (!detailStaff.loginAccountStatus && detailStaff.authUserId)
                        ? 'bg-emerald-100 text-emerald-800'
                        : detailStaff.loginAccountStatus === 'WAJIB_GANTI_PASSWORD'
                        ? 'bg-amber-100 text-amber-900'
                        : detailStaff.loginAccountStatus === 'DINONAKTIFKAN'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {detailStaff.loginAccountStatus || (detailStaff.authUserId ? 'AKTIF' : 'BELUM DIBUAT')}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Firebase Auth UID</span>
                    <span className="font-mono truncate block text-slate-800">
                      {detailStaff.authUserId ? detailStaff.authUserId.slice(0, 16) + '...' : 'Belum Terhubung'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Wajib Ganti Password</span>
                    <span className={`font-semibold ${detailStaff.mustChangePassword ? 'text-amber-700' : 'text-slate-700'}`}>
                      {detailStaff.mustChangePassword ? 'YA (Login Pertama)' : 'TIDAK'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Kategori Akun</span>
                    <span className={`font-semibold ${detailStaff.isDemoAccount ? 'text-amber-700' : 'text-blue-700'}`}>
                      {detailStaff.isDemoAccount ? 'Akun Demo Awal' : 'Akun Produksi Resmi'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Login Terakhir</span>
                    <span className="font-medium text-slate-700">
                      {detailStaff.lastLoginAt ? new Date(detailStaff.lastLoginAt).toLocaleDateString('id-ID') : '-'}
                    </span>
                  </div>
                </div>

                {/* Account Action Buttons */}
                {!isReadOnly && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {!detailStaff.authUserId && detailStaff.loginAccountStatus !== 'AKTIF' ? (
                      <button
                        type="button"
                        onClick={() => {
                          const target = detailStaff;
                          setDetailStaff(null);
                          handleOpenProvision(target);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-[#082A4F] text-white hover:bg-[#0A335F] text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition shadow-xs"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>Buat Akun Login Staf</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendResetLink(detailStaff)}
                        disabled={authActionLoadingId === detailStaff.uid}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5 text-blue-600" />
                        <span>Kirim Link Reset Password</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleToggleLoginStatus(detailStaff)}
                      disabled={authActionLoadingId === detailStaff.uid || detailStaff.uid === currentUser.uid}
                      className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition disabled:opacity-40 ${
                        detailStaff.isActive === false || detailStaff.loginAccountStatus === 'DINONAKTIFKAN'
                          ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                          : 'border-rose-300 text-rose-700 hover:bg-rose-50'
                      }`}
                    >
                      {detailStaff.isActive === false || detailStaff.loginAccountStatus === 'DINONAKTIFKAN' ? (
                        <>
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Aktifkan Akses Login</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          <span>Nonaktifkan Akses Login</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                <p className="text-[10px] text-slate-400 italic">
                  * Kata sandi dikelola langsung oleh Firebase Auth dan tidak pernah disimpan di database atau log.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">WhatsApp Resmi:</span>
                  <a
                    href={`https://wa.me/${getWaMeTarget(detailStaff.phone || '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono font-bold text-emerald-700 hover:underline flex items-center gap-1"
                  >
                    {formatWhatsAppDisplay(detailStaff.phone || '')}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Email Resmi:</span>
                  <span className="font-semibold text-slate-800">{detailStaff.email}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Cabang:</span>
                  <span className="font-semibold text-slate-800">{detailStaff.branchName || 'Palembang R-01'}</span>
                </div>

                {detailStaff.gender && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Jenis Kelamin:</span>
                    <span className="font-semibold text-slate-800">{detailStaff.gender}</span>
                  </div>
                )}
              </div>

              {detailStaff.internalNotes && (
                <div className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/60">
                  <span className="font-semibold text-amber-900 block mb-0.5">Catatan Internal:</span>
                  <p className="text-slate-700">{detailStaff.internalNotes}</p>
                </div>
              )}

              {/* Audit Trail */}
              <div className="pt-2 border-t border-slate-100 text-[10px] text-slate-400 space-y-0.5">
                {detailStaff.createdAt && (
                  <div>Dibuat: {new Date(detailStaff.createdAt).toLocaleString('id-ID')} WIB</div>
                )}
                {detailStaff.updatedAt && (
                  <div>
                    Terakhir diubah: {new Date(detailStaff.updatedAt).toLocaleString('id-ID')} WIB
                    {detailStaff.updatedBy ? ` oleh ${detailStaff.updatedBy}` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end gap-2">
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => {
                    const st = detailStaff;
                    setDetailStaff(null);
                    handleOpenEdit(st);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit Staf
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetailStaff(null)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROVISION LOGIN ACCOUNT MODAL (Prompt 15E) */}
      <ProvisionAccountModal
        isOpen={isProvisionModalOpen}
        onClose={() => {
          setIsProvisionModalOpen(false);
          setProvisioningStaff(null);
        }}
        staff={provisioningStaff}
        actor={currentUser}
        onSuccess={() => {
          loadData();
          onRefresh();
        }}
      />

      {/* MODAL NONAKTIFKAN STAFF (SOFT DELETE / ARCHIVE) */}
      {deactivatingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-scaleUp">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <UserX className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900">
                  Konfirmasi Penonaktifan Staff
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Arsipkan akses staf tanpa menghapus riwayat data operasional
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeactivatingStaff(null)}
                disabled={saving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Staff Summary Card */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Nama Staff:</span>
                <span className="font-bold text-slate-900">{deactivatingStaff.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Kode Staff:</span>
                <span className="font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {deactivatingStaff.employeeCode || '-'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Peran (Role):</span>
                <span>{getRoleBadge(deactivatingStaff.role)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Cabang:</span>
                <span className="font-medium text-slate-700">{deactivatingStaff.branchName || 'Palembang'}</span>
              </div>
            </div>

            {/* Soft Delete Explanatory Notice */}
            <div className="mt-3 p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" />
              <div className="space-y-1 text-[11px] leading-relaxed">
                <p className="font-semibold text-amber-950">Aman & Terarsip:</p>
                <p>
                  Staff yang dinonaktifkan tidak dapat login dan tidak dapat menerima penugasan baru,
                  tetapi seluruh riwayat transaksi dan operasional tetap tersimpan permanen.
                </p>
              </div>
            </div>

            {/* Therapist Booking Protection Status */}
            {deactivateCheckLoading && (
              <div className="mt-3 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                <span>Memeriksa status reservasi aktif terapis...</span>
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
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <span className="font-bold">Perhatian: </span>
                  Terapis ini memiliki {deactivateBookingBlock.upcomingCount} reservasi mendatang.
                  Pastikan Supervisor segera menugaskan ulang jadwal tersebut ke staf lain.
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
                onClick={() => setDeactivatingStaff(null)}
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
                    Nonaktifkan Staff
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL AKTIFKAN KEMBALI STAFF (REACTIVATION) */}
      {reactivatingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-scaleUp">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900">
                  Aktifkan Kembali Staff?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pulihkan akses login dan penugasan operasional staf
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReactivatingStaff(null)}
                disabled={saving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Staff Summary Card */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Nama Staff:</span>
                <span className="font-bold text-slate-900">{reactivatingStaff.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Kode Staff:</span>
                <span className="font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {reactivatingStaff.employeeCode || '-'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Peran (Role):</span>
                <span>{getRoleBadge(reactivatingStaff.role)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Cabang:</span>
                <span className="font-medium text-slate-700">{reactivatingStaff.branchName || 'Palembang'}</span>
              </div>
            </div>

            {/* Reactivation Notice */}
            <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
              <div className="space-y-1 text-[11px] leading-relaxed">
                <p className="font-semibold text-emerald-950">Akses Dipulihkan:</p>
                <p>
                  Staff akan dapat kembali login dan menerima penugasan operasional dengan Staff ID ({reactivatingStaff.employeeCode || reactivatingStaff.uid}) yang sama. Seluruh riwayat transaksi lama tetap terhubung.
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
                onClick={() => setReactivatingStaff(null)}
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
                    Aktifkan Kembali Staff
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
