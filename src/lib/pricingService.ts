/**
 * Central Pricing Service for Senzu Home Palembang
 * Single Source of Truth for booking totals, discounts, vouchers, and points redemption.
 */

import { Voucher, CustomerVoucher, MembershipTier, LoyaltySettings } from '../types/loyalty';

export interface PricingInput {
  servicePrice: number;
  homeServiceFee: number;
  promoVoucher?: Voucher | null;
  customerVoucher?: CustomerVoucher | null;
  pointsToRedeem?: number; // Raw points customer wants to redeem
  customerTier?: MembershipTier | null;
  settings?: LoyaltySettings | null;
}

export interface PricingBreakdown {
  servicePrice: number;
  homeServiceFee: number;
  grossAmount: number; // servicePrice + homeServiceFee

  // Discounts
  tierDiscountAmount: number;
  promoDiscountAmount: number;
  voucherDiscountAmount: number;
  totalPromoAndVoucherDiscount: number;

  // Points Redemption
  pointsRedeemed: number;
  pointsDiscountAmount: number;

  // Final Net
  totalDiscount: number;
  finalAmount: number; // Never negative

  // Loyalty Earnings
  qualifiedSpendForPoints: number;
  estimatedPointsEarned: number;

  // Validation messages if any
  warnings: string[];
}

/**
 * Calculates the exact pricing breakdown for a booking.
 * Order of operations:
 * 1. Base Service Price
 * 2. Tier automatic discount (if any)
 * 3. + Home Service Fee
 * 4. - Promo / Voucher Discount
 * 5. - Point Redemption (capped at maximumRedemptionPercentage)
 * 6. = Final Amount
 */
