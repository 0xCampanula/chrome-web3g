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
	56,       // BNB Smart Chain
	97,       // BNB Smart Chain Testnet
	42161,    // Arbitrum One
	43114,    // Avalance C-Chain
	43113,    // Avalanche Fuji Testnet
	11155111, // Sepolia
	100011,   // QuarkChain L2
];

// Bundled icon file per chain short name (served by options-handler under
// options/chains/). Chains without an entry show no icon.
const chainIconFiles: {[shortName: string]: string} = {
	'eth':    'eth.webp',
	'oeth':   'oeth.webp',
	'arb1':   'arb1.webp',
	'avax':   'avax.webp',
	'sep':    'sep.webp',
	'fuji':   'fuji.webp',
	'bnb':    'bnb.webp',
	'bnbt':   'bnb.webp',
	'qkc-l2': 'qkc.webp',
};

interface ChainConfigData {
	ChainID: number;
	Configured: boolean;
	RPCEndpoints: string[];
	// Display name, only present for user-defined custom chains.
	Name?: string;
};

export function CheckSupportableEndpointURL(endpointURL: string, allowUnencrypted: boolean) {
	if (!endpointURL) {
		return '端点 URL 为空';
	}
	if (endpointURL.indexOf('$') !== -1) {
		return "URL 不能包含 '$'";
	}
	if (endpointURL.startsWith(wssScheme)) {
		return '不支持 WebSocket 端点';
	}
	if (!allowUnencrypted && endpointURL.startsWith(httpScheme)) {
		return '不支持未加密的 HTTP 端点';
	}
	if (!endpointURL.startsWith(httpsScheme)) {
		if (allowUnencrypted) {
			if (endpointURL.startsWith(httpScheme)) {
				return '';
			}
			return `端点必须以 ${httpsScheme} 或 ${httpScheme} 开头`;
		}
		return `端点必须以 ${httpsScheme} 开头`;
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
	readonly DefaultEndpoints: string[];
	readonly DefaultChainData: DefaultChainData;

	constructor(configData: ChainConfigData, defaultData: DefaultChainData, defaultEndpoints: string[]) {
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
		// Lookup is case-insensitive: chainlist short names are not consistently
		// lowercased (e.g. "Fuji").
		const iconFile = chainIconFiles[this.ShortName.toLowerCase()];
		if (iconFile === undefined) {
			return null;
		}
		return `${chromeExtensionPrefix}options/chains/${iconFile}`
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
		this.hasOpenedOptionsPageData = conf.HasOpenedOptionsPage === true;
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
			let defaultEndpoints: string[] = [];
			for (let rpcEndpointURL of defaultChain.rpcUrls) {
				if (CheckSupportableEndpointURL(rpcEndpointURL, false) === '') {
					defaultEndpoints.push(rpcEndpointURL);
				}
			}
			let chainConfig = new ChainConfig(chainConfigData, defaultChain, defaultEndpoints);
			chainConfigs.push(chainConfig);
			chainConfigsByID[chainConfig.ChainID] = chainConfig;
		}
		// Merge user-defined custom chains: only entries explicitly added
		// through the options page (they carry a Name marker) are resurrected
		// as custom chains. Stale configured entries left over from pruned
		// built-in chains are ignored, so the options page lists exactly the
		// built-in chains plus whatever the user added themselves.
		for (let chainConfData of conf.ChainConfigs) {
			if (chainConfData.Name === undefined || defaultChainIDs.has(chainConfData.ChainID)) {
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
			throw new Error('链 ID 必须为正整数');
		}
		if (this.chainConfigsByID[chainID]) {
			throw new Error('链 ' + chainID + ' 已在列表中');
		}
		if (rpcEndpoints.length == 0) {
			throw new Error('至少需要一个 RPC 端点');
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
			throw new Error('只能删除自定义链');
		}
		this.chainConfigs = this.chainConfigs.filter(chainConfig => chainConfig.ChainID !== chainID);
		delete this.chainConfigsByID[chainID];
		await this.save();
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
