<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const saving = ref(false)

const strength = computed(() => {
  const pwd = newPassword.value
  if (!pwd)
    return { score: 0, level: '', color: '#cbd5e1', valid: false }

  let score = 0
  if (pwd.length >= 6)
    score++
  if (pwd.length >= 10)
    score++

  let typeCount = 0
  if (/[a-z]/.test(pwd))
    typeCount++
  if (/[A-Z]/.test(pwd))
    typeCount++
  if (/\d/.test(pwd))
    typeCount++
  if (/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/.test(pwd))
    typeCount++

  if (typeCount >= 2)
    score += 2
  if (typeCount >= 3)
    score++
  if (typeCount >= 4)
    score++

  const commonPasswords = ['password', '123456', 'qwerty', 'abc123', '111111']
  if (commonPasswords.some(p => pwd.toLowerCase().includes(p)))
    score = Math.max(0, score - 2)

  const level = score <= 2 ? '弱' : score <= 4 ? '中' : score <= 6 ? '强' : '非常强'
  const color = score <= 2 ? '#ef5350' : score <= 4 ? '#ffa726' : score <= 6 ? '#66bb6a' : '#43a047'
  return { score, level, color, valid: pwd.length >= 6 && typeCount >= 2 }
})

async function handleSubmit() {
  error.value = ''
  if (!oldPassword.value) {
    error.value = '请输入当前密码'
    return
  }
  if (newPassword.value.length < 6) {
    error.value = '新密码长度至少 6 位'
    return
  }
  if (!strength.value.valid) {
    error.value = '密码强度不足：需包含大写字母、小写字母、数字、特殊符号中的至少两种'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  if (newPassword.value === oldPassword.value) {
    error.value = '新密码不能与当前密码相同'
    return
  }

  saving.value = true
  try {
    const result = await userStore.changePassword(oldPassword.value, newPassword.value)
    if (!result.ok) {
      error.value = result.error || '修改密码失败'
      return
    }
    await userStore.logout()
    await router.replace({ name: 'login' })
  }
  catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || '修改密码失败'
  }
  finally {
    saving.value = false
  }
}

async function handleLogout() {
  await userStore.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10 dark:bg-gray-950">
    <section class="ui-card-elevated w-full max-w-xl rounded-3xl p-6 shadow-lg sm:p-8">
      <div class="mb-5 flex items-start gap-3">
        <div class="i-carbon-password mt-0.5 text-2xl text-amber-500" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
            请修改初始密码
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            当前账号仍在使用初始密码，修改后才能进入面板。
          </p>
        </div>
      </div>

      <div class="mb-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        初始密码是公开已知的。未修改前，除改密与退出外的面板接口都会被拒绝。
      </div>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <BaseInput
          v-model="oldPassword"
          type="password"
          label="当前密码"
          placeholder="请输入当前登录密码"
          :disabled="saving"
        />
        <BaseInput
          v-model="newPassword"
          type="password"
          label="新密码"
          placeholder="请输入新密码"
          :disabled="saving"
        />

        <div v-if="newPassword" class="space-y-1.5">
          <div class="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <div
              class="h-full rounded-full transition-all duration-200"
              :style="{ width: `${Math.min(strength.score * 12.5, 100)}%`, background: strength.color }"
            />
          </div>
          <div class="flex flex-wrap items-center justify-between gap-1 text-xs">
            <span :style="{ color: strength.color }">密码强度：{{ strength.level }}</span>
            <span v-if="!strength.valid" class="text-gray-500 dark:text-gray-400">
              至少 6 位，且包含大小写、数字、符号中的两种
            </span>
          </div>
        </div>

        <BaseInput
          v-model="confirmPassword"
          type="password"
          label="确认新密码"
          placeholder="请再次输入新密码"
          :disabled="saving"
        />

        <div v-if="error" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
          {{ error }}
        </div>

        <BaseButton type="submit" variant="primary" block :loading="saving">
          修改密码并重新登录
        </BaseButton>

        <button
          type="button"
          class="w-full text-center text-sm text-gray-500 transition hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
          :disabled="saving"
          @click="handleLogout"
        >
          退出登录
        </button>
      </form>
    </section>
  </div>
</template>
