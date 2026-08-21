package io.phoneweave.agent.net

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import io.phoneweave.agent.util.Prefs
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

class AgentSocket(
    private val context: Context,
    private val onMessageJson: (JSONObject) -> Unit,
    private val onConnectingSocket: () -> Unit,
    private val onOpenSocket: () -> Unit,
    private val onClosedSocket: (String?) -> Unit,
) {
    companion object {
        private const val TAG = "PhoneWeave/Socket"
        private const val INITIAL_RECONNECT_DELAY_MS = 1000L
        private const val MAX_RECONNECT_DELAY_MS = 5000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // WebSocket should not timeout on read
        .build()

    private var socket: WebSocket? = null
    private var reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
    private val reconnectRunnable = Runnable { if (!stopping) connect() }
    @Volatile private var stopping = false

    fun connect() {
        stopping = false
        handler.removeCallbacks(reconnectRunnable)
        socket?.cancel()
        socket = null

        val url = try {
            buildWsUrl()
        } catch (t: Throwable) {
            val err = t.message ?: "Invalid server URL"
            Log.e(TAG, "Failed to build WS URL: $err", t)
            onClosedSocket(err)
            scheduleReconnect()
            return
        }

        Log.i(TAG, "Connecting to: $url")
        onConnectingSocket()

        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (stopping) { webSocket.close(1000, "stopped"); return }
                Log.i(TAG, "WebSocket connected successfully (HTTP ${response.code})")
                reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
                handler.removeCallbacks(reconnectRunnable)
                onOpenSocket()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    onMessageJson(JSONObject(text))
                } catch (e: Throwable) {
                    Log.e(TAG, "Error parsing incoming JSON: ${e.message}")
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                val detail = reason.ifBlank { "WebSocket closed ($code)" }
                Log.w(TAG, "WebSocket closed by remote: $detail")
                if (stopping) return
                onClosedSocket(detail)
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val detail = response?.let { "HTTP ${it.code}" } ?: t.message ?: "Connection error"
                Log.e(TAG, "WebSocket failure: $detail", t)
                if (stopping) return
                onClosedSocket(detail)
                scheduleReconnect()
            }
        })
    }

    fun send(obj: JSONObject): Boolean {
        val s = socket
        if (s == null) {
            Log.w(TAG, "Cannot send message: socket is null")
            return false
        }
        return s.send(obj.toString())
    }

    fun close() {
        Log.i(TAG, "Closing socket")
        stopping = true
        handler.removeCallbacks(reconnectRunnable)
        socket?.close(1000, "shutdown")
        socket = null
    }

    private fun scheduleReconnect() {
        if (stopping) return
        handler.removeCallbacks(reconnectRunnable)
        val delay = reconnectDelayMs
        reconnectDelayMs = (reconnectDelayMs * 2).coerceAtMost(MAX_RECONNECT_DELAY_MS)
        Log.i(TAG, "Scheduling reconnect in ${delay}ms...")
        handler.postDelayed(reconnectRunnable, delay)
    }

    private fun buildWsUrl(): String {
        val raw = Prefs.server(context).trim()
        val uri = URI(raw)
        val wsScheme = if (uri.scheme?.equals("https", true) == true) "wss" else "ws"
        val portPart = if (uri.port > 0) ":${uri.port}" else ""
        val id = URLEncoder.encode(Prefs.deviceId(context).trim(), StandardCharsets.UTF_8.toString())
        val token = URLEncoder.encode(Prefs.deviceToken(context).trim(), StandardCharsets.UTF_8.toString())
        val host = uri.host ?: throw IllegalArgumentException("Missing host in server URL: $raw")
        return "$wsScheme://$host$portPart/ws/device?deviceId=$id&token=$token"
    }
}
