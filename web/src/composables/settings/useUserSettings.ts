import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import api from '@/api'
import { useSettingStore } from '@/stores/setting'

interface DeviceProtocolConfig {
  enabled: boolean
  userAgent: string
  deviceModel: string
  deviceBrand: string
  deviceMac: string
  /** 设备标识：机型标识串，如 iPhone15,2 / DESKTOP-PC<WPC> */
  deviceId: string
  /** 16 位十六进制设备 ID */
  deviceId16: string
  imei: string
  systemVersion: string
  memory: string
  network: string
}

type AlertType = 'primary' | 'danger'

export const DEFAULT_DEVICE_PROTOCOL: DeviceProtocolConfig = {
  enabled: false,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
  deviceModel: 'Windows PC',
  deviceBrand: 'Microsoft',
  deviceMac: '',
  deviceId: 'DESKTOP-PC<WPC>',
  deviceId16: '',
  imei: '',
  systemVersion: 'Windows',
  memory: '16384',
  network: 'wifi',
}

export function generateRandomMac() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  bytes[0] = ((bytes[0] ?? 0) & 0xFC) | 0x02
  return Array.from(bytes, b => b.toString(16).padStart(2, '0').toUpperCase()).join(':')
}

export function generateRandomDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0').toUpperCase()).join('')
}

export function generateRandomImei() {
  let p = ''
  for (; p.length < 14;) {
    const bytes = crypto.getRandomValues(new Uint8Array(14 - p.length))
    for (const b of bytes) {
      if (b < 250) p += String(b % 10)
    }
  }
  const digits = p.split('').map(Number)
  let sum = 0
  digits.forEach((digit, index) => {
    const value = index % 2 === 1 ? digit * 2 : digit
    sum += value > 9 ? value - 9 : value
  })
  const check = (10 - (sum % 10)) % 10
  return `${p}${check}`
}

// 预设取自 liyangpengs/qq-farm-bot 的 core/src/config/config.ts (DEVICE_PRESETS)
// deviceId   = 设备标识（机型标识串，如 iPhone15,2 / DESKTOP-PC<WPC>）
// deviceId16 = 16 位十六进制设备 ID（账号弹窗里的「16位 设备 ID」）
export const DEVICE_PROTOCOL_PRESETS = [
  {
    label: 'Windows PC',
    value: 'windows_pc',
    config: {
      os: 'Windows',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
      deviceBrand: 'Microsoft',
      deviceModel: 'Windows PC',
      deviceId: 'DESKTOP-PC<WPC>',
      deviceId16: '3F8A1C6D90B24E75',
      systemVersion: 'Windows',
      memory: '16384',
      network: 'wifi',
    },
  },
  {
    label: 'iPhone 15 Pro',
    value: 'iphone_15_pro',
    config: {
      os: 'iOS',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN',
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 15 Pro',
      deviceId: 'iPhone15,2',
      deviceId16: '8C41D9A2F03B67E5',
      systemVersion: 'iOS 17.4.1',
      memory: '7672',
      network: 'wifi',
    },
  },
  {
    label: 'iPhone 16 Pro',
    value: 'iphone_16_pro',
    config: {
      os: 'iOS',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22C161 MicroMessenger/8.0.54(0x1800362c) NetType/WIFI Language/zh_CN',
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 16 Pro',
      deviceId: 'iPhone17,1',
      deviceId16: 'D27E5B90A1C43F68',
      systemVersion: 'iOS 18.2.1',
      memory: '8192',
      network: 'wifi',
    },
  },
  {
    label: '小米手机',
    value: 'android_xiaomi',
    config: {
      os: 'Android',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; 23127PN0CC Build/UKQ1.231003.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XWEB/1165009 MMWEBSDK/20240407 MiniProgramEnv/android MicroMessenger/8.0.49.2680(0x28003137) NetType/WIFI Language/zh_CN ABI/arm64',
      deviceBrand: 'Xiaomi',
      deviceModel: 'Xiaomi 14',
      deviceId: 'Xiaomi 14',
      deviceId16: '5A9C2E71B4D8063F',
      systemVersion: 'Android 14',
      memory: '8192',
      network: 'wifi',
    },
  },
  {
    label: '华为手机',
    value: 'android_huawei',
    config: {
      os: 'Android',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; ALN-AL10 Build/HUAWEIALN-AL10) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XWEB/1165009 MMWEBSDK/20240407 MiniProgramEnv/android MicroMessenger/8.0.49.2680(0x28003137) NetType/WIFI Language/zh_CN ABI/arm64',
      deviceBrand: 'Huawei',
      deviceModel: 'HUAWEI Mate 60',
      deviceId: 'HUAWEI Mate 60',
      deviceId16: 'E61B8D40C92A753F',
      systemVersion: 'Android 14',
      memory: '12288',
      network: 'wifi',
    },
  },
  {
    label: 'iPad Pro',
    value: 'ipad_pro',
    config: {
      os: 'iOS',
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN',
      deviceBrand: 'Apple',
      deviceModel: 'iPad Pro',
      deviceId: 'iPad14,6',
      deviceId16: '7B3F60C1D84E29A5',
      systemVersion: 'iPadOS 17.4',
      memory: '16384',
      network: 'wifi',
    },
  },
] as const

