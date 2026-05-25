<script setup lang="ts">
// eslint-disable-next-line import/no-unresolved
import { Info, TriangleAlert, X } from 'lucide-vue-next';
import { computed, onBeforeUnmount, watch } from 'vue';

type Variant = 'destructive' | 'info';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    variant?: Variant;
    title: string;
    body?: string;
    cap?: string;
    confirmText?: string;
    cancelText?: string;
    loading?: boolean;
  }>(),
  {
    variant: 'destructive',
    body: undefined,
    cap: undefined,
    confirmText: undefined,
    cancelText: '取消',
    loading: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const resolvedConfirmText = computed(
  () => props.confirmText ?? (props.variant === 'destructive' ? '确认' : '确定'),
);

function onCancel(): void {
  emit('cancel');
  emit('update:modelValue', false);
}
function onConfirm(): void {
  emit('confirm');
}
function onBackdrop(): void {
  if (!props.loading) onCancel();
}

// Esc 关闭 + 锁背景滚动
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.modelValue && !props.loading) {
    onCancel();
  }
}
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    } else {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    }
  },
);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <Transition name="cf-fade">
      <div v-if="modelValue" class="cf-overlay" @click.self="onBackdrop">
        <div class="cf-dialog" role="dialog" aria-modal="true" :aria-labelledby="`cf-title`">
          <header class="cf-head">
            <span class="cf-icon" :class="variant">
              <TriangleAlert v-if="variant === 'destructive'" :size="18" :stroke-width="1.6" />
              <Info v-else :size="18" :stroke-width="1.6" />
            </span>
            <div class="cf-head-text">
              <h3 id="cf-title" class="cf-title">{{ title }}</h3>
              <div v-if="cap" class="cf-cap">{{ cap }}</div>
            </div>
            <button
              class="cf-close"
              type="button"
              title="关闭"
              :disabled="loading"
              @click="onCancel"
            >
              <X :size="14" :stroke-width="1.6" />
            </button>
          </header>

          <div class="cf-body">
            <slot>{{ body }}</slot>
          </div>

          <footer class="cf-footer">
            <button
              class="btn btn-secondary sm"
              type="button"
              :disabled="loading"
              @click="onCancel"
            >
              {{ cancelText }}
            </button>
            <button class="btn btn-primary sm" type="button" :disabled="loading" @click="onConfirm">
              {{ loading ? '处理中…' : resolvedConfirmText }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cf-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(28, 28, 28, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.cf-dialog {
  width: min(420px, 92vw);
  background: var(--paper-white);
  border: 1px solid var(--stone);
  border-radius: var(--radius-2);
  box-shadow: 0 12px 40px -12px rgba(28, 28, 28, 0.18);
  padding: 24px 28px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cf-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.cf-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 2px;
}
.cf-icon.destructive {
  color: var(--yangli-red);
}
.cf-icon.info {
  color: var(--fg-2);
}
.cf-head-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.cf-title {
  font-family: var(--font-han);
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
  margin: 0;
  letter-spacing: -0.005em;
}
.cf-cap {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.cf-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--fg-3);
  padding: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: -2px;
  margin-right: -6px;
  transition: color var(--dur-fast) var(--ease-default);
}
.cf-close:hover:not(:disabled) {
  color: var(--yangli-red);
}
.cf-close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cf-body {
  font-family: var(--font-han);
  font-size: 13.5px;
  color: var(--fg-2);
  line-height: 1.7;
}

.cf-footer {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* fade + scale 过渡 */
.cf-fade-enter-active,
.cf-fade-leave-active {
  transition: opacity 160ms var(--ease-default);
}
.cf-fade-enter-active .cf-dialog,
.cf-fade-leave-active .cf-dialog {
  transition:
    transform 200ms var(--ease-default),
    opacity 160ms var(--ease-default);
}
.cf-fade-enter-from,
.cf-fade-leave-to {
  opacity: 0;
}
.cf-fade-enter-from .cf-dialog,
.cf-fade-leave-to .cf-dialog {
  transform: translateY(8px) scale(0.98);
  opacity: 0;
}
</style>
