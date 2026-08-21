package io.phoneweave.agent.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.WindowManager
import io.phoneweave.agent.BuildConfig
import io.phoneweave.agent.control.ControlEngine
import io.phoneweave.agent.control.PhoneWeaveAccessibilityService
import io.phoneweave.agent.file.FileTransferEngine
import io.phoneweave.agent.net.AgentSocket
import io.phoneweave.agent.screen.WebRtcScreenEngine
import io.phoneweave.agent.util.Prefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

class AgentForegroundService : Service() {
    companion object {
        const val ACTION_START = "io.phoneweave.agent.START"
        const val ACTION_STOP = "io.phoneweave.agent.STOP"
        const val ACTION_SET_PROJECTION = "io.phoneweave.agent.SET_PROJECTION"
        const val EXTRA_PROJECTION_DATA = "projection_data"

        private val mutableRuntimeState = MutableStateFlow(AgentRuntimeState())
        val runtimeState = mutableRuntimeState.asStateFlow()

        @Volatile var instance: AgentForegroundService? = null
            private set

        private const val SNAPSHOT_PUSH_INTERVAL_MS = 333L  // target ~3fps
        private const val SNAPSHOT_PUSH_MIN_DELAY_MS = 150L // minimum gap between shots
    }

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var control: ControlEngine
    private lateinit var fileTransfers: FileTransferEngine
    private var socket: AgentSocket? = null
    private var rtcConfig = JSONArray()
    private var screenEngine: WebRtcScreenEngine? = null
    private var projectionData: Intent? = null
    @Volatile private var socketOpen = false
    @Volatile private var currentLeaseMode: String = "FREE"
    @Volatile private var snapshotPushActive = false

    fun refreshCapabilities() {
        sendHello()
        publishState(mutableRuntimeState.value.phase, mutableRuntimeState.value.detail)
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        publishState(AgentConnectionPhase.STARTING)
        control = ControlEngine(applicationContext)
        fileTransfers = FileTransferEngine(applicationContext) { signal -> socket?.send(signal) }
        createNotificationChannel()
        startForegroundSpecialUse()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action ?: ACTION_START) {
            ACTION_START -> ensureSocket()
            ACTION_SET_PROJECTION -> {
                val data = if (Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
                    else @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_PROJECTION_DATA)
                if (data != null) {
                    projectionData = data
                    upgradeForegroundForProjection()
                    replaceScreenEngine(data)
                    sendHello()
                }
                ensureSocket()
            }
            ACTION_STOP -> stopSelf()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        stopSnapshotPushLoop()
        fileTransfers.close()
        screenEngine?.stop(); screenEngine = null
        socket?.close(); socket = null
        socketOpen = false
        publishState(AgentConnectionPhase.STOPPED)
        if (instance === this) instance = null
        super.onDestroy()
    }

    private fun ensureSocket() {
        if (socket != null) return
        socket = AgentSocket(
            applicationContext,
            onMessageJson = ::handleMessage,
            onConnectingSocket = {
                publishState(
                    if (mutableRuntimeState.value.phase == AgentConnectionPhase.CONNECTED)
                        AgentConnectionPhase.RECONNECTING
                    else AgentConnectionPhase.CONNECTING
                )
            },
            onOpenSocket = {
                socketOpen = true
                publishState(AgentConnectionPhase.AUTHENTICATING)
                sendHello()
                scheduleHeartbeat()
            },
            onClosedSocket = { detail ->
                socketOpen = false
                stopSnapshotPushLoop()
                fileTransfers.close()
                publishState(AgentConnectionPhase.RECONNECTING, detail)
            },
        ).also { it.connect() }
    }

