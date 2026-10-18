const optionsHtml = require('./../options/options.html').default;
const optionsBootstrapJS = require('./../options/bootstrap.raw.js').default;
const optionsJQueryJS = require('./../options/jquery.raw.js').default;
const optionsBootstrapCSS = require('./../options/bootstrap.css').default;
const optionsCSS = require('./../options/options.scss').default;
const optionsJS = require('raw-loader!@chrome-web3-extension-options/options.js').default;
const optionsSpinnerSVG = require('./../options/spinner.svg').default;
const optionsDoneSVG = require('./../options/done.svg').default;
const optionsNotDoneSVG = require('./../options/not-done.svg').default;
const optionsFailureSVG = require('./../options/failure.svg').default;
const optionsEthereumSVG = require('./../options/ethereum.svg').default;
const optionsGitHubSVG = require('./../options/github.svg').default;
const notFoundHtml = require('./../options/not-found.html').default;

const optionsWeb3URLPNG = require('./../options/web3url.png');
const optionsVitalikBlogJPEG = require('./../options/vitalik-blog.jpg');

const optionsChainsArbitrumOne = require('./../options/chains/arb1.webp');
const optionsChainsAvalanche = require('./../options/chains/avax.webp');
const optionsChainsBase = require('./../options/chains/base.webp');
const optionsChainsEthereum = require('./../options/chains/eth.webp');
const optionsChainsFilecoin = require('./../options/chains/filecoin.webp');
const optionsChainsGnosis = require('./../options/chains/gno.webp');
const optionsChainsMantle = require('./../options/chains/mantle.webp');
const optionsChainsOPMainnet = require('./../options/chains/oeth.webp');
const optionsChainsPolygon = require('./../options/chains/matic.webp');
const optionsChainsZKSyncEra = require('./../options/chains/zksync.webp');
const optionsChainsZora = require('./../options/chains/zora.webp');

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
	'options':                        {'data': optionsHtml,           'mimeType': 'text/html'},
	'options/bootstrap.raw.js':       {'data': optionsBootstrapJS,    'mimeType': 'text/javascript'},
	'options/jquery.raw.js':          {'data': optionsJQueryJS,       'mimeType': 'text/javascript'},
	'options/bootstrap.css':          {'data': optionsBootstrapCSS,   'mimeType': 'text/css'},
	'options/options.css':            {'data': optionsCSS,            'mimeType': 'text/css'},
	'options/options.js':             {'data': optionsJS,             'mimeType': 'text/javascript'},
	'options/spinner.svg':            {'data': optionsSpinnerSVG,     'mimeType': 'image/svg+xml'},
	'options/done.svg':               {'data': optionsDoneSVG,        'mimeType': 'image/svg+xml'},
	'options/not-done.svg':           {'data': optionsNotDoneSVG,     'mimeType': 'image/svg+xml'},
	'options/failure.svg':            {'data': optionsFailureSVG,     'mimeType': 'image/svg+xml'},
	'options/ethereum.svg':           {'data': optionsEthereumSVG,    'mimeType': 'image/svg+xml'},
	'options/web3-url.png':           {'data': stringToUint8(optionsWeb3URLPNG),        'mimeType': 'image/png'},
	'options/vitalik-blog.jpg':       {'data': stringToUint8(optionsVitalikBlogJPEG),   'mimeType': 'image/jpeg'},
	'options/github.svg':             {'data': stringToUint8(optionsGitHubSVG),         'mimeType': 'image/svg+xml'},
	'options/chains/arb1.webp':       {'data': stringToUint8(optionsChainsArbitrumOne), 'mimeType': 'image/webp'},
	'options/chains/avax.webp':       {'data': stringToUint8(optionsChainsAvalanche),   'mimeType': 'image/webp'},
	'options/chains/base.webp':       {'data': stringToUint8(optionsChainsBase),        'mimeType': 'image/webp'},
	'options/chains/eth.webp':        {'data': stringToUint8(optionsChainsEthereum),    'mimeType': 'image/webp'},
	'options/chains/filecoin.webp':   {'data': stringToUint8(optionsChainsFilecoin),    'mimeType': 'image/webp'},
	'options/chains/gno.webp':        {'data': stringToUint8(optionsChainsGnosis),      'mimeType': 'image/webp'},
	'options/chains/mantle.webp':     {'data': stringToUint8(optionsChainsMantle),      'mimeType': 'image/webp'},
	'options/chains/oeth.webp':       {'data': stringToUint8(optionsChainsOPMainnet),   'mimeType': 'image/webp'},
	'options/chains/matic.webp':      {'data': stringToUint8(optionsChainsPolygon),     'mimeType': 'image/webp'},
	'options/chains/zksync.webp':     {'data': stringToUint8(optionsChainsZKSyncEra),   'mimeType': 'image/webp'},
	'options/chains/zora.webp':       {'data': stringToUint8(optionsChainsZora),        'mimeType': 'image/webp'},
};

export async function renderOptionsUrl(url: string): Promise<Response> {
	const asset = assets[url];
	if (asset === undefined) {
		return makeResponse(notFoundHtml, 404, 'text/html');
	}
	return makeResponse(asset.data, 200, asset.mimeType);
}
