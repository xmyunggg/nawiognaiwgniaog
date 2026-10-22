<script setup lang="ts">
import type { RuntimeLogEntry } from '@/utils/runtime-log'
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import AccountCareerModal from '@/components/AccountCareerModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LiveDuration from '@/components/LiveDuration.vue'
import MobileHome from '@/components/MobileHome.vue'
import PlatformAvatar from '@/components/PlatformAvatar.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { formatCouponAmount, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'
import { compactRuntimeLogs, matchesRuntimeLog, normalizeRuntimeLog } from '@/utils/runtime-log'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const bagStore = useBagStore()
const toastStore = useToastStore()
const userStore = useUserStore()
const router = useRouter()

const {
  status,
  logs: statusLogs,
  accountLogs: statusAccountLogs,
  dailyGifts,
  realtimeConnected,
  currentStatusReady,
} = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { dashboardItems } = storeToRefs(bagStore)
const documentVisibility = useDocumentVisibility()

const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const lastBagFetchAt = ref(0)
const dailyGiftsRefreshing = ref(false)
const dailyGiftsDateKey = ref('')
const illustratedLevels = ref({ crop: 0, mutant: 0 })
let illustratedLevelRequestId = 0
const clearingLogs = ref(false)
const showClearLogsConfirm = ref(false)
const refreshingLogs = ref(false)
const pendingLogCount = ref(0)
const logScrollStates = new Map<string, { top: number, atBottom: boolean }>()

const filter = reactive({
  module: '',
  event: '',
  keyword: '',
})

const hasActiveLogFilter = computed(() =>
  !!(filter.module || filter.event || filter.keyword),
)
const currentAccountDisconnected = computed(() =>
  currentStatusReady.value && !status.value?.connection?.connected,
)

// 日志对象来自 Pinia 后基本不再变化，缓存归一化结果，避免每条新日志都重算整份列表。
const runtimeLogCache = new WeakMap<object, RuntimeLogEntry>()
const accountLogCache = new WeakMap<object, RuntimeLogEntry>()

function normalizeLogCached(input: any, isAccountLog = false): RuntimeLogEntry {
  if (!input || typeof input !== 'object')
    return normalizeRuntimeLog(input, isAccountLog)
  const cache = isAccountLog ? accountLogCache : runtimeLogCache
  const cached = cache.get(input)
  if (cached)
    return cached
  const normalized = normalizeRuntimeLog(input, isAccountLog)
  cache.set(input, normalized)
  return normalized
}

const allLogs = computed(() => {
  const merged = [
    ...(statusLogs.value || []).map((log: any) => normalizeLogCached(log)),
    ...(statusAccountLogs.value || []).map((log: any) => normalizeLogCached(log, true)),
  ]
  const unique = new Map<string, RuntimeLogEntry>()
  for (const log of merged)
    unique.set(log.id, log)
  return [...unique.values()].sort((a, b) => a.ts - b.ts)
})

const filteredLogs = computed(() => allLogs.value.filter((log) => {
  return matchesRuntimeLog(log, filter)
}))

const visibleLogs = computed(() => compactRuntimeLogs(filteredLogs.value))

const modules = [
  { label: '全部模块', value: '' },
  { label: '农场', value: 'farm' },
  { label: '好友', value: 'friend' },
  { label: '仓库', value: 'warehouse' },
  { label: '商城', value: 'shop' },
  { label: '任务', value: 'task' },
  { label: '活动', value: 'activity' },
  { label: '宠物', value: 'pet' },
  { label: '系统', value: 'system' },
]

const events = [
  { label: '全部事件', value: '' },
  { label: '农场巡查', value: '农场循环' },
  { label: '收获作物', value: '收获作物' },
  { label: '清理枯枝', value: '铲除植物' },
  { label: '种植种子', value: '种植种子' },
  { label: '施加化肥', value: '施肥' },
  { label: '土地提醒', value: '土地推送通知' },
  { label: '选择种子', value: '选择种子' },
  { label: '购买种子', value: '购买种子' },
  { label: '购买化肥', value: '购买化肥' },
  { label: '开启礼盒', value: '开启化肥礼包' },
  { label: '获取任务', value: '扫描任务' },
  { label: '完成任务', value: '领取任务' },
  { label: '免费礼包', value: 'mall_free_gifts' },
  { label: '分享奖励', value: 'daily_share' },
  { label: '会员礼包', value: 'vip_daily_gift' },
  { label: '月卡礼包', value: 'month_card_gift' },
  { label: '图鉴奖励', value: '图鉴奖励' },
  { label: '邮箱领取', value: 'email_rewards' },
  { label: '出售成功', value: 'sell_success' },
  { label: '神秘商人', value: '神秘商人自动购买' },
  { label: '土地升级', value: '升级土地' },
  { label: '土地解锁', value: '解锁土地' },
  { label: '好友巡查', value: '好友巡查循环' },
  { label: '访问好友', value: '进入农场' },
  { label: '激活宠物', value: '激活宠物' },
  { label: '派出宠物', value: '派出宠物' },
  { label: '召回宠物', value: '召回宠物' },
  { label: '喂食宠物', value: '喂食宠物' },
  { label: '资本模式派出', value: '资本模式派出' },
  { label: '资本模式召回', value: '资本模式召回' },
  { label: '有机化肥检测', value: 'check_fertilizer_organic' },
  { label: '普通化肥检测', value: 'check_fertilizer_normal' },
  { label: '化肥自动购买检测', value: 'check_fertilizer' },
]

const eventLabelMap: Record<string, string> = Object.fromEntries(
  events.filter(event => event.value).map(event => [event.value, event.label]),
)

const displayName = computed(() => {
  const account = accountStore.currentAccount
  const gameName = status.value?.status?.name

  if (gameName)
    return gameName

  if (currentAccountDisconnected.value) {
    if (account)
      return account.nick || account.name || '未登录'
    return '未登录'
  }

  if (account)
    return account.nick || account.name || '未命名'

  return '未命名'
})

/*
const expRate = computed(() => '0/小时')
const timeToLevel = computed(() => '')
*/

const fertilizerNormal = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 1011))
const fertilizerOrganic = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 1012))

const nextFarmRemainSec = ref(0)
const nextHelpRemainSec = ref(0)
const nextStealRemainSec = ref(0)
const localUptime = ref(0)

const countdownEmptyText = computed(() => {
  if (!currentAccountId.value)
    return '--:--:--'
  if (!currentStatusReady.value)
    return '--:--:--'
  if (currentAccountDisconnected.value)
    return '账号未登录'
  return '检查中...'
})

// Task modal moved to AccountSettingsTab