    private fun handleMessage(msg: JSONObject) {
        when (msg.optString("type")) {
            "welcome" -> {
                rtcConfig = msg.optJSONObject("rtc")?.optJSONArray("iceServers") ?: JSONArray()
                val lease = msg.optJSONObject("lease")
                val token = lease?.optLong("fencingToken", 0) ?: 0
                control.advanceFencingToken(token)
                val newMode = lease?.optString("mode", "FREE") ?: "FREE"
                currentLeaseMode = newMode
                if (newMode == "HUMAN" && screenEngine == null) {
                    startSnapshotPushLoop()
                } else {
                    stopSnapshotPushLoop()
                }
                publishState(AgentConnectionPhase.CONNECTED)
                sendHello()
            }
            "lease_update" -> {
                val lease = msg.optJSONObject("lease")
                val token = lease?.optLong("fencingToken", 0) ?: 0
                control.advanceFencingToken(token)
                val newMode = lease?.optString("mode", "FREE") ?: "FREE"
                currentLeaseMode = newMode
                if (newMode == "HUMAN" && screenEngine == null) {
                    startSnapshotPushLoop()
                } else {
                    stopSnapshotPushLoop()
                }
                publishState(mutableRuntimeState.value.phase, mutableRuntimeState.value.detail)
            }
            "action" -> {
                val actionId = msg.optString("actionId")
                val token = msg.optLong("fencingToken", 0)
                val payload = msg.optJSONObject("payload") ?: JSONObject()
                handler.post {
                    control.execute(token, payload) { result ->
                        val out = JSONObject()
                            .put("type", "action_result")
                            .put("actionId", actionId)
                            .put("ok", result.optBoolean("ok", false))
                        if (result.has("error")) out.put("error", result.optString("error"))
                        if (result.has("data")) out.put("data", result.opt("data"))
                        socket?.send(out)

                        // Trigger immediate screen frame refresh after action completes
                        if (currentLeaseMode == "HUMAN" && screenEngine == null) {
                            handler.removeCallbacks(pushRunnable)
                            handler.postDelayed(pushRunnable, 80)
                        }
                    }
                }
            }
            "file_upload_start", "file_upload_chunk", "file_upload_end", "file_upload_abort" -> {
                fileTransfers.handle(msg)
            }
            "webrtc_start" -> {
                val engine = screenEngine
                if (engine == null) {
                    socket?.send(JSONObject().put("type", "webrtc_state").put("state", "projection_permission_required"))
                } else {
                    engine.start(rtcConfig)
                }
            }
            "webrtc_answer" -> screenEngine?.setAnswer(msg.optString("sdp"))
            "webrtc_ice" -> msg.optJSONObject("candidate")?.let { screenEngine?.addIceCandidate(it) }
            "webrtc_stop" -> {
                screenEngine?.stopPeer()
                socket?.send(JSONObject().put("type", "webrtc_state").put("state", "stopped"))
            }
        }
    }

    private fun replaceScreenEngine(data: Intent) {
        screenEngine?.stop()
        screenEngine = WebRtcScreenEngine(applicationContext, data) { signal -> socket?.send(signal) }
        // WebRTC is now active — stop the snapshot push loop
        stopSnapshotPushLoop()
        publishState(mutableRuntimeState.value.phase, mutableRuntimeState.value.detail)
    }

