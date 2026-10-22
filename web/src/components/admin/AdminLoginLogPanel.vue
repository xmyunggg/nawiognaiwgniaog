<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import {
  formatLogTime,
  getErrorTypeLabel,
  getEventLabel,
  parseBrowser,
  useAdminLoginLogs,
} from '@/composables/useAdminLoginLogs'

const {
  loginLogs,
  loginLogsLoading,
  loginLogsTotal,
  clearLogsLoading,
  loginSuccessCount,
  loginFailedCount,
  loginLogSummary,
  fetchLoginLogs,
  clearLoginLogs,
} = useAdminLoginLogs()

const showClearConfirm = ref(false)

type EventFilter = 'all' | 'login_success' | 'login_failed'
const eventFilter = ref<EventFilter>('all')

const filteredLogs = computed(() => {
  if (eventFilter.value === 'all')
    return loginLogs.value
  return loginLogs.value.filter(log => log.event === eventFilter.value)
})

async function refresh() {
  await fetchLoginLogs()
}

async function confirmClear() {
  const ok = await clearLoginLogs()
  if (ok)
    showClearConfirm.value = false
}

onMounted(refresh)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
          登录日志
        </h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          记录最近 {{ loginLogsTotal }} 条登录事件，用于排查异常登录。
        </p>
      </div>
      <div class="flex gap-2">
        <BaseButton variant="secondary" size="sm" :loading="loginLogsLoading" @click="refresh">
          刷新
        </BaseButton>
        <BaseButton
          variant="danger"
          size="sm"
          :disabled="loginLogsTotal === 0"
          @click="showClearConfirm = true"
        >
          清空日志
        </BaseButton>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div class="border border-gray-200/80 rounded-xl bg-white/80 p-3 dark:border-gray-700/80 dark:bg-gray-800/60">
        <p class="text-xs text-gray-500 dark:text-gray-400">总记录</p>
        <p class="mt-1 text-xl text-gray-900 font-bold dark:text-gray-100">{{ loginLogsTotal }}</p>
      </div>
      <div class="border border-gray-200/80 rounded-xl bg-white/80 p-3 dark:border-gray-700/80 dark:bg-gray-800/60">
        <p class="text-xs text-gray-500 dark:text-gray-400">成功</p>
        <p class="mt-1 text-xl text-emerald-600 font-bold dark:text-emerald-400">{{ loginSuccessCount }}</p>
      </div>
      <div class="border border-gray-200/80 rounded-xl bg-white/80 p-3 dark:border-gray-700/80 dark:bg-gray-800/60">
        <p class="text-xs text-gray-500 dark:text-gray-400">失败</p>
        <p class="mt-1 text-xl text-red-600 font-bold dark:text-red-400">{{ loginFailedCount }}</p>
      </div>
    </div>

    <div class="border border-gray-200/80 rounded-xl bg-white/80 px-4 py-3 text-sm text-gray-600 dark:border-gray-700/80 dark:bg-gray-800/60 dark:text-gray-300">
      {{ loginLogSummary }}
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="option in [
          { key: 'all', label: '全部' },
          { key: 'login_success', label: '登录成功' },
          { key: 'login_failed', label: '登录失败' },
        ]"
        :key="option.key"
        class="rounded-lg px-3 py-1.5 text-xs font-medium transition"
        :class="eventFilter === option.key
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'"
        @click="eventFilter = option.key as EventFilter"
      >
        {{ option.label }}
      </button>
    </div>

    <div class="border border-gray-200/80 rounded-xl bg-white/80 dark:border-gray-700/80 dark:bg-gray-800/60">
      <div v-if="loginLogsLoading" class="p-8 text-center text-gray-500">
        <div class="i-svg-spinners-90-ring-with-bg inline-block text-2xl" />
      </div>
      <div v-else-if="filteredLogs.length === 0" class="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        暂无登录日志。
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[760px] text-sm">
          <thead>
            <tr class="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-700/60 dark:text-gray-400">
              <th class="px-3 py-2 font-medium">时间</th>
              <th class="px-3 py-2 font-medium">账号</th>
              <th class="px-3 py-2 font-medium">结果</th>
              <th class="px-3 py-2 font-medium">原因</th>
              <th class="px-3 py-2 font-medium">IP</th>
              <th class="px-3 py-2 font-medium">浏览器</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="log in filteredLogs"
              :key="log.id"
              class="border-b border-gray-50 last:border-0 dark:border-gray-700/40"
            >
              <td class="whitespace-nowrap px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                {{ formatLogTime(log.timestamp) }}
              </td>
              <td class="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">
                {{ log.username }}
              </td>
              <td class="px-3 py-2">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="log.event === 'login_success'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'"
                >
                  {{ getEventLabel(log.event) }}
                </span>
              </td>
              <td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                {{ getErrorTypeLabel(log.errorType) }}
              </td>
              <td class="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                {{ log.ip }}
              </td>
              <td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                {{ parseBrowser(log.userAgent) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ConfirmModal
      :show="showClearConfirm"
      title="清空登录日志"
      message="清空后无法恢复，确定要删除全部登录日志吗？"
      type="danger"
      :loading="clearLogsLoading"
      @confirm="confirmClear"
      @cancel="showClearConfirm = false"
      @close="showClearConfirm = false"
    />
  </div>
</template>