function resetDashboardState() {
  illustratedLevelRequestId += 1
  illustratedLevels.value = { crop: 0, mutant: 0 }
  lastBagFetchAt.value = 0
  localUptime.value = 0
  nextFarmRemainSec.value = 0
  nextHelpRemainSec.value = 0
  nextStealRemainSec.value = 0
}

const OP_META: Record<string, { label: string, icon: string, color: string }> = {
  harvest: { label: '收获', icon: 'i-carbon-crop-growth', color: 'text-green-500' },
  water: { label: '浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-400' },
  weed: { label: '除草', icon: 'i-carbon-cut', color: 'text-yellow-500' },
  bug: { label: '除虫', icon: 'i-carbon-pest', color: 'text-red-400' },
  farming: { label: '一键务农', icon: 'i-carbon-clean', color: 'text-teal-500' },
  fertilize: { label: '施肥', icon: 'i-carbon-chemistry', color: 'text-emerald-500' },
  plant: { label: '种植', icon: 'i-carbon-tree', color: 'text-lime-500' },
  steal: { label: '偷菜', icon: 'i-carbon-run', color: 'text-orange-500' },
  helpWater: { label: '帮浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-300' },
  goldenBugClear: { label: '清黄金虫', icon: 'i-carbon-clean', color: 'text-amber-500' },
  goldenBugPut: { label: '放黄金虫', icon: 'i-carbon-pest', color: 'text-yellow-500' },
  helpWeed: { label: '帮除草', icon: 'i-carbon-cut', color: 'text-yellow-400' },
  helpBug: { label: '帮除虫', icon: 'i-carbon-pest', color: 'text-red-300' },
  helpFarming: { label: '帮务农', icon: 'i-carbon-collaborate', color: 'text-yellow-400' },
  putBug: { label: '放虫', icon: 'i-carbon-pest', color: 'text-red-500' },
  putWeed: { label: '放草', icon: 'i-carbon-cut', color: 'text-lime-600' },
  taskClaim: { label: '任务', icon: 'i-carbon-task-complete', color: 'text-indigo-500' },
  sell: { label: '出售', icon: 'i-carbon-shopping-cart', color: 'text-pink-500' },
  upgrade: { label: '土地升级', icon: 'i-carbon-growth', color: 'text-amber-600' },
  levelUp: { label: '等级提升', icon: 'i-carbon-arrow-up', color: 'text-cyan-500' },
  tongQiGift: { label: '同气礼包', icon: 'i-carbon-gift', color: 'text-rose-500' },
}

/** 好友帮助类动作：合并为“帮务农”一项展示，避免同一批帮助动作重复计数 */
const HELP_OP_KEYS = ['helpWater', 'helpWeed', 'helpBug']

const filteredOperations = computed(() => {
  const operations = status.value?.operations || {}
  const result: Record<string, number> = {}
  let helpTotal = 0
  let helpSlotPlaced = false

  for (const key of Object.keys(operations)) {
    const value = Number(operations[key]) || 0
    if (HELP_OP_KEYS.includes(key)) {
      helpTotal += value
      if (!helpSlotPlaced) {
        result.helpFarming = 0
        helpSlotPlaced = true
      }
      continue
    }
    result[key] = value
  }

  if (helpSlotPlaced)
    result.helpFarming = helpTotal

  return result
})

const statusBadge = computed(() => {
  if (!status.value?.connection?.connected)
    return currentStatusReady.value ? '账号离线' : '检查中'
  return currentAccount.value?.running ? '农场运行中' : '账号已连接'
})

const expRate = computed(() => {
  const gain = Number(status.value?.sessionExpGained || 0)
  const uptime = Number(status.value?.sessionElapsedSeconds ?? status.value?.uptime ?? 0)
  const hours = uptime / 3600
  const rate = hours > 0 ? Math.floor(gain / hours) : 0
  return `${Math.max(0, rate).toLocaleString('zh-CN')}/小时`
})

const upgradeText = computed(() => {
  const forecast = status.value?.levelForecast
  if (!forecast)
    return '等待升级预测'
  if (forecast.source === 'ready')
    return '收获后可升级'
  const estimatedAt = Number(forecast.estimatedAt)
  if (!Number.isFinite(estimatedAt) || estimatedAt <= 0)
    return forecast?.plotCount ? '本轮收获不足升级' : '等待升级预测'
  const generatedAt = Number(forecast.generatedAt) || Date.now()
  const minutes = Math.max(1, Math.ceil((estimatedAt - generatedAt) / 60000))
  const duration = minutes < 60 ? `${minutes} 分钟` : `${(minutes / 60).toFixed(1)} 小时`
  return forecast.source === 'planted' ? `约 ${duration}后收获可升级` : `约 ${duration}后升级`
})

const forecastBasis = computed(() => {
  const source = status.value?.levelForecast?.source
  return ({
    planted: '按当前作物',
    ready: '待收获',
    mixed: '收获排期 + 历史均值',
    history: '历史均值估算',
  } as Record<string, string>)[source] || ''
})

const assetCards = computed(() => [
  {
    key: 'gold',
    label: '金币',
    icon: '/game-config/resource-icons/gold.png',
    value: formatGoldAmount(status.value?.status?.gold || 0),
    gain: Number(status.value?.sessionGoldGained || 0),
    gainText: formatGoldAmount(status.value?.sessionGoldGained || 0),
  },
  {
    key: 'coupon',
    label: '点券',
    icon: '/game-config/resource-icons/coupon.png',
    value: formatCouponAmount(status.value?.status?.coupon || 0),
    gain: Number(status.value?.sessionCouponGained || 0),
    gainText: formatCouponAmount(status.value?.sessionCouponGained || 0),
  },
  {
    key: 'diamond',
    label: '钻石',
    icon: '/game-config/resource-icons/diamond.png',
    value: formatCouponAmount(status.value?.status?.diamond || 0),
    gain: 0,
    gainText: '',
  },
  {
    key: 'goldBean',
    label: '金豆',
    icon: '/game-config/resource-icons/gold-bean.png',
    value: formatGoldBeanAmount(status.value?.status?.goldBean || 0),
    gain: 0,
    gainText: '',
  },
])

const features = [
  { key: 'illustrated', route: '/personal?tab=illustrated', label: '作物图鉴', hint: '收录与解锁', icon: 'i-carbon-sprout' },
  { key: 'pet', route: '/personal?tab=pet', label: '宠物守护', hint: '狗粮与派遣', icon: 'i-carbon-dog-walker' },
  { key: 'friends', route: '/friends', label: '我的好友', hint: '巡查与互助', icon: 'i-carbon-user-multiple' },
  { key: 'shop', route: '/shop', label: '道具商城', hint: '道具 · 装扮', icon: 'i-carbon-shopping-cart' },
  { key: 'activity', route: '/activity', label: '限时活动', hint: '精彩活动', icon: 'i-carbon-gift' },
  { key: 'analytics', route: '/analytics', label: '作物分析', hint: '数据统计', icon: 'i-carbon-analytics' },
]

