import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownToLine, ArrowLeft, Camera, Command, Copy, Cpu, Files, Fullscreen,
  Gauge, History, Keyboard, LoaderCircle, LockKeyhole, LogOut, MonitorSmartphone, MoreHorizontal,
  Network, PanelLeftClose, PanelLeftOpen, PanelRight, Play, RefreshCcw, Search, Settings2, ShieldCheck, Smartphone,
  TerminalSquare, Unplug, Upload, Wifi, X,
} from 'lucide-react'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { Badge } from './components/ui/badge'
import { Input } from './components/ui/input'
import { Switch } from './components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import { ApiError, listDevices, uploadFile, webLogin, webLogout, webSession } from './lib/api'
import type { AgentVersion, Device } from './types'
import { mapPointerToDevice, type Point } from './features/device-control/coordinates'
import { RemoteDeviceSession, type ControlAction } from './features/device-control/remote-session'

const nav = [
  ['devices', '设备列表', MonitorSmartphone],
  ['history', '历史连接', History],
  ['transfers', '传输任务', Files],
  ['security', '安全设置', ShieldCheck],
] as const

function latencyTone(ping = 0) {
  if (!ping) return 'bg-zinc-600'
  if (ping > 100) return 'bg-orange-500'
  return 'bg-green-500'
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${bytes} B`
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 72},${20 - (v / max) * 16}`).join(' ')
  return <svg viewBox="0 0 72 20" className="h-5 w-[72px] overflow-visible"><polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} className="text-cyan-400" /></svg>
}

