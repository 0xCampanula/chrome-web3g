import { developmentMode } from './development-mode';
import { web3Url } from './web3-url';
import { web3Client, web3FetchResult } from './web3-request';
import { htmlProcessor, looksLikeHTML, looksLikeCSS } from './html-processor';
import { initScript } from './init-script';
import { getDeclarativeNetRequestRules, getAllPastDeclarativeNetRequestRuleIds } from './declarative-net-request-rules';
import { getConfig } from './config';
import { renderOptionsUrl } from './options-handler';
const { Base64 } = require('js-base64');

// Represents a request made to the extension.
interface extRequest {
	// The rewritten URL that we are serving.
	url: string;
}

// Accepted types that can be served back to the user.
type httpBody = string | Uint8Array | Blob | ReadableStream;

// A function that processes an HTTP response body.
type bodyProcessor = (body: string) => string;

// A key-value dictionary of HTTP headers.
// Keys are case-insensitive.
interface httpHeaders {
	[key: string]: string
}

// Constants.
const chromeExtensionPrefix = chrome.runtime.getURL('/');
const chromeExtensionPrefixLength = chromeExtensionPrefix.length;
const web3Scheme = 'web3://';
const web3ScriptUrlScheme = 'web3scripturl://';
const web3ScriptInlineScheme = 'web3scriptinline://';
const web3ScriptInitScheme = 'web3scriptinit://';
const web3FaviconScheme = 'web3favicon://';
const web3StylesheetScheme = 'web3stylesheet://';
const web3DevNullScheme = 'web3devnull://';
const httpScheme = 'http://';
const httpsScheme = 'https://';
const staticOptionsPage = 'static/options.html';
const optionsUrl = 'options';

// Web3 URL client.
const client = new web3Client();

// Creates an HTTP Response object with the given body, response code, and HTTP headers.
function makeResponse(body: httpBody, responseCode: number, headers: httpHeaders): Response {
	let responseHeaders: httpHeaders = {
		'cache-control': 'max-age=1800',
		'content-security-policy': "default-src * self blob: data: gap:; style-src * self 'unsafe-inline' blob: data: gap:; script-src * 'self' 'unsafe-eval' 'unsafe-inline' blob: data: gap:; object-src * 'self' blob: data: gap:; img-src * self 'unsafe-inline' blob: data: gap:; connect-src self * 'unsafe-inline' blob: data: gap:; frame-src * self blob: data: gap:; worker-src * self blob: data: gap:;",
		'content-type': 'application/octet-stream',
	};
	for (let i in headers) {
		responseHeaders[i.toLowerCase()] = headers[i];
	}
	let responseOptions: ResponseInit = {
		'status': responseCode,
		'headers': responseHeaders,
	};
	// Response accepts string, Uint8Array, Blob and ReadableStream directly;
	// passing the body through as-is avoids an extra full-body copy.
	return new Response(body, responseOptions);
}

// Reads a stream fully, decoding it incrementally to avoid intermediate
// full-body copies (chunk array -> Buffer.concat -> slice -> string).
async function readAllStream(stream: ReadableStream): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let result = '';
	while (true) {
		const read = await reader.read();
		if (read.done) {
			break;
		}
		if (read.value !== undefined && read.value !== null) {
			result += decoder.decode(read.value, {'stream': true});
		}
	}
	result += decoder.decode();
	return result;
}

// Reads at most maxBytes from the start of a stream for content sniffing,
// then cancels the reader. Intended for one branch of a tee'd stream.
async function readStreamPrefix(stream: ReadableStream, maxBytes: number): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let result = '';
	let received = 0;
	try {
		while (received < maxBytes) {
			const read = await reader.read();
			if (read.done) {
				break;
			}
			if (read.value !== undefined && read.value !== null) {
				const remaining = maxBytes - received;
				const chunk = read.value.length > remaining ? read.value.subarray(0, remaining) : read.value;
				received += chunk.length;
				result += decoder.decode(chunk, {'stream': true});
			}
		}
	} finally {
		await reader.cancel();
	}
	result += decoder.decode();
	return result;
}

