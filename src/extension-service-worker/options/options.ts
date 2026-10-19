import { getConfig, CheckSupportableEndpointURL } from './../config';

const config = getConfig();

class chainConfigs {
	domInitialized = false;
	allChainsExpanded = false;
	tasks: (() => Promise<any>)[] = [];

	processTasks = async () => {
		if (this.tasks.length > 0) {
			const startTime = Date.now();
			while (this.tasks.length > 0 && (Date.now() - startTime) < 10) {
				const thisTask = this.tasks.shift();
				await thisTask();
			}
		}
		if (this.tasks.length > 0) {
			setTimeout(this.processTasks, 10);
		} else {
			setTimeout(this.processTasks, 100);
		}
	}

	initializeDOMRow = async (chainRow: JQuery) => {
		let chainConfig = await config.getChainConfig(parseInt(chainRow.attr('data-chain-id')));
		chainRow.addClass(chainConfig.isConfigured() ? 'configured' : 'not-configured');
		chainRow.removeClass(chainConfig.isConfigured() ? 'not-configured' : 'configured');
		chainRow.empty();
		let chainCell = $('<td class="chain"/>');
		const iconURL = chainConfig.IconURL();
		if (iconURL !== null) {
			let chainIcon = $('<img class="chain-icon" loading="lazy"/>');
			chainIcon.attr('src', iconURL);
			chainCell.append(chainIcon);
		}
		let chainName = $('<span class="chain-name"/>');
		chainName.text(chainConfig.ChainName);
		chainCell.append(chainName);
		chainRow.append(chainCell);
		let providersCell = $('<td class="providers"/>');
		if (chainConfig.RPCEndpoints.length == 0) {
			let noEndpointConfigured = $('<span class="no-endpoint-configured"/>');
			noEndpointConfigured.text('未配置任何服务商。');
			providersCell.append(noEndpointConfigured);
		} else {
			let isFirst = true;
			for (let rpcEndpointURL of chainConfig.RPCEndpoints) {
				let endpointButton = $('<button class="btn btn-light rpc-endpoint"/>');
				if (isFirst) {
					endpointButton.addClass('first-button');
					isFirst = false;
				}
				let endpointNameSpan = $('<span class="rpc-endpoint-name"/>');
				// Endpoints are always displayed as their full RPC URL: friendly
				// provider names hide the actual node address from the user.
				endpointNameSpan.text(rpcEndpointURL);
				endpointButton.attr('alt', rpcEndpointURL);
				endpointButton.attr('title', rpcEndpointURL);
				endpointButton.append(endpointNameSpan);
				providersCell.append(endpointButton);
			}
		}
		chainRow.append(providersCell);
		let buttonCell = $('<td/>');
		let addProviderTextbox = $('<input type="text" class="form-control add-provider hidden" placeholder="http://localhost:1337"/>');
		addProviderTextbox.blur((async (event: Event) => await this.addNewProvider(event, chainRow, false)).bind(this));
		addProviderTextbox.keypress(((event: KeyboardEvent) => this.addNewProviderKeypress(event, chainRow)).bind(this));
		let addProviderError = $('<span class="add-provider add-provider-error"/>');
		let addProviderButton = $('<button class="btn btn-light add-provider">+</button>');
		addProviderButton.click(((event: Event) => this.focusNewProvider(event, chainRow)).bind(this));
		if (chainConfig.Custom) {
			let removeChainButton = $('<button class="btn btn-outline-danger btn-sm remove-custom-chain first-button">删除链</button>');
			removeChainButton.click((async (event: Event) => await this.removeCustomChain(event, chainRow)).bind(this));
			buttonCell.append(removeChainButton);
		} else if (chainConfig.DefaultEndpoints.length == 0) {
			let noPublicEndpointSpan = $('<span class="no-public-endpoint"/>');
			noPublicEndpointSpan.text('没有可用的公共端点。');
			buttonCell.append(noPublicEndpointSpan);
		} else {
			// Public providers render as a single dropdown: one active RPC per
			// chain, picking an option replaces the configured endpoint. The
			// leading empty option means "no endpoint selected".
			let providerSelect = $('<select class="form-select form-select-sm provider-select" aria-label="RPC节点列表"/>');
			let emptyOption = $('<option/>');
			emptyOption.attr('value', '');
			emptyOption.text('未选择');
			providerSelect.append(emptyOption);
			let selectedUrl = chainConfig.RPCEndpoints.length > 0 ? chainConfig.RPCEndpoints[0] : null;
			let hasSelected = false;
			for (let defaultEndpoint of chainConfig.DefaultEndpoints) {
				let option = $('<option/>');
				option.attr('value', defaultEndpoint);
				option.attr('title', defaultEndpoint);
				option.text(defaultEndpoint);
				if (selectedUrl == defaultEndpoint) {
					option.attr('selected', 'selected');
					hasSelected = true;
				}
				providerSelect.append(option);
			}
			// A user-added endpoint not in the public list: reflect it as the
			// current selection so the dropdown matches reality.
			if (selectedUrl != null && !hasSelected) {
				let option = $('<option/>');
				option.attr('value', selectedUrl);
				option.attr('title', selectedUrl);
				option.text(selectedUrl);
				option.attr('selected', 'selected');
				providerSelect.append(option);
			}
			providerSelect.change((async (event: Event) => await this.usePublicEndpointSelect(event, chainRow, providerSelect)).bind(this));
			buttonCell.append(providerSelect);
		}
		// The add-RPC control lives in the public-provider column, next to
		// the provider dropdown.
		buttonCell.append(addProviderButton);
		buttonCell.append(addProviderTextbox);
		buttonCell.append(addProviderError);
		chainRow.append(buttonCell);
	}

