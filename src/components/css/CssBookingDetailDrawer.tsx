import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Phone,
  Calendar,
  Clock,
  MapPin,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MessageCircle,
  Send,
  Copy,
  Check,
  ShieldAlert,
  Edit3,
  FileText,
  History,
  Sparkles,
  Award,
  ExternalLink,
  ChevronRight,
  Info,
} from 'lucide-react';
import { Booking, BookingStatusHistory } from '../../types';
import { CustomerCRM, CustomerInteraction } from '../../types/crm';
import {
  getBookingStatusHistory,
  cssAddInternalNote,
  cssUpdateAddress,
  cssClaimTask,
} from '../../lib/dbService';
import {
  getCustomerById,
  searchCustomers,
  addCustomerInteraction,
  getCustomerInteractions,
} from '../../lib/crmService';
import {
  generateWhatsAppMessage,
  getWhatsAppDeepLink,
} from './cssHelpers';
import { formatRupiah } from '../../lib/utils';
import { getPaymentStatusBadgeStyle } from '../../lib/paymentService';
import { CssDrawerPaymentVerification } from './CssDrawerPaymentVerification';

interface CssBookingDetailDrawerProps {
  isOpen: boolean;
  booking: Booking | null;
  onClose: () => void;
  onRefresh: () => void;
  currentUserId: string;
  currentUserName: string;
  onOpenVerifyPayment?: (bookingId: string) => void;
  onOpenReschedule: (booking: Booking) => void;
  onOpenCancel: (booking: Booking) => void;
  onOpenEscalate: (booking: Booking) => void;
}