// Renders a user-facing HTML error page for failed web3:// requests, with a
// link to the options page (failed chains can be re-added there as custom
// chains) and a retry link. The error message is HTML-escaped.
function makeErrorPage(errorMessage: string): string {
	const escapedMessage = errorMessage
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
	return '<!doctype html><html><head><meta charset="utf-8" />'
		+ '<title>web3:// request failed</title>'
		+ '<style>'
		+ 'body{font-family:system-ui,sans-serif;max-width:40rem;margin:6rem auto;padding:0 1.5rem;color:#222;line-height:1.5}'
		+ 'h1{font-size:1.4rem}'
		+ '.error-message{background:#f6f6f6;border:1px solid #ddd;border-radius:6px;padding:.75rem 1rem;word-break:break-all;font-family:monospace;font-size:.9rem}'
		+ '.actions a{display:inline-block;margin-right:1rem;color:#0b57d0}'
		+ '</style></head><body>'
		+ '<h1>Unable to load this web3 page</h1>'
		+ '<p class="error-message">' + escapedMessage + '</p>'
		+ '<p>This usually means the chain is unreachable, or that it was shut down and '
		+ 'removed from the built-in chain list. You can add it back as a custom chain '
		+ 'in the extension options, or check the configured RPC providers.</p>'
		+ '<p class="actions"><a href="/options">Open extension options</a>'
		+ '<a href="javascript:location.reload()">Retry</a></p>'
		+ '</body></html>';
}

// Builds the HTTP Response for a successful web3 fetch result.
// forceMime may be used to override the mime-type returned in the response.
// If processors are given, they will be run over the response body.
async function serveWeb3Result(result: web3FetchResult, forceMime: string, processors: bodyProcessor[]): Promise<Response> {
	let body: httpBody = result.output;
	if (processors != null) {
		let stringBody = await readAllStream(body);
		for (let processor of processors) {
			stringBody = processor(stringBody);
		}
		body = new TextEncoder().encode(stringBody);
	}
	let httpCode = 200;
	if (result.httpCode != null && result.httpCode != 0) {
		httpCode = result.httpCode;
	}
	let headers: httpHeaders = {};
	for (let header in result.httpHeaders) {
		headers[header.toLowerCase()] = result.httpHeaders[header];
	}
	if (forceMime !== null && forceMime !== '') {
		headers['content-type'] = forceMime;
	}
	return makeResponse(body, httpCode, headers);
}

// Renders the standard error page for a failed web3 fetch.
function serveWeb3Error(e: any): Response {
	if (developmentMode()) {
		throw e;
	}
	let errorMessage = String(e);
	if (e instanceof Error) {
		errorMessage = e.message;
	}
	return makeResponse(makeErrorPage(errorMessage), 502, {
		'content-type': 'text/html',
	});
}

// Create an HTTP Response object representing the content of the passed-in web3Promise.
// forceMime may be used to override the mime-type returned in the response.
// If the web3 request is successful, the list of processors will be run over the
// response body.
async function makeWeb3Response(web3Promise: Promise<web3FetchResult>, forceMime: string, processors: bodyProcessor[]): Promise<Response> {
	try {
		return await serveWeb3Result(await web3Promise, forceMime, processors);
	} catch (e) {
		return serveWeb3Error(e);
	}
}

// Serves an extension request for the web3:// URL scheme.
async function serveWeb3Request(w3url: web3Url): Promise<Response> {
	let result: web3FetchResult;
	try {
		result = await client.fetchUrl(w3url);
	} catch (e) {
		if (developmentMode()) {
			console.log('Failed to fetch', w3url, ':', e);
		}
		return serveWeb3Error(e);
	}
	let mimeType = null;
	for (let header in result.httpHeaders) {
		if (header.toLowerCase() == 'content-type') {
			mimeType = result.httpHeaders[header];
			break;
		}
	}
	// Sniff the actual content: the mime type reported on-chain is optional,
	// so HTML detection must inspect the real bytes (String(ReadableStream)
	// only yields "[object ReadableStream]"). The stream is tee'd so the body
	// can still be streamed through afterwards.
	const streamForks = result.output.tee();
	const sniffed = await readStreamPrefix(streamForks[0], 4096);
	result.output = streamForks[1];
	if (mimeType == 'text/html' || mimeType == 'application/xhtml+xml' || looksLikeHTML(sniffed)) {
		let processor = new htmlProcessor(w3url);
		return serveWeb3Result(result, 'text/html', [processor.processHtml]);
	}
	if (mimeType === null && looksLikeCSS(sniffed)) {
		mimeType = 'text/css';
	}
	return serveWeb3Result(result, mimeType, null);
}

