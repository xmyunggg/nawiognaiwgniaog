<script setup lang="ts">
import { computed } from 'vue'
import LiveDuration from '@/components/LiveDuration.vue'
import PlatformAvatar from '@/components/PlatformAvatar.vue'
import { formatCouponAmount, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'

const props = defineProps<{
  displayName: string
  accountName: string
  avatar: string
  platform?: string
  level: number
  expCurrent: number
  expNeeded: number
  expGained: number
  gold: number
  coupon: number
  diamond: number
  goldBean: number
  connected: boolean
  running: boolean
  uptime: number
  illustratedCrop: number
  illustratedMutant: number
  dailyGifts: any
  refreshingDailyGifts?: boolean
  dailyGiftsRefreshDisabled?: boolean
}>()

const emit = defineEmits<{
  openCareer: []
  refreshDailyGifts: []
}>()

const statusText = computed(() => {
  if (!props.displayName || props.displayName === '未登录')
    return '未登录'
  return props.connected ? '在线' : '离线'
})

const runningText = computed(() => props.running ? '农场运行中' : '农场已停止')

const expPercent = computed(() => {
  if (!props.expNeeded)
    return 0
  return Math.min(100, Math.max(0, (props.expCurrent / props.expNeeded) * 100))
})

const expPerHour = computed(() => {
  if (!props.uptime)
    return 0
  return Math.max(0, Math.round((props.expGained / props.uptime) * 3600))
})

const gifts = computed(() => {
  const list = props.dailyGifts?.gifts
  return Array.isArray(list) ? list : []
})

const giftDoneCount = computed(() => gifts.value.filter((gift: any) => gift?.doneToday).length)

const signInSubtitle = computed(() => {
  if (!gifts.value.length)
    return '领取丰厚奖励'
  if (giftDoneCount.value >= gifts.value.length)
    return `今日已完成 ${giftDoneCount.value}/${gifts.value.length}`
  return `今日已领 ${giftDoneCount.value}/${gifts.value.length}，点击继续`
})

const currencies = computed(() => [
  { label: '金币', value: formatGoldAmount(props.gold), icon: '/game-config/resource-icons/gold.png', tone: 'gold' },
  { label: '点券', value: formatCouponAmount(props.coupon), icon: '/game-config/resource-icons/coupon.png', tone: 'coupon' },
  { label: '钻石', value: formatCouponAmount(props.diamond), icon: '/game-config/resource-icons/diamond.png', tone: 'diamond' },
  { label: '金豆', value: formatGoldBeanAmount(props.goldBean), icon: '/game-config/resource-icons/gold-bean.png', tone: 'bean' },
])

const quickActions = computed(() => [
  { title: '作物图鉴', subtitle: `Lv.${props.illustratedCrop}`, image: '/game-config/resource-icons/illustrated-crop.png', to: '/personal?tab=illustrated', tone: 'green' },
  { title: '宠物', subtitle: '宠物守护', image: '/activity/pet-diary/S3Open_dog_1.png', to: '/personal?tab=pet', tone: 'cream' },
  { title: '背包', subtitle: '我的背包', image: '/game-config/resource-icons/illustrated-mutant.png', to: '/personal?tab=bag', tone: 'cream' },
  { title: '商城', subtitle: '道具 / 装扮', image: '/game-config/module_icons/merchant.png', to: '/shop', tone: 'blue' },
  { title: '活动', subtitle: '精彩活动', image: '/game-config/module_icons/activity.png', to: '/activity', tone: 'pink' },
  { title: '分析', subtitle: '数据统计', icon: 'i-carbon-analytics', to: '/analytics', tone: 'green' },
])


</script>

<template>
  <div class="mobile-home">
    <section class="mh-card mh-profile">
      <div class="mh-profile-head">
        <button
          type="button"
          class="mh-profile-avatar"
          title="查看个人生涯记录"
          @click="emit('openCareer')"
        >
          <PlatformAvatar
            :src="avatar"
            :name="displayName"
            :platform="platform"
            :size="52"
          />
        </button>

        <div class="mh-profile-copy">
          <div class="mh-profile-name">
            {{ displayName }}
            <span v-if="accountName && accountName !== displayName" class="mh-profile-remark">（{{ accountName }}）</span>
          </div>
          <div class="mh-profile-meta">
            <span class="mh-mini-dot" :class="connected ? 'is-online' : 'is-offline'" />
            <span>{{ statusText }}</span>
          </div>
        </div>

        <span class="mh-level">Lv.{{ level }}</span>
      </div>

      <div class="mh-exp-row">
        <span class="mh-exp-label">
          <span class="i-carbon-flash" />
          EXP 效率: {{ expPerHour }}/小时
        </span>
        <span class="mh-exp-value">{{ expCurrent }} / {{ expNeeded || '?' }}</span>
      </div>
      <div class="mh-exp-track">
        <div class="mh-exp-fill" :style="{ width: `${expPercent}%` }" />
      </div>
    </section>

    <section class="mh-currency-grid">
      <div v-for="currency in currencies" :key="currency.label" class="mh-currency" :class="`is-${currency.tone}`">
        <div class="mh-currency-head">
          <img :src="currency.icon" :alt="currency.label">
          <span>{{ currency.label }}</span>
        </div>
        <div class="mh-currency-value">
          {{ currency.value }}
        </div>
      </div>
    </section>

    <section class="mh-card mh-runtime">
      <div class="mh-runtime-main">
        <div class="mh-runtime-status">
          <span class="mh-status-label" :class="connected ? 'is-online' : 'is-offline'">
            <span class="mh-status-dot" />
            {{ statusText }}
          </span>
          <span class="mh-running-pill" :class="running ? 'is-running' : 'is-stopped'">
            <span class="mh-running-dot" />
            {{ runningText }}
          </span>
        </div>

        <div class="mh-timer">
          <LiveDuration :seconds="uptime" :active="connected" />
        </div>
        <div class="mh-runtime-caption">
          已运行
        </div>
      </div>

      <div class="mh-runtime-scene" aria-hidden="true" />
    </section>

    <section class="mh-quick-grid">
      <router-link
        v-for="action in quickActions"
        :key="action.title"
        :to="action.to"
        class="mh-quick"
        :class="`is-${action.tone}`"
      >
        <span class="mh-quick-icon">
          <img v-if="action.image" :src="action.image" :alt="action.title" decoding="async">
          <span v-else :class="action.icon" />
        </span>
        <span class="mh-quick-copy">
          <span class="mh-quick-title">{{ action.title }}</span>
          <span class="mh-quick-sub">{{ action.subtitle }}</span>
        </span>
        <span class="mh-quick-arrow i-carbon-chevron-right" />
      </router-link>
    </section>

    <section class="mh-signin">
      <span class="mh-signin-cow" aria-hidden="true" />
      <span class="mh-signin-copy">
        <span class="mh-signin-title">每日签到</span>
        <span class="mh-signin-sub">{{ signInSubtitle }}</span>
      </span>
      <button
        type="button"
        class="mh-signin-refresh"
        title="刷新每日礼包"
        aria-label="刷新每日礼包"
        :disabled="refreshingDailyGifts || dailyGiftsRefreshDisabled"
        @click="emit('refreshDailyGifts')"
      >
        <span class="i-carbon-renew" :class="{ 'animate-spin': refreshingDailyGifts }" />
      </button>
      <router-link to="/settings" class="mh-signin-btn">
        立即前往
        <span class="i-carbon-chevron-right" />
      </router-link>
    </section>
  </div>
</template>

<style scoped>
.mobile-home {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 4px;
  color: #29483c;
}

.mh-card {
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.92);
  background: rgba(255, 255, 255, 0.82);
  box-shadow:
    0 10px 28px rgba(56, 108, 83, 0.13),
    inset 0 1px 1px rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

.mh-profile {
  padding: 14px 15px 13px;
}

.mh-profile-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mh-profile-avatar {
  flex: none;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.mh-profile-avatar:active {
  transform: scale(0.96);
}

.mh-profile-copy {
  min-width: 0;
  flex: 1;
}

.mh-profile-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.2px;
  color: #27453b;
}

.mh-profile-remark {
  font-size: 12px;
  font-weight: 500;
  color: #7b9388;
}

.mh-profile-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  font-size: 11px;
  color: #7b9388;
}

