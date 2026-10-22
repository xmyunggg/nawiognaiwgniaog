<script setup lang="ts">
import { computed, onMounted } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { formatAgentPrice, formatAgentSpec, useAdminAgents } from '@/composables/useAdminAgents'

const {
  agents,
  specs,
  loading,
  searchQuery,
  filteredAgents,
  enabledCount,
  totalIssued,
  showAgentModal,
  agentForm,
  editingAgent,
  savingAgent,
  showSaveConfirm,
  showToggleConfirm,
  pendingToggle,
  toggleLoading,
  showDeleteConfirm,
  pendingDelete,
  deleteLoading,
  showCardsModal,
  cardsLoading,
  agentCards,
  cardsAgent,
  showCustomersModal,
  customersLoading,
  agentCustomers,
  customersAgent,
  showSpecModal,
  specForm,
  editingSpec,
  savingSpec,
  showSpecDeleteConfirm,
  pendingDeleteSpec,
  deletingSpec,
  rechargeCards,
  rechargeLoading,
  showRechargeModal,
  rechargeForm,
  savingRecharge,
  rechargeGenerated,
  showRechargeDeleteConfirm,
  pendingDeleteRecharge,
  deletingRecharge,
  fetchAgents,
  fetchSpecs,
  fetchRechargeCards,
  openCreateAgent,
  openEditAgent,
  requestSaveAgent,
  confirmSaveAgent,
  requestToggleAgent,
  confirmToggleAgent,
  requestDeleteAgent,
  confirmDeleteAgent,
  openAgentCards,
  openAgentCustomers,
  openSpecModal,
  openEditSpec,
  requestSaveSpec,
  saveSpec,
  toggleSpec,
  requestDeleteSpec,
  confirmDeleteSpec,
  openRechargeModal,
  saveRechargeCards,
  requestDeleteRechargeCard,
  confirmDeleteRechargeCard,
} = useAdminAgents()

const quotaText = (value: number) => (value < 0 ? '不限' : String(value))

function cardStatusText(card: { usedBy: string | null, enabled: boolean }) {
  if (card.usedBy) return '已使用'
  return card.enabled ? '未使用' : '已禁用'
}