export const CssBookingDetailDrawer: React.FC<CssBookingDetailDrawerProps> = ({
  isOpen,
  booking,
  onClose,
  onRefresh,
  currentUserId,
  currentUserName,
  onOpenVerifyPayment,
  onOpenReschedule,
  onOpenCancel,
  onOpenEscalate,
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'crm360' | 'whatsapp' | 'internalNotes' | 'history'>('summary');
  const [statusHistory, setStatusHistory] = useState<BookingStatusHistory[]>([]);
  const [customerCrm, setCustomerCrm] = useState<CustomerCRM | null>(null);
  const [interactions, setInteractions] = useState<CustomerInteraction[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  // Address edit state
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [editAddress, setEditAddress] = useState('');
  const [editArea, setEditArea] = useState('');
  const [addressChangeReason, setAddressChangeReason] = useState('');
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  // New internal note state
  const [newInternalNote, setNewInternalNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Customer interaction form state
  const [interactionChannel, setInteractionChannel] = useState<'whatsapp' | 'phone' | 'email'>('whatsapp');
  const [interactionDirection, setInteractionDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [interactionSummary, setInteractionSummary] = useState('');
  const [isSavingInteraction, setIsSavingInteraction] = useState(false);

  // Selected WhatsApp template
  const [selectedTemplate, setSelectedTemplate] = useState<any>('confirm_payment_details');
  const [customWaMessage, setCustomWaMessage] = useState('');

  useEffect(() => {
    if (!booking) return;

    // Load status history
    setIsLoadingHistory(true);
    getBookingStatusHistory(booking.id).then((hist) => {
      setStatusHistory(hist);
      setIsLoadingHistory(false);
    });

    // Load CRM 360 customer data
    if (booking.customerId) {
      getCustomerById(booking.customerId).then((cust) => {
        if (cust) setCustomerCrm(cust);
      });
      getCustomerInteractions(booking.customerId).then((ints) => {
        setInteractions(ints);
      });
    } else {
      // Fallback search by WhatsApp
      searchCustomers(booking.customerWhatsApp).then((res) => {
        if (res.length > 0) {
          setCustomerCrm(res[0]);
          getCustomerInteractions(res[0].id).then(setInteractions);
        }
      });
    }

    // Initialize edit address
    setEditAddress(booking.address || '');
    setEditArea(booking.area || '');

    // Initialize WA message
    const initialWa = generateWhatsAppMessage('confirm_payment_details', booking);
    setCustomWaMessage(initialWa);
  }, [booking]);

  if (!isOpen || !booking) return null;

  const handleTemplateChange = (templateKey: any) => {
    setSelectedTemplate(templateKey);
    const msg = generateWhatsAppMessage(templateKey, booking);
    setCustomWaMessage(msg);
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAddress.trim() || !editArea.trim() || !addressChangeReason.trim()) return;
    setIsSavingAddress(true);
    try {
      await cssUpdateAddress(
        booking,
        editAddress.trim(),
        editArea.trim(),
        booking.addressNotes,
        currentUserName,
        addressChangeReason.trim()
      );
      setIsEditingAddress(false);
      onRefresh();
    } catch (err) {
      console.error('Failed to update address:', err);
    } finally {
      setIsSavingAddress(false);
    }
  };

  const handleSaveInternalNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInternalNote.trim()) return;
    setIsSavingNote(true);
    try {
      await cssAddInternalNote(booking.id, booking.bookingCode, newInternalNote.trim(), currentUserName);
      setNewInternalNote('');
      onRefresh();
    } catch (err) {
      console.error('Failed to add internal note:', err);
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleSaveInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interactionSummary.trim() || !booking.customerId) return;
    setIsSavingInteraction(true);
    try {
      await addCustomerInteraction({
        customerId: booking.customerId,
        channel: interactionChannel,
        direction: interactionDirection,
        summary: interactionSummary.trim(),
        staffId: currentUserId,
        staffName: currentUserName,
      });
      setInteractionSummary('');
      // Refresh interactions list
      const updated = await getCustomerInteractions(booking.customerId);
      setInteractions(updated);
    } catch (err) {
      console.error('Failed to save interaction:', err);
    } finally {
      setIsSavingInteraction(false);
    }
  };

  const handleClaim = async () => {
    try {
      await cssClaimTask(booking.id, booking.bookingCode, currentUserId, currentUserName);
      onRefresh();
    } catch (err) {
      console.error('Failed to claim:', err);
    }
  };

  const paymentBadge = getPaymentStatusBadgeStyle(booking.paymentStatus);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="bg-[#8B5A36] text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-base sm:text-lg font-black tracking-wide">
                {booking.bookingCode}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  booking.status === 'Completed'
                    ? 'bg-emerald-100 text-emerald-800'
                    : booking.status === 'Cancelled'
                    ? 'bg-red-100 text-red-800'
                    : booking.paymentStatus === 'pending_manual_verification'
                    ? 'bg-blue-100 text-blue-800'
                    : booking.paymentStatus === 'expired'
                    ? 'bg-slate-200 text-slate-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {booking.paymentStatus === 'pending_manual_verification' && booking.status === 'Menunggu Pembayaran'
                  ? 'Pembayaran Sedang Diverifikasi'
                  : booking.paymentStatus === 'expired'
                  ? 'Waktu Pembayaran Berakhir'
                  : booking.status}
              </span>
              <span
                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${paymentBadge.bg} ${paymentBadge.text} ${paymentBadge.border}`}
              >
                {paymentBadge.label}
              </span>
            </div>
            <div className="text-xs text-slate-300">
              Pelanggan: <strong className="text-white">{booking.customerName}</strong> ({booking.customerWhatsApp})
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!booking.cssOwnerId && (
              <button
                type="button"
                onClick={handleClaim}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition"
              >
                Ambil Tugas
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-200 px-4 bg-slate-50 overflow-x-auto shrink-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'summary'
                ? 'border-[#8B5A36] text-[#4B2B18]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Ringkasan & Aksi</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('crm360')}
            className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'crm360'
                ? 'border-[#8B5A36] text-[#4B2B18]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Customer 360</span>
            {customerCrm && (
              <span className="px-1.5 py-0.2 rounded-full bg-[#D4AF37]/20 text-[#B89628] text-[9px]">
                {(customerCrm as any).tier || (customerCrm as any).membershipTier || 'Member'}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('whatsapp')}
            className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'whatsapp'
                ? 'border-[#8B5A36] text-[#4B2B18]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>Template WA</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('internalNotes')}
            className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'internalNotes'
                ? 'border-[#8B5A36] text-[#4B2B18]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Catatan Internal</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'border-[#8B5A36] text-[#4B2B18]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Riwayat Status</span>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs text-slate-700">
          {/* TAB 1: SUMMARY & ACTIONS */}
          {activeTab === 'summary' && (
            <div className="space-y-5">
              {/* DEDICATED PAYMENT VERIFICATION SECTION (Item 4) */}
              <CssDrawerPaymentVerification
                booking={booking}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                onRefresh={onRefresh}
                onWhatsAppClick={() => setActiveTab('whatsapp')}
              />

              {/* Customer Request Alert Banner (if any) */}
              {booking.customerRequest && booking.customerRequest.status === 'pending' && (
                <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Permintaan Pelanggan: {booking.customerRequest.type.toUpperCase()}</span>
                  </div>
                  <p className="text-xs">{booking.customerRequest.details}</p>
                </div>
              )}

              {/* Active Escalation Banner (if any) */}
              {booking.escalation && booking.escalation.status !== 'resolved' && (
                <div className="p-3.5 bg-purple-50 rounded-2xl border border-purple-200 text-purple-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-xs">
                    <ShieldAlert className="w-4 h-4 text-purple-600" />
                    <span>Tiket Eskalasi Supervisor: {booking.escalation.priority}</span>
                  </div>
                  <p className="text-xs">
                    <strong>{booking.escalation.category}:</strong> "{booking.escalation.reason}" (Oleh: {booking.escalation.escalatedByName})
                  </p>
                </div>
              )}

              {/* Grid Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                {/* Pelanggan */}
                <div className="space-y-1">
                  <span className="text-slate-400 font-medium">Pelanggan:</span>
                  <div className="font-bold text-slate-900 text-sm">{booking.customerName}</div>
                  <div className="flex items-center gap-1 font-mono text-slate-600">
                    <span>{booking.customerWhatsApp}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(booking.customerWhatsApp)}
                      className="p-1 text-slate-400 hover:text-slate-700"
                      title="Salin Nomor"
                    >
                      {copiedText ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                {/* Jadwal */}
                <div className="space-y-1">
                  <span className="text-slate-400 font-medium">Jadwal Treatment (WIB):</span>
                  <div className="font-bold text-[#4B2B18] text-sm">
                    {booking.scheduleDate} • {booking.scheduleTime} WIB
                  </div>
                  <div className="text-slate-500">
                    Durasi Layanan: {booking.serviceDuration} Menit
                  </div>
                </div>

                {/* Layanan & Biaya */}
                <div className="space-y-1">
                  <span className="text-slate-400 font-medium">Layanan & Biaya:</span>
                  <div className="font-bold text-slate-900">{booking.serviceName}</div>
                  <div className="text-slate-900 font-black text-sm">
                    {formatRupiah(booking.totalAmount)}
                  </div>
                  <div className="text-slate-500">
                    Metode: {booking.paymentMethod}
                  </div>
                </div>

                {/* Terapis Assigned */}
                <div className="space-y-1">
                  <span className="text-slate-400 font-medium">Terapis Bertugas:</span>
                  {booking.therapistName ? (
                    <div>
                      <div className="font-bold text-indigo-700 text-sm">{booking.therapistName}</div>
                      <div className="text-[11px] text-slate-500">Ditugaskan oleh Supervisor</div>
                    </div>
                  ) : (
                    <div className="text-slate-400 italic">
                      Belum ditugaskan (Antre di Supervisor)
                    </div>
                  )}
                </div>
              </div>

              {/* Alamat & Area */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    Alamat Layanan:
                  </span>
                  {!isEditingAddress && booking.status !== 'Completed' && booking.status !== 'Cancelled' && (
                    <button
                      type="button"
                      onClick={() => setIsEditingAddress(true)}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Ubah Alamat</span>
                    </button>
                  )}
                </div>

                {isEditingAddress ? (
                  <form onSubmit={handleSaveAddress} className="space-y-2.5 pt-1">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-0.5">Alamat Lengkap:</label>
                      <textarea
                        rows={2}
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        required
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36]"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-0.5">Area / Kecamatan:</label>
                      <input
                        type="text"
                        value={editArea}
                        onChange={(e) => setEditArea(e.target.value)}
                        required
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36]"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-0.5">Alasan Perubahan (Audit Log):</label>
                      <input
                        type="text"
                        placeholder="Contoh: Customer pindah ke villa sebelah..."
                        value={addressChangeReason}
                        onChange={(e) => setAddressChangeReason(e.target.value)}
                        required
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36]"
                      />
                    </div>

                    {booking.therapistName && (
                      <div className="p-2 bg-amber-50 rounded-lg text-amber-800 text-[11px] flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                        <span>Terapis {booking.therapistName} sudah ditugaskan. Perubahan alamat akan tercatat dalam audit log & status riwayat.</span>
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingAddress(false)}
                        className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-medium"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingAddress}
                        className="px-3.5 py-1.5 rounded-lg bg-[#8B5A36] text-white font-bold"
                      >
                        {isSavingAddress ? 'Menyimpan...' : 'Simpan Alamat Baru'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div>
                    <div className="font-bold text-slate-900">{booking.address}</div>
                    <div className="text-slate-500 font-medium">{booking.area}</div>
                    {booking.addressNotes && (
                      <div className="text-[11px] text-slate-400 mt-1">
                        Patokan: {booking.addressNotes}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Catatan Customer */}
              {booking.customerNotes && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900">
                  <span className="font-bold">Catatan / Keluhan Pelanggan: </span>
                  {booking.customerNotes}
                </div>
              )}

              {/* Action Buttons Hub */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                  {booking.paymentStatus === 'pending_manual_verification'
                    ? 'Aksi Operasional Tambahan (Opsional):'
                    : 'Aksi Operasional CSS:'}
                </span>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {/* Reschedule */}
                  {booking.status !== 'Completed' && booking.status !== 'Cancelled' && (
                    <button
                      type="button"
                      onClick={() => onOpenReschedule(booking)}
                      className="p-2.5 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs flex flex-col items-center justify-center gap-1 transition text-center"
                    >
                      <Calendar className="w-4 h-4 text-amber-700" />
                      <span>Reschedule</span>
                    </button>
                  )}

                  {/* WhatsApp Hub */}
                  <button
                    type="button"
                    onClick={() => setActiveTab('whatsapp')}
                    className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs flex flex-col items-center justify-center gap-1 transition text-center"
                  >
                    <MessageCircle className="w-4 h-4 text-emerald-700" />
                    <span>Hubungi WA</span>
                  </button>

                  {/* Eskalasi Supervisor */}
                  <button
                    type="button"
                    onClick={() => onOpenEscalate(booking)}
                    className="p-2.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-900 font-bold text-xs flex flex-col items-center justify-center gap-1 transition text-center"
                  >
                    <ShieldAlert className="w-4 h-4 text-red-600" />
                    <span>Eskalasi Spv</span>
                  </button>

                  {/* Batalkan */}
                  {booking.status !== 'Completed' && booking.status !== 'Cancelled' && (
                    <button
                      type="button"
                      onClick={() => onOpenCancel(booking)}
                      className="p-2.5 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex flex-col items-center justify-center gap-1 transition text-center"
                    >
                      <XCircle className="w-4 h-4 text-slate-600" />
                      <span>Batalkan</span>
                    </button>
                  )}
                </div>

                {/* Boundary Reminder */}
                <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200 text-blue-900 text-[11px] flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Batas Wewenang CSS:</strong> Penugasan terapis (assign/reassign) dilakukan oleh Supervisor di Control Room. CSS bertugas memvalidasi pembayaran, memastikan alamat & jadwal akurat, serta melayani komunikasi pelanggan.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CUSTOMER 360 */}
          {activeTab === 'crm360' && (
            <div className="space-y-4">
              {customerCrm ? (
                <>
                  {/* Member Card */}
                  <div className="bg-gradient-to-br from-[#8B5A36] to-[#94603B] text-white p-5 rounded-2xl shadow-sm space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="text-[10px] text-amber-300 font-bold uppercase tracking-wider">
                          Senzu Loyalty Profile
                        </div>
                        <h4 className="text-lg font-black">{customerCrm.name}</h4>
                        <div className="text-xs text-slate-300 font-mono">{customerCrm.phone}</div>
                      </div>
                      <span className="px-3 py-1 rounded-full bg-[#D4AF37] text-[#4B2B18] font-black text-xs uppercase tracking-wider shadow-sm">
                        {(customerCrm as any).tier || (customerCrm as any).membershipTier || 'Member'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/10 text-center">
                      <div>
                        <div className="text-[10px] text-slate-300">Total Pesanan</div>
                        <div className="text-base font-bold">{customerCrm.totalBookings}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-300">Selesai</div>
                        <div className="text-base font-bold text-emerald-300">{customerCrm.completedBookings}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-300">Total Belanja</div>
                        <div className="text-sm font-bold text-amber-300">{formatRupiah(customerCrm.totalSpend || (customerCrm as any).totalSpent || 0)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Customer Preferences & Allergies */}
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
                    <h5 className="font-bold text-slate-800 text-xs">Preferensi & Catatan Khusus Pelanggan:</h5>
                    <div className="space-y-1 text-xs">
                      {(customerCrm as any).notes || customerCrm.addressNotes ? (
                        <p className="text-slate-700 bg-white p-3 rounded-xl border border-slate-200">
                          {(customerCrm as any).notes || customerCrm.addressNotes}
                        </p>
                      ) : (
                        <p className="text-slate-400 italic">Belum ada catatan preferensi khusus.</p>
                      )}
                    </div>
                  </div>

                  {/* Interaction Log History */}
                  <div className="space-y-2">
                    <h5 className="font-bold text-slate-800 text-xs">Riwayat Interaksi Pelanggan:</h5>
                    {interactions.length === 0 ? (
                      <p className="text-slate-400 italic">Belum ada riwayat interaksi tercatat.</p>
                    ) : (
                      <div className="space-y-2">
                        {interactions.slice(0, 5).map((it) => (
                          <div key={it.id} className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
                            <div className="flex justify-between font-bold text-[11px]">
                              <span className="text-[#4B2B18] uppercase">[{it.channel}] {it.direction}</span>
                              <span className="text-slate-400 font-mono text-[10px]">
                                {new Date(it.createdAt).toLocaleString('id-ID')}
                              </span>
                            </div>
                            <p className="text-slate-700 text-xs">{it.summary}</p>
                            <div className="text-[10px] text-slate-400">Oleh: {it.staffName}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <User className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p>Memuat profil lengkap pelanggan...</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: WHATSAPP TEMPLATES & LOGGER */}
          {activeTab === 'whatsapp' && (
            <div className="space-y-4">
              {/* Template Picker */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  Pilih Template Pesan WhatsApp Standar:
                </label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white font-medium focus:ring-2 focus:ring-[#8B5A36]"
                >
                  <option value="confirm_payment_details">1. Konfirmasi Reservasi & Nomor Rekening Transfer</option>
                  <option value="remind_payment_urgent">2. Pengingat Pembayaran Mendekati Jadwal</option>
                  <option value="payment_verified">3. Pembayaran Terverifikasi & Jadwal Terkonfirmasi</option>
                  <option value="payment_rejected">4. Bukti Pembayaran Perlu Diperbaiki / Ditolak</option>
                  <option value="reschedule_confirmation">5. Konfirmasi Perubahan Jadwal (Reschedule)</option>
                  <option value="address_clarification">6. Permintaan Klarifikasi Patokan Lokasi</option>
                  <option value="therapist_on_the_way">7. Terapis Meluncur ke Lokasi</option>
                  <option value="cancellation_confirmation">8. Konfirmasi Pembatalan Reservasi</option>
                  <option value="low_rating_service_recovery">9. Service Recovery / Permintaan Maaf Rating</option>
                </select>
              </div>

              {/* Message Box */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  Isi Pesan (Dapat Diedit Manual):
                </label>
                <textarea
                  rows={8}
                  value={customWaMessage}
                  onChange={(e) => setCustomWaMessage(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-200 text-xs font-sans leading-relaxed focus:ring-2 focus:ring-[#8B5A36] bg-slate-50"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyText(customWaMessage)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition"
                >
                  {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedText ? 'Tersalin!' : 'Salin Pesan'}</span>
                </button>

                <a
                  href={getWhatsAppDeepLink(booking.customerWhatsApp, customWaMessage)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm shadow-emerald-200"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Kirim ke WhatsApp (+{booking.customerWhatsApp})</span>
                  <ExternalLink className="w-3.5 h-3.5 ml-1" />
                </a>
              </div>

              {/* Interaction Logger Sub-form */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 mt-4">
                <h5 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-[#4B2B18]" />
                  Catat Interaksi ke CRM Pelanggan:
                </h5>

                <form onSubmit={handleSaveInteraction} className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={interactionChannel}
                      onChange={(e) => setInteractionChannel(e.target.value as any)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white font-medium"
                    >
                      <option value="whatsapp">WhatsApp</option>
                      <option value="phone">Telepon</option>
                      <option value="email">Email</option>
                    </select>

                    <select
                      value={interactionDirection}
                      onChange={(e) => setInteractionDirection(e.target.value as any)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white font-medium"
                    >
                      <option value="outbound">Outbound (CSS Hubungi)</option>
                      <option value="inbound">Inbound (Pelanggan Menghubungi)</option>
                    </select>
                  </div>

                  <textarea
                    rows={2}
                    placeholder="Contoh: Mengirim reminder transfer ke customer, respon customer akan transfer jam 12:00..."
                    value={interactionSummary}
                    onChange={(e) => setInteractionSummary(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-[#8B5A36]"
                  />

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={isSavingInteraction}
                      className="px-3.5 py-1.5 rounded-lg bg-[#8B5A36] text-white font-bold text-xs hover:bg-[#94603B] transition"
                    >
                      {isSavingInteraction ? 'Menyimpan...' : 'Simpan Log Interaksi'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 4: INTERNAL NOTES */}
          {activeTab === 'internalNotes' && (
            <div className="space-y-4">
              <form onSubmit={handleSaveInternalNote} className="space-y-2">
                <label className="block font-bold text-slate-800">
                  Tambah Catatan Internal CSS / Supervisor:
                </label>
                <textarea
                  rows={3}
                  placeholder="Catatan internal tim operasional..."
                  value={newInternalNote}
                  onChange={(e) => setNewInternalNote(e.target.value)}
                  required
                  className="w-full p-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#8B5A36]"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingNote}
                    className="px-4 py-2 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white font-bold text-xs transition"
                  >
                    {isSavingNote ? 'Menyimpan...' : 'Tambah Catatan'}
                  </button>
                </div>
              </form>

              <div className="space-y-2 pt-2 border-t border-slate-200">
                <h5 className="font-bold text-slate-800 text-xs">Catatan Internal Tersimpan:</h5>
                {booking.internalNotes ? (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 font-mono text-xs whitespace-pre-wrap leading-relaxed text-slate-700">
                    {booking.internalNotes}
                  </div>
                ) : (
                  <p className="text-slate-400 italic">Belum ada catatan internal pada reservasi ini.</p>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: STATUS HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <h5 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#4B2B18]" />
                Riwayat Perubahan Status (WIB):
              </h5>

              {isLoadingHistory ? (
                <div className="text-slate-400 text-center py-6">Memuat riwayat status...</div>
              ) : statusHistory.length === 0 ? (
                <div className="text-slate-400 italic text-center py-6">Belum ada rekaman riwayat status.</div>
              ) : (
                <div className="border-l-2 border-[#8B5A36]/20 ml-2 pl-4 space-y-4">
                  {(statusHistory || []).map((h) => (
                    <div key={h.id} className="relative">
                      <div className="absolute -left-[23px] top-1 w-3 h-3 rounded-full bg-[#8B5A36] border-2 border-white ring-2 ring-[#8B5A36]/20" />
                      <div className="flex justify-between font-bold">
                        <span className="text-[#4B2B18]">{h.status}</span>
                        <span className="text-slate-400 font-mono text-[10px]">{h.formattedWIB}</span>
                      </div>
                      {h.note && <p className="text-slate-600 text-xs mt-0.5">{h.note}</p>}
                      <div className="text-[10px] text-slate-400">
                        Oleh: {h.updatedByName} ({h.updatedByRole})
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center shrink-0">
          <div className="text-xs text-slate-500 font-medium">
            Status Operasional: <strong className="text-slate-800">{booking.taskStatus || 'Open'}</strong>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl font-bold text-slate-700 text-xs transition"
          >
            Tutup Panel
          </button>
        </div>
      </div>
    </div>
  );
};
