<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AnnouncementBell from '@/components/AnnouncementBell.vue'
import MobileBottomNav from '@/components/MobileBottomNav.vue'
import MysteryMerchantBanner from '@/components/shop/MysteryMerchantBanner.vue'
import Sidebar from '@/components/Sidebar.vue'
import SupportDialog from '@/components/SupportDialog.vue'
import TopAccountMenu from '@/components/TopAccountMenu.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const { loginPageConfig, sidebarOpen } = storeToRefs(appStore)

const headerLogoFailed = ref(false)
const headerLogoUrl = computed(() => {
  const custom = loginPageConfig.value.logoUrl
  return custom && !headerLogoFailed.value ? custom : '/qq-farm-logo.webp'
})
watch(() => loginPageConfig.value.logoUrl, () => { headerLogoFailed.value = false })

onMounted(() => {
  appStore.fetchLoginPageConfig()
})

onUnmounted(() => {
  // 清理逻辑
})
</script>

<template>
  <div class="layout-root w-screen flex overflow-hidden" style="height: 100dvh;">
    <!-- Mobile Sidebar Overlay with Liquid Blur -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-gray-950/45 backdrop-blur-md transition-opacity lg:hidden"
      @click="appStore.closeSidebar"
    />

    <Sidebar @click="appStore.closeSidebar" />

    <main class="relative z-10 h-full min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
      <!-- Liquid Glass Top Header -->
      <header class="liquid-header relative z-30 mx-2 mt-2 h-16 flex shrink-0 items-center justify-between rounded-2xl px-3 md:mx-4 md:mt-4 md:px-5">
        <!-- 左侧：汉堡按钮（移动端）或标题（桌面端） -->
        <div class="z-10 flex items-center gap-2.5">
          <button
            class="liquid-btn-icon h-9 w-9 flex items-center justify-center rounded-xl text-gray-700 transition lg:hidden hover:bg-white/60 dark:text-gray-200 dark:hover:bg-gray-800/60"
            @click="appStore.toggleSidebar"
          >
            <div class="i-carbon-menu text-xl" />
          </button>

          <div class="hidden text-base text-gray-800 font-bold tracking-tight opacity-90 lg:block dark:text-gray-100">
            {{ loginPageConfig.title && loginPageConfig.title !== 'QQ农场智能助手' ? loginPageConfig.title : 'QQ农场助手控制台' }}
          </div>
        </div>

        <!-- 仅移动端绝对居中显示的 Logo，PC端隐藏（右侧数据看板区域不显示 Logo） -->
        <div class="pointer-events-none absolute left-1/2 top-1/2 z-20 flex items-center justify-center lg:hidden -translate-x-1/2 -translate-y-1/2">
          <img
            :src="headerLogoUrl"
            :alt="`${loginPageConfig.title || 'QQ经典农场'}`"
            class="pointer-events-auto h-11 max-w-[190px] w-auto object-contain drop-shadow-[0_4px_14px_rgba(0,0,0,0.15)] transition-transform duration-300"
            @error="headerLogoFailed = true"
          >
        </div>

        <!-- 右侧：消息提醒铃铛 + 头像胶囊 -->
        <div class="z-10 flex items-center gap-2">
          <AnnouncementBell />
          <TopAccountMenu />
        </div>
      </header>

      <!-- Main Content Area -->
      <div class="min-h-0 flex flex-1 flex-col overflow-hidden">
        <MysteryMerchantBanner />
        <div class="custom-scrollbar min-h-0 flex flex-1 flex-col overflow-y-auto px-2 pb-[calc(72px+env(safe-area-inset-bottom))] pt-3 md:px-4 md:pb-6 md:pt-4">
          <RouterView v-slot="{ Component }">
            <component :is="Component" />
          </RouterView>
        </div>
      </div>
    </main>

    <MobileBottomNav />
    <SupportDialog />
  </div>
</template>

<style scoped>
.layout-root {
  position: relative;
}

/* 整页背景由 body 绘制，这里只保留一层轻遮罩。
   全屏 backdrop-filter 会在农场动画/滚动时持续重算，桌面端也一并关闭。 */
.layout-root::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(245, 248, 252, 0.16);
  pointer-events: none;
  z-index: 0;
}

.dark .layout-root::before {
  background: rgba(11, 16, 32, 0.46);
}

@media (max-width: 1023px) {
  .layout-root::before {
    background: rgba(245, 248, 252, 0.22);
  }

  .dark .layout-root::before {
    background: rgba(11, 16, 32, 0.52);
  }
}

/* 桌面端：减弱遮罩，让背景插画保持清晰 */
@media (min-width: 1024px) {
  .layout-root::before {
    background: rgba(245, 248, 252, 0.05);
  }
}

.liquid-header {
  background: var(--liquid-glass-bg);
  backdrop-filter: var(--liquid-glass-blur);
  -webkit-backdrop-filter: var(--liquid-glass-blur);
  border: 1px solid var(--liquid-glass-border);
  box-shadow: var(--liquid-glass-shadow-sm);
  transition: all 0.25s ease;
}

.liquid-btn-icon {
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.4);
}

.dark .liquid-btn-icon {
  background: rgba(30, 41, 59, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.15);
}

/* Slide Fade Transition */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease-out;
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.35);
  border-radius: 4px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.6);
}

.custom-scrollbar {
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
</style>
