import type { Express, Request } from 'express';
import type { Firestore, DocumentReference } from 'firebase-admin/firestore';
import { createHash, timingSafeEqual, randomInt } from 'node:crypto';
import { resolveNotificationTargets } from '../lib/notificationTargets.ts';
import { DEFAULT_SERVICES } from '../lib/serviceDefaults.ts';
import { calculateHomeServiceFee,SENZU_BASE_LOCATION } from '../lib/distanceFeeService.ts';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../types/notification.ts';

export function generateSecureTempPassword():string{
  const sets=['ABCDEFGHJKLMNPQRSTUVWXYZ','abcdefghijkmnopqrstuvwxyz','23456789','!@#$%^&*_-'],all=sets.join('');
  const chars=sets.map(set=>set[randomInt(set.length)]);
  while(chars.length<14)chars.push(all[randomInt(all.length)]);
  for(let i=chars.length-1;i>0;i--){const j=randomInt(i+1);[chars[i],chars[j]]=[chars[j],chars[i]];}
  return chars.join('');
}
export const securityError = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });
export function safeId(value: any): string {
  if (typeof value !== 'string' || !value || value.includes('/') || value.length > 200) throw securityError(400, 'INVALID_ID', 'ID tidak valid.');
  return value;
}
export function canonicalOwner(data: any): string {
  const a = data?.customerAuthUid || '', b = data?.authUserId || '';
  if (a && b && a !== b) throw securityError(403, 'OWNERSHIP_CONFLICT', 'Kepemilikan memerlukan pemeriksaan staf.');
  return a || b;
}
export function activeStaff(data: any): boolean {
  return !!data && data.isActive !== false && !['inactive','disabled','archived'].includes(String(data.status || '').toLowerCase()) && data.loginAccountStatus !== 'DINONAKTIFKAN';
}
export async function resolveActiveStaff(db: Firestore, uid: string) {
  const matches = new Map<string, any>();
  for (const field of ['authUserId', 'authUid']) {
    const snap = await db.collection('staff_users').where(field, '==', uid).limit(2).get();
    for (const d of snap.docs) matches.set(d.id, { ...d.data(), id: d.id });
  }
  if (matches.size !== 1) return null;
  const staff = [...matches.values()][0];
  if ((staff.authUserId && staff.authUserId !== uid) || (staff.authUid && staff.authUid !== uid) || !activeStaff(staff)) return null;
  const roleSnap = await db.collection('staff_roles').doc(uid).get();
  const role = roleSnap.data();
  // Staff Master is authoritative; an explicitly revoked or conflicting role never falls back.
  if (role && (!activeStaff(role) || role.role !== staff.role || (role.authUserId && role.authUserId !== uid))) return null;
  return { ...staff, role: staff.role, authUid: uid, therapistId: role?.therapistId || staff.therapistId || staff.uid || staff.id };
}
export async function requireIdentity(req: Request, verify: (token: string) => Promise<any>) {
  const match = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
  if (!match) throw securityError(401, 'AUTH_REQUIRED', 'Silakan masuk kembali.');
  const identity = await verify(match[1]).catch(() => null);
  if (!identity?.uid) throw securityError(401, 'AUTH_TOKEN_INVALID', 'Sesi autentikasi tidak valid.');
  return identity;
}
export function validGuestToken(booking: any, token: any): boolean {
  if (canonicalOwner(booking) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(booking.guestAccessTokenHash || '')) return false;
  const actual = createHash('sha256').update(token).digest();
  return timingSafeEqual(actual, Buffer.from(booking.guestAccessTokenHash, 'hex'));
}
export async function requireBookingAccess(req: Request, db: Firestore, verify: (token: string) => Promise<any>, booking: any, staffAllowed = false) {
  if (req.headers.authorization) {
    const identity = await requireIdentity(req, verify);
    const staff = await resolveActiveStaff(db, identity.uid);
    if(canonicalOwner(booking)===identity.uid || (staffAllowed && staff && ['manager','admin','css','supervisor'].includes(staff.role)))return {identity,staff};
    if(staffAllowed && staff?.role==='therapist'){assertAssignedTherapist(booking,staff);return {identity,staff};}
  } else if (validGuestToken(booking, req.headers['x-senzu-booking-token'])) return { identity: { uid: '', guest: true }, staff: null };
  throw securityError(403, 'PERMISSION_DENIED', 'Anda tidak memiliki akses ke reservasi ini.');
}
export function assertAssignedTherapist(booking: any, staff: any) {
  const assigned = booking.therapistId || booking.assignedTherapistId;
  if (!assigned || ![staff.therapistId, staff.id, staff.uid, staff.authUid].filter(Boolean).includes(assigned)) throw securityError(403, 'REASSIGNED_TO_OTHER', 'Pesanan bukan penugasan terapis ini.');
}
export function voucherDiscount(v: any, b: any): number {
  const price = Number(b.servicePrice || 0), value = Number(v.value || 0);
  if (!Number.isFinite(price) || !Number.isFinite(value) || price < 0 || value < 0) throw securityError(409, 'INVALID_PRICE', 'Nominal voucher tidak valid.');
  if (['fixed_discount','FIXED_AMOUNT'].includes(v.voucherType)) return Math.min(value, price);
  if (['percentage_discount','percentage','PERCENTAGE'].includes(v.voucherType)) return Math.min(price, Math.floor(price * value / 100), v.maximumDiscount > 0 ? v.maximumDiscount : Infinity);
  if (v.voucherType === 'free_home_service_fee') return Number(b.homeServiceFee || 0);
  return 0;
}

