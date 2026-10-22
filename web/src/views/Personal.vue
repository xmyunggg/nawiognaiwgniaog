<script setup lang="ts">
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BagPanel from '@/components/BagPanel.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import TaskPanel from '@/components/TaskPanel.vue'

type WorkspaceTab = 'farm' | 'illustrated' | 'pet' | 'bag' | 'task'

interface WorkspaceTabItem {
  key: WorkspaceTab
  label: string
  icon: string
}

// 图鉴与宠物页面体量较大，保持按需加载（与路由懒加载行为一致）
const IllustratedView = defineAsyncComponent(() => import('@/views/Illustrated.vue'))
const PetView = defineAsyncComponent(() => import('@/views/Pet.vue'))

const tabs: WorkspaceTabItem[] = [
  { key: 'farm', label: '我的农场', icon: 'i-carbon-sprout' },
  { key: 'illustrated', label: '图鉴', icon: 'i-carbon-book' },
  { key: 'pet', label: '宠物守护', icon: 'i-fas-paw' },
  { key: 'bag', label: '我的背包', icon: 'i-carbon-shopping-bag' },
  { key: 'task', label: '我的任务', icon: 'i-carbon-task' },
]

const route = useRoute()
const router = useRouter()

// 历史路径 /pet、/illustrated 复用本页，分别落到对应标签
const PATH_TAB_MAP: Record<string, WorkspaceTab> = {
  '/pet': 'pet',
  '/illustrated': 'illustrated',
}

function resolveTab(value: unknown, path?: string): WorkspaceTab {
  const key = String(value || '')
  if (tabs.some(item => item.key === key))
    return key as WorkspaceTab
  return (path && PATH_TAB_MAP[path]) || 'farm'
}

const activeTab = computed<WorkspaceTab>(() => resolveTab(route.query.tab, route.path))

function selectTab(tab: WorkspaceTab) {
  if (tab === activeTab.value && route.path === '/personal')
    return
  const query: RouteLocationNormalizedLoaded['query'] = { ...route.query, tab }
  router.replace({ path: '/personal', query })
}
</script>

<template>
  <div class="farm-workspace w-full flex-1 min-h-0">
    <nav class="workspace-tabs" aria-label="农场工作区">
      <button
        v-for="item in tabs"
        :key="item.key"
        type="button"
        class="workspace-tab"
        :class="{ 'is-active': activeTab === item.key }"
        :aria-current="activeTab === item.key ? 'page' : undefined"
        @click="selectTab(item.key)"
      >
        <span :class="item.icon" class="workspace-tab-icon" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="workspace-body">
      <FarmPanel v-if="activeTab === 'farm'" />
      <IllustratedView v-else-if="activeTab === 'illustrated'" />
      <PetView v-else-if="activeTab === 'pet'" />
      <BagPanel v-else-if="activeTab === 'bag'" />
      <TaskPanel v-else-if="activeTab === 'task'" />
    </div>
  </div>
</template>

<style scoped>
.workspace-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin-bottom: 12px;
  padding: 0 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.55);
}

.workspace-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px 11px;
  border: none;
  background: none;
  color: #5c7864;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.16s ease;
}

.workspace-tab:hover {
  color: #2f4b38;
}

.workspace-tab.is-active {
  color: var(--theme-primary, #2f6fb5);
}

.workspace-tab-icon {
  font-size: 15px;
}

.workspace-tab.is-active::after {
  content: '';
  position: absolute;
  right: 10px;
  bottom: -1px;
  left: 10px;
  height: 2px;
  border-radius: 999px;
  background: currentColor;
}

.dark .workspace-tabs {
  border-bottom-color: rgba(255, 255, 255, 0.12);
}

.dark .workspace-tab {
  color: #9db6a9;
}

.dark .workspace-tab:hover {
  color: #e8f4ec;
}
</style>
