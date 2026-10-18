import { getDefaultChainList } from 'web3gprotocol/chains';

interface DefaultChainData {
	id: number;
	name: string;
	shortName: string;
	rpcUrls: string[];
	contracts: any;
};

const chromeExtensionPrefix = chrome.runtime.getURL('/');
const keyVersion = chromeExtensionPrefix + 'version';
const keyConfigData = chromeExtensionPrefix + 'config';
const configurationVersion = 1;
const httpsScheme = 'https://';
const httpScheme = 'http://';
const wssScheme = 'wss://';

const criticalChainIDs: number[] = [
	1,        // Ethereum
	10,       // OP Mainnet
	100,      // Gnosis
	137,      // Polygon Mainnet
	314,      // Filecoin Mainnet
	324,      // ZKSync Era Mainnet
	5000,     // Mantle Mainnet
	8453,     // Base
	42161,    // Arbitrum One
	43114,    // Avalance C-Chain
	7777777,  // Zora
];

const domainNameToEntity: {[name: string]: string} = {
	'mycryptoapi.com': 'MyCrypto',
	'cloudflare-eth.com': 'Cloudflare',
	'publicnode.com': 'PublicNode',
	'optimism.io': 'Optimism Foundation',
	'gnosischain.com': 'GnosisDAO',
	'gateway.fm': 'Gateway.fm',
	'ankr.com': 'Ankr',
	'pokt.network': 'POKT Network',
	'blastapi.io': 'Bware Labs',
	'onfinality.io': 'OnFinality',
	'blockpi.network': 'BlockPI',
	'polygon-rpc.com': 'Ankr',
	'matic.network': 'Polygon Labs',
	'chainstacklabs.com': 'Chainstack',
	'maticvigil.com': 'BlockVigil',
	'quiknode.pro': 'QuickNode',
	'bwarelabs.com': 'Bware Labs',
	'ftm.tools': 'Ankr',
	'glif.io': 'GLIF',
	'zksync.io': 'Matter Labs',
	'web3q.io': 'EthStorage',
	'mantle.xyz': 'Mantle',
	'base.org': 'Coinbase',
	'arbitrum.io': 'Offchain Labs',
	'avax.network': 'Avalanche Foundation',
	'zora.energy': 'Zora Labs',
};

interface ChainConfigData {
	ChainID: number;
	Configured: boolean;
	RPCEndpoints: string[];
	// Display name, only present for user-defined custom chains.
	Name?: string;
};

export class DefaultEndpoint {
	Name: string;
	EndpointURL: string;

	constructor(name: string, endpointURL: string) {
		this.Name = name;
		this.EndpointURL = endpointURL;
	}

	FriendlyName = (): string => {
		if (this.Name) {
			return this.Name;
		}
		let domainName = this.EndpointURL;
		if (domainName.startsWith(httpsScheme)) {
			domainName = domainName.substring(httpsScheme.length);
		}
		if (domainName.startsWith(httpScheme)) {
			domainName = domainName.substring(httpScheme.length);
		}
		let indexOfSlash = domainName.indexOf('/');
		if (indexOfSlash !== -1) {
			domainName = domainName.substring(0, indexOfSlash);
		}
		let indexOfColon = domainName.indexOf(':');
		if (indexOfColon !== -1) {
			domainName = domainName.substring(0, indexOfColon);
		}
		let fullDomainName = domainName;
		let indexOfPeriod = domainName.indexOf('.');
		while (indexOfPeriod !== -1) {
			if (domainName in domainNameToEntity) {
				return domainNameToEntity[domainName];
			}
			domainName = domainName.substring(indexOfPeriod + ('.'.length));
			indexOfPeriod = domainName.indexOf('.');
		}
		if (fullDomainName.startsWith('www.')) {
			fullDomainName = fullDomainName.substring('www.'.length);
		}
		return fullDomainName;
	}
}