function formatGain(value: unknown) {
  const gain = Number(value || 0)
  if (!gain)
    return '0'
  return `${gain > 0 ? '+' : ''}${gain.toLocaleString('zh-CN')}`
}

function gainClass(value: unknown) {
  const gain = Number(value || 0)
  if (gain > 0)
    return 'gain--positive'
  if (gain < 0)
    return 'gain--negative'
  return 'gain--neutral'
}

function getEventLabel(event: string) {
  if (event === 'check_fertilizer_organic')
    return '有机化肥检测'
  if (event === 'check_fertilizer_normal')
    return '普通化肥检测'
  if (event === 'check_fertilizer')
    return '化肥检测'
  return eventLabelMap[event] || event
}

function formatBucketTime(item: any) {
  if (!item)
    return '0.0h'
  if (item.hoursText)
    return item.hoursText.replace('小时', 'h')
  return `${(Number(item.count || 0) / 3600).toFixed(1)}h`
}

function getExpPercent(progress?: { current?: number, needed?: number } | null) {
  const current = Number(progress?.current || 0)
  const needed = Number(progress?.needed || 0)
  if (!needed)
    return 0
  return Math.min(100, Math.max(0, (current / needed) * 100))
}

watch(() => {
  const nextChecks = status.value?.nextChecks || {}
  return [
    nextChecks.farmRemainSec || 0,
    nextChecks.helpRemainSec || 0,
    nextChecks.stealRemainSec || 0,
    status.value?.uptime,
  ] as const
}, ([farmRemainSec, helpRemainSec, stealRemainSec, uptime]) => {
  // 秒级递减交给 LiveDuration 子组件，Dashboard 本身只接收服务端锚点。
  nextFarmRemainSec.value = farmRemainSec
  nextHelpRemainSec.value = helpRemainSec
  nextStealRemainSec.value = stealRemainSec
  if (uptime !== undefined)
    localUptime.value = uptime
})

function getLogTagClass(tag: string) {
  if (tag === '错误')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (tag === '系统')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (tag === '活动')
    return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
  if (tag === '宠物')
    return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300'
  if (tag === '警告')
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

function formatLogTime(timeStr: string) {
  if (!timeStr)
    return ''
  const parts = timeStr.split(' ')
  return parts.length > 1 ? parts[1] : timeStr
}

function formatLogTimeRange(log: RuntimeLogEntry) {
  const start = formatLogTime(log.time)
  if (!log.lastTs || log.lastTs === log.ts)
    return start
  return `${start}–${new Date(log.lastTs).toLocaleTimeString('zh-CN', { hour12: false })}`
}

function getLogScrollStateKey() {
  return [currentAccountId.value, filter.module, filter.event, filter.keyword].join('|')
}

function restoreLogScroll() {
  nextTick(() => {
    const element = logContainer.value
    if (!element)
      return
    const saved = logScrollStates.get(getLogScrollStateKey())
    if (saved && !saved.atBottom) {
      element.scrollTop = saved.top
      autoScroll.value = false
    }
    else {
      scrollToBottom()
    }
  })
}

async function refreshRuntimeLogs() {
  if (!currentAccountId.value || refreshingLogs.value)
    return
  refreshingLogs.value = true
  try {
    await Promise.all([
      statusStore.fetchLogs(currentAccountId.value, { limit: 300 }),
      statusStore.fetchAccountLogs(currentAccountId.value, 300),
    ])
    toastStore.success('日志已刷新')
  }
  finally {
    refreshingLogs.value = false
  }
}

function getOpName(key: string | number) {
  return OP_META[String(key)]?.label || String(key)
}

function getOpIcon(key: string | number) {
  return OP_META[String(key)]?.icon || 'i-carbon-circle-dash'
}

function getOpColor(key: string | number) {
  return OP_META[String(key)]?.color || 'text-gray-400'
}

function isPageVisible() {
  return documentVisibility.value === 'visible'
}

async function refreshBag(force = false) {
  if (!isPageVisible())
    return
  if (!currentAccountId.value || !currentAccount.value?.running || !currentStatusReady.value || !status.value?.connection?.connected)
    return

  const now = Date.now()
  if (!force && now - lastBagFetchAt.value < 2500)
    return

  lastBagFetchAt.value = now
  await bagStore.fetchBag(currentAccountId.value)
}

function isMembershipGiftUnavailable(gift: any) {
  if (!gift)
    return false
  if (gift.key === 'vip_daily_gift' && gift.hasGift === false)
    return true
  if (gift.key === 'month_card_gift' && gift.hasCard === false)
    return true
  return false
}

function localDateKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function shouldRefreshDailyGifts() {
  if (!currentAccountId.value || !currentAccount.value?.running || !status.value?.connection?.connected)
    return false

  // 全部完成后停止轮询，但跨天时至少重新取一次，避免第二天仍显示昨天的完成状态。
  if (dailyGiftsDateKey.value !== localDateKey())
    return true

  const gifts = dailyGifts.value?.gifts
  if (!Array.isArray(gifts) || gifts.length === 0)
    return true

  return gifts.some((gift: any) => !!gift && !gift.doneToday && !isMembershipGiftUnavailable(gift))
}

async function refreshDailyGifts(force = false) {
  if (!isPageVisible())
    return
  if (!currentAccountId.value || !currentAccount.value?.running)
    return
  if (!force && !shouldRefreshDailyGifts())
    return
  if (dailyGiftsRefreshing.value)
    return

  dailyGiftsRefreshing.value = true
  try {
    const data = await statusStore.fetchDailyGifts(currentAccountId.value)
    if (data)
      dailyGiftsDateKey.value = localDateKey()
  }
  finally {
    dailyGiftsRefreshing.value = false
  }
}

async function refreshIllustratedLevels() {
  if (!currentAccountId.value || !status.value?.connection?.connected)
    return

  const accountId = currentAccountId.value
  const requestId = ++illustratedLevelRequestId
  const headers = { 'x-account-id': accountId }
  try {
    const [crop, mutant] = await Promise.all([
      api.get('/api/illustrated', { params: { illustrated_type: 1 }, headers }),
      api.get('/api/illustrated', { params: { illustrated_type: 2 }, headers }),
    ])
    if (requestId !== illustratedLevelRequestId || accountId !== currentAccountId.value)
      return
    illustratedLevels.value = {
      crop: Number(crop.data?.data?.level) || 0,
      mutant: Number(mutant.data?.data?.level) || 0,
    }
  }
  catch {
    if (requestId === illustratedLevelRequestId)
      illustratedLevels.value = { crop: 0, mutant: 0 }
  }
}

async function refresh(forceReloadLogs = false) {
  if (!isPageVisible())
    return
  if (!currentAccountId.value)
    return

  const account = currentAccount.value
  if (!account)
    return

  // 首次加载、断线回退时走 HTTP；实时连接正常时优先依赖 WS 推送。
  if (!realtimeConnected.value) {
    await statusStore.fetchStatus(currentAccountId.value)
    await statusStore.fetchAccountLogs(currentAccountId.value)
  }

  if (forceReloadLogs || !realtimeConnected.value)
    await statusStore.fetchLogs(currentAccountId.value, { limit: 300 })

  // 背包与每日礼包由各自的事件/低频兜底逻辑刷新，不再跟随 10 秒首页轮询。
}

function syncRealtimeAccount() {
  if (currentAccountId.value)
    statusStore.connectRealtime(currentAccountId.value)
}

function onLogFilterChange() {
  pendingLogCount.value = 0
  restoreLogScroll()
}

function onLogSearchTrigger() {
  pendingLogCount.value = 0
  restoreLogScroll()
}

watch(currentAccountId, async (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    statusStore.clearAccountScopedData()
    bagStore.clearBag()
    dailyGiftsDateKey.value = ''
    resetDashboardState()
  }
  syncRealtimeAccount()
  await refresh(true)
  await Promise.all([
    refreshBag(true),
    refreshDailyGifts(true),
    refreshIllustratedLevels(),
  ])
  scrollToBottom()
})

