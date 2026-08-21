import type { Device, Lease } from '../../types'

export type ControlAction =
  | { type: 'tap'; x: number; y: number }
  | { type: 'swipe'; x1: number; y1: number; x2: number; y2: number; durationMs: number }
  | { type: 'input_text'; text: string }
  | { type: 'back' | 'home' | 'recents' | 'ui_tree' }
  | { type: 'snapshot'; quality?: number }

export type ActionResult = {
  ok: boolean
  error?: string
  data?: { mime?: string; imageBase64?: string } | unknown
}

type SessionCallbacks = {
  onDevice?: (device: Device | null) => void
  onLease?: (lease: Lease) => void
  onStream?: (stream: MediaStream) => void
  onSnapshot?: (dataUrl: string) => void
  onState?: (state: string) => void
  onError?: (error: Error) => void
}

type PendingAction = {
  resolve: (result: ActionResult) => void
  reject: (error: Error) => void
  timer: number
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11)
}

export class RemoteDeviceSession {
  private ws: WebSocket | null = null
  private peer: RTCPeerConnection | null = null
  private device: Device | null = null
  private iceServers: RTCIceServer[] = []
  private pendingIce: RTCIceCandidateInit[] = []
  private pendingActions = new Map<string, PendingAction>()
  private stopped = false
  private viewRequested = false

  constructor(
    private readonly deviceId: string,
    private readonly callbacks: SessionCallbacks = {},
  ) {}

  start(): Promise<void> {
    this.stopped = false
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${scheme}//${window.location.host}/ws/human?deviceId=${encodeURIComponent(this.deviceId)}`

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      ws.onopen = () => {
        this.callbacks.onState?.('control_connected')
        this.send({ type: 'takeover' })
        resolve()
      }
      ws.onmessage = event => void this.handleMessage(JSON.parse(String(event.data)))
      ws.onerror = () => {
        const error = new Error('CONTROL_SOCKET_FAILED')
        this.callbacks.onError?.(error)
        reject(error)
      }
      ws.onclose = () => {
        if (!this.stopped) this.callbacks.onState?.('control_disconnected')
        this.rejectPending(new Error('CONTROL_SOCKET_CLOSED'))
      }
    })
  }

  async action(payload: ControlAction, timeoutMs = 8_000): Promise<ActionResult> {
    const requestId = generateRequestId()
    const promise = new Promise<ActionResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingActions.delete(requestId)
        reject(new Error('ACTION_TIMEOUT'))
      }, timeoutMs)
      this.pendingActions.set(requestId, { resolve, reject, timer })
    })
    this.send({ type: 'action', requestId, payload })
    return promise
  }

  /** Fire-and-forget input: sends an action with no requestId so the result is silently discarded.
   *  Use for tap/swipe/back/home/recents where the push-frame loop provides visual feedback. */
  sendInput(payload: ControlAction): void {
    try {
      this.send({ type: 'action', payload })
    } catch {
      // socket not open — silently ignore
    }
  }

  async snapshot(): Promise<string> {
    const result = await this.action({ type: 'snapshot', quality: 72 })
    if (!result.ok) throw new Error(result.error || 'SNAPSHOT_FAILED')
    const data = result.data as { mime?: string; imageBase64?: string } | undefined
    if (!data?.imageBase64) throw new Error('SNAPSHOT_EMPTY')
    const dataUrl = `data:${data.mime || 'image/jpeg'};base64,${data.imageBase64}`
    this.callbacks.onSnapshot?.(dataUrl)
    return dataUrl
  }

  stop() {
    this.stopped = true
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'webrtc_stop' })
      this.send({ type: 'release' })
      this.ws.close(1000, 'operator disconnected')
    }
    this.ws = null
    this.closePeer()
    this.rejectPending(new Error('SESSION_STOPPED'))
    this.callbacks.onState?.('stopped')
  }

  private send(message: object) {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error('CONTROL_SOCKET_NOT_OPEN')
    this.ws.send(JSON.stringify(message))
  }

  private async handleMessage(message: Record<string, any>) {
    try {
      switch (message.type) {
        case 'device_status':
          this.device = message.device ?? null
          this.iceServers = message.rtc?.iceServers ?? this.iceServers
          this.callbacks.onDevice?.(this.device)
          break
        case 'lease':
          this.callbacks.onLease?.(message.lease)
          if (message.lease?.mode === 'HUMAN' && !this.viewRequested) {
            this.viewRequested = true
            if (this.device?.liveReady) {
              this.send({ type: 'webrtc_start' })
            }
          }
          break
        case 'webrtc_offer':
          await this.acceptOffer(message.sdp)
          break
        case 'webrtc_ice':
          await this.acceptIce(message.candidate)
          break
        case 'webrtc_state':
          this.callbacks.onState?.(message.state || 'webrtc_unknown')
          break
        case 'screen_frame': {
          // Passive push frame from Android's continuous snapshot loop
          const data = message.data as { mime?: string; imageBase64?: string } | undefined
          if (data?.imageBase64) {
            const dataUrl = `data:${data.mime ?? 'image/jpeg'};base64,${data.imageBase64}`
            this.callbacks.onSnapshot?.(dataUrl)
          }
          break
        }
        case 'human_action_result': {
          const pending = this.pendingActions.get(message.requestId)
          if (!pending) break
          window.clearTimeout(pending.timer)
          this.pendingActions.delete(message.requestId)
          pending.resolve(message.result as ActionResult)
          break
        }
        case 'error':
          this.callbacks.onError?.(new Error(message.error || 'SESSION_ERROR'))
          break
      }
    } catch (cause) {
      this.callbacks.onError?.(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  private ensurePeer() {
    if (this.peer) return this.peer
    const peer = new RTCPeerConnection({ iceServers: this.iceServers })
    peer.onicecandidate = event => {
      if (event.candidate) this.send({ type: 'webrtc_ice', candidate: event.candidate.toJSON() })
    }
    peer.ontrack = event => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      this.callbacks.onStream?.(stream)
      this.callbacks.onState?.('live')
    }
    peer.onconnectionstatechange = () => this.callbacks.onState?.(`peer_${peer.connectionState}`)
    this.peer = peer
    return peer
  }

  private async acceptOffer(sdp: string) {
    const peer = this.ensurePeer()
    await peer.setRemoteDescription({ type: 'offer', sdp })
    for (const candidate of this.pendingIce.splice(0)) await peer.addIceCandidate(candidate)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    this.send({ type: 'webrtc_answer', sdp: answer.sdp })
  }

  private async acceptIce(candidate?: RTCIceCandidateInit) {
    if (!candidate) return
    if (!this.peer?.remoteDescription) {
      this.pendingIce.push(candidate)
      return
    }
    await this.peer.addIceCandidate(candidate)
  }

  private closePeer() {
    this.peer?.close()
    this.peer = null
    this.pendingIce = []
  }

  private rejectPending(error: Error) {
    for (const pending of this.pendingActions.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingActions.clear()
  }
}
