// Loyalty & Membership Types for Senzu Home Palembang

export type LoyaltyAccountStatus = 'active' | 'suspended' | 'closed';

export type LoyaltyTransactionType =
  | 'earn'
  | 'redeem'
  | 'expire'
  | 'refund_adjustment'
  | 'manual_credit'
  | 'manual_debit'
  | 'referral_bonus'
  | 'birthday_bonus'
  | 'promotion_bonus'
  | 'tier_bonus';

export interface CustomerLoyaltyAccount {
  id: string; // matches customerId (e.g. cust_6281272902321)
  customerId: string;
  memberNumber: string; // e.g. SZH-0001234
  customerName: string;
  customerPhone: string;
  customerWhatsApp?: string;
  customerEmail?: string;
  birthDate?: string; // YYYY-MM-DD optional

  pointsBalance: number;
  lifetimePointsEarned: number;
  lifetimePointsRedeemed: number;
  lifetimePointsExpired: number;

  currentTierId: string; // 'member' | 'silver' | 'gold' | 'platinum'
  currentTierName: string; // 'Member' | 'Silver' | 'Gold' | 'Platinum'
  tierStartedAt: string; // ISO
  tierExpiresAt?: string | null;

  qualifiedSpend: number; // IDR
  qualifiedBookings: number;

  referralCode: string; // e.g. SENZU-RIDHO8X
  referralCount: number;
  referredByCustomerId?: string;
  referredByCode?: string;

  birthdayBenefitUsedYear?: number | null;

  status: LoyaltyAccountStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  customerName?: string;
  bookingId?: string;
  bookingCode?: string;
  transactionType: LoyaltyTransactionType;
  points: number; // positive for earn/bonus, negative for redeem/expire
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string; // 'booking' | 'referral' | 'birthday' | 'manual' | 'expiry' | 'promo'
  referenceId: string;
  reason: string;
  createdBy: string; // 'system' | staff user email/name
  createdAt: string; // ISO
  expiresAt?: string | null;
  metadata?: {
    basePoints?: number;
    tierMultiplier?: number;
    finalPoints?: number;
    spendAmount?: number;
    redemptionDiscount?: number;
    notes?: string;
    [key: string]: any;
  };
}

export interface MembershipTier {
  id: string; // 'member' | 'silver' | 'gold' | 'platinum'
  name: string;
  level: number; // 1, 2, 3, 4
  minimumQualifiedSpend: number; // IDR
  minimumCompletedBookings: number;
  earningMultiplier: number; // 1.0, 1.1, 1.25, 1.5
  discountPercentage: number; // e.g. 0, 5, 7.5, 10%
  birthdayBenefitType: 'points' | 'voucher' | 'none';
  birthdayBenefitValue: number; // points or voucher ID
  priorityBooking: boolean;
  specialVoucherEnabled: boolean;
  badgeLabel: string;
  cardGradient: string; // visual style
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  // Backward compatibility fields
  minimumSpend?: number;
  minimumBookings?: number;
  pointMultiplier?: number;
  birthdayBonusPoints?: number;
  badgeColor?: string;
  description?: string;
  perks?: string[];
}

export type VoucherType =
  | 'fixed_discount'
  | 'percentage_discount'
  | 'percentage'
  | 'free_home_service_fee'
  | 'points_bonus'
  | 'special_reward';

