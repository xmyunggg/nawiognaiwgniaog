<script setup lang="ts">
const props = defineProps<{
  accountId?: string | number
}>()
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { formatCurrencyAmountByLabel, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'

const accountStore = useAccountStore()
const bagStore = useBagStore()
const statusStore = useStatusStore()
const toastStore = useToastStore()

const { currentAccountId } = storeToRefs(accountStore)
const { items, loading: bagLoading, originalItems } = storeToRefs(bagStore)
const { status, loading: statusLoading, error: statusError, realtimeConnected, currentStatusReady } = storeToRefs(statusStore)
const activeAccountId = computed(() => String(props.accountId || currentAccountId.value || ''))

const imageErrors = ref<Record<string | number, boolean>>({})
const bagLoaded = ref(false)

const CATEGORY_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '果实', value: 'fruit' },
  { label: '种子', value: 'seed' },
  { label: '道具', value: 'tool' },
  { label: '其他', value: 'other' },
] as const

type CategoryValue = typeof CATEGORY_OPTIONS[number]['value']

const selectedCategory = ref<CategoryValue>('fruit')

// 隔离的物品列表：优先从当前账号独立的背包槽位读取
const accountItems = computed(() => {
  const aid = activeAccountId.value
  if (aid && bagStore.bagsByAccount && bagStore.bagsByAccount[aid]) {
    const hiddenIds = new Set([1, 1001, 1002, 1101, 1011, 1012, 3001, 3002])
    return bagStore.bagsByAccount[aid].items.filter((it: any) => !hiddenIds.has(Number(it.id || 0)))
  }
  return items.value
})

const accountOriginalItems = computed(() => {
  const aid = activeAccountId.value
  if (aid && bagStore.bagsByAccount && bagStore.bagsByAccount[aid]) {
    return bagStore.bagsByAccount[aid].originalItems
  }
  return originalItems.value
})

function itemImage(item: any) {
  return item?.image || (Number(item?.id) === 6001 ? '/activity/wish-sign/firework.png' : '')
}

function itemType(item: any) {
  return Number(item?.itemType) || (Number(item?.id) === 6001 ? 23 : 0)
}

function getItemCategory(item: any): CategoryValue {
  if (item?.category === 'seed')
    return 'seed'
  if (item?.category === 'fruit')
    return 'fruit'
  const type = itemType(item)
  if (type === 17 || type === 6)
    return 'fruit'
  if (type === 5)
    return 'seed'
  if (type === 11 || Number(item?.id) === 6001)
    return 'tool'
  return 'other'
}

const filteredItems = computed(() => {
  if (selectedCategory.value === 'all')
    return items.value
  return accountItems.value.filter((item: any) => getItemCategory(item) === selectedCategory.value)
})

const categoryCounts = computed(() => {
  const counts: Record<CategoryValue, number> = { all: items.value.length, fruit: 0, seed: 0, tool: 0, other: 0 }
  for (const item of items.value) {
    const cat = getItemCategory(item)
    counts[cat]++
  }
  return counts
})

const confirmModal = ref({
  show: false,
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  loading: false,
  action: '' as 'sell' | 'use' | 'batchSell',
  item: null as any,
  selectedItems: [] as any[],
})

const batchMode = ref(false)
const selectedForBatch = ref<Set<number>>(new Set())
const batchSellResult = ref<{ gold: number, goldBean: number } | null>(null)
const quantityCount = ref(1)
const refreshing = ref(false)

const selectedSellableCount = computed(() => {
  return selectedForBatch.value.size
})

function getItemStacks(itemId: number | string) {
  return accountOriginalItems.value.filter(
    (it: any) => Number(it.id) === Number(itemId) && Number(it.count) > 0,
  )
}

const quantityMax = computed(() => {
  const item = confirmModal.value.item
  if (!item)
    return 1
  if (confirmModal.value.action === 'use' && Number(item.id) === 6001)
    return 1
  const stackTotal = getItemStacks(item.id)
    .reduce((sum: number, stack: any) => sum + Math.max(0, Number(stack.count) || 0), 0)
  return Math.max(1, stackTotal || Number(item.count) || 1)
})

const quantityValid = computed(() => {
  const count = Number(quantityCount.value)
  return Number.isInteger(count) && count >= 1 && count <= quantityMax.value
})