    private fun sendHello() {
        if (!socketOpen) return
        val (w, h) = screenSize()
        socket?.send(JSONObject()
            .put("type", "hello")
            .put("liveReady", screenEngine != null)
            .put("meta", JSONObject()
                .put("manufacturer", Build.MANUFACTURER)
                .put("model", Build.MODEL)
                .put("sdk", Build.VERSION.SDK_INT)
                .put("release", Build.VERSION.RELEASE)
                .put("agentVersionName", BuildConfig.VERSION_NAME)
                .put("agentVersionCode", BuildConfig.VERSION_CODE)
                .put("screenWidth", w)
                .put("screenHeight", h)
                .put("accessibilityReady", PhoneWeaveAccessibilityService.instance != null)
                .put("fileUpload", true)
                .put("maxUploadBytes", FileTransferEngine.MAX_UPLOAD_BYTES)))
    }

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            if (socketOpen) {
                socket?.send(JSONObject().put("type", "heartbeat").put("liveReady", screenEngine != null))
                handler.postDelayed(this, 15_000)
            }
        }
    }

    private fun scheduleHeartbeat() {
        handler.removeCallbacks(heartbeatRunnable)
        handler.postDelayed(heartbeatRunnable, 15_000)
    }

    // -------------------------------------------------------------------------
    // Snapshot push loop — active when HUMAN lease is held and WebRTC is not available
    // -------------------------------------------------------------------------

    private fun startSnapshotPushLoop() {
        if (snapshotPushActive || screenEngine != null) return
        snapshotPushActive = true
        schedulePush()
    }

    private fun stopSnapshotPushLoop() {
        snapshotPushActive = false
        handler.removeCallbacks(pushRunnable)
    }

    private val pushRunnable = Runnable { schedulePush() }

    private fun schedulePush() {
        if (!snapshotPushActive || !socketOpen || currentLeaseMode != "HUMAN" || screenEngine != null) {
            snapshotPushActive = false
            return
        }
        val startMs = android.os.SystemClock.elapsedRealtime()
        control.takeScreenshotForPush { result ->
            if (result.optBoolean("ok", false)) {
                val data = result.opt("data")
                if (data != null && socketOpen) {
                    socket?.send(
                        JSONObject()
                            .put("type", "screen_frame")
                            .putOpt("data", data)
                    )
                }
            }
            // Schedule next push after the screenshot completes (natural back-pressure).
            // The delay accounts for time already spent taking the screenshot.
            if (snapshotPushActive && socketOpen && currentLeaseMode == "HUMAN" && screenEngine == null) {
                val elapsed = android.os.SystemClock.elapsedRealtime() - startMs
                val nextDelay = maxOf(SNAPSHOT_PUSH_MIN_DELAY_MS, SNAPSHOT_PUSH_INTERVAL_MS - elapsed)
                handler.postDelayed(pushRunnable, nextDelay)
            } else {
                snapshotPushActive = false
            }
        }
    }

    private var connectedTimestamp: Long = 0L

    private fun publishState(phase: AgentConnectionPhase, detail: String? = null) {
        if (phase == AgentConnectionPhase.CONNECTED && connectedTimestamp == 0L) {
            connectedTimestamp = System.currentTimeMillis()
        } else if (phase == AgentConnectionPhase.STOPPED) {
            connectedTimestamp = 0L
        }
        mutableRuntimeState.value = AgentRuntimeState(
            phase = phase,
            detail = detail,
            hasProjection = screenEngine != null,
            leaseMode = currentLeaseMode,
            connectedAt = connectedTimestamp,
        )
    }

    private fun screenSize(): Pair<Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.maximumWindowMetrics.bounds
            Pair(b.width(), b.height())
        } else {
            @Suppress("DEPRECATION") val dm = resources.displayMetrics
            Pair(dm.widthPixels, dm.heightPixels)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel("phoneweave-agent", "PhoneWeave Agent", NotificationManager.IMPORTANCE_LOW))
        }
    }

    private fun notification(text: String): Notification = if (Build.VERSION.SDK_INT >= 26) {
        Notification.Builder(this, "phoneweave-agent")
            .setContentTitle("PhoneWeave Agent")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setOngoing(true)
            .build()
    } else {
        @Suppress("DEPRECATION") Notification.Builder(this)
            .setContentTitle("PhoneWeave Agent")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setOngoing(true)
            .build()
    }

    private fun startForegroundSpecialUse() {
        val n = notification("Remote control agent is active")
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1001, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(1001, n)
        }
    }

    private fun upgradeForegroundForProjection() {
        val n = notification("Remote control + live screen are active")
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1001, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1001, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(1001, n)
        }
    }
}