export interface Voucher {
  id: string;
  code?: string; // e.g. SENZUWELCOME
  name: string;
  description: string;
  voucherType: VoucherType;
  value: number; // IDR discount or percentage (1-100) or points bonus
  maximumDiscount?: number; // for percentage vouchers
  minimumSpend: number; // minimum treatment / booking spend
  minimumTreatmentPrice?: number;
  minimumTreatmentDuration?: number; // minimum duration in minutes
  applicableServiceIds?: string[]; // empty means all services
  applicableCategoryIds?: string[]; // empty means all categories
  applicableTierIds?: string[]; // empty means all tiers
  customerSpecific?: boolean;
  customerId?: string;
  usageLimitTotal?: number;
  usageLimitPerCustomer?: number;
  currentUsageCount?: number;
  firstOrderOnly?: boolean; // e.g. for SENZUWELCOME
  newCustomerOnly?: boolean;
  validFrom: string; // ISO
  validUntil: string; // ISO
  stackable: boolean;
  enabled: boolean;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface PromoValidationResult {
  valid: boolean;
  voucher?: Voucher;
  discountAmount?: number;
  errorMessage?: string;
}

export interface VoucherRedemption {
  id: string;
  voucherId: string;
  voucherCode: string;
  customerId: string;
  customerAuthUid?: string;
  customerPhone?: string;
  normalizedPhone?: string;
  bookingId: string;
  bookingCode: string;
  discountAmount: number;
  redeemedAt: string;
  status: 'active' | 'used' | 'completed' | 'cancelled';
}

export interface PromoValidationParams {
  promoCode: string;
  servicePrice: number;
  serviceId?: string;
  serviceCategory?: string;
  serviceDuration?: number;
  customerId?: string;
  customerAuthUid?: string;
  customerWhatsApp?: string;
  customerEmail?: string;
  homeServiceFee?: number;
}

export type CustomerVoucherStatus =
  | 'available'
  | 'reserved'
  | 'used'
  | 'expired'
  | 'cancelled';

export interface CustomerVoucher {
  id: string;
  voucherId: string;
  customerId: string;
  voucherCode?: string;
  voucherName: string;
  voucherType: VoucherType;
  value: number;
  maximumDiscount?: number;
  minimumSpend: number;
  applicableServiceIds?: string[];
  applicableTierIds?: string[];
  source: 'system' | 'signup' | 'tier_upgrade' | 'birthday' | 'referral' | 'admin_goodwill' | 'claim';
  status: CustomerVoucherStatus;
  assignedAt: string;
  usedAt?: string | null;
  expiredAt: string;
  expiresAt?: string;
  bookingId?: string | null;
  bookingCode?: string | null;
  issuedBy?: string;
  issuedReason?: string;
}

export interface ReferralRecord {
  id: string;
  referrerCustomerId: string;
  referrerName: string;
  referrerPhone: string;
  referralCode: string;
  referredCustomerId: string;
  referredCustomerName: string;
  referredCustomerPhone: string;
  firstBookingId?: string;
  firstBookingCode?: string;
  status: 'pending' | 'qualified' | 'rewarded' | 'flagged_abuse';
  rewardStatus: 'pending' | 'issued' | 'failed';
  referrerRewardPoints: number;
  referredRewardVoucherId?: string;
  qualifiedAt?: string;
  flagReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltySettings {
  id: string; // 'general'
  loyaltyEnabled: boolean;
  spendPerPoint: number; // e.g. 10000 = Rp10.000 -> 1 Point
  pointsExpireEnabled: boolean;
  pointsValidityDays: number; // e.g. 365 days
  minimumPointsToRedeem: number; // e.g. 50 Points
  pointsPerCurrencyUnit: number; // e.g. 10 Points = Rp 1.000 -> 1 Point = Rp 100
  maximumRedemptionPercentage: number; // e.g. 30 (%) of eligible booking value
  includeHomeServiceFeeForPoints: boolean; // default false

  // Referral
  referralEnabled: boolean;
  referrerRewardPoints: number; // e.g. 100 Points
  referredCustomerRewardType: 'voucher' | 'points';
  referredCustomerRewardValue: number; // Rp 25.000 or points
  referredCustomerVoucherName: string;

  // Birthday
  birthdayRewardEnabled: boolean;
  birthdayRewardPoints: number; // e.g. 50 Points
  birthdayValidityDays: number; // e.g. 30 days

  // Membership Tiers
  membershipEnabled: boolean;
  tierQualificationPeriod: 'lifetime' | 'calendar_year' | 'rolling_12_months';
  tierUpgradeRealtime: boolean;

  // Vouchers
  voucherEnabled: boolean;
  allowStacking: boolean;

  // Retroactive / Start Date
  retroactivePointsEnabled: boolean;
  loyaltyProgramStartAt: string; // ISO

  // Backward compatibility fields
  pointValueInRupiah?: number;
  pointRupiahRedemptionValue?: number;
  maxRedeemDiscountPercent?: number;
  minPointsToRedeem?: number;

  updatedAt: string;
  updatedBy?: string;
}

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  id: 'general',
  loyaltyEnabled: true,
  spendPerPoint: 10000, // Rp10.000 = 1 Point
  pointsExpireEnabled: true,
  pointsValidityDays: 365, // 1 year
  minimumPointsToRedeem: 50, // 50 Points min (Rp5.000)
  pointsPerCurrencyUnit: 10, // 10 Points = Rp1.000 (1 pt = Rp100)
  maximumRedemptionPercentage: 30, // max 30% discount
  includeHomeServiceFeeForPoints: false, // Net treatment spend only

