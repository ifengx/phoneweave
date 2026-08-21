package io.phoneweave.agent.util

import android.content.Context
import io.phoneweave.agent.BuildConfig

object Prefs {
    private const val NAME = "phoneweave"
    private const val KEY_SERVER = "server"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_AUTO_START = "auto_start"
    private const val LEGACY_LOCAL_SERVER = "http://10.0.2.2:8787"

    fun server(context: Context): String {
        val stored = context.getSharedPreferences(NAME, Context.MODE_PRIVATE).getString(KEY_SERVER, null)
        return if (stored.isNullOrBlank() || stored == LEGACY_LOCAL_SERVER) BuildConfig.DEFAULT_SERVER_URL else stored
    }

    fun deviceId(context: Context): String = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)
        .getString(KEY_DEVICE_ID, android.os.Build.MODEL.replace(" ", "-").lowercase())
        ?: "android-device"

    fun deviceToken(context: Context): String = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)
        .getString(KEY_DEVICE_TOKEN, "change-me-device") ?: "change-me-device"

    fun autoStart(context: Context): Boolean = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)
        .getBoolean(KEY_AUTO_START, true)

    fun save(context: Context, server: String, deviceId: String, deviceToken: String, autoStart: Boolean = true) {
        context.getSharedPreferences(NAME, Context.MODE_PRIVATE).edit()
            .putString(KEY_SERVER, server.trim().trimEnd('/'))
            .putString(KEY_DEVICE_ID, deviceId.trim())
            .putString(KEY_DEVICE_TOKEN, deviceToken.trim())
            .putBoolean(KEY_AUTO_START, autoStart)
            .apply()
    }
}
