<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  /** 头像地址，为空时显示昵称首字 */
  src?: string
  /** 昵称，用于 alt 与兜底首字 */
  name?: string
  /** vx=微信 / qq=QQ，决定右下角平台角标 */
  platform?: string
  /** 头像边长（像素） */
  size?: number
}>(), {
  src: '',
  name: '',
  platform: '',
  size: 52,
})

const failed = ref(false)

watch(() => props.src, () => {
  failed.value = false
})

const normalizedPlatform = computed(() => {
  const value = String(props.platform || '').toLowerCase()
  if (value === 'wx' || value === 'wechat' || value === 'weixin')
    return 'wx'
  if (value === 'qq')
    return 'qq'
  return ''
})

const badgeSrc = computed(() => {
  if (normalizedPlatform.value === 'wx')
    return '/wx-icon.svg'
  if (normalizedPlatform.value === 'qq')
    return '/qq-icon.svg'
  return ''
})

const badgeLabel = computed(() => normalizedPlatform.value === 'wx' ? '微信' : 'QQ')

const initial = computed(() => (props.name || '农').trim().slice(0, 1) || '农')

const badgeSize = computed(() => Math.round(props.size * 0.36))

const boxStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}))

const badgeStyle = computed(() => ({
  width: `${badgeSize.value}px`,
  height: `${badgeSize.value}px`,
}))
</script>

<template>
  <span class="platform-avatar" :style="boxStyle">
    <img
      v-if="src && !failed"
      :src="src"
      :alt="name || '账号头像'"
      referrerpolicy="no-referrer"
      class="platform-avatar-img"
      @error="failed = true"
    >
    <span v-else class="platform-avatar-fallback">{{ initial }}</span>

    <img
      v-if="badgeSrc"
      :src="badgeSrc"
      :alt="badgeLabel"
      :title="badgeLabel"
      class="platform-avatar-badge"
      :class="{ 'is-qq': normalizedPlatform === 'qq' }"
      :style="badgeStyle"
    >
  </span>
</template>

<style scoped>
.platform-avatar {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: visible;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.6);
  box-shadow: 0 4px 12px rgba(38, 72, 48, 0.18);
}

.platform-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.platform-avatar-fallback {
  color: #3f7d5c;
  font-size: 0.95rem;
  font-weight: 700;
}

.platform-avatar-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #ffffff;
  object-fit: cover;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.22);
}

/* QQ 图标本身是透明底黑色企鹅，补一层白底并留出内边距 */
.platform-avatar-badge.is-qq {
  padding: 15%;
  background: #ffffff;
}
</style>
