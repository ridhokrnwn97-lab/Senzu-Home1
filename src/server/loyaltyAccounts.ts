import type { Express } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { DEFAULT_LOYALTY_SETTINGS } from '../types/loyalty.ts';
import { safeId, canonicalOwner, resolveActiveStaff, requireIdentity, requireBookingAccess, securityError } from './securityRepairs.ts';

// Firestore rules only let operational staff write loyalty_accounts / loyalty_transactions,
// so point earning and account creation have to run here (Admin SDK) instead of the client.
const paidStatus = (value: unknown) => String(value || '').toLowerCase() === 'paid';
const digits = (value: unknown) => String(value || '').replace(/\D/g, '');
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const memberNumberFor = (value: string) => `SZH-${value.slice(-6).padStart(6, '0')}`;
const referralCodeFor = (name: string, value: string) => {
  const clean = name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5) || 'SENZU';
  const tail = value.slice(-3) || String(Math.floor(100 + Math.random() * 900));
  return `SENZU-${clean}${tail}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
};

export function registerLoyaltyAccounts(app: Express, db: Firestore | null, verify: (token: string) => Promise<any>) {
  const failure = (res: any, e: any) => {
    const known = Number(e?.status) >= 400 && Number(e?.status) < 500;
    const message = known ? e.message : 'Layanan loyalitas sementara tidak tersedia.';
    return res.status(e?.status || 503).json({ success: false, code: e?.code || 'SERVICE_UNAVAILABLE', error: message, message });
  };
  const store = () => {
    if (!db) throw securityError(503, 'SERVICE_UNAVAILABLE', 'Layanan loyalitas sementara tidak tersedia.');
    return db;
  };

  console.log(`[Loyalty] routes registered (adminDb: ${db ? 'available' : 'MISSING'})`);

  /**
   * Idempotent point earning for a completed + fully paid booking.
   * Callable by the assigned therapist, the booking owner, or operational staff.
   * shortcut: no loyalty.points_earned notification and no referral qualification here; add both when those flows are wired to the server.
   */
  app.post('/api/loyalty/earn', async (req, res) => {
    try {
      const firestore = store();
      const bookingId = safeId(text(req.body?.bookingId));
      await requireIdentity(req, verify);

      const result = await firestore.runTransaction(async (t) => {
        const bookingSnap = await t.get(firestore.collection('bookings').doc(bookingId));
        if (!bookingSnap.exists) throw securityError(404, 'BOOKING_NOT_FOUND', 'Reservasi tidak ditemukan.');
        const booking: any = bookingSnap.data() || {};
        // Assigned therapist, booking owner or operational staff - same rule the client write needed.
        await requireBookingAccess(req, firestore, verify, booking, true);
        if (booking.status !== 'Completed' || !paidStatus(booking.paymentStatus)) {
          return { pointsEarned: 0, balance: null, reason: 'NOT_ELIGIBLE' };
        }

        const ledgerRef = firestore.collection('loyalty_transactions').doc(`ltx_earn_${bookingId}`);
        const prior = await t.get(ledgerRef);
        if (prior.exists) {
          return { pointsEarned: 0, balance: Number(prior.data()?.balanceAfter || 0), reason: 'ALREADY_EARNED' };
        }

        const settingsSnap = await t.get(firestore.collection('loyalty_settings').doc('general'));
        const settings: any = { ...DEFAULT_LOYALTY_SETTINGS, ...(settingsSnap.data() || {}) };
        if (settings.loyaltyEnabled === false) return { pointsEarned: 0, balance: null, reason: 'DISABLED' };

        const whatsapp = digits(booking.customerWhatsApp);
        const customerId = safeId(text(booking.customerId) || `cust_${whatsapp}`);
        const accountRef = firestore.collection('loyalty_accounts').doc(customerId);
        const accountSnap = await t.get(accountRef);
        const now = new Date().toISOString();
        const account: any = accountSnap.data() || {
          id: customerId,
          customerId,
          memberNumber: memberNumberFor(whatsapp || customerId.replace(/\D/g, '')),
          customerName: text(booking.customerName) || 'Pelanggan Senzu',
          customerPhone: text(booking.customerWhatsApp),
          customerWhatsApp: text(booking.customerWhatsApp),
          customerEmail: text(booking.customerEmail),
          pointsBalance: 0,
          lifetimePointsEarned: 0,
          lifetimePointsRedeemed: 0,
          lifetimePointsExpired: 0,
          currentTierId: 'member',
          currentTierName: 'Member',
          tierStartedAt: now,
          tierExpiresAt: null,
          qualifiedSpend: 0,
          qualifiedBookings: 0,
          referralCode: referralCodeFor(text(booking.customerName) || 'Pelanggan', whatsapp),
          referralCount: 0,
          birthdayBenefitUsedYear: null,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        if (['suspended', 'closed'].includes(String(account.status))) {
          return { pointsEarned: 0, balance: null, reason: 'ACCOUNT_INACTIVE' };
        }

        const tiersSnap = await t.get(firestore.collection('membership_tiers'));
        const tiers: any[] = tiersSnap.docs.map((d) => d.data());
        const currentTier = tiers.find((x) => x.id === account.currentTierId) || tiers.find((x) => x.id === 'member');
        const multiplier = Number(currentTier?.earningMultiplier) > 0 ? Number(currentTier.earningMultiplier) : 1;

        const discounts =
          Number(booking.voucherDiscount || 0) +
          Number(booking.pointsDiscount || 0) +
          Number(booking.promoDiscount || 0) +
          Number(booking.discountAmount || 0);
        let netSpend = Math.max(0, Number(booking.servicePrice || 0) - discounts);
        if (settings.includeHomeServiceFeeForPoints) netSpend += Number(booking.homeServiceFee || 0);
        const spendPerPoint = Number(settings.spendPerPoint) > 0 ? Number(settings.spendPerPoint) : 10000;
        const basePoints = Math.floor(netSpend / spendPerPoint);
        const points = Math.floor(basePoints * multiplier);
        if (points <= 0) {
          return { pointsEarned: 0, balance: Number(account.pointsBalance || 0), reason: 'NO_POINTS' };
        }

        const qualifiedSpend = Number(account.qualifiedSpend || 0) + netSpend;
        const qualifiedBookings = Number(account.qualifiedBookings || 0) + 1;
        let currentTierId = account.currentTierId;
        let currentTierName = account.currentTierName;
        if (settings.membershipEnabled !== false) {
          const eligible = tiers
            .filter((x) => x.enabled)
            .sort((a, b) => Number(b.level || 0) - Number(a.level || 0))
            .find(
              (x) =>
                qualifiedSpend >= Number(x.minimumQualifiedSpend || 0) &&
                qualifiedBookings >= Number(x.minimumCompletedBookings || 0)
            );
          if (eligible && Number(eligible.level || 0) > Number(currentTier?.level || 1)) {
            currentTierId = eligible.id;
            currentTierName = eligible.name;
          }
        }

        const expiresAt =
          settings.pointsExpireEnabled && Number(settings.pointsValidityDays) > 0
            ? new Date(Date.now() + Number(settings.pointsValidityDays) * 86400000).toISOString()
            : null;
        const balanceBefore = Number(account.pointsBalance || 0);
        const balanceAfter = balanceBefore + points;

        t.set(accountRef, {
          ...account,
          pointsBalance: balanceAfter,
          lifetimePointsEarned: Number(account.lifetimePointsEarned || 0) + points,
          qualifiedSpend,
          qualifiedBookings,
          currentTierId,
          currentTierName,
          updatedAt: now,
        });
        t.set(ledgerRef, {
          id: ledgerRef.id,
          customerId,
          customerName: account.customerName,
          customerAuthUid: canonicalOwner(booking) || null,
          bookingId,
          bookingCode: text(booking.bookingCode) || null,
          transactionType: 'earn',
          points,
          balanceBefore,
          balanceAfter,
          referenceType: 'booking',
          referenceId: bookingId,
          reason: `Poin dari pesanan ${text(booking.bookingCode) || bookingId}`,
          createdBy: 'system',
          createdAt: now,
          expiresAt,
          metadata: { serviceName: text(booking.serviceName) || null, basePoints, earningMultiplier: multiplier, netSpend },
        });

        return { pointsEarned: points, balance: balanceAfter, reason: 'Earned' };
      });

      return res.json({ success: true, ...result });
    } catch (e) {
      return failure(res, e);
    }
  });

  /**
   * Resolve the caller's loyalty account, creating it on first use.
   * Only the owning customer (customers.authUserId == uid) or operational staff may create one.
   */
  app.post('/api/loyalty/account/ensure', async (req, res) => {
    try {
      const firestore = store();
      const identity = await requireIdentity(req, verify);
      const staff = await resolveActiveStaff(firestore, identity.uid);
      const operational = !!staff && ['manager', 'admin', 'css', 'supervisor'].includes(String(staff.role));

      let customerId = text(req.body?.customerId);
      if (!customerId) {
        const own = await firestore.collection('customers').where('authUserId', '==', identity.uid).limit(2).get();
        if (own.size > 1) throw securityError(403, 'OWNERSHIP_CONFLICT', 'Profil pelanggan memerlukan pemeriksaan staf.');
        if (own.size === 1) customerId = own.docs[0].id;
      }
      if (!customerId) throw securityError(403, 'PERMISSION_DENIED', 'Profil pelanggan tidak ditemukan untuk akun ini.');
      customerId = safeId(customerId);

      // Ownership is checked before any read so an existing account is never handed to another customer.
      const profileSnap = await firestore.collection('customers').doc(customerId).get();
      const profile: any = profileSnap.data() || null;
      if (!operational && profile?.authUserId !== identity.uid) {
        throw securityError(403, 'PERMISSION_DENIED', 'Akses ditolak.');
      }

      const accountRef = firestore.collection('loyalty_accounts').doc(customerId);
      const accountSnap = await accountRef.get();
      if (accountSnap.exists) return res.json({ success: true, account: { ...accountSnap.data(), id: customerId } });

      const whatsapp = text(profile?.whatsapp) || text(profile?.phone) || text(req.body?.whatsapp) || text(req.body?.phone);
      const name = text(profile?.name) || text(req.body?.name) || 'Pelanggan Senzu';
      const now = new Date().toISOString();
      const account = {
        id: customerId,
        customerId,
        memberNumber: memberNumberFor(digits(whatsapp) || customerId.replace(/\D/g, '')),
        customerName: name,
        customerPhone: text(profile?.phone) || text(req.body?.phone) || whatsapp,
        customerWhatsApp: whatsapp,
        customerEmail: text(profile?.email) || text(req.body?.email),
        pointsBalance: 0,
        lifetimePointsEarned: 0,
        lifetimePointsRedeemed: 0,
        lifetimePointsExpired: 0,
        currentTierId: 'member',
        currentTierName: 'Member',
        tierStartedAt: now,
        tierExpiresAt: null,
        qualifiedSpend: 0,
        qualifiedBookings: 0,
        referralCode: referralCodeFor(name, digits(whatsapp) || customerId.replace(/\D/g, '')),
        referralCount: 0,
        birthdayBenefitUsedYear: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      await accountRef.set(account);
      return res.json({ success: true, account });
    } catch (e) {
      return failure(res, e);
    }
  });
}
