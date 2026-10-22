import type { Socket } from 'socket.io-client'
import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { io } from 'socket.io-client'
import { computed, ref, shallowReactive, shallowRef } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

// Define interfaces for better type checking
interface DailyGift {
  key: string
  label: string
  enabled?: boolean
  doneToday: boolean
  lastAt?: number
  completedCount?: number
  totalCount?: number
  hasGift?: boolean
  hasCard?: boolean
  tasks?: any[]
}

interface DailyGiftsResponse {
  date: string
  growth: DailyGift
  gifts: DailyGift[]
}

export const useStatusStore = defineStore('status', () => {
  // 状态和日志都是整份替换的只读快照，用 shallowRef 避免对大对象做深度响应式代理。
  const status = shallowRef<any>(null)
  const logs = shallowRef<any[]>([])
  const accountLogs = shallowRef<any[]>([])
  const dailyGifts = ref<DailyGiftsResponse | null>(null)
  const statusAccountId = ref('')
  // 按照账号 ID 严格进行物理隔离的全局状态与每日礼包字典，杜绝任何串台
  // 只监听「账号键」的替换，避免把每个账号的大对象都做深度响应式代理。
  const statusByAccount = shallowReactive<Record<string, any>>({})
  const dailyGiftsByAccount = shallowReactive<Record<string, any>>({})
  const loading = ref(false)
  const error = ref('')
  const realtimeConnected = ref(false)
  const realtimeLogsEnabled = ref(true)
  const currentRealtimeAccountId = ref('')
  const tokenRef = useStorage('admin_token', '')

  let socket: Socket | null = null
  const dailyGiftFetches = new Map<string, Promise<any>>()
  // 实时日志去重使用 O(1) 集合，避免每条推送都线性扫描整份日志列表。
  let runtimeLogIds = new Set<string>()
  let accountLogIds = new Set<string>()
  // 实时日志先入队，100ms 内合并成一次渲染，避免高频日志逐条触发整份日志列表重排。
  let pendingRuntimeLogs: any[] = []
  let pendingAccountLogs: any[] = []
  let logFlushTimer: ReturnType<typeof setTimeout> | null = null

  function flushPendingLogs() {
    logFlushTimer = null
    if (pendingRuntimeLogs.length) {
      const merged = logs.value.concat(pendingRuntimeLogs)
      pendingRuntimeLogs = []
      logs.value = merged.length > 1000 ? merged.slice(-1000) : merged
      if (logs.value.length >= 1000 && runtimeLogIds.size > 2000)
        rebuildRuntimeLogIds()
    }
    if (pendingAccountLogs.length) {
      const merged = accountLogs.value.concat(pendingAccountLogs)
      pendingAccountLogs = []
      accountLogs.value = merged.length > 300 ? merged.slice(-300) : merged
      if (accountLogs.value.length >= 300 && accountLogIds.size > 600)
        rebuildAccountLogIds()
    }
  }

  function scheduleLogFlush() {
    if (logFlushTimer !== null)
      return
    logFlushTimer = setTimeout(flushPendingLogs, 100)
  }

  function clearPendingLogs() {
    pendingRuntimeLogs = []
    pendingAccountLogs = []
    if (logFlushTimer !== null) {
      clearTimeout(logFlushTimer)
      logFlushTimer = null
    }
  }

  function clearPendingRuntimeLogs() {
    pendingRuntimeLogs = []
  }

  function clearPendingAccountLogs() {
    pendingAccountLogs = []
  }
  function rebuildRuntimeLogIds() {
    runtimeLogIds = new Set(logs.value.map(item => getLogIdentity(item, 'runtime')))
  }

  function rebuildAccountLogIds() {
    accountLogIds = new Set(accountLogs.value.map(item => getLogIdentity(item, 'account')))
  }

  function getCurrentAccountId() {
    const accountStore = useAccountStore()
    return String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
  }

  function isCurrentAccount(accountId: string) {
    return getCurrentAccountId() === String(accountId)
  }

  const currentStatusReady = computed(() => {
    const currentId = getCurrentAccountId()
    return !!currentId && !!status.value && statusAccountId.value === currentId
  })

  function normalizeStatusPayload(input: any) {
    return (input && typeof input === 'object') ? { ...input } : {}
  }

  function clearAccountScopedData() {
    clearPendingLogs()
    status.value = null
    statusAccountId.value = ''
    logs.value = []
    accountLogs.value = []
    runtimeLogIds.clear()
    accountLogIds.clear()
    dailyGiftFetches.clear()
    dailyGifts.value = null
    error.value = ''
  }

  function normalizeLogEntry(input: any) {
    const entry = (input && typeof input === 'object') ? { ...input } : {}
    const ts = Number(entry.ts) || Date.parse(String(entry.time || '').replace(' ', 'T')) || Date.now()
    return {
      ...entry,
      ts,
      time: entry.time || new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
    }
  }

  function shouldHideLogEntryInFrontend(entry: any) {
    const text = [
      entry?.tag,
      entry?.msg,
      entry?.reason,
      entry?.action,
      entry?.meta ? JSON.stringify(entry.meta) : '',
    ].filter(Boolean).join(' ')
    return /\b(?:ACE|TSDK)\b/i.test(text)
  }

  function getLogIdentity(entry: any, source: 'runtime' | 'account') {
    if (entry?.logId)
      return String(entry.logId)
    const ts = Number(entry?.ts) || Date.parse(String(entry?.time || '').replace(' ', 'T')) || 0
    return [source, entry?.accountId || entry?.id || '', ts, entry?.action || '', entry?.tag || '', entry?.msg || ''].join('|')
  }

  function uniqueLogs(list: any[], source: 'runtime' | 'account') {
    const seen = new Set<string>()
    return list.filter((entry) => {
      const identity = getLogIdentity(entry, source)
      if (seen.has(identity))
        return false
      seen.add(identity)
      return true
    })
  }

  function pushRealtimeLog(entry: any) {
    const next = normalizeLogEntry(entry)
    if (shouldHideLogEntryInFrontend(next))
      return
    const identity = getLogIdentity(next, 'runtime')
    if (runtimeLogIds.has(identity))
      return
    runtimeLogIds.add(identity)
    pendingRuntimeLogs.push(next)
    scheduleLogFlush()
  }

  function pushRealtimeAccountLog(entry: any) {
    const next = (entry && typeof entry === 'object') ? entry : {}
    if (shouldHideLogEntryInFrontend(next))
      return
    const identity = getLogIdentity(next, 'account')
    if (accountLogIds.has(identity))
      return
    accountLogIds.add(identity)
    pendingAccountLogs.push(next)
    scheduleLogFlush()
  }

  function handleRealtimeStatus(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || '')
    if (currentRealtimeAccountId.value && accountId !== currentRealtimeAccountId.value)
      return
    if (body.status && typeof body.status === 'object') {
      const normalized = normalizeStatusPayload(body.status)
      if (accountId) {
        statusByAccount[accountId] = normalized
      }
      if (!currentRealtimeAccountId.value || accountId === currentRealtimeAccountId.value || accountId === getCurrentAccountId()) {
        status.value = normalized
        statusAccountId.value = accountId || currentRealtimeAccountId.value || getCurrentAccountId()
        error.value = ''
      }
    }
  }

  function handleRealtimeLog(payload: any) {
    if (!realtimeLogsEnabled.value)
      return
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || body.id || '')
    if (currentRealtimeAccountId.value && accountId && accountId !== currentRealtimeAccountId.value)
      return
    pushRealtimeLog(payload)
  }

  function handleRealtimeAccountLog(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || '')
    if (currentRealtimeAccountId.value && accountId && accountId !== currentRealtimeAccountId.value)
      return
    pushRealtimeAccountLog(payload)
  }

  function handleRealtimeLogsSnapshot(payload: any) {
    clearPendingRuntimeLogs()
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || '')
    if (currentRealtimeAccountId.value && accountId && accountId !== 'all' && accountId !== currentRealtimeAccountId.value)
      return
    const list = Array.isArray(body.logs) ? body.logs : []
    logs.value = uniqueLogs(list, 'runtime')
      .map((item: any) => normalizeLogEntry(item))
      .filter((item: any) => !shouldHideLogEntryInFrontend(item))
    rebuildRuntimeLogIds()
  }

  function handleRealtimeAccountLogsSnapshot(payload: any) {
    clearPendingAccountLogs()
    const body = (payload && typeof payload === 'object') ? payload : {}
    const list = Array.isArray(body.logs) ? body.logs : []
    accountLogs.value = uniqueLogs(currentRealtimeAccountId.value
      ? list
          .filter((item: any) => String(item?.accountId || item?.id || '') === currentRealtimeAccountId.value)
          .filter((item: any) => !shouldHideLogEntryInFrontend(item))
      : list.filter((item: any) => !shouldHideLogEntryInFrontend(item)), 'account')
    rebuildAccountLogIds()
  }

  function ensureRealtimeSocket() {
    if (socket)
      return socket

    socket = io('/', {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket', 'polling'],
      upgrade: true,
      timeout: 10000,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: {
        token: tokenRef.value,
      },
    })

    socket.on('connect', () => {
      realtimeConnected.value = true
      if (currentRealtimeAccountId.value) {
        socket?.emit('subscribe', { accountId: currentRealtimeAccountId.value })
      }
      else {
        socket?.emit('subscribe', { accountId: 'all' })
      }
    })

    socket.on('disconnect', () => {
      realtimeConnected.value = false
    })

    socket.on('connect_error', (err) => {
      realtimeConnected.value = false
      console.error('[realtime] 连接失败:', err.message)
    })

    socket.on('status:update', handleRealtimeStatus)
    socket.on('log:new', handleRealtimeLog)
    socket.on('account-log:new', handleRealtimeAccountLog)
    socket.on('logs:snapshot', handleRealtimeLogsSnapshot)
    socket.on('account-logs:snapshot', handleRealtimeAccountLogsSnapshot)
    return socket
  }

  function connectRealtime(accountId: string) {
    currentRealtimeAccountId.value = String(accountId || '').trim()
    if (!tokenRef.value)
      return

    const client = ensureRealtimeSocket()
    client.auth = {
      token: tokenRef.value,
      accountId: currentRealtimeAccountId.value || 'all',
    }

    if (client.connected) {
      client.emit('subscribe', { accountId: currentRealtimeAccountId.value || 'all' })
      return
    }
    client.connect()
  }

  function disconnectRealtime() {
    if (!socket)
      return
    socket.off('connect')
    socket.off('disconnect')
    socket.off('connect_error')
    socket.off('status:update', handleRealtimeStatus)
    socket.off('log:new', handleRealtimeLog)
    socket.off('account-log:new', handleRealtimeAccountLog)
    socket.off('logs:snapshot', handleRealtimeLogsSnapshot)
    socket.off('account-logs:snapshot', handleRealtimeAccountLogsSnapshot)
    socket.disconnect()
    socket = null
    realtimeConnected.value = false
  }

  async function fetchStatus(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    loading.value = true
    try {
      const { data } = await api.get('/api/status', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (data.ok) {
        const normalized = normalizeStatusPayload(data.data)
        statusByAccount[requestedId] = normalized
        if (isCurrentAccount(requestedId)) {
          status.value = normalized
          statusAccountId.value = requestedId
        }
        error.value = ''
      }
      else {
        error.value = data.error
      }
    }
    catch (e: any) {
      error.value = e.message
    }
    finally {
      loading.value = false
    }
  }

  async function fetchLogs(accountId: string, options: any = {}) {
    if (!accountId && options.accountId !== 'all')
      return
    const requestedId = String(accountId || options.accountId || '')
    const params: any = { limit: 100, ...options }
    const headers: any = {}
    if (accountId && accountId !== 'all') {
      headers['x-account-id'] = accountId
    }
    else {
      params.accountId = 'all'
    }

    try {
      const { data } = await api.get('/api/logs', { headers, params })
      if (requestedId && requestedId !== 'all' && !isCurrentAccount(requestedId))
        return
      if (data.ok) {
        const fetchedLogs = Array.isArray(data.data)
          ? uniqueLogs(data.data
              .map((item: any) => normalizeLogEntry(item))
              .filter((item: any) => !shouldHideLogEntryInFrontend(item)), 'runtime')
          : []
        flushPendingLogs()
        logs.value = realtimeConnected.value
          ? uniqueLogs([...logs.value, ...fetchedLogs], 'runtime').slice(-1000)
          : fetchedLogs
        rebuildRuntimeLogIds()
        error.value = ''
      }
    }
    catch (e: any) {
      console.error(e)
    }
  }

  async function fetchDailyGiftsOnce(requestedId: string) {
    try {
      const { data } = await api.get('/api/daily-gifts', {
        headers: { 'x-account-id': requestedId },
      })
      if (data.ok) {
        dailyGiftsByAccount[requestedId] = data.data
        if (isCurrentAccount(requestedId)) {
          dailyGifts.value = data.data
          statusAccountId.value = requestedId
        }
        return data.data
      }
    }
    catch (e) {
      console.error('获取每日奖励失败', e)
    }
    return null
  }

  async function fetchDailyGifts(accountId: string) {
    if (!accountId)
      return null
    const requestedId = String(accountId)
    const pending = dailyGiftFetches.get(requestedId)
    if (pending)
      return pending

    const request = fetchDailyGiftsOnce(requestedId).finally(() => {
      if (dailyGiftFetches.get(requestedId) === request)
        dailyGiftFetches.delete(requestedId)
    })
    dailyGiftFetches.set(requestedId, request)
    return request
  }

  async function fetchAccountLogs(accountId = '', limit = 100) {
    const requestedId = String(accountId || '')
    try {
      const headers: Record<string, string> = {}
      if (requestedId)
        headers['x-account-id'] = requestedId
      const res = await api.get(`/api/account-logs?limit=${Math.max(1, Number(limit) || 100)}`, { headers })
      if (Array.isArray(res.data)) {
        if (requestedId && !isCurrentAccount(requestedId))
          return
        const fetchedAccountLogs = uniqueLogs(requestedId
          ? res.data
              .filter((item: any) => String(item?.accountId || item?.id || '') === requestedId)
              .filter((item: any) => !shouldHideLogEntryInFrontend(item))
          : res.data.filter((item: any) => !shouldHideLogEntryInFrontend(item)), 'account')
        flushPendingLogs()
        accountLogs.value = realtimeConnected.value
          ? uniqueLogs([...accountLogs.value, ...fetchedAccountLogs], 'account').slice(-300)
          : fetchedAccountLogs
        rebuildAccountLogIds()
      }
    }
    catch (e) {
      console.error(e)
    }
  }

  function setRealtimeLogsEnabled(enabled: boolean) {
    realtimeLogsEnabled.value = !!enabled
  }

  return {
    status,
    statusAccountId,
    statusByAccount,
    currentStatusReady,
    logs,
    accountLogs,
    dailyGifts,
    dailyGiftsByAccount,
    loading,
    error,
    realtimeConnected,
    realtimeLogsEnabled,
    clearAccountScopedData,
    fetchStatus,
    fetchLogs,
    fetchAccountLogs,
    fetchDailyGifts,
    setRealtimeLogsEnabled,
    connectRealtime,
    disconnectRealtime,
  }
})
