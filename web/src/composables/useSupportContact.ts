import { computed, ref } from 'vue'
import api from '@/api'

export interface SupportConfig {
  enabled: boolean
  title: string
  fabTitle: string
  subtitle: string
  qrcodeHint: string
  qqTitle: string
  wechatTitle: string
  groupTitle: string
  qq: string
  wechat: string
  qrcodeUrl: string
  group: string
  groupLink: string
}

/**
 * 联系客服的全局单例状态：侧边栏入口与弹窗分处不同组件，靠这里共享。
 * 配置只在首次使用时加载一次，避免每次打开弹窗都打请求。
 */
const config = ref<SupportConfig | null>(null)
const show = ref(false)
const previewQrcode = ref(false)
let loaded = false
let loadingPromise: Promise<void> | null = null

const title = computed(() => config.value?.title || '联系客服')
const subtitle = computed(() => config.value?.subtitle || '点击即可复制联系方式')
const qrcodeHint = computed(() => config.value?.qrcodeHint || '扫码添加微信客服')
const qqTitle = computed(() => config.value?.qqTitle || '客服 QQ')
const wechatTitle = computed(() => config.value?.wechatTitle || '客服微信')
const groupTitle = computed(() => config.value?.groupTitle || 'QQ 群号')

/** 只接受 http(s) 链接，避免 javascript: 之类的地址注入 */
const safeGroupLink = computed(() => {
  const link = String(config.value?.groupLink || '').trim()
  return /^https?:\/\//i.test(link) ? link : ''
})

const safeQrcodeUrl = computed(() => {
  const url = String(config.value?.qrcodeUrl || '').trim()
  return url && (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url)) ? url : ''
})

/** QQ 号合法时生成唤起 QQ 会话的链接：移动端用 mqqwpa 协议，桌面端走 wpa 网页 */
const qqChatLink = computed(() => {
  const qq = String(config.value?.qq || '').trim()
  if (!/^\d{5,12}$/.test(qq))
    return ''
  if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent))
    return `mqqwpa://im/chat?chat_type=wpa&uin=${qq}&version=1&src_type=web`
  return `https://wpa.qq.com/msgrd?v=3&uin=${qq}&site=qq&menu=yes`
})

const hasAnyContact = computed(() => {
  const c = config.value
  if (!c)
    return false
  return Boolean(c.qq || c.wechat || c.group || safeGroupLink.value || safeQrcodeUrl.value)
})

const visible = computed(() => Boolean(config.value?.enabled) && hasAnyContact.value)

async function load(force = false) {
  if (loaded && !force)
    return
  if (loadingPromise)
    return loadingPromise

  loadingPromise = (async () => {
    try {
      const { data } = await api.get('/api/support-config', { skipErrorToast: true } as any)
      if (data?.ok && data.data?.enabled) {
        const raw = data.data
        config.value = {
          enabled: true,
          title: String(raw.title || '').trim(),
          fabTitle: String(raw.fabTitle || '').trim(),
          subtitle: String(raw.subtitle || '').trim(),
          qrcodeHint: String(raw.qrcodeHint || '').trim(),
          qqTitle: String(raw.qqTitle || '').trim(),
          wechatTitle: String(raw.wechatTitle || '').trim(),
          groupTitle: String(raw.groupTitle || '').trim(),
          qq: String(raw.qq || '').trim(),
          wechat: String(raw.wechat || '').trim(),
          qrcodeUrl: String(raw.qrcodeUrl || '').trim(),
          group: String(raw.group || '').trim(),
          groupLink: String(raw.groupLink || '').trim(),
        }
      }
      else {
        config.value = null
      }
    }
    catch {
      config.value = null
    }
    finally {
      loaded = true
      loadingPromise = null
    }
  })()

  return loadingPromise
}

function open() {
  if (!visible.value)
    return
  show.value = true
}

function close() {
  show.value = false
  previewQrcode.value = false
}

export function useSupportContact() {
  return {
    config,
    show,
    previewQrcode,
    title,
    subtitle,
    qrcodeHint,
    qqTitle,
    wechatTitle,
    groupTitle,
    safeGroupLink,
    safeQrcodeUrl,
    qqChatLink,
    hasAnyContact,
    visible,
    load,
    open,
    close,
  }
}