// Serves an extension request for the https:// or http:// URL scheme.
async function serveHttpRequest(extReq: extRequest): Promise<Response> {
	return fetch(extReq.url, {
		'method': 'GET',
		'mode': 'cors',
		'redirect': 'follow',
	});
}

// Serves an extension request for the web3scripturl:// URL scheme.
async function serveWeb3ScriptURLRequest(extReq: extRequest): Promise<Response> {
	const encodedUrl = extReq.url.substring(web3ScriptUrlScheme.length);
	const decodedUrl = Base64.decode(encodedUrl);
	let w3url: web3Url = null;
	try {
		w3url = new web3Url(decodedUrl);
	} catch (e) {
		// Do nothing.
	}
	if (w3url !== null) {
		if (developmentMode()) {
			console.log('Serving script URL request:', decodedUrl, 'decoded to', w3url);
		}
		return makeWeb3Response(client.fetchUrl(w3url), 'text/javascript', null);
	}
	if (!decodedUrl.startsWith(httpsScheme) && !decodedUrl.startsWith(httpScheme)) {
		if (developmentMode()) {
			console.log('Got invalid URL: encoded=', encodedUrl, '; decoded=', decodedUrl);
		}
		return makeResponse('invalid URL: ' + encodedUrl, 501, {
			'content-type': 'text-plain',
		});
	}
	if (developmentMode()) {
		console.log('Serving HTTP script URL request:', decodedUrl);
	}
	const scriptRequest = fetch(decodedUrl, {
		'method': 'GET',
		'mode': 'cors',
		'redirect': 'follow',
	});
	let result: Response;
	let scriptBody: string;
	try {
		result = await scriptRequest;
		scriptBody = await result.text();
	} catch (e) {
		if (developmentMode()) {
			// For development purposes:
			throw e;
		}
		let errorMessage = String(e);
		if (e instanceof Error) {
			errorMessage = e.message;
		}
		return makeResponse(errorMessage, 502, {
			'content-type': 'text/plain',
		});
	}
	return makeResponse(scriptBody, result.status, {
		'content-type': 'text/javascript',
	});
}

// Serves an extension request for the web3scriptinline:// URL scheme.
async function serveWeb3ScriptInlineRequest(extReq: extRequest): Promise<Response> {
	const encodedScript = extReq.url.substring(web3ScriptInlineScheme.length);
	const decodedScript = Base64.decode(encodedScript);
	return makeResponse(decodedScript, 200, {
		'content-type': 'text/javascript',
	});
}

// Serves an extension request for the web3scriptinit:// URL scheme.
async function serveWeb3ScriptInitRequest(extReq: extRequest): Promise<Response> {
	const encodedUrl = extReq.url.substring(web3ScriptInitScheme.length);
	const decodedUrl = Base64.decode(encodedUrl);
	const w3url = new web3Url(decodedUrl);
	return makeResponse(new initScript(w3url).render(), 200, {
		'content-type': 'text/javascript',
	});
}

async function serveWeb3StylesheetRequest(extReq: extRequest): Promise<Response> {
	const decodedUrl = web3Scheme + extReq.url.substring(web3StylesheetScheme.length);
	let w3url: web3Url;
	try {
		w3url = new web3Url(decodedUrl);
	} catch (e) {
		return makeResponse('invalid web3 stylesheet URL', 400, {
			'content-type': 'text/plain',
		});
	}
	return makeWeb3Response(client.fetchUrl(w3url), 'text/css', null);
}

// Serves an extension request for the web3favicon:// URL scheme.
async function serveWeb3FaviconRequest(extReq: extRequest): Promise<Response> {
	let origin: web3Url;
	try {
		origin = new web3Url(extReq.url.substring(web3FaviconScheme.length));
	} catch (e) {
		return makeResponse('invalid web3 favicon URL', 400, {
			'content-type': 'text/plain',
		});
	}
	const pngIconPromise = client.fetchUrl(origin.resolve('/favicon.png'));
	const icoIconPromise = client.fetchUrl(origin.resolve('/favicon.ico'));
	// Whichever icon fetch succeeds first wins; Promise.any rejects only when
	// both failed, in which case there is no favicon to serve.
	try {
		const result = await Promise.any([pngIconPromise, icoIconPromise]);
		return makeWeb3Response(Promise.resolve(result), null, null);
	} catch (e) {
		return makeResponse('', 404, {});
	}
}

