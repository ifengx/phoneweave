package io.phoneweave.agent.control

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class ControlEngine(private val context: Context) {
    private val highestFencingToken = AtomicLong(0)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val isCapturingScreenshot = AtomicBoolean(false)
    private var lastScreenshotTime = 0L

    fun advanceFencingToken(token: Long) {
        highestFencingToken.updateAndGet { old -> maxOf(old, token) }
    }

    fun execute(fencingToken: Long, payload: JSONObject, callback: (JSONObject) -> Unit) {
        if (fencingToken < highestFencingToken.get()) {
            callback(error("STALE_FENCING_TOKEN"))
            return
        }
        val service = PhoneWeaveAccessibilityService.instance
        if (service == null) {
            callback(error("ACCESSIBILITY_NOT_READY"))
            return
        }
        try {
            when (payload.optString("type")) {
                "tap" -> tap(service, payload.optDouble("x", 0.0).toFloat(), payload.optDouble("y", 0.0).toFloat(), callback)
                "swipe" -> swipe(service,
                    payload.optDouble("x1", 0.0).toFloat(), payload.optDouble("y1", 0.0).toFloat(),
                    payload.optDouble("x2", 0.0).toFloat(), payload.optDouble("y2", 0.0).toFloat(),
                    payload.optLong("durationMs", 300L), callback)
                "input_text" -> inputText(service, payload.optString("text"), callback)
                "back" -> callback(ok(service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)))
                "home" -> callback(ok(service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)))
                "recents" -> callback(ok(service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS)))
                "launch_app" -> launchApp(payload.optString("packageName"), callback)
                "ui_tree" -> callback(JSONObject().put("ok", true).put("data", UiTree.snapshot(service)))
                "snapshot" -> snapshot(service, payload.optInt("quality", 70), callback)
                else -> callback(error("UNKNOWN_ACTION"))
            }
        } catch (t: Throwable) {
            callback(error(t.message ?: t.javaClass.simpleName))
        }
    }

    private fun tap(service: PhoneWeaveAccessibilityService, x: Float, y: Float, cb: (JSONObject) -> Unit) {
        val path = Path().apply {
            moveTo(x, y)
            lineTo(x, y)
        }
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 120L)).build()
        dispatch(service, gesture, cb)
    }

    private fun findClickableNodeAt(node: AccessibilityNodeInfo, x: Int, y: Int): AccessibilityNodeInfo? {
        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (!rect.contains(x, y)) return null

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findClickableNodeAt(child, x, y)
            if (found != null) return found
        }

        if (node.isClickable) return node
        return null
    }

    private fun swipe(service: PhoneWeaveAccessibilityService, x1: Float, y1: Float, x2: Float, y2: Float, duration: Long, cb: (JSONObject) -> Unit) {
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration.coerceIn(80, 2000))).build()
        dispatch(service, gesture, cb)
    }

    private val gestureQueue = java.util.ArrayDeque<Pair<GestureDescription, (JSONObject) -> Unit>>()
    private var isGestureRunning = false

    @Synchronized
    private fun dispatch(service: PhoneWeaveAccessibilityService, gesture: GestureDescription, cb: (JSONObject) -> Unit) {
        gestureQueue.addLast(Pair(gesture, cb))
        processNextGesture(service)
    }

    @Synchronized
    private fun processNextGesture(service: PhoneWeaveAccessibilityService) {
        if (isGestureRunning || gestureQueue.isEmpty()) return
        val (gesture, cb) = gestureQueue.removeFirst()
        isGestureRunning = true
        mainHandler.post {
            val accepted = service.dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    synchronized(this@ControlEngine) {
                        isGestureRunning = false
                        processNextGesture(service)
                    }
                    cb(ok(true))
                }
                override fun onCancelled(gestureDescription: GestureDescription?) {
                    synchronized(this@ControlEngine) {
                        isGestureRunning = false
                        processNextGesture(service)
                    }
                    cb(error("GESTURE_CANCELLED"))
                }
            }, mainHandler)
            if (!accepted) {
                synchronized(this@ControlEngine) {
                    isGestureRunning = false
                    processNextGesture(service)
                }
                cb(error("GESTURE_REJECTED"))
            }
        }
    }

    private fun inputText(service: PhoneWeaveAccessibilityService, text: String, cb: (JSONObject) -> Unit) {
        val focused = service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (focused == null) { cb(error("NO_INPUT_FOCUS")); return }
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        cb(ok(focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)))
    }

    private fun launchApp(packageName: String, cb: (JSONObject) -> Unit) {
        val launch = context.packageManager.getLaunchIntentForPackage(packageName)
        if (launch == null) { cb(error("PACKAGE_NOT_LAUNCHABLE")); return }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launch)
        cb(ok(true))
    }

    private fun compressBitmap(bitmap: Bitmap, quality: Int): ByteArray? =
        try {
            ByteArrayOutputStream().use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(20, 95), out)
                out.toByteArray()
            }
        } catch (_: Throwable) { null }

    private fun snapshot(service: PhoneWeaveAccessibilityService, quality: Int, cb: (JSONObject) -> Unit) {
        if (Build.VERSION.SDK_INT < 30) { cb(error("SCREENSHOT_REQUIRES_API_30")); return }
        if (!isCapturingScreenshot.compareAndSet(false, true)) {
            cb(error("SCREENSHOT_BUSY"))
            return
        }
        val executor: Executor = context.mainExecutor
        service.takeScreenshot(Display.DEFAULT_DISPLAY, executor, object : AccessibilityService.TakeScreenshotCallback {
            override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                isCapturingScreenshot.set(false)
                lastScreenshotTime = android.os.SystemClock.elapsedRealtime()
                try {
                    val hardware = screenshot.hardwareBuffer
                    val wrapped = Bitmap.wrapHardwareBuffer(hardware, screenshot.colorSpace)
                    hardware.close()
                    if (wrapped == null) { cb(error("SCREENSHOT_BITMAP_FAILED")); return }

                    // API 31+: try compressing hardware bitmap directly (avoids expensive ARGB_8888 copy).
                    // Falls back to software copy on older APIs or if hardware compress fails.
                    val bytes: ByteArray? = if (Build.VERSION.SDK_INT >= 31) {
                        val result = compressBitmap(wrapped, quality)
                        wrapped.recycle()
                        result
                    } else null

                    val finalBytes = bytes ?: run {
                        // Software fallback: copy to ARGB_8888 then compress
                        val soft = wrapped.copy(Bitmap.Config.ARGB_8888, false)
                        wrapped.recycle()
                        if (soft == null) { cb(error("SCREENSHOT_COPY_FAILED")); return@run null }
                        val r = compressBitmap(soft, quality)
                        soft.recycle()
                        r
                    } ?: run { cb(error("SCREENSHOT_COMPRESS_FAILED")); return }

                    cb(JSONObject().put("ok", true).put("data", JSONObject()
                        .put("mime", "image/jpeg")
                        .put("imageBase64", Base64.encodeToString(finalBytes, Base64.NO_WRAP))))
                } catch (t: Throwable) { cb(error(t.message ?: "SCREENSHOT_FAILED")) }
            }
            override fun onFailure(errorCode: Int) {
                isCapturingScreenshot.set(false)
                cb(error("SCREENSHOT_FAILED_$errorCode"))
            }
        })
    }

    /**
     * Passive screenshot for the push-frame loop.
     * Does NOT validate the fencing token — this is a read-only operation.
     * Called by AgentForegroundService when a HUMAN lease is active and WebRTC is unavailable.
     */
    fun takeScreenshotForPush(quality: Int = 55, callback: (JSONObject) -> Unit) {
        val service = PhoneWeaveAccessibilityService.instance
        if (service == null) { callback(error("ACCESSIBILITY_NOT_READY")); return }
        snapshot(service, quality, callback)
    }

    private fun ok(value: Boolean) = JSONObject().put("ok", value)
    private fun error(message: String) = JSONObject().put("ok", false).put("error", message)
}
