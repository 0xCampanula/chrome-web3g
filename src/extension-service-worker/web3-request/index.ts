import { Config, getConfig } from '../config';
import { web3Url } from '../web3-url';
import { Client } from 'web3gprotocol';

// A key-value dictionary of HTTP headers.
// Keys are case-insensitive.
interface httpHeaders {
	[key: string]: string
}

// The result of fetching a ERC-4804 URL.
export interface web3FetchResult {
	output: ReadableStream;
	httpCode: number;
	httpHeaders: httpHeaders;
}

// Chain data as returned by Config.toDefaultChainListData().
interface chainListEntry {
	id: number;
	name: string;
	shortName: string;
	rpcUrls: string[];
	contracts: any;
}

export class web3Client {
	config: Config;
	constructor() {
		this.config = getConfig();
	}

	// Fetches the URL with every chain pinned to a single RPC endpoint (by
	// index), so that one attempt is served exclusively by one provider.
	protected fetchWithPinnedEndpoint = async (url: web3Url, chainList: chainListEntry[], endpointIndex: number, bypassChunkCache = false, byteStart: number | null = null): Promise<web3FetchResult> => {
		// Only the requested chain needs pinning; the rest are passed through.
		const pinnedChainList = chainList.map((chain) => {
			if (chain.id !== url.chainId || chain.rpcUrls.length === 0) {
				return chain;
			}
			return {...chain, 'rpcUrls': [chain.rpcUrls[endpointIndex % chain.rpcUrls.length]]};
		});
		const client = new Client(pinnedChainList, {
			'multipleRpcMode': 'fallback',
		});
		// bypassChunkCache/byteStart are consumed by the library's fetchUrl
		// (JSDoc-typed JS API); the assertion sidesteps its inferred options
		// shape.
		return client.fetchUrl(url.toString(), {
			'bypassChunkCache': bypassChunkCache,
			'byteStart': byteStart,
		} as any);
	}

	fetchUrl = async (url: web3Url, bypassChunkCache = false, byteStart: number | null = null): Promise<web3FetchResult> => {
		const chainList: chainListEntry[] = await this.config.toDefaultChainListData();
		let rpcUrlCount = 0;
		for (let chain of chainList) {
			if (chain.id == url.chainId) {
				rpcUrlCount = chain.rpcUrls.length;
				break;
			}
		}
		if (rpcUrlCount == 0) {
			throw new Error('No RPC endpoint configured for chain ' + url.chainId);
		}
		// Single-endpoint serving: only one configured endpoint serves a
		// request. The next endpoint is tried only when the request fails
		// before the response is established (mid-stream failures cannot be
		// retried transparently and are surfaced as-is). Errors marked
		// nonRetriable (bad URL, contract has no such resource on this chain)
		// are endpoint-independent: other endpoints would fail identically,
		// so stop immediately instead of burning their rate limits.
		let lastError: any = null;
		for (let i = 0; i < rpcUrlCount; i++) {
			try {
				return await this.fetchWithPinnedEndpoint(url, chainList, i, bypassChunkCache, byteStart);
			} catch (e) {
				lastError = e;
				if (e && (e as any).nonRetriable) {
					throw e;
				}
			}
		}
		throw lastError;
	}
};
