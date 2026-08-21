package io.phoneweave.agent.net

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class SmartDns private constructor() {
    companion object {
        val instance = SmartDns()
        private const val TAG = "PhoneWeave/SmartDns"
    }

    private val cache = ConcurrentHashMap<String, List<InetAddress>>()
    private val httpDnsClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    /**
     * Resolves a hostname to IP addresses, bypassing Fake-IP pollution.
     * Used exclusively for WebRTC ICE URL pre-resolution — do NOT use as an OkHttp Dns provider.
     */
    private fun resolve(hostname: String): List<InetAddress> {
        // Fast path for raw IPs and localhost
        if (hostname.equals("localhost", true) || hostname == "10.0.2.2" || hostname == "127.0.0.1") {
            return InetAddress.getAllByName(hostname).toList()
        }

        cache[hostname]?.let { if (it.isNotEmpty()) return it }

        Log.i(TAG, "Looking up hostname: $hostname")
        val systemList = try {
            InetAddress.getAllByName(hostname).toList()
        } catch (e: Exception) {
            Log.w(TAG, "System DNS lookup threw for $hostname: ${e.message}")
            emptyList()
        }

        val validList = systemList.filterNot { isFakeIp(it) }
        if (validList.isNotEmpty()) {
            Log.i(TAG, "System DNS returned valid IP for $hostname: $validList")
            cache[hostname] = validList
            return validList
        }

        // If system DNS returned a Fake-IP (198.18.x.x / 198.19.x.x) or resolution failed,
        // use Public HTTP DNS (AliDNS / DNSPod) to get real public IP.
        Log.w(TAG, "System DNS returned invalid/fake IP for $hostname ($systemList). Falling back to HTTP DNS...")
        val fallbackList = resolveViaHttpDns(hostname)
        if (fallbackList.isNotEmpty()) {
            Log.i(TAG, "HTTP DNS resolved $hostname -> $fallbackList")
            cache[hostname] = fallbackList
            return fallbackList
        }

        return if (systemList.isNotEmpty()) systemList else InetAddress.getAllByName(hostname).toList()
    }

    /**
     * Resolves domain in ICE URLs (e.g. turn:turn.example.com:3478 -> turn:198.51.100.1:3478)
     * so WebRTC native C++ layer connects directly without being poisoned by Fake-IP.
     */
    fun resolveUrl(url: String): String {
        return try {
            val schemeEnd = url.indexOf(':')
            if (schemeEnd <= 0) return url
            val scheme = url.substring(0, schemeEnd)
            val rest = url.substring(schemeEnd + 1)
            val portIndex = rest.lastIndexOf(':')
            val host = if (portIndex > 0) rest.substring(0, portIndex) else rest
            val port = if (portIndex > 0) rest.substring(portIndex) else ""

            if (host.matches(Regex("\\d+\\.\\d+\\.\\d+\\.\\d+"))) {
                return url
            }

            val addresses = resolve(host)
            if (addresses.isNotEmpty()) {
                val realIp = addresses.first().hostAddress
                Log.i(TAG, "Resolved ICE URL: $url -> $scheme:$realIp$port")
                "$scheme:$realIp$port"
            } else {
                url
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to resolve ICE URL $url: ${t.message}")
            url
        }
    }

    private fun isFakeIp(addr: InetAddress): Boolean {
        val b = addr.address
        // 198.18.0.0/15 (198.18.0.0 - 198.19.255.255) is the benchmark range used by Clash / Surge Fake-IP
        if (b.size == 4) {
            val first = b[0].toInt() and 0xFF
            val second = b[1].toInt() and 0xFF
            if (first == 198 && (second == 18 || second == 19)) {
                return true
            }
        }
        return false
    }

    private fun resolveViaHttpDns(hostname: String): List<InetAddress> {
        // 1. Query AliDNS HTTP-DNS (using HTTP to avoid IP certificate verification mismatch)
        try {
            val req = Request.Builder()
                .url("http://223.5.5.5/resolve?name=$hostname&type=A")
                .build()
            httpDnsClient.newCall(req).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: ""
                    val json = JSONObject(body)
                    val answers = json.optJSONArray("Answer")
                    if (answers != null && answers.length() > 0) {
                        val result = mutableListOf<InetAddress>()
                        for (i in 0 until answers.length()) {
                            val item = answers.optJSONObject(i) ?: continue
                            val ip = item.optString("data")
                            if (ip.isNotBlank()) {
                                try {
                                    result.add(InetAddress.getByAddress(hostname, InetAddress.getByName(ip).address))
                                } catch (_: Throwable) {}
                            }
                        }
                        if (result.isNotEmpty()) return result
                    }
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "AliDNS lookup failed for $hostname: ${t.message}")
        }

        // 2. Query Tencent DNSPod HTTP-DNS (http://119.29.29.29/d?dn=...)
        try {
            val req = Request.Builder()
                .url("http://119.29.29.29/d?dn=$hostname")
                .build()
            httpDnsClient.newCall(req).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: ""
                    val ips = body.trim().split(";")
                    val result = mutableListOf<InetAddress>()
                    for (ip in ips) {
                        if (ip.matches(Regex("\\d+\\.\\d+\\.\\d+\\.\\d+"))) {
                            try {
                                result.add(InetAddress.getByAddress(hostname, InetAddress.getByName(ip).address))
                            } catch (_: Throwable) {}
                        }
                    }
                    if (result.isNotEmpty()) return result
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "DNSPod lookup failed for $hostname: ${t.message}")
        }

        return emptyList()
    }
}