watch(() => status.value?.connection?.connected, (connected) => {
  if (connected) {
    refreshBag(true)
    refreshDailyGifts(true)
    refreshIllustratedLevels()
  }
})

watch(() => JSON.stringify(status.value?.operations || {}), (next, prev) => {
  if (!realtimeConnected.value || next === prev)
    return
  refreshBag()
})

// 切窗口/最小化会触发 visibilitychange（Chrome 窗口被遮挡时也会隐藏页面）。
// 这里不再主动发请求：状态走 WS 推送，背包 / 每日礼包有 60 秒兜底，
// 图鉴随页面挂载或重连刷新，断线由 Sidebar 重连 + 本页 10 秒 status 回退补齐，
// 避免每切一次窗口就打一批接口。

function onLogScroll(event: Event) {
  const element = event.target as HTMLElement
  if (!element)
    return
  autoScroll.value = element.scrollHeight - element.scrollTop - element.clientHeight < 50
  logScrollStates.set(getLogScrollStateKey(), { top: element.scrollTop, atBottom: autoScroll.value })
  if (autoScroll.value)
    pendingLogCount.value = 0
}

function clearLogs() {
  if (!currentAccountId.value)
    return
  showClearLogsConfirm.value = true
}

async function confirmClearLogs() {
  if (!currentAccountId.value) {
    showClearLogsConfirm.value = false
    return
  }

  clearingLogs.value = true
  try {
    const { data } = await api.delete('/api/logs')
    if (data?.ok) {
      toastStore.success('日志已清空')
      await refresh(true)
    }
    else {
      toastStore.error(`清空失败: ${data?.error || '未知错误'}`)
    }
  }
  catch (error: any) {
    const message = error?.response?.data?.error || error?.message || '请求失败'
    toastStore.error(`清空失败: ${message}`)
  }
  finally {
    clearingLogs.value = false
    showClearLogsConfirm.value = false
  }
}

watch(visibleLogs, (next, previous) => {
  nextTick(() => {
    if (!autoScroll.value) {
      if (next.length > (previous?.length || 0))
        pendingLogCount.value += next.length - (previous?.length || 0)
      return
    }
    const element = logContainer.value
    if (!element)
      return
    // 合并到下一帧，避免日志高频追加时同步读取 scrollHeight 触发布局抖动。
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
      pendingLogCount.value = 0
    })
  })
}, { flush: 'post' })

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value)
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    autoScroll.value = true
    pendingLogCount.value = 0
  })
}

onMounted(async () => {
  statusStore.setRealtimeLogsEnabled(true)
  syncRealtimeAccount()
  await refresh()
  await Promise.all([
    refreshBag(true),
    refreshDailyGifts(true),
    refreshIllustratedLevels(),
  ])
  scrollToBottom()
})

// 状态/日志兜底：WS 正常时基本不发请求，页面隐藏时直接跳过。
useIntervalFn(refresh, 10000, { immediate: false })
// 背包：WS 操作事件驱动，保留 60 秒兜底。
useIntervalFn(refreshBag, 60000, { immediate: false })
// 每日礼包：全部完成或会员礼包未开通时停止，未完成时 60 秒兜底。
useIntervalFn(() => refreshDailyGifts(false), 60000, { immediate: false })

const showCareerModal = ref(false)
const careerLoading = ref(false)
const careerError = ref('')
const careerItems = ref<any[]>([])
const careerProfile = ref<Record<string, any>>({})

function liveAccountAvatar() {
  if (!currentStatusReady.value)
    return ''
  return String(
    status.value?.status?.avatar
    || status.value?.status?.avatarUrl
    || status.value?.status?.avatar_url
    || '',
  ).trim()
}

const currentPlatform = computed(() =>
  String(currentAccount.value?.platform || status.value?.status?.platform || '').toLowerCase(),
)

const currentAvatar = computed(() => {
  const acc = currentAccount.value
  if (!acc)
    return '/default-user-avatar-256.png'
  const explicit = liveAccountAvatar() || String(acc.avatar || '').trim()
  if (explicit)
    return explicit
  const qq = String(acc.uin || acc.qq || '').trim()
  if (qq && /^\d+$/.test(qq))
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return '/default-user-avatar-256.png'
})