.mh-mini-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.mh-mini-dot.is-online {
  color: #16a34a;
  box-shadow: 0 0 6px currentColor;
}

.mh-mini-dot.is-offline {
  color: #ef4444;
}

.mh-level {
  flex: none;
  padding: 4px 9px;
  border-radius: 999px;
  background: linear-gradient(135deg, #65d06f, #2eb85c);
  box-shadow: 0 4px 10px rgba(46, 184, 92, 0.3);
  color: #ffffff;
  font-size: 11px;
  font-weight: 800;
}

.mh-exp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  font-size: 11px;
  color: #6f897e;
}

.mh-exp-label {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mh-exp-value {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 700;
  color: #43695a;
}

.mh-exp-track {
  height: 8px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(71, 104, 88, 0.14);
}

.mh-exp-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #8fe273, #36c568);
  box-shadow: 0 0 10px rgba(54, 197, 104, 0.4);
  transition: width 0.4s ease;
}

.mh-currency-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}

.mh-currency {
  min-width: 0;
  padding: 8px 6px 7px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.9),
    0 5px 14px rgba(72, 108, 89, 0.08);
  text-align: center;
}

.mh-currency.is-gold {
  background: linear-gradient(150deg, #fff8dd, #ffecb8);
}

.mh-currency.is-coupon {
  background: linear-gradient(150deg, #eefbea, #d8f5d5);
}

.mh-currency.is-diamond {
  background: linear-gradient(150deg, #eaf7ff, #d5edff);
}

.mh-currency.is-bean {
  background: linear-gradient(150deg, #fff5e8, #ffe8c7);
}

.mh-currency-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  color: #7a8f85;
}

.mh-currency-head img {
  width: 15px;
  height: 15px;
  object-fit: contain;
}

.mh-currency-value {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 800;
  color: #3d5c4f;
  font-variant-numeric: tabular-nums;
}

.mh-runtime {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 8px;
  overflow: hidden;
  padding: 12px 12px 12px 15px;
}

.mh-runtime-main {
  position: relative;
  z-index: 2;
  min-width: 0;
  flex: 1;
}

.mh-runtime-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.mh-status-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 800;
}

.mh-status-label.is-online {
  color: #16a34a;
}

.mh-status-label.is-offline {
  color: #ef4444;
}

.mh-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

.mh-running-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(46, 184, 92, 0.5);
  background: rgba(240, 255, 244, 0.9);
  color: #2c9d53;
  font-size: 10px;
  font-weight: 700;
}

.mh-running-pill.is-stopped {
  border-color: rgba(148, 163, 184, 0.55);
  background: rgba(248, 250, 252, 0.9);
  color: #64748b;
}

.mh-running-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.mh-running-pill.is-running .mh-running-dot {
  animation: mh-pulse 1.8s ease-in-out infinite;
}

@keyframes mh-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.mh-timer {
  margin-top: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1;
  color: #2c4a3e;
  font-variant-numeric: tabular-nums;
}

.mh-runtime-caption {
  margin-top: 4px;
  font-size: 10px;
  color: #7b9388;
}

.mh-runtime-scene {
  width: 132px;
  min-height: 88px;
  flex: none;
  align-self: center;
  border-radius: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  background-image: url('/game-config/scene_images/runtime-scene.png');
  background-size: cover;
  background-position: 50% 62%;
  background-repeat: no-repeat;
  box-shadow:
    0 5px 14px rgba(56, 108, 83, 0.16),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

.mh-quick-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.mh-quick {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 10px 9px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.86);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.9),
    0 6px 16px rgba(62, 107, 84, 0.1);
  color: #2c4a3e;
}

