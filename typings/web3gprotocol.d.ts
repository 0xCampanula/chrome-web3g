declare module 'web3gprotocol' {
	export class Client {
		constructor(chainList: any[], opts: any);
		fetchUrl(url: string, options?: {bypassChunkCache?: boolean, byteStart?: number | null}): Promise<any>;
	}
};
declare module 'web3gprotocol/chains';