const CHANNEL_DOCS: Record<string, string> = {
  webhook: '',
  qmsg: 'https://qmsg.zendee.cn/',
  serverchan: 'https://sct.ftqq.com/',
  pushplus: 'https://www.pushplus.plus/',
  pushplushxtrip: 'https://pushplus.hxtrip.com/',
  dingtalk: 'https://open.dingtalk.com/document/group/custom-robot-access',
  wecom: 'https://guole.fun/posts/626/',
  wecombot: 'https://developer.work.weixin.qq.com/document/path/91770',
  bark: 'https://github.com/Finb/Bark',
  gocqhttp: 'https://docs.go-cqhttp.org/api/',
  onebot: 'https://docs.go-cqhttp.org/api/',
  atri: 'https://blog.tianli0.top/',
  pushdeer: 'https://www.pushdeer.com/',
  igot: 'https://push.hellyw.com/',
  telegram: 'https://core.telegram.org/bots',
  feishu: 'https://www.feishu.cn/hc/zh-CN/articles/360024984973',
  ifttt: 'https://ifttt.com/maker_webhooks',
  discord: 'https://discord.com/developers/docs/resources/webhook#execute-webhook',
  wxpusher: 'https://wxpusher.zjiecode.com/docs/#/',
}

export function useUserSettings(showAlert: (message: string, type?: AlertType) => void) {
  const settingStore = useSettingStore()
  const { settings } = storeToRefs(settingStore)

  const offlineSaving = ref(false)
  const offlineTesting = ref(false)
  const deviceProtocolLoading = ref(false)
  const deviceProtocolSaving = ref(false)

  const deviceProtocolPresetOptions = computed(() =>
    DEVICE_PROTOCOL_PRESETS.map(item => ({ label: item.label, value: item.value })),
  )

  const selectedDevicePreset = ref('')
  const deviceProtocolForm = ref<DeviceProtocolConfig>({ ...DEFAULT_DEVICE_PROTOCOL })

  const localOffline = ref({
    channel: 'smtp',
    reloginUrlMode: 'none',
    endpoint: '',
    token: '',
    title: '',
    msg: '',
    offlineDeleteSec: 0,
    smtpHost: '',
    smtpPort: 465,
    smtpUser: '',
    smtpPass: '',
    senderName: '',
    recipientEmail: '',
    emailContent: '',
  })

  const channelOptions = [
    { label: 'SMTP 邮件', value: 'smtp' },
    { label: 'Webhook(自定义接口)', value: 'webhook' },
    { label: 'Qmsg 酱', value: 'qmsg' },
    { label: 'Server 酱', value: 'serverchan' },
    { label: 'Push Plus', value: 'pushplus' },
    { label: 'Push Plus Hxtrip', value: 'pushplushxtrip' },
    { label: '钉钉', value: 'dingtalk' },
    { label: '企业微信', value: 'wecom' },
    { label: 'Bark', value: 'bark' },
    { label: 'Go-cqhttp', value: 'gocqhttp' },
    { label: 'OneBot', value: 'onebot' },
    { label: 'Atri', value: 'atri' },
    { label: 'PushDeer', value: 'pushdeer' },
    { label: 'iGot', value: 'igot' },
    { label: 'Telegram', value: 'telegram' },
    { label: '飞书', value: 'feishu' },
    { label: 'IFTTT', value: 'ifttt' },
    { label: '企业微信群机器人', value: 'wecombot' },
    { label: 'Discord', value: 'discord' },
    { label: 'WxPusher', value: 'wxpusher' },
  ]

  const reloginUrlModeOptions = [
    { label: '不附带', value: 'none' },
    { label: 'QQ 直链', value: 'qq_link' },
    { label: '二维码链接', value: 'qr_link' },
  ]

  const currentChannelDocUrl = computed(() => {
    const key = String(localOffline.value.channel || '').trim().toLowerCase()
    return CHANNEL_DOCS[key] || ''
  })

  function openChannelDocs() {
    const url = currentChannelDocUrl.value
    if (!url)
      return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function applyDeviceProtocolConfig(config?: Partial<DeviceProtocolConfig>) {
    deviceProtocolForm.value = {
      ...DEFAULT_DEVICE_PROTOCOL,
      ...config,
      enabled: config?.enabled === true,
    }
  }

  /** 将设备协议表单恢复为内置默认值（仅改表单，不落库） */
  function resetDeviceProtocolForm() {
    deviceProtocolForm.value = { ...DEFAULT_DEVICE_PROTOCOL }
  }

  function randomDigits(length: number) {
    let result = ''
    while (result.length < length) {
      const bytes = crypto.getRandomValues(new Uint8Array(length - result.length))
      for (const byte of bytes) {
        // Discard the upper six values so modulo 10 remains unbiased.
        if (byte < 250)
          result += String(byte % 10)
      }
    }
    return result
  }

  function formatHexByte(value: number) {
    return value.toString(16).padStart(2, '0').toUpperCase()
  }

  function generateRandomMac() {
    const bytes = crypto.getRandomValues(new Uint8Array(6))
    // Locally administered (bit 1), unicast (bit 0 cleared): no real vendor OUI.
    bytes[0] = ((bytes[0] ?? 0) & 0xFC) | 0x02
    return Array.from(bytes, formatHexByte).join(':')
  }

  function generateRandomDeviceId() {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    return Array.from(bytes, formatHexByte).join('')
  }

  function generateRandomImei() {
    const digits = randomDigits(14).split('').map(Number)
    let sum = 0
    digits.forEach((digit, index) => {
      const value = index % 2 === 1 ? digit * 2 : digit
      sum += value > 9 ? value - 9 : value
    })
    const checkDigit = (10 - (sum % 10)) % 10
    return `${digits.join('')}${checkDigit}`
  }

  function fillRandomDeviceMac() {
    deviceProtocolForm.value.deviceMac = generateRandomMac()
  }

  function fillRandomDeviceId() {
    deviceProtocolForm.value.deviceId = generateRandomDeviceId()
  }

  function fillRandomImei() {
    deviceProtocolForm.value.imei = generateRandomImei()
  }

  /** 套用设备预设；返回预设内容，便于调用方同步系统/系统版本等全局字段 */
  function applyDevicePreset(value: string | number | undefined) {
    if (value === undefined)
      return null
    const preset = DEVICE_PROTOCOL_PRESETS.find(item => item.value === value)
    if (!preset)
      return null
    deviceProtocolForm.value.userAgent = preset.config.userAgent
    deviceProtocolForm.value.deviceBrand = preset.config.deviceBrand
    deviceProtocolForm.value.deviceModel = preset.config.deviceModel
    deviceProtocolForm.value.deviceId = preset.config.deviceId
    deviceProtocolForm.value.deviceId16 = preset.config.deviceId16
    deviceProtocolForm.value.systemVersion = preset.config.systemVersion
    deviceProtocolForm.value.memory = preset.config.memory
    deviceProtocolForm.value.network = preset.config.network
    return preset.config
  }

  async function fetchDeviceProtocol() {
    deviceProtocolLoading.value = true
    try {
      const { data } = await api.get('/api/user/device-protocol')
      if (data?.ok)
        applyDeviceProtocolConfig(data.config)
    }
    catch (e) {
      console.error('加载设备协议配置失败', e)
    }
    finally {
      deviceProtocolLoading.value = false
    }
  }

  async function handleSaveDeviceProtocol() {
    deviceProtocolSaving.value = true
    try {
      const payload = {
        enabled: !!deviceProtocolForm.value.enabled,
        userAgent: String(deviceProtocolForm.value.userAgent || '').trim(),
        deviceBrand: String(deviceProtocolForm.value.deviceBrand || '').trim(),
        deviceModel: String(deviceProtocolForm.value.deviceModel || '').trim(),
        deviceMac: String(deviceProtocolForm.value.deviceMac || '').trim(),
        deviceId: String(deviceProtocolForm.value.deviceId || '').trim(),
        deviceId16: String(deviceProtocolForm.value.deviceId16 || '').trim(),
        imei: String(deviceProtocolForm.value.imei || '').trim(),
        systemVersion: String(deviceProtocolForm.value.systemVersion || '').trim(),
        memory: String(deviceProtocolForm.value.memory || '').trim(),
        network: String(deviceProtocolForm.value.network || '').trim(),
      }
      const { data } = await api.post('/api/user/device-protocol', payload)
      if (data?.ok) {
        applyDeviceProtocolConfig(data.config)
        showAlert('设备协议配置已保存', 'primary')
      }
      else {
        showAlert(`保存失败: ${data?.error || '未知错误'}`, 'danger')
      }
    }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '请求失败'
      showAlert(`保存失败: ${msg}`, 'danger')
    }
    finally {
      deviceProtocolSaving.value = false
    }
  }

  function syncLocalOfflineSettings() {
    if (settings.value?.offlineReminder) {
      localOffline.value = JSON.parse(JSON.stringify(settings.value.offlineReminder))
    }
  }

  watch(settings, () => {
    syncLocalOfflineSettings()
  }, { deep: true })

  async function handleSaveOffline() {
    offlineSaving.value = true
    try {
      const res = await settingStore.saveOfflineConfig(localOffline.value)

      if (res.ok) {
        showAlert('下线提醒设置已保存', 'primary')
      }
      else {
        showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
      }
    }
    finally {
      offlineSaving.value = false
    }
  }

  async function handleTestOffline() {
    offlineTesting.value = true
    try {
      const { data } = await api.post('/api/settings/offline-reminder/test', localOffline.value)
      if (data?.ok) {
        showAlert('测试消息发送成功', 'primary')
      }
      else {
        showAlert(`测试失败: ${data?.error || '未知错误'}`, 'danger')
      }
    }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '请求失败'
      showAlert(`测试失败: ${msg}`, 'danger')
    }
    finally {
      offlineTesting.value = false
    }
  }

  return {
    offlineSaving,
    offlineTesting,
    deviceProtocolLoading,
    deviceProtocolSaving,
    deviceProtocolPresetOptions,
    selectedDevicePreset,
    deviceProtocolForm,
    localOffline,
    channelOptions,
    reloginUrlModeOptions,
    currentChannelDocUrl,
    openChannelDocs,
    fillRandomDeviceMac,
    fillRandomDeviceId,
    fillRandomImei,
    applyDevicePreset,
    resetDeviceProtocolForm,
    fetchDeviceProtocol,
    syncLocalOfflineSettings,
    handleSaveDeviceProtocol,
    handleSaveOffline,
    handleTestOffline,
  }
}
