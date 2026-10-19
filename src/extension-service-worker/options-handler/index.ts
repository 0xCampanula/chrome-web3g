const optionsHtml = require('./../options/options.html').default;
const optionsBootstrapJS = require('./../options/bootstrap.raw.js').default;
const optionsJQueryJS = require('./../options/jquery.raw.js').default;
const optionsBootstrapCSS = require('./../options/bootstrap.css').default;
const optionsCSS = require('./../options/options.scss').default;
const optionsJS = require('raw-loader!@chrome-web3-extension-options/options.js').default;
const optionsEthereumSVG = require('./../options/ethereum.svg').default;
const notFoundHtml = require('./../options/not-found.html').default;

const optionsChainsArbitrumOne = require('./../options/chains/arb1.webp');
const optionsChainsAvalanche = require('./../options/chains/avax.webp');
const optionsChainsBNB = require('./../options/chains/bnb.webp');
const optionsChainsEthereum = require('./../options/chains/eth.webp');
const optionsChainsFuji = require('./../options/chains/fuji.webp');
const optionsChainsOPMainnet = require('./../options/chains/oeth.webp');
const optionsChainsQuarkChain = require('./../options/chains/qkc.webp');
const optionsChainsSepolia = require('./../options/chains/sep.webp');

function makeResponse(data: string|Uint8Array, status: number, mimeType: string): Response {
	return new Response(new Blob([data]), {
		'status': status,
		'headers': {
			'content-type': mimeType,
		},
	});
}

function stringToUint8(bin: string): Uint8Array {
	let array = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		array[i] = bin.charCodeAt(i);
	}
	return array;
}

interface assetEntry {
	data: string | Uint8Array;
	mimeType: string;
}

// All servable options-page assets, keyed by request path.
const assets: {[url: string]: assetEntry} = {
	'options':                        {'data': optionsHtml,           'mimeType': 'text/html; charset=utf-8'},
	'options/bootstrap.raw.js':       {'data': optionsBootstrapJS,    'mimeType': 'text/javascript; charset=utf-8'},
	'options/jquery.raw.js':          {'data': optionsJQueryJS,       'mimeType': 'text/javascript; charset=utf-8'},
	'options/bootstrap.css':          {'data': optionsBootstrapCSS,   'mimeType': 'text/css; charset=utf-8'},
	'options/options.css':            {'data': optionsCSS,            'mimeType': 'text/css; charset=utf-8'},
	'options/options.js':             {'data': optionsJS,             'mimeType': 'text/javascript; charset=utf-8'},
	'options/ethereum.svg':           {'data': optionsEthereumSVG,    'mimeType': 'image/svg+xml'},
	'options/chains/arb1.webp':       {'data': stringToUint8(optionsChainsArbitrumOne), 'mimeType': 'image/webp'},
	'options/chains/avax.webp':       {'data': stringToUint8(optionsChainsAvalanche),   'mimeType': 'image/webp'},
	'options/chains/bnb.webp':        {'data': stringToUint8(optionsChainsBNB),         'mimeType': 'image/webp'},
	'options/chains/eth.webp':        {'data': stringToUint8(optionsChainsEthereum),    'mimeType': 'image/webp'},
	'options/chains/fuji.webp':       {'data': stringToUint8(optionsChainsFuji),        'mimeType': 'image/webp'},
	'options/chains/oeth.webp':       {'data': stringToUint8(optionsChainsOPMainnet),   'mimeType': 'image/webp'},
	'options/chains/qkc.webp':        {'data': stringToUint8(optionsChainsQuarkChain),  'mimeType': 'image/webp'},
	'options/chains/sep.webp':        {'data': stringToUint8(optionsChainsSepolia),     'mimeType': 'image/webp'},
};

export async function renderOptionsUrl(url: string): Promise<Response> {
	const asset = assets[url];
	if (asset === undefined) {
		return makeResponse(notFoundHtml, 404, 'text/html; charset=utf-8');
	}
	return makeResponse(asset.data, 200, asset.mimeType);
}
