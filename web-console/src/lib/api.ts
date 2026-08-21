import type { AgentVersion, Device } from '../types'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers)
  if (opts.body && typeof opts.body !== 'string') headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...opts, headers, credentials: 'same-origin' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.error || `HTTP_${response.status}`, response.status)
  return data as T
}

export function webSession() {
  return api<{ authenticated: boolean }>('/api/web/session')
}

export function webLogin(token: string) {
  return api<{ authenticated: true }>('/api/web/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

export function webLogout() {
  return api<{ authenticated: false }>('/api/web/logout', { method: 'POST' })
}

export async function listDevices() {
  return api<{ devices: Device[]; latestAgentVersion: AgentVersion }>('/api/devices')
}

export type FileUploadResult = {
  transferId: string
  fileName: string
  bytes: number
  uri?: string
}

export type SentinelSummary = {
  ok: boolean
  sentinel: {
    active: boolean
    uptimeMs: number
    timeoutMs: number
    checkIntervalMs: number
    sseSubscribers: number
  }
  metrics: {
    totalDevices: number
    onlineDevices: number
    readyDevices: number
  }
  devices: Array<{
    id: string
    online: boolean
    readiness: 'READY' | 'PARTIAL' | 'BASIC' | 'OFFLINE'
    accessibilityReady: boolean
    liveReady: boolean
    fileUpload: boolean
    leaseMode: string
    lastSeenMsAgo: number
    uptimeMs: number
    model: string
    ip: string | null
    agentVersion: string | null
  }>
}

export function getSentinelSummary() {
  return api<SentinelSummary>('/api/sentinel/summary')
}

export function uploadFile(
  deviceId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<FileUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/devices/${encodeURIComponent(deviceId)}/files?name=${encodeURIComponent(file.name)}`)
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.withCredentials = true
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onerror = () => reject(new Error('UPLOAD_NETWORK_ERROR'))
    xhr.onload = () => {
      let body: any = {}
      try { body = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(body.error || `HTTP_${xhr.status}`))
        return
      }
      onProgress?.(100)
      resolve(body.result as FileUploadResult)
    }
    xhr.send(file)
  })
}
