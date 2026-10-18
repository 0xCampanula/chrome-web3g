declare module 'web3gprotocol' {
	export class Client {
		constructor(chainList: any[], opts: any);
		fetchUrl(url: string): Promise<any>;
	}
};
declare module 'web3gprotocol/chains';
