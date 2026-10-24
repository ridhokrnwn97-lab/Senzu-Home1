import React, { useState, useEffect } from 'react';
import {
  Award,
  Coins,
  Gift,
  Ticket,
  Users,
  Share2,
  Copy,
  LogIn,
  UserPlus,
  Check,
  Calendar,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Zap,
  Phone,
  ArrowRight
} from 'lucide-react';
import {
  CustomerLoyaltyAccount,
  CustomerVoucher,
  LoyaltyTransaction,
  MembershipTier,
  LoyaltySettings,
} from '../types/loyalty';
import {
  getLoyaltyAccountByCustomerId,
  getOrCreateLoyaltyAccount,
  getLoyaltyTransactions,
  getCustomerVouchers,
  getMembershipTiers,
  getLoyaltySettings,
  checkAndIssueBirthdayReward,
  syncCustomerLoyalty,
} from '../lib/loyaltyService';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import { useCustomerAuth } from '../context/CustomerAuthContext';

export interface CustomerRewardsViewProps {
  onStartBooking: () => void;
  onRequestLogin?: () => void;
  onRequestRegister?: () => void;
}

export const CustomerRewardsView: React.FC<CustomerRewardsViewProps> = ({
  onStartBooking,
  onRequestLogin,
  onRequestRegister,
}) => {
  const { currentCustomer, isCustomerAuthenticated, isCustomerPreviewMode } = useCustomerAuth();

  // Signed-out visitors can't read loyalty data (Firestore rules require an authenticated owner).
  const isSignedOutVisitor = !isCustomerAuthenticated && !isCustomerPreviewMode;

  const [phoneInput, setPhoneInput] = useState(() => {
    if (isCustomerPreviewMode) return '';
    return (isCustomerAuthenticated ? currentCustomer?.phone : '') || localStorage.getItem('senzu_customer_phone') || '';
  });
  const [account, setAccount] = useState<CustomerLoyaltyAccount | null>(null);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [vouchers, setVouchers] = useState<CustomerVoucher[]>([]);
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([]);
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [copiedVoucherId, setCopiedVoucherId] = useState<string | null>(null);

  // Load tiers & settings
  useEffect(() => {
    getMembershipTiers().then(setTiers).catch(() => {});
    getLoyaltySettings().then(setSettings).catch(() => {});
  }, []);

  // Load account if phone exists (Disabled auto-loading in Staff Preview Mode)
  useEffect(() => {
    if (isCustomerPreviewMode && !phoneInput) {
      setAccount(null);
      setVouchers([]);
      setTransactions([]);
      return;
    }
    const clean = phoneInput.replace(/[^0-9]/g, '');
    // A signed-out visitor has no account to read, so skip the request the rules would deny anyway.
    if (isSignedOutVisitor) return;
    if (isCustomerAuthenticated && currentCustomer?.id) {
      loadCustomerLoyalty(clean);
    } else if (clean.length >= 8) {
      loadCustomerLoyalty(clean);
    }
  }, [phoneInput, isCustomerPreviewMode, isSignedOutVisitor, isCustomerAuthenticated, currentCustomer?.id]);

  const loadCustomerLoyalty = async (phone: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      // Logged-in customers own a CRM profile (cust_u_<uid>); the phone key is only the guest fallback.
      // Credit any completed + paid order that still has no ledger entry before reading the balance.
      if (isCustomerAuthenticated) await syncCustomerLoyalty();
      const custId = isCustomerAuthenticated && currentCustomer?.id ? currentCustomer.id : `cust_${phone}`;
      let acc = await getLoyaltyAccountByCustomerId(custId);
      if (!acc) {
        acc = await getOrCreateLoyaltyAccount({
          id: custId,
          name: currentCustomer?.name || `Pelanggan ${phone.slice(-4)}`,
          phone: currentCustomer?.phone || phone,
          whatsapp: currentCustomer?.whatsapp || phone,
          email: currentCustomer?.email,
        });
      }
      setAccount(acc);

      // Check birthday perk if birthDate is set
      if (acc.birthDate) {
        await checkAndIssueBirthdayReward(custId, acc.birthDate).catch(() => {});
      }

      // Load subdata
      const [vchs, txs] = await Promise.all([
        getCustomerVouchers(custId).catch(() => []),
        getLoyaltyTransactions(custId).catch(() => []),
      ]);
      setVouchers(vchs);
      setTransactions(txs);
    } catch (err) {
      console.warn('Could not load customer loyalty:', err);
      const code = (err as any)?.code;
      setErrorMessage(
        code === 'AUTH_REQUIRED'
          ? 'Silakan masuk ke akun Anda untuk melihat dan mengumpulkan poin loyalitas.'
          : // Show the server's own reason (already Indonesian) so a failure is diagnosable, not generic.
            (code && (err as any)?.message) ||
            'Terjadi kendala saat memuat data loyalitas. Silakan coba sesaat lagi.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = phoneInput.replace(/[^0-9]/g, '');
    if (clean.length >= 8) {
      localStorage.setItem('senzu_customer_phone', clean);
      loadCustomerLoyalty(clean);
    }
  };

  const handleCopyReferral = () => {
    if (!account?.referralCode) return;
    navigator.clipboard.writeText(account.referralCode);
    setCopiedReferral(true);
    setTimeout(() => setCopiedReferral(false), 2000);
  };

  const handleShareReferralWA = () => {
    if (!account?.referralCode) return;
    const text = `Halo! Pakai kode referral saya *${account.referralCode}* di Senzu Home Reflexology Palembang dan nikmati diskon treatment pijat & refleksi langsung ke rumah. Kunjungi https://senzu.home`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  // Find next tier for progression
  const currentTier = tiers.find((t) => t.id === account?.currentTierId) || tiers[0];
  const nextTier = tiers.find((t) => t.level === (currentTier?.level || 1) + 1);

  const spendProgress = nextTier
    ? Math.min(100, Math.round(((account?.qualifiedSpend || 0) / nextTier.minimumQualifiedSpend) * 100))
    : 100;

  return (
    <div className="space-y-4 pb-24 max-w-3xl mx-auto">
      {/* Phone Connect Header */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-3">
        {isCustomerPreviewMode && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[#082A4F]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span className="text-xs font-semibold text-[#082A4F]">
                Mode Pratinjau Rewards & Poin Pelanggan
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#082A4F] text-[#FDF3CD]">
              Sesi Staf Aktif
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif font-bold text-lg sm:text-xl text-[#082A4F] flex items-center gap-2">
              <Award className="w-5 h-5 text-[#D4AF37]" />
              <span>Senzu Rewards & Membership</span>
            </h1>
            <p className="text-xs text-slate-500">
              Kumpulkan poin loyalitas di setiap treatment, nikmati diskon & voucher eksklusif
            </p>
          </div>
        </div>

        {/* Input Phone — signed-out visitors can't read loyalty data, so offer sign-in instead */}
        {isSignedOutVisitor ? (
          <div className="text-center space-y-3 py-2">
            <div className="w-12 h-12 rounded-2xl bg-[#082A4F]/5 border border-[#D4AF37]/30 flex items-center justify-center mx-auto">
              <Award className="w-6 h-6 text-[#D4AF37]" />
            </div>
            <div className="space-y-1">
              <h2 className="font-serif font-bold text-base text-[#082A4F]">
                Masuk untuk melihat poin Anda
              </h2>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Poin dikumpulkan dari setiap pesanan yang selesai & sudah dibayar, dan baru tampil setelah Anda masuk ke akun.
              </p>
            </div>
            <div className="flex gap-2 max-w-xs mx-auto">
              <button
                type="button"
                onClick={onRequestLogin}
                className="flex-1 py-2 rounded-2xl bg-[#082A4F] text-white text-xs font-bold hover:bg-[#0D3866] transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Masuk</span>
              </button>
              <button
                type="button"
                onClick={onRequestRegister}
                className="flex-1 py-2 rounded-2xl bg-white border border-slate-200 text-[#082A4F] text-xs font-bold hover:bg-slate-50 transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Daftar Akun</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePhoneSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Masukkan nomor WhatsApp member Anda"
                className="w-full pl-9 pr-3 py-2 rounded-2xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#082A4F] bg-slate-50/50"
              />
              <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 rounded-2xl bg-[#082A4F] text-white text-xs font-bold hover:bg-[#0D3866] transition cursor-pointer shrink-0"
            >
              {isLoading ? 'Memuat...' : 'Cek Poin'}
            </button>
          </form>
        )}

        {errorMessage && !isSignedOutVisitor && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center justify-between">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => {
                const clean = phoneInput.replace(/[^0-9]/g, '');
                if (clean.length >= 8) loadCustomerLoyalty(clean);
              }}
              className="font-bold underline ml-2 text-rose-800"
            >
              Coba Lagi
            </button>
          </div>
        )}
      </div>

      {/* Membership Card (Benchmark: Alfagift / Grab Rewards Card) — hidden when signed out, a read without auth always reports 0 points */}
      {!isSignedOutVisitor && (
      <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#082A4F] via-[#0D3866] to-[#061F3B] text-white p-5 sm:p-6 shadow-xl border border-[#D4AF37]/40">
        <div className="absolute -right-10 -bottom-10 w-44 h-44 rounded-full bg-[#D4AF37]/15 blur-2xl pointer-events-none" />

        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <span className="text-[10px] text-slate-300 uppercase tracking-widest font-semibold block">
                SENZU WELLNESS CLUB
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-serif text-lg font-bold text-white tracking-wide">
                  {account?.customerName || 'Member Baru Senzu'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-gradient-to-r from-[#D4AF37] to-[#B89628] text-[#082A4F]">
                  {account?.currentTierName || 'MEMBER'}
                </span>
              </div>
            </div>

            <div className="w-10 h-10 rounded-xl bg-white/10 border border-[#D4AF37]/40 flex items-center justify-center">
              <Award className="w-5 h-5 text-[#D4AF37]" />
            </div>
          </div>

          {/* Points Balance */}
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-[10px] text-slate-300 block uppercase font-medium">Saldo Poin Anda</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Coins className="w-5 h-5 text-[#D4AF37]" />
                <span className="font-mono text-2xl sm:text-3xl font-extrabold text-[#FDF3CD]">
                  {account?.pointsBalance ?? 0}
                </span>
                <span className="text-xs text-slate-300">Poin</span>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] text-slate-300 block uppercase font-medium">Nilai Tukar</span>
              <span className="font-mono text-sm font-bold text-[#D4AF37]">
                ≈ {formatRupiah((account?.pointsBalance ?? 0) * (settings?.pointRupiahRedemptionValue || settings?.pointsPerCurrencyUnit || 100))}
              </span>
            </div>
          </div>

          {/* Next Tier Progression */}
          {nextTier && (
            <div className="space-y-1.5 pt-1 border-t border-white/10">
              <div className="flex justify-between text-[11px] text-slate-300">
                <span>Menuju tier <strong>{nextTier.name}</strong></span>
                <span className="font-mono font-bold text-[#D4AF37]">{spendProgress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#D4AF37] to-[#FDF3CD] rounded-full transition-all duration-500"
                  style={{ width: `${spendProgress}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400">
                Belanja {formatRupiah(Math.max(0, nextTier.minimumQualifiedSpend - (account?.qualifiedSpend || 0)))} lagi untuk naik tier
              </p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Referral Card */}
      {account && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-400/15 to-orange-500/10 border border-amber-300 rounded-3xl p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#082A4F] text-[#D4AF37] flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-[#082A4F]">
                  Program Ajak Teman (Referral)
                </h3>
                <p className="text-[10px] text-slate-600">
                  Dapatkan bonus 200 poin untuk setiap teman yang menyelesaikan treatment pertama.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-3 rounded-2xl border border-amber-200 flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Kode Referral Anda</span>
              <span className="font-mono font-bold text-sm text-[#082A4F] tracking-wider">
                {account.referralCode}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyReferral}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer transition"
              >
                {copiedReferral ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedReferral ? 'Tersalin' : 'Salin'}</span>
              </button>

              <button
                type="button"
                onClick={handleShareReferralWA}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition shadow-2xs"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share WA</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vouchers & Promo Codes List */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-3">
        <h3 className="font-serif font-bold text-sm sm:text-base text-[#082A4F] flex items-center gap-2">
          <Ticket className="w-4 h-4 text-[#D4AF37]" />
          <span>Voucher Saya ({vouchers.filter((v) => v.status === 'available').length})</span>
        </h3>

        {vouchers.length === 0 ? (
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center text-xs text-slate-500 space-y-2">
            <p>Belum ada voucher khusus yang tersimpan di akun Anda.</p>
            <p className="text-[11px] text-slate-400">
              Gunakan kode promo publik seperti <strong>SENZUWELCOME</strong> saat memesan treatment.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {(vouchers || []).map((vch) => {
              const isAvailable = vch.status === 'available';
              return (
                <div
                  key={vch.id}
                  className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                    isAvailable
                      ? 'bg-amber-50/50 border-amber-200'
                      : 'bg-slate-50 border-slate-200 opacity-60'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0">
                    <span className="font-mono font-bold text-xs text-[#082A4F]">
                      {vch.voucherCode}
                    </span>
                    <p className="font-semibold text-xs text-slate-800 truncate">
                      {vch.voucherName}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Berlaku s/d {formatDateIndo(vch.expiresAt || vch.expiredAt)}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-mono font-bold text-xs text-amber-700 block">
                      {vch.voucherType === 'percentage_discount' ? `${vch.value}%` : formatRupiah(vch.value)}
                    </span>
                    <button
                      type="button"
                      onClick={onStartBooking}
                      disabled={!isAvailable}
                      className="mt-1 px-3 py-1 rounded-lg bg-[#082A4F] text-[#FDF3CD] text-[10px] font-bold hover:bg-[#0D3866] transition disabled:opacity-50 cursor-pointer"
                    >
                      Pakai
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Points History (Mutasi) */}
      {transactions.length > 0 && (
        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-3">
          <h3 className="font-serif font-bold text-sm sm:text-base text-[#082A4F]">
            Riwayat Mutasi Poin
          </h3>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {(transactions || []).slice(0, 8).map((tx) => {
              const isPositive = tx.points > 0;
              return (
                <div
                  key={tx.id}
                  className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-100 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-800">{tx.reason}</p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {formatDateIndo(tx.createdAt)}
                    </p>
                  </div>

                  <div className="text-right shrink-0 font-mono">
                    <span
                      className={`font-bold text-xs ${
                        isPositive ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {isPositive ? `+${tx.points}` : tx.points}
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      Saldo: {tx.balanceAfter}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