/** Registered before legacy handlers. Injection keeps tests away from production initialization. */
export function registerSecurityRepairs(app: Express, db: Firestore, verify: (token: string) => Promise<any>) {
  const failure = (res: any, e: any) => res.status(e.status || 503).json({ success: false, code: e.code || 'SERVICE_UNAVAILABLE', error: e.status ? e.message : 'Layanan sementara tidak tersedia.', message: e.status ? e.message : 'Layanan sementara tidak tersedia.' });
  const limited = new Map<string, { count: number; until: number }>();
  function rate(key: string, max = 30) {
    const now = Date.now();
    if (limited.size > 10000) for (const [k,v] of limited) if (v.until <= now) limited.delete(k);
    let entry = limited.get(key);
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + 60000 }; limited.set(key, entry); }
    if (++entry.count > max) throw securityError(429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba kembali sebentar lagi.');
  }
  const guard = (roles: string[], action?: (req: any, identity: any, staff: any) => Promise<void>) => async (req: any, res: any, next: any) => {
    try {
      const identity = await requireIdentity(req, verify);
      const staff = await resolveActiveStaff(db, identity.uid);
      if (roles.length && (!staff || !roles.includes(staff.role))) throw securityError(403, 'PERMISSION_DENIED', 'Akses ditolak.');
      rate(identity.uid + req.path);
      req.senzuSecurity = { identity, staff };
      if (action) await action(req, identity, staff);
      next();
    } catch (e) { failure(res, e); }
  };
  app.post('/api/therapist/accept-order', guard(['therapist']));
  app.post('/api/staff/sync-roles', guard(['manager','admin']));
  app.post(['/api/customers/recompute','/api/customers/:id/recompute'], guard([], async (req, identity, staff) => {
    const id = safeId(req.body?.customerId || req.params.id);
    const snap = await db.collection('customers').doc(id).get();
    if (!snap.exists || (!(staff && ['css','supervisor','manager','admin'].includes(staff.role)) && snap.data()?.authUserId !== identity.uid)) throw securityError(403, 'PERMISSION_DENIED', 'Akses ditolak.');
  }));
  app.post('/api/account-deletion/authenticated-request', guard([], async (req, identity) => {
    const snap = await db.collection('customers').where('authUserId','==',identity.uid).limit(2).get();
    if (snap.size !== 1 || (req.body?.customerId && req.body.customerId !== snap.docs[0].id)) throw securityError(403, 'OWNERSHIP_CONFLICT', 'Profil pelanggan memerlukan pemeriksaan.');
    req.body.customerId = snap.docs[0].id;
  }));

  app.post(['/api/vouchers/redeem','/api/vouchers/create-booking'], async (req, res) => {
    try {
      const bookingId = safeId(req.body?.bookingId), code = String(req.body?.voucherCode || '').trim().toUpperCase();
      if (!/^[A-Z0-9_-]{1,60}$/.test(code)) throw securityError(400,'INVALID_VOUCHER','Kode voucher tidak valid.');
      const bRef = db.collection('bookings').doc(bookingId);
      const draft=req.body?.booking;
      const bSnap = await bRef.get();
      if(!bSnap.exists && draft){
        if(draft.id!==bookingId || !['Menunggu Pembayaran','awaiting_payment','Draft','Pending'].includes(draft.status) || draft.paymentStatus!=='UNPAID' || draft.therapistId || draft.therapistName || draft.assignedTherapistId || draft.paymentPolicyVersion!==2 || draft.paymentDeadline!=null || !Number.isFinite(draft.servicePrice) || draft.servicePrice<0 || (draft.totalAmount!=null && (!Number.isFinite(draft.totalAmount) || draft.totalAmount<0)) || (draft.internalNotes && draft.internalNotes!==''))throw securityError(400,'INVALID_BOOKING','Data reservasi tidak valid.');
        for(const f of ['acceptedAt','assignedAt','completedAt','paymentVerifiedAt','confirmedAt','onTheWayAt','arrivedAt'])if(draft[f])throw securityError(400,'INVALID_BOOKING','Data reservasi tidak valid.');
      }
      if (!bSnap.exists && !draft) throw securityError(404,'BOOKING_NOT_FOUND','Reservasi tidak ditemukan.');
      await requireBookingAccess(req, db, verify, bSnap.data() || draft);
      const requestedBooking=bSnap.data() || draft;
      const customerVoucherId=String(requestedBooking.voucherId || '').startsWith('cv_') ? safeId(requestedBooking.voucherId) : '';
      const customerVoucherOnly=!!customerVoucherId && (!requestedBooking.promoDiscount || String(requestedBooking.promoId || '').startsWith('cv_'));
      let vRef:DocumentReference;
      if(customerVoucherOnly)vRef=db.collection('customer_vouchers').doc(customerVoucherId);
      else{const found=await db.collection('vouchers').where('code','==',code).limit(2).get();if(found.size!==1)throw securityError(400,'INVALID_VOUCHER','Voucher tidak ditemukan atau ambigu.');vRef=found.docs[0].ref;}
      const redRef = db.collection('voucher_redemptions').doc(`vred_${code}_${bookingId}`);
      const result = await db.runTransaction(async t => {
        const [bs, vs, prior] = await Promise.all([t.get(bRef), t.get(vRef), t.get(redRef)]);
        const b = bs.data() || draft, rawVoucher = vs.data();
        if(!rawVoucher)throw securityError(400,'INVALID_VOUCHER','Voucher tidak ditemukan.');
        const v=customerVoucherOnly?{...rawVoucher,validUntil:rawVoucher.expiredAt || rawVoucher.expiresAt,usageLimitPerCustomer:0}:rawVoucher;
        if(!b)throw securityError(404,'BOOKING_NOT_FOUND','Reservasi tidak ditemukan.');
        await requireBookingAccess(req, db, verify, b);
        if (prior.exists) return { redemptionId: redRef.id, isIdempotent: true };
        const serviceSnap=await t.get(db.collection('services').doc(safeId(b.serviceId)));
        let service:any=serviceSnap.data();
        if(!service && !bs.exists){const catalog=await t.get(db.collection('services').limit(1));if(catalog.empty)service=DEFAULT_SERVICES.find(s=>s.id===b.serviceId);}
        if(!bs.exists){
          if(!service || service.isActive===false || b.servicePrice!==service.price)throw securityError(409,'PRICE_MISMATCH','Harga layanan berubah. Muat ulang layanan.');
          if(!Number.isFinite(b.latitude) || !Number.isFinite(b.longitude) || Math.abs(b.latitude)>90 || Math.abs(b.longitude)>180)throw securityError(400,'INVALID_LOCATION','Lokasi tidak valid.');
          const rad=(n:number)=>n*Math.PI/180,lat1=SENZU_BASE_LOCATION.lat,lon1=SENZU_BASE_LOCATION.lng;
          const a=Math.sin(rad(b.latitude-lat1)/2)**2+Math.cos(rad(lat1))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-lon1)/2)**2;
          const minimum=Math.round(6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))*10)/10;
          const route=Number(b.distanceKm || 0),distance=route<=0 || route<minimum*0.95?minimum:route;
          if(!Number.isFinite(distance) || b.homeServiceFee!==calculateHomeServiceFee(distance).fee)throw securityError(409,'FEE_MISMATCH','Biaya home service tidak sesuai.');
        }

        if ((b.promoCode || b.voucherCode || '').toUpperCase() !== code || ['Cancelled','Completed','expired'].includes(b.status)) throw securityError(409,'VOUCHER_MISMATCH','Voucher tidak sesuai dengan reservasi.');
        const nowMs = Date.now(), now = new Date(nowMs).toISOString();
        if (v.enabled === false || v.isActive === false || ['inactive','disabled'].includes(String(v.status || '').toLowerCase()) || (v.validFrom && nowMs < Date.parse(v.validFrom)) || (v.validUntil && nowMs > Date.parse(v.validUntil)) || (v.usageLimitTotal > 0 && (v.currentUsageCount || 0) >= v.usageLimitTotal) || (Number(v.minimumSpend || v.minimumTreatmentPrice || 0) > Number(b.servicePrice || 0))) throw securityError(409,'VOUCHER_INELIGIBLE','Voucher tidak dapat digunakan.');
        if ((v.applicableServiceIds?.length && !v.applicableServiceIds.includes(b.serviceId)) || (v.applicableCategoryIds?.length && !v.applicableCategoryIds.includes(service?.categoryId || b.categoryId || b.serviceCategoryId)) || (v.minimumTreatmentDuration > Number(b.durationMinutesSnapshot || b.duration || b.serviceDuration || 0))) throw securityError(409,'VOUCHER_INELIGIBLE','Layanan tidak memenuhi ketentuan voucher.');
        if (b.customerId && canonicalOwner(b)) {
          const profile=await t.get(db.collection('customers').doc(safeId(b.customerId)));
          if (profile.exists && profile.data()?.authUserId !== canonicalOwner(b)) throw securityError(403,'OWNERSHIP_CONFLICT','Profil pelanggan tidak sesuai.');
        }
        let customerVoucher:any=null,customerVoucherRef:DocumentReference|null=null;
        if(customerVoucherId){
          customerVoucherRef=db.collection('customer_vouchers').doc(customerVoucherId);
          customerVoucher=(customerVoucherOnly?vs:await t.get(customerVoucherRef)).data();
          if(!canonicalOwner(b) || !customerVoucher || customerVoucher.customerId!==b.customerId || !['available','reserved'].includes(customerVoucher.status) || (customerVoucher.bookingId && customerVoucher.bookingId!==bookingId) || (customerVoucher.expiredAt && Date.now()>=Date.parse(customerVoucher.expiredAt)))throw securityError(403,'VOUCHER_INELIGIBLE','Voucher pelanggan tidak dapat digunakan.');
          const customerDiscount=voucherDiscount(customerVoucher,b);
          if(Number(b.voucherDiscount || 0)!==customerDiscount || b.servicePrice<Number(customerVoucher.minimumSpend || 0) || (customerVoucher.applicableServiceIds?.length && !customerVoucher.applicableServiceIds.includes(b.serviceId)))throw securityError(409,'DISCOUNT_MISMATCH','Voucher pelanggan tidak sesuai.');
        }
        const uid = canonicalOwner(b), phone = String(b.customerWhatsApp || '').replace(/\D/g,''), cust = b.customerId || '';
        const keys = [uid && `vlock_${code}_uid_${uid}`, phone && `vlock_${code}_phone_${phone}`, cust && `vlock_${code}_cust_${cust}`].filter(Boolean) as string[];
        const locks = await Promise.all(keys.map(k => t.get(db.collection('voucher_redemptions').doc(k))));
        const perCustomer = v.usageLimitPerCustomer ?? (code === 'SENZUWELCOME' ? 1 : 0);
        if (!customerVoucherOnly && perCustomer > 0 && locks.some(d => d.exists && d.data()?.bookingId !== bookingId && !['cancelled','batal'].includes(d.data()?.status) && Number(d.data()?.usageCount || 1) >= perCustomer)) throw securityError(409,'VOUCHER_ALREADY_USED','Voucher sudah pernah digunakan.');
        if (v.firstOrderOnly || v.newCustomerOnly) {
          const prev = await t.get(db.collection('bookings').where(uid ? 'customerAuthUid' : 'customerWhatsApp','==',uid || b.customerWhatsApp));
          if (prev.docs.some(d => d.id !== bookingId && !['cancelled','batal','menunggu pembayaran'].includes(String(d.data().status || '').toLowerCase()))) throw securityError(409,'FIRST_ORDER_ONLY','Voucher khusus pesanan pertama.');
        }
        const discountAmount = voucherDiscount(v,b);
        // Preserve pricing policy; reject inconsistent client discount instead of granting it.
        const bookedDiscount = Number(b.promoDiscount || b.voucherDiscount || b.discountAmount || 0);
        if (bookedDiscount !== discountAmount) throw securityError(409,'DISCOUNT_MISMATCH','Diskon reservasi tidak sesuai dengan voucher.');
        const record = { id: redRef.id, voucherId: vs.id, voucherCode: code, bookingId, bookingCode: b.bookingCode || '', customerId: cust, customerAuthUid: uid || null, customerPhone: phone, discountAmount, redeemedAt: now, updatedAt: now, status: 'active', source: 'server' };
        if(!bs.exists){const stamp=new Date().toISOString();t.create(bRef,{...b,createdAt:stamp,updatedAt:stamp});}
        t.create(redRef, record);
        for (const [index,key] of keys.entries()) t.set(db.collection('voucher_redemptions').doc(key), { usageCount: Number(locks[index].data()?.usageCount || (locks[index].exists ? 1 : 0))+1, voucherCode: code, bookingId, customerAuthUid: uid || null, customerId: cust, status: 'active', redeemedAt: now });
        if(customerVoucherRef)t.update(customerVoucherRef,{status:'used',bookingId,bookingCode:b.bookingCode || '',usedAt:now});
        if(!customerVoucherOnly)t.update(vRef, { currentUsageCount: (v.currentUsageCount || 0) + 1, updatedAt: now });
        return { redemptionId: redRef.id, isIdempotent: false };
      });
      res.json({ success: true, ...result });
    } catch (e) { failure(res,e); }
  });

  app.post('/api/notifications/register-device', guard([]), async (req: any, res) => {
    try {
      const { identity, staff } = req.senzuSecurity, token = req.body?.token;
      if (typeof token !== 'string' || token.length < 8 || token.length > 8192) throw securityError(400,'INVALID_DEVICE','Token perangkat tidak valid.');
      if (req.body.userId && req.body.userId !== identity.uid) throw securityError(403,'PERMISSION_DENIED','Identitas perangkat tidak sesuai.');
      const deviceId = `dev_${identity.uid}_${createHash('sha256').update(token).digest('hex')}`;
      await db.collection('notification_devices').doc(deviceId).set({ id: deviceId, userId: identity.uid, role: staff?.role || 'customer', token, platform: String(req.body.platform || 'pwa').slice(0,30), browser: String(req.body.browser || '').slice(0,500), deviceName: String(req.body.deviceName || 'Browser Device').slice(0,100), enabled: true, updatedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() },{merge:true});
      res.json({success:true,deviceId});
    } catch(e) { failure(res,e); }
  });
  app.post('/api/notifications/unregister-device', guard([]), async (req: any, res) => {
    try {
      const uid = req.senzuSecurity.identity.uid;
      if (req.body.userId && req.body.userId !== uid) throw securityError(403,'PERMISSION_DENIED','Identitas perangkat tidak sesuai.');
      const snap = await db.collection('notification_devices').where('userId','==',uid).get();
      const batch = db.batch();
      for (const d of snap.docs) if (!req.body.token || d.data().token === req.body.token) batch.update(d.ref,{enabled:false,unregisterAt:new Date().toISOString()});
      await batch.commit(); res.json({success:true});
    } catch(e) { failure(res,e); }
  });

  app.post('/api/payments/:paymentId/correct', guard(['manager','admin','css','supervisor']), async (req: any, res) => {
    try {
      const staff = req.senzuSecurity.staff, uid = req.senzuSecurity.identity.uid;
      const ref = db.collection('payments').doc(safeId(req.params.paymentId));
      const reason = String(req.body.reason || '').trim().slice(0,500), status = req.body.newStatus;
      if (!reason || !['unpaid','pending','pending_payment','pending_manual_verification','paid','payment_rejected','expired','refunded','failed','cancelled','partially_refunded'].includes(status)) throw securityError(400,'INVALID_CORRECTION','Status dan alasan koreksi wajib diisi.');
      await db.runTransaction(async t => {
        const ps = await t.get(ref); if (!ps.exists) throw securityError(404,'PAYMENT_NOT_FOUND','Pembayaran tidak ditemukan.');
        const p = ps.data()!, br = db.collection('bookings').doc(safeId(p.bookingId)), bs = await t.get(br);
        if (!bs.exists || (req.body.bookingId && req.body.bookingId !== br.id)) throw securityError(400,'BOOKING_MISMATCH','Reservasi tidak sesuai.');
        if (canonicalOwner(p) && canonicalOwner(bs.data()) !== canonicalOwner(p)) throw securityError(403,'OWNERSHIP_CONFLICT','Kepemilikan tidak sesuai.');
        if (p.status === status && p.correctionReason === reason) return;
        // Corrections retain the existing staff feature; every change is atomic and attributable.
        const now = new Date().toISOString();
        t.update(ref,{status,correctedBy:staff.name || uid,correctedByUid:uid,correctedAt:now,correctionReason:reason,updatedAt:now});
        t.update(br,{paymentStatus:status,updatedAt:now});
        t.create(db.collection('payment_status_history').doc(),{paymentId:ref.id,bookingId:br.id,bookingCode:p.bookingCode || '',oldStatus:p.status,newStatus:status,userId:uid,source:'staff',eventType:'payment_corrected',notes:reason,createdAt:now});
        t.create(db.collection('operational_audit_logs').doc(),{actorId:uid,actorRole:staff.role,action:'payment.corrected',paymentId:ref.id,bookingId:br.id,oldStatus:p.status,newStatus:status,reason,timestamp:now});
      }); res.json({success:true});
    } catch(e) { failure(res,e); }
  });

  // Existing client event calls now persist through a constrained Admin endpoint.
  app.post('/api/security/record-event', async (req: any, res) => {
    try {
      const kind = req.body.kind, data = req.body.data || {}, now = new Date().toISOString();
      if (kind === 'booking_history') {
        const bs = await db.collection('bookings').doc(safeId(data.bookingId)).get();
        if (!bs.exists) throw securityError(404,'BOOKING_NOT_FOUND','Reservasi tidak ditemukan.');
        const b = bs.data()!, {identity,staff} = await requireBookingAccess(req,db,verify,b,true);
        if (data.status !== b.status) throw securityError(409,'STATUS_MISMATCH','Status tidak sesuai.');
        const key = createHash('sha256').update(`${bs.id}:${b.status}:${b.updatedAt}`).digest('hex');
        await db.collection('booking_status_history').doc(`hist_${key}`).create({bookingId:bs.id,bookingCode:b.bookingCode || '',status:b.status,note:staff ? String(data.note || '').slice(0,1000) : '',updatedByRole:staff?.role || 'customer',updatedByName:staff?.name || b.customerName || '',timestamp:now,formattedWIB:data.formattedWIB || ''}).catch((e:any)=>{if(e.code!==6)throw e;});
      } else if (kind === 'customer_audit') {
        const identity = await requireIdentity(req,verify), staff = await resolveActiveStaff(db,identity.uid);
        if (!staff || !['css','supervisor','manager','admin'].includes(staff.role)) throw securityError(403,'PERMISSION_DENIED','Audit hanya dicatat oleh staf berwenang.');
        await db.collection('customer_audit_logs').add({...data,actorId:identity.uid,actorRole:staff.role,timestamp:now});
      } else if(kind==='refund_history'){
        const identity=await requireIdentity(req,verify),staff=await resolveActiveStaff(db,identity.uid);
        if(!staff || !['manager','admin','css','supervisor'].includes(staff.role))throw securityError(403,'PERMISSION_DENIED','Akses ditolak.');
        const cs=await db.collection('cases').doc(safeId(data.caseId)).get(),c=cs.data();
        if(!c || c.bookingId!==data.bookingId || c.recovery?.refundStatus!=='COMPLETED_MANUAL')throw securityError(409,'STATUS_MISMATCH','Refund belum selesai.');
        const key=createHash('sha256').update(`${cs.id}:${c.recovery.refundProcessedAt}`).digest('hex');
        await db.collection('payment_status_history').doc(`refund_${key}`).create({bookingId:c.bookingId,bookingCode:c.bookingCode || '',caseId:cs.id,amount:c.recovery.refundAmount || 0,oldStatus:'paid',newStatus:'refunded',eventType:'manual_refund_completed',userId:identity.uid,source:'staff',createdAt:now}).catch((e:any)=>{if(e.code!==6)throw e;});
      } else if (kind === 'payment_history') {
        // Financial history belongs to the mutation transaction, never a second client-supplied append.
        const identity = await requireIdentity(req,verify), staff = await resolveActiveStaff(db,identity.uid);
        if (!staff || !['css','supervisor','manager','admin'].includes(staff.role)) throw securityError(403,'PERMISSION_DENIED','Akses ditolak.');
        const ps = await db.collection('payments').doc(safeId(data.paymentId)).get();
        if (!ps.exists || ps.data()?.status !== data.newStatus || ps.data()?.bookingId !== data.bookingId) throw securityError(409,'STATUS_MISMATCH','Status pembayaran tidak sesuai.');
        const key = createHash('sha256').update(`${ps.id}:${ps.data()?.updatedAt}:${data.eventType}`).digest('hex');
        await db.collection('payment_status_history').doc(`pe_${key}`).create({...data,userId:identity.uid,source:'staff',createdAt:now}).catch((e:any)=>{if(e.code!==6)throw e;});
      } else throw securityError(400,'INVALID_EVENT','Jenis event tidak valid.');
      res.json({success:true});
    } catch(e) { failure(res,e); }
  });

  app.post('/api/notifications/emit', async (req: any, res) => {
    try {
      const type = String(req.body.eventType || ''), input = req.body.payload || {}, now=new Date().toISOString();
      let payload = input, staff: any = null, identity: any;
      if (input.bookingId) {
        const bs = await db.collection('bookings').doc(safeId(input.bookingId)).get();
        if (!bs.exists) throw securityError(404,'BOOKING_NOT_FOUND','Reservasi tidak ditemukan.');
        const access = await requireBookingAccess(req,db,verify,bs.data(),true); staff=access.staff; identity=access.identity;
        const b = bs.data()!;
        const state: Record<string,string[]> = {'booking.created':['Menunggu Pembayaran','awaiting_payment','Pending','Draft'],'payment.proof_uploaded':['pending_manual_verification'],'payment.verified':['paid','PAID'],'payment.rejected':['payment_rejected'],'booking.cancelled':['Cancelled'],'therapist.accepted':['Accepted'],'therapist.on_the_way':['On The Way','On the Way'],'therapist.nearby':['On The Way'],'therapist.arrived':['Arrived'],'treatment.started':['Treatment','In Service','in_progress'],'treatment.completed':['Completed']};
        if ((!staff || staff.role==='therapist') && (!state[type] || !state[type].includes(type.startsWith('payment.') ? b.paymentStatus : b.status))) throw securityError(403,'EVENT_NOT_ALLOWED','Event tidak sesuai status reservasi.');
        const {guestAccessTokenHash,...publicBooking}=b;
        payload = {...(staff ? input : {}),...publicBooking,bookingId:bs.id};
      } else {
        identity = await requireIdentity(req,verify); staff = await resolveActiveStaff(db,identity.uid);
        if (!staff || !['css','supervisor','manager','admin'].includes(staff.role)) throw securityError(403,'PERMISSION_DENIED','Akses ditolak.');
      }
      rate(`${identity.uid || input.bookingId}:emit`,20);
      const settingsSnap = await db.collection('notification_settings').doc('default').get();
      const settings = {...DEFAULT_NOTIFICATION_SETTINGS,...settingsSnap.data()};
      const targets = resolveNotificationTargets(type as any,payload,settings);
      const key = createHash('sha256').update(`${type}:${payload.bookingId || payload.customerId}:${payload.updatedAt || JSON.stringify(payload)}`).digest('hex');
      const er = db.collection('notification_events').doc(`evt_${key}`);
      const recipients = await Promise.all(targets.map(async target => {
        let uid = target.recipientUserId || '';
        if (target.recipientRole === 'customer') {
          uid = canonicalOwner(payload);
          if (!uid && payload.bookingId) return null;
          if (!uid && payload.customerId) uid = (await db.collection('customers').doc(safeId(payload.customerId)).get()).data()?.authUserId || '';
          if (!uid) return null;
        }
        if (target.recipientRole === 'therapist') {
          const id = target.therapistId || payload.therapistId;
          const roles = await db.collection('staff_roles').where('therapistId','==',id || '').limit(2).get();
          if (roles.size !== 1 || !activeStaff(roles.docs[0].data())) return null;
          uid = roles.docs[0].id;
        }
        return JSON.parse(JSON.stringify({...target,recipientUserId:uid}));
      }));
      const isIdempotent=await db.runTransaction(async t => {
        if ((await t.get(er)).exists) return true;
        t.create(er,{eventType:type,bookingId:payload.bookingId || null,actorId:identity.uid || 'guest',actorRole:staff?.role || 'customer',payload:JSON.parse(JSON.stringify(payload)),createdAt:now,status:'processed',processedAt:now});
        recipients.forEach((target,i)=>{if(target){const notificationId=`notif_${key}_${i}`;t.create(db.collection('notifications').doc(notificationId),{...target,id:notificationId,eventId:er.id,eventType:type,bookingId:payload.bookingId || null,bookingCode:payload.bookingCode || '',customerId:payload.customerId || '',therapistId:target.therapistId || payload.therapistId || null,channel:'in_app',read:false,createdAt:now});t.create(db.collection('notification_deliveries').doc(`deliv_${key}_${i}`),{notificationId,channel:'in_app',recipient:target.recipientUserId || target.recipientRole,status:'delivered',sentAt:now,deliveredAt:now,retryCount:0});}});
        return false;
      }); res.json({success:true,eventId:er.id,isIdempotent});
    } catch(e) { failure(res,e); }
  });

  // Guest receipt access is scoped to a random per-booking secret, never a booking ID alone.
  app.post('/api/bookings/guest-read', async (req,res)=>{
    try {
      const snap = await db.collection('bookings').doc(safeId(req.body.bookingId)).get();
      if (!snap.exists || !validGuestToken(snap.data(),req.headers['x-senzu-booking-token'])) throw securityError(403,'PERMISSION_DENIED','Akses ditolak.');
      const {guestAccessTokenHash,...booking}=snap.data()!; res.json({success:true,booking:{...booking,id:snap.id}});
    } catch(e){failure(res,e);}
  });
}
