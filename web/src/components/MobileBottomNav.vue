<script setup lang="ts">
import { onMounted } from 'vue'
import { useSupportContact } from '@/composables/useSupportContact'
import { prefetchMenuRoute } from '@/router/menu'
import { useAppStore } from '@/stores/app'

// 窄屏底部 tabbar：仅移动端显示（md:hidden），桌面端隐藏。
// 路由使用本项目真实存在的路径。
const appStore = useAppStore()

const {
  visible: supportVisible,
  load: loadSupport,
  open: openSupport,
} = useSupportContact()

onMounted(loadSupport)

const items = [
  { path: '/', label: '首页', icon: 'i-carbon-home' },
  { path: '/personal', label: '农场', icon: 'i-carbon-sprout' },
  { path: '/activity', label: '活动', icon: 'i-carbon-gift' },
]

function onSupportClick() {
  openSupport()
  appStore.closeSidebar()
}
</script>

<template>
  <nav class="mobile-tabbar fixed inset-x-0 bottom-0 z-30 flex items-center justify-around px-2 pb-[calc(0.4rem+env(safe-area-inset-bottom))] pt-1.5 md:hidden">
    <RouterLink
      v-for="item in items"
      :key="item.path"
      :to="item.path"
      class="mobile-tabbar-item"
      exact-active-class="is-active"
      @pointerenter="prefetchMenuRoute(item.path)"
      @focus="prefetchMenuRoute(item.path)"
    >
      <span class="mobile-tabbar-icon h-7 w-9 flex items-center justify-center rounded-full">
        <span :class="item.icon" class="text-[19px]" />
      </span>
      <span class="mt-0.5 text-[10px] font-semibold">{{ item.label }}</span>
    </RouterLink>

    <!-- 我的：个人设置 -->
    <RouterLink
      to="/settings"
      class="mobile-tabbar-item"
      exact-active-class="is-active"
      @pointerenter="prefetchMenuRoute('/settings')"
      @focus="prefetchMenuRoute('/settings')"
    >
      <span class="mobile-tabbar-icon mobile-tabbar-avatar relative h-7 w-7 flex items-center justify-center overflow-hidden rounded-full">
        <img src="/default-user-avatar-256.png" alt="我的" class="h-full w-full object-cover">
      </span>
      <span class="mt-0.5 text-[10px] font-semibold">我的</span>
    </RouterLink>

    <!-- 更多：打开移动端侧边抽屉，复用现有全部导航项 -->
    <button type="button" class="mobile-tabbar-item" @click="appStore.openSidebar()">
      <span class="mobile-tabbar-icon h-7 w-9 flex items-center justify-center rounded-full">
        <span class="i-carbon-overflow-menu-horizontal text-[19px]" />
      </span>
      <span class="mt-0.5 text-[10px] font-semibold">更多</span>
    </button>

    <!-- 联系客服：移动端入口，点开与桌面端侧边栏共用的弹窗 -->
    <button
      v-if="supportVisible"
      type="button"
      class="mobile-tabbar-item"
      @click="onSupportClick"
    >
      <span class="mobile-tabbar-icon h-7 w-9 flex items-center justify-center rounded-full">
        <span class="i-carbon-headset text-[19px]" />
      </span>
      <span class="mt-0.5 text-[10px] font-semibold">客服</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-tabbar {
  border-top: 1px solid rgba(255, 255, 255, 0.7);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(240, 250, 242, 0.9));
  box-shadow: 0 -10px 28px rgba(35, 70, 40, 0.12);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
}

.mobile-tabbar-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: none;
  color: #7b9388;
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
}

.mobile-tabbar-icon {
  color: inherit;
  transition:
    color 0.16s ease,
    background-color 0.16s ease;
}

.mobile-tabbar-avatar {
  border: 1.5px solid rgba(255, 255, 255, 0.85);
}

.mobile-tabbar-item.is-active {
  color: #1f7a44;
}

.mobile-tabbar-item.is-active .mobile-tabbar-icon {
  background: rgba(214, 243, 220, 0.95);
}

.mobile-tabbar-item.is-active .mobile-tabbar-avatar {
  border-color: #35b767;
}
</style>