  referralEnabled: true,
  referrerRewardPoints: 100, // 100 Points for Referrer
  referredCustomerRewardType: 'voucher',
  referredCustomerRewardValue: 25000, // Rp25.000 voucher for new friend
  referredCustomerVoucherName: 'Voucher Teman Senzu Rp25.000',

  birthdayRewardEnabled: true,
  birthdayRewardPoints: 50,
  birthdayValidityDays: 30,

  membershipEnabled: true,
  tierQualificationPeriod: 'lifetime',
  tierUpgradeRealtime: true,

  voucherEnabled: true,
  allowStacking: false,

  retroactivePointsEnabled: false,
  loyaltyProgramStartAt: '2026-01-01T00:00:00.000Z',

  pointValueInRupiah: 100,
  pointRupiahRedemptionValue: 100,
  maxRedeemDiscountPercent: 30,
  minPointsToRedeem: 50,

  updatedAt: new Date().toISOString(),
};

export const DEFAULT_MEMBERSHIP_TIERS: MembershipTier[] = [
  {
    id: 'member',
    name: 'Member',
    level: 1,
    minimumQualifiedSpend: 0,
    minimumCompletedBookings: 0,
    earningMultiplier: 1.0,
    discountPercentage: 0,
    birthdayBenefitType: 'points',
    birthdayBenefitValue: 25,
    minimumSpend: 0,
    minimumBookings: 0,
    pointMultiplier: 1.0,
    birthdayBonusPoints: 25,
    priorityBooking: false,
    specialVoucherEnabled: false,
    badgeLabel: 'Member',
    cardGradient: 'from-slate-700 to-slate-900',
    enabled: true,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'silver',
    name: 'Silver',
    level: 2,
    minimumQualifiedSpend: 1500000, // Rp 1.500.000
    minimumCompletedBookings: 3,
    earningMultiplier: 1.1, // 1.1x Points
    discountPercentage: 5,
    birthdayBenefitType: 'points',
    birthdayBenefitValue: 50,
    minimumSpend: 1500000,
    minimumBookings: 3,
    pointMultiplier: 1.1,
    birthdayBonusPoints: 50,
    priorityBooking: false,
    specialVoucherEnabled: true,
    badgeLabel: 'Silver',
    cardGradient: 'from-slate-400 via-slate-500 to-slate-700',
    enabled: true,
    sortOrder: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'gold',
    name: 'Gold',
    level: 3,
    minimumQualifiedSpend: 4000000, // Rp 4.000.000
    minimumCompletedBookings: 8,
    earningMultiplier: 1.25, // 1.25x Points
    discountPercentage: 7.5,
    birthdayBenefitType: 'points',
    birthdayBenefitValue: 100,
    minimumSpend: 4000000,
    minimumBookings: 8,
    pointMultiplier: 1.25,
    birthdayBonusPoints: 100,
    priorityBooking: true,
    specialVoucherEnabled: true,
    badgeLabel: 'Gold',
    cardGradient: 'from-amber-500 via-amber-600 to-amber-800',
    enabled: true,
    sortOrder: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'platinum',
    name: 'Platinum',
    level: 4,
    minimumQualifiedSpend: 8000000, // Rp 8.000.000
    minimumCompletedBookings: 15,
    earningMultiplier: 1.5, // 1.5x Points
    discountPercentage: 10,
    birthdayBenefitType: 'points',
    birthdayBenefitValue: 150,
    minimumSpend: 8000000,
    minimumBookings: 15,
    pointMultiplier: 1.5,
    birthdayBonusPoints: 150,
    priorityBooking: true,
    specialVoucherEnabled: true,
    badgeLabel: 'Platinum',
    cardGradient: 'from-slate-900 via-indigo-950 to-[#082A4F]',
    enabled: true,
    sortOrder: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];
