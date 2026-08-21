import crypto from 'node:crypto';

export const DEFAULT_MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export function safeUploadName(value) {
  const lastSegment = String(value || '').normalize('NFKC').split(/[\\/]/).pop() || '';
  const cleaned = lastSegment.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'phoneweave-upload.bin').slice(0, 180);
}

export class FileTransferBroker {
  constructor({ maxBytes = DEFAULT_MAX_UPLOAD_BYTES, chunkBytes = 64 * 1024, timeoutMs = 120_000 } = {}) {
    this.maxBytes = maxBytes;
    this.chunkBytes = chunkBytes;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
  }

  async upload({ deviceId, ws, stream, fileName, mimeType = 'application/octet-stream', contentLength = null, maxBytes = this.maxBytes }) {
    if (!ws || ws.readyState !== 1) throw new Error('DEVICE_OFFLINE');
    const transferLimit = Math.min(this.maxBytes, Number(maxBytes));
    if (!Number.isFinite(transferLimit) || transferLimit <= 0) throw new Error('INVALID_UPLOAD_LIMIT');
    const expectedSize = contentLength == null || contentLength === '' ? -1 : Number(contentLength);
    if (!Number.isInteger(expectedSize) || expectedSize < -1) throw new Error('INVALID_CONTENT_LENGTH');
    if (expectedSize > transferLimit) throw new Error('FILE_TOO_LARGE');

    const transferId = crypto.randomUUID();
    const normalizedName = safeUploadName(fileName);
    let resolveResult;
    let rejectResult;
    const resultPromise = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    // The stream can fail before this promise is awaited. Keep the rejection handled.
    resultPromise.catch(() => {});
    const entry = {
      deviceId,
      resolve: resolveResult,
      reject: rejectResult,
      timer: null,
    };
    this.pending.set(transferId, entry);
    this.touchTransfer(transferId);

    let total = 0;
    let index = 0;
    try {
      this.send(ws, {
        type: 'file_upload_start', transferId, fileName: normalizedName,
        mimeType: String(mimeType || 'application/octet-stream').slice(0, 120),
        size: expectedSize,
      });

      for await (const incoming of stream) {
        const buffer = Buffer.isBuffer(incoming) ? incoming : Buffer.from(incoming);
        for (let offset = 0; offset < buffer.length; offset += this.chunkBytes) {
          const chunk = buffer.subarray(offset, offset + this.chunkBytes);
          total += chunk.length;
          if (total > transferLimit) throw new Error('FILE_TOO_LARGE');
          await this.waitForWritable(ws);
          this.send(ws, {
            type: 'file_upload_chunk', transferId, index,
            dataBase64: chunk.toString('base64'),
          });
          this.touchTransfer(transferId);
          index += 1;
        }
      }
      if (expectedSize >= 0 && total !== expectedSize) throw new Error('CONTENT_LENGTH_MISMATCH');
      this.send(ws, { type: 'file_upload_end', transferId, chunks: index, size: total });
      this.touchTransfer(transferId);
      const result = await resultPromise;
      return { transferId, fileName: normalizedName, bytes: total, ...result };
    } catch (error) {
      if (this.pending.has(transferId)) {
        this.clearEntry(transferId);
        try { this.send(ws, { type: 'file_upload_abort', transferId }); } catch {}
      }
      throw error;
    }
  }

  resolve(message) {
    const transferId = message?.transferId;
    const entry = this.pending.get(transferId);
    if (!entry) return false;
    this.pending.delete(transferId);
    clearTimeout(entry.timer);
    if (message.ok === false) entry.reject(new Error(message.error || 'FILE_TRANSFER_FAILED'));
    else entry.resolve({ ok: true, uri: message.uri, bytes: message.bytes, fileName: message.fileName });
    return true;
  }

  rejectDevice(deviceId) {
    for (const [transferId, entry] of this.pending) {
      if (entry.deviceId === deviceId) this.rejectTransfer(transferId, new Error('DEVICE_OFFLINE'));
    }
  }

  touchTransfer(transferId) {
    const entry = this.pending.get(transferId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(
      () => this.rejectTransfer(transferId, new Error('FILE_TRANSFER_TIMEOUT')),
      this.timeoutMs,
    );
  }

  rejectTransfer(transferId, error) {
    const entry = this.pending.get(transferId);
    if (!entry) return;
    this.pending.delete(transferId);
    clearTimeout(entry.timer);
    entry.reject(error);
  }

  clearEntry(transferId) {
    const entry = this.pending.get(transferId);
    if (!entry) return;
    this.pending.delete(transferId);
    clearTimeout(entry.timer);
  }

  send(ws, message) {
    if (ws.readyState !== 1) throw new Error('DEVICE_OFFLINE');
    ws.send(JSON.stringify(message));
  }

  async waitForWritable(ws) {
    while (ws.bufferedAmount > 4 * 1024 * 1024) {
      if (ws.readyState !== 1) throw new Error('DEVICE_OFFLINE');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}