export function CheckSupportableEndpointURL(endpointURL: string, allowUnencrypted: boolean) {
	if (!endpointURL) {
		return 'Endpoint URL is empty';
	}
	if (endpointURL.indexOf('$') !== -1) {
		return "URL cannot contain '$'";
	}
	if (endpointURL.startsWith(wssScheme)) {
		return 'WebSocket endpoints not supported';
	}
	if (!allowUnencrypted && endpointURL.startsWith(httpScheme)) {
		return 'Non-encrypted HTTP endpoints not supported';
	}
	if (!endpointURL.startsWith(httpsScheme)) {
		if (allowUnencrypted) {
			if (endpointURL.startsWith(httpScheme)) {
				return '';
			}
			return `Endpoint must start with ${httpsScheme} or ${httpScheme}`;
		}
		return `Endpoint must start with ${httpsScheme}`;
	}
	return '';
}

interface ConfigData {
	HasOpenedOptionsPage: boolean;
	ChainConfigs: ChainConfigData[];
};

export class ChainConfig {
	ChainID: number;
	ChainName: string;
	ShortName: string;
	Configured: boolean;
	Critical: boolean;
	// True when the chain was added by the user and is not part of the
	// built-in chain list. Custom chains can be removed from the options page.
	Custom: boolean;
	RPCEndpoints: string[];
	readonly DefaultEndpoints: DefaultEndpoint[];
	readonly DefaultChainData: DefaultChainData;

	constructor(configData: ChainConfigData, defaultData: DefaultChainData, defaultEndpoints: DefaultEndpoint[]) {
		this.ChainID = configData.ChainID;
		this.ChainName = defaultData.name;
		this.ShortName = defaultData.shortName;
		this.Configured = configData.Configured;
		this.Custom = false;
		this.RPCEndpoints = configData.RPCEndpoints;
		this.DefaultEndpoints = defaultEndpoints;
		this.DefaultChainData = defaultData;
		this.Critical = criticalChainIDs.includes(this.ChainID);
	}

	configData = (): ChainConfigData => {
		const data: ChainConfigData = {
			'ChainID': this.ChainID,
			'Configured': this.Configured,
			'RPCEndpoints': this.RPCEndpoints,
		};
		if (this.Custom && this.ChainName) {
			data.Name = this.ChainName;
		}
		return data;
	}

	toDefaultChainListData = (): DefaultChainData => {
		return {
			'id': this.ChainID,
			'name': this.ChainName,
			'shortName': this.ShortName,
			'rpcUrls': this.RPCEndpoints,
			'contracts': this.DefaultChainData.contracts,
		};
	}

	IconURL = (): string => {
		if (!this.Critical) {
			return null;
		}
		let shortName = this.ShortName;
		if (this.ShortName === undefined) {
			shortName = this.ChainName;
		}
		shortName = shortName.toLowerCase().replace(/ +/g, '_');
		return `${chromeExtensionPrefix}options/chains/${shortName}.webp`
	}

	isConfigured = (): boolean => {
		return this.Configured;
	}

	setEndpoints = (rpcEndpoints: string[]) => {
		this.RPCEndpoints = rpcEndpoints;
		this.Configured = rpcEndpoints.length > 0;
	}
}

interface ChainConfigMapping {
	[key: number]: ChainConfig;
}

export class Config {
	initialized = false;
	hasOpenedOptionsPageData = false;
	chainConfigs: ChainConfig[];
	chainConfigsByID: ChainConfigMapping;