async function loadCareer() {
  const accountId = String(currentAccountId.value || '').trim()
  if (!accountId)
    return
  careerLoading.value = true
  careerError.value = ''
  try {
    const { data } = await api.get('/api/career', {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '生涯记录读取失败')
    careerProfile.value = data.data || {}
    careerItems.value = data.data?.items || []
  }
  catch (error: any) {
    careerError.value = error?.response?.data?.error || error?.message || '生涯记录读取失败'
  }
  finally {
    careerLoading.value = false
  }
}

function openCareer() {
  if (!currentAccount.value)
    return
  showCareerModal.value = true
  loadCareer()
}
</script>

<template>
  <div class="flex flex-col pt-1 lg:pt-2">
    <!-- 移动端首页（对齐游戏化移动端布局） -->
    <div class="lg:hidden">
      <MobileHome
        :display-name="displayName"
        :account-name="currentAccount?.name || ''"
        :avatar="currentAvatar"
        :platform="currentPlatform"
        :level="Number(status?.status?.level) || 0"
        :exp-current="Number(status?.levelProgress?.current) || 0"
        :exp-needed="Number(status?.levelProgress?.needed) || 0"
        :exp-gained="Number(status?.sessionExpGained) || 0"
        :gold="Number(status?.status?.gold) || 0"
        :coupon="Number(status?.status?.coupon) || 0"
        :diamond="Number(status?.status?.diamond) || 0"
        :gold-bean="Number(status?.status?.goldBean) || 0"
        :connected="!!status?.connection?.connected"
        :running="!!currentAccount?.running"
        :uptime="localUptime"
        :illustrated-crop="illustratedLevels.crop"
        :illustrated-mutant="illustratedLevels.mutant"
        :daily-gifts="statusStore.dailyGifts"
        :refreshing-daily-gifts="dailyGiftsRefreshing"
        :daily-gifts-refresh-disabled="!currentAccount?.running"
        @refresh-daily-gifts="refreshDailyGifts(true)"
        @open-career="openCareer"
      />
    </div>

    <!-- 桌面端控制台（farm-glass 玻璃卡纵向布局） -->
    <div class="dash-farm hidden lg:block">
      <div class="farm-shell">
        <!-- 账号信息 -->
        <section class="farm-glass profile-card">
          <div class="profile-row">
            <button class="avatar-button" type="button" title="查看个人生涯记录" @click="openCareer">
              <PlatformAvatar
                :src="currentAvatar"
                :name="displayName"
                :platform="currentPlatform"
                :size="54"
              />
            </button>
            <div class="profile-main">
              <div class="profile-title">
                <h1 :title="displayName">
                  {{ displayName }}
                </h1>
                <span class="level-chip">Lv.{{ status?.status?.level || 0 }}</span>
                <span
                  class="platform-chip"
                  :class="(currentAccount?.platform || status?.status?.platform) === 'wx' ? 'platform-chip--wx' : 'platform-chip--qq'"
                >
                  {{ (currentAccount?.platform || status?.status?.platform) === 'wx' ? '微信' : 'QQ' }}
                </span>
              </div>
              <div class="exp-row">
                <div class="exp-track">
                  <div class="exp-fill" :style="{ width: `${getExpPercent(status?.levelProgress)}%` }" />
                </div>
                <span class="exp-numbers">
                  {{ status?.levelProgress?.current || 0 }} / {{ status?.levelProgress?.needed || '?' }}
                </span>
              </div>
            </div>
          </div>
          <div class="profile-foot">
            <span class="profile-metric">
              <span class="status-dot" :class="{ 'status-dot--off': !status?.connection?.connected }" />
              {{ status?.connection?.connected ? '在线' : currentStatusReady ? '离线' : '检查中' }}
            </span>
            <span class="profile-metric">
              <i class="i-carbon-flash" />
              EXP 效率 {{ expRate }}
            </span>
            <span class="profile-metric" :title="forecastBasis">
              <i class="i-carbon-growth" />
              {{ upgradeText }}
            </span>
            <span class="profile-metric profile-metric--muted">
              <i class="i-carbon-calendar" />
              <span v-if="userStore.userCard">到期：{{ userStore.expireTimeText }}</span>
              <span v-else>永久有效</span>
            </span>
          </div>
        </section>

        <!-- 核心资产 -->
        <div class="asset-grid">
          <div v-for="asset in assetCards" :key="asset.key" class="asset-card" :class="`asset-card--${asset.key}`">
            <span class="asset-head">
              <span class="asset-icon"><img :src="asset.icon" :alt="asset.label"></span>
              <span class="asset-label">{{ asset.label }}</span>
            </span>
            <span class="asset-value">{{ asset.value }}</span>
            <span v-if="asset.gain" class="asset-gain" :class="asset.gain > 0 ? 'gain--positive' : 'gain--negative'">
              {{ asset.gainText }}
            </span>
          </div>
        </div>

        <!-- 运行状态 -->
        <button type="button" class="farm-glass run-card" @click="router.push('/personal')">
          <span class="run-left">
            <span class="run-badges">
              <span class="run-online">
                <span class="status-dot" :class="{ 'status-dot--off': !status?.connection?.connected }" />
                {{ status?.connection?.connected ? '在线' : '离线' }}
              </span>
              <span class="run-badge">{{ statusBadge }}</span>
            </span>
            <span class="run-time-row">
              <span class="run-clock"><i class="i-carbon-time" /></span>
              <strong class="run-time"><LiveDuration :seconds="localUptime" :active="!!status?.connection?.connected" /></strong>
            </span>
            <span class="run-caption">已运行 · 进入我的农场</span>
          </span>
          <span class="run-art">
            <span class="run-art-frame">
              <span class="run-enter"><i class="i-carbon-chevron-right" /></span>
            </span>
          </span>
        </button>

        <!-- 功能入口 -->
        <div class="feature-grid">
          <button
            v-for="feature in features"
            :key="feature.key"
            type="button"
            class="farm-glass feature-card"
            @click="router.push(feature.route)"
          >
            <span class="feature-icon" :class="`feature-icon--${feature.key}`"><i :class="feature.icon" /></span>
            <span class="feature-copy">
              <strong>{{ feature.label }}</strong>
              <small>{{ feature.hint }}</small>
            </span>
            <i class="feature-arrow i-carbon-chevron-right" />
          </button>
        </div>

        <!-- 辅助物资与图鉴 -->
        <div class="supply-grid">
          <div class="farm-glass supply-card">
            <span class="supply-left">
              <img src="/game-config/resource-icons/fertilizer-normal.png" alt="普通化肥" class="supply-icon">
              <span class="supply-label">普通化肥</span>
            </span>
            <span class="supply-value">{{ formatBucketTime(fertilizerNormal) }}</span>
          </div>
          <div class="farm-glass supply-card">
            <span class="supply-left">
              <img src="/game-config/resource-icons/illustrated-crop.png" alt="作物图鉴" class="supply-icon">
              <span class="supply-label">作物图鉴</span>
            </span>
            <span class="supply-value">Lv.{{ illustratedLevels.crop }}</span>
          </div>
          <div class="farm-glass supply-card">
            <span class="supply-left">
              <img src="/game-config/resource-icons/fertilizer-organic.png" alt="有机化肥" class="supply-icon">
              <span class="supply-label">有机化肥</span>
            </span>
            <span class="supply-value">{{ formatBucketTime(fertilizerOrganic) }}</span>
          </div>
          <div class="farm-glass supply-card">
            <span class="supply-left">
              <img src="/game-config/resource-icons/illustrated-mutant.png" alt="超变图鉴" class="supply-icon">
              <span class="supply-label">超变图鉴</span>
            </span>
            <span class="supply-value">Lv.{{ illustratedLevels.mutant }}</span>
          </div>
        </div>

      </div>
    </div>

    <!-- 巡查 / 统计 / 运行日志（移动端与桌面端共用） -->
    <div class="dash-farm">
      <div class="farm-shell">
        <!-- 下次巡查 / 今日统计 -->
        <div class="insight-grid">
          <section class="farm-glass insight-card">
            <div class="insight-head">
              <span class="insight-icon insight-icon--time"><i class="i-carbon-time" /></span>
              <div class="insight-heading">
                <h2>下次巡查倒计时</h2>
                <p>自动巡查节奏</p>
              </div>
            </div>
            <div class="check-list">
              <div class="check-row">
                <span class="check-icon check-icon--farm"><i class="i-carbon-sprout" /></span>
                <span class="check-label">农场</span>
                <span class="check-value"><LiveDuration mode="remaining" :seconds="nextFarmRemainSec" :active="!!status?.connection?.connected" :empty-text="countdownEmptyText" /></span>
              </div>
              <div class="check-row">
                <span class="check-icon check-icon--help"><i class="i-carbon-user-multiple" /></span>
                <span class="check-label">帮助</span>
                <span class="check-value"><LiveDuration mode="remaining" :seconds="nextHelpRemainSec" :active="!!status?.connection?.connected" :empty-text="countdownEmptyText" /></span>
              </div>
              <div class="check-row">
                <span class="check-icon check-icon--steal"><i class="i-carbon-run" /></span>
                <span class="check-label">偷菜</span>
                <span class="check-value"><LiveDuration mode="remaining" :seconds="nextStealRemainSec" :active="!!status?.connection?.connected" :empty-text="countdownEmptyText" /></span>
              </div>
            </div>
          </section>

          <section class="farm-glass insight-card">
            <div class="insight-head">
              <span class="insight-icon insight-icon--stats"><i class="i-carbon-chart-column" /></span>
              <div class="insight-heading">
                <h2>今日统计</h2>
                <p>{{ currentAccountDisconnected ? '等待账号连接' : '本次会话动作统计' }}</p>
              </div>
            </div>
            <div v-if="currentAccountDisconnected" class="insight-empty">
              账号未登录
            </div>
            <template v-else>
              <div v-if="Object.keys(filteredOperations).length" class="operation-grid">
                <div v-for="(val, key) in filteredOperations" :key="key" class="operation-chip">
                  <i class="operation-icon" :class="[getOpIcon(key), getOpColor(key)]" />
                  <span class="operation-label">{{ getOpName(key) }}</span>
                  <strong class="operation-value">{{ val }}</strong>
                </div>
              </div>
              <div v-else class="insight-empty">
                暂无统计数据
              </div>

              <div class="session-gains">
                <p class="gain-title">
                  本次会话收益
                </p>
                <div class="gain-item">
                  <span>经验</span>
                  <strong :class="gainClass(status?.sessionExpGained)">{{ formatGain(status?.sessionExpGained) }}</strong>
                </div>
                <div class="gain-item">
                  <span>金币</span>
                  <strong :class="gainClass(status?.sessionGoldGained)">{{ formatGain(status?.sessionGoldGained) }}</strong>
                </div>
                <div class="gain-item">
                  <span>点券</span>
                  <strong :class="gainClass(status?.sessionCouponGained)">{{ formatGain(status?.sessionCouponGained) }}</strong>
                </div>
              </div>
            </template>
          </section>
        </div>

        <!-- 运行日志 -->
        <section class="farm-glass log-card">
          <div class="log-head">
            <div class="log-title">
              <div class="log-title-main">
                <h2>运行日志</h2>
                <p v-if="hasActiveLogFilter">
                  筛选结果 {{ visibleLogs.length }} 条 · 实时推送已暂停
                </p>
                <p v-else>
                  共 {{ visibleLogs.length }} 条 · 实时追加
                </p>
              </div>
            </div>
            <div class="log-filters">
              <div class="log-filter-control">
                <BaseSelect v-model="filter.module" :options="modules" @change="onLogFilterChange" />
              </div>
              <div class="log-filter-control">
                <BaseSelect v-model="filter.event" :options="events" @change="onLogFilterChange" />
              </div>
              <div class="log-filter-control log-filter-control--keyword">
                <BaseInput
                  v-model="filter.keyword"
                  placeholder="关键词"
                  clearable
                  @keyup.enter="onLogSearchTrigger"
                  @clear="onLogSearchTrigger"
                />
              </div>
              <BaseButton
                v-if="hasActiveLogFilter"
                variant="ghost"
                size="sm"
                @click="Object.assign(filter, { module: '', event: '', keyword: '' }); onLogFilterChange()"
              >
                <div class="i-carbon-filter-remove" />
              </BaseButton>
              <BaseButton variant="secondary" size="sm" :loading="refreshingLogs" @click="refreshRuntimeLogs">
                <div class="i-carbon-renew" />
              </BaseButton>
              <BaseButton variant="secondary" size="sm" :loading="clearingLogs" @click="clearLogs">
                <div class="i-carbon-trash-can" />
              </BaseButton>
            </div>
          </div>
          <div class="log-body">
            <div ref="logContainer" class="log-list" @scroll="onLogScroll">
              <div v-if="!visibleLogs.length" class="log-empty">
                {{ hasActiveLogFilter ? '没有符合条件的日志' : '暂无日志' }}
              </div>
              <div
                v-for="log in visibleLogs"
                :key="log.id"
                v-memo="[log.id, log.msg, log.tag, log.level, log.event, log.source, log.repeatCount, log.lastTs]"
                class="log-line"
                :title="log.msg"
              >
                <span class="log-time">{{ formatLogTimeRange(log) }}</span>
                <span class="log-tag" :class="getLogTagClass(log.tag)">{{ log.tag }}</span>
                <span v-if="log.event && log.source !== 'account'" class="log-event">{{ getEventLabel(log.event) }}</span>
                <span class="log-msg">{{ log.msg }}</span>
                <span v-if="(log.repeatCount || 1) > 1" class="log-repeat">×{{ log.repeatCount }}</span>
              </div>
            </div>
            <button v-if="pendingLogCount" class="log-latest" type="button" @click="scrollToBottom">
              {{ pendingLogCount }} 条新日志
              <i class="i-carbon-arrow-down" />
            </button>
          </div>
        </section>
      </div>
    </div>

    <Teleport to="body">
      <AccountCareerModal
        :show="showCareerModal"
        :account="currentAccount"
        :profile="careerProfile"
        :items="careerItems"
        :loading="careerLoading"
        :error="careerError"
        @close="showCareerModal = false"
        @refresh="loadCareer"
      />
    </Teleport>

    <ConfirmModal
      :show="showClearLogsConfirm"
      title="清空运行日志"
      message="确认清空当前账号的页面运行记录？此操作不会删除磁盘诊断日志。"
      type="danger"
      confirm-text="确认清空"
      :loading="clearingLogs"
      @confirm="confirmClearLogs"
      @cancel="showClearLogsConfirm = false"
      @close="showClearLogsConfirm = false"
    />
  </div>
</template>

<style scoped>
/* ===== 桌面端农庄玻璃主题（参考 qq-farm-bot-source 的 farm-glass 布局） ===== */
.dash-farm {
  --fg-strong: #1d3527;
  --fg: #2f4b38;
  --fg-soft: #5c7864;
  --fg-faint: #6b8272;
  --chip-bg: rgba(255, 255, 255, 0.66);
  --soft-bg: rgba(255, 255, 255, 0.36);
  --glass-border: rgba(255, 255, 255, 0.6);
  --glass-bg: linear-gradient(135deg, rgba(255, 255, 255, 0.66) 0%, rgba(255, 255, 255, 0.44) 100%);
  --glass-shadow: 0 12px 30px rgba(25, 58, 36, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.75);
}

.dark .dash-farm {
  --fg-strong: #e8f4ec;
  --fg: #cfe6da;
  --fg-soft: #9db6a9;
  --fg-faint: #8aa396;
  --chip-bg: rgba(255, 255, 255, 0.14);
  --soft-bg: rgba(255, 255, 255, 0.08);
  --glass-border: rgba(255, 255, 255, 0.14);
  --glass-bg: linear-gradient(135deg, rgba(26, 46, 37, 0.8) 0%, rgba(18, 34, 27, 0.72) 100%);
  --glass-shadow: 0 12px 30px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.farm-shell {
  display: flex;
  width: min(100%, 1060px);
  flex-direction: column;
  gap: 14px;
  margin: 0 auto;
  padding: 2px 2px 16px;
}

.farm-glass {
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  background: var(--glass-bg);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  backdrop-filter: blur(18px) saturate(150%);
}

.profile-card {
  padding: 18px 20px 14px;
  color: var(--fg);
}

.profile-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.avatar-button {
  display: flex;
  width: 58px;
  height: 58px;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: visible;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.avatar-button:hover {
  box-shadow: 0 6px 16px rgba(38, 72, 48, 0.28);
  transform: translateY(-1px);
}

.profile-main {
  min-width: 0;
  flex: 1;
}

.profile-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.profile-title h1 {
  overflow: hidden;
  margin: 0;
  color: var(--fg-strong);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.2px;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
}

.level-chip {
  flex: none;
  padding: 2px 9px;
  border-radius: 999px;
  background: linear-gradient(135deg, #a8e063, #62c655);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(69, 154, 53, 0.35);
}

.platform-chip {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
}

.platform-chip--wx {
  background: rgba(209, 244, 220, 0.9);
  color: #2f9e5a;
}

.platform-chip--qq {
  background: rgba(212, 232, 253, 0.9);
  color: #2f6fb5;
}

.exp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 11px;
}

.exp-track {
  height: 12px;
  flex: 1;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: inset 0 1px 3px rgba(57, 94, 65, 0.18);
}

.dark .exp-track {
  background: rgba(255, 255, 255, 0.14);
}

.exp-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #8ee06a 0%, #4dc24c 100%);
  box-shadow: 0 0 10px rgba(88, 196, 75, 0.55);
  transition: width 0.5s ease;
}

.exp-numbers {
  flex: none;
  color: var(--fg);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.profile-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-top: 12px;
  color: var(--fg-soft);
  font-size: 12px;
}

.profile-metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.profile-metric--muted {
  color: var(--fg-faint);
}

.profile-metric .i-carbon-flash {
  color: #4f9ee8;
  font-size: 14px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #35c05a;
  box-shadow: 0 0 0 3px rgba(53, 192, 90, 0.2);
}

.status-dot--off {
  background: #cbd5cb;
  box-shadow: 0 0 0 3px rgba(148, 163, 148, 0.18);
}

.asset-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.asset-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 11px 12px 12px;
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 18px;
  font-family: inherit;
  text-align: left;
}

.dark .asset-card {
  border-color: rgba(255, 255, 255, 0.12);
}

.asset-card--gold {
  background: linear-gradient(135deg, rgba(255, 246, 214, 0.9), rgba(255, 227, 160, 0.66));
}

.asset-card--coupon {
  background: linear-gradient(135deg, rgba(224, 249, 235, 0.9), rgba(188, 235, 213, 0.64));
}

.asset-card--diamond {
  background: linear-gradient(135deg, rgba(226, 243, 255, 0.9), rgba(190, 223, 250, 0.64));
}

.asset-card--goldBean {
  background: linear-gradient(135deg, rgba(255, 239, 220, 0.9), rgba(255, 216, 178, 0.66));
}

.asset-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #4c5d51;
  font-size: 12px;
}