function formatTime(value?: number | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

const specLabelMap = computed(() => {
  const map: Record<string, string> = {}
  for (const spec of specs.value)
    map[spec.id] = spec.name
  return map
})

function specNames(agent: { specIds: string[] | null }) {
  if (!Array.isArray(agent.specIds) || agent.specIds.length === 0)
    return '全部规格'
  return agent.specIds.map(id => specLabelMap.value[id] || id).join('、')
}

onMounted(async () => {
  await Promise.all([fetchAgents(), fetchSpecs(), fetchRechargeCards()])
})
</script>

<template>
  <div class="space-y-4">
    <!-- 概览 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
          代理管理
        </h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          代理拥有独立登录入口，仅能发卡与查看自己的客户，无法访问其他后台功能。
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <BaseButton variant="secondary" size="sm" @click="openSpecModal">
          <div class="i-carbon-catalog mr-1" />
          <span>新增规格</span>
        </BaseButton>
        <BaseButton variant="primary" size="sm" @click="openCreateAgent">
          <div class="i-carbon-add mr-1" />
          <span>新增代理</span>
        </BaseButton>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="border border-gray-200/80 rounded-xl bg-white/80 p-3 dark:border-gray-700/80 dark:bg-gray-800/60">
        <p class="text-xs text-gray-500 dark:text-gray-400">代理总数</p>
        <p class="mt-1 text-xl text-gray-900 font-bold dark:text-gray-100">{{ agents.length }}</p>
      </div>
      <div class="border border-gray-200/80 rounded-xl bg-white/80 p-3 dark:border-gray-700/80 dark:bg-gray-800/60">
        <p class="text-xs text-gray-500 dark:text-gray-400">启用中</p>
        <p class="mt-1 text-xl text-emerald-600 font-bold dark:text-emerald-400">{{ enabledCount }}</p>
      </div>
      <div class="border border-gray-200/80 rounded-xl bg-white/80 p-3 dark:border-gray-700/80 dark:bg-gray-800/60">
        <p class="text-xs text-gray-500 dark:text-gray-400">累计发卡</p>
        <p class="mt-1 text-xl text-blue-600 font-bold dark:text-blue-400">{{ totalIssued }}</p>
      </div>
      <div class="border border-gray-200/80 rounded-xl bg-white/80 p-3 dark:border-gray-700/80 dark:bg-gray-800/60">
        <p class="text-xs text-gray-500 dark:text-gray-400">发卡规格</p>
        <p class="mt-1 text-xl text-gray-900 font-bold dark:text-gray-100">{{ specs.length }}</p>
      </div>
    </div>

    <!-- 代理列表 -->
    <div class="border border-gray-200/80 rounded-xl bg-white/80 dark:border-gray-700/80 dark:bg-gray-800/60">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-3 dark:border-gray-700/60">
        <h4 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
          代理列表
        </h4>
        <BaseInput v-model="searchQuery" placeholder="搜索代理用户名" clearable class="w-full sm:w-56" />
      </div>

      <div v-if="loading" class="p-8 text-center text-gray-500">
        <div class="i-svg-spinners-90-ring-with-bg inline-block text-2xl" />
      </div>
      <div v-else-if="filteredAgents.length === 0" class="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        暂无代理，点击右上角「新增代理」创建。
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[880px] text-sm">
          <thead>
            <tr class="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-700/60 dark:text-gray-400">
              <th class="px-3 py-2 font-medium">代理</th>
              <th class="px-3 py-2 font-medium">状态</th>
              <th class="px-3 py-2 font-medium">总额度</th>
              <th class="px-3 py-2 font-medium">今日额度</th>
              <th class="px-3 py-2 font-medium">余额</th>
              <th class="px-3 py-2 font-medium">可用规格</th>
              <th class="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="agent in filteredAgents"
              :key="agent.username"
              class="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 dark:border-gray-700/40 dark:hover:bg-gray-700/20"
            >
              <td class="px-3 py-2.5">
                <p class="text-gray-900 font-semibold dark:text-gray-100">
                  {{ agent.username }}
                </p>
                <p v-if="agent.note" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {{ agent.note }}
                </p>
              </td>
              <td class="px-3 py-2.5">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="agent.enabled
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'"
                >
                  {{ agent.enabled ? '启用' : '停用' }}
                </span>
              </td>
              <td class="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                {{ quotaText(agent.remainingTotal) }}
                <span class="text-xs text-gray-400">/ {{ quotaText(agent.quotaTotal) }}</span>
              </td>
              <td class="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                {{ quotaText(agent.remainingDaily) }}
                <span class="text-xs text-gray-400">/ {{ quotaText(agent.quotaDaily) }}</span>
              </td>
              <td class="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                {{ agent.balance }} 元
              </td>
              <td class="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400">
                {{ specNames(agent) }}
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap justify-end gap-1">
                  <BaseButton variant="text" size="sm" @click="openAgentCards(agent)">
                    卡密
                  </BaseButton>
                  <BaseButton variant="text" size="sm" @click="openAgentCustomers(agent)">
                    客户
                  </BaseButton>
                  <BaseButton variant="text" size="sm" @click="openEditAgent(agent)">
                    编辑
                  </BaseButton>
                  <BaseButton variant="text" size="sm" @click="requestToggleAgent(agent)">
                    {{ agent.enabled ? '停用' : '启用' }}
                  </BaseButton>
                  <BaseButton variant="text" size="sm" class="!text-red-600" @click="requestDeleteAgent(agent)">
                    删除
                  </BaseButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 发卡规格 -->
    <div class="border border-gray-200/80 rounded-xl bg-white/80 dark:border-gray-700/80 dark:bg-gray-800/60">
      <div class="flex items-center justify-between border-b border-gray-100 p-3 dark:border-gray-700/60">
        <h4 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
          发卡规格
        </h4>
        <BaseButton variant="secondary" size="sm" @click="openSpecModal">
          新增规格
        </BaseButton>
      </div>

      <div v-if="specs.length === 0" class="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
        还没有规格。规格决定代理发出的卡密是「时长」还是「额度」，以及单价。
      </div>
      <div v-else class="divide-y divide-gray-50 dark:divide-gray-700/40">
        <div
          v-for="spec in specs"
          :key="spec.id"
          class="flex flex-wrap items-center justify-between gap-2 p-3"
        >
          <div class="min-w-0">
            <p class="text-sm text-gray-900 font-semibold dark:text-gray-100">
              {{ spec.name }}
              <span
                class="ml-1 rounded px-1.5 py-0.5 text-[11px] font-normal"
                :class="spec.enabled
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'"
              >
                {{ spec.enabled ? '启用' : '停用' }}
              </span>
            </p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ formatAgentSpec(spec) }} · {{ formatAgentPrice(spec.price) }}
              <span v-if="spec.accountLimit"> · 额度 {{ spec.accountLimit }}</span>
            </p>
          </div>
          <div class="flex gap-1">
            <BaseButton variant="text" size="sm" @click="openEditSpec(spec)">
              编辑
            </BaseButton>
            <BaseButton variant="text" size="sm" @click="toggleSpec(spec)">
              {{ spec.enabled ? '停用' : '启用' }}
            </BaseButton>
            <BaseButton variant="text" size="sm" class="!text-red-600" @click="requestDeleteSpec(spec)">
              删除
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 代理充值卡 -->
    <div class="border border-gray-200/80 rounded-xl bg-white/80 dark:border-gray-700/80 dark:bg-gray-800/60">
      <div class="flex items-center justify-between border-b border-gray-100 p-3 dark:border-gray-700/60">
        <div>
          <h4 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
            代理充值卡
          </h4>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            代理充值后可在代理中心用余额发卡。
          </p>
        </div>
        <BaseButton variant="secondary" size="sm" @click="openRechargeModal">
          生成充值卡
        </BaseButton>
      </div>

      <div v-if="rechargeLoading" class="p-6 text-center text-gray-500">
        <div class="i-svg-spinners-90-ring-with-bg inline-block text-2xl" />
      </div>
      <div v-else-if="rechargeCards.length === 0" class="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
        暂无充值卡。
      </div>
      <div v-else class="max-h-72 divide-y divide-gray-50 overflow-y-auto dark:divide-gray-700/40">
        <div
          v-for="card in rechargeCards"
          :key="card.code"
          class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <div class="min-w-0">
            <p class="font-mono text-sm text-gray-800 dark:text-gray-200">
              {{ card.code }}
            </p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ card.amount }} 元 · {{ card.usedBy ? `已被 ${card.usedBy} 使用` : '未使用' }}
            </p>
          </div>
          <BaseButton
            v-if="!card.usedBy"
            variant="text"
            size="sm"
            class="!text-red-600"
            @click="requestDeleteRechargeCard(card)"
          >
            删除
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- 代理编辑弹窗 -->
    <Teleport to="body">
      <div v-if="showAgentModal" class="admin-modal-mask" @click.self="showAgentModal = false">
        <div class="admin-modal-panel">
          <h3 class="mb-4 text-lg text-gray-900 font-bold dark:text-gray-100">
            {{ editingAgent ? '编辑代理' : '新增代理' }}
          </h3>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BaseInput v-model="agentForm.username" label="代理用户名" placeholder="字母/数字/下划线" />
            <BaseInput
              v-model="agentForm.password"
              type="password"
              :label="editingAgent ? '重置密码（留空不改）' : '登录密码'"
              placeholder="至少 1 位"
            />
            <BaseInput v-model="agentForm.note" label="备注" placeholder="选填" />
            <BaseInput v-model.number="agentForm.balance" type="number" min="0" label="余额（元）" />

            <div class="flex flex-col gap-2">
              <BaseSwitch v-model="agentForm.unlimitedTotal" label="总额度不限" />
              <BaseInput
                v-if="!agentForm.unlimitedTotal"
                v-model.number="agentForm.quotaTotal"
                type="number"
                min="0"
                label="总额度（张）"
              />
            </div>
            <div class="flex flex-col gap-2">
              <BaseSwitch v-model="agentForm.unlimitedDaily" label="每日额度不限" />
              <BaseInput
                v-if="!agentForm.unlimitedDaily"
                v-model.number="agentForm.quotaDaily"
                type="number"
                min="0"
                label="每日额度（张）"
              />
            </div>
          </div>

          <div class="mt-3">
            <p class="mb-2 text-sm text-gray-700 font-medium dark:text-gray-300">
              可用发卡规格（不选表示全部）
            </p>
            <div v-if="specs.length === 0" class="text-xs text-gray-500 dark:text-gray-400">
              还没有规格，请先在上面创建。
            </div>
            <div v-else class="flex flex-wrap gap-2">
              <label
                v-for="spec in specs"
                :key="spec.id"
                class="flex cursor-pointer items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1 text-xs dark:border-gray-700"
                :class="agentForm.specIds.includes(spec.id)
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'text-gray-600 dark:text-gray-300'"
              >
                <input
                  v-model="agentForm.specIds"
                  type="checkbox"
                  :value="spec.id"
                  class="accent-emerald-600"
                >
                {{ spec.name }}
              </label>
            </div>
          </div>

          <div class="mt-3">
            <BaseSwitch v-model="agentForm.enabled" label="启用该代理账号" />
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <BaseButton variant="secondary" @click="showAgentModal = false">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="savingAgent" @click="requestSaveAgent">
              保存
            </BaseButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 规格弹窗 -->
    <Teleport to="body">
      <div v-if="showSpecModal" class="admin-modal-mask" @click.self="showSpecModal = false">
        <div class="admin-modal-panel">
          <h3 class="mb-4 text-lg text-gray-900 font-bold dark:text-gray-100">
            {{ editingSpec ? '编辑规格' : '新增规格' }}
          </h3>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BaseInput v-model="specForm.name" label="规格名称" placeholder="例如：7天卡" />
            <div class="flex flex-col gap-1.5">
              <label class="text-sm text-gray-700 font-medium dark:text-gray-300">类型</label>
              <select v-model="specForm.type" class="admin-select">
                <option value="time">时长卡</option>
                <option value="quota">额度卡</option>
              </select>
            </div>

            <template v-if="specForm.type === 'time'">
              <BaseInput
                v-if="!specForm.isPermanent"
                v-model.number="specForm.durationValue"
                type="number"
                min="1"
                label="时长"
              />
              <div class="flex flex-col gap-1.5">
                <label class="text-sm text-gray-700 font-medium dark:text-gray-300">单位</label>
                <select v-model="specForm.durationUnit" class="admin-select" :disabled="specForm.isPermanent">
                  <option value="day">天</option>
                  <option value="hour">小时</option>
                </select>
              </div>
              <div class="sm:col-span-2">
                <BaseSwitch v-model="specForm.isPermanent" label="永久有效" />
              </div>
            </template>
            <BaseInput
              v-else
              v-model.number="specForm.value"
              type="number"
              min="1"
              label="增加的账号额度"
            />

            <BaseInput
              v-model.number="specForm.accountLimit"
              type="number"
              min="0"
              label="账号数量限制（0=不限制）"
            />
            <BaseInput
              v-model.number="specForm.price"
              type="number"
              min="0"
              label="单价（元/张）"
            />
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <BaseButton variant="secondary" @click="showSpecModal = false">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="savingSpec" @click="requestSaveSpec">
              保存
            </BaseButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 充值卡生成 -->
    <Teleport to="body">
      <div v-if="showRechargeModal" class="admin-modal-mask" @click.self="showRechargeModal = false">
        <div class="admin-modal-panel">
          <h3 class="mb-4 text-lg text-gray-900 font-bold dark:text-gray-100">
            生成代理充值卡
          </h3>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BaseInput v-model.number="rechargeForm.amount" type="number" min="1" label="面额（元）" />
            <BaseInput v-model.number="rechargeForm.count" type="number" min="1" max="200" label="数量" />
            <BaseInput v-model="rechargeForm.description" label="备注" placeholder="选填" class="sm:col-span-2" />
          </div>

          <div v-if="rechargeGenerated.length" class="mt-4 max-h-52 overflow-y-auto border border-gray-200 rounded-lg bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
            <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
              已生成（可复制后交给代理）：
            </p>
            <p v-for="code in rechargeGenerated" :key="code" class="font-mono text-xs text-gray-800 dark:text-gray-200">
              {{ code }}
            </p>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <BaseButton variant="secondary" @click="showRechargeModal = false">
              关闭
            </BaseButton>
            <BaseButton variant="primary" :loading="savingRecharge" @click="saveRechargeCards">
              生成
            </BaseButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 代理卡密 -->
    <Teleport to="body">
      <div v-if="showCardsModal" class="admin-modal-mask" @click.self="showCardsModal = false">
        <div class="admin-modal-panel admin-modal-panel-wide">
          <h3 class="mb-1 text-lg text-gray-900 font-bold dark:text-gray-100">
            {{ cardsAgent?.username }} 的卡密
          </h3>
          <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
            共 {{ agentCards.length }} 张
          </p>

          <div v-if="cardsLoading" class="py-8 text-center text-gray-500">
            <div class="i-svg-spinners-90-ring-with-bg inline-block text-2xl" />
          </div>
          <div v-else-if="agentCards.length === 0" class="py-6 text-center text-sm text-gray-500">
            该代理还没有发过卡。
          </div>
          <div v-else class="max-h-[60vh] overflow-y-auto">
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
                <tr v-for="card in agentCards" :key="card.code" class="border-b border-gray-100 last:border-0">
                  <td class="px-2 py-2 font-mono text-xs">
                    {{ card.code }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ card.description || '-' }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ cardStatusText(card) }}
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

          <div class="mt-5 flex justify-end">
            <BaseButton variant="secondary" @click="showCardsModal = false">
              关闭
            </BaseButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 代理客户 -->
    <Teleport to="body">
      <div v-if="showCustomersModal" class="admin-modal-mask" @click.self="showCustomersModal = false">
        <div class="admin-modal-panel admin-modal-panel-wide">
          <h3 class="mb-1 text-lg text-gray-900 font-bold dark:text-gray-100">
            {{ customersAgent?.username }} 的客户
          </h3>
          <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
            共 {{ agentCustomers.length }} 位
          </p>

          <div v-if="customersLoading" class="py-8 text-center text-gray-500">
            <div class="i-svg-spinners-90-ring-with-bg inline-block text-2xl" />
          </div>
          <div v-else-if="agentCustomers.length === 0" class="py-6 text-center text-sm text-gray-500">
            该代理还没有归属客户。
          </div>
          <div v-else class="max-h-[60vh] overflow-y-auto">
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
                <tr v-for="customer in agentCustomers" :key="customer.username" class="border-b border-gray-100 last:border-0">
                  <td class="px-2 py-2">
                    {{ customer.username }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ customer.accountLimit }}
                  </td>
                  <td class="px-2 py-2 text-xs" :class="customer.card?.expiresAt && customer.card.expiresAt < Date.now() ? 'font-bold text-red-500' : ''">
                    {{ customer.card?.expiresAt ? (customer.card.expiresAt < Date.now() ? '已到期' : formatTime(customer.card.expiresAt)) : '永久/未激活' }}
                  </td>
                  <td class="px-2 py-2 text-xs">
                    {{ formatTime(customer.createdAt) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-5 flex justify-end">
            <BaseButton variant="secondary" @click="showCustomersModal = false">
              关闭
            </BaseButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 确认框 -->
    <ConfirmModal
      :show="showSaveConfirm"
      :title="editingAgent ? '保存代理修改' : '创建代理'"
      message="代理账号可独立登录代理中心并自助发卡，确定保存吗？"
      :loading="savingAgent"
      @confirm="confirmSaveAgent"
      @cancel="showSaveConfirm = false"
      @close="showSaveConfirm = false"
    />
    <ConfirmModal
      :show="showToggleConfirm"
      :title="pendingToggle?.enabled ? '停用代理' : '启用代理'"
      :message="pendingToggle?.enabled
        ? `停用后 ${pendingToggle?.username} 将立即被踢下线且无法发卡，确定吗？`
        : `确定要重新启用代理 ${pendingToggle?.username} 吗？`"
      :type="pendingToggle?.enabled ? 'danger' : 'primary'"
      :loading="toggleLoading"
      @confirm="confirmToggleAgent"
      @cancel="showToggleConfirm = false"
      @close="showToggleConfirm = false"
    />
    <ConfirmModal
      :show="showDeleteConfirm"
      title="删除代理"
      :message="`删除后 ${pendingDelete?.username} 将无法继续登录，但已发出的卡密仍保留。确定删除吗？`"
      type="danger"
      :loading="deleteLoading"
      @confirm="confirmDeleteAgent"
      @cancel="showDeleteConfirm = false"
      @close="showDeleteConfirm = false"
    />
    <ConfirmModal
      :show="showSpecDeleteConfirm"
      title="删除规格"
      :message="`确定删除规格「${pendingDeleteSpec?.name}」吗？已发出的卡密不受影响。`"
      type="danger"
      :loading="deletingSpec"
      @confirm="confirmDeleteSpec"
      @cancel="showSpecDeleteConfirm = false"
      @close="showSpecDeleteConfirm = false"
    />
    <ConfirmModal
      :show="showRechargeDeleteConfirm"
      title="删除充值卡"
      :message="`确定删除未使用的充值卡 ${pendingDeleteRecharge?.code} 吗？`"
      type="danger"
      :loading="deletingRecharge"
      @confirm="confirmDeleteRechargeCard"
      @cancel="showRechargeDeleteConfirm = false"
      @close="showRechargeDeleteConfirm = false"
    />
  </div>
</template>

<style scoped>
.admin-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 90000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.34);
  backdrop-filter: blur(4px);
}

.admin-modal-panel {
  width: min(100%, 620px);
  max-height: 88vh;
  overflow-y: auto;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 16px;
  background: #fff;
  padding: 22px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
}

.admin-modal-panel-wide {
  width: min(100%, 860px);
}

:global(.dark) .admin-modal-panel {
  border-color: rgba(71, 85, 105, 0.6);
  background: #1e293b;
}

.admin-select {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 8px;
  background: #fff;
  padding: 8px 12px;
  font-size: 14px;
  color: inherit;
  outline: none;
}

:global(.dark) .admin-select {
  border-color: rgba(71, 85, 105, 0.8);
  background: #0f172a;
}
</style>
