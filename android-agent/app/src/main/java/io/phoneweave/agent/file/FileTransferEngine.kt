package io.phoneweave.agent.file

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import org.json.JSONObject
import java.io.OutputStream

class FileTransferEngine(
    context: Context,
    private val signal: (JSONObject) -> Unit,
) {
    companion object {
        const val MAX_UPLOAD_BYTES = 512L * 1024L * 1024L
    }

    private data class ActiveTransfer(
        val id: String,
        val fileName: String,
        val uri: Uri,
        val output: OutputStream,
        val expectedSize: Long,
        var receivedBytes: Long = 0,
        var nextChunk: Int = 0,
    )

    private val resolver = context.contentResolver
    private val active = mutableMapOf<String, ActiveTransfer>()

    @Synchronized
    fun handle(message: JSONObject): Boolean {
        return when (message.optString("type")) {
            "file_upload_start" -> { start(message); true }
            "file_upload_chunk" -> { chunk(message); true }
            "file_upload_end" -> { finish(message); true }
            "file_upload_abort" -> { abort(message.optString("transferId")); true }
            else -> false
        }
    }

    @Synchronized
    fun close() {
        active.keys.toList().forEach(::abort)
    }

    private fun start(message: JSONObject) {
        val id = message.optString("transferId")
        if (id.isBlank() || active.containsKey(id)) return fail(id, "INVALID_TRANSFER_ID")
        val expectedSize = message.optLong("size", -1L)
        if (expectedSize > MAX_UPLOAD_BYTES) return fail(id, "FILE_TOO_LARGE")
        val fileName = safeFileName(message.optString("fileName"))
        val mimeType = message.optString("mimeType", "application/octet-stream")

        try {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/PhoneWeave")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: return fail(id, "MEDIASTORE_INSERT_FAILED")
            val output = resolver.openOutputStream(uri, "w") ?: run {
                resolver.delete(uri, null, null)
                return fail(id, "FILE_OPEN_FAILED")
            }
            active[id] = ActiveTransfer(id, fileName, uri, output, expectedSize)
        } catch (t: Throwable) {
            fail(id, t.message ?: "FILE_START_FAILED")
        }
    }

    private fun chunk(message: JSONObject) {
        val id = message.optString("transferId")
        val transfer = active[id] ?: return fail(id, "TRANSFER_NOT_FOUND")
        val index = message.optInt("index", -1)
        if (index != transfer.nextChunk) return failAndDelete(transfer, "OUT_OF_ORDER_CHUNK")

        try {
            val bytes = Base64.decode(message.optString("dataBase64"), Base64.DEFAULT)
            if (transfer.receivedBytes + bytes.size > MAX_UPLOAD_BYTES) {
                return failAndDelete(transfer, "FILE_TOO_LARGE")
            }
            if (transfer.expectedSize >= 0 && transfer.receivedBytes + bytes.size > transfer.expectedSize) {
                return failAndDelete(transfer, "CONTENT_LENGTH_MISMATCH")
            }
            transfer.output.write(bytes)
            transfer.receivedBytes += bytes.size
            transfer.nextChunk += 1
        } catch (t: Throwable) {
            failAndDelete(transfer, t.message ?: "FILE_WRITE_FAILED")
        }
    }

    private fun finish(message: JSONObject) {
        val id = message.optString("transferId")
        val transfer = active[id] ?: return fail(id, "TRANSFER_NOT_FOUND")
        val declaredSize = message.optLong("size", -1L)
        if ((transfer.expectedSize >= 0 && transfer.receivedBytes != transfer.expectedSize) ||
            (declaredSize >= 0 && transfer.receivedBytes != declaredSize)) {
            return failAndDelete(transfer, "CONTENT_LENGTH_MISMATCH")
        }

        try {
            transfer.output.flush()
            transfer.output.close()
            resolver.update(transfer.uri, ContentValues().apply {
                put(MediaStore.Downloads.IS_PENDING, 0)
            }, null, null)
            active.remove(id)
            signal(JSONObject()
                .put("type", "file_upload_result")
                .put("transferId", id)
                .put("ok", true)
                .put("uri", transfer.uri.toString())
                .put("bytes", transfer.receivedBytes)
                .put("fileName", transfer.fileName))
        } catch (t: Throwable) {
            failAndDelete(transfer, t.message ?: "FILE_FINISH_FAILED")
        }
    }

    private fun abort(id: String) {
        val transfer = active.remove(id) ?: return
        try { transfer.output.close() } catch (_: Throwable) {}
        try { resolver.delete(transfer.uri, null, null) } catch (_: Throwable) {}
    }

    private fun failAndDelete(transfer: ActiveTransfer, error: String) {
        abort(transfer.id)
        fail(transfer.id, error)
    }

    private fun fail(id: String, error: String) {
        signal(JSONObject()
            .put("type", "file_upload_result")
            .put("transferId", id)
            .put("ok", false)
            .put("error", error))
    }

    private fun safeFileName(value: String): String {
        val segment = value.replace('\\', '/').substringAfterLast('/').trim()
            .filter { it.code >= 32 && it.code != 127 }
        return (segment.ifBlank { "phoneweave-upload.bin" }).take(180)
    }
}
