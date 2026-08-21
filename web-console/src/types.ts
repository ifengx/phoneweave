export type Lease = { mode: 'FREE' | 'AGENT' | 'HUMAN'; owner?: string; fencingToken?: number }
export type AgentVersion = { name: string; code: number }
export type DeviceMeta = {
  model?: string
  manufacturer?: string
  sdk?: number
  release?: string
  screenWidth?: number
  screenHeight?: number
  ip?: string
  accessibilityReady?: boolean
  fileUpload?: boolean
  maxUploadBytes?: number
  agentVersionName?: string
  agentVersionCode?: number
}
export type Device = {
  id: string
  online: boolean
  liveReady?: boolean
  lastSeen?: number
  lease?: Lease
  meta?: DeviceMeta
  ping?: number
  fps?: number
}
