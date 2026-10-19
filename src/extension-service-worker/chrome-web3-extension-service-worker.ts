import { developmentMode } from './development-mode';
import { web3Url } from './web3-url';
import { web3Client, web3FetchResult } from './web3-request';
import { htmlProcessor, looksLikeHTML, looksLikeCSS } from './html-processor';
import { initScript } from './init-script';
import { getDeclarativeNetRequestRules, getAllPastDeclarativeNetRequestRuleIds, convertWeb3HttpsUrl } from './declarative-net-request-rules';
import { getConfig } from './config';
import { renderOptionsUrl } from './options-handler';
const { Base64 } = require('js-base64');

// Represents a request made to the extension.
interface extRequest {
	// The rewritten URL that we are serving.
	url: string;
	// The original Request, when the caller needs its method, headers, or
	// body (cross-origin proxying).
	request?: Request;
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
// Query marker distinguishing a media element's raw-stream request from the
// top-level navigation that received the player page (see serveWeb3Request).
const mediaRawMarker = 'web3raw=1';

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
// Returns the raw bytes: binary magic-number detection must not run through
// a UTF-8 decode (invalid sequences collapse to U+FFFD and destroy signatures).
async function readStreamPrefix(stream: ReadableStream, maxBytes: number): Promise<Uint8Array> {
	const reader = stream.getReader();
	let result = new Uint8Array(0);
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
				const merged = new Uint8Array(result.length + chunk.length);
				merged.set(result, 0);
				merged.set(chunk, result.length);
				result = merged;
				received += chunk.length;
			}
		}
	} finally {
		// Cancel the sniff fork so tee() stops buffering data for it, but do
		// NOT await: per the streams spec a tee branch's cancel promise only
		// settles once BOTH branches cancel, so awaiting here deadlocks any
		// response larger than the sniff prefix (the body branch outlives us).
		reader.cancel().catch(() => {});
	}
	return result;
}

// Detects common audio/video container formats by magic number. Used both to
// catch top-level media navigations (which must get the player page instead
// of a download) and as a content-type fallback when the chain reports none.
function detectMediaMimeType(bytes: Uint8Array): string | null {
	const ascii = (start: number, text: string): boolean => {
		if (bytes.length < start + text.length) {
			return false;
		}
		for (let i = 0; i < text.length; i++) {
			if (bytes[start + i] != text.charCodeAt(i)) {
				return false;
			}
		}
		return true;
	};
	// MP4 family: 'ftyp' box at offset 4; the major brand distinguishes
	// audio-only files ('M4A ').
	if (ascii(4, 'ftyp')) {
		return ascii(8, 'M4A') ? 'audio/mp4' : 'video/mp4';
	}
	// WebM/MKV: EBML marker.
	if (bytes.length >= 4 && bytes[0] == 0x1A && bytes[1] == 0x45 && bytes[2] == 0xDF && bytes[3] == 0xA3) {
		return 'video/webm';
	}
	// Ogg container.
	if (ascii(0, 'OggS')) {
		return 'application/ogg';
	}
	// WAV / AVI: RIFF containers.
	if (ascii(0, 'RIFF')) {
		if (ascii(8, 'WAVE')) {
			return 'audio/wav';
		}
		if (ascii(8, 'AVI ')) {
			return 'video/x-msvideo';
		}
	}
	// MP3: ID3v2 tag or frame sync.
	if (ascii(0, 'ID3') || (bytes.length >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0)) {
		return 'audio/mpeg';
	}
	// FLAC.
	if (ascii(0, 'fLaC')) {
		return 'audio/flac';
	}
	return null;
}

// Detects common image formats by magic number, used as a content-type
// fallback for top-level navigations when the chain reports no mime type
// (browsers download anything served as application/octet-stream).
function detectImageMimeType(bytes: Uint8Array): string | null {
	if (bytes.length >= 4 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47) {
		return 'image/png';
	}
	if (bytes.length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) {
		return 'image/jpeg';
	}
	if (bytes.length >= 3 && bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46) {
		return 'image/gif';
	}
	if (bytes.length >= 12 && bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46
			&& bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50) {
		return 'image/webp';
	}
	if (bytes.length >= 2 && bytes[0] == 0x42 && bytes[1] == 0x4D) {
		return 'image/bmp';
	}
	return null;
}

