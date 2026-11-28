/**
 * FAT read-only payment-proof lookup. The proof is a base64 data URL stored in
 * the payment document (src/server/paymentAcceptance.ts); it is echoed only to
 * an active FAT actor and only after strict revalidation. No Storage, no writes.
 */
import type { Request, Response } from 'express';

export const FAT_PAYMENT_PROOF_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const FAT_PAYMENT_PROOF_MAX_CHARS = 700000;
export const FAT_PAYMENT_PROOF_MAX_BYTES = 500 * 1024;

const PROOF = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/;
const PAYMENT_ID = /^[A-Za-z0-9_-]{1,200}$/;

type AuthError = { status: number; code: string; message: string };
type Authorization = { uid: string } | { error: AuthError } | void;
type AuthorizeReadActor = (req: Request, allowedRoles: string[]) => Promise<Authorization>;
export interface FatPaymentProofDb {
  collection(name: string): { doc(id: string): { get(): Promise<{ exists: boolean; data: () => any }> } };
}
export type FatPaymentProofDependencies = {
  authorizeReadActor: AuthorizeReadActor;
  db: FatPaymentProofDb | null;
};

/** Returns the original data URL only when it is an allowlisted, bounded proof. */
export function parseFatPaymentProof(payment: unknown): { proofUrl: string; mimeType: string } | null {
  const proofUrl = (payment as { paymentProofUrl?: unknown } | null | undefined)?.paymentProofUrl;
  if (typeof proofUrl !== 'string') return null;
  const match = PROOF.exec(proofUrl);
  if (!match || !(FAT_PAYMENT_PROOF_MIME_TYPES as readonly string[]).includes(match[1])) return null;
  const payload = match[2];
  if (!payload || payload.length > FAT_PAYMENT_PROOF_MAX_CHARS) return null;
  const bytes = Buffer.from(payload, 'base64');
  if (!bytes.length || bytes.length > FAT_PAYMENT_PROOF_MAX_BYTES) return null;
  return { proofUrl, mimeType: match[1] };
}

/** Timestamp-only legacy records do not prove that a retrievable file exists. */
export function hasFatPaymentProof(payment: unknown): boolean {
  return parseFatPaymentProof(payment) !== null;
}

export function createFatPaymentProofHandler(authorizer: FatPaymentProofDependencies) {
  return async function fatPaymentProof(req: Request, res: Response): Promise<Response> {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let authorization: Authorization;
    try {
      authorization = await authorizer.authorizeReadActor(req, ['fat']);
    } catch (error: any) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 503;
      return res.status(status).json({ success: false, code: error?.code || 'SERVICE_UNAVAILABLE', message: error?.message || 'Layanan data belum tersedia.' });
    }
    if (authorization && 'error' in authorization) {
      const { status, code, message } = authorization.error;
      return res.status(status).json({ success: false, code, message });
    }
    const paymentId = req.params?.paymentId;
    if (typeof paymentId !== 'string' || !PAYMENT_ID.test(paymentId)) {
      return res.status(400).json({ success: false, code: 'INVALID_PAYMENT_ID', message: 'ID pembayaran tidak valid.' });
    }
    if (!authorizer.db) {
      return res.status(503).json({ success: false, code: 'SERVICE_UNAVAILABLE', message: 'Layanan data belum tersedia.' });
    }
    try {
      const snap = await authorizer.db.collection('payments').doc(paymentId).get();
      const proof = snap.exists ? parseFatPaymentProof(snap.data()) : null;
      if (!proof) return res.status(404).json({ success: false, code: 'PROOF_NOT_FOUND', message: 'Bukti pembayaran tidak tersedia.' });
      return res.json({ success: true, paymentId, proofUrl: proof.proofUrl, mimeType: proof.mimeType });
    } catch {
      return res.status(503).json({ success: false, code: 'SERVICE_UNAVAILABLE', message: 'Layanan data belum tersedia.' });
    }
  };
}
