<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

interface RuntimeInfo {
  version: string
  platform: string
  arch: string
  packaged: boolean
  docker: boolean
  applyMode: 'executable' | 'archive'
  supportsApply: boolean
  execPath?: string
  appRoot: string
}

interface UpdateAsset {
  type: 'binary' | 'zip'
  platform: string
  arch: string
  size: number
  sha256: string
}

interface CheckResult {
  currentVersion: string
  runtime: RuntimeInfo
  hasUpdate: boolean
  latestVersion: string
  notes: string
  publishedAt: string
  asset: UpdateAsset | null
  assetError: string
}

interface UpdateJob {
  id: string
  status: 'queued' | 'checking' | 'downloading' | 'restarting' | 'error' | 'success'
  version: string
  progress: number
  receivedBytes: number
  totalBytes: number
  message: string
  error: string
  startedAt: number
  finishedAt: number
}

interface LastUpdate {
  status?: string
  fromVersion?: string
  toVersion?: string
  mode?: string
  at?: number
}

interface UpdateInfo {
  config: { manifestUrl: string }
  runtime: RuntimeInfo
  lastUpdate: LastUpdate | null
  jobs: UpdateJob[]
}

const ACTIVE_JOB_STATUSES = ['queued', 'checking', 'downloading', 'restarting']

const toast = useToastStore()
const userStore = useUserStore()
const isAdmin = computed(() => {
  const role = String(userStore.userInfo?.role || '')
  return role === 'admin' || role === 'super_admin'
})

const loading = ref(false)
const saving = ref(false)
const checking = ref(false)
const manifestUrl = ref('')
const runtime = ref<RuntimeInfo | null>(null)
const lastUpdate = ref<LastUpdate | null>(null)
const result = ref<CheckResult | null>(null)
const job = ref<UpdateJob | null>(null)
const showApplyConfirm = ref(false)
const restarting = ref(false)

let jobTimer: ReturnType<typeof setTimeout> | null = null

const applying = computed(() => !!job.value && ACTIVE_JOB_STATUSES.includes(job.value.status))
const progressPercent = computed(() => Math.max(0, Math.min(100, Number(job.value?.progress) || 0)))
const canApply = computed(() => {
  const target = result.value
  return !!target
    && target.hasUpdate
    && !!target.asset
    && !!runtime.value?.supportsApply
    && isAdmin.value
    && !applying.value
    && !restarting.value
})