// Renders a minimal media player page for top-level video/audio navigations
// (see serveWeb3Request for why the raw stream cannot be served directly).
function makeMediaPlayerPage(mimeType: string, path: string, mediaUrl: string): string {
	const escapeHtml = (s: string): string => s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
	const fileName = path != null && path.length > 1 ? path.split('/').pop() : 'media';
	const tag = mimeType.startsWith('audio/') ? 'audio' : 'video';
	const playerStyle = tag == 'audio'
		? 'width:min(40rem, 90%)'
		: 'max-width:100%;max-height:100%';
	return '<!doctype html><html><head><meta charset="utf-8" />'
		+ '<title>' + escapeHtml(fileName) + '</title>'
		+ '<style>html,body{margin:0;height:100%;background:#0b0b0b;display:flex;'
		+ 'align-items:center;justify-content:center;overflow:hidden}</style>'
		+ '</head><body>'
		+ '<div id="w3st" style="position:fixed;top:0;left:0;right:0;background:#111;color:#4f4;'
		+ 'font:11px monospace;padding:3px 8px;white-space:nowrap;overflow:hidden;z-index:9">loading</div>'
		+ '<' + tag + ' controls autoplay style="' + playerStyle + '">'
		+ '<source src="' + escapeHtml(mediaUrl) + '" type="' + escapeHtml(mimeType) + '" />'
		+ '</' + tag + '>'
		// Live status line script. Inline scripts never run here (extension
		// page CSP is script-src 'self'), so the player loads the bundled
		// static/player.js instead.
		+ '<script src="' + chromeExtensionPrefix + 'static/player.js"></scr' + 'ipt>'
		+ '</body></html>';
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

// Parses the start offset of a single-range "bytes=N-M" header. Returns the
// start offset, or -1 when there is no Range header, the range is a suffix
// range, lists several ranges, or is malformed -- all of which callers
// serve as a plain full-file response.
function parseRangeStart(rangeHeader: string | null): number {
	if (rangeHeader == null) {
		return -1;
	}
	const match = /^\s*bytes\s*=\s*(\d+)\s*-\s*(\d*)\s*$/.exec(rangeHeader);
	if (match == null) {
		return -1;
	}
	return parseInt(match[1], 10);
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

// Renders the standard error page for a failed web3 fetch. The error is
// always rendered as a page (and logged): re-throwing here would reject the
// respondWith() promise and surface as an opaque browser-level ERR_FAILED,
// hiding the actual cause -- unpacked extensions are always in development
// mode, so a throw would make every fetch failure undiagnosable.
function serveWeb3Error(e: any): Response {
	if (developmentMode()) {
		console.error('web3 fetch failed:', e);
	}
	let errorMessage = String(e);
	if (e instanceof Error) {
		errorMessage = e.message;
	}
	return makeResponse(makeErrorPage(errorMessage), 502, {
		'content-type': 'text/html; charset=utf-8',
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
// mediaRawRequested marks URLs that carried the mediaRawMarker query: they
// come from the player page's own <video>/<audio> element (or any other
// consumer that explicitly asks for the raw stream) and must never be
// redirected back to the player page again.
async function serveWeb3Request(w3url: web3Url, request?: Request, mediaRawRequested: boolean = false): Promise<Response> {
	// Media element subrequests (the player page's <video>/<audio> re-fetch,
	// or a web3 page embedding media) must receive the raw stream. ANY other
	// request that sniffs as media gets the player page.
	// sec-fetch-dest is NOT visible inside the service worker (it reads as
	// null here), so media element requests are recognized through the
	// player-page marker and the media Accept header instead.
	const requestDest = request != null ? request.headers.get('sec-fetch-dest') : null;
	const acceptHeader = request != null ? (request.headers.get('accept') ?? '') : '';
	const isMediaElementRequest = mediaRawRequested
		|| requestDest == 'video' || requestDest == 'audio'
		|| acceptHeader.startsWith('video/') || acceptHeader.startsWith('audio/');
	// Hard refresh (repeated navigation with cache:"reload") skips the
	// persistent chunk cache read so freshly overwritten files are served;
	// fetched chunks still refresh the cache.
	let bypassChunkCache = false;
	try {
		bypassChunkCache = request != null && request.cache == 'reload';
	} catch (e) {/** cache mode unavailable: use the cache */}
	// A media element's Range request ("bytes=0-" probe, or a non-zero start
	// after the user drags the playhead) is handed to the fetch: the chunked
	// reader answers any in-range start with a sized 206 and falls back to
	// the plain full stream for out-of-range starts. No seek fetching ever
	// happens.
	const rangeHeader = isMediaElementRequest ? (request != null ? request.headers.get('range') : null) : null;
	const byteStart = isMediaElementRequest ? parseRangeStart(rangeHeader) : -1;
	let result: web3FetchResult;
	try {
		result = await client.fetchUrl(w3url, bypassChunkCache, byteStart >= 0 ? byteStart : null);
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
	// Media element requests are served the raw stream as-is: no sniffing,
	// no processing, and never the player page (which would loop).
	if (isMediaElementRequest) {
		// On-chain mime tables commonly report the nonstandard
		// "application/mp4"; media elements expect the standard type.
		if (mimeType == 'application/mp4') {
			mimeType = 'video/mp4';
		}
		// The chunked reader already handled the Range request: 206 with
		// Content-Range from the requested position when the containing chunk
		// is already downloaded or cached, otherwise the full 200 stream --
		// always with Content-Length, which media elements need to buffer
		// progressively. Serve it as-is, but with two media-specific header
		// overrides:
		// - accept-ranges: explicitly advertise byte-range support (RFC 7233);
		//   the responses carry no other signal a media stack can rely on.
		// - cache-control no-store: keep Chrome's HTTP cache out of media
		//   responses entirely. Cacheable partial (206) entries let a fresh
		//   media element (page reload) take a cache-assisted shortcut -- a
		//   first request at the restored playhead with no demuxer init data --
		//   which ends in a full resource reload: the stream is canceled and
		//   re-requested from bytes=0-, replaying the video from the start.
		//   Chain data is already accelerated by our own persistent chunk
		//   cache, so the browser-side cache only adds this failure mode.
		const mediaResponse = await serveWeb3Result(result, mimeType, null);
		mediaResponse.headers.set('accept-ranges', 'bytes');
		mediaResponse.headers.set('cache-control', 'no-store');
		return mediaResponse;
	}
	// Sniff the actual content: the mime type reported on-chain is optional
	// (chunked storage frequently omits it), so content detection must
	// inspect the real bytes. The stream is tee'd so the body can still be
	// streamed through afterwards.
	const streamForks = result.output.tee();
	const sniffedBytes = await readStreamPrefix(streamForks[0], 4096);
	result.output = streamForks[1];
	const sniffed = new TextDecoder().decode(sniffedBytes);
	if (developmentMode()) {
		console.log('web3 request', w3url.toString(), 'dest:', requestDest, 'on-chain mime:', mimeType, 'sniffed mime:', detectMediaMimeType(sniffedBytes));
	}
	// Any non-media-element request whose bytes carry an audio/video
	// signature: answer with a minimal player page (text/html always
	// renders). The on-chain mime type is untrustworthy (files are served as
	// "application/mp4", "application/octet-stream", or nothing at all), so
	// a real media signature in the bytes is the only reliable signal.
	if (!isMediaElementRequest) {
		const mediaMime = detectMediaMimeType(sniffedBytes);
		if (mediaMime != null) {
			result.output.cancel().catch(() => {});
			const mediaUrl = request.url + (request.url.includes('?') ? '&' : '?') + mediaRawMarker;
			return makeResponse(makeMediaPlayerPage(mediaMime, w3url.path, mediaUrl), 200, {
				'content-type': 'text/html; charset=utf-8',
			});
		}
	}
	if (mimeType == 'text/html' || mimeType == 'application/xhtml+xml' || looksLikeHTML(sniffed)) {
		let processor = new htmlProcessor(w3url);
		return serveWeb3Result(result, 'text/html; charset=utf-8', [processor.processHtml]);
	}
	if (mimeType === null && looksLikeCSS(sniffed)) {
		mimeType = 'text/css';
	}
	// No usable mime type: fall back to image magic numbers so top-level
	// image navigations render inline instead of downloading as
	// application/octet-stream.
	if (mimeType === null || mimeType.startsWith('application/octet-stream')) {
		const imageMime = detectImageMimeType(sniffedBytes);
		if (imageMime != null) {
			mimeType = imageMime;
		}
	}
	return serveWeb3Result(result, mimeType, null);
}

// Serves an extension request for the https:// or http:// URL scheme.
// Extension pages run on the extension origin, and their cross-origin
// subresource fetches (RPC calls, external APIs) are intercepted by this SW:
// the browser still evaluates the responses against CORS policy, so every
// proxied response carries permissive CORS headers. Unlike the page's fetch,
// the SW's own fetch is exempt from CORS for hosts covered by
// host_permissions, which is what makes the proxy work at all.
async function serveHttpRequest(extReq: extRequest): Promise<Response> {
	// CORS preflight: answer here. RPC gateways and most plain HTTP servers
	// do not respond to OPTIONS, and without this the browser never sends
	// the actual POST the page asked for.
	if (extReq.request != null && extReq.request.method == 'OPTIONS') {
		const preflightHeaders: httpHeaders = {
			'access-control-allow-origin': '*',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS',
			'access-control-max-age': '86400',
		};
		const requestedHeaders = extReq.request.headers.get('access-control-request-headers');
		if (requestedHeaders != null) {
			preflightHeaders['access-control-allow-headers'] = requestedHeaders;
		}
		return makeResponse('', 204, preflightHeaders);
	}
	// Pass the original request through untouched (method, headers, body).
	// Navigate-mode requests cannot be re-fetched as-is, so they are rebuilt
	// as plain GETs.
	try {
		const upstream = extReq.request != null && extReq.request.mode != 'navigate'
			? await fetch(extReq.request)
			: await fetch(extReq.url, {'method': 'GET', 'redirect': 'follow'});
		const headers = new Headers(upstream.headers);
		headers.set('access-control-allow-origin', '*');
		headers.set('access-control-expose-headers', '*');
		return new Response(upstream.body, {
			'status': upstream.status,
			'statusText': upstream.statusText,
			'headers': headers,
		});
	} catch (e) {
		return makeResponse('upstream fetch failed: ' + e, 502, {
			'content-type': 'text/plain; charset=utf-8',
			'access-control-allow-origin': '*',
		});
	}
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
			'content-type': 'text/plain',
		});
	}
	if (developmentMode()) {
		console.log('Serving HTTP script URL request:', decodedUrl);
	}
	// No explicit 'mode': hosts covered by host_permissions are exempted
	// from CORS checks for the extension origin.
	const scriptRequest = fetch(decodedUrl, {
		'method': 'GET',
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
		request: request,
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
	} else if (url.startsWith('static/')) {
		// Bundled extension resources (static/player.js and friends)
		// requested by extension pages via chrome-extension:// URLs. The SW
		// intercepts every same-origin fetch including these, and handing
		// them to the web3 URL parser produced 400 "invalid request" (the
		// player page's <script src="static/player.js"> would abort).
		// We match on the stripped path (`static/player.js`) rather than on
		// the original chrome-extension:// prefix so that dNR-redirected
		// web3:// navigations (which also arrive as chrome-extension://...
		// requests stripped to `web3://...`) fall through to the web3 URL
		// parser as intended.
		return fetch(request.url);
	} else {
		let requestUrl = extReq.url;
		// The media player page appends the raw-stream marker as a query
		// parameter; strip it before parsing so it is not treated as part of
		// the on-chain resource path (web3 URLs keep queries in the path),
		// and remember it: the request must be served as a raw media stream
		// instead of being sniffed into another player page.
		const markerQuery = '?' + mediaRawMarker;
		const markerParam = '&' + mediaRawMarker;
		let mediaRawRequested = false;
		if (requestUrl.endsWith(markerQuery)) {
			requestUrl = requestUrl.substring(0, requestUrl.length - markerQuery.length);
			mediaRawRequested = true;
		} else if (requestUrl.endsWith(markerParam)) {
			requestUrl = requestUrl.substring(0, requestUrl.length - markerParam.length);
			mediaRawRequested = true;
		}
		let w3url: web3Url;
		try {
			w3url = new web3Url(requestUrl);
		} catch (e) {
			if (url.startsWith(httpsScheme) || url.startsWith(httpScheme)) {
				return serveHttpRequest(extReq);
			}
			return makeResponse('invalid request', 400, {});
		}
		return serveWeb3Request(w3url, request, mediaRawRequested);
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
}).catch((error) => {
	console.error('Failed to register declarativeNetRequest rules:', error);
});

// Handle top-level navigations to web3 gateway URLs. declarativeNetRequest
// cannot redirect renderer-initiated navigations (e.g. link clicks on other
// websites) to extension pages -- Chrome blocks them with
// ERR_BLOCKED_BY_CLIENT -- so top-level navigations are re-pointed to the
// internal extension page via tabs.update, which is extension-initiated and
// always allowed.
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
	if (details.frameId !== 0) {
		return;
	}
	const extensionUrl = await convertWeb3HttpsUrl(details.url);
	if (extensionUrl === null) {
		return;
	}
	chrome.tabs.update(details.tabId, {'url': extensionUrl});
}, {
	url: [
		{'hostSuffix': '.web3'},
		{'hostSuffix': 'w3eth.io'},
		{'hostSuffix': 'w3link.io'},
	],
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