	initializeDOM = async () => {
		if (this.domInitialized) {
			return;
		}
		const chainConfigTable = $('#chain-configs-tbody');
		let criticalChainConfigs = [];
		let nonCriticalChainConfigs = [];
		for (let chainConfig of (await config.getChainConfigs())) {
			if (chainConfig.Critical) {
				criticalChainConfigs.push(chainConfig);
			} else {
				nonCriticalChainConfigs.push(chainConfig);
			}
		}
		let chainConfigs = [];
		for (let chainConfig of criticalChainConfigs) {
			chainConfigs.push(chainConfig);
		}
		for (let chainConfig of nonCriticalChainConfigs) {
			chainConfigs.push(chainConfig);
		}
		let alternate = false;
		let lastWasCritical = true;
		let allChainRows: JQuery[] = [];
		let nonCriticalRows: JQuery[] = [];
		for (let chainConfig of chainConfigs) {
			if (!chainConfig.Critical && lastWasCritical) {
				let transitionRow = $('<tr class="critical-to-not-critical"/>');
				let transitionCell = $('<td colspan="3"/>');
				let transitionButton = $('<button class="btn btn-info show-more">&#x25BC; 显示更多 &#x25BC;</button>');
				transitionButton.click(((event: Event) => this.expandNonCritical(event, chainConfigTable)).bind(this));
				transitionCell.append(transitionButton);
				transitionRow.append(transitionCell);
				chainConfigTable.append(transitionRow);
			}
			let chainRow = $('<tr class="chain-config-row"/>');
			chainRow.attr('data-chain-id', chainConfig.ChainID.toString());
			chainRow.addClass(alternate ? 'table-odd' : 'table-even');
			chainRow.addClass(chainConfig.Critical ? 'critical' : 'not-critical');
			if (chainConfig.Critical) {
				await this.initializeDOMRow(chainRow);
			} else {
				nonCriticalRows.push(chainRow);
			}
			allChainRows.push(chainRow);
			chainConfigTable.append(chainRow);
			alternate = !alternate;
			lastWasCritical = chainConfig.Critical;
		}
		$('#chain-configs .rpc-endpoints-use-public').click((async (event: Event) => await this.useAllPublicEndpointsForAllChains(event, allChainRows)).bind(this));
		$('#add-custom-chain-btn').click((async (event: Event) => await this.addCustomChainFromForm(event)).bind(this));
		const batchSize = 32;
		for (let nonCriticalIndex = 0; nonCriticalIndex < nonCriticalRows.length; nonCriticalIndex += batchSize) {
			let rowsToProcess: JQuery[] = [];
			for (let i = nonCriticalIndex; i < nonCriticalRows.length && i < nonCriticalIndex + batchSize; i++) {
				rowsToProcess.push(nonCriticalRows[i]);
			}
			this.tasks.push(async () => {
				for (let rowToProcess of rowsToProcess) {
					await this.initializeDOMRow(rowToProcess);
					if (this.allChainsExpanded) {
						rowToProcess.show();
					}
				}
			});
		}
		setTimeout(this.processTasks, 1000);
		this.domInitialized = true;
	}

