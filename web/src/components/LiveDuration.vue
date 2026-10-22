<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  seconds: number
  mode?: 'elapsed' | 'remaining'
  active?: boolean
  emptyText?: string
}>(), {
  mode: 'elapsed',
  active: true,
  emptyText: '',
})

const now = ref(Date.now())
const anchorAt = ref(Date.now())
const anchorSeconds = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

watch(() => Math.max(0, Number(props.seconds) || 0), (seconds) => {
  anchorSeconds.value = seconds
  anchorAt.value = Date.now()
  now.value = Date.now()
}, { immediate: true })

watch(() => props.active, (active) => {
  if (!active)
    return
  anchorAt.value = Date.now()
  now.value = Date.now()
})

const displaySeconds = computed(() => {
  if (!props.active)
    return 0
  const elapsed = Math.max(0, Math.floor((now.value - anchorAt.value) / 1000))
  if (props.mode === 'remaining')
    return Math.max(0, anchorSeconds.value - elapsed)
  return anchorSeconds.value + elapsed
})

const text = computed(() => {
  if (props.mode === 'remaining' && (!props.active || anchorSeconds.value <= 0))
    return props.emptyText || formatDuration(0)
  return formatDuration(displaySeconds.value)
})

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.floor(value))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = seconds % 60
  const pad = (input: number) => input.toString().padStart(2, '0')

  if (days > 0)
    return `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
  return `${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
}

onMounted(() => {
  // 单个轻量组件承担秒级刷新，避免整页 Dashboard/MobileHome 每秒重新 diff。
  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && props.active)
      now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (timer) {
    window.clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <span class="tabular-nums">{{ text }}</span>
</template>
