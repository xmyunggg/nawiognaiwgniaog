<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const toast = useToastStore()
const userStore = useUserStore()

interface AgentSelf {
  username: string
  enabled: boolean
  note: string
  quotaTotal: number
  quotaDaily: number
  usedTotal: number
  usedDaily: number
  remainingTotal: number
  remainingDaily: number
  balance: number
}

interface AgentCard {
  code: string
  description?: string
  type: 'time' | 'quota'
  enabled: boolean
  usedBy: string | null
  usedAt: number | null
  createdAt: number
}

interface AgentCustomer {
  username: string
  accountLimit: number
  createdAt: number | null
  card: { expiresAt: number | null, enabled: boolean, days?: number, isPermanent?: boolean } | null
}

interface AgentSpec {
  id: string
  name: string
  type: 'time' | 'quota'
  price: number
  durationText: string
  accountLimit: number
}

const self = ref<AgentSelf | null>(null)
const specs = ref<AgentSpec[]>([])
const cards = ref<AgentCard[]>([])
const customers = ref<AgentCustomer[]>([])
const loading = ref(true)
const generating = ref(false)

const selectedSpecId = ref('')
const generateCount = ref(1)
const generatedCodes = ref<string[]>([])

const rechargeCode = ref('')
const recharging = ref(false)
const rechargeRecords = ref<Array<{ code: string, amount: number, usedAt: number | null }>>([])

const activeSection = ref<'generate' | 'cards' | 'customers'>('generate')

const selectedSpec = computed(() => specs.value.find(spec => spec.id === selectedSpecId.value) || null)
const estimatedCost = computed(() => {
  if (!selectedSpec.value)
    return 0
  return selectedSpec.value.price * Math.max(1, Number(generateCount.value) || 1)
})

function quotaText(value: number) {
  return value < 0 ? '不限' : String(value)
}

function formatTime(value?: number | null) {
  if (!value)
    return '-'
  return new Date(value).toLocaleString('zh-CN')
}

async function loadAll() {
  loading.value = true
  try {
    const [selfRes, specsRes, cardsRes, customersRes, rechargeRes] = await Promise.all([
      api.get('/api/agent/me'),
      api.get('/api/agent/specs'),
      api.get('/api/agent/cards'),
      api.get('/api/agent/customers'),
      api.get('/api/agent/recharge-records'),
    ])
    if (selfRes.data?.ok)
      self.value = selfRes.data.data
    if (specsRes.data?.ok) {
      specs.value = specsRes.data.data || []
      if (!selectedSpecId.value && specs.value.length > 0)
        selectedSpecId.value = specs.value[0].id
    }
    if (cardsRes.data?.ok)
      cards.value = cardsRes.data.data || []
    if (customersRes.data?.ok)
      customers.value = customersRes.data.data || []
    if (rechargeRes.data?.ok)
      rechargeRecords.value = rechargeRes.data.data || []
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e.message || '加载代理数据失败')
  }
  finally {
    loading.value = false
  }
}