const quantityLabel = computed(() => confirmModal.value.action === 'sell' ? '出售数量' : '使用数量')

const sellEstimateText = computed(() => {
  if (confirmModal.value.action !== 'sell' || !confirmModal.value.item)
    return ''
  const price = Number(confirmModal.value.item.price) || 0
  if (price <= 0)
    return ''
  const count = quantityValid.value ? Number(quantityCount.value) : quantityMax.value
  const unit = confirmModal.value.item.priceUnit || '金'
  return `预计获得 ${formatCurrencyAmountByLabel(price * count, unit)}${unit}`
})

function clampQuantityCount() {
  const count = Math.trunc(Number(quantityCount.value) || 1)
  quantityCount.value = Math.min(quantityMax.value, Math.max(1, count))
}

function adjustQuantityCount(delta: number) {
  quantityCount.value = Math.min(quantityMax.value, Math.max(1, Math.trunc(Number(quantityCount.value) || 1) + delta))
}

function setQuantityCountAll() {
  quantityCount.value = quantityMax.value
}

function getPriceClass(item: any) {
  const priceId = Number(item?.priceId || 0)
  if (priceId === 1005)
    return 'text-amber-400 dark:text-amber-300'
  if (priceId === 1002)
    return 'text-sky-400 dark:text-sky-300'
  return 'text-gray-400'
}

function canSell(item: any) {
  const itemType = Number(item?.itemType || 0)
  return Boolean(item?.sellable) || itemType === 17 || itemType === 6
}

function canBatchSell(item: any) {
  return canSell(item) && Number(item.count || 0) > 0
}

function canUse(item: any) {
  return Boolean(item?.usable) || itemType(item) === 11 || Number(item?.id) === 6001
}

function handleSellClick(item: any) {
  if (batchMode.value) {
    const isSelected = selectedForBatch.value.has(Number(item.id))
    if (isSelected) {
      selectedForBatch.value.delete(Number(item.id))
    }
    else {
      selectedForBatch.value.add(Number(item.id))
    }
    return
  }
  const maxCount = Math.max(1, getItemStacks(item.id)
    .reduce((sum: number, stack: any) => sum + Math.max(0, Number(stack.count) || 0), 0) || Number(item.count) || 1)
  const price = Number(item.price) || 0
  const priceUnit = item.priceUnit || '金'
  const messages = [
    `当前拥有 ${maxCount} 个，请选择本次出售数量`,
  ]
  if (price > 0)
    messages.push(`单价：${formatCurrencyAmountByLabel(price, priceUnit)}${priceUnit}`)
  quantityCount.value = 1
  confirmModal.value = {
    show: true,
    title: `出售${item.name || `物品${item.id}`}`,
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'sell',
    item,
    selectedItems: [],
  }
}

function handleUseClick(item: any) {
  const maxCount = Number(item.id) === 6001
    ? 1
    : Math.max(1, getItemStacks(item.id).reduce((sum: number, stack: any) => sum + Math.max(0, Number(stack.count) || 0), 0) || Number(item.count) || 1)
  quantityCount.value = 1
  confirmModal.value = {
    show: true,
    title: `使用${item.name || `物品${item.id}`}`,
    message: `当前拥有 ${maxCount} 个，请选择本次使用数量`,
    type: 'primary',
    loading: false,
    action: 'use',
    item,
    selectedItems: [],
  }
}

