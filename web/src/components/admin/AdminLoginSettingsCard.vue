<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useToastStore } from '@/stores/toast'

interface LoginSettings {
  wechatQrLogin: boolean
  qqQrLogin: boolean
  napCatEndpoint: string
  napCatSignature: string
}

const toast = useToastStore()

const settings = ref<LoginSettings>({
  wechatQrLogin: true,
  qqQrLogin: false,
  napCatEndpoint: '',
  napCatSignature: '',
})
const loading = ref(false)
const saving = ref(false)

async function loadSettings() {
  loading.value = true
  try {
    const { data } = await api.get('/api/admin/login-settings', { skipErrorToast: true } as any)
    if (data?.ok && data.data)
      settings.value = { ...settings.value, ...data.data }
  }
  catch (e: any) {
    toast.error(`加载登录设置失败: ${e?.response?.data?.error || e.message || '未知错误'}`)
  }
  finally {
    loading.value = false
  }
}

async function saveSettings() {
  const endpoint = settings.value.napCatEndpoint.trim()
  const signature = settings.value.napCatSignature.trim()
  if (settings.value.qqQrLogin && (!endpoint || !signature)) {
    toast.error('开启 QQ 扫码登录前，请先填写 NapCat 接口地址和接口签名')
    return
  }

  saving.value = true
  try {
    const { data } = await api.post('/api/admin/login-settings', {
      ...settings.value,
      napCatEndpoint: endpoint,
      napCatSignature: signature,
      confirmed: true,
    })
    if (data?.ok) {
      settings.value = { ...settings.value, ...data.data }
      toast.success('登录设置已保存')
    }
    else {
      toast.error(data?.error || '保存失败')
    }
  }
  catch (e: any) {
    toast.error(`保存失败: ${e?.response?.data?.error || e.message || '未知错误'}`)
  }
  finally {
    saving.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="space-y-4">
    <div v-if="loading" class="py-8 text-center text-gray-500">
      <div class="i-svg-spinners-90-ring-with-bg inline-block text-2xl" />
    </div>

    <template v-else>
      <section class="border border-gray-200 rounded-2xl bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-start gap-3">
            <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400">
              <div class="i-carbon-login text-xl" />
            </div>
            <div>
              <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
                登录设置
              </h4>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                控制添加账号时可用的扫码登录方式
              </p>
            </div>
          </div>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="saving"
            class="shrink-0 self-start sm:self-auto"
            @click="saveSettings"
          >
            <span class="i-carbon-checkmark mr-1" />
            保存登录设置
          </BaseButton>
        </div>

        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div class="border border-gray-200 rounded-lg bg-gray-50/60 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <BaseSwitch v-model="settings.wechatQrLogin" label="微信扫码登录" />
          </div>
          <div class="border border-gray-200 rounded-lg bg-gray-50/60 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <BaseSwitch v-model="settings.qqQrLogin" label="QQ扫码登录" />
          </div>
        </div>

        <div
          v-if="settings.qqQrLogin"
          class="mt-4 grid grid-cols-1 gap-3 border border-gray-200 rounded-lg bg-gray-50/60 p-4 sm:grid-cols-2 dark:border-gray-700 dark:bg-gray-900/30"
        >
          <BaseInput
            v-model="settings.napCatEndpoint"
            label="NapCat接口地址"
            type="text"
            placeholder="http://127.0.0.1:6099"
          />
          <BaseInput
            v-model="settings.napCatSignature"
            label="NapCat接口签名"
            type="password"
            placeholder="请输入 NapCat 接口签名"
          />
        </div>

      </section>
    </template>
  </div>
</template>