export function calculateBookingPrice(input: PricingInput): PricingBreakdown {
  const warnings: string[] = [];
  const servicePrice = Math.max(0, input.servicePrice || 0);
  const homeServiceFee = Math.max(0, input.homeServiceFee || 0);
  const grossAmount = servicePrice + homeServiceFee;

  // 1. Tier percentage discount (applied directly to service price if configured)
  let tierDiscountAmount = 0;
  if (input.customerTier && input.customerTier.discountPercentage > 0) {
    tierDiscountAmount = Math.floor((servicePrice * input.customerTier.discountPercentage) / 100);
  }

  const priceAfterTier = Math.max(0, servicePrice - tierDiscountAmount);

  // 2. Voucher / Promo Discount
  let promoDiscountAmount = 0;
  let voucherDiscountAmount = 0;

  // Check general promo voucher
  if (input.promoVoucher && input.promoVoucher.enabled) {
    const promo = input.promoVoucher;
    if (priceAfterTier >= (promo.minimumSpend || 0)) {
      if (promo.voucherType === 'fixed_discount' || (promo.voucherType as any) === 'FIXED_AMOUNT') {
        promoDiscountAmount = promo.value;
      } else if (
        promo.voucherType === 'percentage_discount' ||
        promo.voucherType === 'percentage' ||
        (promo.voucherType as any) === 'PERCENTAGE'
      ) {
        let disc = Math.floor((priceAfterTier * promo.value) / 100);
        if (promo.maximumDiscount && promo.maximumDiscount > 0) {
          disc = Math.min(disc, promo.maximumDiscount);
        }
        promoDiscountAmount = disc;
      } else if (promo.voucherType === 'free_home_service_fee') {
        promoDiscountAmount = homeServiceFee;
      }
    } else {
      warnings.push(`Kode promo memerlukan minimal transaksi Rp ${(promo.minimumSpend || 0).toLocaleString('id-ID')}`);
    }
  }

  // Check customer personal voucher (if not stacking or stacking permitted)
  if (input.customerVoucher && input.customerVoucher.status === 'available') {
    const cv = input.customerVoucher;
    if (priceAfterTier >= (cv.minimumSpend || 0)) {
      if (cv.voucherType === 'fixed_discount') {
        voucherDiscountAmount = cv.value;
      } else if (cv.voucherType === 'percentage_discount') {
        let disc = Math.floor((priceAfterTier * cv.value) / 100);
        if (cv.maximumDiscount && cv.maximumDiscount > 0) {
          disc = Math.min(disc, cv.maximumDiscount);
        }
        voucherDiscountAmount = disc;
      } else if (cv.voucherType === 'free_home_service_fee') {
        voucherDiscountAmount = homeServiceFee;
      }
    } else {
      warnings.push(`Voucher memerlukan minimal transaksi Rp ${(cv.minimumSpend || 0).toLocaleString('id-ID')}`);
    }
  }

  // If stacking not allowed and both provided, take the best one
  const allowStacking = input.settings?.allowStacking ?? false;
  let totalPromoAndVoucherDiscount = 0;
  if (!allowStacking && promoDiscountAmount > 0 && voucherDiscountAmount > 0) {
    if (voucherDiscountAmount >= promoDiscountAmount) {
      promoDiscountAmount = 0;
      totalPromoAndVoucherDiscount = voucherDiscountAmount;
    } else {
      voucherDiscountAmount = 0;
      totalPromoAndVoucherDiscount = promoDiscountAmount;
    }
  } else {
    totalPromoAndVoucherDiscount = promoDiscountAmount + voucherDiscountAmount;
  }

  // Cap voucher discount to not exceed the servicePrice + fee
  totalPromoAndVoucherDiscount = Math.min(totalPromoAndVoucherDiscount, priceAfterTier + homeServiceFee);

  const amountAfterVouchers = Math.max(0, priceAfterTier + homeServiceFee - totalPromoAndVoucherDiscount);

  // 3. Points Redemption
  // Conversion: pointsPerCurrencyUnit (e.g. 10 Points = Rp 1.000 -> 1 pt = Rp 100)
  const pointsPerCurrencyUnit = input.settings?.pointsPerCurrencyUnit || 10;
  const valuePerPoint = 1000 / pointsPerCurrencyUnit; // e.g. 100 Rp per point
  const minPointsToRedeem = input.settings?.minimumPointsToRedeem || 50;
  const maxRedemptionPercentage = input.settings?.maximumRedemptionPercentage || 30; // max 30% of booking value

  let requestedPoints = Math.max(0, Math.floor(input.pointsToRedeem || 0));
  let pointsRedeemed = 0;
  let pointsDiscountAmount = 0;

  if (requestedPoints > 0) {
    if (requestedPoints < minPointsToRedeem) {
      warnings.push(`Minimal penukaran poin adalah ${minPointsToRedeem} Poin.`);
    } else {
      // Maximum rupiah allowed from points = (grossAmount * maxRedemptionPercentage) / 100
      const maxAllowedDiscountRp = Math.floor((grossAmount * maxRedemptionPercentage) / 100);
      const maxAllowedPoints = Math.floor(maxAllowedDiscountRp / valuePerPoint);

      pointsRedeemed = Math.min(requestedPoints, maxAllowedPoints);
      pointsDiscountAmount = pointsRedeemed * valuePerPoint;

      // Ensure points discount does not exceed remaining amount
      if (pointsDiscountAmount > amountAfterVouchers) {
        pointsDiscountAmount = amountAfterVouchers;
        pointsRedeemed = Math.floor(pointsDiscountAmount / valuePerPoint);
      }
    }
  }

  // 4. Final Amount
  const totalDiscount = tierDiscountAmount + totalPromoAndVoucherDiscount + pointsDiscountAmount;
  const finalAmount = Math.max(0, grossAmount - totalDiscount);

  // 5. Estimated Points Earning Calculation
  // Net qualified spend: Net treatment price after discounts
  const includeHomeServiceFee = input.settings?.includeHomeServiceFeeForPoints ?? false;
  const spendPerPoint = input.settings?.spendPerPoint || 10000;
  const multiplier = input.customerTier?.earningMultiplier || 1.0;

  // Qualified spend = servicePrice - discounts (+ homeServiceFee if allowed)
  let qualifiedSpendForPoints = servicePrice - tierDiscountAmount - totalPromoAndVoucherDiscount - pointsDiscountAmount;
  if (includeHomeServiceFee) {
    qualifiedSpendForPoints += homeServiceFee;
  }
  qualifiedSpendForPoints = Math.max(0, qualifiedSpendForPoints);

  const basePointsEarned = Math.floor(qualifiedSpendForPoints / spendPerPoint);
  const estimatedPointsEarned = Math.floor(basePointsEarned * multiplier);

  return {
    servicePrice,
    homeServiceFee,
    grossAmount,
    tierDiscountAmount,
    promoDiscountAmount,
    voucherDiscountAmount,
    totalPromoAndVoucherDiscount,
    pointsRedeemed,
    pointsDiscountAmount,
    totalDiscount,
    finalAmount,
    qualifiedSpendForPoints,
    estimatedPointsEarned,
    warnings,
  };
}
