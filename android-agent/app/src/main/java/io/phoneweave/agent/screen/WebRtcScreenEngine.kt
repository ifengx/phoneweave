package io.phoneweave.agent.screen

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.util.DisplayMetrics
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.concurrent.atomic.AtomicBoolean

class WebRtcScreenEngine(
    private val context: Context,
    private val projectionPermissionData: Intent,
    private val signal: (JSONObject) -> Unit,
) {
    companion object {
        private val initialized = AtomicBoolean(false)
    }

    private val eglBase = EglBase.create()
    private var factory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var capturer: VideoCapturer? = null
    private var helper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var started = false

    init {
        if (initialized.compareAndSet(false, true)) {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                    .setEnableInternalTracer(false)
                    .createInitializationOptions()
            )
        }
    }

    fun start(iceServerJson: JSONArray) {
        stopPeerOnly()
        ensureFactory()
        val pcFactory = factory ?: return
        val config = PeerConnection.RTCConfiguration(parseIceServers(iceServerJson)).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        peer = pcFactory.createPeerConnection(config, observer()) ?: run {
            signal(JSONObject().put("type", "webrtc_state").put("state", "peer_create_failed")); return
        }

        if (!started) startCapture(pcFactory)
        val track = videoTrack ?: return
        peer?.addTrack(track, listOf("phoneweave-screen"))

        peer?.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription?) {
                if (desc == null) return
                peer?.setLocalDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        signal(JSONObject().put("type", "webrtc_offer").put("sdp", desc.description))
                    }
                }, desc)
            }
        }, org.webrtc.MediaConstraints())
    }

    fun setAnswer(sdp: String) {
        peer?.setRemoteDescription(SimpleSdpObserver(), SessionDescription(SessionDescription.Type.ANSWER, sdp))
    }

    fun addIceCandidate(candidate: JSONObject) {
        val c = IceCandidate(candidate.optString("sdpMid"), candidate.optInt("sdpMLineIndex", 0), candidate.optString("candidate"))
        peer?.addIceCandidate(c)
    }

    fun stopPeer() {
        stopPeerOnly()
    }

    fun stop() {
        stopPeerOnly()
        try { capturer?.stopCapture() } catch (_: Throwable) {}
        capturer?.dispose(); capturer = null
        helper?.dispose(); helper = null
        videoTrack?.dispose(); videoTrack = null
        videoSource?.dispose(); videoSource = null
        started = false
        factory?.dispose(); factory = null
        eglBase.release()
    }

    private fun stopPeerOnly() {
        peer?.close(); peer?.dispose(); peer = null
    }

    private fun ensureFactory() {
        if (factory != null) return
        val encoder = DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true)
        val decoder = DefaultVideoDecoderFactory(eglBase.eglBaseContext)
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoder)
            .setVideoDecoderFactory(decoder)
            .createPeerConnectionFactory()
    }

    private fun startCapture(pcFactory: PeerConnectionFactory) {
        val screenCapturer = ScreenCapturerAndroid(projectionPermissionData, object : MediaProjection.Callback() {
            override fun onStop() {
                signal(JSONObject().put("type", "webrtc_state").put("state", "projection_stopped"))
            }
        })
        val source = pcFactory.createVideoSource(true)
        val surfaceHelper = SurfaceTextureHelper.create("PhoneWeaveCapture", eglBase.eglBaseContext)
        screenCapturer.initialize(surfaceHelper, context, source.capturerObserver)

        val (width, height) = captureSize()
        screenCapturer.startCapture(width, height, 30)
        val track = pcFactory.createVideoTrack("phoneweave-screen", source)
        track.setEnabled(true)

        capturer = screenCapturer
        helper = surfaceHelper
        videoSource = source
        videoTrack = track
        started = true
        signal(JSONObject().put("type", "webrtc_state").put("state", "capture_ready").put("width", width).put("height", height))
    }

    private fun captureSize(): Pair<Int, Int> {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = if (android.os.Build.VERSION.SDK_INT >= 30) {
            val b = wm.maximumWindowMetrics.bounds
            Pair(b.width(), b.height())
        } else {
            @Suppress("DEPRECATION") val dm = DisplayMetrics().also { wm.defaultDisplay.getRealMetrics(it) }
            Pair(dm.widthPixels, dm.heightPixels)
        }
        val w = metrics.first.coerceAtLeast(1)
        val h = metrics.second.coerceAtLeast(1)
        val maxLong = 1600.0
        val longSide = maxOf(w, h).toDouble()
        if (longSide <= maxLong) return Pair(even(w), even(h))
        val scale = maxLong / longSide
        return Pair(even((w * scale).toInt()), even((h * scale).toInt()))
    }

    private fun even(v: Int): Int = if (v % 2 == 0) v else v - 1

    private fun parseIceServers(array: JSONArray): List<PeerConnection.IceServer> {
        val out = mutableListOf<PeerConnection.IceServer>()
        for (i in 0 until array.length()) {
            val o = array.optJSONObject(i) ?: continue
            val rawUrls = mutableListOf<String>()
            when (val u = o.opt("urls")) {
                is JSONArray -> for (j in 0 until u.length()) rawUrls += u.optString(j)
                is String -> rawUrls += u
            }
            if (rawUrls.isEmpty()) continue
            val resolvedUrls = rawUrls.map { io.phoneweave.agent.net.SmartDns.instance.resolveUrl(it) }
            out += PeerConnection.IceServer.builder(resolvedUrls)
                .setUsername(o.optString("username", ""))
                .setPassword(o.optString("credential", ""))
                .createIceServer()
        }
        return out
    }

    private fun observer() = object : PeerConnection.Observer {
        override fun onSignalingChange(newState: PeerConnection.SignalingState?) = Unit
        override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
            signal(JSONObject().put("type", "webrtc_state").put("state", "ice_${newState?.name?.lowercase()}"))
        }
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) = Unit
        override fun onIceCandidate(candidate: IceCandidate?) {
            if (candidate == null) return
            signal(JSONObject().put("type", "webrtc_ice").put("candidate", JSONObject()
                .put("sdpMid", candidate.sdpMid)
                .put("sdpMLineIndex", candidate.sdpMLineIndex)
                .put("candidate", candidate.sdp)))
        }
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
        override fun onAddStream(stream: MediaStream?) = Unit
        override fun onRemoveStream(stream: MediaStream?) = Unit
        override fun onDataChannel(dataChannel: DataChannel?) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) = Unit
        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
            signal(JSONObject().put("type", "webrtc_state").put("state", "peer_${newState?.name?.lowercase()}"))
        }
        override fun onTrack(transceiver: org.webrtc.RtpTransceiver?) = Unit
    }

    open class SimpleSdpObserver : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription?) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String?) = Unit
        override fun onSetFailure(error: String?) = Unit
    }
}
