<script lang="ts">
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
</script>

<h1>{data.eager}</h1>

{#await data.lazy}
	<p>waiting for the slow part…</p>
{:then value}
	<p>{value}</p>
{/await}