.asset-icon {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.72);
  font-size: 13px;
}

.asset-icon img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.asset-label {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-value {
  overflow: hidden;
  color: #2f4b38;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 0.3px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-card--gold .asset-value {
  color: #b97808;
}

.asset-card--coupon .asset-value {
  color: #1f8a55;
}

.asset-card--diamond .asset-value {
  color: #2472b5;
}

.asset-card--goldBean .asset-value {
  color: #c96c1c;
}

.asset-gain {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.run-card {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 148px;
  align-items: stretch;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  background: var(--glass-bg);
  color: var(--fg);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  backdrop-filter: blur(18px) saturate(150%);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.run-card:hover {
  box-shadow: 0 16px 34px rgba(25, 58, 36, 0.22);
  transform: translateY(-2px);
}

.run-left {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  padding: 16px 20px;
}

.run-badges {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-online {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #2f7d4c;
  font-size: 12px;
  font-weight: 600;
}

.run-badge {
  padding: 3px 9px;
  border: 1px solid rgba(58, 129, 71, 0.25);
  border-radius: 999px;
  background: var(--chip-bg);
  color: #3c6b49;
  font-size: 11px;
  font-weight: 600;
}

.run-time-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.run-clock {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #8ee06a, #4dc24c);
  color: #fff;
  font-size: 18px;
  box-shadow: 0 5px 14px rgba(72, 166, 71, 0.35);
}

.run-time {
  color: var(--fg-strong);
  font-size: clamp(28px, 4.4vw, 38px);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 2px;
  line-height: 1;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.65);
}

.run-caption {
  margin-top: 4px;
  margin-left: 44px;
  color: var(--fg-soft);
  font-size: 12px;
}

.run-art {
  position: relative;
  display: flex;
  width: 40%;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 14px 16px 14px 6px;
}

.run-art-frame {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  background-image: url('/game-config/scene_images/runtime-scene.png');
  background-position: 50% 62%;
  background-repeat: no-repeat;
  background-size: cover;
  box-shadow:
    0 6px 16px rgba(36, 68, 44, 0.2),
    inset 0 0 0 1px rgba(255, 255, 255, 0.45);
}

.run-enter {
  position: absolute;
  top: 50%;
  right: 14px;
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  color: #4b6b56;
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(36, 68, 44, 0.2);
  transform: translateY(-50%);
}

.feature-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.feature-card {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 18px;
  color: var(--fg);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.feature-card:hover {
  box-shadow: 0 10px 24px rgba(27, 60, 37, 0.18);
  transform: translateY(-2px);
}

.feature-icon {
  display: inline-flex;
  width: 42px;
  height: 42px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  background: var(--chip-bg);
  font-size: 22px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.feature-icon--illustrated {
  color: #4fa53a;
}

.feature-icon--pet {
  color: #d9922f;
}

.feature-icon--friends {
  color: #4b8fd8;
}

.feature-icon--shop {
  color: #d0813a;
}

.feature-icon--activity {
  color: #d96a9a;
}

.feature-icon--analytics {
  color: #3b9a8c;
}

.feature-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.feature-copy strong {
  overflow: hidden;
  color: var(--fg-strong);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feature-copy small {
  overflow: hidden;
  color: var(--fg-soft);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feature-arrow {
  flex: none;
  color: var(--fg-faint);
  font-size: 16px;
}

.supply-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.supply-card {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 16px;
  color: var(--fg);
}

.supply-left {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.supply-icon {
  width: 18px;
  height: 18px;
  flex: none;
  object-fit: contain;
}

.supply-label {
  overflow: hidden;
  color: var(--fg-soft);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.supply-value {
  flex: none;
  color: var(--fg-strong);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.insight-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.insight-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 16px 18px;
  color: var(--fg);
}

.insight-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.insight-icon {
  display: inline-flex;
  width: 38px;
  height: 38px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--chip-bg);
  font-size: 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.insight-icon--time {
  color: #2563eb;
}

.insight-icon--stats {
  color: #d9821f;
}

.insight-heading {
  min-width: 0;
}

.insight-heading h2 {
  margin: 0;
  color: var(--fg-strong);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.insight-heading p {
  margin: 3px 0 0;
  overflow: hidden;
  color: var(--fg-soft);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border-radius: 12px;
  background: var(--soft-bg);
}

.check-icon {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--chip-bg);
  font-size: 14px;
}

.check-icon--farm {
  color: #3f9e4d;
}

.check-icon--help {
  color: #3a8fc4;
}

.check-icon--steal {
  color: #e0821f;
}

.check-label {
  color: var(--fg-soft);
  font-size: 13px;
}

.check-value {
  margin-left: auto;
  color: var(--fg);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.insight-empty {
  padding: 18px 0;
  color: var(--fg-faint);
  font-size: 13px;
  text-align: center;
}

.operation-grid {
  display: grid;
  max-height: 168px;
  gap: 6px;
  overflow-y: auto;
  padding-right: 3px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  scrollbar-color: rgba(93, 128, 99, 0.45) transparent;
  scrollbar-width: thin;
}

.operation-chip {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--soft-bg);
  font-size: 11px;
}

.operation-icon {
  flex: none;
  font-size: 13px;
}

.operation-label {
  overflow: hidden;
  color: var(--fg-soft);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-value {
  margin-left: auto;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.session-gains {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(59, 92, 57, 0.12);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.gain-title {
  margin: 0;
  color: var(--fg-faint);
  font-size: 10px;
  grid-column: 1 / -1;
  letter-spacing: 0.4px;
}

.gain-item {
  padding: 6px 4px;
  border-radius: 10px;
  background: var(--soft-bg);
  text-align: center;
}

.gain-item span {
  display: block;
  color: var(--fg-faint);
  font-size: 10px;
}

.gain-item strong {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.gain--positive {
  color: #2f9e4d;
}

.gain--negative {
  color: #d24b44;
}

.gain--neutral {
  color: var(--fg-soft);
}

.log-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  color: var(--fg);
}

.log-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.log-title {
  min-width: 0;
}

.log-title-main h2 {
  margin: 0;
  color: var(--fg-strong);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
}

.log-title-main p {
  margin: 5px 0 0;
  color: var(--fg-soft);
  font-size: 11px;
}

.log-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.log-filter-control {
  width: 118px;
  flex: none;
}

.log-filter-control--keyword {
  width: 150px;
}

.log-body {
  display: flex;
  min-height: 0;
  align-items: center;
  gap: 12px;
}

.log-list {
  display: flex;
  min-width: 0;
  max-height: 214px;
  min-height: 120px;
  flex: 1;
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-color: rgba(93, 128, 99, 0.45) transparent;
  scrollbar-width: thin;
}

.log-list::-webkit-scrollbar {
  width: 5px;
}

.log-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(93, 128, 99, 0.45);
}

.log-empty {
  padding: 26px 0;
  color: var(--fg-faint);
  font-size: 13px;
  text-align: center;
}

.log-line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border-radius: 10px;
  background: var(--soft-bg);
  font-size: 12px;
  line-height: 1.4;
  content-visibility: auto;
  contain-intrinsic-size: auto 28px;
}

.log-time {
  flex: none;
  color: var(--fg-faint);
  font-variant-numeric: tabular-nums;
}

.log-tag {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
}

.log-event {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(212, 236, 253, 0.9);
  color: #2f70ad;
  font-size: 10px;
  font-weight: 700;
}

.log-msg {
  min-width: 0;
  overflow: hidden;
  color: var(--fg);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-repeat {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--fg-soft);
  font-size: 10px;
  font-weight: 700;
}

.log-latest {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(96, 165, 250, 0.95), rgba(37, 99, 235, 0.95));
  color: #fff;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.log-latest:hover {
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.45);
  transform: translateY(-1px);
}

@media (max-width: 639px) {
  .insight-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