async function handleConfirm() {
  const { action, item, selectedItems } = confirmModal.value
  if (!activeAccountId.value) {
    toastStore.warning('请先选择要操作的账号')
    return
  }
  if ((action === 'use' || action === 'sell') && !quantityValid.value) {
    toastStore.warning(`请输入 1 - ${quantityMax.value} 之间的整数`)
    return
  }

  confirmModal.value.loading = true
  try {
    if (action === 'sell' && item) {
      const requestedCount = Math.min(quantityMax.value, Math.max(1, Math.trunc(Number(quantityCount.value) || 1)))
      const stacks = getItemStacks(item.id)
      const sellItems: Array<{ id: number, count: number, uid: number }> = []
      let remaining = requestedCount

      // 同一物品可能按 UID 分成多个堆叠，按选择的出售数量逐个堆叠拆分。
      if (stacks.length === 0) {
        sellItems.push({ id: Number(item.id), count: requestedCount, uid: 0 })
      }
      else {
        for (const stack of stacks) {
          if (remaining <= 0)
            break
          const take = Math.min(Math.max(0, Number(stack.count) || 0), remaining)
          if (take <= 0)
            continue
          sellItems.push({
            id: Number(item.id),
            count: take,
            uid: Number(stack.uid) || 0,
          })
          remaining -= take
        }
      }

      if (sellItems.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const soldCount = sellItems.reduce((sum, stack) => sum + stack.count, 0)
      const res = await bagStore.sellItems(activeAccountId.value, sellItems)
      if (res.ok) {
        toastStore.success(`已出售 ${item.name || `物品${item.id}`} x${soldCount}`)
        await loadBag()
      }
      else {
        toastStore.error(`出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'batchSell' && selectedItems) {
      const itemsToSell = accountOriginalItems.value
        .filter((it: any) => selectedItems.some((si: any) => Number(si.id) === Number(it.id)))
        .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

      if (itemsToSell.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const res = await bagStore.sellItems(activeAccountId.value, itemsToSell)
      if (res.ok) {
        let totalGold = 0
        let totalGoldBean = 0
        for (const si of selectedItems) {
          const fi = filteredItems.value.find((f: any) => Number(f.id) === Number(si.id))
          if (fi) {
            const price = Number(fi.price) || 0
            const count = Number(fi.count) || 0
            const priceId = Number(fi.priceId) || 0
            if (priceId === 1005) {
              totalGoldBean += price * count
            }
            else {
              totalGold += price * count
            }
          }
        }
        batchSellResult.value = { gold: totalGold, goldBean: totalGoldBean }
        toastStore.success(`已批量出售 ${selectedItems.length} 种物品，获得 ${formatGoldAmount(totalGold)} 金币, ${formatGoldBeanAmount(totalGoldBean)} 金豆豆`)
        selectedForBatch.value.clear()
        batchMode.value = false
        await loadBag()
      }
      else {
        toastStore.error(`批量出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'use' && item) {
      const requestedCount = Number(item.id) === 6001
        ? 1
        : Math.min(quantityMax.value, Math.max(1, Math.trunc(Number(quantityCount.value) || 1)))
      const stacks = getItemStacks(item.id)
      let remaining = requestedCount
      let usedCount = 0
      let successMessage = ''

      // 同一物品可能按 UID 分成多个堆叠，按堆叠逐个使用，避免单次数量超过单个 UID 的库存。
      const useStack = async (count: number, uid: number) => {
        const res = await bagStore.useItem(activeAccountId.value, Number(item.id), count, uid)
        if (!res.ok) {
          if (usedCount > 0)
            await loadBag()
          toastStore.error(`使用失败: ${res.error || '未知错误'}`)
          return false
        }
        usedCount += Number(res.data?.usedCount ?? count) || 0
        successMessage = res.data?.message || successMessage
        return true
      }

      if (stacks.length === 0) {
        if (!(await useStack(requestedCount, 0)))
          return
      }
      else {
        for (const stack of stacks) {
          if (remaining <= 0)
            break
          const take = Math.min(Math.max(0, Number(stack.count) || 0), remaining)
          if (take <= 0)
            continue
          if (!(await useStack(take, Number(stack.uid) || 0)))
            return
          remaining -= take
        }
      }

      if (usedCount > 0 || successMessage) {
        toastStore.success(successMessage || `已使用 ${item.name || `物品${item.id}`} x${usedCount}`)
        await loadBag()
      }
      else {
        toastStore.error('使用失败: 未使用任何物品')
      }
    }
  }
  catch (e: any) {
    toastStore.error(`操作失败: ${e.message || '未知错误'}`)
  }
  finally {
    confirmModal.value.loading = false
    confirmModal.value.show = false
  }
}

function handleCancel() {
  confirmModal.value.show = false
}

function toggleBatchMode() {
  batchMode.value = !batchMode.value
  if (!batchMode.value) {
    selectedForBatch.value.clear()
    batchSellResult.value = null
  }
}

function selectAllSellable() {
  selectedForBatch.value.clear()
  for (const item of filteredItems.value) {
    if (canBatchSell(item)) {
      selectedForBatch.value.add(Number(item.id))
    }
  }
}

function handleBatchSellClick() {
  const sellableItems = filteredItems.value.filter((item: any) => canBatchSell(item))
  if (sellableItems.length === 0) {
    toastStore.warning('没有可批量出售的物品')
    return
  }
  const selectedList = Array.from(selectedForBatch.value)
  if (selectedList.length === 0) {
    toastStore.warning('请先选择要出售的物品')
    return
  }

  const itemsToSell = accountOriginalItems.value
    .filter((it: any) => selectedList.includes(Number(it.id)))
    .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

  let totalGold = 0
  let totalGoldBean = 0
  for (const it of itemsToSell) {
    const item = filteredItems.value.find((f: any) => Number(f.id) === Number(it.id))
    if (item) {
      const price = Number(item.price) || 0
      const count = Number(item.count) || 0
      const priceId = Number(item.priceId) || 0
      if (priceId === 1005) {
        totalGoldBean += price * count
      }
      else {
        totalGold += price * count
      }
    }
  }

  const messages = [
    `确定要批量出售选中的 ${selectedList.length} 种物品吗?`,
  ]
  if (totalGold > 0) {
    messages.push(`金币：${formatGoldAmount(totalGold)}`)
  }
  if (totalGoldBean > 0) {
    messages.push(`金豆豆：${formatGoldBeanAmount(totalGoldBean)}`)
  }

  confirmModal.value = {
    show: true,
    title: '批量出售',
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'batchSell',
    item: null,
    selectedItems: itemsToSell,
  }
}

async function loadBag() {
  const accountId = activeAccountId.value
  if (!accountId)
    return

  try {
    if (!realtimeConnected.value)
      await statusStore.fetchStatus(accountId)

    await bagStore.fetchBag(accountId)
  }
  finally {
    bagLoaded.value = true
  }

  imageErrors.value = {}
}

async function refreshBag() {
  if (!activeAccountId.value || refreshing.value)
    return
  refreshing.value = true
  try {
    await loadBag()
  }
  finally {
    refreshing.value = false
  }
}

const showInitialLoading = computed(() =>
  !bagLoaded.value && (bagLoading.value || statusLoading.value),
)

watch(activeAccountId, (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    bagLoaded.value = false
  }
  loadBag()
}, { immediate: true })

const targetAccountRunning = computed(() =>
  accountStore.accounts.find(acc => String(acc.id) === activeAccountId.value)?.running,
)

watch(targetAccountRunning, () => {
  loadBag()
})

useIntervalFn(() => {
  // 页面隐藏（切窗口 / 最小化）时跳过，避免回到前台时补打一次 /api/bag。
  if (document.visibilityState !== 'visible')
    return
  loadBag()
}, 60000)
</script>

<template>
  <div class="space-y-4">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-inventory-management" />
        背包
      </h2>
      <div class="flex items-center gap-3">
        <div v-if="items.length" class="text-sm text-gray-500">
          共 {{ items.length }} 种物品
        </div>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 font-medium shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          :disabled="!activeAccountId || refreshing"
          title="重新从服务器读取背包"
          @click="refreshBag"
        >
          <span :class="refreshing ? 'i-svg-spinners-ring-resize' : 'i-carbon-renew'" />
          {{ refreshing ? '刷新中' : '刷新背包' }}
        </button>
      </div>
    </div>

    <div v-if="showInitialLoading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看背包
    </div>

    <div v-else-if="statusError && items.length === 0" class="border border-red-200 rounded-lg bg-red-50 p-8 text-center text-red-500 shadow dark:border-red-800 dark:bg-red-900/20">
      <div class="mb-2 text-lg font-bold">
        获取数据失败
      </div>
      <div class="text-sm">
        {{ statusError }}
      </div>
    </div>

    <div v-else-if="currentStatusReady && !status?.connection?.connected && items.length === 0" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
      <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
      <div>
        <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
          账号未登录
        </div>
        <div class="mt-1 text-sm text-gray-400">
          请先运行账号或检查网络连接
        </div>
      </div>
    </div>

    <div v-else-if="items.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      无可展示物品
    </div>

    <div v-else>
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <button
          v-for="cat in CATEGORY_OPTIONS"
          :key="cat.value"
          class="rounded-lg px-3 py-1.5 text-sm font-medium transition"
          :class="selectedCategory === cat.value
            ? 'bg-blue-500 text-white dark:bg-blue-600'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
          @click="selectedCategory = cat.value"
        >
          {{ cat.label }}
          <span class="ml-1 text-xs opacity-70">({{ categoryCounts[cat.value] || 0 }})</span>
        </button>

        <div class="flex-1" />

        <template v-if="selectedCategory === 'fruit' || selectedCategory === 'all'">
          <button
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition"
            :class="batchMode
              ? 'bg-orange-500 text-white dark:bg-orange-600'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
            @click="toggleBatchMode"
          >
            <div v-if="batchMode" class="i-carbon-close mr-1 inline-block" />
            {{ batchMode ? '取消批量' : '批量出售' }}
          </button>
          <template v-if="batchMode">
            <button
              class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white font-medium transition dark:bg-blue-600 hover:bg-blue-600 dark:hover:bg-blue-700"
              @click="selectAllSellable"
            >
              全选
            </button>
            <button
              class="rounded-lg px-3 py-1.5 text-sm font-medium transition"
              :class="selectedSellableCount > 0
                ? 'bg-red-500 text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700'
                : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'"
              :disabled="selectedSellableCount === 0"
              @click="handleBatchSellClick"
            >
              出售 ({{ selectedSellableCount }})
            </button>
          </template>
        </template>
      </div>

      <div class="grid grid-cols-2 gap-4 lg:grid-cols-5 md:grid-cols-4 sm:grid-cols-3 xl:grid-cols-6">
        <div
          v-for="item in filteredItems"
          :key="item.id"
          class="group relative flex flex-col items-center border rounded-lg bg-white p-3 transition dark:border-gray-700 dark:bg-gray-800 hover:shadow-md"
          :class="{
            'ring-2 ring-orange-500 dark:ring-orange-400': batchMode && selectedForBatch.has(Number(item.id)),
            'opacity-50': batchMode && canBatchSell(item) && !selectedForBatch.has(Number(item.id)),
          }"
          @click="batchMode && canBatchSell(item) && handleSellClick(item)"
        >
          <div class="absolute left-2 top-2 text-xs text-gray-400 font-mono">
            #{{ item.id }}
          </div>

          <div class="absolute right-1 top-1 flex gap-1">
            <template v-if="!batchMode">
              <button
                v-if="canSell(item)"
                class="rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white opacity-70 transition dark:bg-red-600 hover:opacity-100"
                title="出售全部"
                @click.stop="handleSellClick(item)"
              >
                售
              </button>
              <button
                v-if="canUse(item)"
                class="rounded bg-green-500 px-1.5 py-0.5 text-[10px] text-white opacity-70 transition dark:bg-green-600 hover:opacity-100"
                :title="Number(item.id) === 6001 ? '使用一枚' : '使用全部'"
                @click.stop="handleUseClick(item)"
              >
                用
              </button>
            </template>
            <div
              v-else-if="canBatchSell(item)"
              class="h-5 w-5 flex items-center justify-center border-2 rounded transition"
              :class="selectedForBatch.has(Number(item.id))
                ? 'border-orange-500 bg-orange-500 text-white'
                : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700'"
            >
              <div v-if="selectedForBatch.has(Number(item.id))" class="i-carbon-checkmark text-xs" />
            </div>
          </div>

          <div
            class="thumb-wrap mb-2 mt-6 h-16 w-16 flex items-center justify-center rounded-full bg-gray-50 dark:bg-gray-700/50"
            :data-fallback="(item.name || '物').slice(0, 1)"
          >
            <img
              v-if="itemImage(item) && !imageErrors[item.id]"
              :src="itemImage(item)"
              :alt="item.name"
              class="max-h-full max-w-full object-contain"
              loading="lazy"
              @error="imageErrors[item.id] = true"
            >
            <div v-else class="text-2xl text-gray-400 font-bold uppercase">
              {{ (item.name || '物').slice(0, 1) }}
            </div>
          </div>

          <div class="mb-1 w-full flex items-center justify-center gap-1 px-2 text-center text-sm font-bold" :title="item.name">
            <span class="truncate">{{ item.name || `物品${item.id}` }}</span>
            <span
              v-if="getItemCategory(item) === 'seed' && Number(item.plantSize) === 2"
              class="shrink-0 border border-emerald-300 rounded bg-emerald-50 px-1 py-0.5 text-[10px] text-emerald-700 font-semibold leading-none dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              title="四格作物，占用 2×2 土地"
            >
              &lt;2x2&gt;
            </span>
          </div>

          <div class="mb-2 flex flex-col items-center gap-0.5 text-xs text-gray-400">
            <span v-if="item.uid">UID: {{ item.uid }}</span>
            <span>
              类型: {{ itemType(item) }}
              <span v-if="getItemCategory(item) === 'seed' && Number(item.rarity) >= 2"> · 稀有</span>
              <span v-else-if="item.level > 0"> · Lv{{ item.level }}</span>
              <span v-if="item.price > 0" :class="getPriceClass(item)"> · {{ item.price }}{{ item.priceUnit || '金' }}</span>
            </span>
          </div>

          <div class="mt-auto font-medium" :class="item.hoursText ? 'text-blue-500' : 'text-gray-600 dark:text-gray-300'">
            {{ item.hoursText || `x${item.count || 0}` }}
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="confirmModal.show"
      :title="confirmModal.title"
      :message="confirmModal.message"
      :type="confirmModal.type"
      :loading="confirmModal.loading"
      :confirm-text="confirmModal.action === 'sell' ? '确认出售' : confirmModal.action === 'batchSell' ? '确认出售' : '确认使用'"
      @confirm="handleConfirm"
      @close="handleCancel"
      @cancel="handleCancel"
    >
      <div v-if="confirmModal.action === 'use' || confirmModal.action === 'sell'" class="use-count-control">
        <label class="mb-2 block text-sm text-gray-600 font-medium dark:text-gray-300">{{ quantityLabel }}</label>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="use-count-button"
            :disabled="quantityCount <= 1 || confirmModal.loading"
            :aria-label="`减少${quantityLabel}`"
            @click="adjustQuantityCount(-1)"
          >
            −
          </button>
          <input
            v-model.number="quantityCount"
            type="number"
            min="1"
            :max="quantityMax"
            inputmode="numeric"
            class="h-10 min-w-0 flex-1 border border-gray-200 rounded-lg bg-white px-3 text-center text-base text-gray-800 font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            :disabled="confirmModal.loading"
            :aria-label="quantityLabel"
            @blur="clampQuantityCount"
          >
          <button
            type="button"
            class="use-count-button"
            :disabled="quantityCount >= quantityMax || confirmModal.loading"
            :aria-label="`增加${quantityLabel}`"
            @click="adjustQuantityCount(1)"
          >
            +
          </button>
          <button
            type="button"
            class="h-10 shrink-0 border border-gray-200 rounded-lg bg-gray-50 px-3 text-sm text-gray-600 font-medium transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            :disabled="quantityCount >= quantityMax || confirmModal.loading"
            @click="setQuantityCountAll"
          >
            全部
          </button>
        </div>
        <p v-if="!quantityValid" class="mt-2 text-xs text-red-500">
          请输入 1 - {{ quantityMax }} 之间的整数
        </p>
        <p v-else-if="sellEstimateText" class="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {{ sellEstimateText }}
        </p>
      </div>
    </ConfirmModal>
  </div>
</template>

<style scoped>
.use-count-control {
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.8);
}

.use-count-button {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(229, 231, 235);
  border-radius: 10px;
  background: #fff;
  color: rgb(55, 65, 81);
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  transition: background-color 0.16s ease, border-color 0.16s ease;
}

.use-count-button:hover:not(:disabled) {
  border-color: rgb(147, 197, 253);
  background: rgb(239, 246, 255);
}

.use-count-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

:global(.dark) .use-count-control {
  border-color: rgba(75, 85, 99, 0.6);
  background: rgba(31, 41, 55, 0.72);
}

:global(.dark) .use-count-button {
  border-color: rgb(75, 85, 99);
  background: rgb(55, 65, 81);
  color: rgb(229, 231, 235);
}

:global(.dark) .use-count-button:hover:not(:disabled) {
  border-color: rgb(96, 165, 250);
  background: rgb(30, 58, 95);
}

.thumb-wrap.fallback img {
  display: none;
}

.thumb-wrap.fallback::after {
  content: attr(data-fallback);
  font-size: 1.5rem;
  font-weight: bold;
  color: #9ca3af;
  text-transform: uppercase;
}
</style>
