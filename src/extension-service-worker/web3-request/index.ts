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

// A fetched response is trusted once this many RPC endpoints have returned
// byte-identical content for it.
const consensusTarget = 3;
// To tolerate endpoint failures, more than consensusTarget endpoints are
// queried in parallel (capped by this number and by the configured endpoints).
const maxParallelEndpoints = 5;

interface consensusGroup {
	bytes: Uint8Array;
	result: web3FetchResult;
	count: number;
}

// Reads a ReadableStream fully into a single Uint8Array.
async function readStreamBytes(stream: ReadableStream): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	while (true) {
		const read = await reader.read();
		if (read.done) {
			break;
		}
		if (read.value !== undefined && read.value !== null) {
			chunks.push(read.value);
			totalLength += read.value.length;
		}
	}
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (let chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

async function hashBytes(data: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	let hex = '';
	for (let byte of new Uint8Array(digest)) {
		hex += byte.toString(16).padStart(2, '0');
	}
	return hex;
}

function bytesToStream(bytes: Uint8Array): ReadableStream {
	return new ReadableStream({
		start(controller) {
			if (bytes.length > 0) {
				controller.enqueue(bytes);
			}
			controller.close();
		},
	});
}

export class web3Client {
	config: Config;
	constructor() {
		this.config = getConfig();
	}

	// Fetches the URL with every chain pinned to a single RPC endpoint (by
	// index), so that one attempt is served exclusively by one provider and
	// responses can be compared provider-by-provider.
	protected fetchWithPinnedEndpoint = async (url: web3Url, chainList: chainListEntry[], endpointIndex: number): Promise<web3FetchResult> => {
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
		return client.fetchUrl(url.toString());
	}

	fetchUrl = async (url: web3Url): Promise<web3FetchResult> => {
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
		// Consensus is reached once `target` endpoints returned identical content.
		// Chains with fewer configured endpoints require all of them to agree.
		const target = Math.min(consensusTarget, rpcUrlCount);
		const queryCount = Math.min(maxParallelEndpoints, rpcUrlCount);

		return new Promise<web3FetchResult>((resolve, reject) => {
			const groups: {[hash: string]: consensusGroup} = {};
			let successCount = 0;
			let failureCount = 0;
			let firstError: any = null;
			let finished = false;
			const checkAllSettled = () => {
				if (finished) {
					return;
				}
				if (successCount + failureCount < queryCount) {
					return;
				}
				finished = true;
				if (successCount == 0 && firstError !== null) {
					reject(firstError);
				} else {
					reject(new Error('RPC endpoints returned conflicting content: no ' + target + '-way consensus reached'));
				}
			};
			for (let i = 0; i < queryCount; i++) {
				(async (endpointIndex: number) => {
					try {
						const result = await this.fetchWithPinnedEndpoint(url, chainList, endpointIndex);
						const bytes = await readStreamBytes(result.output);
						const hash = result.httpCode + ':' + (await hashBytes(bytes));
						if (finished) {
							return;
						}
						successCount++;
						if (groups[hash] === undefined) {
							groups[hash] = {
								'bytes': bytes,
								'result': result,
								'count': 0,
							};
						}
						groups[hash].count++;
						if (groups[hash].count >= target) {
							finished = true;
							const winner = groups[hash];
							winner.result.output = bytesToStream(winner.bytes);
							resolve(winner.result);
							return;
						}
						checkAllSettled();
					} catch (e) {
						if (finished) {
							return;
						}
						failureCount++;
						if (firstError === null) {
							firstError = e;
						}
						checkAllSettled();
					}
				})(i);
			}
		});
	}
};