// Serves an extension request for the web3devnull:// URL scheme.
async function serveWeb3DevNullRequest(extReq: extRequest): Promise<Response> {
	const maybeMimeType = extReq.url.substring(web3DevNullScheme.length);
	let headers: httpHeaders = {};
	if (maybeMimeType !== '') {
		headers['content-type'] = maybeMimeType;
	}
	return makeResponse('', 200, headers);
}

// Main request entry point.
// Serves a request made to the extension service worker.
async function handleRequest(request: Request): Promise<Response> {
	let url = request.url;
	if (url.startsWith(chromeExtensionPrefix)) {
		url = request.url.substring(chromeExtensionPrefixLength);
	}
	let poundIndex = url.indexOf('#');
	if (poundIndex !== -1) {
		url = url.substring(0, poundIndex);
	}
	const extReq: extRequest = {
		url: url,
	};
	if (url.startsWith(web3ScriptUrlScheme)) {
		return serveWeb3ScriptURLRequest(extReq);
	} else if (url.startsWith(web3ScriptInlineScheme)) {
		return serveWeb3ScriptInlineRequest(extReq);
	} else if (url.startsWith(web3ScriptInitScheme)) {
		return serveWeb3ScriptInitRequest(extReq);
	} else if (url.startsWith(web3DevNullScheme)) {
		return serveWeb3DevNullRequest(extReq);
	} else if (url.startsWith(web3StylesheetScheme)) {
		return serveWeb3StylesheetRequest(extReq);
	} else if (url.startsWith(web3FaviconScheme)) {
		return serveWeb3FaviconRequest(extReq);
	} else if (url == staticOptionsPage) {
		return makeResponse('Redirecting...', 301, {
			'location': chromeExtensionPrefix + optionsUrl,
		});
	} else if (url == optionsUrl || url.startsWith(optionsUrl + '/')) {
		return renderOptionsUrl(url);
	} else {
		let w3url: web3Url;
		try {
			w3url = new web3Url(extReq.url);
		} catch (e) {
			if (url.startsWith(httpsScheme) || url.startsWith(httpScheme)) {
				return serveHttpRequest(extReq);
			}
			return makeResponse('invalid request', 400, {});
		}
		return serveWeb3Request(w3url);
	}
}

// Handle fetch event in the extension service worker.
self.addEventListener('fetch', (event: FetchEvent) => {
	event.respondWith(handleRequest(event.request));
});

// Handle omnibox input events to support the "web3" omnibox keyword.
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
	// Strip any leading "web3:" and slashes the user may have typed.
	text = text.replace(/^(web3:)?\/*/i, '');
	const url = chromeExtensionPrefix + web3Scheme + text;
	if (disposition == 'currentTab') {
		chrome.tabs.update({
			'url': url,
		});
	} else {
		chrome.tabs.create({
			'active': disposition == 'newForegroundTab',
			'url': url,
		});
	}
});

// Set declarativeNetRequest redirect rules for the extension.
chrome.declarativeNetRequest.updateDynamicRules({
	removeRuleIds: getAllPastDeclarativeNetRequestRuleIds(),
	addRules: getDeclarativeNetRequestRules(),
});

interface chromeInstallEvent {
	id?: string;
	previousVersion?: string;
	reason: chrome.runtime.OnInstalledReason;
}

export async function onExtensionInstall(ev: chromeInstallEvent) {
	if (developmentMode()) {
		console.log('Install event:', ev);
	}
	const conf = await getConfig();
	if (!await conf.hasOpenedOptionsPage()) {
		chrome.runtime.openOptionsPage();
		conf.setHasOpenedOptionsPage(true);
	}
}

chrome.runtime.onInstalled.addListener(onExtensionInstall);

if (developmentMode()) {
	console.log('Initialized.');
}
