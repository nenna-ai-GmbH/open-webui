<script lang="ts">
	import { getContext } from 'svelte';
	const i18n = getContext('i18n');

	export let uploadProgress: number = 0; // 0-100
	export let piiProgress: number = 0; // 0-100
	export let currentPhase: 'uploading' | 'processing' | 'complete' = 'uploading';
	export let status: string = '';
	export let size: 'small' | 'normal' = 'normal';

	// Calculate overall progress - upload is 30%, PII processing is 70%
	$: overallProgress = currentPhase === 'uploading' 
		? uploadProgress * 0.3
		: currentPhase === 'processing'
			? 30 + (piiProgress * 0.7)
			: 100;

	$: progressText = currentPhase === 'uploading' 
		? `${$i18n.t('Uploading')}... ${uploadProgress}%`
		: currentPhase === 'processing'
			? status || `${$i18n.t('Processing')}... ${Math.round(overallProgress)}%`
			: $i18n.t('Complete');

	$: barHeight = size === 'small' ? 'h-1.5' : 'h-2';
	$: textSize = size === 'small' ? 'text-xs' : 'text-sm';
</script>

<div class="w-full">
	{#if size === 'normal'}
		<div class="flex items-center justify-between mb-1">
			<span class="{textSize} text-gray-600 dark:text-gray-400 font-medium">
				{progressText}
			</span>
			<span class="{textSize} text-gray-500 dark:text-gray-500">
				{Math.round(overallProgress)}%
			</span>
		</div>
	{/if}

	<div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full {barHeight} overflow-hidden">
		<div 
			class="bg-gradient-to-r {currentPhase === 'uploading' 
				? 'from-blue-500 to-blue-600' 
				: currentPhase === 'processing'
					? 'from-yellow-500 to-orange-500'
					: 'from-green-500 to-green-600'} {barHeight} rounded-full transition-all duration-300 ease-out"
			style="width: {overallProgress}%"
		>
			{#if currentPhase === 'processing'}
				<!-- Animated stripe effect for processing -->
				<div class="w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent 
					animate-pulse rounded-full"></div>
			{/if}
		</div>
	</div>

	{#if size === 'small'}
		<div class="mt-1">
			<span class="{textSize} text-gray-500 dark:text-gray-500">
				{progressText}
			</span>
		</div>
	{/if}
</div> 