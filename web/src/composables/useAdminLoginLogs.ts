import { computed, ref } from 'vue'
import api from '@/api'
import { useToastStore } from '@/stores/toast'

const EDGE_VERSION_RE = /Edg\/([\d.]+)/
const CHROME_VERSION_RE = /Chrome\/([\d.]+)/
const FIREFOX_VERSION_RE = /Firefox\/([\d.]+)/
const SAFARI_VERSION_RE = /Version\/([\d.]+)/
const LOGIN_LOG_LIMIT = 100

export interface LoginLog {
  id: string
  timestamp: number
  event: 'login_success' | 'login_failed'
  username: string
  errorType: string | null
  ip: string
  userAgent: string
}

export function useAdminLoginLogs() {
  const toast = useToastStore()

  const loginLogs = ref<LoginLog[]>([])
  const loginLogsLoading = ref(false)
  const loginLogsTotal = ref(0)
  const clearLogsLoading = ref(false)

  const loginSuccessCount = computed(() =>
    loginLogs.value.filter(log => log.event === 'login_success').length,
  )
  const loginFailedCount = computed(() =>
    loginLogs.value.filter(log => log.event === 'login_failed').length,
  )
  const loginLogSummary = computed(() => {
    if (loginLogsTotal.value === 0)
      return '当前没有登录日志，适合先保留现状，等出现真实登录事件后再排查。'
    if (loginFailedCount.value > 0)
      return `最近日志里有 ${loginFailedCount.value} 条失败记录，适合优先查看错误类型、来源 IP 和浏览器。`
    return `当前最近 ${loginSuccessCount.value} 条登录均为成功记录，暂未看到明显异常。`
  })

  async function fetchLoginLogs() {
    loginLogsLoading.value = true
    try {
      const { data } = await api.get('/api/admin/login-logs', {
        params: { limit: LOGIN_LOG_LIMIT, offset: 0 },
      })
      if (data?.ok) {
        loginLogs.value = data.data?.logs || []
        loginLogsTotal.value = data.data?.total || 0
      }
      else {
        toast.error(data?.error || '获取登录日志失败')
      }
    }
    catch (e: any) {
      toast.error(e?.response?.data?.error || e.message || '获取登录日志失败')
    }
    finally {
      loginLogsLoading.value = false
    }
  }

  async function clearLoginLogs() {
    clearLogsLoading.value = true
    try {
      const { data } = await api.post('/api/admin/login-logs/clear', { confirmed: true })
      if (data?.ok) {
        toast.success('日志已清空')
        loginLogs.value = []
        loginLogsTotal.value = 0
        return true
      }
      toast.error(data?.error || '清空失败')
      return false
    }
    catch (e: any) {
      toast.error(e?.response?.data?.error || e.message || '清空失败')
      return false
    }
    finally {
      clearLogsLoading.value = false
    }
  }

  return {
    loginLogs,
    loginLogsLoading,
    loginLogsTotal,
    clearLogsLoading,
    loginSuccessCount,
    loginFailedCount,
    loginLogSummary,
    fetchLoginLogs,
    clearLoginLogs,
  }
}

export function formatLogTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

export function getEventLabel(event: string): string {
  return event === 'login_success' ? '登录成功' : '登录失败'
}

export function getErrorTypeLabel(errorType: string | null): string {
  if (!errorType)
    return '-'
  const labels: Record<string, string> = {
    rate_limit: '速率限制',
    locked: '账户锁定',
    invalid_credentials: '凭证错误',
    card_disabled: '账号封禁',
    card_expired: '账号到期',
    agent_disabled: '代理停用',
  }
  return labels[errorType] || errorType
}

export function parseBrowser(userAgent: string): string {
  if (!userAgent || userAgent === 'unknown')
    return '未知'

  if (userAgent.includes('Edg/')) {
    const match = userAgent.match(EDGE_VERSION_RE)
    return `Edge ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Chrome/')) {
    const match = userAgent.match(CHROME_VERSION_RE)
    return `Chrome ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Firefox/')) {
    const match = userAgent.match(FIREFOX_VERSION_RE)
    return `Firefox ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) {
    const match = userAgent.match(SAFARI_VERSION_RE)
    return `Safari ${match ? match[1] : ''}`
  }
  if (userAgent.includes('MSIE') || userAgent.includes('Trident/'))
    return 'IE'

  return '其他'
}