.mh-quick.is-green {
  background: linear-gradient(145deg, rgba(235, 250, 238, 0.95), rgba(219, 244, 224, 0.95));
}

.mh-quick.is-cream {
  background: linear-gradient(145deg, rgba(255, 253, 246, 0.96), rgba(252, 245, 228, 0.96));
}

.mh-quick.is-blue {
  background: linear-gradient(145deg, rgba(240, 250, 255, 0.96), rgba(222, 242, 255, 0.96));
}

.mh-quick.is-pink {
  background: linear-gradient(145deg, rgba(255, 246, 250, 0.96), rgba(255, 232, 242, 0.96));
}

.mh-quick:active {
  transform: scale(0.98);
}

.mh-quick-icon {
  width: 34px;
  height: 34px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 3px 8px rgba(68, 108, 87, 0.12);
}

.mh-quick-icon img {
  width: 28px;
  height: 28px;
  object-fit: contain;
}

.mh-quick-icon span {
  font-size: 19px;
  color: #3e8f65;
}

.mh-quick-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
}

.mh-quick-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 800;
  color: #2c4a3e;
}

.mh-quick-sub {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: #7b9388;
}

.mh-quick-arrow {
  flex: none;
  color: #a7bcb1;
  font-size: 14px;
}

.mh-signin {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
  padding: 12px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.75);
  background: linear-gradient(135deg, #86dd8a 0%, #4fc571 55%, #35b767 100%);
  box-shadow:
    0 10px 24px rgba(55, 169, 95, 0.28),
    inset 0 1px 1px rgba(255, 255, 255, 0.45);
}