	expandNonCritical = (event: Event, chainConfigTable: JQuery) => {
		event.preventDefault();
		chainConfigTable.find('tr.not-critical').show();
		chainConfigTable.find('button.show-more').hide();
		this.allChainsExpanded = true;
	}

	addCustomChainFromForm = async (event: Event) => {
		event.preventDefault();
		const idInput = $('#custom-chain-id');
		const nameInput = $('#custom-chain-name');
		const rpcInput = $('#custom-chain-rpc');
		const errorSpan = $('#add-custom-chain-error');
		const chainID = parseInt(idInput.val().toString().trim(), 10);
		const chainName = nameInput.val().toString().trim();
		const rpcEndpoint = rpcInput.val().toString().trim();
		let chainConfig;
		try {
			chainConfig = await config.addCustomChain(chainID, chainName, rpcEndpoint === '' ? [] : [rpcEndpoint]);
		} catch (e) {
			errorSpan.text(e instanceof Error ? e.message : String(e));
			errorSpan.show();
			return;
		}
		errorSpan.text('');
		errorSpan.hide();
		idInput.val('');
		nameInput.val('');
		rpcInput.val('');
		// Append a row for the new chain. Custom chains are not critical, and
		// not-critical rows are hidden by default in CSS: show it explicitly.
		let chainRow = $('<tr class="chain-config-row not-critical table-odd"/>');
		chainRow.attr('data-chain-id', chainConfig.ChainID.toString());
		$('#chain-configs-tbody').append(chainRow);
		chainRow.show();
		await this.initializeDOMRow(chainRow);
	}

	removeCustomChain = async (event: Event, chainRow: JQuery) => {
		event.preventDefault();
		if (!window.confirm('确定删除该自定义链？')) {
			return;
		}
		await config.removeChainConfig(parseInt(chainRow.attr('data-chain-id')));
		chainRow.remove();
	}

	focusNewProvider = (event: Event, chainRow: JQuery) => {
		event.preventDefault();
		let addProviderButton = chainRow.find('button.add-provider');
		let addProviderTextbox = chainRow.find('input.add-provider');
		let addProviderError = chainRow.find('.add-provider-error');
		addProviderButton.hide();
		addProviderTextbox.addClass('displayed');
		addProviderTextbox.removeClass('hidden');
		addProviderTextbox.val('');
		addProviderError.text('');
		addProviderError.show();
		addProviderTextbox.focus();
	}

	addNewProvider = async (event: Event, chainRow: JQuery, fromKeyPress: boolean) => {
		event.preventDefault();
		let addProviderButton = chainRow.find('button.add-provider');
		let addProviderTextbox = chainRow.find('input.add-provider');
		let addProviderError = chainRow.find('.add-provider-error');
		let rpcEndpointURL = addProviderTextbox.val().toString().trim();
		if (rpcEndpointURL != '') {
			let errMessage = CheckSupportableEndpointURL(rpcEndpointURL, true);
			if (errMessage != '') {
				addProviderError.text(errMessage);
				if (fromKeyPress) {
					addProviderTextbox.focus();
					addProviderTextbox.select();
				}
			} else {
				// Single-node serving: adding a custom RPC endpoint replaces the
				// whole configured endpoint set with just the new one.
				let chainConfig = await config.getChainConfig(parseInt(chainRow.attr('data-chain-id')));
				chainConfig.setEndpoints([rpcEndpointURL]);
				await config.setChainConfig(chainConfig);
				addProviderError.text('');
				addProviderError.hide();
				addProviderTextbox.val('');
				addProviderTextbox.blur();
				addProviderTextbox.removeClass('displayed');
				addProviderTextbox.addClass('hidden');
				addProviderButton.show();
				this.tasks.push(async () => {
					this.initializeDOMRow(chainRow);
				});
			}
		} else {
			addProviderError.text('');
			addProviderError.hide();
				addProviderTextbox.removeClass('displayed');
				addProviderTextbox.addClass('hidden');
			addProviderButton.show();
		}
	}

