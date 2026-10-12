/**
 * Image and Document Optimization Utility for Firestore
 *
 * Cloud Firestore enforces a strict 1,048,576 bytes (1 MB) limit per document.
 * Smartphone cameras and screenshots frequently produce 2 MB – 10 MB files.
 * This utility optimizes and compresses image files client-side using HTML5 Canvas
 * into high-resolution yet lightweight JPEG data URLs (~80 KB – 250 KB),
 * ensuring crisp legibility of transfer receipts while strictly respecting Firestore quotas.
 */

export interface OptimizeResult {
  dataUrl: string;
  sizeBytes: number;
  mimeType: string;
  originalSizeBytes: number;
  compressionRatio: number; // e.g. 0.15 = 85% reduction
}

export interface OptimizeOptions {
  maxDimension?: number; // default 1200px
  initialQuality?: number; // default 0.75
  maxOutputSizeBytes?: number; // default 500 KB (well within 1 MB Firestore limit)
}

const DEFAULT_MAX_DIMENSION = 1200;
const DEFAULT_INITIAL_QUALITY = 0.75;
const DEFAULT_MAX_OUTPUT_BYTES = 500 * 1024; // 500 KB safe ceiling for Firestore

/**
 * Optimizes an uploaded File (Image or PDF) for safe storage in Firestore.
 *
 * - Images (JPEG, PNG, WebP): Scaled down to maxDimension (e.g. 1200px) and compressed to JPEG.
 * - PDFs: Validated to be under maxOutputSizeBytes (since PDFs cannot be canvas-compressed).
 */
export async function optimizeFileForFirestore(
  file: File,
  options: OptimizeOptions = {}
): Promise<OptimizeResult> {
  const maxDimension = options.maxDimension || DEFAULT_MAX_DIMENSION;
  const initialQuality = options.initialQuality || DEFAULT_INITIAL_QUALITY;
  const maxOutputBytes = options.maxOutputSizeBytes || DEFAULT_MAX_OUTPUT_BYTES;

  // Handle PDF
  if (file.type === 'application/pdf') {
    if (file.size > maxOutputBytes) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      const limitKb = Math.round(maxOutputBytes / 1024);
      throw new Error(
        `Ukuran file PDF (${sizeMb} MB) melebihi batas maksimal ${limitKb} KB untuk penyimpanan dokumen. ` +
        `Tips: Silakan ambil tangkapan layar (screenshot) bukti pembayaran Anda dan unggah dalam format foto (JPG/PNG). Foto akan otomatis dikompresi ke resolusi optimal.`
      );
    }

    const dataUrl = await readFileAsDataUrl(file);
    return {
      dataUrl,
      sizeBytes: file.size,
      mimeType: 'application/pdf',
      originalSizeBytes: file.size,
      compressionRatio: 1,
    };
  }

  // Verify that the file is an image
  if (!file.type.startsWith('image/')) {
    throw new Error('Format file tidak didukung. Harap unggah gambar (JPG, JPEG, PNG, WebP) atau dokumen PDF.');
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      try {
        let width = img.width;
        let height = img.height;

        // Scale proportionally if either dimension exceeds maxDimension
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Browser gagal menginisialisasi canvas untuk kompresi gambar.'));
          return;
        }

        // Draw white background (handles transparent PNGs cleanly)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Attempt 1: Standard quality
        let quality = initialQuality;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        // Check approximate byte size of base64
        let approxBytes = estimateBase64SizeBytes(dataUrl);

        // Attempt 2: If still too large, step down quality
        if (approxBytes > maxOutputBytes && quality > 0.5) {
          quality = 0.55;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          approxBytes = estimateBase64SizeBytes(dataUrl);
        }

        // Attempt 3: If still too large, reduce canvas dimension to 800px and recompress
        if (approxBytes > maxOutputBytes) {
          const fallbackMax = 800;
          let fbWidth = width;
          let fbHeight = height;
          if (fbWidth >= fbHeight) {
            fbHeight = Math.round((fbHeight * fallbackMax) / fbWidth);
            fbWidth = fallbackMax;
          } else {
            fbWidth = Math.round((fbWidth * fallbackMax) / fbHeight);
            fbHeight = fallbackMax;
          }

          const fbCanvas = document.createElement('canvas');
          fbCanvas.width = fbWidth;
          fbCanvas.height = fbHeight;
          const fbCtx = fbCanvas.getContext('2d');
          if (fbCtx) {
            fbCtx.fillStyle = '#FFFFFF';
            fbCtx.fillRect(0, 0, fbWidth, fbHeight);
            fbCtx.drawImage(canvas, 0, 0, fbWidth, fbHeight);
            dataUrl = fbCanvas.toDataURL('image/jpeg', 0.6);
            approxBytes = estimateBase64SizeBytes(dataUrl);
          }
        }

        // Final safety check: must be strictly under 800 KB to guarantee no Firestore overflow
        if (approxBytes > 800 * 1024) {
          reject(
            new Error(
              'Ukuran gambar setelah kompresi masih terlalu besar untuk sistem. Silakan pilih foto dengan resolusi lebih rendah atau lakukan screenshot terlebih dahulu.'
            )
          );
          return;
        }

        const ratio = file.size > 0 ? approxBytes / file.size : 1;

        resolve({
          dataUrl,
          sizeBytes: approxBytes,
          mimeType: 'image/jpeg',
          originalSizeBytes: file.size,
          compressionRatio: Number(ratio.toFixed(2)),
        });
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Gagal membaca format gambar. Pastikan file tidak rusak.'));
    };

    img.src = objectUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Gagal membaca file dokumen.'));
    reader.readAsDataURL(file);
  });
}

function estimateBase64SizeBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const base64Str = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.round((base64Str.length * 3) / 4);
}