	constructor() {
		this.chainConfigs = [];
	}
	protected initialize = async () => {
		if (this.initialized) {
			return;
		}
		const confBits = await chrome.storage.local.get({[keyVersion]: null});
		if (confBits[keyVersion] === null) {
			const initialConfig: ConfigData = {
				'HasOpenedOptionsPage': false,
				'ChainConfigs': [],
			};
			await chrome.storage.local.set({
				[keyConfigData]: initialConfig,
				[keyVersion]: configurationVersion,
			});
		}
		chrome.storage.onChanged.addListener(this.reload);
		// Note: an incompatible stored version is not fatal -- reload() resets
		// the configuration to defaults instead of breaking the extension.
		await this.reload();
		this.initialized = true;
	}
	protected reload = async () => {
		const confBits = await chrome.storage.local.get({
			[keyVersion]: null,
			[keyConfigData]: null,
		});
		if (confBits[keyVersion] !== configurationVersion) {
			// The stored configuration comes from an incompatible version of the
			// extension: reset it to defaults rather than failing outright. The
			// "has opened options page" flag is preserved so users upgrading are
			// not greeted with the options page again.
			console.warn('web3: incompatible configuration version, resetting to defaults');
			const existing: ConfigData = confBits[keyConfigData];
			const freshConfig: ConfigData = {
				'HasOpenedOptionsPage': existing != null && existing.HasOpenedOptionsPage === true,
				'ChainConfigs': [],
			};
			await chrome.storage.local.set({
				[keyConfigData]: freshConfig,
				[keyVersion]: configurationVersion,
			});
			confBits[keyConfigData] = freshConfig;
		}
		const conf: ConfigData = confBits[keyConfigData]
		let chainConfigs: ChainConfig[] = [];
		let chainConfigsByID: ChainConfigMapping = {};
		const defaultChains: DefaultChainData[] = getDefaultChainList();
		const defaultChainIDs = new Set<number>();
		for (let defaultChain of defaultChains) {
			defaultChainIDs.add(defaultChain.id);
			let chainConfigData: ChainConfigData = null;
			for (let chainConfData of conf.ChainConfigs) {
				if (chainConfData.Configured && chainConfData.ChainID == defaultChain.id) {
					chainConfigData = chainConfData;
					break;
				}
			}
			if (chainConfigData == null) {
				chainConfigData = {
					'ChainID': defaultChain.id,
					'Configured': false,
					'RPCEndpoints': [],
				};
			}
			let defaultEndpoints: DefaultEndpoint[] = [];
			for (let rpcEndpointURL of defaultChain.rpcUrls) {
				if (CheckSupportableEndpointURL(rpcEndpointURL, false) === '') {
					defaultEndpoints.push(new DefaultEndpoint(null, rpcEndpointURL));
				}
			}
			let chainConfig = new ChainConfig(chainConfigData, defaultChain, defaultEndpoints);
			chainConfigs.push(chainConfig);
			chainConfigsByID[chainConfig.ChainID] = chainConfig;
		}
		// Merge user-defined custom chains: entries whose chain ID is not in the
		// built-in list (never was, or was pruned from it) are kept as custom
		// chains, so users of removed chains can keep browsing them. Entries
		// explicitly added through the options page carry a Name marker and are
		// kept even if all their endpoints were removed again.
		for (let chainConfData of conf.ChainConfigs) {
			if ((!chainConfData.Configured && chainConfData.Name === undefined) || defaultChainIDs.has(chainConfData.ChainID)) {
				continue;
			}
			const syntheticDefaultData: DefaultChainData = {
				'id': chainConfData.ChainID,
				'name': chainConfData.Name || ('Chain ' + chainConfData.ChainID),
				'shortName': String(chainConfData.ChainID),
				'rpcUrls': [],
				'contracts': {},
			};
			let customConfig = new ChainConfig(chainConfData, syntheticDefaultData, []);
			customConfig.Custom = true;
			chainConfigs.push(customConfig);
			chainConfigsByID[customConfig.ChainID] = customConfig;
		}
		this.chainConfigs = chainConfigs;
		this.chainConfigsByID = chainConfigsByID;
	}
	getChainConfigs = async (): Promise<ChainConfig[]> => {
		await this.initialize();
		return this.chainConfigs;
	}
	getChainConfig = async (chainID: number): Promise<ChainConfig> => {
		await this.initialize();
		return this.chainConfigsByID[chainID] || null;
	}
	toDefaultChainListData = async (): Promise<DefaultChainData[]> => {
		await this.initialize();
		let allData: DefaultChainData[] = [];
		for (let chainConfig of this.chainConfigs) {
			allData.push(chainConfig.toDefaultChainListData());
		}
		return allData;
	}
	setChainConfig = async (chainConfig: ChainConfig) => {
		await this.initialize();
		const existing = this.chainConfigsByID[chainConfig.ChainID];
		if (!existing) {
			this.chainConfigs.push(chainConfig);
		} else {
			for (let i in this.chainConfigs) {
				if (this.chainConfigs[i].ChainID == chainConfig.ChainID) {
					this.chainConfigs[i] = chainConfig;
					break;
				}
			}
		}
		this.chainConfigsByID[chainConfig.ChainID] = chainConfig;
		await this.save();
	}
	addCustomChain = async (chainID: number, chainName: string, rpcEndpoints: string[]): Promise<ChainConfig> => {
		await this.initialize();
		if (!Number.isInteger(chainID) || chainID <= 0) {
			throw new Error('Chain ID must be a positive integer');
		}
		if (this.chainConfigsByID[chainID]) {
			throw new Error('Chain ' + chainID + ' is already listed');
		}
		if (rpcEndpoints.length == 0) {
			throw new Error('At least one RPC endpoint is required');
		}
		for (let rpcEndpoint of rpcEndpoints) {
			const errMessage = CheckSupportableEndpointURL(rpcEndpoint, true);
			if (errMessage !== '') {
				throw new Error(errMessage);
			}
		}
		const chainConfigData: ChainConfigData = {
			'ChainID': chainID,
			'Configured': true,
			'RPCEndpoints': [...rpcEndpoints],
			'Name': chainName,
		};
		const syntheticDefaultData: DefaultChainData = {
			'id': chainID,
			'name': chainName || ('Chain ' + chainID),
			'shortName': String(chainID),
			'rpcUrls': [],
			'contracts': {},
		};
		let chainConfig = new ChainConfig(chainConfigData, syntheticDefaultData, []);
		chainConfig.Custom = true;
		await this.setChainConfig(chainConfig);
		return chainConfig;
	}
	removeChainConfig = async (chainID: number) => {
		await this.initialize();
		const existing = this.chainConfigsByID[chainID];
		if (!existing || !existing.Custom) {
			throw new Error('Only custom chains can be removed');
		}
		this.chainConfigs = this.chainConfigs.filter(chainConfig => chainConfig.ChainID !== chainID);
		delete this.chainConfigsByID[chainID];
		await this.save();
	}
	addDefaultEndpointsToAllChainConfigs = async () => {
		await this.initialize();
		let anythingChanged = false;
		for (let i in this.chainConfigs) {
			let chainConfig = this.chainConfigs[i];
			let chainChanged = false;
			let newEndpoints = [...chainConfig.RPCEndpoints];
			for (let defaultEndpoint of chainConfig.DefaultEndpoints) {
				let alreadyAdded = false;
				for (let existingEndpoint of chainConfig.RPCEndpoints) {
					if (defaultEndpoint.EndpointURL === existingEndpoint) {
						alreadyAdded = true;
						break;
					}
				}
				if (!alreadyAdded) {
					newEndpoints.push(defaultEndpoint.EndpointURL);
					chainChanged = true;
				}
			}
			if (chainChanged) {
				chainConfig.setEndpoints(newEndpoints);
				this.chainConfigs[i] = chainConfig;
				this.chainConfigsByID[chainConfig.ChainID] = chainConfig;
				anythingChanged = true;
			}
		}
		if (anythingChanged) {
			await this.save();
		}
	}
	hasOpenedOptionsPage = async (): Promise<boolean> => {
		await this.initialize();
		return this.hasOpenedOptionsPageData;
	}
	setHasOpenedOptionsPage = async (openedOptionsPage: boolean) => {
		await this.initialize();
		this.hasOpenedOptionsPageData = openedOptionsPage;
		await this.save();
	}
	protected save = async () => {
		await this.initialize();
		let conf: ConfigData = {
			'HasOpenedOptionsPage': this.hasOpenedOptionsPageData,
			'ChainConfigs': [],
		};
		// Only chains the user actually touched are persisted; untouched
		// built-in chains are rebuilt from the defaults on reload.
		for (let chainConfig of this.chainConfigs) {
			if (!chainConfig.Configured && !chainConfig.Custom) {
				continue;
			}
			conf.ChainConfigs.push(chainConfig.configData());
		}
		await chrome.storage.local.set({
			[keyConfigData]: conf,
			[keyVersion]: configurationVersion,
		});
	}
}

const globalConfig = new Config();

export function getConfig(): Config {
	return globalConfig;
}