function formatBytes(value: number) {
  const bytes = Number(value) || 0
  if (bytes <= 0) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTime(value?: number) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatPlatform(info: RuntimeInfo | null) {
  if (!info) return '—'
  const platformMap: Record<string, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' }
  const archMap: Record<string, string> = { x64: 'x64', arm64: 'arm64', ia32: 'x86' }
  return `${platformMap[info.platform] || info.platform} / ${archMap[info.arch] || info.arch}`
}

function formatMode(info: RuntimeInfo | null) {
  if (!info) return '—'
  if (info.docker) return 'Docker 容器'
  return info.packaged ? '可执行文件' : '源码运行'
}

const jobStatusText = computed(() => {
  if (!job.value) return ''
  const map: Record<string, string> = {
    queued: '排队中',
    checking: '正在获取更新清单',
    downloading: '正在下载更新包',
    restarting: '正在重启服务',
    error: '更新失败',
    success: '更新完成',
  }
  return map[job.value.status] || job.value.status
})

async function loadInfo() {
  loading.value = true
  try {
    const { data } = await api.get('/api/admin/update', { skipErrorToast: true } as any)
    if (data?.ok && data.data) {
      const info = data.data as UpdateInfo
      manifestUrl.value = info.config?.manifestUrl || ''
      runtime.value = info.runtime
      lastUpdate.value = info.lastUpdate || null
      const active = (info.jobs || []).find(item => ACTIVE_JOB_STATUSES.includes(item.status))
      if (active) {
        job.value = active
        if (active.status === 'restarting') {
          beginRestartWait()
        }
        else {
          scheduleJobPolling(active.id)
        }
      }
    }
  }
  catch (error: any) {
    toast.error(`加载在线更新配置失败: ${error?.response?.data?.error || error.message || '未知错误'}`)
  }
  finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  try {
    const { data } = await api.post('/api/admin/update/config', {
      manifestUrl: manifestUrl.value.trim(),
      confirmed: true,
    })
    if (data?.ok) {
      manifestUrl.value = data.data?.manifestUrl || ''
      result.value = null
      toast.success('更新清单地址已保存')
    }
    else {
      toast.error(data?.error || '保存失败')
    }
  }
  catch (error: any) {
    toast.error(`保存失败: ${error?.response?.data?.error || error.message || '未知错误'}`)
  }
  finally {
    saving.value = false
  }
}

async function checkUpdate() {
  if (!manifestUrl.value.trim()) {
    toast.warning('请先填写并保存更新清单地址')
    return
  }
  checking.value = true
  result.value = null
  try {
    const { data } = await api.post('/api/admin/update/check', {}, { skipErrorToast: true } as any)
    if (data?.ok) {
      result.value = data.data as CheckResult
      if (data.data?.runtime) runtime.value = data.data.runtime
      if (!data.data?.hasUpdate) toast.success('当前已是最新版本')
    }
    else {
      toast.error(data?.error || '检查更新失败')
    }
  }
  catch (error: any) {
    toast.error(`检查更新失败: ${error?.response?.data?.error || error.message || '未知错误'}`)
  }
  finally {
    checking.value = false
  }
}

function askApply() {
  if (!canApply.value) return
  showApplyConfirm.value = true
}

async function applyUpdate() {
  if (!result.value) return
  showApplyConfirm.value = false
  try {
    const { data } = await api.post('/api/admin/update/apply', {
      version: result.value.latestVersion,
      confirmed: true,
    })
    if (data?.ok && data.data) {
      job.value = data.data as UpdateJob
      toast.success('已开始下载更新包，请勿关闭服务')
      scheduleJobPolling(data.data.id)
    }
    else {
      toast.error(data?.error || '更新任务启动失败')
    }
  }
  catch (error: any) {
    toast.error(`更新任务启动失败: ${error?.response?.data?.error || error.message || '未知错误'}`)
  }
}

function stopJobPolling() {
  if (jobTimer) {
    clearTimeout(jobTimer)
    jobTimer = null
  }
}

function scheduleJobPolling(id: string) {
  stopJobPolling()
  jobTimer = setTimeout(() => pollJob(id), 1000)
}

async function pollJob(id: string) {
  try {
    const { data } = await api.get(`/api/admin/update/job/${id}`, { skipErrorToast: true } as any)
    if (data?.ok && data.data) {
      job.value = data.data as UpdateJob
      if (job.value.status === 'restarting') {
        stopJobPolling()
        beginRestartWait()
        return
      }
      if (job.value.status === 'error' || job.value.status === 'success') {
        stopJobPolling()
        return
      }
    }
    else if (data && !data.ok) {
      stopJobPolling()
      job.value = { ...(job.value as UpdateJob), status: 'error', error: data.error || '获取更新任务失败' }
      return
    }
  }
  catch {
    // 服务可能已经退出重启，转入健康检查轮询
    stopJobPolling()
    beginRestartWait()
    return
  }
  scheduleJobPolling(id)
}

async function beginRestartWait() {
  if (restarting.value) return
  restarting.value = true
  job.value = job.value
    ? { ...job.value, status: 'restarting', message: '服务正在重启，请稍候...' }
    : job.value
  let sawDown = false
  const startedAt = Date.now()
  while (Date.now() - startedAt < 180000) {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      if (response.ok) {
        if (sawDown) {
          toast.success('服务已重启，更新完成')
          setTimeout(() => window.location.reload(), 1200)
          return
        }
      }
      else {
        sawDown = true
      }
    }
    catch {
      sawDown = true
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  restarting.value = false
  toast.error('等待服务重启超时，请手动刷新页面检查')
}

onMounted(loadInfo)
onBeforeUnmount(stopJobPolling)
</script>

<template>
  <div class="space-y-4">
    <div class="border border-gray-200/80 rounded-xl bg-white/80 p-4 dark:border-gray-700/80 dark:bg-gray-800/60">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
            <span class="i-carbon-cloud-download text-emerald-500" />
            在线更新
          </h4>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            从自定义更新清单检查新版本，校验 SHA256 后替换程序文件并自动重启服务。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
            :class="runtime?.docker
              ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'"
          >
            <span class="i-carbon-circle-filled text-[8px]" />
            {{ runtime?.docker ? '容器部署' : '可在线更新' }}
          </span>
        </div>
      </div>

      <div v-if="loading" class="py-8 text-center text-gray-500">
        <div class="i-svg-spinners-90-ring-with-bg inline-block text-2xl" />
      </div>

      <div v-else class="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            当前版本
          </p>
          <p class="mt-1 text-sm text-gray-900 font-bold font-mono dark:text-gray-100">
            {{ runtime?.version || '—' }}
          </p>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            运行方式
          </p>
          <p class="mt-1 text-sm text-gray-900 font-bold dark:text-gray-100">
            {{ formatMode(runtime) }}
          </p>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            系统平台
          </p>
          <p class="mt-1 text-sm text-gray-900 font-bold dark:text-gray-100">
            {{ formatPlatform(runtime) }}
          </p>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            上次更新
          </p>
          <p class="mt-1 truncate text-sm text-gray-900 font-bold dark:text-gray-100" :title="formatTime(lastUpdate?.at)">
            {{ lastUpdate ? `${lastUpdate.status === 'success' ? '成功' : lastUpdate.status === 'applying' ? '进行中' : lastUpdate.status || '—'} ${lastUpdate.toVersion || ''}` : '—' }}
          </p>
        </div>
      </div>
    </div>

    <div v-if="runtime?.docker" class="border border-amber-200 rounded-xl bg-amber-50/80 p-4 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
      <div class="flex items-start gap-2">
        <span class="i-carbon-warning-alt mt-0.5 shrink-0" />
        <p>
          当前运行在 Docker 容器中，容器内的文件替换会在重建后丢失。请更新镜像后重建容器，本页面仅支持版本检查。
        </p>
      </div>
    </div>

    <div class="border border-gray-200/80 rounded-xl bg-white/80 p-4 dark:border-gray-700/80 dark:bg-gray-800/60">
      <p class="mb-3 text-sm text-gray-700 font-medium dark:text-gray-300">
        更新清单地址
      </p>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="min-w-0 flex-1">
          <BaseInput
            v-model="manifestUrl"
            placeholder="https://example.com/qq-farm-update.json"
            label="Manifest URL"
          />
        </div>
        <div class="flex shrink-0 gap-2">
          <BaseButton variant="secondary" :loading="saving" :disabled="checking || applying" @click="saveConfig">
            <span class="i-carbon-save mr-1" />
            保存地址
          </BaseButton>
          <BaseButton variant="primary" :loading="checking" :disabled="applying || restarting" @click="checkUpdate">
            <span class="i-carbon-search mr-1" />
            检查更新
          </BaseButton>
        </div>
      </div>
      <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
        服务端会直接拉取该地址；清单需包含 version、notes 以及带 sha256 的资源列表。version 必须大于当前版本。
      </p>

      <details class="mt-3 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
        <summary class="cursor-pointer select-none text-xs text-gray-600 font-semibold dark:text-gray-300">
          查看清单格式示例
        </summary>
        <pre class="mt-2 overflow-x-auto text-[11px] text-gray-600 leading-relaxed dark:text-gray-300">{
  "version": "2.9.0",
  "notes": "本次更新内容...",
  "publishedAt": "2026-10-20T10:00:00Z",
  "assets": [
    {
      "type": "exe",
      "platform": "win32",
      "arch": "x64",
      "url": "https://example.com/qq-farm-bot-win.exe",
      "sha256": "64位十六进制摘要",
      "size": 177741917
    },
    {
      "type": "exe",
      "platform": "linux",
      "arch": "x64",
      "url": "https://example.com/qq-farm-bot-linux",
      "sha256": "64位十六进制摘要",
      "size": 194437833
    },
    {
      "type": "zip",
      "url": "https://example.com/qq-farm-source.zip",
      "sha256": "64位十六进制摘要"
    }
  ]
}</pre>
        <p class="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          打包部署使用 type=exe（按当前 platform/arch 自动匹配）；源码部署使用 type=zip（替换 core/src、web/dist 等）。
          两种可放在同一清单中。sha256 必填，size 建议填写用于显示下载进度。
        </p>
      </details>
    </div>

    <div v-if="result" class="border rounded-xl p-4" :class="result.hasUpdate
      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-900/20'
      : 'border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/40'">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="flex items-center gap-2 text-sm font-bold" :class="result.hasUpdate ? 'text-emerald-800 dark:text-emerald-200' : 'text-gray-700 dark:text-gray-200'">
            <span :class="result.hasUpdate ? 'i-carbon-upgrade' : 'i-carbon-checkmark-filled'" />
            {{ result.hasUpdate ? `发现新版本 ${result.latestVersion}` : '当前已是最新版本' }}
          </p>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            当前版本 {{ result.currentVersion }}
            <template v-if="result.publishedAt"> · 发布于 {{ result.publishedAt }}</template>
          </p>
        </div>
        <div v-if="result.hasUpdate" class="flex flex-wrap gap-2">
          <BaseButton
            variant="primary"
            :disabled="!canApply"
            @click="askApply"
          >
            <span class="i-carbon-cloud-download mr-1" />
            立即更新并重启
          </BaseButton>
        </div>
      </div>

      <div v-if="result.hasUpdate" class="mt-3 space-y-2 text-xs text-gray-600 dark:text-gray-300">
        <p v-if="result.asset">
          更新包：{{ result.asset.type === 'zip' ? '源码压缩包' : '可执行文件' }}
          · {{ formatBytes(result.asset.size) }}
          · SHA256 {{ result.asset.sha256.slice(0, 16) }}…
        </p>
        <p v-if="result.assetError" class="text-amber-600 dark:text-amber-300">
          {{ result.assetError }}
        </p>
        <p v-if="!isAdmin" class="text-amber-600 dark:text-amber-300">
          仅管理员可以执行在线更新。
        </p>
        <div v-if="result.notes" class="rounded-lg bg-white/70 p-3 text-gray-700 whitespace-pre-wrap dark:bg-gray-900/40 dark:text-gray-200">
          {{ result.notes }}
        </div>
      </div>
    </div>

    <div v-if="job" class="border border-gray-200/80 rounded-xl bg-white/80 p-4 dark:border-gray-700/80 dark:bg-gray-800/60">
      <div class="flex items-center justify-between gap-3">
        <p class="flex items-center gap-2 text-sm text-gray-800 font-bold dark:text-gray-100">
          <span
            class="text-sm"
            :class="job.status === 'error'
              ? 'i-carbon-warning-alt text-red-500'
              : job.status === 'restarting' || restarting
                ? 'i-svg-spinners-90-ring-with-bg text-emerald-500'
                : job.status === 'success'
                  ? 'i-carbon-checkmark-filled text-emerald-500'
                  : 'i-carbon-download text-emerald-500'"
          />
          {{ restarting ? '服务正在重启' : jobStatusText }}
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ job.version ? `目标版本 ${job.version}` : '' }}
        </p>
      </div>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          class="h-full rounded-full bg-emerald-500 transition-all duration-300"
          :style="{ width: `${restarting ? 100 : progressPercent}%` }"
        />
      </div>
      <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
        <template v-if="job.status === 'downloading'">
          {{ formatBytes(job.receivedBytes) }} / {{ formatBytes(job.totalBytes) }} · {{ progressPercent }}%
        </template>
        <template v-else-if="job.error">
          {{ job.error }}
        </template>
        <template v-else>
          {{ restarting ? '正在等待服务恢复，页面将自动刷新...' : job.message || '处理中...' }}
        </template>
      </p>
    </div>

    <ConfirmModal
      :show="showApplyConfirm"
      title="在线更新并重启服务"
      :message="`将下载 ${result?.latestVersion || ''} 更新包，替换当前程序并重启服务。重启期间所有账号会短暂离线，确定继续吗？`"
      type="danger"
      confirm-text="开始更新"
      @confirm="applyUpdate"
      @cancel="showApplyConfirm = false"
      @close="showApplyConfirm = false"
    />
  </div>
</template>