function agentVersionStatus(device?: Device, latest?: AgentVersion) {
  const installedCode = device?.meta?.agentVersionCode
  if (!installedCode || !latest?.code) return { label: '版本未知', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-300' }
  if (installedCode < latest.code) return { label: '需要更新', tone: 'border-red-500/30 bg-red-500/10 text-red-300' }
  if (installedCode > latest.code) return { label: '开发版本', tone: 'border-blue-500/30 bg-blue-500/10 text-blue-300' }
  return { label: '已是最新', tone: 'border-green-500/30 bg-green-500/10 text-green-300' }
}

function DeviceCard({ device, latestAgentVersion, selected, onClick }: { device: Device; latestAgentVersion: AgentVersion; selected: boolean; onClick: () => void }) {
  const ping = device.ping ?? (device.online ? 30 : 0)
  const version = agentVersionStatus(device, latestAgentVersion)
  const accessibilityOk = Boolean(device.meta?.accessibilityReady)
  return (
    <button onClick={onClick} className={`group w-full rounded-xl border p-3.5 text-left transition-all active:scale-[0.99] ${selected ? 'border-blue-500/60 bg-blue-500/[0.07] shadow-[0_0_0_1px_rgba(59,130,246,.12)]' : 'border-zinc-800 bg-zinc-900/70 hover:border-zinc-700 hover:bg-zinc-900'}`}>
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 group-hover:text-zinc-200"><Smartphone className="size-4.5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><div className="truncate text-sm font-semibold text-zinc-100">{device.meta?.model || device.id}</div><span className={`size-1.5 rounded-full ${device.online ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,.55)]' : 'bg-red-500'}`} /></div>
          <div className="mono mt-1 truncate text-[11px] text-zinc-500">{device.meta?.ip || 'No address'} · {device.id}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mono text-[10px] text-zinc-500">v{device.meta?.agentVersionName || '—'}{device.meta?.agentVersionCode ? ` (${device.meta.agentVersionCode})` : ''}</span>
            <span className={`rounded border px-1.5 py-0.5 text-[9px] ${version.tone}`}>{version.label}</span>
            <span className={`rounded border px-1.5 py-0.5 text-[9px] ${accessibilityOk ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'}`}>
              {accessibilityOk ? '触控就绪' : '无障碍未开'}
            </span>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400"><span className={`size-1.5 rounded-full ${latencyTone(ping)}`} />{device.online ? `${ping} ms` : 'Offline'}</div>
            <Sparkline values={device.online ? [26, 24, 29, 22, ping, 25, 27, ping] : [1,1,1,1,1,1,1,1]} />
          </div>
        </div>
      </div>
    </button>
  )
}

export function App() {
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking')
  const [loginToken, setLoginToken] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [latestAgentVersion, setLatestAgentVersion] = useState<AgentVersion>({ name: 'unknown', code: 0 })
  const [selectedId, setSelectedId] = useState('')
  const [activeNav, setActiveNav] = useState('devices')
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    const preference = localStorage.getItem('phoneweaveSidebar')
    return preference ? preference === 'expanded' : window.innerWidth >= 1600
  })
  const [drawer, setDrawer] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const [connected, setConnected] = useState(false)
  const [live, setLive] = useState(false)
  const [snapshot, setSnapshot] = useState('')
  const [connectionState, setConnectionState] = useState('idle')
  const [clipboardSync, setClipboardSync] = useState(true)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [log, setLog] = useState<string[]>(['Console ready'])
  const videoRef = useRef<HTMLVideoElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<RemoteDeviceSession | null>(null)
  const pointerStart = useRef<{ point: Point; at: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selected = useMemo(() => devices.find(d => d.id === selectedId) || devices[0], [devices, selectedId])

  async function refresh() {
    try {
      const result = await listDevices()
      setDevices(result.devices)
      setLatestAgentVersion(result.latestAgentVersion || { name: 'unknown', code: 0 })
      setSelectedId(current => result.devices.some(device => device.id === current) ? current : (result.devices[0]?.id || ''))
      setLog(v => [`Device registry refreshed · ${new Date().toLocaleTimeString()}`, ...v].slice(0, 20))
    } catch (error) {
      setDevices([])
      if (error instanceof ApiError && error.status === 401) {
        sessionRef.current?.stop()
        sessionRef.current = null
        setAuthState('unauthenticated')
        setLoginError('登录已过期，请重新输入访问密码。')
      }
      setLog(v => [`Server unavailable · ${error instanceof Error ? error.message : error}`, ...v].slice(0, 20))
    }
  }

  useEffect(() => {
    let active = true
    void webSession().then(result => {
      if (!active) return
      setAuthState(result.authenticated ? 'authenticated' : 'unauthenticated')
      if (result.authenticated) void refresh()
    }).catch(() => {
      if (active) {
        setAuthState('unauthenticated')
        setLoginError('无法连接到 PhoneWeave 服务。')
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (authState !== 'authenticated') return
    const es = new EventSource('/api/sentinel/stream')
    es.addEventListener('device_status', () => {
      void refresh()
    })
    return () => {
      es.close()
    }
  }, [authState])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen(v => !v) }
      if (e.key === 'Escape') setCommandOpen(false)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => () => sessionRef.current?.stop(), [])

  function appendLog(message: string) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    setLog(v => [`[${time}] ${message}`, ...v].slice(0, 100))
  }

  async function connect() {
    if (!selected?.online) { appendLog('⚠️ 所选设备当前处于离线状态'); return }
    sessionRef.current?.stop()
    setSnapshot('')
    setLive(false)
    setConnectionState('connecting')
    appendLog(`🔄 正在连接设备: ${selected.id} (${selected.meta?.model || 'Android'})...`)
    const session = new RemoteDeviceSession(selected.id, {
      onDevice: device => {
        if (!device) return
        setDevices(current => current.map(item => item.id === device.id ? device : item))
      },
      onLease: lease => {
        const isHuman = lease.mode === 'HUMAN'
        setConnected(isHuman)
        setDevices(current => current.map(item => item.id === selected.id ? { ...item, lease } : item))
        appendLog(`🔑 租约模式变更: ${lease.mode}${isHuman ? ' (已获得控制权)' : ''}`)
      },
      onStream: stream => {
        if (videoRef.current) videoRef.current.srcObject = stream
        setLive(true)
        setSnapshot('')
        appendLog('🟢 WebRTC P2P 实时音视频画面已建立')
      },
      onSnapshot: data => {
        setSnapshot(data)
        // only log once when first falling back to snapshot
      },
      onState: state => {
        setConnectionState(state)
        if (state === 'control_disconnected' || state === 'stopped') {
          setConnected(false)
          setLive(false)
          appendLog('⚠️ 远程控制连接已断开，请重新点击连接')
        } else if (state === 'projection_permission_required') {
          appendLog('ℹ️ 手机未授权实时录屏，自动切换为【截图推流】模式')
        } else if (state === 'ice_gathering' || state === 'connecting') {
          appendLog(`📡 网络协商状态: ${state}`)
        }
      },
      onError: error => appendLog(`❌ 连接异常: ${error.message}`),
    })
    sessionRef.current = session
    try {
      await session.start()
      appendLog('✅ 控制会话握手完成')
    } catch (e) {
      setConnected(false)
      appendLog(`❌ 会话启动失败: ${e instanceof Error ? e.message : e}`)
    }
  }

  function disconnect() {
    sessionRef.current?.stop()
    sessionRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setLive(false)
    setSnapshot('')
    setConnected(false)
    setConnectionState('idle')
    appendLog(`🔌 会话已断开 · ${selected?.id || 'unknown'}`)
  }

  function selectDevice(id: string) {
    if (id !== selectedId && sessionRef.current) disconnect()
    setSelectedId(id)
    const target = devices.find(d => d.id === id)
    if (target) appendLog(`📱 切换选择设备: ${target.meta?.model || id} (${target.online ? '在线' : '离线'})`)
  }

  /** Confirmed action — awaits ACK and logs result. Use for input_text. */
  async function sendAction(action: ControlAction) {
    const session = sessionRef.current
    if (!session || !connected) return
    try {
      if (action.type === 'input_text') appendLog(`⌨️ 发送文字输入: "${action.text}"`)
      const result = await session.action(action)
      if (!result.ok) throw new Error(result.error || 'ACTION_FAILED')
      appendLog(`✅ 指令 ${action.type} 执行成功`)
    } catch (error) {
      appendLog(`❌ 指令 ${action.type} 失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Fire-and-forget gesture — no ACK wait. Push-frame loop provides visual feedback. */
  function sendGesture(action: ControlAction) {
    sessionRef.current?.sendInput(action)
    switch (action.type) {
      case 'tap':
        appendLog(`👉 点击坐标: (${action.x}, ${action.y})`)
        break
      case 'swipe':
        appendLog(`👆 滑动: (${action.x1}, ${action.y1}) ➔ (${action.x2}, ${action.y2}) [${action.durationMs || 100}ms]`)
        break
      case 'back':
        appendLog('🔙 按下导航键: 返回 (Back)')
        break
      case 'home':
        appendLog('🏠 按下导航键: 主屏幕 (Home)')
        break
      case 'recents':
        appendLog('📑 按下导航键: 最近任务 (Recent Apps)')
        break
      case 'input_text':
        appendLog(`⌨️ 输入文字: "${action.text}"`)
        break
    }
  }

  function devicePoint(clientX: number, clientY: number) {
    const rect = screenRef.current?.getBoundingClientRect()
    const width = selected?.meta?.screenWidth || 0
    const height = selected?.meta?.screenHeight || 0
    return rect ? mapPointerToDevice(clientX, clientY, rect, width, height) : null
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!connected) return
    event.preventDefault() // Prevent browser text selection, focus loss, double-click selection
    const point = devicePoint(event.clientX, event.clientY)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerStart.current = { point, at: performance.now() }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const start = pointerStart.current
    pointerStart.current = null
    if (!start) return
    const end = devicePoint(event.clientX, event.clientY)
    if (!end) return
    const distance = Math.hypot(end.x - start.point.x, end.y - start.point.y)
    if (distance < 12) sendGesture({ type: 'tap', x: end.x, y: end.y })
    else sendGesture({ type: 'swipe', x1: start.point.x, y1: start.point.y, x2: end.x, y2: end.y, durationMs: Math.round(Math.min(2000, Math.max(80, performance.now() - start.at))) })
  }

  function suppressEvent(event: React.SyntheticEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  function inputText() {
    const text = window.prompt('输入发送到 Android 当前输入框的文字')
    if (text !== null) void sendAction({ type: 'input_text', text })
  }

  async function handleUpload(file?: File) {
    if (!file || !selected?.online) return
    const agentLimit = selected.meta?.maxUploadBytes
    if (agentLimit && file.size > agentLimit) {
      appendLog(`Upload failed · 文件大小 ${formatBytes(file.size)} 超过当前 Android Agent 的 ${formatBytes(agentLimit)} 上限，请安装最新版 APK`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setUploadProgress(0)
    appendLog(`Uploading ${file.name}`)
    try {
      const result = await uploadFile(selected.id, file, setUploadProgress)
      appendLog(`Uploaded ${result.fileName} · ${result.bytes} bytes · Downloads/PhoneWeave`)
    } catch (error) {
      appendLog(`Upload failed · ${error instanceof Error ? error.message : error}`)
    } finally {
      setUploadProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function toggleSidebar() {
    setSidebarExpanded(expanded => {
      localStorage.setItem('phoneweaveSidebar', expanded ? 'collapsed' : 'expanded')
      return !expanded
    })
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!loginToken || loginBusy) return
    setLoginBusy(true)
    setLoginError('')
    try {
      await webLogin(loginToken)
      setLoginToken('')
      setAuthState('authenticated')
      await refresh()
    } catch (error) {
      setLoginError(error instanceof ApiError && error.status === 429 ? '尝试次数过多，请五分钟后再试。' : '访问密码错误，请重新输入。')
    } finally {
      setLoginBusy(false)
    }
  }

  async function handleLogout() {
    disconnect()
    try { await webLogout() } finally {
      setDevices([])
      setSelectedId('')
      setAuthState('unauthenticated')
      setLoginError('')
    }
  }

  if (authState !== 'authenticated') {
    return <div className="phone-grid-bg flex min-h-screen items-center justify-center bg-[#09090B] px-6 text-zinc-100">
      {authState === 'checking' ? <div className="flex items-center gap-3 text-sm text-zinc-500"><LoaderCircle className="size-5 animate-spin text-blue-500"/>正在验证访问权限…</div> : <Card className="w-full max-w-[420px] border-zinc-800 bg-zinc-950/95 p-7 shadow-2xl">
        <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-blue-500 text-white shadow-[0_0_30px_rgba(59,130,246,.22)]"><Network className="size-5"/></div><div><div className="text-base font-semibold">PhoneWeave</div><div className="text-[10px] uppercase tracking-[.2em] text-zinc-600">Secure Control Access</div></div></div>
        <div className="mt-8"><h1 className="text-xl font-semibold tracking-tight">登录设备控制中心</h1></div>
        <form className="mt-6 space-y-4" onSubmit={handleLogin}>
          <label className="block"><span className="mb-2 block text-xs font-medium text-zinc-400">访问密码</span><div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 focus-within:border-blue-500"><LockKeyhole className="size-4 text-zinc-500"/><input autoFocus type="password" autoComplete="current-password" value={loginToken} onChange={event=>setLoginToken(event.target.value)} className="mono h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-700" placeholder="请输入访问密码"/></div></label>
          {loginError && <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs leading-5 text-red-300">{loginError}</div>}
          <Button type="submit" className="w-full" disabled={!loginToken || loginBusy}>{loginBusy ? <LoaderCircle className="size-4 animate-spin"/> : <LockKeyhole className="size-4"/>}{loginBusy ? '正在验证…' : '安全登录'}</Button>
        </form>
        <div className="mt-6 flex items-center gap-2 border-t border-zinc-800 pt-4 text-[11px] text-zinc-600"><ShieldCheck className="size-3.5 text-green-500"/>密码仅用于建立 HttpOnly 安全会话，不保存在浏览器中。</div>
      </Card>}
    </div>
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-screen overflow-hidden bg-[#09090B] text-zinc-100">
        <aside className={`flex shrink-0 flex-col border-r border-zinc-800/90 bg-zinc-950 transition-[width] duration-200 ${sidebarExpanded ? 'w-[236px]' : 'w-16'}`}>
          <div className={`flex h-14 shrink-0 items-center gap-3 border-b border-zinc-900 ${sidebarExpanded ? 'px-3' : 'justify-center px-2'}`}>
            {sidebarExpanded && <><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-500 text-white shadow-[0_0_24px_rgba(59,130,246,.2)]"><Network className="size-4.5" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold tracking-tight">PhoneWeave</div><div className="text-[10px] uppercase tracking-[.18em] text-zinc-600">Control Fabric</div></div></>}
            <Button variant="ghost" size="icon" className={`shrink-0 ${sidebarExpanded ? '' : 'bg-blue-500 text-white hover:bg-blue-400 hover:text-white'}`} onClick={toggleSidebar} title={sidebarExpanded ? '收起菜单栏' : '展开菜单栏'} aria-label={sidebarExpanded ? '收起菜单栏' : '展开菜单栏'}>{sidebarExpanded ? <PanelLeftClose className="size-4"/> : <PanelLeftOpen className="size-4"/>}</Button>
          </div>
          <nav className="px-2 py-2">{nav.map(([id, label, Icon]) => <button key={id} title={sidebarExpanded ? undefined : label} onClick={() => setActiveNav(id)} className={`mb-1 flex h-9 w-full items-center rounded-md text-sm transition-colors ${sidebarExpanded ? 'gap-3 px-3' : 'justify-center px-0'} ${activeNav === id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}`}><Icon className="size-4 shrink-0" />{sidebarExpanded && label}</button>)}</nav>
          {sidebarExpanded ? <>
            <div className="mt-2 px-4 text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-600">Infrastructure</div>
            <div className="mx-3 mt-3 space-y-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Control Server</span>
                  <span className="flex items-center gap-1.5 text-green-400"><span className="size-1.5 rounded-full bg-green-500"/>Online</span>
                </div>
                <div className="mono mt-2 truncate text-[10px] text-zinc-600">{window.location.host}</div>
              </div>
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400 flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-cyan-400"/>哨兵巡检
                  </span>
                  <span className="text-[10px] text-green-400 font-medium">运行中 (10s)</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500">
                  <span>就绪设备</span>
                  <span className="mono text-zinc-300 font-semibold">{devices.filter(d => d.online && d.meta?.accessibilityReady).length} / {devices.length}</span>
                </div>
              </div>
            </div>
          </> : <div className="mx-auto mt-3 grid size-9 place-items-center rounded-lg border border-zinc-800 bg-zinc-900/60" title={`Control Server & Sentinel active · ${window.location.host}`}><span className="size-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,.5)]"/></div>}
          <div className="mt-auto border-t border-zinc-800 p-2"><button title={sidebarExpanded ? undefined : 'Local Operator'} className={`flex w-full items-center rounded-lg py-2 text-left hover:bg-zinc-900 ${sidebarExpanded ? 'gap-3 px-2' : 'justify-center px-0'}`}><div className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold">PW</div>{sidebarExpanded && <><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">Local Operator</div><div className="truncate text-[10px] text-zinc-600">Administrator</div></div><MoreHorizontal className="size-4 text-zinc-600"/></>}</button></div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <aside className="w-[310px] shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950/50 p-3 no-scrollbar">
              <div className="mb-3 border-b border-zinc-800/80 pb-3">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h1 className="text-sm font-semibold text-zinc-100">设备控制中心</h1><div className="mt-1 truncate text-[11px] text-zinc-500">{selected?.meta?.model || 'No device'} · {devices.filter(d=>d.online).length} online / {devices.length} total</div></div><div className="flex shrink-0 items-center"><Button variant="ghost" size="icon" onClick={() => setCommandOpen(true)} title="Command (⌘K)" aria-label="打开命令面板"><Command className="size-4"/></Button><Button variant={drawer ? 'outline' : 'ghost'} size="icon" onClick={()=>setDrawer(v=>!v)} title={drawer ? '收起设备详情' : '展开设备详情'} aria-label={drawer ? '收起设备详情' : '展开设备详情'}><PanelRight className="size-4"/></Button></div></div>
                <div className="mt-3 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5"><ShieldCheck className="size-3.5 shrink-0 text-green-500"/><span className="min-w-0 flex-1 text-[11px] text-zinc-400">已安全登录</span><button onClick={refresh} title="刷新设备" aria-label="刷新设备" className="text-zinc-500 hover:text-white"><RefreshCcw className="size-3.5"/></button><button onClick={()=>void handleLogout()} title="退出登录" aria-label="退出登录" className="text-zinc-500 hover:text-red-400"><LogOut className="size-3.5"/></button></div>
              </div>
              <div className="relative mb-3"><Search className="absolute left-3 top-2.5 size-3.5 text-zinc-600"/><Input className="pl-8" placeholder="搜索设备、ID 或 IP..." /></div>
              <div className="space-y-2">{devices.map(d => <DeviceCard key={d.id} device={d} latestAgentVersion={latestAgentVersion} selected={selectedId===d.id} onClick={()=>selectDevice(d.id)} />)}{!devices.length && <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-xs leading-5 text-zinc-600">暂无已连接设备<br/>请先在 Android 端启动 Agent</div>}</div>
            </aside>

            <main className="phone-grid-bg flex min-w-0 flex-1 flex-col bg-[#0B0B0D]">
              <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-hidden px-3 py-2">
                <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                  <div
                    ref={screenRef}
                    onPointerDown={onPointerDown}
                    onPointerUp={onPointerUp}
                    onDoubleClick={suppressEvent}
                    onContextMenu={suppressEvent}
                    onDragStart={suppressEvent}
                    style={{aspectRatio: `${selected?.meta?.screenWidth || 9} / ${selected?.meta?.screenHeight || 20}`}}
                    className={`screen-glow relative h-full max-h-full max-w-full touch-none select-none overflow-hidden rounded-[24px] border border-zinc-700 bg-black ${connected ? 'cursor-crosshair' : ''}`}
                  >
                    <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full select-none object-contain ${live ? 'block' : 'hidden'}`}/>
                    {!live && snapshot && <img src={snapshot} draggable={false} alt="Android screen snapshot" className="pointer-events-none h-full w-full select-none object-contain"/>}
                    {!live && !snapshot && (
                      <div className="flex h-full flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(59,130,246,.10),transparent_40%)] px-8 text-center">
                        <div className="grid size-14 place-items-center rounded-2xl border border-zinc-800 bg-zinc-900">
                          <Smartphone className="size-6 text-zinc-500"/>
                        </div>
                        <div className="mt-5 text-sm font-medium text-zinc-300">远程画面尚未连接</div>
                        <Button className="mt-5" disabled={!selected?.online} onClick={connect}>
                          <Play className="size-3.5"/>一键连接
                        </Button>
                      </div>
                    )}
                    {/* Screen-mode badge — shown when session is active */}
                    {connected && (
                      <div className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-black/60 px-2.5 py-1 text-[10px] backdrop-blur-sm">
                        <span className={`size-1.5 rounded-full ${live ? 'animate-pulse bg-green-400' : snapshot ? 'bg-blue-400' : 'bg-zinc-500'}`}/>
                        <span className="font-medium text-zinc-300">{live ? 'WebRTC' : snapshot ? '截图推流' : '连接中…'}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/90 p-1.5 shadow-2xl backdrop-blur-xl"><Button variant="ghost" size="sm" disabled={!connected} onClick={()=>sendGesture({type:'back'})}><ArrowLeft className="size-3.5"/>Back</Button><Button variant="ghost" size="sm" disabled={!connected} onClick={()=>sendGesture({type:'home'})}><ArrowDownToLine className="size-3.5"/>Home</Button><Button variant="ghost" size="sm" disabled={!connected} onClick={()=>sendGesture({type:'recents'})}><History className="size-3.5"/>Recent</Button><Button variant="ghost" size="sm" disabled={!connected} onClick={inputText}><Keyboard className="size-3.5"/>键盘</Button>{!live && connected && <Button variant="ghost" size="sm" onClick={()=>void sessionRef.current?.snapshot()}><Camera className="size-3.5"/>刷新</Button>}<div className="mx-1 h-5 w-px shrink-0 bg-zinc-800"/>{connected ? <Button variant="destructive" size="sm" onClick={disconnect}><Unplug className="size-3.5"/>断开</Button> : <Button size="sm" disabled={!selected?.online} onClick={connect}><Play className="size-3.5"/>连接</Button>}</div>
              </div>
            </main>

            {drawer && <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-3 no-scrollbar">
              <div className="space-y-5">
                <section>
                  <div className="mb-2 flex h-8 items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-600">Status & controls</div><Button variant="ghost" size="icon" onClick={()=>setDrawer(false)} title="收起设备详情" aria-label="收起设备详情"><X className="size-4"/></Button></div>
                  <Card className="space-y-3 p-3">
                    <div className="flex flex-wrap gap-1.5"><Badge className="gap-1.5 bg-zinc-950"><span className={`size-1.5 rounded-full ${selected?.online ? 'bg-green-500' : 'bg-red-500'}`}/>{selected?.online ? 'Online' : 'Offline'}</Badge><Badge className="mono bg-zinc-950">{connectionState}</Badge></div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]"><div className="rounded-md bg-zinc-950/70 p-2"><div className="text-zinc-600">Resolution</div><div className="mono mt-1 text-zinc-300">{selected?.meta?.screenWidth || '—'}×{selected?.meta?.screenHeight || '—'}</div></div><div className="rounded-md bg-zinc-950/70 p-2"><div className="text-zinc-600">当前屏幕模式</div><div className={`mono mt-1 ${live ? 'text-green-400 font-semibold' : snapshot ? 'text-blue-400 font-semibold' : selected?.liveReady ? 'text-green-400' : 'text-zinc-400'}`}>{connected ? (live ? 'WebRTC 实时流' : snapshot ? '截图推流模式' : '协商推流中') : (selected?.liveReady ? 'WebRTC (已就绪)' : '截图推流模式')}</div></div></div>
                    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2 text-[11px] text-zinc-300"><span className={`size-1.5 rounded-full ${live ? 'animate-pulse bg-green-500' : snapshot ? 'bg-blue-400' : connected ? 'bg-yellow-500' : 'bg-zinc-600'}`}/><span className="mono">{connected ? (live ? '当前使用：WebRTC 实时流 (60fps)' : snapshot ? '当前使用：截图推流模式 (~3fps)' : connectionState) : `屏幕流模式：${selected?.liveReady ? 'WebRTC 实时' : '截图推流'}`}</span></div>
                    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-2.5 text-[11px]"><div className="flex items-center justify-between gap-2"><span className="text-zinc-500">Agent version</span><span className={`rounded border px-1.5 py-0.5 text-[9px] ${agentVersionStatus(selected, latestAgentVersion).tone}`}>{agentVersionStatus(selected, latestAgentVersion).label}</span></div><div className="mono mt-2 flex items-center justify-between"><span className="text-zinc-300">v{selected?.meta?.agentVersionName || '—'}{selected?.meta?.agentVersionCode ? ` (${selected.meta.agentVersionCode})` : ''}</span><span className="text-zinc-600">最新 v{latestAgentVersion.name} ({latestAgentVersion.code || '—'})</span></div></div>
                    <Button variant="outline" size="sm" className="w-full" title={selected?.meta?.fileUpload ? '上传到 Android Downloads/PhoneWeave' : '请安装支持文件上传的新版 Agent'} disabled={!selected?.online || !selected?.meta?.fileUpload || uploadProgress !== null} onClick={()=>fileInputRef.current?.click()}><Upload className="size-3.5"/>{uploadProgress === null ? '上传文件到 Android' : `上传 ${uploadProgress}%`}</Button>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={event=>void handleUpload(event.target.files?.[0])}/>
                    <div className="flex items-center justify-between border-t border-zinc-800 pt-2">
                      <div className="flex items-center gap-1"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon"><Gauge className="size-4"/></Button></TooltipTrigger><TooltipContent>画质与带宽</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" disabled={!connected} onClick={inputText}><Keyboard className="size-4"/></Button></TooltipTrigger><TooltipContent>输入文字</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={()=>void screenRef.current?.requestFullscreen?.()}><Fullscreen className="size-4"/></Button></TooltipTrigger><TooltipContent>全屏显示设备</TooltipContent></Tooltip></div>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500">Clipboard<Switch checked={clipboardSync} onCheckedChange={setClipboardSync}/></div>
                    </div>
                  </Card>
                </section>
                <section>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-400">能力与授权 (Capabilities)</div>
                  <Card className="space-y-2.5 p-3">
                    {/* 无障碍控制权限 */}
                    <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Smartphone className={`size-3.5 ${selected?.meta?.accessibilityReady ? 'text-green-400' : 'text-amber-400'}`} />
                          <span className="text-xs font-medium text-zinc-200">无障碍控制权限</span>
                        </div>
                        <Badge className={selected?.meta?.accessibilityReady ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'}>
                          {selected?.meta?.accessibilityReady ? '已授权' : '未开启'}
                        </Badge>
                      </div>
                      <div className="mt-1.5 text-[11px] leading-4 text-zinc-500">
                        {selected?.meta?.accessibilityReady 
                          ? '已就绪 · 支持远程触控、滑动、按键及 UI 节点解析' 
                          : '未开启无障碍服务 · 仅支持监视画面，无法执行远程点击'}
                      </div>
                    </div>

                    {/* 屏幕投影推流权限 */}
                    <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MonitorSmartphone className={`size-3.5 ${selected?.liveReady ? 'text-green-400' : 'text-blue-400'}`} />
                          <span className="text-xs font-medium text-zinc-200">屏幕投影授权</span>
                        </div>
                        <Badge className={selected?.liveReady ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-blue-500/30 bg-blue-500/10 text-blue-400'}>
                          {selected?.liveReady ? 'WebRTC 实时' : '截图推流'}
                        </Badge>
                      </div>
                      <div className="mt-1.5 text-[11px] leading-4 text-zinc-500">
                        {selected?.liveReady 
                          ? '已就绪 · WebRTC 60fps 实时低延迟视频流' 
                          : 'MediaProjection 未授权 · 当前降级为截图轮询推流 (~3fps)'}
                      </div>
                    </div>

                    {/* 文件传输能力 */}
                    <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Files className={`size-3.5 ${selected?.meta?.fileUpload ? 'text-green-400' : 'text-zinc-500'}`} />
                          <span className="text-xs font-medium text-zinc-200">文件传输支持</span>
                        </div>
                        <Badge className={selected?.meta?.fileUpload ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-zinc-700 bg-zinc-800 text-zinc-400'}>
                          {selected?.meta?.fileUpload ? `支持 (${formatBytes(selected.meta.maxUploadBytes || 64 * 1024 * 1024)})` : '不支持'}
                        </Badge>
                      </div>
                      <div className="mt-1.5 text-[11px] leading-4 text-zinc-500">
                        {selected?.meta?.fileUpload 
                          ? '允许直接向 Android Downloads/PhoneWeave 传输文件' 
                          : '当前 Agent 版本过低，不支持文件分片上传'}
                      </div>
                    </div>
                  </Card>
                </section>
                <section><div className="mb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-600">Session</div><Card className="p-3"><div className="space-y-2.5 text-xs"><div className="flex justify-between"><span className="text-zinc-500">Mode</span><Badge>{selected?.lease?.mode || 'FREE'}</Badge></div><div className="flex justify-between"><span className="text-zinc-500">Transport</span><span className="mono text-zinc-300">{live ? 'WebRTC / ICE' : snapshot ? 'WS Push' : 'WebSocket'}</span></div><div className="flex justify-between"><span className="text-zinc-500">Routing</span><span className={live ? 'text-green-400' : snapshot ? 'text-blue-400' : 'text-zinc-500'}>{live ? 'ICE negotiated' : snapshot ? 'Push frames' : 'Pending'}</span></div></div></Card></section>
                <section><div className="mb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-600">Telemetry</div><div className="grid grid-cols-2 gap-2">{[['Ping','24 ms',Wifi],['FPS','60',Activity],['CPU','18%',Cpu],['Bitrate','5.8M',Gauge]].map(([a,b,I]: any)=><Card key={a} className="p-3"><I className="size-3.5 text-zinc-600"/><div className="mono mt-3 text-sm font-medium">{b}</div><div className="mt-1 text-[10px] text-zinc-600">{a}</div></Card>)}</div></section>
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-400">Activity 日志</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.2 text-[9px] text-zinc-400">{log.length}</span>
                    </div>
                    {log.length > 0 && (
                      <button
                        onClick={() => setLog([])}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                        title="清空当前日志"
                      >
                        清空
                      </button>
                    )}
                  </div>
                  <div className="mono max-h-56 overflow-y-auto rounded-lg border border-zinc-800 bg-black/60 p-2.5 text-[11px] leading-5 text-zinc-300 no-scrollbar space-y-1">
                    {log.length === 0 ? (
                      <div className="py-4 text-center text-[10px] text-zinc-600">
                        暂无活动记录 · 操作或会话事件将实时输出在此处
                      </div>
                    ) : (
                      log.map((x, i) => (
                        <div key={i} className="rounded px-1.5 py-0.5 hover:bg-zinc-900/60 transition-colors break-all">
                          {x}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </aside>}
          </div>
        </section>
      </div>

      {commandOpen && <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[16vh] backdrop-blur-sm" onMouseDown={()=>setCommandOpen(false)}><div className="w-[620px] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl" onMouseDown={e=>e.stopPropagation()}><div className="flex items-center gap-3 border-b border-zinc-800 px-4"><Search className="size-4 text-zinc-500"/><input autoFocus placeholder="输入命令或搜索设备..." className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"/><span className="rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-600">ESC</span></div><div className="p-2"><div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[.15em] text-zinc-600">Quick actions</div>{[[Play,'连接当前设备'],[TerminalSquare,'打开远程命令'],[Copy,'同步剪贴板'],[Settings2,'打开会话设置']].map(([Icon,label]: any)=><button key={label} className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-zinc-300 hover:bg-zinc-900"><Icon className="size-4 text-zinc-500"/>{label}<span className="ml-auto text-[10px] text-zinc-700">↵</span></button>)}</div></div></div>}
    </TooltipProvider>
  )
}
