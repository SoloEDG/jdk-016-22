<script setup lang="ts">
import { reactive, ref } from "vue";
import type { Document } from "../../../shared/types";
import { runManualExport, type ManualResult } from "../model/job";

const props = defineProps<{ doc: Document }>();
const emit = defineEmits<{ notify: [msg: string] }>();

const state = reactive({ running: false, done: 0, total: 0 });
const result = ref<ManualResult | null>(null);
let cancelJob: (() => void) | null = null;

async function start() {
  if (state.running) return;
  state.running = true;
  state.done = 0;
  state.total = 0;
  result.value = null;
  const job = runManualExport(props.doc, (done, total) => {
    state.done = done;
    state.total = total;
  });
  cancelJob = job.cancel;
  const r = await job.done;
  cancelJob = null;
  state.running = false;
  result.value = r;
  emit(
    "notify",
    r.cancelled
      ? "已取消说明书导出，未生成文件。"
      : r.ok
        ? `说明书已下载：共 ${r.pages} 页，版本 ${r.version}`
        : "说明书导出失败",
  );
}
</script>

<template>
  <section class="panel manual-panel">
    <div class="section-heading">
      <span>折叠说明书</span><small>MANUAL</small>
    </div>
    <p class="manual-desc">
      按当前步骤生成多页说明书：每步含展开图与折叠视图、编号折痕、按真实折轴生成的方向箭头；被遮挡的动作自动换视角或附剖面。
    </p>
    <button v-if="!state.running" class="manual-start" @click="start">
      ▤ 导出多页说明书
    </button>
    <div v-else class="manual-progress">
      <div class="manual-bar">
        <i :style="{ width: (state.total ? (state.done / state.total) * 100 : 0) + '%' }"></i>
      </div>
      <div class="manual-row">
        <span>排版中 {{ state.done }}/{{ state.total || "…" }} 页</span>
        <button @click="cancelJob?.()">取消</button>
      </div>
    </div>
    <div v-if="result" class="manual-result" :class="{ failed: !result.ok }">
      <b v-if="result.cancelled">已取消，未生成文件。</b>
      <b v-else-if="result.ok">已下载 {{ result.pages }} 页 · 版本 {{ result.version }}</b>
      <b v-else>导出未完成。</b>
      <span v-for="(n, i) in result.notices" :key="i">{{ n }}</span>
    </div>
  </section>
</template>