	addNewProviderKeypress = (event: KeyboardEvent, chainRow: JQuery) => {
		if (event.key == 'Enter') {
			this.addNewProvider(event, chainRow, true);
		}
	}

	usePublicEndpointSelect = async (event: Event, chainRow: JQuery, providerSelect: JQuery) => {
		// Single-node serving: picking an endpoint replaces the whole
		// configured endpoint set with just that one; the empty option clears
		// the chain's selection entirely (no endpoint configured).
		let chainConfig = await config.getChainConfig(parseInt(chainRow.attr('data-chain-id')));
		const selectedUrl = (providerSelect.val() as string) || null;
		chainConfig.setEndpoints(selectedUrl === null ? [] : [selectedUrl]);
		await config.setChainConfig(chainConfig);
		this.tasks.push(async () => {
			this.initializeDOMRow(chainRow);
		});
	}

	// Measures RPC endpoint latency with a minimal eth_chainId JSON-RPC
	// call. Returns null on network failure, an invalid response, or after
	// 10 seconds (treated as a timeout: the endpoint is skipped).
	measureEndpointLatency = async (endpointURL: string): Promise<number | null> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10000);
		const startTime = Date.now();
		try {
			// text/plain keeps this a CORS-simple request (no preflight);
			// JSON-RPC servers parse the body regardless of the content type.
			const response = await fetch(endpointURL, {
				method: 'POST',
				headers: {'Content-Type': 'text/plain'},
				body: JSON.stringify({'jsonrpc': '2.0', 'id': 1, 'method': 'eth_chainId', 'params': []}),
				signal: controller.signal,
			});
			if (!response.ok) {
				return null;
			}
			const data = await response.json();
			if (data == null || data.result === undefined) {
				return null;
			}
			return Date.now() - startTime;
		} catch (e) {
			return null;
		} finally {
			clearTimeout(timeout);
		}
	}

	// Picks the fastest endpoint for one chain: all of its public endpoints
	// are probed in parallel and the lowest-latency one wins. If every
	// endpoint times out or fails, the chain's current configuration is
	// left untouched.
	pickFastestEndpoint = async (chainRow: JQuery) => {
		let chainConfig = await config.getChainConfig(parseInt(chainRow.attr('data-chain-id')));
		if (chainConfig.Custom || chainConfig.DefaultEndpoints.length == 0) {
			return;
		}
		const probed = await Promise.all(chainConfig.DefaultEndpoints.map(async (endpointURL) => {
			return {endpointURL: endpointURL, latency: await this.measureEndpointLatency(endpointURL)};
		}));
		let best: {endpointURL: string, latency: number} = null;
		for (const entry of probed) {
			if (entry.latency !== null && (best === null || entry.latency < best.latency)) {
				best = entry;
			}
		}
		if (best !== null) {
			chainConfig.setEndpoints([best.endpointURL]);
		} else {
			// No endpoint responded in time (rate-limited gateways such as
			// thirdweb/Ankr/Pocket tend to fail or stall together): fall back
			// to the first curated endpoint so auto-configuration always
			// yields a selection instead of silently leaving the chain
			// unconfigured.
			chainConfig.setEndpoints([chainConfig.DefaultEndpoints[0]]);
		}
		await config.setChainConfig(chainConfig);
		this.tasks.push(async () => {
			this.initializeDOMRow(chainRow);
		});
	}

	useAllPublicEndpointsForAllChains = async (event: Event, allChainRows: JQuery[]) => {
		event.preventDefault();
		// "自动配置" now benchmarks latency: every chain gets its fastest
		// public endpoint instead of blindly picking the first one.
		const button = $(event.currentTarget) as JQuery;
		const originalText = button.text();
		button.prop('disabled', true);
		button.text('测速中...');
		try {
			await Promise.all(allChainRows.map((chainRow) => this.pickFastestEndpoint(chainRow)));
		} finally {
			button.prop('disabled', false);
			button.text(originalText);
		}
	}

}

$(() => {
	const page = new chainConfigs();
	page.initializeDOM().then(() => page.processTasks());
});
