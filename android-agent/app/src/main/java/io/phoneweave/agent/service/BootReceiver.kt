package io.phoneweave.agent.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import io.phoneweave.agent.util.Prefs

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED || !Prefs.autoStart(context)) return
        val service = Intent(context, AgentForegroundService::class.java).setAction(AgentForegroundService.ACTION_START)
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service) else context.startService(service)
        } catch (_: Throwable) {
            // Vendor ROMs may block background FGS starts. The UI and docs expose this as a recoverable condition.
        }
    }
}