.mh-signin::before {
  content: '';
  position: absolute;
  top: -38px;
  right: -18px;
  width: 120px;
  height: 120px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  pointer-events: none;
}

.mh-signin-cow {
  position: relative;
  z-index: 1;
  width: 54px;
  height: 54px;
  flex: none;
  border-radius: 16px;
  border: 2px solid rgba(255, 255, 255, 0.7);
  background-color: #eafbe9;
  background-image: url('/bg-mobile.webp');
  background-size: 900% auto;
  background-position: 76% 59%;
  background-repeat: no-repeat;
  box-shadow: 0 4px 10px rgba(31, 120, 66, 0.22);
}

.mh-signin-copy {
  position: relative;
  z-index: 1;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  color: #ffffff;
}

.mh-signin-title {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.3px;
  text-shadow: 0 1px 2px rgba(23, 109, 57, 0.25);
}

.mh-signin-sub {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.88);
}

.mh-signin-refresh {
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
  font-size: 14px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.mh-signin-refresh:active {
  transform: scale(0.96);
}

.mh-signin-refresh:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.mh-signin-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 7px 11px;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 4px 10px rgba(24, 102, 54, 0.18);
  color: #28a35a;
  font-size: 11px;
  font-weight: 800;
}

.mh-signin-btn:active {
  transform: scale(0.96);
}

.dark .mobile-home {
  color: #e8f4ec;
}

.dark .mh-card {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(22, 40, 32, 0.82);
}

.dark .mh-profile-name,
.dark .mh-timer,
.dark .mh-quick {
  color: #e8f4ec;
}

.dark .mh-quick {
  border-color: rgba(255, 255, 255, 0.14);
}

.dark .mh-quick.is-green {
  background: linear-gradient(145deg, rgba(34, 64, 47, 0.95), rgba(26, 54, 40, 0.95));
}

.dark .mh-quick.is-cream {
  background: linear-gradient(145deg, rgba(57, 52, 38, 0.95), rgba(44, 42, 32, 0.95));
}

.dark .mh-quick.is-blue {
  background: linear-gradient(145deg, rgba(30, 55, 70, 0.95), rgba(25, 45, 58, 0.95));
}

.dark .mh-quick.is-pink {
  background: linear-gradient(145deg, rgba(65, 38, 53, 0.95), rgba(50, 31, 43, 0.95));
}

.dark .mh-exp-track {
  background: rgba(255, 255, 255, 0.14);
}

.dark .mh-profile-meta,
.dark .mh-quick-sub,
.dark .mh-runtime-caption,
.dark .mh-exp-row {
  color: #9fb8ab;
}

.dark .mh-signin {
  border-color: rgba(255, 255, 255, 0.18);
}
</style>
