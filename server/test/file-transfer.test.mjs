import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { FileTransferBroker, safeUploadName } from '../src/file-transfer.mjs';

test('sanitizes file names to the last safe path segment', () => {
  assert.equal(safeUploadName('../folder/report.txt'), 'report.txt');
  assert.equal(safeUploadName('..\\folder\\photo.jpg'), 'photo.jpg');
});

test('streams ordered chunks and resolves the Android result', async () => {
  const broker = new FileTransferBroker({ chunkBytes: 4, maxBytes: 100, timeoutMs: 1_000 });
  const messages = [];
  const ws = {
    readyState: 1,
    bufferedAmount: 0,
    send(raw) {
      const message = JSON.parse(raw);
      messages.push(message);
      if (message.type === 'file_upload_end') {
        queueMicrotask(() => broker.resolve({
          type: 'file_upload_result', transferId: message.transferId,
          ok: true, uri: 'content://downloads/1', bytes: message.size,
        }));
      }
    },
  };

  const result = await broker.upload({
    deviceId: 'p1', ws, stream: Readable.from([Buffer.from('abcdefghij')]),
    fileName: 'demo.txt', mimeType: 'text/plain', contentLength: 10,
  });
  const chunks = messages.filter(message => message.type === 'file_upload_chunk');
  assert.deepEqual(chunks.map(message => message.index), [0, 1, 2]);
  assert.equal(Buffer.concat(chunks.map(message => Buffer.from(message.dataBase64, 'base64'))).toString(), 'abcdefghij');
  assert.equal(result.uri, 'content://downloads/1');
});

test('rejects a declared file larger than the configured limit', async () => {
  const broker = new FileTransferBroker({ maxBytes: 5 });
  await assert.rejects(() => broker.upload({
    deviceId: 'p1', ws: { readyState: 1 }, stream: Readable.from([]),
    fileName: 'large.bin', contentLength: 6,
  }), /FILE_TOO_LARGE/);
});

test('uses the lower limit advertised by the target Android Agent', async () => {
  const broker = new FileTransferBroker({ maxBytes: 100 });
  await assert.rejects(() => broker.upload({
    deviceId: 'p1', ws: { readyState: 1 }, stream: Readable.from([]),
    fileName: 'agent-too-small.bin', contentLength: 11, maxBytes: 10,
  }), /FILE_TOO_LARGE/);
});
