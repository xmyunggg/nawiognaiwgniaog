import { useStorage } from '@vueuse/core'
import axios, { type AxiosRequestConfig } from 'axios'
import { useToastStore } from '@/stores/toast'

const tokenRef = useStorage('admin_token', '')
const accountIdRef = useStorage('current_account_id', '')

const api = axios.create({
  baseURL: '/',
  timeout: 20000,
})

let lastNetworkToastAt = 0
function showNetworkToast(message: string) {
  const now = Date.now()
  if (now - lastNetworkToastAt < 5000)
    return
  lastNetworkToastAt = now
  useToastStore().error(message)
}

api.interceptors.request.use((config) => {
  const token = tokenRef.value
  if (token && !config.headers['x-admin-token']) {
    config.headers['x-admin-token'] = token
  }
  // 必须只在未显式传递 x-account-id 时才使用默认选中的账号！
  // 绝对不能覆盖请求显式指定的特定账号 ID，否则会导致多账号数据严重串台！
  if (!config.headers['x-account-id']) {
    let currentId = accountIdRef.value
    if (!currentId) {
      try {
        currentId = localStorage.getItem('current_account_id') || ''
      } catch {}
    }
    if (currentId) {
      config.headers['x-account-id'] = currentId
    }
  }
  return config
}, error => Promise.reject(error))

api.interceptors.response.use((response) => {
  return response
}, (error) => {
  if (axios.isCancel(error) || error?.code === 'ERR_CANCELED') {
    return Promise.reject(error)
  }
  if (error?.config?.skipErrorToast === true)
    return Promise.reject(error)

  const toast = useToastStore()

  if (error.response) {
    if (error.response.status === 401) {
      if (!window.location.pathname.includes('/login')) {
        tokenRef.value = ''
        window.location.href = '/login'
        toast.warning('登录已过期，请重新登录')
      }
    }
    else if (error.response.status >= 500) {
      const backendError = String(error.response.data?.error || error.response.data?.message || '')
      if (backendError === '账号未运行' || backendError === 'API Timeout' || backendError === 'Request Timeout') {
        return Promise.reject(error)
      }
      toast.error(`服务器错误 ${error.response.status} ${error.response.statusText}`)
    }
    else {
      const backendError = String(error.response.data?.error || error.response.data?.message || '')
      if (backendError === '无权访问此账号') {
        accountIdRef.value = ''
        return Promise.reject(error)
      }
      if (backendError) {
        toast.error(backendError)
      } else {
        toast.error('请求失败，请联系管理员')
      }
    }
  }
  else if (error.request) {
    if (error.code === 'ECONNABORTED') {
      showNetworkToast('请求超时，请稍后重试')
    }
    else {
      showNetworkToast('网络错误，无法连接到服务器')
    }
  }
  else {
    toast.error(`错误: ${error.message}`)
  }

  return Promise.reject(error)
})

// 页面切换时多个组件可能同时请求同一份只读数据（状态、背包、图鉴、好友等）。
// 合并同一时刻的相同 GET，避免重复请求挤占后端与游戏连接队列；请求完成后立即释放，
// 不引入跨时间缓存，仍由各业务 store 自己的 TTL 决定数据新鲜度。
type ApiGet = typeof api.get
const inFlightGetRequests = new Map<string, Promise<any>>()
const rawGet = api.get.bind(api) as ApiGet

function stableSerialize(value: any): string {
  if (value === null || value === undefined)
    return ''
  if (typeof value !== 'object')
    return String(value)
  if (Array.isArray(value))
    return `[${value.map(stableSerialize).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${key}:${stableSerialize(value[key])}`).join(',')}}`
}

api.get = ((url: string, config?: AxiosRequestConfig & { dedupe?: boolean }) => {
  if (config?.dedupe === false)
    return rawGet(url, config)

  const headers = (config?.headers || {}) as Record<string, string>
  const key = [
    url,
    config?.responseType || '',
    headers['x-account-id'] || accountIdRef.value || '',
    tokenRef.value || '',
    stableSerialize(config?.params),
  ].join('|')

  const pending = inFlightGetRequests.get(key)
  if (pending)
    return pending

  const request = rawGet(url, config)
  inFlightGetRequests.set(key, request)
  const release = () => {
    if (inFlightGetRequests.get(key) === request)
      inFlightGetRequests.delete(key)
  }
  request.then(release, release)
  return request
}) as ApiGet

export default api