async function generateCards() {
  if (!selectedSpecId.value) {
    toast.warning('请选择发卡规格')
    return
  }
  const count = Math.max(1, Math.min(100, Math.floor(Number(generateCount.value) || 1)))
  generating.value = true
  try {
    const { data } = await api.post('/api/agent/cards', {
      specId: selectedSpecId.value,
      count,
    })
    if (data?.ok) {
      generatedCodes.value = (data.data.cards || []).map((card: AgentCard) => card.code)
      if (data.data.agent)
        self.value = data.data.agent
      toast.success(`已生成 ${generatedCodes.value.length} 张卡密，消耗 ${data.data.cost || 0} 元`)
      const cardsRes = await api.get('/api/agent/cards')
      if (cardsRes.data?.ok)
        cards.value = cardsRes.data.data || []
    }
    else {
      toast.error(data?.error || '发卡失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e.message || '发卡失败')
  }
  finally {
    generating.value = false
  }
}

async function redeemRecharge() {
  const code = rechargeCode.value.trim()
  if (!code) {
    toast.warning('请输入充值卡号')
    return
  }
  recharging.value = true
  try {
    const { data } = await api.post('/api/agent/recharge', { code })
    if (data?.ok) {
      rechargeCode.value = ''
      if (data.data.agent)
        self.value = data.data.agent
      toast.success(`充值成功，到账 ${data.data.amount} 元`)
      const rechargeRes = await api.get('/api/agent/recharge-records')
      if (rechargeRes.data?.ok)
        rechargeRecords.value = rechargeRes.data.data || []
    }
    else {
      toast.error(data?.error || '充值失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e.message || '充值失败')
  }
  finally {
    recharging.value = false
  }
}

async function copyText(text: string, label = '已复制') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
  }
  catch {
    toast.error('复制失败，请手动选择复制')
  }
}

async function logout() {
  try {
    await userStore.logout()
  }
  catch {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('user_info')
  }
  window.location.href = '/login'
}

onMounted(loadAll)
</script>

<template>
  <div class="agent-portal min-h-screen">
    <header class="agent-header">
      <div class="flex items-center gap-3">
        <div class="i-carbon-store text-2xl text-emerald-500" />
        <div>
          <h1 class="text-lg text-gray-900 font-extrabold dark:text-gray-100">
            代理中心
          </h1>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            发卡、客户与余额管理
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="self" class="text-sm text-gray-600 dark:text-gray-300">
          {{ self.username }}
        </span>
        <BaseButton variant="secondary" size="sm" @click="logout">
          退出登录
        </BaseButton>
      </div>
    </header>

    <main class="mx-auto max-w-6xl px-4 py-5">
      <div v-if="loading" class="py-16 text-center text-gray-500">
        <div class="i-svg-spinners-90-ring-with-bg inline-block text-3xl" />
        <p class="mt-3 text-sm">
          正在加载代理数据…
        </p>
      </div>

      <template v-else>
        <!-- 概览卡片 -->
        <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="agent-card">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              账户余额
            </p>
            <p class="mt-1 text-2xl text-emerald-600 font-bold dark:text-emerald-400">
              {{ self?.balance ?? 0 }} <span class="text-sm font-normal">元</span>
            </p>
          </div>
          <div class="agent-card">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              总额度剩余
            </p>
            <p class="mt-1 text-2xl text-blue-600 font-bold dark:text-blue-400">
              {{ quotaText(self?.remainingTotal ?? -1) }}
              <span class="text-sm text-gray-400 font-normal">/ {{ quotaText(self?.quotaTotal ?? -1) }}</span>
            </p>
          </div>
          <div class="agent-card">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              今日额度剩余
            </p>
            <p class="mt-1 text-2xl text-amber-600 font-bold dark:text-amber-400">
              {{ quotaText(self?.remainingDaily ?? -1) }}
              <span class="text-sm text-gray-400 font-normal">/ {{ quotaText(self?.quotaDaily ?? -1) }}</span>
            </p>
          </div>
          <div class="agent-card">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              已发卡 / 客户
            </p>
            <p class="mt-1 text-2xl text-gray-900 font-bold dark:text-gray-100">
              {{ cards.length }} <span class="text-sm text-gray-400 font-normal">/ {{ customers.length }}</span>
            </p>
          </div>
        </section>

        <!-- 充值 -->
        <section class="agent-card mt-4">
          <h2 class="agent-section-title">
            余额充值
          </h2>
          <div class="mt-2 flex flex-col gap-2 sm:flex-row">
            <BaseInput v-model="rechargeCode" placeholder="输入充值卡号" class="flex-1" />
            <BaseButton variant="primary" :loading="recharging" @click="redeemRecharge">
              立即充值
            </BaseButton>
          </div>
          <p v-if="rechargeRecords.length" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            最近充值：{{ rechargeRecords.slice(0, 3).map(r => `${r.amount} 元`).join('、') }}
          </p>
        </section>

        <!-- 分段导航 -->
        <nav class="mt-4 flex gap-2">
          <button
            v-for="tab in [
              { key: 'generate', label: '发卡' },
              { key: 'cards', label: '我的卡密' },
              { key: 'customers', label: '我的客户' },
            ]"
            :key="tab.key"
            class="rounded-lg px-3 py-1.5 text-xs font-medium transition"
            :class="activeSection === tab.key
              ? 'bg-emerald-600 text-white'
              : 'bg-white/70 text-gray-600 hover:bg-white dark:bg-gray-800/60 dark:text-gray-300'"
            @click="activeSection = tab.key as any"
          >
            {{ tab.label }}
          </button>
        </nav>

        <!-- 发卡 -->
        <section v-if="activeSection === 'generate'" class="agent-card mt-3">
          <h2 class="agent-section-title">
            自助发卡
          </h2>

          <div v-if="specs.length === 0" class="mt-3 text-sm text-gray-500 dark:text-gray-400">
            管理员还没有为你分配可用的发卡规格，请联系管理员。
          </div>
          <template v-else>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1.5">
                <label class="text-sm text-gray-700 font-medium dark:text-gray-300">发卡规格</label>
                <select v-model="selectedSpecId" class="agent-select">
                  <option v-for="spec in specs" :key="spec.id" :value="spec.id">
                    {{ spec.name }} · {{ spec.durationText }} · {{ spec.price > 0 ? `${spec.price} 元/张` : '免费' }}
                  </option>
                </select>
              </div>
              <BaseInput v-model.number="generateCount" type="number" min="1" max="100" label="数量" />
            </div>

            <p class="mt-3 text-sm text-gray-600 dark:text-gray-300">
              预计消耗 <span class="text-emerald-600 font-bold">{{ estimatedCost }}</span> 元，
              当前余额 {{ self?.balance ?? 0 }} 元。
            </p>

            <div class="mt-3">
              <BaseButton variant="primary" :loading="generating" @click="generateCards">
                生成卡密
              </BaseButton>
            </div>

            <div v-if="generatedCodes.length" class="mt-4 border border-emerald-200 rounded-lg bg-emerald-50/70 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
              <div class="mb-2 flex items-center justify-between">
                <p class="text-xs text-emerald-800 dark:text-emerald-300">
                  本次生成 {{ generatedCodes.length }} 张：
                </p>
                <BaseButton variant="text" size="sm" @click="copyText(generatedCodes.join('\n'), '已复制全部卡密')">
                  复制全部
                </BaseButton>
              </div>
              <p
                v-for="code in generatedCodes"
                :key="code"
                class="cursor-pointer font-mono text-sm text-gray-800 hover:text-emerald-700 dark:text-gray-200"
                @click="copyText(code)"
              >
                {{ code }}
              </p>
            </div>
          </template>
        </section>

        <!-- 我的卡密 -->
        <section v-else-if="activeSection === 'cards'" class="agent-card mt-3">
          <h2 class="agent-section-title">
            我的卡密
            <span class="ml-2 text-xs text-gray-500 font-normal">共 {{ cards.length }} 张</span>
          </h2>

          <p v-if="cards.length === 0" class="mt-3 text-sm text-gray-500 dark:text-gray-400">
            还没有发过卡。
          </p>
          <div v-else class="mt-3 max-h-[60vh] overflow-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-700">
                  <th class="px-2 py-2 font-medium">卡密</th>
                  <th class="px-2 py-2 font-medium">描述</th>
                  <th class="px-2 py-2 font-medium">状态</th>
                  <th class="px-2 py-2 font-medium">使用人</th>
                  <th class="px-2 py-2 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="card in cards" :key="card.code" class="border-b border-gray-100 last:border-0 dark:border-gray-700/50">
                  <td class="cursor-pointer px-2 py-2 font-mono text-xs" @click="copyText(card.code)">
                    {{ card.code }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ card.description || '-' }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    <span :class="card.usedBy ? 'text-gray-500' : 'text-emerald-600 font-medium'">
                      {{ card.usedBy ? '已使用' : (card.enabled ? '未使用' : '已禁用') }}
                    </span>
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ card.usedBy || '-' }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ formatTime(card.createdAt) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 我的客户 -->
        <section v-else class="agent-card mt-3">
          <h2 class="agent-section-title">
            我的客户
            <span class="ml-2 text-xs text-gray-500 font-normal">共 {{ customers.length }} 位</span>
          </h2>

          <p v-if="customers.length === 0" class="mt-3 text-sm text-gray-500 dark:text-gray-400">
            使用你发出的卡密注册的用户会出现在这里。
          </p>
          <div v-else class="mt-3 max-h-[60vh] overflow-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-700">
                  <th class="px-2 py-2 font-medium">客户</th>
                  <th class="px-2 py-2 font-medium">账号额度</th>
                  <th class="px-2 py-2 font-medium">到期</th>
                  <th class="px-2 py-2 font-medium">注册时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="customer in customers" :key="customer.username" class="border-b border-gray-100 last:border-0 dark:border-gray-700/50">
                  <td class="px-2 py-2">
                    {{ customer.username }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ customer.accountLimit }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ customer.card?.isPermanent ? '永久' : (customer.card?.expiresAt ? formatTime(customer.card.expiresAt) : '未激活') }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ formatTime(customer.createdAt) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.agent-portal {
  background:
    radial-gradient(circle at 12% 8%, rgba(134, 239, 172, 0.28), transparent 45%),
    radial-gradient(circle at 88% 4%, rgba(147, 197, 253, 0.28), transparent 42%),
    #f4f8f5;
}

:global(.dark) .agent-portal {
  background:
    radial-gradient(circle at 12% 8%, rgba(16, 185, 129, 0.16), transparent 45%),
    radial-gradient(circle at 88% 4%, rgba(59, 130, 246, 0.16), transparent 42%),
    #0f172a;
}

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.78);
  padding: 12px 20px;
  backdrop-filter: blur(10px);
}

:global(.dark) .agent-header {
  border-color: rgba(71, 85, 105, 0.5);
  background: rgba(15, 23, 42, 0.78);
}

.agent-card {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
  padding: 14px 16px;
  backdrop-filter: blur(8px);
}

:global(.dark) .agent-card {
  border-color: rgba(71, 85, 105, 0.6);
  background: rgba(30, 41, 59, 0.7);
}

.agent-section-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #1f2937;
}

:global(.dark) .agent-section-title {
  color: #e5e7eb;
}

.agent-select {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 8px;
  background: #fff;
  padding: 8px 12px;
  font-size: 14px;
  color: inherit;
  outline: none;
}

:global(.dark) .agent-select {
  border-color: rgba(71, 85, 105, 0.8);
  background: #0f172a;
}
</style>
