<script lang="ts">
  import { onMount } from 'svelte';
  // Keep editor loosely typed to avoid strict dependency churn
  export let editor: any = null;
  export let enabled: boolean = true;

  let open = false;
  let label = 'CUSTOM';
  let showPii = false;

  let attachedEditor: any = null;

  const isValidSelection = () => {
    if (!editor) return false;
    const { from, to } = editor.state?.selection || { from: 0, to: 0 };
    const len = to - from;
    return len >= 2 && len <= 50;
  };

  const updateVisibility = () => {
    const next = enabled && isValidSelection();
    if (!next) open = false; // close panel when selection becomes invalid
    showPii = !!next;
  };

  function handleEditorEvent() {
    updateVisibility();
  }

  function attach(e: any) {
    if (!e || attachedEditor === e) return;
    e?.on?.('selectionUpdate', handleEditorEvent);
    e?.on?.('transaction', handleEditorEvent);
    e?.on?.('update', handleEditorEvent);
    attachedEditor = e;
    updateVisibility();
  }

  function detach() {
    if (!attachedEditor) return;
    attachedEditor?.off?.('selectionUpdate', handleEditorEvent);
    attachedEditor?.off?.('transaction', handleEditorEvent);
    attachedEditor?.off?.('update', handleEditorEvent);
    attachedEditor = null;
  }

  onMount(() => {
    // Initial attach if editor is ready on mount
    if (enabled && editor) attach(editor);
    // Cleanup on unmount
    return () => {
      detach();
    };
  });

  // React to editor or enabled changes (covers HMR + dynamic hosts)
  $: {
    if (enabled && editor) {
      if (attachedEditor !== editor) {
        detach();
        attach(editor);
      } else {
        // Even if same editor, recompute when enabled toggles
        updateVisibility();
      }
    } else {
      // Disabled or no editor → ensure cleanup and hide
      if (attachedEditor) detach();
      showPii = false;
      open = false;
    }
  }

  const getCurrentSelection = () => {
    if (!editor) return null;
    const { state } = editor;
    if (!state || !state.selection) return null;
    const from = state.selection.from;
    const to = state.selection.to;
    if (from === to) return null;
    const text = state.doc.textBetween(from, to).trim();
    if (!text) return null;
    return { from, to, text };
  };

  const addMask = () => {
    const sel = getCurrentSelection();
    if (!sel) return;
    const type = (label || 'CUSTOM').trim().toUpperCase();
    editor?.commands?.addModifier?.({
      action: 'string-mask',
      entity: sel.text,
      type,
      from: sel.from,
      to: sel.to
    });
    open = false;
  };

  const addIgnore = () => {
    const sel = getCurrentSelection();
    if (!sel) return;
    editor?.commands?.addModifier?.({
      action: 'ignore',
      entity: sel.text,
      from: sel.from,
      to: sel.to
    });
    open = false;
  };

  const toggleOpen = () => {
    if (!isValidSelection()) return;
    open = !open;
  };
</script>

{#if enabled && editor && showPii}
  <div class="flex gap-0.5 p-0.5 rounded-lg shadow-lg bg-white text-gray-800 dark:text-white dark:bg-gray-800 min-w-fit">
    <button
      type="button"
      class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all text-xs font-medium flex items-center gap-1"
      on:click={toggleOpen}
      title="PII Modifier: Add or ignore PII"
    >
      🛡️ Masking
    </button>

    {#if open}
      <div class="flex items-center gap-2 px-2 py-1 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <input
          class="w-28 px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-xs text-gray-800 dark:text-gray-100"
          type="text"
          bind:value={label}
          on:keydown={(e) => {
            if (e.key === 'Enter') addMask();
            e.stopPropagation();
          }}
          placeholder="PII Modifier: Label (e.g., PERSON)"
        />

        <button
          type="button"
          class="px-2 py-1 rounded-md bg-amber-400/90 hover:bg-amber-400 text-gray-900 text-xs font-semibold"
          on:click={addMask}
          title="PII Modifier: Mask selection"
        >
          Mask
        </button>

        <button
          type="button"
          class="px-2 py-1 rounded-md bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs font-medium"
          on:click={addIgnore}
          title="PII Modifier: Ignore selection"
        >
          Ignore
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* No custom styles; rely on Tailwind utility classes from project */
</style>


